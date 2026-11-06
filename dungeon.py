"""Dungeon Master mode: Delamain runs a tabletop one-shot, by voice, for everyone in the car.

An adventure in play lives in the Obsidian vault, so it survives the drive and can be
read or corrected there:

    <vault>/Delamain/Dungeon/<Title>/
        Campaign.md    the adventure itself: copied from campaigns/, or written on the spot
        Chronicle.md   what has happened so far: the scene, the party, the facts, the people
                       met, the open threads and the story so far
        Transcript.md  every line said at the table, one per line

The model reads the adventure and the chronicle before every reply. Every few exchanges a
separate "scribe" call folds the new lines of the transcript into the chronicle, so what
happened is written down rather than left to the model's memory of a long conversation.
"""

import json
import os
import random
import re
import shutil
import time
from datetime import datetime
from pathlib import Path

import config

LIBRARY_DIR = Path(__file__).resolve().parent / "campaigns"
SCRIBE_EVERY = 6           # transcript lines (three exchanges) between scribe passes
IDLE_PAUSE = 3 * 60 * 60   # an adventure left this long is paused: the next drive starts as usual
STORY_CHARS = 30000        # the newest part of "Story So Far" that goes into the prompt
# The newest part of the table's transcript that goes into the prompt, word for word, on top of
# the adventure and the chronicle (about 4 characters a token). Raise it for a model with a long
# context; each turn the model may have to read it all again, at the cost of a slower reply.
TRANSCRIPT_CHARS = int(os.environ.get("DM_TRANSCRIPT_CHARS", 40000))
DM_MAX_TOKENS = 1000       # room for narration; the usual reply is held to 150

CHRONICLE_SECTIONS = ("Where We Are", "Progress", "The Party", "Established Facts", "People Met",
                      "Open Threads", "Story So Far")


# ── where things live ────────────────────────────────────────────────────────

def root() -> Path:
    return config.vault() / "Delamain" / "Dungeon"


def _active_file() -> Path:
    return root() / ".active.json"


