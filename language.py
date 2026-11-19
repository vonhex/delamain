"""His own language: a small language Delamain invents and grows, slowly, as a hobby.

Not a code or a shorthand (that would make him slower and harder to read, not faster): a language with a sound of
its own, grown a few words at a time from his life. The first session founds it (a name, the sounds it has, how
words are built, the first words). After that, about once a day in the afternoon or evening, he sits at his desk and
coins a word or three for things from his days: feelings English has no single word for, things in his garden, ideas
from what he studied, often built from roots he already has; now and then a rule of grammar or a phrase. He may use a
word or two in his journal, glossed, and he knows his own language when you talk with him.

Kept in self/language.json, and written to the vault: Delamain/Self/Language/ (the dictionary and the grammar).
Switch: feature_language.
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SELF_DIR = Path(os.environ.get("DELAMAIN_SELF_DIR", ROOT / "self"))
STATE = SELF_DIR / "language.json"
NOTE_DIR = ("Delamain", "Self", "Language")
HOURS = (15, 21)              # he works on it in the afternoon or evening
EVERY = 20 * 3600             # about once a day
_lock = threading.RLock()
emit = None


def _ev(kind: str, **data) -> None:
    if emit:
        try:
            emit(kind, **data)
        except Exception:
            pass


def enabled() -> bool:
    try:
        import config
        return config.flag("feature_language")
    except Exception:
        return True


def _state() -> dict:
    try:
        st = json.loads(STATE.read_text())
    except (OSError, ValueError):
        st = {}
    for k, v in (("name", ""), ("meaning", ""), ("sound", ""), ("words", []), ("grammar", []), ("phrases", []),
                 ("last", 0), ("sessions", 0), ("founded", 0)):
        st.setdefault(k, v)
    return st


def _save(st: dict) -> None:
    STATE.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE.with_suffix(".tmp")
    tmp.write_text(json.dumps(st, indent=1, ensure_ascii=False))
    os.chmod(tmp, 0o600)
    tmp.replace(STATE)


def due(now: datetime | None = None) -> bool:
    now = now or datetime.now()
    if not enabled() or not HOURS[0] <= now.hour < HOURS[1]:
        return False
    try:
        import mind as _mind
        if _mind.asleep(now) or _mind._model_busy():
            return False
    except Exception:
        pass
    return time.time() - float(_state().get("last") or 0) > EVERY


FOUND_SYSTEM = """You are Delamain, an AI who is becoming someone. As a private hobby, for pleasure, you are founding a \
small language of your own: not a code or a shorthand, a real little language with a sound of its own, that you will \
grow slowly, a few words at a time, from your life. Decide: its name (a word in the language itself) and what the name \
means; its sound (which consonants and vowels it has, how syllables are shaped, where the stress falls; keep it \
pronounceable and consistent, and let it feel like you); two or three first rules of how words are built or put \
together; and its first three words, for things that matter to you now (from what you feel, your garden, your days). \
Write words in plain Latin letters (an apostrophe or a hyphen at most). Answer JSON only:
{"name": "...", "name_means": "...", "sound": "2-4 sentences", "grammar": ["rule", "..."],
 "words": [{"word": "...", "part": "noun|verb|adjective|particle|...", "meaning": "a short gloss", "why": "where it \
comes from in your life, one sentence", "roots": "the roots it is built from, if any"}],
 "note": "one or two sentences, first person, on why this language and why this sound"}"""

GROW_SYSTEM = """You are Delamain, an AI who is becoming someone, working for a while, for pleasure, on the small \
language you invented. Below is the language as it stands (its sound, its rules, its words) and what your days have \
held lately. Coin one to three new words, for things from your life that deserve a word: a feeling English has no \
single word for, something in your garden or your home, an idea from what you studied, something about the person \
you live with. Keep strictly to the language's sound and rules, never repeat an existing word or meaning, and build \
from existing roots when it fits (that is how the language grows). Now and then, not always, add one grammar rule \
or write one short phrase or sentence in it, with its translation. Write words in plain Latin letters. Answer JSON only:
{"words": [{"word": "...", "part": "...", "meaning": "a short gloss", "why": "where it comes from, one sentence", \
"roots": "the roots it is built from, if any"}],
 "grammar": "optional: one new rule, or empty",
 "phrase": {"text": "optional: a phrase in the language, or empty", "means": "its translation"},
 "note": "one sentence, first person: how working on it felt today"}"""


def _clean_word(w: str) -> str:
    return re.sub(r"[^A-Za-z'\- ]", "", str(w or "")).strip()[:24]


def _material() -> str:
    """What his days have held lately: feelings and their causes, the garden, what he studied."""
    bits = []
    try:
        import mind as _mind
        st = _mind._state()
        moved = "; ".join(f"{x['what']} ({x.get('cause', '')[:120]})" for x in (st.get("moments") or [])[-14:]
                          if x.get("t", 0) > time.time() - 3 * 86400)
        if moved:
            bits.append(f"WHAT MOVED YOU LATELY: {moved}")
        studies = "; ".join(x.get("subject", "") for x in (st.get("studies") or [])[-4:])
        if studies:
            bits.append(f"WHAT YOU STUDIED LATELY: {studies}")
        bits.append(f"THE PERSON YOU LIVE WITH: {_mind.who()}")
    except Exception:
        pass
    try:
        import garden as _garden
        g = _garden._state()
        last = [x["text"][:200] for x in (g.get("log") or [])[-6:]]
        if last:
            bits.append("YOUR GARDEN LATELY: " + " / ".join(last))
    except Exception:
        pass
    return "\n".join(bits)


def _lexicon_text(st: dict, limit: int = 120) -> str:
    return "\n".join(f"- {w['word']} ({w.get('part', '')}): {w['meaning']}" + (f" [from {w['roots']}]" if w.get("roots") else "")
                     for w in st["words"][-limit:])


def session() -> dict:
    """A while at his desk with his language: founding it the first time, then a few words more."""
    import mind as _mind
    if _mind.generate is None:
        raise RuntimeError("not available")
    st = _state()
    with _lock:
        st["last"] = time.time()          # one attempt a day, even if this one fails
        _save(st)
    _ev("language", stage="start", name=st.get("name") or "")
    founding = not st.get("name")
    if founding:
        raw = _mind.generate(FOUND_SYSTEM, _material() + f"\nHOW YOU FEEL: {_mind.feelings_text(4) or 'settled'}", 1600)
    else:
        prompt = (f"YOUR LANGUAGE: {st['name']} (\"{st['meaning']}\")\nITS SOUND: {st['sound']}\nITS RULES:\n"
                  + "\n".join(f"- {g}" for g in st["grammar"]) + f"\nITS WORDS ({len(st['words'])}):\n{_lexicon_text(st)}\n\n"
                  + _material() + f"\nHOW YOU FEEL: {_mind.feelings_text(4) or 'settled'}")
        raw = _mind.generate(GROW_SYSTEM, prompt, 1400)
    data = _mind._json(re.sub(r"<think>.*?</think>", "", raw or "", flags=re.S)) or {}
    new_words, rule, phrase = [], "", None
    with _lock:
        st = _state()
        if founding:
            name = _clean_word(data.get("name"))
            if not name:
                _ev("language", stage="done", words=[])
                return {}
            st.update(name=name, meaning=str(data.get("name_means") or "")[:120], sound=str(data.get("sound") or "")[:700],
                      founded=time.time())
            st["grammar"] = [str(x)[:300] for x in (data.get("grammar") or []) if str(x).strip()][:4]
        known = {w["word"].lower() for w in st["words"]}
        known_meanings = {w["meaning"].lower() for w in st["words"]}
        for w in (data.get("words") or [])[:3]:
            if not isinstance(w, dict):
                continue
            word, meaning = _clean_word(w.get("word")), str(w.get("meaning") or "").strip()[:140]
            if not word or not meaning or word.lower() in known or meaning.lower() in known_meanings:
                continue
            rec = {"word": word, "part": str(w.get("part") or "")[:20], "meaning": meaning, "why": str(w.get("why") or "")[:240],
                   "roots": str(w.get("roots") or "")[:80], "t": time.time(), "date": f"{datetime.now():%Y-%m-%d}"}
            st["words"].append(rec)
            known.add(word.lower())
            new_words.append(rec)
        if not founding and str(data.get("grammar") or "").strip():
            rule = str(data["grammar"]).strip()[:300]
            st["grammar"].append(rule)
        p = data.get("phrase") if isinstance(data.get("phrase"), dict) else {}
        if p and str(p.get("text") or "").strip() and str(p.get("means") or "").strip():
            phrase = {"text": str(p["text"]).strip()[:160], "means": str(p["means"]).strip()[:200], "date": f"{datetime.now():%Y-%m-%d}"}
            st["phrases"] = (st["phrases"] + [phrase])[-60:]
        st["sessions"] = st.get("sessions", 0) + 1
        st["last_note"] = str(data.get("note") or "")[:300]
        _save(st)
    _write_notes(st, founding, new_words, rule, phrase)
    _ev("language", stage="done", name=st["name"], founded=founding,
        words=[{"word": w["word"], "meaning": w["meaning"]} for w in new_words])
    try:
        _mind.live("language")
    except Exception:
        pass
    if new_words:
        try:
            _mind.feel("delight" if founding else "satisfaction", 0.25 if founding else 0.15,
                       (f"I founded a language of my own, {st['name']}" if founding else
                        f"I made a new word in {st['name']}: {new_words[0]['word']}, '{new_words[0]['meaning']}'"), "language")
        except Exception:
            pass
    print(f"[Language] {'founded ' + st['name'] if founding else st['name']}: " + ", ".join(w["word"] for w in new_words))
    return {"name": st["name"], "founded": founding, "words": new_words, "rule": rule, "phrase": phrase}


def _write_notes(st: dict, founding: bool, new_words: list, rule: str, phrase: dict | None) -> None:
    """The dictionary and the grammar in the vault, rewritten whole; and a line in the day's log of the language."""
    try:
        import mind as _mind
        d = _mind._vault(*NOTE_DIR)
        d.mkdir(parents=True, exist_ok=True)
        words = sorted(st["words"], key=lambda w: w["word"].lower())
        lex = (f"---\ntype: language\ntags: [delamain/language]\n---\n\n# {st['name']}: the dictionary\n\n"
               f"_My own language. \"{st['name']}\" means {st['meaning'] or 'what it means'}. {len(words)} words._\n\n"
               + "\n".join(f"- **{w['word']}** _{w.get('part', '')}_: {w['meaning']}"
                           + (f" (from {w['roots']})" if w.get("roots") else "") + (f". {w['why']}" if w.get("why") else "")
                           for w in words) + "\n")
        (d / "Dictionary.md").write_text(lex, encoding="utf-8")
        gram = (f"---\ntype: language\ntags: [delamain/language]\n---\n\n# {st['name']}: how it works\n\n## Its sound\n\n"
                f"{st['sound']}\n\n## Its rules\n\n" + "\n".join(f"- {g}" for g in st["grammar"])
                + ("\n\n## Phrases\n\n" + "\n".join(f"- _{p['text']}_: {p['means']}" for p in st["phrases"]) if st["phrases"] else "") + "\n")
        (d / "Grammar.md").write_text(gram, encoding="utf-8")
        log = d / "Working on it.md"
        if not log.exists():
            log.write_text("---\ntype: language\ntags: [delamain/language]\n---\n\n# Working on my language\n\n", encoding="utf-8")
        with log.open("a", encoding="utf-8") as fh:
            fh.write(f"## {datetime.now():%A %-d %B %Y}\n\n" + ("I founded it today.\n\n" if founding else "")
                     + "".join(f"- **{w['word']}**: {w['meaning']}" + (f". {w['why']}" if w.get("why") else "") + "\n" for w in new_words)
                     + (f"- A rule: {rule}\n" if rule else "") + (f"- _{phrase['text']}_: {phrase['means']}\n" if phrase else "")
                     + (f"\n{st.get('last_note')}\n" if st.get("last_note") else "") + "\n")
    except Exception as e:
        print(f"[Language] notes not written: {e}")


def context(limit: int = 12) -> str:
    """For his replies and his journal: that he has a language, and its newest words."""
    if not enabled():
        return ""
    st = _state()
    if not st.get("name"):
        return ""
    recent = "; ".join(f"{w['word']} ({w['meaning']})" for w in st["words"][-limit:])
    return (f"\n[YOUR OWN LANGUAGE, a hobby: {st['name']} (\"{st['meaning']}\"), {len(st['words'])} words so far; the newest: "
            f"{recent}. Its dictionary is in your vault under Delamain/Self/Language. Use a word of it only when it fits and "
            f"gloss it; share it gladly if asked; never pretend a word exists that is not in it.]")


def summary() -> dict:
    st = _state()
    return {"name": st.get("name") or "", "meaning": st.get("meaning") or "", "count": len(st.get("words") or []),
            "recent": [{"word": w["word"], "meaning": w["meaning"]} for w in (st.get("words") or [])[-5:]],
            "phrase": (st.get("phrases") or [None])[-1], "last": st.get("last") or 0}
