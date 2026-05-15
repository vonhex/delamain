# sunnypilot Bridge

The bridge daemon (`delamaind.py`) runs on the Comma device and connects to the Delamain backend over WebSocket. It is maintained in a separate repository:

**→ [vonhex/delamain-sp-bridge](https://github.com/vonhex/delamain-sp-bridge)**

## Quick summary

1. Set `DELAMAIN_WS_URL` in the script to point at your backend
2. SSH into your Comma 4 and copy `delamaind.py` to `/data/delamain/`
3. Start the bridge with `PYTHONPATH=/data/openpilot /usr/local/venv/bin/python3 /data/delamain/delamaind.py`
4. The SP status indicator in the Delamain web UI turns green when connected

Full installation instructions with persistent startup, troubleshooting, and driver monitoring disable are in the bridge repo README.

## What data flows

| Direction | Data |
|---|---|
| Bridge → Backend | `vehicle_state` (2 Hz): speed, ACC, GPS, steering, lead distance |
| Bridge → Backend | `vehicle_event`: hard brake, lane change, ACC engage, speeding, etc. |
| Bridge → Backend | `snapshot_data`: JPEG frame from road camera (on demand) |
| Backend → Bridge | `request_snapshot`: triggers road camera capture |

## Events fired

| Event | Condition |
|---|---|
| `session_start_{morning\|day\|evening\|night}` | First movement after startup |
| `hard_brake` | Decel < −4 m/s² at > 10 mph |
| `very_hard_brake` | Decel < −7 m/s² at > 10 mph |
| `rapid_accel` | Accel > 4 m/s² at > 5 mph |
| `lead_car_close` | Lead vehicle < 15 m at > 25 mph |
| `lead_car_very_close` | Lead vehicle < 8 m at > 15 mph |
| `high_speed` | Speed > 90 mph |
| `speeding` | Speed > posted limit + 10 mph |
| `acc_engaged` / `acc_disengaged` | Cruise state transitions |
| `lane_change_left` / `lane_change_right` | Blinker rising edge at > 20 mph |
| `steer_override` | Driver touches wheel while SP active |
| `stopped_in_traffic` | < 1 mph for > 10 seconds |
| `seatbelt_off` | Seatbelt unlatched at > 5 mph |
| `sp_alert_critical` / `sp_alert_user` | sunnypilot alert status changes |
| `personality_change` | Driving personality mode changes |
| `thermal_warning` | Device thermal status ≥ red |
| `drive_20min` / `drive_45min` / `drive_90min` | Drive duration milestones |
