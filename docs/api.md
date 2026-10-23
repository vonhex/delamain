# API Reference

Base URL: `http://your-server:8888`

## Authentication

All data and chat endpoints require a JWT token obtained from `/api/login`.

Pass it as a Bearer token:
```
Authorization: Bearer <token>
```

For WebSocket: pass as query param: `/ws/{client_id}?token=<token>`

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

### `GET /api/data/conversations`

**Query params:** `since`, `limit`

```json
[
  { "ts": 1748000200.0, "role": "user", "content": "What's the traffic like?", "audio_url": null },
  { "ts": 1748000205.0, "role": "assistant", "content": "Traffic is cooperating...", "audio_url": "/audio/abc.wav" }
]
```

---

## WebSocket: `/ws/{client_id}?token=&persona=`

`persona` is optional: `delamain` (default) or `corrupted`. It sets the personality core from the first message, the greeting included. `user_name` is optional and is used in greetings and replies.

### Client → Server messages

**Talk:** `location` is optional and is used for "near me" questions and local news.
```json
{ "type": "talk", "text": "Read me the news.", "user_name": "V", "location": { "lat": 39.74, "lon": -104.99 } }
```

**Switch personality core:** clears the conversation history so the new voice starts clean.
```json
{ "type": "persona", "persona": "corrupted" }
```

**Ping:**
```json
{ "type": "ping" }
```

### Server → Client messages

**History** (on connect, when there was conversation in the last 30 minutes):
```json
{ "type": "history", "messages": [{ "role": "user", "content": "..." }, { "role": "assistant", "content": "..." }] }
```

**Greeting** (on connect; skipped when the last message was under 10 minutes ago):
```json
{ "type": "greeting", "text": "Delamain online...", "audio_url": "/audio/xyz.wav" }
```

**Response** (to talk). While tools run, a short line with `"source": "working"` ("One moment.") arrives first, then the reply:
```json
{
  "type": "response",
  "text": "Plotting a course to Union Station.",
  "audio_url": "/audio/xyz.wav",
  "navigate_options": [{ "name": "Union Station", "address": "Wynkoop Street, Denver", "lat": "39.75", "lon": "-105.00" }]
}
```

**Reminder** (unprompted, when a reminder is due): a `response` with `"source": "reminder"`.

**Error:**
```json
{ "type": "error", "detail": "..." }
```

**Pong:**
```json
{ "type": "pong" }
```

`navigate_options` is an array of `{ name, address, lat, lon }` when Delamain has geocoded a navigation request, or `{ name, address, query }` when geocoding found nothing and the map app should search by text. Audio for the corrupted core ends in `_corrupted.wav`.
