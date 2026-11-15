# Delamain's brain

The **Brain view** (the *neural core*) shows what Delamain is doing while he does it, as a
live diagnostic of a sovereign transport intelligence. Open it with the brain button in the
left sidebar, or add `#brain` to the address (`http://localhost:8888/#brain`) to open it
straight away, for example on a second screen or a phone propped on the dash. Esc or the ✕
closes it.

<img src="../Screenshots/brain.png" alt="The Brain view: Delamain thinking, with two tools in flight" />

It is not a generic picture of "an AI". Every flash is a real event from Delamain's own
backend: the moment he hears you, each call to the language model (with its token counts
and timing), each tool he uses, each time he catches himself out, the voice being
synthesized, and the reply leaving his mouth.

## Talk to him from the neural core

You don't have to leave the view to see it in action. The bar under the brain is the main
page's own mic and chat:

- **SPEAK** (or press **Space**) opens the mic, exactly like the big mic button.
  While it is open the audio intake glows, and **your words fly into it as they are
  recognized**, before the message is even sent.
- **Type** in the box and press Enter to send a message without speaking.
- **The wake word** works here too: say "Delamain", or "Delamain, what's the weather?".
  The line under the bar shows its state: *WAKE WORD ARMED · SAY "DELAMAIN"*, *MIC OPEN ·
  SPEAK NOW*, *WAKE WORD OFF* (tap *turn on*; it is the same switch as Settings →
  Listening), or *WAKE WORD BLOCKED* when the browser has refused the microphone for this
  site. Speech recognition needs a browser that has it (Chrome, Edge, Safari) and, on a phone,
  the page opened over `https://`.

His replies play through the speaker as usual. The vocoder glows exactly while his voice is
heard, and his words leave it **in time with his voice**: each word floats out when the audio
reaches it (spaced by word length, with a beat at each comma and full stop), so a quick reply
streams out quickly and slow narration drifts out slowly. If playback stalls, the words wait.

**His face** moves into the view when the screen is in landscape: it sits to the right of the
brain, above the thought stream, still lip-synced and reacting, with a readout of what he is
doing (*TRANSMITTING* while he speaks, *RECEIVING* while the mic is open, *PROCESSING* while
he thinks). Close the view and it goes back to the main screen. In portrait the brain keeps
the whole screen.

## Zoom in and inspect a node

- **Zoom**: pinch with two fingers on a touchscreen, scroll the mouse wheel (or pinch a trackpad), or
  double-tap a spot to zoom in there; double-tap again to come back out. The **+ / −** buttons and the
  keys **+**, **−** and **0** (reset) do the same. Zoomed in, drag with one finger to look around; at
  normal size, dragging tilts the brain.
- **Inspect a node**: tap any dot. Its connections light up out to its neighbours, and a card shows which
  subsystem it belongs to, whether it is firing right now, how many times it has fired since you
  opened the view and when last, what the last signal through it was carrying ("your words, heading
  in to be understood", "a request to OPTIC ARRAY: checking the weather", "a thought: memory feeding
  the cognition core"…), and what its neighbours are. **Ping** sends a pulse out from it so you can
  watch a signal travel. Esc or ✕ closes the card.

### What each node really is

- **COGNITION CORE nodes are pinned to the real language model.** When its file is on the same computer,
  Delamain reads the file's header (never the weights) and lists its real parts: the word-lookup table,
  every layer's attention (full or fast), its router, shared expert and expert networks (or its
  feed-forward block), the next-word scorer and the drafter, each with its true weight count. The
  core's nodes are laid out over them in order, from layer 1 at the back of the frontal lobe to the
  last layer at the front; bigger parts get more nodes and every part gets at least one (on a small
  screen, neighbouring layers share). Tap a node and the card says, for example, *Layer 6 / 48 · Expert
  networks · 2.52 billion weights here; this dot is one of 6 standing in for them*, with what that kind
  of weight does and the real tensor names and shapes.
- **VOCODER nodes are pinned to his voice model** (F5-TTS), block by block, the same way.
- **The other subsystems are program code, not learned weights**, so their nodes name the functions that
  do the work: `web_search()`, `get_weather()`, `remember()`, `set_reminder()` and so on.

What stays an illustration is *when* a node lights up: model servers don't report which weights fire
for a given word, so the flashes show the flow of the work, not the exact weights.

The language model file is found by itself for llama.cpp (from its `/props`) and Ollama (from its
manifest for your model id). Otherwise set **Settings → Integrations → Language model file** (or
`LLM_MODEL_FILE`) to a `.gguf` or Halogen `.hgn` on this computer. If none is found, the core's nodes
keep their general description. Readers: GGUF, Halogen `.hgn`, PyTorch `.pt` (read without loading
weights or running code from the file) and `.safetensors`; see `model_map.py`.

## Reading the brain

The dots are a map of jobs, not real neurons. Each subsystem is labelled with its name
and, in plain words, what it does; it lights up when Delamain uses it. Tap a part (or hover
it with a mouse) for a one-line explanation, and press ⓘ for the key.

