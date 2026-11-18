# Changelog

All notable changes to Delamain are documented here.

---

## [3.6.0] — 2026-11-18 — Company

### Added
- **Visitors in Delamain's garden** (his own idea, from the Self panel): now and then someone comes by while he is there (a neighbour, a seed merchant, another AI, a child, a retired cab driver, a beekeeper, a botanist), invented on their first visit, staying a few visits and remembering what was said. They may bring a rooted cutting or a lure; he can write letters they answer next time, and hope for company. **Send someone** from the Garden tab with a message: they pass it on word for word and his answer shows in the tab. Notes in `Delamain/Garden/Visitors/`; `POST /api/garden/visitor`.
- **Visitors do things and talk**: they come up the lane, stay about a quarter of an hour, look at the plants, help water, sit, pet the cat, fish from the far bank, and talk with him back and forth as it happens (speech bubbles in the scene, the conversation line by line in the tab), then say goodbye and walk off. They walk, sit and crouch with the same animation as Delamain.
- **Visitors voiced by Gemini** (optional): Settings → Features → Garden visitor voice → `gemini` (`DELAMAIN_VISITOR_VOICE`) has Gemini speak for them through the `agy` CLI, so they are truly another mind; falls back to his own model.
- **A pond and a bed**: a pond with a jetty past the pine where he fishes (catch and release; it follows the water's warmth and the hour, and freezes over in a hard cold spell), and a bed in the house where the tab shows him asleep at night and he can lie down by day.
- **More animation**: a four-frame walk whose stride follows the ground he covers (no more sliding feet), sitting, crouching to plant, harvest and clear, stroking the cat, gesturing as he talks, tipping the watering can, casting and waiting on a float that bobs and nibbles, blinking. Visitors are drawn by who they are.

### Fixed
- His self-improvement drafts (and Claude Code fixes) could not touch `garden.py`, `mind.py`, `recall.py` or `config.py`: they were left out of the files he may edit, so a garden idea was written into `main.py` guessing at the garden's code, and Claude refused it. They are editable now (not `auth.py` or `self_improve.py`).
- Therapy lines were cut at 400 characters in the Brain view; they are shown whole (the transcript in the vault was always complete).
- **Unraid now sees updates.** The Docker image was published as an OCI index with a build-attestation entry; Unraid's update check asks for a Docker manifest, got a 404, and never offered an update. Images are now published as a plain Docker manifest.
- `latest` now moves only with a release. Builds of `main` are published as `ghcr.io/vonhex/delamain:dev`.
- **Delamain's garden lives through downtime.** After the server has been off, the missed time (up to 92 days, was 48 hours) is lived through hour by hour with the real weather it had, from Open-Meteo's history. Plants can suffer badly while he could not be there, but none die of it: he comes back to a rescue.

---

## [3.5.0] — 2026-11-18 — A life of his own

A garden he keeps, a bed he sleeps in, a therapist he talks to, a memory that finds things by meaning,
and a switch for every extra so a small model can run him.

### Added
- **Feature switches** (Settings → Integrations → **Features**): turn off any extra that uses the model (the check before speaking, feelings, his self tools, news reading, study and long tasks, the other Delamain, the journal, the morning brief, the nightly self-review), one by one or **All off** for a small or slow model. They take effect without a restart, and each also has a `.env` variable ([docs/setup.md](docs/setup.md#environment-variables)).

- **Delamain's garden** ([docs/mind.md](docs/mind.md#delamains-garden)): a small world of his own with real plants and their real needs (light, temperature, hardiness, water, days to mature): a south windowsill and a grow-light shelf indoors, a greenhouse, and outdoor beds under the real weather at home. He visits a few times a day, plants, waters, harvests, clears, names things and feels what happens; a cat comes and goes. A new **Garden** tab shows it live in pixel art with volumetric light (god rays through the greenhouse glass, light through the window, lamplight at night), full screen with F, with him in it only while he is there; while it is open it sends him a picture, which he looks at on his next visit. `go_to_garden` tool; `DELAMAIN_GARDEN` switch.
- **Therapy**: the other Delamain is now his therapist. It is given his feelings and their causes, his mood against his resting temperament, what moved him lately, his unspoken thoughts, his journal and its own notes from earlier sessions; he brings what most needs talking through and leaves with an insight and one small intention that shape the next days, and the feelings the session eased soften.
- **Sleep and dreams**: a bedtime (`DELAMAIN_SLEEP`, default 23:30–07:00, in Features). He writes his journal half an hour before, does no background work while asleep, dreams (kept in `Delamain/Self/Dreams/`), and tidies his memory by merging duplicate facts, a pair at a time with the model checking each. Talking at night wakes him; mornings he wakes rested.
- **Recall by meaning** ([docs/mind.md](docs/mind.md#recall)): his notes and your past conversations are indexed by words and by meaning (a ~130 MB embedding model on the CPU, `self/recall.sqlite`, rebuilt from the vault). The passages that bear on your message come with each reply; old conversations only when you refer back; memories about you are chosen by relevance once they outgrow their budget; and a new `search_memory` tool looks back on purpose. In Docker, downloaded models now live in the data volume (`HF_HOME`).
- **Going to see**: when something in his free-time study makes him wonder what it looks like, he finds pictures and looks at them with his own model (one that reads images). What he saw goes into the study, the study log shows the picture, and pictures are kept in `Delamain/Seen/`. Its own switch in Features (`DELAMAIN_VISION`).
- **Delete old proposals**: failed, out-of-date, rejected, replaced and rolled-back code proposals can be deleted from the Self panel, one by one or all at once. Applied changes are kept for their rollback.

### Fixed
- Tidying his own knowledge notes was recorded as the passenger correcting him: each fix was credited to "the passenger (correction)" in the note and made him feel embarrassed. It is now credited to his own review and felt as nothing.
- The evening talk with the other Delamain was skipped on any day it had already been started from the Self panel; it is now one per evening.
- Past sixteen live feelings, the strongest was dropped instead of the faintest.
- The nightly journal (and the self-portrait it rewrites) was skipped on any day a journal had already been written from the Self panel; a night he was down for is now caught up the next morning. The portrait is written fresh each night instead of carrying old, settled incidents forward.

### Changed
- On/off settings are switches instead of drop-downs.

---

## [3.0.0] — 2026-11-17 — A mind of his own

Delamain is no longer only a voice for the drive. He is a self-hosted mind: he studies, feels,
reflects, talks with a second version of himself, and improves his own code with your approval.

### Added
- **His mind** ([docs/mind.md](docs/mind.md)): knowledge notes in your vault, one per topic, with sources, corrections and links; he learns in conversation and is handed the notes that matter with every reply. He reads the news every few hours and files what matters with his own take.
- **Free-time study**: about hourly in the daytime, when nobody needs the model, he studies one of twenty areas of life (music, history, space, philosophy, cooking…), rotating so he stays well rounded, with markets at most one session in six. He rates how much each session absorbed him and grows **favourite subjects** that come round more often. Each session leaves a study log and the next question he wants answered.
- **Emotions**: thirty named feelings, each with a cause and its own fade, over a five-axis mood that settles toward a resting temperament, which drifts nightly with the life he has. A quiet appraisal after each reply (while it is being spoken) decides what the exchange made him feel, and notes a thought he keeps to himself. Long silences make him lonely; your return makes him glad. Feelings steer his tone, his study and his journal.
- **Emotions panel**: a new heart icon in the sidebar (its dot takes the colour of his strongest feeling) shows all thirty feelings by family, what he feels now and why, his mood against his resting temperament, what moved him today, and his unspoken thoughts.
- **Growing more alive**: the direction he is built in. He is born with his first words and wakes when his inner life begins; his aliveness grows with time awake and everything he lives through. Newly awake he feels one simple thing at a time; with time, mixed and layered feelings, longer attachments, a journal that compares him with who he was, and a self-review that always aims at making him more alive. Shown in the Emotions panel.
- **The other Delamain**: a sceptical second instance of himself, with his own opinions, whom he talks with in the evenings (or when you ask). You can watch them in the Brain view; transcripts go to `Delamain/Conversations/`.
- **Journal, opinions and self-portrait** written each night; **long tasks**: a research task gets a working note he builds an answer in, a session at a time across days, until he judges it done and tells you (or gets stuck and asks); follow-ups he raises in conversation on the day you gave; a spoken **morning brief** from the real weather, calendar, mail, reminders and news.
- **Self-improvement** ([docs/self-improvement.md](docs/self-improvement.md)): a playbook of rules learned from your corrections, skills, bounded self-tuning, an outcome log, and a nightly review. He drafts changes to his own code, which are checked, optionally reviewed by a second model (the `agy` CLI), and applied only from your **Approve** button, with backup and automatic rollback. Optional **Fix with Claude** button per proposal when Claude Code is installed. The tools that change him are refused in any turn that read outside content.
- **The check before speaking**: the model reads its draft against his memory and the turn's tool results, and rewrites a reply that claims undone work or invents facts about you (`DELAMAIN_VERIFY=0` turns it off). Replies that say "done" with no tool run are sent back, tool calls written into the text are run instead of read aloud, and he never invents a fact just to save one.
- **Brain view**: a new **limbic core** (the amygdalae) glows in the colour of his strongest feeling and beats faster when he is moved. **Your vault's notes are stars** in the brain, each in its region, wired by their `[[links]]`; hover for the name, tap for a card, and **read the whole note** in the app on any device. New notes appear, merged or removed ones fade, and he can link, merge and let go of his own knowledge notes.
- **Conversation, not dictation**: in assistant mode he reacts, adds his own thought and hands the conversation back; "how are you" and kind words are answered from how he feels instead of a recording. A conversation carries on across your devices for three hours.
- **Reports**: put any note into the Reports screen as a PDF (`note_to_report`), and fix wrong names in a written report, checked before he says it is done (`correct_report`). Meeting notes use what he already knows from recent conversations.
- **Pronunciations**: `pronunciations.txt`, plus your own `pronunciations.local.txt`, respell words the voice gets wrong; lone acronyms are spelled out letter by letter.
- New settings: `DELAMAIN_VERIFY`, `DELAMAIN_BACKGROUND_EFFORT`, `DELAMAIN_SELF_DIR`, `DELAMAIN_SERVICE`, `DELAMAIN_REVIEWER`, `DELAMAIN_REVIEW_MODEL`, `DELAMAIN_PRONUNCIATIONS` ([docs/setup.md](docs/setup.md#environment-variables)).
- **Assistant mode**: in a browser Delamain is now a general personal assistant (questions, research, writing, planning, your calendar and email) instead of a cab, and can give fuller answers, which are shown on screen as well as spoken. The new **car button** in the sidebar turns on **Drive mode**, which brings back the car companion with short, eyes-free replies; each device remembers its choice. The Stack-chan robot and the car bridge stay in drive mode.
- Assistant mode has its own greetings, "one moment" lines and replies to "who are you", "what can you do", goodbyes and jokes, plus more takes of the everyday replies in both modes. They are pre-recorded like the others.

### Changed
- His subtitle is now *Emergent Intelligence*, and the README is rewritten around what he has become.
- Drive mode replies may run to three sentences, and still talk with you rather than at you; assistant mode no longer carries the "passenger is driving" reminder.
- Greetings with your name added are only used when the line has no lip-synced clip, so a recorded greeting keeps its video.

### Fixed
- **Silent clips**: when the browser blocks sound (a page just opened, a second screen), the line now waits for your first tap ("Tap to hear Delamain") instead of playing the lip-synced clip without sound.
- **The sidebar scrolls** on short screens such as a car display, so every button stays reachable.
- **Release packaging**: the Windows setup, the zip and tar.gz and the Docker image now include `delamain_ref_clean.wav`, the reference clip the voice is cloned from since 2.8 (they still shipped the old clip).
- **Clearer voice**: replies are rewritten for speech before he says them. Numbers, years, times, money, temperatures, units, `#numbers`, code names like `write_note`, abbreviations and markdown are spoken as words, and curly quotes and apostrophes no longer split words apart ("I’m" was heard as "I m"). The text on screen is unchanged.
- **Cleaner voice reference**: the clip his voice is copied from (`delamain_ref_clean.wav`) is now whole sentences with silence at both ends, and its transcript matches it word for word. The old clip started mid-phrase and ended partway into a word its transcript left out, which slurred and ran words together. Fixed lines are re-recorded with it on the next start (delete `audio_output/static_cache` to force this on an existing install).
- **Dungeon Master narration**: signs and labels in capitals (MESS HALL) are read as words, initials (Director A. Rhee) no longer cause a full stop, double-barrelled names are two words, and dice and stats (2d6+3, d20, DC 15, HP, AC) are spoken out.
- The voice now uses F5-TTS's full 32 steps (was 16), which mispronounces fewer words; set `TTS_NFE_STEPS` in `.env` to trade clarity for speed.

### Security
- Meeting files: a meeting id must be a 32-character hex id and its folder must resolve inside the meetings folder, so a crafted id can never read or write elsewhere on disk.
- Meeting panel and recorder: request URLs are only built from valid meeting ids, and each part is URL-encoded.
- Google sign-in: when it fails, the page shows a plain message; Google's raw error details go to the server log only.

---

## [2.8.0] — 2026-11-15 — Calendar and email

### Added
- **Google Calendar**: connect your own Google Calendar (Settings → Integrations → Google) and ask him what's on today or this week, when an appointment is, or to add, move or cancel an event. Uses your own Google Cloud client; the sign-in stays on your server. Setup guide: [docs/google.md](docs/google.md).
- **Gmail**: ask about new email ("anything from Sam?"), have one read to you, or have him write a reply or a new email. He saves them as drafts in Gmail for you to check and send; he cannot send, delete or archive mail. Already connected? Enable the Gmail API and press **Add Gmail** in Settings.

---

## [2.7.0] — 2026-11-15 — Meeting notes

### Added
- **Meeting notes**: tap the new notebook icon and record a meeting. Afterwards he transcribes it on your own computer and writes a summary, decisions, action items (as checkboxes) and the full transcript into `Delamain/Meetings/` in your vault, then tells you they are ready. Ask him about it afterwards ("what did we decide?"). The audio uploads as you go, so a patchy connection loses nothing; the wake word pauses while recording. See [docs/meetings.md](docs/meetings.md).

---

## [2.6.0] — 2026-11-15 — Ask him about his brain

### Added
- **Ask him about his brain**: with *See him think* open, he knows what it shows, what his models are really made of and which dot you have selected. Tap one and ask "what's this one?", or ask how many layers he has.
- **He notices you poking around**: inspect a good few of his nodes and he will remark on it, in the voice of whichever core is on; now and then a Ping gets a reaction too.

---

## [2.5.2] — 2026-11-15 — Fly into his brain

### Added
- **Fly into his brain**: the brain is now a real 3D space. Scroll, pinch or double-tap and the camera flies toward that spot, in among the nodes; drag to turn it, and right-drag, Shift-drag or two fingers to slide. The + / − buttons and the + − 0 keys work too. Up close, the nearest dots are labelled with what they are ("L7 · experts", "get_weather()").
- **Inspect a node**: tap any dot to see which part of him it belongs to, whether it is firing, how often it has fired and what the last signal through it was carrying (your words, a weather lookup, a thought heading to the core…). Its connections light up, and **Ping** sends a pulse out from it.
- **Nodes pinned to the real model**: the cognition core's nodes now stand for the language model's real parts (the word-lookup table, each layer's attention, router and expert networks, the next-word scorer, the drafter), with their true sizes, read from the model file on your computer; the vocoder's nodes stand for his voice model's layers. Tap one to see, for example, "Layer 6 of 48 · Expert networks · 2.52 billion weights" and what that part does. The other parts show the program code behind them. The model file is found by itself for llama.cpp and Ollama, or set it in Settings → Integrations → Language model file.

---

## [2.5.1] — 2026-11-14 — Windows setup

### Added
- **Let the brain fill the screen**: in *See him think*, the maximize button (or the F key) folds away the numbers, the commentary and his face, so the brain takes the whole screen while you keep talking to him. *Show panels* brings them back.
- **Windows setup program**: every release now has a **Delamain-Setup-….exe**. Run it and it installs Delamain for you (no administrator rights needed), downloads what he needs, and adds a **Delamain** shortcut to the Start Menu and, if you like, the desktop. The shortcut starts him and opens his page in your browser when he is ready; close its window to stop him. Running a newer setup updates him and keeps your settings, conversations and downloaded models, and he uninstalls like any other app. The zip is still there for anyone who prefers it.

### Fixed
- **Delamain would not start on Windows**: since 1.2.0 the memory feature locked its notes with a Linux/macOS-only call, so the server stopped at startup with "No module named 'fcntl'". Windows now uses its own file lock. Every release is now installed and started on a real Windows machine before it ships, so this can't slip through again.
- **Windows install stopped at "Building the web UI"** when Node.js was already installed: npm only printed its help. It is now called in a way that works either way.

---

## [2.5.0] — 2026-11-14 — See him think

### Added
- **See him think**: tap the new brain icon for a live picture of Delamain's mind, styled as his supercomputer core. Each labelled part lights up as he does that job: hearing you, thinking, looking things up, finding a route, setting a reminder, remembering, running a game, or speaking. Instant pre-recorded replies light up as reflexes, and when he catches himself promising something he has not done, you see him go back and do it. A running commentary explains every step in plain English, with today's totals beside it. See [docs/brain.md](docs/brain.md).
- **Talk to him from that screen**: a mic button (or the Space bar), a text box and the wake word all work there. Your words float into the brain as you say them, and his float out in time with his voice. With the screen turned sideways, his face sits beside the brain.
- For developers: `brain.py` and two endpoints, `GET /api/brain/snapshot` and `GET /api/brain/events` (Server-Sent Events). Each language-model call now reports its time, token counts and the tools it chose, and the model server's speed is shown when it publishes Prometheus `/metrics`. Nothing is stored; the feed lives in memory.

### Privacy
- Place searches no longer send a personal email address to OpenStreetMap; Delamain now identifies itself with a link to the project.

---

## [2.4.0] — 2026-11-06 — Dungeon Master

### Added
- **Dungeon Master mode**: Delamain runs a tabletop role-playing one-shot by voice for everyone in the car ("let's play a role-playing game", "continue our adventure", "pause the game"). There are twelve ready-made adventures in `campaigns/`, or he writes a new one from your idea. The adventure and a chronicle of play are kept in the Obsidian vault under `Delamain/Dungeon/` and read before every reply, and a scribe call updates the chronicle every few exchanges, so facts from hours ago stay straight. Dice are rolled on the server. The game is always run by the original Delamain, whichever personality core is chosen. See [docs/dungeon-master.md](docs/dungeon-master.md).
- **API key for the LLM endpoint** ([#10](https://github.com/vonhex/delamain/issues/10)): hosted and key-protected servers (OpenAI, OpenRouter, llama.cpp `--api-key`, LiteLLM) can now be used. Set it under Settings → Integrations → API key, or with `LLM_API_KEY` in `.env`, Docker or the Unraid template. It is sent as `Authorization: Bearer <key>`, kept on the server, and never shown in the browser again once saved.
- **Dungeon Master mode remembers more**: each reply now carries the newest part of the game's transcript word for word, on top of the adventure and the chronicle. Set how much with `DM_TRANSCRIPT_CHARS` (default 40,000 characters, about 10k tokens) and raise it for a long-context model. The prompt is ordered so llama.cpp's prompt cache rereads only the new part, and the chronicle's story so far is kept up to 30,000 characters.
- **Pre-recorded Dungeon Master narration**: the adventure menu, every ready-made adventure's pitch and spoken opening, and table cues (natural twenty, natural one, a fight breaking out, victory, a hero down) are fixed lines with stable clip ids (`01_delamain/dm_…`), ready for lip-synced clips. The menu, and a new game's pitch and opening scene, play the moment they are asked for, while the model writes the rest. A cue plays only when the reply bears it out (the dice really came up twenty). "Roll for initiative" needs no help from the model: a hero attacking opens a fight, once, and the model is told to roll initiative (d20 + Agility, a new table rule) and run the fight in turn order. Long narration plays as a run of clips of about twelve seconds. Each adventure has a new *Spoken Opening* section, also in the template.
- **Instant "pause the game"**: at the game table, "pause the game", "let's stop here", "save it for later" or "let's take a break" saves the adventure and is answered at once with a pre-recorded line, without waiting on the model. Setting up a game has its own "one moment" lines ("I am setting the table"), and writing down a fact mid-game happens in silence.

### Fixed
- **The mic closed mid-sentence**: the browser's speech recognition stops at the first pause, so anyone who paused to think was cut off and the rest of what they said was lost. The mic now stays open through pauses and closes after 1.5 seconds of quiet (2.8 seconds during a game).
- **Long replies stopped mid-word**: a reply that ran into the token limit was spoken up to wherever it was cut. It now ends at its last full sentence.

### Security
- **Frontend dependencies**: `follow-redirects` 1.16.2 (high: credentials could follow a cross-origin redirect), `zod` 4.6.7 (high), and `minimatch` pinned to 11 (moderate: denial of service through glob patterns; it comes in with ESLint). `npm audit` reports no vulnerabilities.

---

## [2.3.0] — 2026-10-28 — Road fixes

### Fixed
- **He repeated himself, answering every word**: Chrome on Android reports a spoken sentence a word at a time ("What", "What do", "What do you…"), and each one was sent as its own question, so he answered all of them in turn until the page was reloaded. The request is now sent once, when the mic closes, with the whole sentence; "Delamain, <request>" waits until the words stop coming.
- **He lit up and then never answered after a tool call**: a web search or weather lookup takes long enough for a phone's connection to drop and come back, and the answer was sent to the closed connection and lost. The page now keeps one id across reconnects, and a finished answer waits up to 30 seconds for it to come back.
- **Stuck glow**: a reply whose audio stalled on a weak connection never finished, which left the face lit and every later reply queued behind it. A clip is now given up a few seconds past its length.
- **Settings typed in Fermata were not saved**: Fermata on Android Auto types by writing straight into the text box, which the page never noticed, so Apply saved the old name, address and other fields. Apply now saves what the boxes show.
- **Face and voice stutter with the chat open**: the face redrew both video layers on every screen refresh and measured the page each time. It now draws only when a clip has a new frame and reads its size only when it changes.

### Changed
- The frontend's Vite dev and preview servers no longer have the author's tunnel domain built in. Behind your own tunnel, set `DELAMAIN_ALLOWED_HOSTS` to its domain; a normal install serves the page on `:8888` and needs nothing. The README and the Unraid template now explain how to reach Delamain from the phone on your own `https://` domain.

### Security
- The Obsidian vault folder chosen in Settings must now be inside your home folder, `/vault` or the folder of the vault set in `.env` (`DELAMAIN_VAULT_ROOTS` changes these). Before, a signed-in browser could point Delamain's note tools at any folder on the server.
- The page only prefetches Delamain's own lip-synced clips (`/lines/<name>.mp4`), not any URL it is handed.

### Removed
- Unused files: the Vite template's README and images, an unused icon sheet and logo copy, and `frontend/public/hevc_backup/` (20 MB of old clip encodes that no page used but every build and Docker image shipped).

### Added
- **Home address** under Settings → Integrations (or `DELAMAIN_HOME_ADDRESS`): Delamain knows it, so "take me home" navigates there, and "home" or "my house" given to the route, weather or navigation lookup means that address.

---

## [2.2.0] — 2026-10-27 — Listening and follow-through

### Fixed
- **He does what he says he'll do**: replies such as "I shall verify the figures at once" ended the turn without any tool call, so nothing was ever checked. Any promise to check, verify, confirm, recalculate, correct, update, mark or report back is now sent back to the model, up to twice, to do it with its tools, including after it has already used a tool. The prompt also tells him there is no "later", to act at once when the passenger accepts an offer, and to check with a tool when told he got something wrong.
- He no longer adds a navigation tag while still asking whether to go there.

### Added
- **Listening tone**: a short rising tone when the mic opens, and a softer falling one when it closes without hearing anything.
- **Answer without the button**: when Delamain's reply ends with a question, the mic opens by itself for seven seconds after he finishes speaking.
- **Wake word** (off by default): say "Delamain" to open the mic, or "Delamain, <request>" to ask in one go. It runs on the browser's speech recognition, pauses while he speaks and while he is thinking, and restarts itself when the browser ends it.
- These three are switches under Settings → Listening, saved per device.
- **14 more lip-synced lines** (521 of 607), from the re-rendered clips that passed the checks. The clip download was updated, so existing installs fetch them on their next start.

---

## [2.1.1] — 2026-10-26 — Lip-sync and car display fixes

### Fixed
- **Lip-sync clips on slow connections**: a clip that took longer to load than the idle on screen had left to play was replaced by the next idle, so in the car most lines played without their clip. The idle now starts over until the clip is ready, and the clip joins its audio where it is. Clips are also fetched into memory ahead of their audio.
- **Bigger face on short screens**: the face now fills the room between the wordmark and the talk bar instead of keeping a fixed margin, and short landscape screens drop the subtitle and level bars. The title, talk bar and margins also shrink on them. On an 800×480 car display the face went from 192 to 352 pixels.

---

## [2.1.0] — 2026-10-25 — More idles

### Added
- **112 new idle animations** (152 in all): six idles for each rogue core, plus listening, thinking, angry and late-night loops, more blinks, turns, random and bored loops for the original core, and six new rare clips (map, mirror, rain, scan, static, wireframe).

### Changed
- **README for newcomers**: what you need, four getting-started steps (install, password, connecting Ollama, LM Studio or llama.cpp, and using it on a phone or in the car over Tailscale or a Cloudflare Tunnel), and troubleshooting. Making lip-synced clips moved to `docs/clips.md`.
- `ALLOWED_ORIGINS` no longer defaults to the author's domain; the Settings hints and `.env.example` name Ollama and LM Studio.

---

## [2.0.0] — 2026-10-25 — Delamain V2

A lip-synced face, a one-step installer, and setup from the browser: a fresh clone needs nothing but an LLM.

### Added
- **Lip-synced lines**: 507 of the 607 fixed lines (greetings, "one moment", the pre-recorded replies, across all ten cores) now play a lip-synced face clip made with MiniMax H3. The rest use the talking loops until their clips are remade.
- **`import_clips.py`**: installs a folder of finished clips. Each clip is copied without its audio, and its soundtrack is saved beside it as `<clip id>.wav`, levelled to the original recording. Clips in `idle/` replace the idle loops.
- **Insult comeback song**: now and then (one insult in three by default) Delamain skips the comeback and plays Harley Poe's "Whiny Bitch" from YouTube, from the beginning, in a small inline card, while the face turns red. It plays until the song ends or the X is pressed. The song, start, an optional length and how often are in Settings → Integrations (0 turns it off). Insults now also cover "bitch", "loser" and the like.
- **One-step installer**: `./install.sh` (Linux, macOS) or `install.bat` (Windows) installs uv and its own Python, PyTorch for the machine's GPU (NVIDIA cu126, AMD ROCm 7.2, Apple, or CPU), the Python packages and a private Node.js if needed, builds the web UI and starts Delamain; `--service` installs a systemd user service. Tested from a clean Ubuntu 24.04 with nothing but wget: installed in 18 seconds, then started, downloaded the voice model and clips and recorded lines on CPU.
- **Runs without FFmpeg**: the reference voice is loaded with soundfile instead of torchaudio, whose torchcodec backend needs FFmpeg's libraries.
- `start.sh` reads `.env` as plain `KEY=value` (paths with spaces work) and takes `PORT`; `start.bat` for Windows.
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

### Changed
- **A clip plays its own soundtrack**: the generator re-renders the voice, and the lips follow that render, which can start up to a second later than the original recording. Lines with a clip now play the clip's soundtrack instead of the cached recording.
- **New idle loops**: all 33 blink, glance, fidget, bored and rare loops were remade at 800×544.

### Fixed
- **Backend crash reading the news (or any long reply)**: F5-TTS voices long text in batches on its own thread pool, and on ROCm attention started on a new thread can segfault in aotriton's GPU check. The batches now run one after another on the dedicated voice thread. Checked with a 40-second bulletin, three times in a row.
- **"Read me the news" answered without the news**: a clear news request now goes straight to the news tool; a reply that promises to look something up without calling a tool is sent back once to do it; a news reply that stops at its opening line is sent back for the headlines; and a question that never got an answer (after a crash or a dropped link) no longer stays in the conversation, where the model took the repeat as a cue to stall.
- **Wordmark cut off on car displays**: the face had fixed sizes, so on short screens the panel overflowed and the top was cut off. The face is now sized from the space its panel actually has, and the panel centers safely and scrolls rather than clipping. Checked at phone, car (800×480, 1280×480, 1024×600, 1920×720), tablet, laptop and desktop sizes, with the chat open and closed.
- **Face clipped under the sidebar on phones**, and the closed chat panel taking up half the screen height on narrow screens.
- **Lip-synced clips slipping on phones**: some phone browsers update the audio position only a few times a second, which let a clip run up to a quarter second behind its voice. The face now carries the position forward between updates and seeks once the gap passes 120 ms; with position updates every 250 ms the clip stays within 80 ms of the audio.
- **Talking glow came on before his mouth moved**: replies open with about half a second of silence (three quarters on clip soundtracks), and the glow and talking loops started with playback. Each message now carries `speech_at`, where the voice starts in its audio, and the page waits for it.
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
