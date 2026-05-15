# API Reference

Base URL: `http://your-server:8888`

## Authentication

All data and chat endpoints require a JWT token obtained from `/api/login`.

Pass it as a Bearer token:
```
Authorization: Bearer <token>
```

For WebSocket: pass as query param: `/ws/{client_id}?token=<token>`

The `sunnypilot-bridge` client ID is exempt from auth (LAN-only bridge).

---

## Endpoints

### `POST /api/login`

Rate-limited: 10 requests/minute per IP.

**Request:**
```json
{ "password": "yourpassword" }
```

**Response:**
```json
{ "token": "eyJ..." }
```

Tokens expire after 30 days.

---

### `GET /health`

No auth required.

```json
{ "status": "operational", "persona": "Delamain", "clients": 2 }
```

---

### `GET /api/data/telemetry`

**Query params:**
- `since` — Unix timestamp (default: 0)
- `limit` — max rows (default: 2000)

**Response:** Array of telemetry rows ordered by timestamp ascending.

```json
[
  {
    "ts": 1748000000.0,
    "speed_mph": 45.2,
    "cruise_mph": 50.0,
    "acc_active": 1,
    "lead_dist_m": 32.5,
    "speed_limit_mph": 45.0,
    "lat": 37.7749,
    "lon": -122.4194
  }
]
```

---

### `GET /api/data/events`

**Query params:**
- `since`, `limit`, `event` (filter by event name)

```json
[
  {
    "ts": 1748000100.0,
    "event": "hard_brake",
    "data": { "decel": -4.8, "speed_mph": 52 },
    "response": "Substantial deceleration. I trust the situation is under control."
  }
]
```

---

### `GET /api/data/conversations`

**Query params:** `since`, `limit`

```json
[
  { "ts": 1748000200.0, "role": "user", "content": "What's the traffic like?", "audio_url": null },
  { "ts": 1748000205.0, "role": "assistant", "content": "Traffic is cooperating...", "audio_url": "/audio/abc.wav" }
]
```

---

### `GET /api/data/event-counts`

**Query params:** `since`

```json
[
  { "event": "lead_car_close", "count": 12 },
  { "event": "hard_brake", "count": 3 }
]
```

---

### `GET /api/data/trips`

**Query params:** `limit` (default: 20)

Trips are segmented from telemetry by 5-minute gaps in data. Drive score starts at 100 and deducts for dangerous events.

```json
[
  {
    "start_ts": 1748000000.0,
    "end_ts": 1748003600.0,
    "duration_min": 60.0,
    "avg_speed": 38.5,
    "max_speed": 72.0,
    "acc_pct": 45,
    "score": 85,
    "events": { "hard_brake": 2, "speeding": 1 },
    "route": [{ "lat": 37.77, "lon": -122.41 }, ...],
    "center": { "lat": 37.78, "lon": -122.42 }
  }
]
```

**Drive score deductions:**
- `very_hard_brake` × 15 (max 30)
- `hard_brake` × 5 (max 20)
- `lead_car_very_close` × 10 (max 25)
- `lead_car_close` × 3 (max 15)
- `speeding` × 5 (max 20)

---

## WebSocket: `/ws/{client_id}?token=`

### Client → Server messages

**Talk:**
```json
{ "type": "talk", "text": "What is the speed limit here?", "user_name": "V" }
```

**Ping:**
```json
{ "type": "ping" }
```

### Server → Client messages

**Greeting** (on connect):
```json
{ "type": "greeting", "text": "Delamain online...", "audio_url": "/audio/xyz.wav" }
```

**Response** (to talk, vehicle event, or proactive):
```json
{
  "type": "response",
  "text": "The speed limit is 45 miles per hour.",
  "audio_url": "/audio/xyz.wav",
  "source": "talk",
  "navigate_options": []
}
```

**SP status:**
```json
{ "type": "sp_status", "connected": true }
```

**Pong:**
```json
{ "type": "pong" }
```

`navigate_options` is an array of `{ name, address, lat, lon }` when Delamain has geocoded a navigation request.
