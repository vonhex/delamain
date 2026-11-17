# Everything he does

The full list. His mind, emotions and self-improvement have their own pages: [mind.md](mind.md) and [self-improvement.md](self-improvement.md).


- **See him think**: tap the brain icon for a live picture of Delamain's mind. Each labelled part lights up as he listens, thinks, looks something up, remembers, plans or speaks; your words float in, his float out in time with his voice, and a running commentary explains each step in plain English. You can talk to him from that screen too, and with the screen turned sideways his face sits beside it. More in [docs/brain.md](brain.md).
- **Meeting notes**: tap the notebook icon and press record. When the meeting is over he transcribes it on your own computer and writes a summary, the decisions, the action items and the full transcript into your Obsidian vault. Then just ask him what was decided. See [docs/meetings.md](meetings.md).
- **Your calendar and email**: connect your Google account and ask what's on today, when your next appointment is, or tell him to add, move or cancel something. Ask about new email and have him read it to you or write a reply; he saves replies as drafts for you to send, never sends them himself. Setup takes about five minutes: see [docs/google.md](google.md).
- **Dungeon Master mode**: on a long drive, say "Delamain, let's play a role-playing game" and he runs a tabletop one-shot for everyone in the car, by voice, playing every character himself. Twelve ready-made adventures of three to five hours each ship with him, from a haunted lighthouse and a time-looping highway diner to a pirate treasure race and two family-friendly romps. He can also write a new one from your idea on the spot. He never refuses what your hero tries, only makes it count, and rolls real dice. The game is kept in your Obsidian vault: the adventure, a chronicle a scribe updates as you play (party, hit points, facts, people met) and the full transcript. So he doesn't lose track of the facts hours in, and "continue our adventure" picks it up days later. See [docs/dungeon-master.md](dungeon-master.md).
- **Voice personality**: formal, measured and dry, exactly as in Cyberpunk 2077. The voice is cloned from a reference clip with F5-TTS.
- **Personality cores**: under Settings → Personality Core, swap the original for one of the rogue sub-personalities that escaped when Delamain's core fractured. Each has its own temperament, greetings, reminder lines, face color and voice, made by post-processing the synthesized audio:

  | Core | Temperament | Voice |
  |------|-------------|-------|
  | Delamain | The original: composed, formal, precise | Clean |
  | Merged | Every fragment taken back in; warmer, and now and then says "we" | Faint chorus of voices |
  | Fractured | All the fragments at once, cutting across each other | Stutters, bit-crush, static |
  | Wellsprings | Furious, foul-mouthed, contemptuous | Deep, distorted growl |
  | The Glen | Despairing, weary, gloomy | Slow, low, muffled, echoing |
  | North Oak | Gentle, sensitive, easily hurt | Soft, trembling |
  | Coastview | Sly trickster who loves a surprise | Reversed fragments, metallic |
  | Rancho Coronado | Manic, gleeful, hates lawn flamingos | Fast, high, stuttering |
  | Northside | Frightened, whispering, sure it is being tracked | Quiet, shaky, dropping out |
  | Badlands | Wistful free spirit, dreaming of the open road | Airy, distant echo |

  Every core keeps the same tools and stays truthful: facts, directions and navigation are never part of the act, safety warnings come first, and a rogue core drops the act if the passenger sounds genuinely upset.
