#!/usr/bin/env python3
"""
Delamain Bridge Daemon for sunnypilot
Streams vehicle telemetry and fires events to the Delamain AI backend.

Drop into selfdrive/delamain/delamaind.py in the fork.
Add to system/manager/process_config.py or launch manually.
Requires: pip install websocket-client
"""

import time
import json
import threading
import websocket
import cereal.messaging as messaging
from openpilot.common.realtime import Ratekeeper

DELAMAIN_WS_URL = "wss://delamain.genysis.xyz/ws/sunnypilot-bridge"
TELEMETRY_HZ    = 2   # telemetry updates per second
CLIENT_ID       = "sunnypilot-bridge"

MPS_TO_MPH = lambda mps: mps * 2.23694

# Per-event cooldowns in seconds — prevents spamming the same comment
EVENT_COOLDOWNS = {
    "hard_brake":           12,
    "very_hard_brake":       5,
    "rapid_accel":          20,
    "lane_change_left":      8,
    "lane_change_right":     8,
    "lead_car_close":       20,
    "lead_car_very_close":   8,
    "driver_distracted":    45,
    "high_speed":           90,
    "acc_engaged":           5,
    "acc_disengaged":        5,
    "stopped_in_traffic":  120,
    "seatbelt_off":         30,
}


class DelamainBridge:
    def __init__(self):
        self.ws = None
        self.ws_lock = threading.Lock()
        self.ws_connected = False
        self._last_event_time: dict[str, float] = {}

        # Edge-detection state
        self.prev_acc_enabled    = False
        self.prev_left_blinker   = False
        self.prev_right_blinker  = False
        self.prev_seatbelt       = False
        self.stopped_since: float | None = None

        # Last known values for cross-topic use
        self.current_speed_mps = 0.0
        self.last_gps = None

    # ------------------------------------------------------------------ helpers

    def _can_fire(self, event: str) -> bool:
        cooldown = EVENT_COOLDOWNS.get(event, 10)
        if time.monotonic() - self._last_event_time.get(event, 0) >= cooldown:
            self._last_event_time[event] = time.monotonic()
            return True
        return False

    def _send(self, msg: dict) -> None:
        with self.ws_lock:
            if self.ws and self.ws_connected:
                try:
                    self.ws.send(json.dumps(msg))
                except Exception as e:
                    print(f"[Delamain] send error: {e}")

    def fire(self, event: str, data: dict | None = None) -> None:
        if self._can_fire(event):
            print(f"[Delamain] event → {event} {data or ''}")
            self._send({"type": "vehicle_event", "event": event, "data": data or {}})

    # ---------------------------------------------------------- topic handlers

    def on_car_state(self, cs) -> None:
        speed_mph = MPS_TO_MPH(cs.vEgo)
        self.current_speed_mps = cs.vEgo
        accel = cs.aEgo

        # Braking
        if speed_mph > 10:
            if accel < -7.0:
                self.fire("very_hard_brake", {"decel": round(accel, 1), "speed_mph": round(speed_mph)})
            elif accel < -4.0:
                self.fire("hard_brake",      {"decel": round(accel, 1), "speed_mph": round(speed_mph)})

        # Acceleration
        if accel > 4.0 and speed_mph > 5:
            self.fire("rapid_accel", {"accel": round(accel, 1), "speed_mph": round(speed_mph)})

        # Speed
        if speed_mph > 90:
            self.fire("high_speed", {"speed_mph": round(speed_mph)})

        # Lane changes — blinker rising edge only, not while parking
        if speed_mph > 20:
            if cs.leftBlinker  and not self.prev_left_blinker:
                self.fire("lane_change_left",  {"speed_mph": round(speed_mph)})
            if cs.rightBlinker and not self.prev_right_blinker:
                self.fire("lane_change_right", {"speed_mph": round(speed_mph)})

        # ACC state transitions
        acc = cs.cruiseState.enabled
        if acc  and not self.prev_acc_enabled:
            self.fire("acc_engaged",    {"speed_mph": round(speed_mph)})
        if not acc and self.prev_acc_enabled:
            self.fire("acc_disengaged", {"speed_mph": round(speed_mph)})

        # Stopped in traffic (>10 s below 1 mph)
        if speed_mph < 1:
            if self.stopped_since is None:
                self.stopped_since = time.monotonic()
            elif time.monotonic() - self.stopped_since > 10:
                self.fire("stopped_in_traffic")
        else:
            self.stopped_since = None

        # Seatbelt unlatched while moving
        if cs.seatbeltUnlatched and not self.prev_seatbelt and speed_mph > 5:
            self.fire("seatbelt_off", {"speed_mph": round(speed_mph)})

        self.prev_acc_enabled   = acc
        self.prev_left_blinker  = cs.leftBlinker
        self.prev_right_blinker = cs.rightBlinker
        self.prev_seatbelt      = cs.seatbeltUnlatched

    def on_radar_state(self, rs) -> None:
        if not rs.leadOne.status:
            return
        d = rs.leadOne.dRel
        speed_mph = MPS_TO_MPH(self.current_speed_mps)
        if d < 8 and speed_mph > 15:
            self.fire("lead_car_very_close", {"distance_m": round(d, 1), "speed_mph": round(speed_mph)})
        elif d < 15 and speed_mph > 25:
            self.fire("lead_car_close",      {"distance_m": round(d, 1), "speed_mph": round(speed_mph)})

    def on_driver_monitoring(self, dms) -> None:
        if dms.isDistracted:
            self.fire("driver_distracted")

    def on_gps(self, gps) -> None:
        self.last_gps = gps

    # ----------------------------------------------------------- telemetry push

    def send_telemetry(self, cs) -> None:
        data: dict = {
            "speed_mph":      round(MPS_TO_MPH(cs.vEgo), 1),
            "accel":          round(cs.aEgo, 2),
            "steering_angle": round(cs.steeringAngleDeg, 1),
            "left_blinker":   cs.leftBlinker,
            "right_blinker":  cs.rightBlinker,
            "acc_enabled":    cs.cruiseState.enabled,
            "brake_pressed":  cs.brakePressed,
            "gas_pressed":    cs.gasPressed,
        }
        if self.last_gps:
            g = self.last_gps
            data.update({"lat": g.latitude, "lon": g.longitude, "bearing": g.bearingDeg})
        self._send({"type": "vehicle_state", "data": data})

    # ------------------------------------------------------ websocket lifecycle

    def _ws_thread(self) -> None:
        while True:
            try:
                print(f"[Delamain] connecting to {DELAMAIN_WS_URL} ...")

                def on_open(ws):
                    self.ws_connected = True
                    print("[Delamain] WebSocket connected")

                def on_close(ws, code, msg):
                    self.ws_connected = False
                    print(f"[Delamain] WebSocket closed ({code})")

                def on_error(ws, err):
                    self.ws_connected = False
                    print(f"[Delamain] WebSocket error: {err}")

                def on_message(ws, msg):
                    pass  # backend may send pong or audio — ignore for now

                with self.ws_lock:
                    self.ws = websocket.WebSocketApp(
                        DELAMAIN_WS_URL,
                        on_open=on_open,
                        on_close=on_close,
                        on_error=on_error,
                        on_message=on_message,
                    )
                self.ws.run_forever(ping_interval=30, ping_timeout=10)
            except Exception as e:
                print(f"[Delamain] connection failed: {e}")
            self.ws_connected = False
            time.sleep(5)

    # ---------------------------------------------------------------------- run

    def run(self) -> None:
        threading.Thread(target=self._ws_thread, daemon=True).start()
        time.sleep(2)

        sm = messaging.SubMaster([
            'carState',
            'radarState',
            'driverMonitoringState',
            'gpsLocationExternal',
        ])

        rk = Ratekeeper(20, print_delay_threshold=0.1)
        telemetry_interval = 1.0 / TELEMETRY_HZ
        last_telemetry = 0.0

        while True:
            sm.update(0)

            if sm.updated['carState']:
                cs = sm['carState']
                self.on_car_state(cs)
                if time.monotonic() - last_telemetry >= telemetry_interval:
                    self.send_telemetry(cs)
                    last_telemetry = time.monotonic()

            if sm.updated['radarState']:
                self.on_radar_state(sm['radarState'])

            if sm.updated['driverMonitoringState']:
                self.on_driver_monitoring(sm['driverMonitoringState'])

            if sm.updated['gpsLocationExternal']:
                self.on_gps(sm['gpsLocationExternal'])

            rk.keep_time()


if __name__ == "__main__":
    DelamainBridge().run()