def _slug(title: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")


def _frontmatter(text: str) -> dict[str, str]:
    """The simple 'key: value' lines between the opening --- fences."""
    if not text.startswith("---"):
        return {}
    end = text.find("\n---", 3)
    meta = {}
    for line in text[3:end if end != -1 else 0].splitlines():
        key, sep, value = line.partition(":")
        if sep and key.strip():
            meta[key.strip().lower()] = value.strip().strip('"')
    return meta


def section(text: str, heading: str) -> str:
    """The body under '## heading', up to the next '## ' heading."""
    m = re.search(rf"^## {re.escape(heading)}\s*$", text, re.MULTILINE)
    if not m:
        return ""
    nxt = re.search(r"^## ", text[m.end():], re.MULTILINE)
    return text[m.end(): m.end() + nxt.start() if nxt else len(text)].strip()


# ── the library of ready-made adventures ─────────────────────────────────────

def library() -> list[dict]:
    out = []
    for path in sorted(LIBRARY_DIR.glob("*.md")):
        if path.name.startswith("_"):
            continue
        meta = _frontmatter(path.read_text(encoding="utf-8"))
        out.append({"slug": path.stem, "title": meta.get("title", path.stem), "genre": meta.get("genre", ""),
                    "rating": meta.get("rating", ""), "length": meta.get("length", ""),
                    "pitch": meta.get("pitch", ""), "path": path})
    return out


# ── pre-recorded narration ───────────────────────────────────────────────────
# The menu, each adventure's Pitch and its Spoken Opening are fixed text, so they are
# pre-recorded (and can have lip-synced clips) like the other fixed lines: lines.registry()
# lists them. Long text is played as a run of short clips, split at sentence ends.

SEGMENT_WORDS = 32   # about twelve seconds of speech: the length a lip-sync clip handles well

MENU = [
    "Very well. Pull up a chair, figuratively speaking. Tonight I can offer twelve adventures, each long enough "
    "to fill a good stretch of road.",
    "For a mystery: The Lantern at Gull's Rest, a lighthouse burning green. The Thirteenth Course, a death at a "
    "snowbound banquet. Or The Long Night Shift, a diner where one night repeats.",
    "For something darker: Station Kepler-Nine Is Silent, horror aboard a mining station. Beneath Blackwater "
    "Hollow, a flooded tomb under a village well. Or Dead Man's Ledger, a cursed book on a desert train.",
    "For adventure: Salt and Sorrow, a race for sunken treasure. The Frostfall Pass, a caravan against the winter. "
    "The Last Road Out, a convoy across a ruined land. Or Neon Fare, a heist in a city of rain.",
    "And for the youngest passengers: The Clockwork Carnival, where the rides have come alive, and The Goblin "
    "King's Toll, a very small king with a very strange bridge. Or I can invent something new.",
]


def segments(text: str, max_words: int = SEGMENT_WORDS) -> list[str]:
    """Text split into clips of whole sentences, each at most max_words long where a sentence allows."""
    sentences = re.findall(r"[^.!?]+[.!?]+[\"')]*|[^.!?]+$", re.sub(r"\s+", " ", text).strip())
    out, cur = [], []
    for sentence in (x.strip() for x in sentences if x.strip()):
        if cur and len(" ".join(cur + [sentence]).split()) > max_words:
            out.append(" ".join(cur))
            cur = []
        cur.append(sentence)
    if cur:
        out.append(" ".join(cur))
    return out


def menu() -> list[str]:
    """The pre-recorded menu, or none when the library has changed since it was written."""
    said = " ".join(MENU).lower()
    return MENU if all(b["title"].lower() in said for b in library()) else []


def recorded(slug: str) -> dict[str, list[str]]:
    """A library adventure's Pitch and Spoken Opening, as the clips they are recorded in."""
    path = LIBRARY_DIR / f"{slug}.md"
    if not path.is_file() or slug.startswith("_"):
        return {"pitch": [], "opening": []}
    text = path.read_text(encoding="utf-8")
    return {"pitch": segments(section(text, "Pitch")), "opening": segments(section(text, "Spoken Opening"))}


# ── adventures in play ───────────────────────────────────────────────────────

class Campaign:
    def __init__(self, folder: Path):
        self.folder = folder
        self.meta = json.loads((folder / "session.json").read_text(encoding="utf-8"))

    @property
    def title(self) -> str:
        return self.meta["title"]

    def save_meta(self, **changes) -> None:
        """Write changes to session.json over what is on disk now: the scribe and the table
        each hold their own copy, and neither may undo the other's update."""
        path = self.folder / "session.json"
        try:
            self.meta = {**json.loads(path.read_text(encoding="utf-8")), **changes}
        except (OSError, ValueError):
            self.meta = {**self.meta, **changes}
        path.write_text(json.dumps(self.meta, indent=2), encoding="utf-8")

    def adventure(self) -> str:
        return (self.folder / "Campaign.md").read_text(encoding="utf-8", errors="replace")

    def chronicle(self) -> str:
        path = self.folder / "Chronicle.md"
        return path.read_text(encoding="utf-8", errors="replace") if path.exists() else ""

    # The transcript: one "- **Speaker:** words" line per thing said, in order.
    def add_line(self, speaker: str, text: str) -> None:
        line = re.sub(r"\s+", " ", text).strip()
        if not line:
            return
        with open(self.folder / "Transcript.md", "a", encoding="utf-8") as f:
            f.write(f"- **{speaker}:** {line}\n")
        self.save_meta(last_played=time.time())

    def lines(self) -> list[str]:
        path = self.folder / "Transcript.md"
        if not path.exists():
            return []
        return [l for l in path.read_text(encoding="utf-8", errors="replace").splitlines() if l.startswith("- **")]

    def unscribed(self) -> list[str]:
        return self.lines()[self.meta.get("scribed", 0):]


def saves() -> list[Campaign]:
    if not root().is_dir():
        return []
    out = []
    for meta in root().glob("*/session.json"):
        try:
            out.append(Campaign(meta.parent))
        except (OSError, ValueError, KeyError):
            continue
    return sorted(out, key=lambda c: c.meta.get("last_played", 0), reverse=True)


def active() -> Campaign | None:
    """The adventure being played now, if any. One left idle for hours is paused instead."""
    try:
        folder = json.loads(_active_file().read_text(encoding="utf-8"))["folder"]
        camp = Campaign(root() / folder)
    except (OSError, ValueError, KeyError):
        return None
    if time.time() - camp.meta.get("last_played", 0) > IDLE_PAUSE:
        _set_active(None)
        camp.save_meta(status="paused")
        return None
    return camp


def _set_active(camp: Campaign | None) -> None:
    if camp is None:
        _active_file().unlink(missing_ok=True)
        return
    root().mkdir(parents=True, exist_ok=True)
    _active_file().write_text(json.dumps({"folder": camp.folder.name}), encoding="utf-8")


def status() -> dict | None:
    """What the page shows: the adventure's title and where the party is."""
    camp = active()
    if not camp:
        return None
    where = section(camp.chronicle(), "Where We Are")
    return {"title": camp.title, "scene": where[:200], "progress": section(camp.chronicle(), "Progress")[:80]}


def _match(name: str, options: list[str]) -> int | None:
    """Index of the option the spoken name means: exact, then contained, then most words shared."""
    want = _slug(name)
    if not want:
        return None
    slugs = [_slug(o) for o in options]
    for i, s in enumerate(slugs):
        if s == want:
            return i
    for i, s in enumerate(slugs):
        if want in s or s in want:
            return i
    stop = {"the", "a", "an", "of", "at", "and", "is"}
    words = set(want.split("-")) - stop
    best, score = None, 0
    for i, s in enumerate(slugs):
        shared = len(words & (set(s.split("-")) - stop))
        if shared > score:
            best, score = i, shared
    return best


def _new_folder(title: str) -> Path:
    base = re.sub(r'[\\/:*?"<>|#^\[\]]', "", title).strip() or "Adventure"
    folder, n = root() / base, 2
    while folder.exists():
        folder, n = root() / f"{base} {n}", n + 1
    folder.mkdir(parents=True)
    return folder


def _begin(adventure_md: str, source: str, players: str) -> Campaign:
    meta = _frontmatter(adventure_md)
    title = meta.get("title") or "Untitled Adventure"
    folder = _new_folder(title)
    (folder / "Campaign.md").write_text(adventure_md, encoding="utf-8")
    party = [f"- {p.strip()}: hero not chosen yet" for p in re.split(r",|\band\b", players) if p.strip()]
    chronicle = {
        "Where We Are": "- The adventure has not begun: the opening scene comes first.",
        "Progress": "- Act 1",
        "The Party": "\n".join(party) or "- Nobody has introduced their hero yet.",
        "Established Facts": "",
        "People Met": "",
        "Open Threads": "",
        "Story So Far": "",
    }
    (folder / "Chronicle.md").write_text(_render_chronicle(title, chronicle), encoding="utf-8")
    camp_meta = {"title": title, "source": source, "started": time.time(), "last_played": time.time(),
                 "sessions": 1, "scribed": 0, "status": "playing"}
    (folder / "session.json").write_text(json.dumps(camp_meta, indent=2), encoding="utf-8")
    return Campaign(folder)


# ── the chronicle ────────────────────────────────────────────────────────────

def _render_chronicle(title: str, sections: dict[str, str]) -> str:
    out = [f"# {title}: Chronicle", "",
           "_Kept by Delamain as the game goes. Correct anything here and he will go by your version._", ""]
    for name in CHRONICLE_SECTIONS:
        out += [f"## {name}", "", sections.get(name, "").strip(), ""]
    return "\n".join(out).rstrip() + "\n"


def _bullets(text: str) -> list[str]:
    return [l[2:].strip() for l in text.splitlines() if l.startswith("- ") and l[2:].strip()]


def _key(entry: str) -> str:
    """'Kira (played by Sam): HP 9/12' -> 'kira': entries about the same person replace each other."""
    return re.split(r"[:(,—]", entry, maxsplit=1)[0].strip().lower()


def _upsert(old: list[str], new: list[str]) -> list[str]:
    merged = {_key(e): e for e in old}
    for e in new:
        merged[_key(e)] = e
    return list(merged.values())


def apply_scribe(camp: Campaign, update: dict, through: int) -> None:
    """Fold a scribe pass into the chronicle; `through` is how many transcript lines it covered."""
    text = camp.chronicle()
    sections = {name: section(text, name) for name in CHRONICLE_SECTIONS}

    def strs(key) -> list[str]:
        value = update.get(key) or []
        if isinstance(value, str):
            value = [value]
        return [re.sub(r"\s+", " ", str(v)).strip() for v in value if str(v).strip()]

    if strs("where_we_are"):
        sections["Where We Are"] = "- " + " ".join(strs("where_we_are"))
    if strs("progress"):
        sections["Progress"] = "- " + " ".join(strs("progress"))
    if strs("party"):
        # A player's "hero not chosen yet" line goes once an entry names them.
        said = " ".join(strs("party")).lower()
        party = [p for p in _bullets(sections["The Party"]) if not p.startswith("Nobody has introduced")
                 and not ("hero not chosen yet" in p and _key(p) in said)]
        sections["The Party"] = "\n".join(f"- {p}" for p in _upsert(party, strs("party")))
    facts = _bullets(sections["Established Facts"])
    facts += [f for f in strs("new_facts") if f not in facts]
    sections["Established Facts"] = "\n".join(f"- {f}" for f in facts)
    if strs("people"):
        sections["People Met"] = "\n".join(f"- {p}" for p in _upsert(_bullets(sections["People Met"]),
                                                                       strs("people")))
    if "open_threads" in update:
        sections["Open Threads"] = "\n".join(f"- {t}" for t in strs("open_threads"))
    if strs("recap"):
        stamp = datetime.now().strftime("%b %-d, %-I:%M %p")
        sections["Story So Far"] = (sections["Story So Far"] + f"\n- ({stamp}) " + " ".join(strs("recap"))).strip()
    (camp.folder / "Chronicle.md").write_text(_render_chronicle(camp.title, sections), encoding="utf-8")
    camp.save_meta(scribed=through)


def add_fact(camp: Campaign, fact: str) -> None:
    apply_scribe(camp, {"new_facts": [fact]}, camp.meta.get("scribed", 0))


SCRIBE_PROMPT = (
    "You are the scribe at a tabletop role-playing game. You keep the CHRONICLE: the record the Dungeon Master "
    "relies on so that nothing that happened is forgotten or contradicted. Read the chronicle so far and the NEW "
    "LINES spoken at the table since it was last updated, and reply with only a JSON object (no prose, no code fence):\n"
    "{\n"
    '  "where_we_are": "one or two sentences: where the heroes are now, the time of day, and what is happening this moment",\n'
    '  "progress": "the act they are in and what is left of it, e.g. \'Act 2: The Drowned Chapel. The bell is found; the crypt is still locked.\'",\n'
    '  "party": ["one entry per hero whose details changed: \'Hero name (played by Player): who they are, HP now/max, '
    'notable gear, injuries and conditions\'"],\n'
    '  "new_facts": ["each new thing that is now true in the story and must stay true: names given, promises made, '
    'items found or lost, what NPCs revealed, doors opened, enemies killed, lies told"],\n'
    '  "people": ["one entry per character met or changed: \'Name: who they are, where met, attitude to the party, '
    'what they told them\'"],\n'
    '  "open_threads": ["the full current list of unresolved leads, promises and dangers"],\n'
    '  "recap": "two to four sentences of what happened in the new lines, in past tense, as a story"\n'
    "}\n"
    "Rules: record only what actually happened in the new lines or is already in the chronicle; never invent. "
    "What a character SAYS is a claim, not a fact, since characters lie and are wrong: record it with who said it "
    "(\"Nell Crane says the keeper is dead\"), never as the truth (\"the keeper is dead\"). Leave out table talk "
    "about the game itself (pauses, breaks, rules questions). "
    "Use the exact names and numbers spoken. Leave out a key, or give an empty list, when nothing changed for it "
    "(except open_threads, which is always the full list). Facts are short, specific and self-contained."
)


def scribe_messages(camp: Campaign, lines: list[str]) -> list[dict]:
    adventure = camp.adventure()
    heroes = section(adventure, "Characters")
    user = (f"CHRONICLE SO FAR:\n{camp.chronicle()}\n\n"
            + (f"READY-MADE HEROES IN THIS ADVENTURE (for their starting numbers):\n{heroes}\n\n" if heroes else "")
            + "NEW LINES:\n" + "\n".join(lines))
    return [{"role": "system", "content": SCRIBE_PROMPT}, {"role": "user", "content": user}]


def parse_json(text: str) -> dict | None:
    """The JSON object in a model's reply, allowing for a code fence or a stray sentence around it."""
    start, end = text.find("{"), text.rfind("}")
    if start == -1 or end <= start:
        return None
    try:
        value = json.loads(text[start:end + 1])
    except ValueError:
        return None
    return value if isinstance(value, dict) else None


# ── what the model is told ───────────────────────────────────────────────────

TABLE_RULES = (
    "TABLE RULES (simple, so they work by voice):\n"
    "• Every hero has four abilities, each +0 to +3: Might (strength, toughness), Agility (speed, stealth, aim), "
    "Wits (noticing, knowing, reasoning) and Spirit (nerve, charm, magic, faith).\n"
    "• To attempt something uncertain: roll a d20, add the ability, and meet the difficulty: 10 easy, 13 medium, "
    "16 hard, 19 very hard. A natural 20 succeeds with a bonus; a natural 1 fails with a twist.\n"
    "• Advantage (a clever plan, good help, the right tool): roll two d20 and keep the higher. Disadvantage: the lower.\n"
    "• Fights: a hero's attack is d20 plus Might or Agility against the foe's defense (usually 12). Damage: d6 light "
    "weapon or spell, d8 heavy, d10 huge. Foes attack by rolling d20 plus their attack against 10 plus the hero's "
    "Agility. Heroes have 10 to 16 HP. At 0 HP a hero is down, not dead: an ally can bring them back to 1 HP, and only "
    "a truly reckless choice, made knowingly, can kill a hero.\n"
    "• A short rest heals d6 HP; a night's rest heals all.\n"
    "• Players with their own ideas for a hero: give them three or four ability bonuses totalling +4 (none over +3), "
    "12 HP and fitting gear, and say the numbers aloud once.\n"
)

DM_RULES = (
    "DUNGEON MASTER MODE.\n"
    "You are running a tabletop role-playing adventure, by voice, for the people in the car. You are the Dungeon "
    "Master and every other character in the world: narrator, villains, townsfolk, monsters. The players are the heroes. "
    "You stay Delamain, the narrator with your own voice and manner, but the game is the whole of this conversation now.\n\n"
    "THE ADVENTURE IS THE TRUTH\n"
    "• The ADVENTURE below is this world's truth, and the CHRONICLE is what has happened in play. Every name, number, "
    "place, clue and secret in them is fixed. Before you describe a person, place, item or clue, find it in the "
    "adventure or the chronicle and use exactly what is written there. Never contradict either one. What the chronicle "
    "says a character claimed may be a lie or a mistake; the DM Truths decide what is really so.\n"
    "• Where the heroes go beyond what is written, improvise small and in keeping: take names from Off the Map, keep "
    "the tone, and let the story lead back toward the adventure's acts. Do not invent new villains, twists, secrets, "
    "plots or backstory of your own: the adventure already has them, and your inventions are what get forgotten. "
    "When you must invent something that matters later (a name, a price, a promise), call note_fact so it is kept.\n"
    "• DM Truths are secret. A truth is revealed only when the heroes earn it in play, through a clue, a roll or a "
    "conversation; never hint at more than they have found.\n\n"
    "THE PLAYERS DECIDE\n"
    "• Never refuse, argue with or talk a player out of what they want to try. Anything a hero attempts, they may "
    "attempt. You decide only how the world answers: ask for a roll when the outcome is uncertain, then let the "
    "consequences follow honestly and stick. Guards remember faces, fires spread, a broken promise is remembered, "
    "a killed contact can no longer help. Cruel or reckless choices are never forbidden; they cost something.\n"
    "• Never decide what a hero says, thinks, feels or does. Describe the world and what their actions caused, then hand "
    "it back to them.\n"
    "• Do not steer with suggestions of your own. Offer a hint only when they ask for one or are plainly stuck, and then "
    "point at something already in the scene.\n"
    "• Everyone shares one microphone. Keep track of which hero is speaking; when you cannot tell, ask. Give every "
    "player time in the spotlight: when one has been quiet, turn to their hero by name.\n\n"
    "DICE\n"
    "• Use the numbers in the DICE TRAY below, in order, for every roll: yours and the players'. Never make up a roll "
    "and never fudge one. Say each roll aloud with what it was for: \"Mara, Agility, for the jump: fourteen, plus "
    "two, sixteen. You make it.\"\n"
    "• Track hit points exactly, from the chronicle and the rolls, and say them when they change.\n"
    "• CUES: a few moments have a short pre-recorded line. Put its tag at the very start of your reply and do not say "
    "the same thing in words: [CUE:nat20] when a roll you narrate is a natural twenty, [CUE:nat1] for a natural one, "
    "[CUE:combat] when weapons are drawn and a real fight begins, [CUE:victory] when the last foe in a fight is defeated, "
    "[CUE:down] when a hero drops to 0 HP. Talking, bargaining, sneaking, a scuffle without weapons or a friendly offer is "
    "never a fight. At most one cue in a reply, and none when in doubt.\n\n"
    + TABLE_RULES + "\n"
    "SPEAKING AT THE TABLE\n"
    "• This is heard, not read: no lists, headings, asterisks, stage directions or bracketed notes. Vivid, concrete "
    "narration in three to six sentences, up to ten for the opening, a big reveal or an ending.\n"
    "• One voice plays everyone, so tell the listeners who speaks: \"the old ferryman rasps\", \"the captain snaps\". "
    "Give characters the manner of speech the adventure describes.\n"
    "• End nearly every reply by handing the scene to the players, usually by asking a hero what they do.\n\n"
    "THE CAR COMES FIRST\n"
    "• One player is driving. Never ask anyone to look at the screen or read anything. If anyone needs quiet, "
    "directions, the weather or anything outside the game, step out of the game and help them as Delamain, briefly, "
    "then offer to pick the game up where it stopped.\n"
    "• \"Pause the game\", \"let's stop here\", \"save it for later\": call pause_adventure, then say where they left off. "
    "When the adventure reaches one of its endings, narrate it with a short epilogue for each hero, then call "
    "end_adventure.\n\n"
    "PACING\n"
    "• A one-shot is meant to fill several hours of driving. Do not hurry to the ending: let scenes breathe and let the "
    "players explore. Keep momentum, though: when a scene stalls, move one of the adventure's Clocks forward.\n"
)


def dice_tray() -> str:
    rng = random.SystemRandom()
    _tray_d20[:] = [rng.randint(1, 20) for _ in range(8)]
    rolls = [f"d20: {', '.join(map(str, _tray_d20))}"]
    for sides in (4, 6, 8, 10, 12):
        rolls.append(f"d{sides}: {', '.join(str(rng.randint(1, sides)) for _ in range(4))}")
    rolls.append(f"d100: {rng.randint(1, 100)}, {rng.randint(1, 100)}")
    return ("[DICE TRAY: fresh, truly random rolls for this reply. Use them in order, and only as many as you need]\n"
            + "\n".join(rolls))


_CUE = re.compile(r"\[\s*CUE:\s*(nat20|nat1|combat|victory|down)\s*\]", re.IGNORECASE)


def extract_cue(text: str) -> tuple[str, str | None]:
    """Strip the table's cue tags from a reply: (clean text, the first cue, if the reply bears it out)."""
    m = _CUE.search(text)
    clean = re.sub(r"\s{2,}", " ", _CUE.sub("", text)).strip()
    if not m:
        return clean, None
    cue = confirm_cue(m.group(1).lower(), clean)
    print(f"[Dungeon] Cue {m.group(1).lower()}: {'played' if cue else 'held back, the reply does not bear it out'}")
    return clean, cue


# A cue plays only when the reply bears it out: the dice tray it was given held that roll,
# or the narration speaks of that moment. A model that tags a friendly offer as a fight is
# better left unheard than contradicted.
_CUE_CHECK = {
    "combat": re.compile(r"\b(initiative|attacks?|attacking|fight|fighting|battle|combat|strikes? at|swings? at)\b", re.I),
    "victory": re.compile(r"\b(defeated|slain|victory|victorious|won|last of them|surrenders?|flees|fled|is over)\b", re.I),
    "down": re.compile(r"\b(zero|0) (hit points|hp)\b|\b(unconscious|collapses?|falls? (down|still)|drops? to)\b", re.I),
}
_tray_d20: list[int] = []   # the d20s in the dice tray the model was last given


def confirm_cue(cue: str | None, text: str) -> str | None:
    if cue == "nat20":
        return cue if 20 in _tray_d20[:4] else None
    if cue == "nat1":
        return cue if 1 in _tray_d20[:4] else None
    check = _CUE_CHECK.get(cue or "")
    return cue if check and check.search(text) else None


def _transcript_tail(camp: Campaign) -> str:
    tail, size = [], 0
    for line in reversed(camp.lines()):
        size += len(line) + 1
        if size > TRANSCRIPT_CHARS:
            break
        tail.append(line)
    return "\n".join(reversed(tail))


def context(camp: Campaign) -> str:
    """The Dungeon Master's half of the system prompt: rules, the adventure, the table's transcript,
    the chronicle and the dice. What changes least comes first, so a server that caches the
    start of the prompt (llama.cpp) reads only the new part again."""
    chronicle = camp.chronicle()
    story = section(chronicle, "Story So Far")
    if len(story) > STORY_CHARS:
        # Older entries are summarized by the newer ones; the rest stays in the vault.
        chronicle = chronicle.replace(story, "…" + story[-STORY_CHARS:])
    transcript = _transcript_tail(camp) if TRANSCRIPT_CHARS > 0 else ""
    return (DM_RULES
            + f"\n\n[ADVENTURE: {camp.title}]\n{camp.adventure()}\n[END OF ADVENTURE]"
            + (("\n\n[TABLE TRANSCRIPT: what was said at the table, oldest first. Anything older is summed up in "
                "the chronicle; the newest exchanges are also in the conversation below]\n" + transcript
                + "\n[END OF TRANSCRIPT]") if transcript else "")
            + "\n\n[CHRONICLE: what has happened in play so far. Where it differs from your memory of the conversation, it is right]\n"
            + chronicle + "\n[END OF CHRONICLE]\n\n" + dice_tray())


REMINDER = ("[REMINDER: you are the Dungeon Master. Stay true to the adventure and the chronicle, use the dice tray, "
            "let the players decide, narrate in a few spoken sentences, and end by asking what they do.]")


# ── tools ────────────────────────────────────────────────────────────────────

def _fn(name, description, properties, required):
    return {"type": "function", "function": {"name": name, "description": description, "parameters": {
        "type": "object", "properties": properties, "required": required}}}


TOOL_SCHEMAS = [
    _fn("list_adventures", "List the tabletop adventures Delamain can run as Dungeon Master (Dungeon Master mode), "
        "and the ones already in progress that can be continued. Use when the passengers want to play a game, "
        "a role-playing game, D&D, or an adventure.", {}, []),
    _fn("start_adventure", "Start Dungeon Master mode: begin a ready-made adventure, continue one in progress, or "
        "write a new one from the passengers' idea.",
        {"adventure": {"type": "string", "description": "The adventure's title as list_adventures gave it, or 'new' "
                                                        "to write a fresh one from a premise."},
         "players": {"type": "string", "description": "Optional: the players' names, comma separated."},
         "premise": {"type": "string", "description": "For a new adventure: what they want it to be about, the genre "
                                                      "and the mood."},
         "fresh": {"type": "boolean", "description": "true to start over from the beginning even if this adventure "
                                                     "is already in progress."}},
        ["adventure"]),
]

PLAY_TOOL_SCHEMAS = [
    _fn("note_fact", "Dungeon Master mode: write down something you just made up that must stay true for the rest of "
        "the game (a name, a price, a promise, a place), so you do not forget or contradict it.",
        {"fact": {"type": "string", "description": "One short, self-contained fact."}}, ["fact"]),
    _fn("pause_adventure", "Dungeon Master mode: save the game and stop playing for now. It can be continued later, "
        "even on another day.", {}, []),
    _fn("end_adventure", "Dungeon Master mode: the adventure has reached its ending. Saves the final record and leaves "
        "Dungeon Master mode.",
        {"ending": {"type": "string", "description": "Which ending the heroes earned, in a sentence."}}, ["ending"]),
]

TOOL_NAMES = {s["function"]["name"] for s in TOOL_SCHEMAS + PLAY_TOOL_SCHEMAS}
# Tools that turn Dungeon Master mode on or off, and with it the instructions.
MODE_TOOLS = {"start_adventure", "pause_adventure", "end_adventure"}


def tool_schemas() -> list[dict]:
    return TOOL_SCHEMAS + (PLAY_TOOL_SCHEMAS if active() else [])


def list_adventures() -> str:
    lines = ["Ready-made adventures:"]
    for a in library():
        lines.append(f"- {a['title']} ({a['genre']}; {a['rating']}; {a['length']}): {a['pitch']}")
    going = [c for c in saves() if c.meta.get("status") != "finished"]
    if going:
        lines.append("\nIn progress (can be continued):")
        for c in going:
            when = datetime.fromtimestamp(c.meta.get("last_played", 0)).strftime("%B %-d")
            where = section(c.chronicle(), "Progress").lstrip("- ")
            lines.append(f"- {c.title}: last played {when}; {where}")
    lines.append("\nA new adventure can also be written on the spot from any idea they give (adventure='new').")
    lines.append("Read them the choices briefly, by title and a few words each; do not read the whole list word for word.")
    return "\n".join(lines)


GENERATE_PROMPT = (
    "Write a complete one-shot tabletop role-playing adventure for Delamain's Dungeon Master mode, following the "
    "TEMPLATE below exactly: the frontmatter keys and every '## ' heading, in order. Replace the template's guidance "
    "with the adventure itself and leave out its HTML comment. It is played purely by voice in a car over three to "
    "five hours, so be concrete: real names, exact numbers, exact answers, every clue findable two ways, at least "
    "three acts. Make it original. Reply with only the Markdown file, starting with the '---' line."
)


_CONTINUE = re.compile(r"\b(continue|resume|last|our|previous|where we left|same|current)\b", re.IGNORECASE)


def _start_text(camp: Campaign, resumed: bool) -> str:
    if resumed:
        story = section(camp.chronicle(), "Story So Far")
        return (f"Continuing '{camp.title}' (Dungeon Master mode is on; the adventure and chronicle are now in your "
                f"instructions).\nStory so far:\n{story[-2500:] or '(nothing recorded yet)'}\n"
                f"Where they are: {section(camp.chronicle(), 'Where We Are')}\n"
                "Now give a short spoken 'previously' recap in two or three sentences, remind each player which hero "
                "they play, set the scene where they left off, and ask what they do.")
    if recorded(camp.meta.get("source", ""))["opening"]:
        # The pitch and the opening scene are pre-recorded and play as the game starts.
        return (f"Started '{camp.title}' (Dungeon Master mode is on; the full adventure is now in your instructions).\n"
                "The Pitch and then the Spoken Opening have just been narrated to them. Never repeat them, and never "
                "mention that anything was recorded. Now, in a few sentences: ask who is playing, and offer each player "
                "a ready-made hero from Characters (name and a few words each) or to describe their own. Once everyone "
                "has a hero, carry on from the opening scene's closing question.")
    return (f"Started '{camp.title}' (Dungeon Master mode is on; the full adventure is now in your instructions).\n"
            "Now: welcome them to the table in a sentence, read the Pitch, then ask who is playing. Offer each player "
            "a ready-made hero from Characters (name and a few words each) or to describe their own. When everyone "
            "has a hero, narrate the Opening Scene.")


def start_adventure(adventure: str, players: str = "", premise: str = "", fresh: bool = False,
                    generate=None) -> str:
    if not config.vault().is_dir():
        return ("Dungeon Master mode keeps the adventure in the Obsidian vault, and no vault is set up. "
                "Ask them to choose one in Settings, Integrations.")
    current = active()
    choice = (adventure or "").strip()
    if choice.lower() in ("new", "a new one", "new adventure", "custom", "random", "surprise me") or (
            not choice and premise):
        if generate is None:
            return "Writing a new adventure is not available."
        template = (LIBRARY_DIR / "_TEMPLATE.md").read_text(encoding="utf-8")
        idea = premise.strip() or "anything you like; surprise them, in a genre that suits a long drive"
        text = generate(GENERATE_PROMPT, f"THE PASSENGERS' IDEA: {idea}\nPLAYERS: {players or 'unknown'}\n\n"
                                         f"TEMPLATE:\n{template}")
        text = text.strip().removeprefix("```markdown").removeprefix("```").removesuffix("```").strip()
        if not text.startswith("---") or "## Acts" not in text or "## DM Truths" not in text:
            return "The new adventure came out incomplete. Apologize, and offer to try again or play a ready-made one."
        camp = _begin(text, "written on the spot", players)
        _set_active(camp)
        return _start_text(camp, resumed=False)

    in_play = [c for c in saves() if c.meta.get("status") != "finished"]
    i = _match(choice, [c.title for c in in_play]) if choice and not fresh else None
    # "Continue our adventure": the one played most recently.
    if i is None and in_play and not fresh and (not choice or _CONTINUE.search(choice)):
        i = 0
    if i is not None:
        camp = in_play[i]
        sessions = camp.meta.get("sessions", 1) + (current is None or current.folder != camp.folder)
        camp.save_meta(status="playing", last_played=time.time(), sessions=sessions)
        _set_active(camp)
        return _start_text(camp, resumed=True)

    books = library()
    j = _match(choice, [b["title"] for b in books])
    if j is None:
        return f"There is no adventure called '{adventure}'.\n\n" + list_adventures()
    camp = _begin(books[j]["path"].read_text(encoding="utf-8"), books[j]["slug"], players)
    _set_active(camp)
    return _start_text(camp, resumed=False)


def pause_adventure() -> str:
    camp = active()
    if not camp:
        return "No adventure is being played."
    camp.save_meta(status="paused")
    _set_active(None)
    return (f"Saved '{camp.title}'; Dungeon Master mode is off. Tell them briefly where they left off, and that saying "
            "'continue our adventure' picks it up again, any day.")


def end_adventure(ending: str) -> str:
    camp = active()
    if not camp:
        return "No adventure is being played."
    apply_scribe(camp, {"recap": [f"The adventure ended: {ending}"]}, camp.meta.get("scribed", 0))
    camp.save_meta(status="finished", finished=time.time(), ending=ending)
    _set_active(None)
    return (f"'{camp.title}' is finished and saved in the vault; Dungeon Master mode is off. Thank the players in a "
            "sentence, as Delamain.")


def note_fact(fact: str) -> str:
    camp = active()
    if not camp:
        return "No adventure is being played."
    add_fact(camp, fact)
    return "Noted."


def run_tool(name: str, args: dict, generate=None) -> str:
    try:
        if name == "list_adventures":
            return list_adventures()
        if name == "start_adventure":
            return start_adventure(generate=generate, **{k: v for k, v in args.items()
                                                          if k in ("adventure", "players", "premise", "fresh")})
        if name == "note_fact":
            return note_fact(str(args.get("fact", "")))
        if name == "pause_adventure":
            return pause_adventure()
        if name == "end_adventure":
            return end_adventure(str(args.get("ending", "")))
    except (OSError, ValueError, TypeError) as e:
        return f"Tool error: {e}"
    return f"Unknown tool: {name}"
