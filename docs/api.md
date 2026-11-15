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

### `GET /api/setup`, `POST /api/setup`

No auth. A fresh install has no password: `GET` returns `{ "needs_password": true }`, and `POST { "password": "..." }` (at least 8 characters, 5 requests/minute) sets it and returns `{ "token": "eyJ..." }`. Once a password is set, `POST` returns 409.

---

### `GET /api/config`, `PUT /api/config`

JWT required. The server settings shown under Settings → Integrations.

`GET` returns `settings` (per key: `value`, `source` of `settings`, `env` or `default`, `label`, `default`, `choices`) and `status` (`voice_model`, `voice_reference`, `line_clips`, `lines`).

`PUT` takes `{ "<key>": "<value>", ... }` for any of `llm_url`, `llm_model`, `llm_api_key`, `llm_reasoning_effort`, `tools_enabled`, `searxng_url`, `obsidian_vault_path`, `news_rss_url`, `osrm_url`, `units`, saves them to `settings.json` and returns the same shape as `GET`. An empty URL or path resets it to the environment value or the default. Invalid values return 400 with the reason in `detail`.

`llm_api_key` is write-only: `GET` and `PUT` always return its `value` as `""`, with `secret: true` and `is_set` saying whether one is in use. Sending `""` removes a key saved here (a key from `LLM_API_KEY` stays).

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

### `GET /api/brain/snapshot`

The Brain view's state: what he is doing, today's counts, the last 40 events and the LLM
server's speed (when it publishes `/metrics`).

```json
{
  "state": { "phase": "thinking", "persona": "delamain", "clients": 1, "since": 1794700000.1, "dungeon": null },
  "today": { "day": "2026-11-14", "heard": 12, "replies": 14, "reflexes": 3, "llm_rounds": 19,
             "tokens_in": 98000, "tokens_out": 1200, "think_ms": 41000, "tools": { "get_weather": 2 },
             "corrections": 1, "voice_ms": 18000, "routes": 1, "reminders": 0 },
  "recent": [ { "seq": 41, "t": 1794700000.1, "kind": "think_start", "round": 0, "source": "reply" } ],
  "metrics": { "available": true, "tps": 61.2, "busy": true },
  "tool_regions": { "web_search": "senses", "get_route": "navigation" },
  "llm_model": "qwen3:8b"
}
```

---

### `GET /api/brain/model`

The real parts behind the Brain view's nodes, read from the model files' headers when they are on this
computer (`model_map.py`): for the language model and the voice model, each part's kind (`embedding`,
`attention`, `linear_attention`, `router`, `shared`, `experts`, `ffn`, `output`, `drafter`, `voice_block`…),
its layer, weight count and largest tensors. Missing files come back as `llm_error` / `voice_error`.

```json
{ "llm": { "file": "model.gguf", "format": "gguf", "layers": 48, "total": 128350804643, "experts": 512,
           "units": [ { "kind": "experts", "layer": 5, "weights": 2516582400,
                        "tensors": [ { "name": "layers.5.mlp.experts.gate_up_proj.weight", "shape": [512, 1280, 2560] } ] } ] },
  "voice": { "file": "model_1200000.pt", "total": 337149162, "blocks": 22, "units": [ ... ] } }
```

---

### `GET /api/brain/events?token=`

The Brain view's live feed, as Server-Sent Events. The browser's `EventSource` cannot send
headers, so the JWT goes in the query string, as for the WebSocket. It sends one
`event: snapshot` (the object above), then each event as a plain `data:` line, and an
`event: metrics` every few quiet seconds. The events and their fields are listed in
[brain.md](brain.md#how-it-works).

```
event: snapshot
data: {"state": {...}, "today": {...}, ...}

data: {"seq":42,"t":1794700002.3,"kind":"think_end","round":0,"source":"reply","ok":true,"calls":["get_weather"],"ms":2200,"prompt_tokens":5120,"completion_tokens":48,"tps":58.2}

data: {"seq":43,"t":1794700002.4,"kind":"tool_start","name":"get_weather","region":"senses"}
```

---

## WebSocket: `/ws/{client_id}?token=&persona=`

`resume=1` marks an automatic reconnect after the link dropped: no greeting is sent. `persona` is optional: `delamain` (default), `merged`, `corrupted`, `wellsprings`, `glen`, `north_oak`, `coastview`, `rancho_coronado`, `northside` or `badlands`. It sets the personality core from the first message, the greeting included. `user_name` is optional and is used in greetings and replies.

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
{ "type": "greeting", "text": "Delamain online...", "audio_url": "/audio/xyz.wav", "video_url": null }
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

**Pre-recorded reply**: everyday messages ("thanks", "tell me a joke", "combat mode") get a fixed line at once, as a `response` with `"source": "canned"`.

**Reminder** (unprompted, when a reminder is due): a `response` with `"source": "reminder"`.

**Error**: when a reply fails, a spoken apology arrives as a `response` with `"source": "error"`.

`video_url` is set on greetings, "one moment" lines, pre-recorded replies and error lines when a lip-synced clip exists for that exact line (`/lines/<clip id>.mp4`), and is `null` otherwise. With a clip, `audio_url` is the clip's soundtrack (`/lines/<clip id>.wav`).

Every message with `audio_url` also carries `speech_at`: the seconds of silence before the voice starts in that file. The page holds the talking glow and talking loops until the audio reaches it.

**Pong:**
```json
{ "type": "pong" }
```

`navigate_options` is an array of `{ name, address, lat, lon }` when Delamain has geocoded a navigation request, or `{ name, address, query }` when geocoding found nothing and the map app should search by text. Audio for a core with a voice profile ends in `_<core>.wav`, for example `_wellsprings.wav`.
