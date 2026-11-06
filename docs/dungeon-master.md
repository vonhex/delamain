# Dungeon Master mode

On a long drive, Delamain can run a tabletop role-playing game for everyone in the car. He is the Dungeon Master and every other character: narrator, villains, innkeepers, monsters. You and your passengers are the heroes. It is all by voice, so the driver can play too.

> *"Very well. Pull up a chair, figuratively. The lamp on Harrow Point has burned green for six nights, and two boats have followed it onto the rocks..."*

## Start a game

Say something like:

- "Delamain, let's play a role-playing game. What adventures do you have?"
- "Run The Lantern at Gull's Rest for me and my daughter."
- "Make up a new adventure: a haunted ski lodge, spooky but not gory."
- "Continue our adventure." (picks up the last one you were playing, even days later)

He reads you the pitch and asks who is playing. Each adventure has four to six ready-made heroes; pick one, or describe your own and he gives it numbers. Then he narrates the opening scene and asks what you do.

To stop: "pause the game" (or "we're stopping for gas", "save it for later"). He saves and tells you where you left off. Anything outside the game, like directions, weather, reminders or "how long until we're there?", works mid-game. He steps out, answers as Delamain, and offers to pick the game up again.

When the page shows **Dungeon Master · *title*** under his name, a game is on.

## The adventures

Twelve ready-made one-shots ship in [`campaigns/`](../campaigns), each written to fill three to five hours:

| Adventure | Genre | Rating |
|---|---|---|
| The Lantern at Gull's Rest | Coastal fantasy mystery | Teen |
| The Clockwork Carnival | Whimsical fantasy, gentle peril | Family |
| The Last Road Out | Post-apocalyptic road-trip convoy | Teen |
| The Long Night Shift | Time loop in a highway diner | Teen |
| Neon Fare | Cyberpunk heist of a taxi AI's memory core | Teen |
| Station Kepler-Nine Is Silent | Sci-fi horror | Mature |
| The Thirteenth Course | Gothic whodunit at a snowed-in banquet | Teen |
| Dead Man's Ledger | Weird west | Teen |
| Beneath Blackwater Hollow | Classic dungeon delve | Teen |
| Salt and Sorrow | Pirate treasure race | Teen |
| The Goblin King's Toll | Comedic fantasy | Family |
| The Frostfall Pass | Winter survival caravan | Teen |

Everything in them works by ear: no maps, grids or handouts. Puzzles are riddles and deduction, and dungeons are named rooms with spoken exits.

### Write your own

Copy [`campaigns/_TEMPLATE.md`](../campaigns/_TEMPLATE.md), fill it in and save it to `campaigns/` under a new name. It shows up in the list right away. Keep the section headings as they are. The more exact it is (names, numbers, which clue is where), the less Delamain has to invent.

## How he keeps the story straight

A plain chat model forgets. Over a few hours the early facts slip out of the conversation, and it starts inventing replacements that contradict them. Dungeon Master mode keeps the story in your Obsidian vault instead, one folder per game:

```
<vault>/Delamain/Dungeon/The Lantern at Gull's Rest/
    Campaign.md     the adventure: plot, secrets, characters, places, endings
    Chronicle.md    what has happened so far, kept up to date as you play
    Transcript.md   everything said at the table
```

- **The adventure is read before every reply.** Names, secrets and clues come from the file, not from memory. He is told to improvise only small things, to take improvised names from the adventure's own name lists, and to write down anything he invents that matters later.
- **A scribe keeps the chronicle.** Every three exchanges, a separate model call reads the new lines of the transcript and updates `Chronicle.md`: where the party is, each hero's hit points and gear, the facts established, the people met and what they claimed, and the open leads. The chronicle goes into every reply too, so a fact from the first hour is as present as one from a minute ago. What a character *says* is recorded as their claim, since characters lie; the adventure's secrets decide what is really true.
- **Real dice.** Every reply comes with freshly rolled dice from the server, which he must use in order, so he can't fudge a roll or forget one.
- **You can correct him.** Open `Chronicle.md` in Obsidian and fix anything. He goes by your version from the next reply.

## Table manners

He runs the game on a few rules:

- **You decide.** He never refuses or argues with what a hero tries. He decides how the world answers: a roll when it's uncertain, then consequences that stick. Punch the harbormaster and you get his coat, a crowd that remembers, and a harbormaster who won't help you later.
- **He doesn't play your hero.** He never says what your character thinks, says or feels, and he doesn't push his own ideas. He gives a hint when you ask for one.
- **Everyone gets a turn.** One microphone serves the whole car, so he keeps track of who is who. When someone has been quiet, he turns to their hero by name.
- **The road comes first.** He never asks anyone to look at the screen, and any real-world request interrupts the game.

The rules are deliberately simple: d20 + an ability (Might, Agility, Wits or Spirit, +0 to +3) against 10, 13, 16 or 19. Heroes have 10–16 HP, and at 0 HP a hero is down, not dead.

## Requirements

- **Tools on** (Settings → Integrations) and a model with tool calling. Starting, pausing and ending a game are tool calls.
- **An Obsidian vault** set in Settings. The game is saved there. Any folder that holds a `.obsidian` folder works; Obsidian itself doesn't need to be running.
- **Context.** Each reply carries the whole adventure (about 5,000 tokens) plus the chronicle and recent conversation. Give the model at least **16k context**, and 32k is better for long games. Ollama defaults to much less: set `num_ctx` (e.g. `OLLAMA_CONTEXT_LENGTH=32768`), or in LM Studio raise the context length when loading the model. Below that, the start of the adventure gets cut off without any warning.
- **A capable model.** The better the model, the better the game. Small models (7–8B) can run it, but they drift from the adventure more and write blander narration.

## Listening

People pause to think mid-sentence, and the browser's speech recognition used to close the mic at the first pause. Now the mic stays open through pauses and closes after about 1.5 seconds of quiet, or 2.8 seconds during a game. When he asks the table a question, the mic stays open for up to 15 seconds so you can talk it over first.