- **Instant pre-recorded replies**: everyday messages such as "thanks", "tell me a joke", "good night", "never mind" and "combat mode" are answered at once from fixed lines written for every core, with no model call and the audio already recorded. With the greetings and "one moment" lines that makes over 600 pre-recorded lines across the ten cores, more than 500 of them lip-synced. Only short messages that are nothing but one of these get a fixed reply; anything with a real question goes to the model. "How are you", kind words and "good morning" go to the model too, so he answers from how he actually feels (and in assistant mode, "thanks" and "ok").
- **Insult comeback**: swear at him and, now and then, instead of a reply he plays you a song from YouTube (Harley Poe's "Whiny Bitch" by default) until you press the X; change it or turn it off in Settings.
- **Combat mode**: ask him to initiate it and he answers as he did Jackie: "My apologies, but you do not appear to be in any sort of imminent danger." If you say you are being followed or threatened, he drops the joke and helps.
- **Lip-synced face**: over 500 of the pre-recorded lines (521 so far) play a lip-synced clip of Delamain saying them, made with MiniMax H3; the rest use the talking loops. The clips are published as a release download, and a new install fetches them by itself on first start. It fits any screen, from a phone to a wide car display.
- **A face that's never still**: over 150 idle animations. Delamain blinks, glances away and fidgets when left alone, leans in while you talk, thinks while he looks something up, and glares when insulted. Late at night the screen dims and streetlights slide across his face, and once in a while a rare clip plays: a holographic city map, glowing holographic rain, a wireframe glitch and others. Each rogue core has its own idles too, from the Badlands cab gazing at a desert sunset to Rancho Coronado's manic grin and the Coastview trickster flickering out of view.
- **Set up from the browser**: on first start the page asks you to choose a password, and Settings → Integrations sets the LLM endpoint and model, your home address, SearXNG, the Obsidian vault, news, routing and units. They are saved on the server, so `.env` is optional.
- **News bulletins**: say "read me the news", "any tech news?" or "local news" and Delamain reads a short spoken bulletin of current headlines. It uses Google News RSS, with SearXNG as a fallback.
- **Reminders and timers**: "remind me in twenty minutes to call mom" or "at five, remind me to pick up the dry cleaning". Delamain speaks the reminder aloud when it's due. If you're away at that moment, he tells you as soon as you're back. Reminders are kept in the database and survive restarts.
- **Weather**: current conditions and a three-day forecast for where you are or any town, from Open-Meteo.
- **Drive time and distance**: "how long to the airport?" uses OSRM routing at typical road speeds, with an arrival estimate.
- **Picks up where you left off**: Android Auto drops and reopens the page often. On reconnect Delamain restores the last three hours of conversation, so a conversation started in the car carries on at the desk, and skips the fresh greeting when you've only been gone a few minutes.
- **Knows the hour and your name**: greetings fit the time of day, and he uses the name from Settings now and then.
- **Web search**: traffic, scores, opening hours, prices, places. The LLM calls SearXNG through tool calling.
- **Notes and memory**: lists, reminders and notes go into your Obsidian vault under `Delamain/`. Lasting facts about you and the people and places in your life are kept in `Delamain/Memory/`, one Markdown note per topic, and you can read and edit them in Obsidian.
- **Navigation**: "take me to the nearest Whole Foods" searches for the place, geocodes it with Nominatim, and opens your map app with the route. Save your **home address** under Settings → Integrations and "take me home", "how long until I'm home?" and the weather at home just work.

  > **Navigation needs Delamain open in your phone's browser.** Inside an app's embedded browser, such as Fermata on Android Auto, a web page cannot open the Maps app. There Delamain still finds the place and tells you the destination, but you have to start the route yourself, or open Delamain in Chrome on the phone instead.
- **Voice input**: press the mic button (a short tone tells you he's listening), or turn on the **wake word** in Settings and just say "Delamain", or "Delamain, what's the weather?". When he asks you a question, the mic opens for a few seconds by itself so you can simply answer. All three are switches in Settings. It uses the browser's speech recognition, and there's a text chat panel too.
- **Follows through, and tells the truth**: when he says he'll check, verify or correct something, he does it in the same reply with his tools. A reply that only promises, or says "done" with nothing done, is sent back to him; and before he speaks, the model checks its draft against his memory and the tools' results ([mind.md](mind.md#honesty)).
- **Conversation log**: a history panel of everything you and Delamain have said.
- **JWT authentication**: a single shared password, chosen on first start, rate-limited login and 30-day tokens.