| Subsystem | In plain words | Where | Lights up when |
|---|---|---|---|
| **AUDIO INTAKE** | Hearing | auditory cortex, side of the brain | the mic is open, and when your message arrives. Your words fly into it. |
| **COGNITION CORE** | Core: the model thinking | frontal lobe | the language model is thinking. It takes the colour of the active **personality core**: cyan for the original, orange for Wellsprings, and so on. Switching core sends a ripple through it. |
| **OPTIC ARRAY** | Senses | visual cortex, back of the brain | he looks at the world: `web_search`, `read_webpage`, `get_news`, `get_weather` |
| **NAV-GRID** | Navigation | parietal lobe | `get_route`, and finding the places in a `[NAVIGATE:]` reply |
| **SCHEDULER** | Plans | strip across the top | `set_reminder`, `list_reminders`, `cancel_reminder` |
| **SIM ENGINE** | Imagination | top of the back | Dungeon Master mode: the adventure tools, and the scribe writing up the chronicle in the background |
| **MEMORY BANKS** | Memory | temporal lobe and the hippocampus curl inside | `remember`, `forget` and the Obsidian note tools |
| **VOCODER** | Voice | Broca's area, front-low | F5-TTS synthesizing his reply, and while his voice plays. His words leave from here, in the core's colour. |
| **REFLEX ARC** | Reflexes | cerebellum | an instant pre-recorded reply ("thanks", "how are you", "pause the game", an insult song). The signal goes straight from the audio intake to the cerebellum and on to the vocoder, never touching the cortex, because no language model is needed. |
| **ETHICS DAEMON** | Conscience | the band deep inside | he catches himself promising something he has not done ("I shall check", "I have saved that") and is sent back to actually do it. The display glitches for a moment. |

**Signals.** There are no connecting lines. Each signal is a glowing particle with a comet
tail that hops from neuron to neuron along a real path through the brain, lighting each
neuron it passes. While the model thinks, comets run from memory, the audio intake and the
senses into the cognition core. When it reaches for a tool they run from the core to that
tool's subsystem and back with the result. When the LLM server publishes its speed, the
thinking comets run at roughly one per generated token.

**Flares** float up from a subsystem for a moment: "48 tokens · 2.2 s · → 2 tools" when a
model call finishes, "checking the weather" as a tool starts, "reflex · thanks".

**Telemetry.** Along the top: *synaptic load* (how much of the brain is firing), signals in
flight, the number of nodes, the model on the uplink, and how long the view has been open.
Along the bottom, the **neural telemetry** strip follows the phase: a slow resting wave when
idle, a quicker one while listening or speaking, dense spikes while thinking, and a jolt
when his ethics daemon fires. The hex ticker beside it runs faster while he works.

## The thought stream

The panel on the right (below the brain on a phone) narrates every event in plain words,
newest first, tagged with the subsystem:

> 👂 AUDIO INTAKE · Heard you: "What is the weather like at home, and remind me to buy milk in twenty…"
> 🧠 COGNITION CORE · Thinking about your request.
> 💭 COGNITION CORE · Reaching for 2 tools: checking the weather, setting a reminder (48 tokens · 2.2 s).
> 🛠️ OPTIC ARRAY · Checking the weather…
> 🫢 ETHICS DAEMON · Caught himself claiming to have saved something without saving it. Going back to do it.
> 💬 Said: "It is a mild fourteen degrees at home…"

Above it are today's numbers: messages heard, replies, reflex replies, model calls ("thoughts"),
average thinking time, tokens in → out, tools used and self-checks. They reset at midnight
and when the backend restarts.

## How it works

`brain.py` is a small event bus. `main.py` calls `brain.emit()` at the real moments of a
turn; nothing in it changes a reply. The page subscribes with Server-Sent Events. The mic,
the live transcript and the speaker come straight from the page itself.

| Event | Sent when | Notable fields |
|---|---|---|
| `heard` | a `talk` message arrives | `text` (first 300 characters), `persona`, `dungeon` |
| `reflex` | a pre-recorded reply, song or instant "pause" answers it | `what` (the intent, e.g. `thanks`) |
| `think_start` / `think_end` | each call to the LLM (every tool-loop round, the tools-off reply, the DM scribe) | `round`, `source` (`reply` or `scribe`), `ms`, `prompt_tokens`, `completion_tokens`, `reasoning_tokens`, `tps`, `calls` (tools the model chose) |
| `tool_start` / `tool_end` | each tool call, and the automatic search when tools are off | `name`, `region`, `ms`, `chars` |
| `correction` | a reply claimed a save, promised an action or started the news without the headlines, and is sent back | `reason` (`save`, `action`, `news`), `promise` |
| `navigate` | a `[NAVIGATE:]` destination has been geocoded | `options` |
| `voice_start` / `voice_end` | F5-TTS synthesis | `chars`, `ms`, `ok` |
| `spoke` | a reply, greeting or reminder is sent to the page | `text` (first 400 characters), `source`, `persona`, `dungeon` |
| `core` | a page switches personality core | `persona` |
| `clients` | a page connects or disconnects | `count` |
| `error` | a reply failed and the error line was spoken | `message` (the exception type only) |

Token counts and speed come from the chat completion's `usage` (and `timings`, which
llama.cpp adds). Separately, while a Brain view is open the backend reads the LLM server's
Prometheus `/metrics` every few seconds, if it publishes one (llama.cpp does with
`--metrics`), and shows the generation speed in the header. A server without it is simply
skipped.

The feed is in memory: the last 120 events and today's counts. Nothing is written to disk.
The text of what you said and what he replied is in the feed, so the events endpoint needs
the same token as the WebSocket.

Endpoints: `GET /api/brain/snapshot` (JWT) and `GET /api/brain/events?token=` (SSE). See
[api.md](api.md#get-apibrainsnapshot).

The renderer is `frontend/src/components/brain/brainRenderer.ts` (canvas 2D, no
libraries) and the page around it is `frontend/src/components/BrainView.tsx`. With
`prefers-reduced-motion` the brain stays still and only lights up.
