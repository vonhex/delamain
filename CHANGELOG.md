# Changelog

All notable changes to Delamain are documented here.

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
