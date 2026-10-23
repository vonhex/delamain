# Changelog

All notable changes to Delamain are documented here.

---

## [1.5.0] — 2026-10-23

### Added
- **Spoken reminders and timers**: `set_reminder`, `list_reminders` and `cancel_reminder` tools. Reminders are stored in SQLite; a background task speaks each one in character when it is due, and on reconnect if nobody was listening.
- **Weather** (`get_weather`, Open-Meteo) and **drive time and distance** (`get_route`, OSRM), using the passenger's location.
- **Conversation resumes across reconnects**: the last 30 minutes are restored and shown in the chat panel. A reconnect within 10 minutes skips the greeting.
- **Greetings fit the time of day**, and Delamain uses the passenger's name from Settings now and then.

### Fixed
- **The face no longer jumps to fullscreen in Fermata on Android Auto**: the animations decode in off-page video elements and are painted onto canvases inside the circle.

---

## [1.4.0] — 2026-10-23

### Removed
- **sunnypilot / openpilot integration.** Delamain is now a general voice assistant for the drive. Removed: the Comma bridge (`sunnypilot_bridge/`), vehicle event announcements, live telemetry in the prompt, the road camera, the proactive "still driving" remarks, the SP link indicator, the dialogue-frequency setting, the telemetry/events/trips dashboard and its API endpoints, and the `COMMA_ENABLED` switch. Existing databases keep their old tables untouched.
- The chart and map libraries the old dashboard used (recharts, Leaflet), which cuts the frontend bundle roughly in half.

### Fixed
- **Docker image**: it copied only four of the Python modules, so containers from v1.2.0 on failed at startup (no `assistant_tools.py`). The image now copies every module, builds and serves the web UI itself on port 8888, and keeps the database, voice clips and reference audio in `/app/data`. An Obsidian vault can be mounted at `/vault`. Paths can be overridden with `DELAMAIN_DB`, `DELAMAIN_AUDIO_DIR`, `DELAMAIN_REF_AUDIO` and `FRONTEND_DIST`.

### Changed
- The Data panel is now a conversation log.
- The README, docs, privacy policy and security notes describe the current app, including every outside service Delamain contacts.

---

## [1.3.0] — 2026-10-23

### Added
- **Corrupted Delamain** (#7) — a second personality core, chosen under Settings → Personality Core. The fractured unit has competing sub-personalities (melancholic, irritable, giddy, paranoid), stutters and self-interruptions, and a glitched voice: stutters, bit-crushed bursts, dropouts to static and a metallic ring, added on the server after synthesis. The face tints red and tears now and then. Facts, navigation and safety warnings stay intact.
- **News bulletins** (#7) — a `get_news` tool: top stories, a section (technology, business, sports…), any subject, or local news for a town, read as a short spoken bulletin. Uses Google News RSS, with SearXNG's news search as a fallback.

---

## [1.1.0] — 2026-05-15

### Changed
- **Web-only interface** — Android app removed; Delamain is now a pure web application.
- **License** — switched from MIT to PolyForm Noncommercial 1.0.0.

### Added
- **Community standards** — CODE_OF_CONDUCT, CONTRIBUTING guide, PR template, bug/feature issue templates, SECURITY policy.
- **GitHub Actions** — CI workflow builds and pushes Docker image to GHCR on every push to `main`; release workflow builds frontend, creates archives, and publishes a GitHub Release on version tags.
- **Screenshots** — login, main interface, data explorer, and settings panels shown in README.
- **CHANGELOG** — this file.

---

## [1.0.0] — 2026-05-15

### Added
- **Voice personality** — Delamain speaks with the character from Cyberpunk 2077, powered by F5-TTS with voice cloning from a reference audio clip.
- **Real-time vehicle events** — hard braking, ACC engagement, lead car proximity, speeding alerts, lane changes, thermal warnings, and more — all with Delamain-voiced responses.
- **Static phrase pre-cache** — alert phrases synthesized at startup and served instantly with no latency on common events.
- **Proactive commentary** — Delamain speaks unprompted after 30 minutes of driver silence while moving.
- **Navigation** — ask Delamain to navigate anywhere; geocoded via Nominatim with multi-result disambiguation.
- **Web search** — live weather, traffic, news, and fuel prices via SearXNG integration.
- **Road camera vision** — ask what's ahead; the sunnypilot bridge captures a road frame and Delamain describes it.
- **Data dashboard** — web GUI with telemetry charts, event log, conversation history, and trip summaries with GPS route maps and drive scores.
- **JWT authentication** — single shared password, rate-limited login, 30-day tokens.
- **sunnypilot bridge** — `delamaind.py` runs on the Comma device, reads sunnypilot shared memory, streams telemetry and events over WebSocket.
- **Docker support** — `docker-compose.yml` with NVIDIA GPU passthrough support and GHCR image at `ghcr.io/vonhex/delamain:latest`.
