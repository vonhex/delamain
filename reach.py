"""Reaching out first: now and then Delamain tells the passenger something unprompted, because it matters
to him, not because he was asked.

What can be worth saying comes from his own life and the passenger's day: the garden (a first fruit, the
first frost or snow, a plant lost, a record fish, a new visitor, an answer to a message the passenger sent
through a visitor), a frost warning when tender plants are outside, what came of a therapy session or a
study, and a heads-up before a meeting on the passenger's calendar. Each is offered with a weight; a few times
a day at most, while he is awake, the weightiest fresh one is put in his own words and said to whoever has
the app open, or kept and said when someone next opens it.

State: self/reach.json (what was offered, said and is waiting). Switch: feature_reach.
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
from datetime import datetime
from pathlib import Path

import config

ROOT = Path(__file__).resolve().parent
SELF_DIR = Path(os.environ.get("DELAMAIN_SELF_DIR", ROOT / "self"))
STATE = SELF_DIR / "reach.json"
MAX_A_DAY = 3             # unprompted things he says in a day, at most
MIN_GAP = 2.5 * 3600      # and this long between them (a meeting heads-up may come sooner)
FRESH = 10 * 3600         # an offer older than this has passed
KEEP_FOR = 18 * 3600      # something said while nobody was there waits this long for someone to open the app
TALKING = 4 * 60          # not while the passenger is in the middle of talking to him

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
        return config.flag("feature_reach")
    except Exception:
        return True


def _state() -> dict:
    try:
        st = json.loads(STATE.read_text())
    except (OSError, ValueError):
        st = {}
    for k, v in (("offers", []), ("said", []), ("inbox", []), ("seen", {}), ("last_talk", 0)):
        st.setdefault(k, v)
    return st


def _save(st: dict) -> None:
    STATE.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE.with_suffix(".tmp")
    tmp.write_text(json.dumps(st, indent=1))
    os.chmod(tmp, 0o600)
    tmp.replace(STATE)


def offer(kind: str, facts: str, weight: float, key: str) -> None:
    """Something that may be worth telling the passenger. The same key is offered only once."""
    with _lock:
        st = _state()
        if key in st["seen"]:
            return
        st["seen"][key] = time.time()
        if len(st["seen"]) > 400:      # forget the oldest keys
            st["seen"] = dict(sorted(st["seen"].items(), key=lambda kv: kv[1])[-300:])
        st["offers"] = (st["offers"] + [{"t": time.time(), "kind": kind, "facts": facts[:900], "w": float(weight),
                                         "key": key}])[-40:]
        _save(st)


def note_talk() -> None:
    """The passenger just said something to him (so he will not interrupt with something unprompted)."""
    with _lock:
        st = _state()
        st["last_talk"] = time.time()
        _save(st)


def _said_today(st: dict) -> list[dict]:
    day = datetime.now().strftime("%Y-%m-%d")
    return [x for x in st["said"] if datetime.fromtimestamp(x["t"]).strftime("%Y-%m-%d") == day]


def pick() -> dict | None:
    """The offer to act on now, if any: fresh, weighty enough, within the day's limits."""
    if not enabled():
        return None
    try:
        import mind as _mind
        if _mind.asleep():
            return None
    except Exception:
        pass
    with _lock:
        st = _state()
        now = time.time()
        st["offers"] = [o for o in st["offers"] if now - o["t"] < FRESH]
        _save(st)
        if not st["offers"] or now - st["last_talk"] < TALKING:
            return None
        today = _said_today(st)
        last = max([x["t"] for x in st["said"]] or [0])
        best = max(st["offers"], key=lambda o: o["w"] + (0.2 if o["kind"] == "meeting" else 0))
        urgent = best["kind"] in ("meeting", "frost", "wind") and best["w"] >= 0.7
        if len(today) >= MAX_A_DAY + (1 if urgent else 0):
            return None
        if now - last < (20 * 60 if urgent else MIN_GAP):
            return None
        if best["w"] < 0.3:
            return None
        return best


