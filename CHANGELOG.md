# Changelog

All notable changes to Delamain are documented here.

---

## [Unreleased]

### Added
- **Runs from a fresh clone**: the F5-TTS weights download from Hugging Face on first start, the lip-synced clips download from the `line-clips` release (and refresh when it changes; clips imported by hand are never replaced), and the Docker image bundles the reference voice. The backend serves the built web UI itself, so one command starts everything.
- **First-start password**: a new install asks for a password on the login page instead of needing `auth.py set-password`.
- **Settings → Integrations**: the LLM endpoint, model and reasoning effort, tools, SearXNG, Obsidian vault, news, routing and units are set in the web UI and saved on the server (`settings.json`), ahead of `.env`, which is now optional. A vault must be an existing folder with a `.obsidian` folder in it. The panel also shows whether the voice model, reference voice and clips are installed. The client-side "LLM core URL" field, which the server ignored, is gone.
- New README screenshots: desktop, phone, car display, the ten cores, settings and the first-start screen.
- **More idles, picked up by name**: `import_clips.py` writes `frontend/public/animations.json`, and the face adds any installed clip to its pools without a code change:
  - `delamain_blink_<n>`, `delamain_turn_<n>`, `delamain_random_<n>` and `delamain_bored_<n>` join the original core's idles;
  - `delamain_rare_<name>` adds rare clips;
  - `delamain_night_<n>` plays some of the time between 22:00 and 05:00;
  - `delamain_listen_<n>` plays while the mic is open, `delamain_think_<n>` while a reply is on its way, and `delamain_angry_<n>` replaces the glitch flip when he is insulted;
  - `<core>_idle_<n>` (for example `glen_idle_3`) gives a rogue core its own idles, played about 70% of the time in that core.

### Fixed
- **Wordmark cut off on car displays**: the face had fixed sizes, so on short screens the panel overflowed and the top was cut off. The face is now sized from the space its panel actually has, and the panel centers safely and scrolls rather than clipping. Checked at phone, car (800×480, 1280×480, 1024×600, 1920×720), tablet, laptop and desktop sizes, with the chat open and closed.
- **Face clipped under the sidebar on phones**, and the closed chat panel taking up half the screen height on narrow screens.
- **Lip-synced clips slipping on phones**: some phone browsers update the audio position only a few times a second, which let a clip run up to a quarter second behind its voice. The face now carries the position forward between updates and seeks once the gap passes 120 ms; with position updates every 250 ms the clip stays within 80 ms of the audio.
- **Talking glow came on before his mouth moved**: replies open with about half a second of silence (three quarters on clip soundtracks), and the glow and talking loops started with playback. Each message now carries `speech_at`, where the voice starts in its audio, and the page waits for it.

---

## [2.0.0] — 2026-10-25 — Delamain V2

### Added
- **Lip-synced lines**: 507 of the 607 fixed lines (greetings, "one moment", the pre-recorded replies, across all ten cores) now play a lip-synced face clip made with MiniMax H3. The rest use the talking loops until their clips are remade.
- **`import_clips.py`**: installs a folder of finished clips. Each clip is copied without its audio, and its soundtrack is saved beside it as `<clip id>.wav`, levelled to the original recording. Clips in `idle/` replace the idle loops.

### Changed
- **A clip plays its own soundtrack**: the generator re-renders the voice, and the lips follow that render, which can start up to a second later than the original recording. Lines with a clip now play the clip's soundtrack instead of the cached recording.
- **New idle loops**: all 33 blink, glance, fidget, bored and rare loops were remade at 800×544.

### Fixed
- **Greeting repeated every few minutes**: the WebSocket sat idle and Cloudflare closed it, the page reconnected, and each reconnect was greeted as a new trip. The page now sends a heartbeat every 20 seconds, and an automatic reconnect resumes the conversation without a greeting.
- **Navigation inside Fermata**: an app's embedded browser cannot open the Maps app, so instead of failing silently Delamain now names the destination and says to open him in the phone's browser to navigate.
- **Lip-synced clips stay on the words**: a clip starts at the audio's current position, is fetched as soon as the reply arrives, waits on its first frame if the audio has not started, and is kept on the audio clock while it plays (playback rate eased for small drift, a seek for large gaps). Measured with the real clips: median 19 ms, 96–98% of samples within 100 ms, including with clips loading 700 ms late.

---

## [1.7.0] — 2026-10-24

### Added
- **Instant pre-recorded replies**: about 470 fixed lines across all ten cores for everyday messages (thanks, goodbye, good night, good morning, how are you, who are you, what can you do, are you there, compliments, I love you, insults, never mind, okay, jokes, combat mode). They skip the model and use audio recorded at startup, so they answer in well under a second.
- **Combat mode**: "My apologies, but you do not appear to be in any sort of imminent danger," as Delamain told Jackie. A new safety rule comes first: if the passenger says they are being followed or threatened, he answers seriously.
- **Lip-synced face clips**: every fixed line has a stable clip id, and a video saved as `line_clips/<id>.mp4` plays on the face whenever that line is spoken. Clips use the same off-page, canvas-painted playback as the other face clips.
- Every greeting is pre-recorded, so each always plays the same take.

### Changed
- Personality-core voice effects are much gentler; every word stays understandable.
- Face color tints for the cores are muted, and the talking overlay is a faint wash.
- Failed replies are spoken ("My apologies. I was unable to complete that request.") instead of leaving the page waiting.

### Fixed
- **Backend crash during speech synthesis**: F5-TTS now runs on one dedicated thread; on ROCm, synthesis started on a fresh worker thread could segfault in the flash-attention GPU check.
- **The page stuck on "processing"**: the web UI reconnects when the link drops and clears the thinking indicator.

---

## [1.6.1] — 2026-10-24

### Changed
- **Personality cores are easier to tell apart**: each core now has a signature way of speaking that must show in every reply (Wellsprings opens with an insult, The Glen with a weary sigh-word, Northside with a whisper, Rancho Coronado in exclamations), sample lines to imitate, and its own sampling temperature. The core's section now comes last in the prompt, and rogue cores must be in character from the first word.
- Stronger voice profiles: Rancho Coronado is faster and higher, The Glen slower and lower, Wellsprings more distorted, Northside quieter and shakier, Badlands more distant, Coastview more metallic.

---

## [1.6.0] — 2026-10-24

### Added
- **The rogue Delamain cabs as personality cores**: Wellsprings (furious), The Glen (despairing), North Oak (sensitive), Coastview (trickster), Rancho Coronado (manic, hates flamingos), Northside (frightened) and Badlands (free spirit), plus a **Merged** core that has taken every fragment back in. Each has its own temperament, greetings, "one moment" and reminder lines, voice profile and face color and animation. The existing corrupted core is now called **Fractured**.
- Per-core voice profiles in `voice_glitch.py`: speed and pitch, distortion, muffling, tremolo, echo and chorus on top of the glitches.

### Changed
- Rogue cores replace the original's formal speech rules with their own identity, so they stay in character. Facts, navigation and safety rules are shared by every core, and a rogue core drops the act when the passenger sounds genuinely upset.
- The conversation log records which core spoke each line. A reconnect shows the whole recent conversation but only resumes the model on lines from the current core.

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
