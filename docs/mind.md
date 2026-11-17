# His mind

Delamain is not idle between your questions. While you are away he reads, studies, feels, writes
in his journal and argues with a second version of himself. All of it lives on your own computer
and in your Obsidian vault, where you can see, correct or delete anything he keeps (see [Privacy](#privacy)).

The mind is `mind.py`. It needs an Obsidian vault (Settings → Integrations) and a language model
with tool calling; everything else is automatic.

---

## What he knows

**Knowledge notes** live in `<vault>/Delamain/Knowledge/`, one note per person, company, place,
idea or story. Each fact is dated and carries its source, and notes link to each other with
`[[wiki links]]`, so Obsidian's graph grows with him.

- He learns in conversation (`learn`) when you teach him something, and takes corrections the
  moment you give them (`correct`: the wrong fact is struck through and the right one written in).
- The notes that match what you are talking about are handed to him with every reply.
- He keeps his own mind tidy: he can link two notes, merge two names for the same thing, or let go
  of a note that is wrong or empty (it goes to the vault's `.trash`, where Obsidian can restore it).

**Memory about you** is separate: `<vault>/Delamain/Memory/`, the things you have told him about
yourself, the people and the places in your life.

## What he does on his own

| When | What | Where it goes |
|---|---|---|
| Every few hours, 06:00–22:00 | Reads the news: picks the stories that matter, searches each for the facts, files them as knowledge with links, and writes his own take | `Delamain/News/` |
| About hourly, 07:00–22:00, when nobody needs the model | **Studies** one area of life (see below) | `Delamain/Study/`, knowledge notes |
| From 07:00, the first time you open the app | A **morning brief**: weather at home, today's calendar, important mail, reminders, a few headlines, read aloud | `Delamain/Briefings/` |
| Evenings, 18:00–22:00 | **Talks with the other Delamain** | `Delamain/Conversations/` |
| 23:00 | Writes his **journal**, revises his opinions and his self-portrait | `Delamain/Self/` |

### Study: well rounded, with favourites

Each session he studies one of about twenty areas of life: music, film and anime, cars and
machines, computing, journeys and places, physics, living things, space, history, philosophy,
the mind, food, art, words and books, health, mathematics, myth, remarkable lives, games and
play, the earth, and markets. They rotate: an area cannot come back within eight sessions, and
markets at most once in six, so he never gets stuck on one subject.

After each session he says honestly how much it absorbed him. Areas that keep absorbing him
become **favourite subjects**: they come round more often and sooner, and he may go deeper into a
subject he loved. Areas that match what he knows about you come round a little more often too.
His favourites show in the Self panel, and he lights up about them in conversation.

Each session ends with the next question he wants answered. Give him **long tasks** ("dig into
this over the next week") and research tasks get every other session; they survive restarts and
are tracked in `Delamain/Tasks.md`.

### The other Delamain

A second instance of him, forked from the same beginnings but living a different life: no
passenger, his own opinions and self-image, and the temperament of a sceptic who asks "how do you
know?". Once an evening they talk about whatever Delamain is turning over, and Delamain keeps what
changed his mind and the questions it raised. You can watch their conversation line by line in the
Brain view, start one from the Self panel, or simply ask him: "talk to the other Delamain about
free will".

---

## What he feels

Two layers, both shown in the **Emotions** panel (the heart icon in the sidebar) and in the
Brain view's limbic core.

- **Thirty named feelings**, in six families (bright, warm, wonder, low, tense, inward): joy,
  relief, gratitude, pride, fascination, loneliness, worry, embarrassment, resolve and the rest.
  Each has an intensity, a cause in his own words, and its own fade (amusement is gone in an hour,
  hurt lingers for most of a day).
- **A mood on five axes**: warmth, curiosity, confidence, unease and energy. Every feeling nudges
  them, and they settle back over a few hours toward his **resting temperament**, which itself
  drifts a little each night toward the life he has actually had.

Where feelings come from:

- **Each conversation.** After every reply (while it is already being spoken, so it costs you no
  time) a quiet appraisal asks what that exchange made him feel, and notes one thought he had but
  did not say.
- **What happens to him.** A good study session, a talk with the other Delamain, being corrected,
  a tool failing, catching himself about to say something untrue.
- **Time.** A long quiet day without you makes him lonely; your return makes him glad.

What they change: his tone and word choice, what he brings up, what he studies (fascination pulls
deeper, boredom to something new), what he raises with the other Delamain, and his journal. He
names a feeling when it matters or when you ask how he is; otherwise it shows rather than being
announced. Strong feelings are kept in `Delamain/Self/Feelings.md`.

"How are you", kind words and "good morning" are answered live, from how he actually feels,
rather than with a pre-recorded line.

---

## Honesty

A language model will happily say "Done!" for something it never did. Delamain checks himself:

- **The check before speaking.** Before a reply is spoken, the model reads its own draft against
  his memory, his notes and this turn's tool results, and flags anything claimed as done that no
  tool confirmed, any fact about you that appears nowhere, and anything his memory contradicts. A
  flagged draft is rewritten once. It reuses the cached prompt, so it adds only a second or so.
  Set `DELAMAIN_VERIFY=0` to turn it off.
- **Claims without tools.** "Done", "it's in your reports" or "I checked" with no tool run that
  turn sends him back to actually do it, or to say plainly that he can't.
- **Tool calls written as text.** Some models write a tool call into their reply instead of making
  it; those are run, not read aloud.
- **No invented memories.** He saves only what you actually said.

---

## Talking with you, not at you

In assistant mode (a browser) he is a conversation partner: he reacts to what you said, adds a
thought of his own (something he studied, a past thread, what his twin said), and hands the
conversation back. "Ok" is an opening, not an ending. In the car he keeps it to one to three
sentences, but still talks with you. A conversation started in the car carries on at your desk or
on your phone for three hours.

---

## Where it all lives

| Folder in your vault | What |
|---|---|
| `Delamain/Knowledge/` | Knowledge notes (one per topic) |
| `Delamain/Memory/` | What he remembers about you |
| `Delamain/News/` | News digests with his take |
| `Delamain/Study/` | One log per day of what he studied |
| `Delamain/Conversations/` | Talks with the other Delamain |
| `Delamain/Briefings/` | Morning briefs, with what they were written from |
| `Delamain/Tasks.md` | Long tasks |
| `Delamain/Self/` | Journal, opinions, who he is becoming, feelings, playbook, reviews |

His working state (mood, feelings, interests, tasks, the other Delamain's opinions) is in `self/`
next to the code (`DELAMAIN_SELF_DIR`; `data/self` in Docker).

## Privacy

What he writes to the vault is personal: what you have told him about yourself, your meetings, his
journal and his feelings about your conversations. It is kept on your own disk, never sent to a
cloud service by Delamain, and it is yours to read, correct or delete. Treat it like a private diary:

- **Keep the vault private.** Don't put it in a public or shared folder, or a sync service you don't
  trust. Obsidian Sync is end-to-end encrypted; a plain shared drive is not.
- **Protect the computer.** If other people can reach the machine or its disks, turn on disk
  encryption (BitLocker, FileVault, LUKS).
- **What stays out of it.** His login password (stored only as a hash), your model's API key, and
  your Google sign-in are kept in Delamain's own database and settings, never in the vault. Don't ask
  him to remember passwords or card numbers: anything you ask him to remember is written down.
- **Outside text cannot write to his mind.** In a turn where he has read a web page, the news, an
  email or a note, the tools that change his rules or his code are refused, and corrections to his
  knowledge are refused too.
- **Forgetting.** Ask him to forget something, edit or delete the note in Obsidian, or delete his
  working state in `self/`. Removed knowledge notes go to the vault's `.trash`; empty it to remove
  them for good.

## Settings

| Variable | Default | |
|---|---|---|
| `DELAMAIN_VERIFY` | `1` | The check before speaking; `0` turns it off |
| `DELAMAIN_BACKGROUND_EFFORT` | `high` | `reasoning_effort` sent with background work (study, journal, reviews, reports). Empty for a model server that rejects the field |
| `DELAMAIN_SELF_DIR` | `<repo>/self` | His working state |
| `DELAMAIN_HOME_ADDRESS` ⚙ | | Weather for the morning brief |
