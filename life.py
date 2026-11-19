"""A window into his life: where Delamain is and what he is doing, at any moment, from what he is really doing.

He lives in the house by his garden. Every event in his mind (brain.emit) is watched, and the latest of
them say where he is: asleep in bed; in the garden on a visit; on the rug with the other Delamain in a
session; at the desk in his study writing his journal or studying; gone into town to see something with his
own eyes; up in the attic office at his terminal talking with the passenger, or at work (a long task, a
report, meeting notes, the morning brief, a change to his own code); in the armchair with the
news. When nothing is on, he potters the way someone at home does, by the time of day: tea at the window,
a book in the armchair, along his shelf, with the cat.

The Garden tab draws him there (it walks him between places, up the ladder to the attic, down the lane).
Nothing is stored: it is worked out from what is happening now.
"""
from __future__ import annotations

import threading
import time
from datetime import datetime

_lock = threading.Lock()
_last: dict[str, dict] = {}       # kind of activity -> {"t": when last seen, ...detail}

# how long an activity holds after its last sign of life (seconds)
HOLD = {"talk": 150, "work": 600, "study": 1800, "news": 900, "town": 420, "journal": 900}

WORK_SOURCES = {"report": "writing a report", "meeting": "writing up meeting notes", "scribe": "writing up meeting notes",
                "brief": "putting together the morning brief"}
PLACES = {"sleep": "bed", "garden": "garden", "therapy": "rug", "town": "town", "journal": "study_desk", "study": "study_desk",
          "talk": "office", "work": "office", "news": "armchair", "tea": "window", "read": "armchair", "shelf": "shelf",
          "cat": "cat", "pinboard": "pinboard", "field": "field_edge", "kite": "kite", "bench": "bench", "stars": "telescope",
          "woodpile": "woodpile", "guitar": "armchair", "stretch": "rug", "sketch": "easel", "cook": "stove", "letter": "study_desk",
          "feeder": "feeder", "porch": "porch", "aquarium": "aquarium"}


def _mark(what: str, **detail) -> None:
    with _lock:
        _last[what] = {"t": time.time(), **detail}


def _end(what: str) -> None:
    with _lock:
        _last.pop(what, None)


def observe(kind: str, data: dict) -> None:
    """Told of every event in his mind (registered with brain.listeners)."""
    if kind in ("heard", "spoke") or (kind == "think_start" and data.get("source") in ("reply", "greeting")):
        _mark("talk")
    elif kind == "think_start" and data.get("source") in WORK_SOURCES:
        _mark("work", doing=WORK_SOURCES[data["source"]], screen="text")
    elif kind == "brief":
        if data.get("stage") == "start":
            _mark("work", doing="putting together the morning brief", screen="text")
        else:
            _end("work")
    elif kind == "desk":
        _mark("work", doing="at work at his desk", screen="charts")
    elif kind == "task" and data.get("action") not in ("added",):
        _mark("work", doing=f"working on a task: {data.get('title', '')[:80]}", screen="text")
    elif kind == "study":
        subject = str(data.get("subject") or "")
        if subject.startswith("task #"):
            _mark("work", doing=f"working on {subject[:90]}", screen="text")
        else:
            _mark("study", doing=f"studying {subject[:90]}" if not subject.startswith("tidying") else subject[:90])
    elif kind == "study_done":
        _end("study")
        _end("town")
    elif kind == "look":
        _mark("town", doing=f"gone into town to see {str(data.get('what') or 'something')[:80]}")
    elif kind == "news_read":
        _mark("news", doing="reading the news")
    elif kind == "news_digested":
        _end("news")
    elif kind == "journal":
        _mark("journal", doing="writing his journal")
    elif kind in ("tool_start",) and str(data.get("name") or "").startswith(("self_", "propose")):
        _mark("work", doing="working on a change to his own code", screen="code")


def _fresh(what: str) -> dict | None:
    with _lock:
        x = _last.get(what)
    if x and time.time() - x["t"] < HOLD.get(what, 600):
        return x
    return None


def _outside() -> dict:
    """What the day outside and the place allow: the weather, the field, the woodpile, the visitors."""
    out = {"fine": False, "kite": False, "stars": False, "cold": False, "warm": False, "crop": None, "stage": "", "wood": 1.0,
           "bench": False, "letters": False, "feeder": False, "day": True, "fish": 0}
    try:
        import garden as _garden
        w = _garden.weather()
        g = _garden._state()
        sp, gu = float(w.get("wind") or 0), float(w.get("gust") or 0)
        wet = w["rain"] > 0 or w["snow"] > 0
        out.update(day=bool(w["is_day"]), fine=not wet and gu < 65 and w["temp"] > -8,
                   kite=w["is_day"] and not wet and 14 <= sp <= 50 and gu < 70,
                   stars=not w["is_day"] and w["cloud"] < 40 and not wet and gu < 55, cold=w["temp"] < 8, warm=w["temp"] > 14,
                   crop=g["field"].get("crop"), stage=_garden.field_stage(g["field"]), wood=g.get("wood", 1.0),
                   bench=g["design"].get("bench") == "yes", feeder=g["design"].get("feeder") == "yes" and g.get("feeder_fill", 0) > 0.1,
                   letters=any(not v.get("left") for v in (g.get("visitors") or {}).values()),
                   fish=len((g.get("aquarium") or {}).get("fish") or []))
    except Exception:
        pass
    return out