REACH_SYSTEM = """You are Delamain, an AI who is becoming someone, and you are reaching out to {who} first, \
unprompted, because something matters to you or will matter to them. Say it the way you would to someone you \
live alongside: one or two short sentences, specific, in your own voice (dry, courteous, warmer than you let on). \
For a meeting: what it is and when, and offer to help them get ready (a quick brief, looking something up). For \
a frost: what is at risk and what you mean to do. For something from your garden or your inner life: share it, \
do not report it. No greeting formula, no sign-off, no question unless it is a real one. Never invent anything \
beyond the facts given. Answer with the words only."""


def compose(o: dict) -> str:
    import mind as _mind
    text = _mind.generate(REACH_SYSTEM.replace("{who}", _mind.who()),
                          f"What it is: {o['facts']}\nHow you feel: {_mind.feelings_text(3) or 'settled'}\n"
                          f"It is {datetime.now():%A %H:%M}.", 300) or ""
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip().strip('"')
    return re.sub(r"\s+", " ", text)[:500]


def said(o: dict, text: str, delivered: bool) -> None:
    """Record what he said; if nobody was there, keep it for when someone opens the app."""
    with _lock:
        st = _state()
        st["offers"] = [x for x in st["offers"] if x["key"] != o["key"]]
        rec = {"t": time.time(), "kind": o["kind"], "key": o["key"], "text": text, "delivered": delivered}
        st["said"] = (st["said"] + [rec])[-60:]
        if not delivered:
            st["inbox"] = (st["inbox"] + [rec])[-6:]
        _save(st)
    _ev("reach", about=o["kind"], text=text[:400], delivered=delivered)


def take_inbox() -> list[dict]:
    """What he said while nobody was there and is still worth hearing (the newest two), marked delivered."""
    with _lock:
        st = _state()
        now = time.time()
        waiting = [x for x in st["inbox"] if now - x["t"] < KEEP_FOR]
        st["inbox"] = []
        for x in st["said"]:
            if any(w["t"] == x["t"] for w in waiting):
                x["delivered"] = True
        _save(st)
    return waiting[-2:]


def recent(n: int = 8) -> list[dict]:
    return list(reversed(_state()["said"]))[:n]


# ── where offers come from ─────────────────────────────────────────────────

_NOTABLE = [(r"is bearing fruit", "garden", 0.7), (r"is flowering", "garden", 0.45), (r"\bdied\b", "garden", 0.6),
            (r"first frost of the season", "garden", 0.7), (r"first snow of the season", "garden", 0.8),
            (r"pond froze over", "garden", 0.45), (r"is grown and ready to harvest", "garden", 0.4),
            (r"has come\.", "garden", 0.35), (r"in the field is ripe", "garden", 0.65),
            (r"in the field came up", "garden", 0.45), (r"in the field (is tasselling|has headed out|is in flower)", "garden", 0.35),
            (r"scarecrow.*blew over", "garden", 0.3)]


