#!/usr/bin/env python3
"""
Delamain Bridge Daemon for sunnypilot
Streams vehicle telemetry and fires events to the Delamain AI backend.

Reads carState via read-only mmap of /dev/shm/msgq_carState — no reader
slots are registered, so openpilot's msgq slot counts are unaffected.
"""

import time
import json
import mmap
import os
import struct
import socket
import signal
import sys
import threading
import datetime
import websocket

from cereal.messaging import log_from_bytes
from openpilot.common.realtime import Ratekeeper


def _capture_road_frame() -> str | None:
    """Capture one frame from the road camera via VisionIPC. Returns base64 JPEG or None."""
    try:
        import sys as _sys
        import numpy as np
        import base64
        import io
        from PIL import Image

        try:
            from cereal.visionipc import VisionIpcClient, VisionStreamType
        except ImportError:
            try:
                from visionipc import VisionIpcClient, VisionStreamType
            except ImportError:
                _sys.path.insert(0, '/data/openpilot/msgq_repo')
                from msgq.visionipc import VisionIpcClient, VisionStreamType

        client = VisionIpcClient("camerad", VisionStreamType.VISION_STREAM_ROAD, False)
        if not client.connect(False):
            print("[Camera] Could not connect to camerad VisionIPC")
            return None

        buf = client.recv(timeout_ms=2000)
        if buf is None:
            print("[Camera] No frame received within timeout")
            return None

        w, h = buf.width, buf.height
        raw = np.frombuffer(buf.data, dtype=np.uint8)

        # NV12: Y plane (h*w bytes) then interleaved UV plane (h//2 * w//2 * 2 bytes)
        y  = raw[:h * w].reshape(h, w)
        uv = raw[h * w : h * w + (h // 2) * (w // 2) * 2].reshape(h // 2, w // 2, 2)

        # Downsample to 640px wide BEFORE color conversion — much faster on ARM
        tw, th = 640, int(h * 640 / w)
        y_s = np.array(Image.fromarray(y).resize((tw, th), Image.LANCZOS),            dtype=np.float32)
        u_s = np.array(Image.fromarray(uv[:, :, 0]).resize((tw, th), Image.LANCZOS),  dtype=np.float32) - 128.0
        v_s = np.array(Image.fromarray(uv[:, :, 1]).resize((tw, th), Image.LANCZOS),  dtype=np.float32) - 128.0

        # BT.601 YCbCr → RGB
        r = np.clip(y_s + 1.402 * v_s,                         0, 255).astype(np.uint8)
        g = np.clip(y_s - 0.344136 * u_s - 0.714136 * v_s,    0, 255).astype(np.uint8)
        b = np.clip(y_s + 1.772 * u_s,                         0, 255).astype(np.uint8)

        buf_io = io.BytesIO()
        Image.fromarray(np.stack([r, g, b], axis=2)).save(buf_io, format='JPEG', quality=75)
        encoded = base64.b64encode(buf_io.getvalue()).decode('utf-8')
        print(f"[Camera] Frame captured: {w}x{h} → {tw}x{th}, {len(encoded)//1024}KB b64")
        return encoded

    except Exception as e:
        print(f"[Camera] Capture error: {e}")
        return None

# Set this to your Delamain backend WebSocket URL.
# Can also be set via environment variable: DELAMAIN_WS_URL
DELAMAIN_WS_URL = os.environ.get("DELAMAIN_WS_URL", "wss://your-delamain-host/ws/sunnypilot-bridge")
TELEMETRY_HZ    = 2   # telemetry pushes per second

MPS_TO_MPH = lambda mps: mps * 2.23694

EVENT_COOLDOWNS = {
    "hard_brake":              12,
    "very_hard_brake":          5,
    "rapid_accel":             20,
    "lane_change_left":         8,
    "lane_change_right":        8,
    "lead_car_close":          20,
    "lead_car_very_close":      8,
    "high_speed":              90,
    "acc_engaged":              5,
    "acc_disengaged":           5,
    "stopped_in_traffic":     120,
    "seatbelt_off":            30,
    "sp_alert_critical":        0,   # always speak — no cooldown
    "sp_alert_user":           30,
    "speeding":                90,
    "steer_override":          15,
    "personality_change":       5,
    "thermal_warning":        120,
    "session_start_morning":    0,
    "session_start_day":        0,
    "session_start_evening":    0,
    "session_start_night":      0,
    "drive_20min":              0,
    "drive_45min":              0,
    "drive_90min":              0,
}

PERSONALITY_NAMES = {0: "aggressive", 1: "standard", 2: "relaxed"}

# msgq shared-memory layout (matches msgq_header_t in msgq.h with NUM_READERS=15)
_MSGQ_OFFSET_WP   = 8    # write_pointer field (bytes from shm start)
_MSGQ_OFFSET_DATA = 384  # ring-buffer start: 3 uint64s + 3*15 uint64s = 384 bytes
_MSGQ_SLOT_BYTES  = 8    # bytes per ring-buffer slot (uint64-aligned)


def _wait_for_network(host: str = "delamain.genysis.xyz", timeout: int = 120) -> None:
    print("[Delamain] waiting for network...")
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        try:
            socket.getaddrinfo(host, 443)
            print("[Delamain] network ready")
            return
        except OSError:
            time.sleep(5)
    print("[Delamain] network wait timed out, continuing anyway")


def _wait_for_openpilot(timeout: int = 120) -> None:
    import subprocess
    print("[Delamain] waiting for openpilot controlsd...")
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        result = subprocess.run(["pgrep", "-f", "selfdrive.controls.controlsd"],
                                capture_output=True)
        if result.returncode == 0:
            print("[Delamain] openpilot ready")
            # Extra buffer so publishers fully initialize their msgq shm files
            time.sleep(5)
            return
        time.sleep(3)
    print("[Delamain] openpilot wait timed out, continuing anyway")


class MsgqReader:
    """Read from a msgq topic without registering as a reader.

    Opens /dev/shm/msgq_<topic> read-only and tracks the write_pointer to
    detect new messages. Never writes to shared memory — openpilot's reader
    slot counts are completely unaffected regardless of restarts or crashes.
    """

    def __init__(self, topic: str):
        self._topic = topic
        self._path = f"/dev/shm/msgq_{topic}"
        self._mm: mmap.mmap | None = None
        self._buf_slots: int = 1  # computed from shm size on open
        self._last_wp: int | None = None
        self._reopen()

    def _reopen(self) -> None:
        if self._mm is not None:
            try:
                self._mm.close()
            except Exception:
                pass
            self._mm = None
        try:
            fd = os.open(self._path, os.O_RDONLY)
            sz = os.fstat(fd).st_size
            self._mm = mmap.mmap(fd, sz, access=mmap.ACCESS_READ)
            os.close(fd)
            # Ring-buffer slot count derived from file size (varies per topic)
            self._buf_slots = max(1, (sz - _MSGQ_OFFSET_DATA) // _MSGQ_SLOT_BYTES)
            self._last_wp = None
            print(f"[Delamain] mmap opened: {self._path} ({sz} bytes, {self._buf_slots} slots)")
        except OSError as e:
            print(f"[Delamain] mmap open {self._topic}: {e}")

    def _u64(self, offset: int) -> int:
        self._mm.seek(offset)
        return struct.unpack('<Q', self._mm.read(8))[0]

    def recv_next(self) -> bytes | None:
        """Return the next unread message as raw bytes, or None if none pending."""
        if self._mm is None:
            self._reopen()
            return None
        try:
            wp = self._u64(_MSGQ_OFFSET_WP)

            if self._last_wp is None:
                self._last_wp = wp
                return None

            if wp == self._last_wp:
                return None

            # Detect shm recreation (write_pointer went backwards)
            if wp < self._last_wp:
                print(f"[Delamain] {self._topic} shm recreated, reopening")
                self._reopen()
                return None

            # If we fell far behind (ring buffer nearly lapped), jump ahead
            if wp - self._last_wp > self._buf_slots // 2:
                self._last_wp = wp - 4
                return None

            # Read message starting at self._last_wp slot index
            slot = self._last_wp % self._buf_slots
            msg_size = self._u64(_MSGQ_OFFSET_DATA + slot * _MSGQ_SLOT_BYTES)

            if msg_size == 0 or msg_size > 65536:
                # Garbage data — jump to current write pointer
                self._last_wp = wp
                return None

            slots_for_data = (msg_size + _MSGQ_SLOT_BYTES - 1) // _MSGQ_SLOT_BYTES

            # Read capnp bytes, handling ring-buffer wrap-around slot by slot
            buf = bytearray(msg_size)
            remaining = msg_size
            si = (slot + 1) % self._buf_slots
            pos = 0
            while remaining > 0:
                chunk = min(_MSGQ_SLOT_BYTES, remaining)
                self._mm.seek(_MSGQ_OFFSET_DATA + si * _MSGQ_SLOT_BYTES)
                buf[pos:pos + chunk] = self._mm.read(chunk)
                pos += chunk
                remaining -= chunk
                si = (si + 1) % self._buf_slots

            self._last_wp += 1 + slots_for_data
            return bytes(buf)

        except Exception as e:
            print(f"[Delamain] msgq read {self._topic}: {e}")
            self._last_wp = None
            return None

    def close(self) -> None:
        if self._mm:
            self._mm.close()
            self._mm = None


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
        self._prev_steer_pressed = False
        self.stopped_since: float | None = None
        self.current_speed_mps   = 0.0
        self.last_gps            = None
        self._pending_acc_engaged: dict | None = None   # deferred until cruise speed non-zero
        self._acc_speed_wait_start: float = 0.0

        # Sunnypilot state
        self.sp_enabled      = False
        self.prev_personality = -1   # -1 = not yet known
        self.prev_alert_text  = ""

        # Speed limit from liveMapDataSP
        self.speed_limit_mph = 0.0

        # Session / drive milestones
        self.session_started    = False
        self.drive_start_time: float | None = None
        self.last_milestone_min = 0

        # Car identity loaded at startup
        self.car_info: dict = self._load_car_identity()

    # ------------------------------------------------------------------ helpers

    def _load_car_identity(self) -> dict:
        try:
            from openpilot.common.params import Params
            from cereal import car as cereal_car
            data = Params().get("CarParamsCache")
            if not data:
                return {}
            with cereal_car.CarParams.from_bytes(data) as cp:
                return {"brand": str(cp.brand), "fingerprint": str(cp.carFingerprint)}
        except Exception as e:
            print(f"[Delamain] car identity: {e}")
        return {}

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

    # ---------------------------------------------------------- carState handler

    def on_car_state(self, cs) -> None:
        speed_mph = MPS_TO_MPH(cs.vEgo)
        self.current_speed_mps = cs.vEgo
        accel = cs.aEgo

        # Session start on first movement
        if not self.session_started and speed_mph > 2:
            self.session_started = True
            self.drive_start_time = time.monotonic()
            hour = datetime.datetime.now().hour
            if 5 <= hour < 12:
                tod = "morning"
            elif 12 <= hour < 17:
                tod = "day"
            elif 17 <= hour < 21:
                tod = "evening"
            else:
                tod = "night"
            self.fire(f"session_start_{tod}")

        # Braking
        if speed_mph > 10:
            if accel < -7.0:
                self.fire("very_hard_brake", {"decel": round(accel, 1), "speed_mph": round(speed_mph)})
            elif accel < -4.0:
                self.fire("hard_brake",      {"decel": round(accel, 1), "speed_mph": round(speed_mph)})

        # Rapid acceleration
        if accel > 4.0 and speed_mph > 5:
            self.fire("rapid_accel", {"accel": round(accel, 1), "speed_mph": round(speed_mph)})

        # High speed
        if speed_mph > 90:
            self.fire("high_speed", {"speed_mph": round(speed_mph)})

        # Speeding (>10 mph over posted limit)
        if self.speed_limit_mph > 0 and speed_mph > self.speed_limit_mph + 10:
            self.fire("speeding", {"speed_mph": round(speed_mph), "limit_mph": round(self.speed_limit_mph)})

        # Lane changes — rising edge only, not while parking
        if speed_mph > 20:
            if cs.leftBlinker  and not self.prev_left_blinker:
                self.fire("lane_change_left",  {"speed_mph": round(speed_mph)})
            if cs.rightBlinker and not self.prev_right_blinker:
                self.fire("lane_change_right", {"speed_mph": round(speed_mph)})

        # Steer override — driver touched wheel while SP active
        steer_pressed = cs.steeringPressed
        if steer_pressed and not self._prev_steer_pressed and self.sp_enabled:
            self.fire("steer_override", {"speed_mph": round(speed_mph)})
        self._prev_steer_pressed = steer_pressed

        # ACC state transitions
        acc = cs.cruiseState.enabled
        if acc and not self.prev_acc_enabled:
            # cruiseState.speed may be 0 on the first frame — defer until populated
            self._pending_acc_engaged = {"speed_mph": round(speed_mph)}
            self._acc_speed_wait_start = time.monotonic()
        if not acc and self.prev_acc_enabled:
            self._pending_acc_engaged = None
            self.fire("acc_disengaged", {"speed_mph": round(speed_mph)})

        # Flush deferred acc_engaged once cruise speed is non-zero (or after 3 s timeout)
        if self._pending_acc_engaged is not None and acc:
            cruise_mph = round(MPS_TO_MPH(cs.cruiseState.speed))
            timed_out  = time.monotonic() - self._acc_speed_wait_start > 3.0
            if cruise_mph > 0 or timed_out:
                self._pending_acc_engaged["cruise_mph"] = cruise_mph
                self.fire("acc_engaged", self._pending_acc_engaged)
                self._pending_acc_engaged = None

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
            # Suppress the less-severe alert so both don't fire back-to-back
            self._last_event_time["lead_car_close"] = time.monotonic()
            self.fire("lead_car_very_close", {"distance_m": round(d, 1), "speed_mph": round(speed_mph)})
        elif d < 15 and speed_mph > 25:
            self.fire("lead_car_close",      {"distance_m": round(d, 1), "speed_mph": round(speed_mph)})

    def on_gps(self, gps) -> None:
        self.last_gps = {"lat": gps.latitude, "lon": gps.longitude, "bearing": gps.bearingDeg}

    def on_selfdrive_state(self, sds) -> None:
        self.sp_enabled = sds.enabled

        # Personality change detection
        try:
            personality = int(sds.personality.raw)
        except Exception:
            personality = -1

        if personality >= 0 and self.prev_personality >= 0 and personality != self.prev_personality:
            name = PERSONALITY_NAMES.get(personality, "standard")
            self.fire("personality_change", {"personality": name})
        if personality >= 0:
            self.prev_personality = personality

        # SP alerts — fire only when alert text changes (rising edge on new alert)
        try:
            status = int(sds.alertStatus.raw)  # 0=normal, 1=userPrompt, 2=critical
            text1  = str(sds.alertText1).strip()
        except Exception:
            return

        if text1 and text1 != self.prev_alert_text:
            self.prev_alert_text = text1
            if status == 2:
                self.fire("sp_alert_critical", {"text": text1})
            elif status == 1:
                self.fire("sp_alert_user", {"text": text1})
        elif not text1:
            self.prev_alert_text = ""

    def on_map_data(self, lmd) -> None:
        try:
            valid = bool(lmd.speedLimitValid)
            raw   = float(lmd.speedLimit)
            if valid and raw > 0:
                mph = MPS_TO_MPH(raw)
                # Sanity: m/s conversion should yield 5–90 mph for normal roads.
                # If out of range, the value is likely already in mph — use directly.
                if 5.0 <= mph <= 90.0:
                    self.speed_limit_mph = mph
                elif 5.0 <= raw <= 90.0:
                    self.speed_limit_mph = raw   # already in mph
                else:
                    print(f"[MapData] unexpected speedLimit raw={raw:.2f}, skipping")
                    self.speed_limit_mph = 0.0
                print(f"[MapData] speedLimit raw={raw:.2f} → {self.speed_limit_mph:.1f} mph (valid={valid})")
            else:
                self.speed_limit_mph = 0.0
        except Exception as e:
            print(f"[MapData] read error: {e}")
            self.speed_limit_mph = 0.0

    def on_device_state(self, ds) -> None:
        try:
            thermal = int(ds.thermalStatus.raw)  # 0=green,1=yellow,2=red,3=danger
            if thermal >= 2:
                temps = list(ds.cpuTempC)
                max_temp = max(temps) if temps else 0
                label = "danger" if thermal >= 3 else "red"
                self.fire("thermal_warning", {"temp_c": round(max_temp), "status": label})
        except Exception:
            pass

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
        if cs.cruiseState.enabled:
            data["cruise_speed_mph"] = round(MPS_TO_MPH(cs.cruiseState.speed), 1)
        if self.speed_limit_mph > 0:
            data["speed_limit_mph"] = round(self.speed_limit_mph, 1)
        if self.last_gps:
            data.update(self.last_gps)
        self._send({"type": "vehicle_state", "data": data})

    # ------------------------------------------------------ websocket lifecycle

    def _ws_thread(self) -> None:
        backoff = 5
        while True:
            try:
                print(f"[Delamain] connecting to {DELAMAIN_WS_URL} ...")

                def on_open(ws_app):
                    self.ws_connected = True
                    print("[Delamain] WebSocket connected")
                    if self.car_info:
                        try:
                            ws_app.send(json.dumps({"type": "car_identity", "data": self.car_info}))
                            print(f"[Delamain] car identity sent: {self.car_info}")
                        except Exception as e:
                            print(f"[Delamain] car identity send error: {e}")

                def on_close(ws, code, msg):
                    self.ws_connected = False
                    print(f"[Delamain] WebSocket closed ({code})")

                def on_error(ws, err):
                    self.ws_connected = False
                    print(f"[Delamain] WebSocket error: {err}")

                def on_message(ws, msg):
                    try:
                        data = json.loads(msg)
                    except Exception:
                        return
                    if data.get("type") == "request_snapshot":
                        frame_b64 = _capture_road_frame()
                        try:
                            ws.send(json.dumps({"type": "snapshot_data", "data": frame_b64}))
                        except Exception as e:
                            print(f"[Camera] Snapshot send error: {e}")

                with self.ws_lock:
                    self.ws = websocket.WebSocketApp(
                        DELAMAIN_WS_URL,
                        on_open=on_open,
                        on_close=on_close,
                        on_error=on_error,
                        on_message=on_message,
                    )
                self.ws.run_forever(ping_interval=30, ping_timeout=20)
                backoff = 5
            except Exception as e:
                print(f"[Delamain] connection failed: {e}")
            self.ws_connected = False
            print(f"[Delamain] retrying in {backoff}s...")
            time.sleep(backoff)
            backoff = min(backoff * 2, 60)

    # ---------------------------------------------------------------------- run

    def run(self) -> None:
        _wait_for_openpilot()
        _wait_for_network()
        if self.car_info:
            print(f"[Delamain] car identity: {self.car_info}")
        threading.Thread(target=self._ws_thread, daemon=True).start()
        time.sleep(2)

        readers = {
            'carState':              MsgqReader('carState'),
            'radarState':            MsgqReader('radarState'),
            'gpsLocationExternal':   MsgqReader('gpsLocationExternal'),
            'selfdriveState':        MsgqReader('selfdriveState'),
            'liveMapDataSP':         MsgqReader('liveMapDataSP'),
            'deviceState':           MsgqReader('deviceState'),
        }

        def _shutdown(signum, frame):
            print(f"[Delamain] caught signal {signum}, shutting down")
            for r in readers.values():
                r.close()
            sys.exit(0)

        signal.signal(signal.SIGTERM, _shutdown)
        signal.signal(signal.SIGINT, _shutdown)

        rk = Ratekeeper(20, print_delay_threshold=0.1)
        telemetry_interval = 1.0 / TELEMETRY_HZ
        last_telemetry = 0.0
        last_cs = None
        _decode_err_count: dict[str, int] = {}
        _decode_err_logged: dict[str, float] = {}

        while True:
            for topic, reader in readers.items():
                while True:
                    raw = reader.recv_next()
                    if raw is None:
                        break
                    try:
                        event = log_from_bytes(raw)
                        which = event.which()
                        if which == 'carState':
                            cs = event.carState
                            self.on_car_state(cs)
                            last_cs = cs
                        elif which == 'radarState':
                            self.on_radar_state(event.radarState)
                        elif which == 'gpsLocationExternal':
                            self.on_gps(event.gpsLocationExternal)
                        elif which == 'selfdriveState':
                            self.on_selfdrive_state(event.selfdriveState)
                        elif which == 'liveMapDataSP':
                            self.on_map_data(event.liveMapDataSP)
                        elif which == 'deviceState':
                            self.on_device_state(event.deviceState)
                        _decode_err_count[topic] = 0
                    except Exception as e:
                        _decode_err_count[topic] = _decode_err_count.get(topic, 0) + 1
                        now = time.monotonic()
                        if now - _decode_err_logged.get(topic, 0) > 60:
                            print(f"[Delamain] decode error {topic} (x{_decode_err_count[topic]}): {e}")
                            _decode_err_logged[topic] = now

            # Drive milestones
            if self.drive_start_time is not None:
                elapsed_min = (time.monotonic() - self.drive_start_time) / 60
                for milestone in (20, 45, 90):
                    if elapsed_min >= milestone > self.last_milestone_min:
                        self.last_milestone_min = milestone
                        self.fire(f"drive_{milestone}min", {"minutes": milestone})

            if last_cs is not None and time.monotonic() - last_telemetry >= telemetry_interval:
                self.send_telemetry(last_cs)
                last_telemetry = time.monotonic()

            rk.keep_time()


if __name__ == "__main__":
    DelamainBridge().run()