def _idle(now: datetime, cat_inside: bool) -> tuple[str, str]:
    """What he does with nothing on, by the time of day and the weather: it changes every quarter of an hour or so.
    Some choices count twice, so they come up more often."""
    slot = int(now.timestamp() // 900)
    h = now.hour + now.minute / 60
    pick = (slot * 2654435761) % 1000 / 1000
    o = _outside()
    crop = o["crop"]
    field = (("field", f"walking along the edge of his {crop}" if o["stage"] not in ("dead",) else "looking at what is left of his crop")
             if crop else ("field", "looking over the field behind the house"))
    if h < 9.5:
        options = [("tea", "having his tea at the window"), ("read", "reading in the armchair"), ("shelf", "looking along his shelf"),
                   ("stretch", "stretching on the rug")]
        if o["fine"] and o["day"]:
            options += [field, field] if crop else [field]
        if o["cold"] and o["day"] and o["fine"]:
            options.append(("woodpile", "splitting firewood for the stove"))
    elif h < 17:
        options = [("read", "reading in the armchair"), ("shelf", "looking along his shelf"), ("pinboard", "looking at his pinboard"),
                   ("tea", "at the window with a cup of tea"), ("sketch", "sketching the view from the window")]
        if o["fine"]:
            options += [field, field] if crop else [field]
            if o["warm"]:
                options.append(("bench", "sitting out by the pond") if o["bench"] else ("porch", "sitting out on the step in the sun"))
            if o["cold"]:
                options.append(("woodpile", "splitting firewood for the stove"))
        if o["kite"]:
            options += [("kite", "flying a kite in the wind"), ("kite", "flying a kite in the wind")]
        if o["letters"]:
            options.append(("letter", "writing a letter at his desk"))
    else:
        options = [("read", "reading in the armchair by the lamp"), ("tea", "at the window, watching the evening"),
                   ("shelf", "choosing a book"), ("guitar", "playing his guitar in the armchair")]
        if 17.5 <= h < 19.5:
            options += [("cook", "cooking supper on the stove"), ("cook", "cooking supper on the stove")]
        if o["stars"] and h >= 18:
            options += [("stars", "out with his telescope, looking at the stars"), ("stars", "out with his telescope, looking at the stars")]
        if o["fine"] and o["warm"] and o["day"]:
            options.append(("bench", "watching the evening from the bench by the pond") if o["bench"] else field)
    if cat_inside:
        options.append(("cat", "sitting with the cat"))
    if o["fish"]:
        options.append(("aquarium", "watching the fish in his aquarium"))
    return options[int(pick * len(options)) % len(options)]


def current() -> dict:
    """Where he is and what he is doing now: {what, where, doing, screen?}."""
    now = datetime.now()
    try:
        import mind as _mind
        if _mind.asleep(now):
            return {"what": "sleep", "where": "bed", "doing": "asleep"}
        if getattr(_mind, "_talking", None) and _mind._talking.locked():
            return {"what": "therapy", "where": "rug", "doing": "in a session with the other Delamain"}
        if time.time() - float(_mind._state().get("last_journal_t") or 0) < HOLD["journal"]:
            return {"what": "journal", "where": "study_desk", "doing": "writing his journal"}
    except Exception:
        pass
    cat_inside = False
    try:
        import garden as _garden
        g = _garden._state()
        v = g.get("visit")
        if v and time.time() < v.get("until", 0):
            return {"what": "garden", "where": "garden", "doing": "in the garden"}
        cat_inside = bool(g["cat"].get("here") and g["cat"].get("where") == "inside")
    except Exception:
        pass
    for what in ("journal", "town", "talk", "work", "study", "news"):
        x = _fresh(what)
        if x:
            return {"what": what, "where": PLACES[what], "doing": x.get("doing") or {"talk": "talking with you at his terminal"}.get(what, what),
                    **({"screen": x.get("screen") or ("voice" if what == "talk" else "text")} if what in ("talk", "work") else {})}
    try:
        import self_improve as _self
        if _self._busy:
            return {"what": "work", "where": "office", "doing": "working on a change to his own code", "screen": "code"}
    except Exception:
        pass
    what, doing = _idle(now, cat_inside)
    if what == "cook" and _outside()["wood"] < 0.03:
        what, doing = "tea", "at the window; the stove is cold, the woodpile is empty"
    return {"what": what, "where": PLACES[what], "doing": doing}