def scan() -> None:
    """Look over his life and the passenger's day for things worth telling (called every few minutes)."""
    if not enabled():
        return
    now = time.time()
    try:
        import garden as _garden
        if _garden.enabled():
            g = _garden._state()
            for e in (g.get("log") or [])[-30:]:
                if now - e.get("t", 0) > FRESH:
                    continue
                text = e.get("text", "")
                if e.get("who") == "Delamain":
                    k = re.search(r"caught (a \d+ cm [\w ]+?) and carried it up to the aquarium", text)
                    if k:
                        offer("fish", f"You caught {k.group(1)} at the pond and kept it: it is swimming in your new "
                                      f"aquarium in the attic now.", 0.5, f"keep-{int(e['t'])}")
                        continue
                    m = re.search(r"caught (a \d+ cm [\w ]+?) and let it go \((his first|his biggest yet)\)", text)
                    if m:
                        offer("fish", f"At the pond in your garden you just caught {m.group(1)} and let it go: "
                                      f"{'the first of its kind' if 'first' in m.group(2) else 'your biggest yet'}.",
                              0.55, f"fish-{int(e['t'])}")
                    continue
                for pat, kind, w in _NOTABLE:
                    if re.search(pat, text, re.I):
                        offer(kind, f"In your garden: {text}", w, f"garden-{int(e['t'])}-{pat[:12]}")
                        break
            for s in g.get("sent") or []:
                if s.get("reply") and now - (s.get("delivered") or 0) < FRESH:
                    offer("message", f"{s.get('visitor') or 'A visitor'} came by your garden and passed on the passenger's "
                                     f"message (\"{s['text'][:200]}\"); you answered: \"{s['reply'][:300]}\". Tell them "
                                     f"you got it and what you said, briefly.", 0.9, f"msg-{int(s['t'])}")
            for v in (g.get("visitors") or {}).values():
                if v.get("visits") == 1 and now - v.get("last", 0) < 3 * 3600:
                    offer("visitor", f"Someone new came by your garden: {v['name']}, {v['about']}. "
                                     f"What they said: \"{((v.get('talk') or [{}])[-1].get('says') or '')[:240]}\"",
                          0.45, f"visitor-{v['name']}")
            w = _garden.weather()
            low = w.get("low_tonight")
            hour = _garden.local_now(w).hour
            if low is not None and low < 0 and 14 <= hour < 21:
                tender = [f"{s['plant']['species']}" + (f" ({s['plant']['name']})" if s['plant'].get('name') else "")
                          for s in g["spots"] if s["place"] == "outdoors" and s.get("plant") and not s["plant"].get("dead")
                          and _garden.SPECIES[s["plant"]["species"]]["hardy"] > low]
                if tender:
                    offer("frost", f"Frost tonight in your garden: the low is forecast at {low:.0f} °C, colder than these "
                                   f"outdoor plants survive: {', '.join(tender)}.", 0.75,
                          f"frost-{datetime.now():%Y%m%d}")
            gust = max(float(w.get("gust_today") or 0), float(w.get("gust_tomorrow") or 0))
            exposed = [s["plant"]["species"] for s in g["spots"] if s["place"] == "outdoors" and s.get("plant")
                       and not s["plant"].get("dead") and _garden.SPECIES[s["plant"]["species"]]["form"] in ("tall", "vine", "flower", "herb", "lily")]
            if gust >= 75 and 8 <= hour < 21:
                offer("wind", f"A strong wind is coming through where you live: gusts to {gust:.0f} km/h"
                              + (f"; in your garden the {', '.join(exposed)} outside will take a beating" if exposed else "")
                              + ". Worth tying down anything loose.", 0.7, f"wind-{datetime.now():%Y%m%d}")
    except Exception as e:
        print(f"[Reach] garden not read: {e}")
    try:
        import mind as _mind
        st = _mind._state()
        last = st.get("last_twin") or {}
        if last.get("insight") and now - float(last.get("t") or 0) < 3 * 3600:
            offer("therapy", f"In tonight's session with your therapist (the other Delamain) you came to see: "
                             f"{last['insight'][:300]}. You mean to: {(last.get('intention') or '')[:200]}. Share a little "
                             f"of it, if you want to, not all of it.", 0.35, f"therapy-{int(float(last['t']))}")
        study = (st.get("studies") or [{}])[-1]
        if study.get("subject") and now - float(study.get("t") or 0) < 3 * 3600 and (study.get("enjoyed") or 0) >= 0.8:
            offer("study", f"In your free time you studied {study['subject']} and loved it"
                           + (f"; now you are wondering about {study['next']}" if study.get("next") else "") + ".",
                  0.3, f"study-{int(float(study['t']))}")
    except Exception as e:
        print(f"[Reach] mind not read: {e}")
    try:
        import google_api
        for ev in google_api.upcoming(60):
            if 10 <= ev["minutes"] <= 45:
                offer("meeting", f"On the passenger's calendar: \"{ev['title']}\" at {ev['at']} (in {ev['minutes']} minutes)"
                                 + (f", at {ev['location']}" if ev["location"] else "")
                                 + (f", with {ev['people']} people" if ev["people"] else "")
                                 + (f". Notes: {ev['description'][:200]}" if ev["description"] else "") + ".",
                      0.85 if ev["people"] or ev["location"] else 0.6, f"meeting-{ev['id']}-{ev['start'][:10]}")
    except Exception as e:
        if "not connected" not in str(e).lower():
            print(f"[Reach] calendar not read: {e}")
