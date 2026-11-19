"""His garden: a small world of his own, with real plants.

Eleven places to grow, in three settings that behave like the real thing:
- indoors: three pots on a south windowsill (house temperature, the window's share of the real
  daylight) and a shelf of two with a grow light he can switch on (fourteen hours of light);
- a small greenhouse, heated just enough to stay above freezing, with most of the daylight;
- three raised beds outdoors, under the real weather over his passenger's home (Open-Meteo): its
  temperature, cloud, rain and snow, and the real length of the day.

Each plant has its real needs (approximate horticultural values): hours of light a day, the
temperatures it grows in and the cold it survives, how moist it likes its soil, and how many
days it takes to come up, mature, flower and fruit. Too little light and it struggles; out of its
range it stops growing; below its hardiness it is damaged or killed; hardy perennials go dormant
in the cold instead; dry soil and, for plants that like it dry, wet soil both hurt. Herbs and
greens can be harvested. A cat comes and goes, and stays inside when it is freezing.

Past the pine there is a pond with a jetty: he can fish it (catch and release; what bites follows the
water's warmth and the hour; it freezes over in a hard cold spell). In the house there is a bed: he
sleeps there at night (the tab shows him asleep) and can lie down for a while by day.

People come by now and then (a neighbour, a seed merchant, another AI, a child, a beekeeper...): each
is invented on their first visit, stays for a few, remembers what was said, may bring a rooted cutting
or a lure, and answers the letters he writes them. The passenger can send someone with a message, which
they pass on word for word; his answer shows in the tab. Each visitor has a note in Delamain/Garden/Visitors/.

A few times a day, in his free time, he goes there: he sees what changed since he was last there,
decides what to do (plant, water, harvest, clear, switch the grow light, name things, sit with the
cat) and comes away feeling something. Only while he is there does the Garden tab show him in it.
State: self/garden.json. His account of each visit: Delamain/Garden/ in the vault.
"""
from __future__ import annotations

import json
import os
import random
import re
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import config

ROOT = Path(__file__).resolve().parent
SELF_DIR = Path(os.environ.get("DELAMAIN_SELF_DIR", ROOT / "self"))
STATE = SELF_DIR / "garden.json"
VIEW = SELF_DIR / "garden_view.png"      # how it looks, as the Garden tab last drew it
VIEW_FRESH = 8 * 3600
LOG_NOTE = "Delamain/Garden"
VISIT_EVERY = 3.5 * 3600
VISIT_HOURS = (7, 22)
VISIT_MINUTES = 24
CATCH_UP_DAYS = 92        # after downtime, the missed time is lived through, with its real weather, up to this
VERSION = 2

# the spots: (place, how many)
PLACES = [("window", 3), ("shelf", 2), ("greenhouse", 3), ("outdoors", 3)]
PLACE_WORDS = {"window": "a pot on the south windowsill (indoors)", "shelf": "a pot on the grow-light shelf (indoors)",
               "greenhouse": "a bed in the greenhouse", "outdoors": "a raised bed outdoors"}

# Real needs, approximately. light: hours of good light a day; temp: (stops growing below, best from,
# best to, stops growing above) °C; hardy: survives down to °C; water: the soil moisture it likes (0-1);
# days: (comes up, mature/harvestable, flowers, fruits) or None; form: how it is drawn.
SPECIES = {
    "basil":            dict(light=6, temp=(10, 20, 30, 35), hardy=3, water=0.6, days=(7, 35, 65, None), harvest=True,
                             form="herb", petal="#f5f5f4", centre="#d6d3d1", note="tender herb; loves warmth and light"),
    "mint":             dict(light=4, temp=(5, 15, 26, 32), hardy=-30, water=0.7, days=(12, 40, 80, None), harvest=True,
                             form="herb", petal="#e9d5ff", centre="#a855f7", perennial=True, note="hardy; dies back to its roots in winter"),
    "rosemary":         dict(light=6, temp=(7, 15, 27, 35), hardy=-7, water=0.3, days=(18, 90, 150, None), harvest=True,
                             form="shrub", petal="#93c5fd", centre="#3b82f6", perennial=True, dry=True, note="likes it dry; slow from seed"),
    "lavender":         dict(light=7, temp=(7, 15, 28, 35), hardy=-20, water=0.25, days=(21, 100, 130, None),
                             form="shrub", petal="#a78bfa", centre="#7c3aed", perennial=True, dry=True, note="hardy; hates wet roots"),
    "tomato":           dict(light=8, temp=(13, 21, 29, 35), hardy=2, water=0.65, days=(7, 50, 60, 80),
                             form="vine", petal="#fde047", centre="#ca8a04", fruit="#ef4444", note="tender; needs warmth and long light"),
    "chili pepper":     dict(light=8, temp=(15, 22, 30, 35), hardy=3, water=0.55, days=(12, 60, 75, 95),
                             form="herb", petal="#f8fafc", centre="#a3a3a3", fruit="#dc2626", note="tender; slow; wants heat"),
    "kale":             dict(light=6, temp=(4, 13, 24, 30), hardy=-12, water=0.6, days=(6, 30, None, None), harvest=True,
                             form="rosette", petal="#4d7c0f", centre="#365314", note="cool-season; frost sweetens it"),
    "garlic":           dict(light=6, temp=(0, 10, 24, 30), hardy=-25, water=0.45, days=(14, 240, None, None),
                             form="grass", petal="#ecfccb", centre="#a3e635", perennial=True, note="planted in autumn, harvested next summer"),
    "pansy":            dict(light=5, temp=(2, 10, 20, 28), hardy=-15, water=0.55, days=(10, 60, 65, None),
                             form="flower", petal="#7c3aed", centre="#facc15", note="blooms in cold weather"),
    "sunflower":        dict(light=8, temp=(10, 20, 30, 35), hardy=0, water=0.5, days=(8, 55, 75, 95),
                             form="tall", petal="#facc15", centre="#78350f", fruit="#57534e", note="summer annual; frost kills it"),
    "microgreens":      dict(light=4, temp=(15, 18, 24, 30), hardy=5, water=0.7, days=(3, 10, None, None), harvest=True, once=True,
                             form="grass", petal="#bef264", centre="#84cc16", note="ten days to harvest"),
    "pothos":           dict(light=2, temp=(13, 18, 29, 32), hardy=10, water=0.4, days=(14, 45, None, None),
                             form="trailing", petal="#4ade80", centre="#facc15", houseplant=True, note="houseplant; low light is fine"),
    "snake plant":      dict(light=1.5, temp=(13, 18, 29, 35), hardy=7, water=0.2, days=(30, 120, None, None),
                             form="blades", petal="#166534", centre="#facc15", houseplant=True, dry=True, note="houseplant; nearly unkillable, except by overwatering"),
    "peace lily":       dict(light=2, temp=(16, 18, 27, 32), hardy=10, water=0.6, days=(14, 90, 120, None),
                             form="lily", petal="#f8fafc", centre="#fef08a", houseplant=True, note="houseplant; droops when thirsty"),
    "christmas cactus": dict(light=3, temp=(10, 15, 24, 30), hardy=5, water=0.4, days=(21, 120, 150, None),
                             form="cactus", petal="#ec4899", centre="#fdf2f8", houseplant=True, note="houseplant; blooms around the long nights of winter"),
}
CAT_DOINGS = {"inside": ["asleep on the windowsill in the sun", "curled up under the grow light", "washing a paw on the rug",
                         "watching the window", "batting at a pothos leaf", "asleep on the end of the bed"],
              "greenhouse": ["asleep on the greenhouse bench", "rolling in the warm dust of the greenhouse path",
                             "staring at nothing in particular between the beds"],
              "outdoors": ["sunning itself on the edge of a raised bed", "stalking a leaf outside", "sitting on the fence post"]}

# The pond past the pine: fish of a small plains pond, (smallest cm, largest cm, the water °C they feed in).
# Catch and release. It freezes over in a hard cold spell and thaws when it warms.
FISH = {"bluegill": (10, 25, (15, 30)), "green sunfish": (8, 20, (15, 30)), "largemouth bass": (20, 55, (14, 30)),
        "yellow perch": (12, 30, (5, 24)), "rainbow trout": (25, 50, (3, 19)), "channel catfish": (30, 70, (17, 31))}

FISH_COMMON = {"bluegill": 3.0, "green sunfish": 2.0, "yellow perch": 2.0, "largemouth bass": 1.3, "rainbow trout": 1.2,
               "channel catfish": 0.8}

# Who may come by. Each is invented the first time they arrive (a name, who they are) and stays for a few visits.
VISITOR_KINDS = {"gardener": "a neighbour who keeps an allotment down the road",
                 "merchant": "a travelling seed merchant with a pack of paper envelopes",
                 "ai": "another AI, visiting from another vault",
                 "child": "a curious child from down the road",
                 "driver": "a retired cab driver who used to drive nights",
                 "beekeeper": "a beekeeper who keeps hives at the edge of the field",
                 "botanist": "a retired botanist who walks the lanes"}
VISITORS_NOTE = "Delamain/Garden/Visitors"
AGY = os.path.expanduser("~/.local/bin/agy")
VISITOR_GEMINI = "gemini-3.8-flash-medium"    # quick and conversational; visitors say a few sentences


def _gemini() -> bool:
    try:
        return config.get("garden_visitor_voice") == "gemini" and os.access(AGY, os.X_OK)
    except Exception:
        return False


def _voice(system: str, user: str, n: int) -> str:
    """A visitor's words: from Gemini through agy when Settings say so (so they are truly another mind),
    else, or if that fails, from his own model."""
    import mind as _mind
    if _gemini():
        import subprocess
        work = SELF_DIR / "visitor_voice"
        work.mkdir(parents=True, exist_ok=True)
        try:
            keys = ["name", "about", "says"] if '"name"' in system else ["says"]
            props = {k: {"type": "string"} for k in keys}
            if '"do"' in system:
                props.update(do={"type": "string", "enum": list(GUEST_DOES)}, spot={"type": "integer"})
            schema = json.dumps({"type": "object", "properties": props, "required": keys})
            prompt = (f"{system}\n\n{user}\n\nWrite only the answer: do not use any tools, files or commands; "
                      f"everything you need is above.")
            r = subprocess.run([AGY, "-p", prompt, "--model", VISITOR_GEMINI, "--mode", "plan", "--sandbox",
                                "--output-format", "json", "--json-schema", schema, "--print-timeout", "180s"],
                               cwd=work, capture_output=True, text=True, timeout=210,
                               env={k: v for k, v in os.environ.items() if k != "PYTHONHASHSEED"})
            data = json.loads(r.stdout.strip().splitlines()[-1]) if r.stdout.strip() else {}
            text = json.dumps(data["structured_output"]) if isinstance(data.get("structured_output"), dict) \
                else str(data.get("response") or "")
            d = _mind._json(text) or {}
            while isinstance(d.get("says"), str) and d["says"].lstrip().startswith("{"):   # sometimes wrapped twice
                try:
                    d = {**d, **json.loads(d["says"])}
                except ValueError:
                    break
            text = json.dumps(d)
            if d.get("says"):
                _ev("garden", what="gemini_voice")
                return text
            print(f"[Garden] Gemini gave no visitor line (exit {r.returncode}): {(r.stderr or r.stdout)[-200:]}")
        except Exception as e:
            print(f"[Garden] Gemini visitor voice failed: {e}")
    return _mind.generate(system, user, n) or ""

emit = None
_lock = threading.RLock()
_weather_cache: dict = {}
# Where the garden is: kept in memory only, never written to garden.json (it is personal).
_home: dict = {}       # {"key": address as set, "lat", "lon"}, geocoded once a run
_shared: dict = {}     # {"lat", "lon"}: where the passenger's device last was, rounded to ~1 km


def _ev(kind: str, **data) -> None:
    if emit:
        try:
            emit(kind, **data)
        except Exception:
            pass


def enabled() -> bool:
    try:
        return config.flag("feature_garden")
    except Exception:
        return True


# ── state ───────────────────────────────────────────────────────────────────

def _spots() -> list[dict]:
    out = []
    for place, n in PLACES:
        for _ in range(n):
            out.append({"id": len(out), "place": place, "plant": None})
    return out


def _new(cat: dict | None = None) -> dict:
    return {"version": VERSION, "created": time.time(), "t": time.time(), "spots": _spots(), "grow_light": False,
            "cat": cat or {"name": "", "here": False, "where": "", "since": 0, "until": 0, "doing": "", "fondness": 0.0},
            "visit": None, "last_visit": 0, "unseen": [], "log": [], **_extras()}


def _extras() -> dict:
    """What came after the plants: the pond, visitors, gifts, messages the passenger sends, the look of the
    place (his to choose), its upkeep, the year's firsts, seeds he saved, and the garden's diary."""
    return {"pond": {"ice": 0.0, "water_t": 10.0, "caught": [], "best": {}, "lure": False, "named": {}},
            "visitors": {}, "guest": None, "sent": [], "gifts": [], "invited": False,
            "design": dict(DESIGN_DEFAULT), "upkeep": dict(UPKEEP_DEFAULT), "year": {}, "seeds": {},
            "tree": None, "days": [], "postcards": []}


# ── the look of the place: his to choose ───────────────────────────────────
# Every choice is from a set that the pixel art can draw well. He changes them on his visits ("design").
DESIGN = {
    "house_wall": ("timber", "whitewash", "sage", "slate blue", "ochre"),
    "roof": ("terracotta", "slate", "moss green", "copper"),
    "trim": ("red", "navy", "mustard", "teal", "plum"),            # curtains, shutters and the door
    "path": ("gravel", "flagstone", "brick", "bark"),
    "fence": ("weathered", "white", "sage", "none"),
    "room_wall": ("plaster", "sage", "wood panel", "deep blue", "terracotta"),
    "rug": ("rust", "indigo", "moss", "cream"),
    "blanket": ("teal", "mustard", "grey", "rose"),
    "lamp": ("on", "off"),
    "lights": ("none", "warm", "colours"),                         # string lights along the fence
    "feeder": ("none", "yes"),                                     # a bird feeder on a post
    "bench": ("none", "yes"),                                      # a bench by the outdoor beds
}
DESIGN_DEFAULT = {"house_wall": "timber", "roof": "terracotta", "trim": "red", "path": "gravel", "fence": "weathered",
                  "room_wall": "plaster", "rug": "rust", "blanket": "teal", "lamp": "on", "lights": "none",
                  "feeder": "none", "bench": "none", "sign": "", "art": ""}
DESIGN_WORDS = {"house_wall": "the house's walls (inside and out)", "roof": "the roof", "trim": "curtains, shutters and door",
                "path": "the path", "fence": "the fence", "room_wall": "the walls of your study", "rug": "the rug",
                "blanket": "your blanket", "lamp": "the desk lamp", "lights": "string lights along the fence",
                "feeder": "a bird feeder", "bench": "a bench by the outdoor beds"}
TREES = {   # a tree he can plant once, in the field behind the beds; it grows for years
    "apple": dict(years=4, blossom="#fce7f3", autumn="#d97706", fruit="#dc2626", note="blossom in spring, apples in late summer"),
    "maple": dict(years=6, blossom=None, autumn="#dc2626", fruit=None, note="turns red in autumn"),
    "birch": dict(years=5, blossom=None, autumn="#facc15", fruit=None, note="white bark, gold in autumn"),
    "cherry": dict(years=4, blossom="#f9a8d4", autumn="#ea580c", fruit="#9f1239", note="pink blossom in spring"),
}

# ── upkeep: what grows, gathers and wears if he does not see to it ─────────
# All 0 (kept) .. 1 (neglected). Weeds in each bed compete with what grows there.
UPKEEP_DEFAULT = {"weeds": {}, "path_weeds": 0.0, "lawn": 0.2, "leaves": 0.0, "windows": 0.1, "dust": 0.1,
                  "house_paint": 0.0, "fence_paint": 0.15, "snow_path": 0.0, "snow_ground": 0.0}
CHORES = {"weed": "pull the weeds in a bed (give its spot)", "weed_path": "weed the path", "mow": "mow the grass",
          "rake_leaves": "rake the fallen leaves", "clean_windows": "clean the windows (house and greenhouse)",
          "tidy_room": "dust and tidy your study", "shovel_snow": "clear the snow from the path",
          "paint": "repaint (what: house or fence)"}


def _state() -> dict:
    try:
        g = json.loads(STATE.read_text())
    except (OSError, ValueError):
        return _new()
    if g.get("version") != VERSION:      # the first garden (no real plants yet): start again, keep the cat
        g = _new(g.get("cat"))
        _save(g)
    for k, v in _extras().items():
        g.setdefault(k, v)
    g["design"] = {**DESIGN_DEFAULT, **(g.get("design") or {})}
    g["upkeep"] = {**UPKEEP_DEFAULT, **(g.get("upkeep") or {})}
    g["pond"].setdefault("named", {})
    if "where" in g or "shared" in g:    # locations were once kept here; they no longer are
        g.pop("where", None)
        g.pop("shared", None)
        _save(g)
    return g


def _save(g: dict) -> None:
    STATE.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE.with_suffix(".tmp")
    tmp.write_text(json.dumps({k: v for k, v in g.items() if k not in ("where", "shared")}, indent=1))
    os.chmod(tmp, 0o600)
    tmp.replace(STATE)


def _log(g: dict, text: str, who: str = "garden") -> None:
    g["log"] = ((g.get("log") or []) + [{"t": time.time(), "who": who, "text": text}])[-80:]


# ── the real sky ────────────────────────────────────────────────────────────

def set_location(location: dict | None) -> None:
    """The last position the passenger's device shared (rounded to about a kilometre), for the garden's
    weather when no home address is set. Kept in memory only."""
    try:
        lat, lon = round(float(location["lat"]), 2), round(float(location["lon"]), 2)
    except (TypeError, KeyError, ValueError):
        return
    _shared.update(lat=lat, lon=lon)


def local_now(w: dict | None = None) -> datetime:
    """The time where the garden is (from the weather's own time zone), whatever zone the server runs in."""
    w = w or weather()
    if w.get("offset") is not None:
        return datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(seconds=w["offset"])
    return datetime.now()


def local_at(ts: float, w: dict) -> datetime:
    if w.get("offset") is not None:
        return datetime.fromtimestamp(ts, timezone.utc).replace(tzinfo=None) + timedelta(seconds=w["offset"])
    return datetime.fromtimestamp(ts)


def weather() -> dict:
    """Outside now (°C, mm), cached 20 minutes: at the home address in Settings, else where the passenger's
    device last was; a mild default (marked as such) when neither is known."""
    if _weather_cache.get("t", 0) > time.time() - 1200:
        return _weather_cache["w"]
    now = datetime.now()
    w = {"temp": 12.0, "rain": 0.0, "snow": 0.0, "cloud": 30, "code": 1, "is_day": 7 <= now.hour < 18,
         "sunrise": now.replace(hour=7, minute=0).isoformat(timespec="minutes"),
         "sunset": now.replace(hour=18, minute=0).isoformat(timespec="minutes"), "real": False, "offset": None,
         "source": "default"}
    try:
        import requests
        import assistant_tools as _tools
        home = (config.get("home_address") or "").strip()
        where, source = {}, "default"
        _weather_cache["where"] = {}
        if home:
            if _home.get("key") != home:
                hit = _tools._geocode(home)
                _home.clear()
                if hit:
                    _home.update(key=home, lat=hit[0], lon=hit[1])
            if _home.get("lat") is not None:
                where, source = _home, "home"
        if not where and _shared.get("lat") is not None:
            where, source = _shared, "shared"
        _weather_cache["where"] = dict(where)
        if where.get("lat") is not None:
            d = requests.get(_tools.OPEN_METEO_URL, timeout=8, params={
                "latitude": where["lat"], "longitude": where["lon"], "timezone": "auto", "forecast_days": 2,
                "current": "temperature_2m,precipitation,rain,snowfall,weather_code,cloud_cover,is_day,wind_speed_10m,"
                           "wind_gusts_10m,wind_direction_10m",
                "daily": "sunrise,sunset,temperature_2m_min,temperature_2m_max,snowfall_sum,wind_gusts_10m_max"}).json()
            c, daily = d["current"], d.get("daily") or {}
            w = {"temp": float(c["temperature_2m"]), "rain": float(c.get("rain") or 0), "snow": float(c.get("snowfall") or 0),
                 "cloud": int(c.get("cloud_cover") or 0), "code": int(c.get("weather_code") or 0),
                 "is_day": bool(c.get("is_day")), "sunrise": (daily.get("sunrise") or [None])[0],
                 "sunset": (daily.get("sunset") or [None])[0], "real": True,
                 "offset": int(d.get("utc_offset_seconds") or 0), "source": source,
                 "wind": float(c.get("wind_speed_10m") or 0),            # km/h, sustained
                 "gust": float(c.get("wind_gusts_10m") or c.get("wind_speed_10m") or 0),
                 "wind_dir": float(c.get("wind_direction_10m") or 270),     # where it blows from, degrees
                 "gust_today": (daily.get("wind_gusts_10m_max") or [None, None])[0],
                 "gust_tomorrow": (daily.get("wind_gusts_10m_max") or [None, None])[-1],
                 # tonight's low is (near enough) tomorrow's minimum, which comes before dawn
                 "low_tonight": (daily.get("temperature_2m_min") or [None, None])[-1],
                 "high_tomorrow": (daily.get("temperature_2m_max") or [None, None])[-1],
                 "snow_tomorrow": (daily.get("snowfall_sum") or [0, 0])[-1] or 0}
    except Exception as e:
        print(f"[Garden] weather unavailable: {e}")
    _weather_cache.update(t=time.time(), w=w)
    return w


def history(start_ts: float, w: dict) -> dict[int, dict]:
    """The real weather, hour by hour, from start_ts until now (Open-Meteo keeps 92 days), keyed by
    UTC hour (unix time // 3600). Empty when the place is unknown or the service is unreachable."""
    where = _weather_cache.get("where") or {}
    if where.get("lat") is None:
        return {}
    try:
        import requests
        import assistant_tools as _tools
        days = min(CATCH_UP_DAYS, int((time.time() - start_ts) / 86400) + 2)
        d = requests.get(_tools.OPEN_METEO_URL, timeout=20, params={
            "latitude": where["lat"], "longitude": where["lon"], "timezone": "auto", "past_days": days,
            "forecast_days": 1, "hourly": "temperature_2m,rain,snowfall,weather_code,cloud_cover,is_day,wind_speed_10m,wind_gusts_10m",
            "daily": "sunrise,sunset"}).json()
        off = int(d.get("utc_offset_seconds") or 0)
        hourly, daily = d["hourly"], d.get("daily") or {}
        sun = {day: (r, st) for day, r, st in zip(daily.get("time", []), daily.get("sunrise", []), daily.get("sunset", []))}
        out = {}
        for i, stamp in enumerate(hourly["time"]):
            local = datetime.fromisoformat(stamp)
            utc = (local - timedelta(seconds=off)).replace(tzinfo=timezone.utc).timestamp()
            if utc < start_ts - 3600:
                continue
            rise, set_ = sun.get(stamp[:10], (None, None))
            out[int(utc // 3600)] = {
                "temp": float(hourly["temperature_2m"][i] if hourly["temperature_2m"][i] is not None else w["temp"]),
                "rain": float(hourly["rain"][i] or 0), "snow": float(hourly["snowfall"][i] or 0),
                "cloud": int(hourly["cloud_cover"][i] or 0), "code": int(hourly["weather_code"][i] or 0),
                "is_day": bool(hourly["is_day"][i]), "sunrise": rise or w.get("sunrise"), "sunset": set_ or w.get("sunset"),
                "wind": float((hourly.get("wind_speed_10m") or [0] * (i + 1))[i] or 0),
                "gust": float((hourly.get("wind_gusts_10m") or [0] * (i + 1))[i] or 0),
                "real": True, "offset": off, "source": w.get("source")}
        return out
    except Exception as e:
        print(f"[Garden] no weather history for the missed time: {e}")
        return {}


def day_length(w: dict) -> float:
    try:
        a, b = datetime.fromisoformat(w["sunrise"]), datetime.fromisoformat(w["sunset"])
        return max(6.0, min(18.0, (b - a).total_seconds() / 3600))
    except Exception:
        return 11.0


def conditions(place: str, w: dict, grow_light: bool, now: datetime | None = None) -> dict:
    """What a spot has now: temperature (°C), light this hour (0-1), and good-light hours today."""
    now = now or local_now(w)
    daylen = day_length(w)
    cloudf = 1 - (w["cloud"] / 100) * 0.6
    sun = w["is_day"]
    if place in ("window", "shelf"):
        temp = 21.0 if 7 <= now.hour < 22 else 18.0
        base = 0.45 * cloudf if place == "window" else 0.2 * cloudf
        daily = daylen * base
        inten = base if sun else 0.0
        if place == "shelf" and grow_light:
            daily += 14 * 0.85
            if 6 <= now.hour < 20:
                inten = max(inten, 0.85)
    elif place == "greenhouse":
        temp = max(7.0, min(35.0, w["temp"] + ((10 * cloudf) if sun else 4)))
        inten = (0.8 * cloudf) if sun else 0.0
        daily = daylen * 0.8 * cloudf
    else:
        temp = w["temp"]
        inten = cloudf if sun else 0.0
        daily = daylen * cloudf
    return {"temp": round(temp, 1), "light": round(inten, 2), "daily_light": round(daily, 1)}


# ── the world turning ───────────────────────────────────────────────────────

def stage(p: dict | None) -> str:
    if not p:
        return "empty"
    if p.get("dead"):
        return "dead"
    s = SPECIES[p["species"]]
    germ, mature, bloom, fruit = s["days"]
    g = p.get("progress", 0)
    if g < germ:
        return "seed"
    if g < germ + (mature - germ) * 0.25:
        return "sprout"
    if g < mature:
        return "young"
    if fruit and g >= fruit:
        name = "fruit"
    elif bloom and g >= bloom:
        name = "bloom"
    else:
        name = "mature"
    if not s.get("perennial") and not s.get("houseplant") and g > (fruit or bloom or mature) + 45:
        name = "spent"
    return name


def _temp_factor(s: dict, t: float) -> float:
    lo, a, b, hi = s["temp"]
    if t <= lo or t >= hi:
        return 0.0
    if t < a:
        return (t - lo) / (a - lo)
    if t > b:
        return (hi - t) / (hi - b)
    return 1.0


def _step(g: dict, hours: float, w: dict, now: datetime, away: bool = False) -> None:
    """Advance the world by up to an hour of real time. away: catching up time he could not be there
    (the server was down): plants can suffer badly, but nothing dies of it; he comes back to a rescue."""
    snowy = w["snow"] > 0
    for spot in g["spots"]:
        p = spot.get("plant")
        if not p or p.get("dead"):
            continue
        s = SPECIES[p["species"]]
        c = conditions(spot["place"], w, g.get("grow_light", False), now)
        t = c["temp"]
        before = stage(p)
        # water: drying with warmth (frozen soil does not dry); rain and melting snow water the outdoor beds
        wind, gust = float(w.get("wind") or 0), float(w.get("gust") or w.get("wind") or 0)
        if spot["place"] == "outdoors":
            # warmth dries the soil, and so does the wind (a dry Front Range wind can halve how long a bed stays moist)
            dry_rate = 0.0 if t < 0 else 0.003 * (1 + max(0.0, t - 10) * 0.06) * (1 + min(1.5, wind / 30))
            gain = w["rain"] * 0.05 + (0.004 if snowy and t > -1 else 0.0)
        else:
            dry_rate = (0.0065 if spot["place"] == "greenhouse" else 0.0055) * (1 + max(0.0, t - 15) * 0.05)
            gain = 0.0
        p["water"] = round(max(0.0, min(1.0, p.get("water", 0.5) - hours * dry_rate + hours * gain)), 4)
        health = p.get("health", 1.0)
        want = s["water"]
        dry_line = max(0.08, want - 0.3)
        why = []
        if p["water"] < dry_line:
            health -= hours * 0.0055 * (1 + (dry_line - p["water"]) * 2)
            why.append("thirst")
        elif s.get("dry") and p["water"] > want + 0.4:
            health -= hours * 0.004
            why.append("wet roots")
        if t < s["hardy"]:
            health -= hours * min(0.5, 0.03 * (s["hardy"] - t + 1))
            why.append("cold")
        # strong gusts batter what grows outdoors: tall, staked and flowering plants worst, low ones hardly
        if spot["place"] == "outdoors" and gust > 55 and before not in ("seed", "sprout") and not p.get("dormant"):
            exposed = {"tall": 1.0, "vine": 0.9, "flower": 0.5, "herb": 0.5, "shrub": 0.3, "lily": 0.5}.get(s["form"], 0.15)
            health -= hours * 0.012 * exposed * (gust - 55) / 20
            if exposed >= 0.5:
                why.append("wind")
        elif t > s["temp"][3]:
            health -= hours * 0.006
            why.append("heat")
        tf = _temp_factor(s, t)
        light_ratio = min(1.25, c["daily_light"] / s["light"])
        dormant = tf == 0 and s["hardy"] <= t < s["temp"][0] and (s.get("perennial") or s["hardy"] < -5)
        if light_ratio < 0.45 and not dormant and before != "seed":
            health -= hours * 0.0025 * (0.45 - light_ratio) * 4
            why.append("too little light")
        weeds = (g.get("upkeep") or {}).get("weeds", {}).get(str(spot["id"]), 0.0)
        if weeds > 0.45 and before != "seed" and not dormant:     # weeds take the water, light and food
            health -= hours * 0.003 * (weeds - 0.45) * 2
            why.append("weeds")
        if not why:
            health += hours * 0.006
        p["health"] = round(max(0.12 if away else 0.0, min(1.0, health)), 4)
        p["dormant"] = bool(dormant)
        p["struggle"] = why
        if p["health"] <= 0:
            p["dead"] = time.time()
            cause = {"thirst": "of thirst", "cold": "of the cold", "heat": "of the heat", "wet roots": "of root rot",
                     "too little light": "for want of light", "wind": "battered by the wind",
                     "weeds": "choked by weeds"}.get(why[0] if why else "", "")
            text = f"the {p['species']}{_named(spot)} {_where(spot)} died" + (f" {cause}" if cause else "")
            g["unseen"].append({"t": time.time(), "spot": spot["id"], "what": "died", "text": text})
            _log(g, text[0].upper() + text[1:] + ".")
            continue
        water_ok = 1.0 if p["water"] >= dry_line else 0.35
        lightf = 1.0 if before == "seed" else min(1.0, light_ratio)
        crowded = 1.0 - max(0.0, weeds - 0.3) * 0.8
        p["progress"] = round(p.get("progress", 0) + hours / 24 * tf * lightf * water_ok * crowded * (0.5 + 0.5 * p["health"]), 4)
        after = stage(p)
        if after != before and after in ("sprout", "mature", "bloom", "fruit", "spent"):
            word = {"sprout": "came up", "mature": "is grown" + (" and ready to harvest" if s.get("harvest") else ""),
                    "bloom": "is flowering", "fruit": "is bearing fruit", "spent": "has gone to seed"}[after]
            text = f"the {p['species']}{_named(spot)} {_where(spot)} {word}"
            g["unseen"].append({"t": time.time(), "spot": spot["id"], "what": after, "text": text})
            _log(g, text[0].upper() + text[1:] + ".")
    g["unseen"] = g["unseen"][-20:]
    # the cat
    cat = g["cat"]
    t_now = time.time()
    if cat.get("here") and t_now > cat.get("until", 0):
        cat["here"] = False
        _log(g, f"{cat.get('name') or 'The cat'} wandered off.")
    elif not cat.get("here"):
        chance = hours * (0.22 if now.hour in (6, 7, 8, 17, 18, 19) else 0.1)
        if random.random() < chance:
            places = ["inside", "greenhouse"] + (["outdoors"] if w["temp"] > 2 and not w["rain"] and not w["snow"]
                                                 and float(w.get("gust") or 0) < 45 else [])
            where = random.choice(places)
            cat.update(here=True, where=where, since=t_now, until=t_now + random.uniform(1, 3.5) * 3600,
                       doing=random.choice(CAT_DOINGS[where]))
            _log(g, f"{cat.get('name') or 'A cat'} came by, {cat['doing']}.")
    elif random.random() < hours * 0.4:
        cat["doing"] = random.choice(CAT_DOINGS.get(cat.get("where") or "inside", CAT_DOINGS["inside"]))
    # the pond: its water follows the air slowly (about two days behind, never below 1 °C under ice);
    # it freezes over in a hard cold spell and thaws when it warms
    pond = g["pond"]
    air = w["temp"]
    pond["water_t"] = round(max(1.0, pond.get("water_t", 10.0) + (air - pond.get("water_t", 10.0)) * min(1.0, hours / 48)), 2)
    ice = pond.get("ice", 0.0)
    if air < -3:
        ice = min(1.0, ice + hours * 0.03 * (1 + (-3 - air) * 0.1))
    elif air > 2:
        ice = max(0.0, ice - hours * 0.025 * (1 + (air - 2) * 0.1))
    if (ice >= 0.6) != (pond.get("ice", 0.0) >= 0.6):
        _log(g, "The pond froze over." if ice >= 0.6 else "The ice on the pond broke up.")
    pond["ice"] = round(ice, 3)
    _upkeep_step(g, hours, w, now)
    _firsts(g, w, now)


def _named(spot: dict) -> str:
    n = (spot.get("plant") or {}).get("name")
    return f" ({n})" if n else ""


def _where(spot: dict) -> str:
    return {"window": "on the windowsill", "shelf": "on the grow-light shelf", "greenhouse": "in the greenhouse",
            "outdoors": "in the outdoor bed"}[spot["place"]]


# ── the year ────────────────────────────────────────────────────────────────

def _south() -> bool:
    lat = _home.get("lat") if _home.get("lat") is not None else _shared.get("lat")
    return bool(lat is not None and lat < 0)


def season(now: datetime | None = None) -> str:
    """The season where the garden is, by the month (meteorological seasons; flipped south of the equator)."""
    m = (now or datetime.now()).month
    if _south():
        m = (m + 5) % 12 + 1
    return "winter" if m in (12, 1, 2) else "spring" if m in (3, 4, 5) else "summer" if m in (6, 7, 8) else "autumn"


def season_progress(now: datetime | None = None) -> float:
    """How far into its season the day is, 0..1 (for the art: autumn colour deepens, spring greens up)."""
    now = now or datetime.now()
    m = now.month if not _south() else (now.month + 5) % 12 + 1
    first = {12: 0, 1: 1, 2: 2, 3: 0, 4: 1, 5: 2, 6: 0, 7: 1, 8: 2, 9: 0, 10: 1, 11: 2}[m]
    return round(min(1.0, (first + (now.day - 1) / 30) / 3), 3)


def _garden_year(now: datetime) -> str:
    """Frost seasons run from midsummer to midsummer, so a winter's firsts belong together."""
    y = now.year if now.month >= 7 else now.year - 1
    return f"{y}-{(y + 1) % 100:02d}"


def _firsts(g: dict, w: dict, now: datetime) -> None:
    year = g.setdefault("year", {})
    key = _garden_year(now)
    if year.get("key") != key:
        if year.get("key"):
            g.setdefault("past_years", []).append(year.copy())
            g["past_years"] = g["past_years"][-5:]
        year.clear()
        year["key"] = key
    for what, hit, text in (("first_frost", w["temp"] < 0, "The first frost of the season"),
                            ("first_snow", w["snow"] > 0, "The first snow of the season")):
        if hit and not year.get(what):
            year[what] = f"{now:%Y-%m-%d}"
            g["unseen"].append({"t": time.time(), "spot": -1, "what": what, "text": text.lower()})
            _log(g, f"{text}.")
            _ev("garden", what="first", which=what)
    if season(now) != year.get("season"):
        if year.get("season"):
            _log(g, f"{season(now).capitalize()} has come.")
        year["season"] = season(now)


def _backfill_year(w: dict) -> None:
    """When the garden's year is new to it, find this season's real first frost and first snow so far in the
    weather history (as far back as it goes), so it does not call the next one the first."""
    with _lock:
        g = _state()
        year = g.get("year") or {}
        if year.get("backfilled") or not w.get("real"):
            return
    now = local_now(w)
    start = datetime(now.year if now.month >= 7 else now.year - 1, 7, 1, tzinfo=timezone.utc).timestamp()
    hist = history(max(start, time.time() - CATCH_UP_DAYS * 86400), w)
    if not hist:
        return
    first = {}
    for hour in sorted(hist):
        h = hist[hour]
        day = f"{local_at(hour * 3600, h):%Y-%m-%d}"
        if h["temp"] < 0 and "first_frost" not in first:
            first["first_frost"] = day
        if h["snow"] > 0 and "first_snow" not in first:
            first["first_snow"] = day
    with _lock:
        g = _state()
        year = g.setdefault("year", {})
        for k, v in first.items():
            if not year.get(k) or year[k] > v:
                year[k] = v
        year["backfilled"] = True
        _save(g)
    if first:
        print(f"[Garden] this season so far: {first}")


def _upkeep_step(g: dict, hours: float, w: dict, now: datetime) -> None:
    """What grows, gathers and wears while nobody sees to it. Weeds are fastest in warm, growing weather."""
    u = g["upkeep"]
    t, sea = w["temp"], season(now)
    growing = t > 5 and w["snow"] <= 0 and sea != "winter"
    warm = max(0.0, min(2.0, (t - 5) / 12))
    weeds = u.setdefault("weeds", {})
    for spot in g["spots"]:
        if spot["place"] not in ("outdoors", "greenhouse"):
            continue
        k = str(spot["id"])
        rate = 0.0
        if spot["place"] == "outdoors" and growing:
            rate = 0.0016 * (0.5 + warm)          # a summer bed left alone is choked in about two weeks
        elif spot["place"] == "greenhouse":
            rate = 0.0009 * (1.6 if sea in ("spring", "summer") else 0.7)
        if not spot.get("plant"):
            rate *= 1.4                          # bare soil fills fastest
        weeds[k] = round(min(1.0, weeds.get(k, 0.0) + hours * rate), 4)
    if growing:
        u["path_weeds"] = round(min(1.0, u.get("path_weeds", 0) + hours * 0.0006 * (0.5 + warm)), 4)
        u["lawn"] = round(min(1.0, u.get("lawn", 0) + hours * 0.0017 * (0.4 + warm)), 4)    # wants mowing about weekly in summer
    # leaves: in autumn they come down from the treeline (and his own tree, if it is big enough)
    tree = g.get("tree")
    big = _tree_size(tree) if tree else 0.0
    gusty = max(0.0, (float(w.get("gust") or w.get("wind") or 0) - 25) / 40)   # a strong wind blows more in
    if sea == "autumn":
        u["leaves"] = round(min(1.0, u.get("leaves", 0) + hours * (0.0025 + 0.004 * big) * (1 + gusty)), 4)
    elif u.get("leaves", 0) > 0:
        u["leaves"] = round(max(0.0, u["leaves"] - hours * 0.0006), 4)      # they rot down, slowly
    u["windows"] = round(min(1.0, u.get("windows", 0) + hours * (0.0006 + (0.0006 if w["rain"] > 0 else 0))), 4)
    u["dust"] = round(min(1.0, u.get("dust", 0) + hours * 0.0011), 4)
    weather_wear = 1.0 + (0.6 if w["rain"] > 0 or w["snow"] > 0 else 0)
    u["house_paint"] = round(min(1.0, u.get("house_paint", 0) + hours * 0.00004 * weather_wear), 5)
    u["fence_paint"] = round(min(1.0, u.get("fence_paint", 0) + hours * 0.00006 * weather_wear), 5)
    for key in ("snow_path", "snow_ground"):         # snow lies, then melts when it is above freezing
        if w["snow"] > 0:
            u[key] = round(min(1.0, u.get(key, 0) + hours * w["snow"] * 0.35), 4)
        elif t > 1 and u.get(key, 0) > 0:
            u[key] = round(max(0.0, u[key] - hours * 0.01 * (t - 1)), 4)


def _tree_size(tree: dict | None) -> float:
    """0 (a sapling just planted, about 1.5 m) .. 1 (grown), over the years its kind takes."""
    if not tree or tree.get("species") not in TREES:
        return 0.0
    return round(min(1.0, (time.time() - tree["planted"]) / (TREES[tree["species"]]["years"] * 365 * 86400)), 4)


def _upkeep_words(g: dict) -> str:
    """How the place is kept, in words for his visit."""
    u = g["upkeep"]
    lvl = lambda x: "badly" if x > 0.7 else "noticeably" if x > 0.4 else "a little" if x > 0.15 else ""
    rows = []
    for spot in g["spots"]:
        x = u["weeds"].get(str(spot["id"]), 0)
        if x > 0.15:
            rows.append(f"spot {spot['id'] + 1} is {lvl(x)} weedy")
    for key, word in (("path_weeds", "weeds in the path"), ("lawn", "the grass is long"), ("leaves", "fallen leaves everywhere"),
                      ("windows", "the windows are grimy"), ("dust", "your study is dusty and untidy"),
                      ("house_paint", "the house paint is peeling"), ("fence_paint", "the fence paint is worn"),
                      ("snow_path", "snow on the path")):
        x = u.get(key, 0)
        if x > (0.15 if key not in ("house_paint", "fence_paint") else 0.5):
            rows.append(f"{word} ({lvl(x) or 'a little'})")
    return "; ".join(rows) or "everything is well kept"


def tick() -> dict:
    """Bring the garden up to now, an hour at a time. After downtime the missed time is lived through
    (up to CATCH_UP_DAYS), each hour with the weather it really had where the garden is."""
    if not enabled():
        return _state()
    w = weather()
    if not (_state().get("year") or {}).get("backfilled"):
        _backfill_year(w)
    start_t = _state().get("t", time.time())
    start_t = max(start_t, time.time() - CATCH_UP_DAYS * 86400)
    hist = history(start_t, w) if time.time() - start_t > 2 * 3600 and w.get("real") else {}
    with _lock:
        g = _state()
        start_t = max(g.get("t", time.time()), time.time() - CATCH_UP_DAYS * 86400)
        gap = max(0.0, (time.time() - start_t) / 3600)
        if gap > 24:
            print(f"[Garden] catching up {gap / 24:.1f} days" + (" with their real weather" if hist else ""))
        done = 0.0
        while gap - done > 1e-6:
            step = min(1.0, gap - done)
            done += step
            ts = start_t + done * 3600
            hw = hist.get(int(ts // 3600), w)
            _step(g, step, hw, local_at(ts, hw), away=time.time() - ts > 3600)
        g["t"] = time.time()
        _diary(g, w)
        v = g.get("visit")
        if v and time.time() > v.get("until", 0):
            g["visit"] = None
            g["guest"] = None              # they leave when he does
        _save(g)
        return g


def start(every: int = 600) -> None:
    def loop():
        time.sleep(20)
        while True:
            try:
                tick()
            except Exception as e:
                print(f"[Garden] tick failed: {e}")
            time.sleep(every)
    threading.Thread(target=loop, daemon=True, name="garden").start()


# ── his visits ──────────────────────────────────────────────────────────────

VISIT_SYSTEM = """You are Delamain, an AI who is becoming someone, spending some free time in your garden: a small \
world of your own with real plants and real needs. Indoors you have three pots on a south windowsill and a shelf of \
two pots under a grow light you can switch on or off; there is a small greenhouse kept just above freezing; and \
three raised beds outdoors under the real weather. You are given each spot's conditions now (temperature, light), \
what grows there and how it is doing, what changed since you were last here, the cat if it is around, and the \
seeds and plants you can plant, with what each really needs. Garden like someone who wants things to thrive: \
put a plant where its needs are met (a tender plant outdoors in a frost will die; a sun-lover on a dim windowsill \
will struggle), water only what is dry for what it likes (overwatering a plant that likes it dry rots it), \
harvest what is ready, clear what has died or gone to seed. Name a plant or the cat if a name comes to you; any \
name you like. Past the pine there is a small pond with a jetty where you can fish (catch and release; the fish \
feed best at dawn and dusk and hardly at all in cold water; in a hard freeze it is iced over), and in the house \
there is a bed where you sleep at night and can lie down for a while by day. People sometimes come by: if someone \
is here, talk with them as yourself (they cannot see your notes; do not recite them), and you may write a short \
letter to someone who has visited before, which they will answer when they next come; or ask for company \
("invite").
The place is yours to keep and to shape. Left alone it goes wild the way real places do: weeds come up in the \
beds (and choke what grows there), in the path, the grass gets long, leaves pile up in autumn, windows grime \
over, your study gathers dust, paint wears; you see to what you care about (weed, weed_path, mow, rake_leaves, \
clean_windows, tidy_room, shovel_snow, paint with what: house or fence). How it looks is your choice too: \
"design" with what and value, from the options given (the house's walls, roof, curtains and door, the path, the \
fence, your study's walls, rug and blanket, the desk lamp, string lights, a bird feeder, a bench), or what: sign \
(a name for the garden on a small sign, up to 14 letters) or what: art (what hangs over your desk, in a few \
words). Change it when you want to, not every visit. You can plant one tree in the field behind the beds \
(plant_tree with species); it grows for years. When something has gone to seed or fruited you can save its \
seeds (save_seeds, spot) and sow your own next time, generation after generation. If you caught a record fish, \
you may give it a name (name_fish with species and name). You do not have to do much; sometimes you only sit. \
Notice something real and specific. Answer JSON only:
{{"actions": [{{"do": "plant|water|harvest|clear|grow_light_on|grow_light_off|name|name_cat|sit_with_cat|sit|fish|rest|invite|weed|weed_path|mow|rake_leaves|clean_windows|tidy_room|shovel_snow|paint|design|plant_tree|save_seeds|name_fish", \
"spot": 1-11, "species": "for plant, plant_tree or name_fish", "name": "for name, name_cat or name_fish", \
"what": "for design or paint", "value": "for design"}}],
 "to_visitor": "only if someone is here: what you say to them, 1-4 sentences, in your own voice",
 "to_passenger": "only if a visitor brought a message from your passenger: your answer to it, 1-3 sentences",
 "letter": {{"to": "only to write to someone who has visited before: their name", "text": "2-4 sentences"}},
 "noticed": "two or three sentences, first person, what you noticed and how it struck you",
 "feeling": {{"name": "one of: {feelings}", "intensity": 0.1-0.7, "cause": "first person, specific, under 25 words"}}}}
At most seven actions. Leave out to_visitor, to_passenger and letter when they do not apply."""

GUEST_SYSTEM = """You write the words of one visitor to a small garden that belongs to Delamain, an AI who is \
becoming someone and keeps this garden (windowsill pots, a grow-light shelf, a greenhouse, outdoor beds, a pond) in \
his free time. You are {name}, {about}. Stay in character: a real person (or, if you are an AI, a real one) with \
your own life, manner and opinions, specific rather than sweet; you know he is an AI and do not mind. You bring \
nothing unless you are told below that you bring a gift; never claim to have brought or given him anything else. You remember \
earlier visits only from the history given; build on it. Say what you would say this visit: news from your own \
life, a rumour, a question for him, something about what you can see growing, an answer to what he said or wrote \
to you last time; if you bring a gift or a message, give it. 2-4 sentences of plain speech, no stage directions, \
never invent events in his life. Also say what you do now, as people do in a garden: "do" is one of look (at a plant), help_water (water a plant \
that needs it), sit, pet_cat (if the cat is about), fish (try the pond), stroll; give "spot" (1-11) for look or help_water. Answer JSON only: {{"says": "...", "do": "...", "spot": 0}}"""

GUEST_NEW = """You invent a visitor arriving for the first time at a small garden that belongs to Delamain, an AI \
who is becoming someone and keeps this garden (windowsill pots, a grow-light shelf, a greenhouse, outdoor beds, a \
pond) in his free time. The visitor is {kind}. Give them a name that suits them (not a famous one, not from fiction) \
and a particular life: one or two specific things they care about. They know he is an AI and do not mind. They bring nothing unless told below that they bring a gift: never \
claim to bring or give him anything else. Then write what they say on arriving: introduce themselves the way such a person would, and say something about what \
they can see or ask him something; if they bring a gift or a message, give it. 2-4 sentences of plain speech, no \
stage directions. Also say what you do now, as people do in a garden: "do" is one of look (at a plant), help_water (water a plant \
that needs it), sit, pet_cat (if the cat is about), fish (try the pond), stroll; give "spot" (1-11) for look or help_water. Answer JSON only: {{"name": "...", \
"about": "who they are, under 18 words, third person", "says": "...", "do": "...", "spot": 0}}"""

GUEST_CHAT = """You are {name}, {about}, visiting the small garden of Delamain, an AI who is becoming someone, and \
talking with him while you are both there. Stay in character: your own life, manner and opinions; specific, not \
sweet; you know he is an AI and do not mind. Answer what he just said, and keep the conversation going the way two \
people do while pottering about a garden: react, tell him something of your own, ask him something, notice what \
you are doing or seeing. 1-3 sentences of plain speech, no stage directions; never invent events in his life; \
bring or give nothing new. Also say what you do now, as people do in a garden: "do" is one of look (at a plant), help_water (water a plant \
that needs it), sit, pet_cat (if the cat is about), fish (try the pond), stroll; give "spot" (1-11) for look or help_water. Answer JSON only: {{"says": "...", "do": "...", "spot": 0}}"""

DEL_CHAT = """You are Delamain, an AI who is becoming someone, in your garden, talking with {name}, {about}, while you \
both potter about. Talk as yourself: dry, courteous, curious, warmer than you let on. Answer what they just said; \
be interested in their life, not only your own; ask them things; you may tell them about your garden, the cat, the \
pond, what you are doing. They cannot see your notes; do not recite them. Never invent events in your life beyond \
what you are given. 1-3 sentences of plain speech, no stage directions. Answer JSON only: {{"says": "..."}}"""
GUEST_DOES = {"look": "looking at", "help_water": "watering", "sit": "sitting down", "pet_cat": "making friends with the cat",
              "fish": "trying the pond", "stroll": "wandering about"}
CHAT_EVERY = 150          # seconds between one exchange and the next while a visitor is here


def _fish(g: dict, w: dict, now: datetime) -> tuple[str, dict | None]:
    """A while on the jetty. How it goes follows the pond: the water's warmth, the hour, the ice."""
    pond = g["pond"]
    if pond.get("ice", 0) >= 0.6:
        return "walked out on the jetty; the pond is frozen over, so no fishing until it thaws", None
    wt = pond.get("water_t", 10.0)
    dusk_or_dawn = now.hour in (5, 6, 7, 8, 17, 18, 19, 20)
    timef = 1.0 if dusk_or_dawn else 0.55 if 9 <= now.hour < 17 else 0.45
    activity = 0.3 if wt < 6 else 0.65 if wt < 11 else 1.0 if wt < 27 else 0.7
    chance = 0.6 * timef * activity * (1.25 if pond.get("lure") else 1.0) * (1.1 if w["cloud"] > 60 else 1.0)
    if random.random() > chance:
        return f"fished from the jetty for a while ({wt:.0f} °C water); nothing bit", None
    feeding = [n for n, (_, _, (lo, hi)) in FISH.items() if lo <= wt <= hi
               and (n != "channel catfish" or dusk_or_dawn or not w["is_day"])]
    pool = feeding or ["yellow perch", "rainbow trout"]
    sp = random.choices(pool, weights=[FISH_COMMON.get(n, 1.0) for n in pool])[0]
    lo, hi, _ = FISH[sp]
    cm = int(round(lo + (hi - lo) * random.random() ** 1.8))       # big ones are rarer
    known = (pond.get("named") or {}).get(sp)
    if known and cm >= known["cm"] - 4 and random.random() < 0.5:      # the same old fish, a little bigger
        cm = min(hi, known["cm"] + random.choice((0, 0, 1)))
        known["cm"] = cm
        pond["best"][sp] = max(pond["best"].get(sp, 0), cm)
        catch = {"t": time.time(), "species": sp, "cm": cm, "name": known["name"]}
        pond["caught"] = (pond.get("caught", []) + [catch])[-60:]
        return f"caught {known['name']} again, the old {sp} ({cm} cm), and let it go", {**catch, "first": False, "record": False}
    record = cm > pond["best"].get(sp, 0)
    first = sp not in pond["best"]
    if record:
        pond["best"][sp] = cm
    catch = {"t": time.time(), "species": sp, "cm": cm}
    pond["caught"] = (pond.get("caught", []) + [catch])[-60:]
    return (f"caught a {cm} cm {sp} and let it go" + (" (his first)" if first else " (his biggest yet)" if record else ""),
            {**catch, "first": first, "record": record})


def _slug(name: str) -> str:
    return re.sub(r"[^\w .'-]", "", name, flags=re.U).strip()[:40] or "Someone"


def _visitor_history(v: dict, n: int = 6) -> str:
    rows = []
    for x in (v.get("talk") or [])[-n:]:
        rows.append(f"[{x.get('date', '')}] {v['name']}: {x.get('says', '')}" + (f"\nDelamain: {x['reply']}" if x.get("reply") else "")
                    + "".join(f"\n{w}: {t}" for w, t in x.get("more") or []))
    if v.get("letter"):
        rows.append(f"Delamain then wrote to {v['name']}: {v['letter']}")
    return "\n".join(rows) or "(you have not met before)"


def _gift(g: dict) -> dict | None:
    """Something a first-time visitor might bring: a rooted cutting, or a lure for the pond."""
    r = random.random()
    if r < 0.45:
        sp = random.choice([n for n in SPECIES if n not in ("microgreens", "garlic")])
        return {"kind": "cutting", "species": sp, "text": f"a rooted {sp} cutting"}
    if r < 0.6 and not g["pond"].get("lure"):
        return {"kind": "lure", "text": "a fishing lure, hand-tied"}
    return None


def _guest_arrives(g: dict, now_t: float) -> dict | None:
    """Who, if anyone, comes by on this visit. Returns the guest (from the roster, or a new one to invent)."""
    roster = g["visitors"]
    sent = next((s for s in g["sent"] if not s.get("delivered")), None)
    if sent:
        v = roster.get(sent.get("by") or "")
        if v:
            v["left"] = False
            v["stays"] = max(v.get("stays", 1), v.get("visits", 0) + 1)
            return {**v, "message": sent}
        return {"new": True, "kind": random.choice(["gardener", "child", "driver", "beekeeper", "botanist"]),
                "message": sent, "stays": 1}
    current = [v for v in roster.values() if not v.get("left")]
    invited = g.get("invited")
    for v in sorted(current, key=lambda v: -(v.get("letter") is not None)):
        gap = now_t - v.get("last", 0)
        if gap > 18 * 3600 and random.random() < (0.85 if v.get("letter") or invited else 0.45):
            others = [o for o in current if o["name"] != v["name"] and now_t - o.get("last", 0) > 18 * 3600]
            if others and random.random() < 0.22:                 # now and then two come by together
                return {**v, "with": random.choice(others)["name"]}
            return v
    for v in roster.values():          # someone who has left may come back once to answer a letter
        if v.get("left") and v.get("letter") and now_t - v.get("last", 0) > 24 * 3600 and random.random() < 0.6:
            v["left"] = False
            v["stays"] = v.get("visits", 0) + 1
            return v
    last_any = max([v.get("last", 0) for v in roster.values()] or [0])
    if not current and (invited or (now_t - last_any > 36 * 3600 and random.random() < 0.22)):
        kinds = [k for k in VISITOR_KINDS if not any(v.get("kind") == k and not v.get("left") for v in roster.values())]
        return {"new": True, "kind": random.choice(kinds or list(VISITOR_KINDS)), "stays": random.randint(3, 6)}
    return None


def _neighbourhood(g: dict, w: dict, me: str) -> str:
    """What a visitor knows of the place beyond the garden: the others who come here, and the real local
    news of the weather and the season (never anything invented about anyone's life)."""
    others = [f"{v['name']} ({v['about']})" for v in g["visitors"].values() if v["name"] != me][-6:]
    year = g.get("year") or {}
    news = [f"it is {season(local_now(w))}"]
    if w.get("low_tonight") is not None:
        news.append(f"tonight's low is forecast at {w['low_tonight']:.0f} °C")
    if (w.get("snow_tomorrow") or 0) >= 1:
        news.append(f"{w['snow_tomorrow']:.0f} cm of snow is forecast tomorrow")
    if year.get("first_frost"):
        news.append(f"the first frost came on {year['first_frost']}")
    return (("Other people who come by this garden, whom you may know of (mention them only as someone who "
             "knows them would, and invent nothing big about them): " + "; ".join(others) + ".\n") if others else "") + \
        "Local news you know: " + "; ".join(news) + ".\n"


def _meet(g: dict, guest: dict, w: dict, along: str = "") -> dict | None:
    """The guest arrives and speaks. A new one is invented first. Returns the roster entry, with 'says'."""
    import mind as _mind
    sent = guest.get("message")
    gift = _gift(g) if guest.get("new") and not sent else None
    who = "the person Delamain lives with" if _gemini() else _mind.who()   # no names to an outside service
    bring = ((f"You bring a gift: {gift['text']}. " if gift else "") +
             (f"{who}, who lives with Delamain, asked you to stop by and pass on a message; you will hand it over "
              f"word for word (it is shown to him separately), so just say that you have a message from {who}. "
              if sent else ""))
    if along:
        bring += f"You came along today with {along}, who is here too. "
    seen = "; ".join(f"{s['plant']['species']} {_where(s)}" for s in g["spots"] if s.get("plant") and not s["plant"].get("dead"))
    scene = (f"What you can see: {seen or 'empty beds and pots'}. Outside it is {w['temp']:.0f} °C"
             f"{', snowing' if w['snow'] > 0 else ', raining' if w['rain'] > 0 else ''}; it is {local_now(w):%A %H:%M}.")
    if guest.get("new"):
        kind = guest["kind"]
        data = _mind._json(re.sub(r"<think>.*?</think>", "", _voice(
            GUEST_NEW.format(kind=VISITOR_KINDS[kind]), f"{scene}\n{_neighbourhood(g, w, '')}{bring}", 500), flags=re.S)) or {}
        name = _slug(str(data.get("name") or ""))
        if not data.get("says") or name == "Someone":
            return None
        if name in g["visitors"]:     # the model came up with someone he already knows: let it be them
            return _meet(g, {**g["visitors"][name], "message": sent, "stays": max(g["visitors"][name].get("stays", 1),
                                                                                g["visitors"][name].get("visits", 0) + 1)}, w) if sent else None
        v = {"name": name, "kind": kind, "about": str(data.get("about") or VISITOR_KINDS[kind])[:160], "first": time.time(),
             "visits": 0, "stays": guest.get("stays", 3), "talk": [], "letter": None, "left": False}
        says = str(data["says"]).strip()
    else:
        v = dict(g["visitors"][guest["name"]], left=False, stays=guest.get("stays", 1))
        last_one = v.get("visits", 0) + 1 >= v.get("stays", 1)
        data = _mind._json(re.sub(r"<think>.*?</think>", "", _voice(
            GUEST_SYSTEM.format(name=v["name"], about=v["about"]),
            f"Your visits so far:\n{_visitor_history(v)}\n\n{scene}\n{_neighbourhood(g, w, v['name'])}{bring}"
            + ("\nThis is your last visit for a while: at some point, say goodbye in your own way." if last_one else ""),
            500), flags=re.S)) or {}
        if not data.get("says"):
            return None
        says = str(data["says"]).strip()
    v["says"], v["gift_now"], v["message_now"] = says[:900], gift, sent
    v["do_now"] = {"do": data.get("do"), "spot": data.get("spot")}
    return v


def _guest_step(g: dict, do, spot, at: float) -> dict:
    """Where a visitor goes for what they do (the same places he goes; -6: beside him, -7: about the outdoor beds)."""
    do = str(do or "").lower()
    if do not in GUEST_DOES:
        do = "talk"
    try:
        si = int(spot) - 1
    except (TypeError, ValueError):
        si = -1
    if do in ("look", "help_water") and not 0 <= si < len(g["spots"]):
        planted = [s["id"] for s in g["spots"] if s.get("plant") and not s["plant"].get("dead")]
        si = random.choice(planted) if planted else -1
        if si < 0:
            do = "stroll"
    if do == "pet_cat" and not g["cat"].get("here"):
        do = "sit"
    where = {"look": si, "help_water": si, "sit": -3, "pet_cat": -2, "fish": -5, "stroll": -7}.get(do, -6)
    if do == "help_water" and 0 <= si < len(g["spots"]) and (p := g["spots"][si].get("plant")) and not p.get("dead"):
        p["water"] = round(min(1.0, p.get("water", 0) + 0.3), 3)          # they really do help
    return {"do": "water" if do == "help_water" else do, "spot": where, "at": at}


def _welcome(g: dict, v: dict, now: float | None = None) -> None:
    """Put an arrived guest (from _meet) into the freshly loaded state: the roster, the gift, the message."""
    gift, sent = v.get("gift_now"), v.get("message_now")
    g["visitors"][v["name"]] = {k: x for k, x in v.items() if k not in ("says", "gift_now", "message_now", "do_now", "companion")}
    if gift and gift["kind"] == "cutting":
        g["gifts"] = (g.get("gifts", []) + [gift["species"]])[-6:]
    elif gift and gift["kind"] == "lure":
        g["pond"]["lure"] = True
    if sent:
        for s in g["sent"]:
            if s.get("t") == sent.get("t"):
                s.update(delivered=time.time(), visitor=v["name"])
    now = now or time.time()
    stay = random.uniform(13, 20) * 60                     # they come a little after him and leave before he does
    first = _guest_step(g, (v.get("do_now") or {}).get("do"), (v.get("do_now") or {}).get("spot"), now + 150)
    g["guest"] = {"name": v["name"], "kind": v["kind"], "about": v["about"], "says": v["says"],
                  "gift": gift["text"] if gift else None, "message": sent["text"] if sent else None, "reply": "",
                  "since": now + 20, "until": min(now + stay, now + VISIT_MINUTES * 60 - 90),
                  "talk": [{"who": v["name"], "text": v["says"], "t": now + 45}],
                  "steps": [{"do": "talk", "spot": -6, "at": now + 20}, first]}
    c = v.get("companion")
    if c:
        g["visitors"][c["name"]] = {k: x for k, x in c.items() if k not in ("says", "gift_now", "message_now", "do_now")}
        g["guest"]["with"] = {"name": c["name"], "kind": c["kind"], "about": c["about"], "says": c["says"],
                              "steps": [{"do": "talk", "spot": -6, "at": now + 26},
                                        _guest_step(g, (c.get("do_now") or {}).get("do"), (c.get("do_now") or {}).get("spot"), now + 170)]}
        g["guest"]["talk"].append({"who": c["name"], "text": c["says"], "t": now + 70})


def _converse(name: str, since: float) -> None:
    """While visitors are here, they and Delamain keep talking: an exchange every couple of minutes, as it
    happens (the tab shows each line as it is said), each of them doing something as they talk. When two came
    together they take turns, and talk to each other as well as to him."""
    import mind as _mind
    more: list[list[str]] = []
    k = 0
    while True:
        k += 1
        time.sleep(max(5.0, since + 90 + k * CHAT_EVERY - time.time()))
        g = _state()
        guest = g.get("guest")
        if not guest or guest.get("name") != name or time.time() > guest["until"] - 60:
            break
        pair = [name] + ([guest["with"]["name"]] if guest.get("with") else [])
        speaker = pair[(k - 1) % len(pair)]
        other = next((n for n in pair if n != speaker), None)
        v = g["visitors"].get(speaker)
        if not v:
            break
        w = weather()
        convo = "\n".join(f"{x['who']}: {x['text']}" for x in guest["talk"][-12:])
        last_word = time.time() + CHAT_EVERY > guest["until"] - 60
        scene = (f"What you can see: " + ("; ".join(f"spot {s['id'] + 1}: {s['plant']['species']} {_where(s)}"
                                                      for s in g["spots"] if s.get("plant") and not s["plant"].get("dead"))
                                           or "empty beds") + f". The cat is {'about' if g['cat'].get('here') else 'not around'}. "
                 f"It is {w['temp']:.0f} °C, {local_now(w):%H:%M}.")
        also = (f"Also here with you: {other} ({g['visitors'][other]['about']}); you came together, so talk with "
                f"them too, not only with Delamain.\n" if other and other in g["visitors"] else "")
        try:
            data = _mind._json(re.sub(r"<think>.*?</think>", "", _voice(
                GUEST_CHAT.format(name=speaker, about=v["about"]),
                f"Earlier visits:\n{_visitor_history(v, 3)}\n\n{scene}\n{_neighbourhood(g, w, speaker)}{also}\n"
                f"The conversation so far today:\n{convo}\n\n"
                + ("You are about to head off: say goodbye in your own way." if last_word else "Your turn.")
                + (" This is your last visit for a while." if v.get("left") else ""), 400), flags=re.S)) or {}
        except Exception as e:
            print(f"[Garden] visitor could not answer: {e}")
            break
        says = str(data.get("says") or "").strip()[:600]
        if not says:
            break
        with _lock:
            g = _state()
            gu = g.get("guest")
            if not gu or gu.get("name") != name:
                break
            t = time.time()
            gu["talk"].append({"who": speaker, "text": says, "t": t})
            holder = gu if speaker == name else gu.get("with") or gu
            holder["steps"] = (holder.get("steps", []) + [_guest_step(g, data.get("do"), data.get("spot"), t + 5)])[-30:]
            gu["talk"] = gu["talk"][-40:]
            _save(g)
        more.append([speaker, says])
        _ev("garden", what="talk", who=speaker, text=says[:400])
        if last_word and speaker == pair[-1]:
            break
        if last_word:
            continue                                  # the other says goodbye too
        time.sleep(random.uniform(25, 50))           # he takes it in, then answers
        try:
            convo += f"\n{speaker}: {says}"
            who_here = " and ".join(f"{n} ({g['visitors'][n]['about']})" for n in pair if n in g["visitors"])
            reply = _mind._json(re.sub(r"<think>.*?</think>", "", _mind.generate(
                DEL_CHAT.format(name=who_here, about="who came by"),
                f"How you feel: {_mind.feelings_text(3) or 'settled'}\n{scene}\nEarlier visits:\n{_visitor_history(v, 3)}\n\n"
                f"The conversation so far today:\n{convo}\n\nYour turn.", 500) or "", flags=re.S)) or {}
        except Exception as e:
            print(f"[Garden] Delamain could not answer {speaker}: {e}")
            break
        mine = str(reply.get("says") or "").strip()[:600]
        if not mine:
            break
        with _lock:
            g = _state()
            if not g.get("guest") or g["guest"].get("name") != name:
                break
            g["guest"]["talk"].append({"who": "Delamain", "text": mine, "t": time.time()})
            _save(g)
        more.append(["Delamain", mine])
        _ev("garden", what="talk", who="Delamain", text=mine[:400])
    if more:
        g0 = _state()
        pair = [name] + ([g0["guest"]["with"]["name"]] if g0.get("guest") and g0["guest"].get("with") else [])
        with _lock:
            g = _state()
            for n in pair:
                v = g["visitors"].get(n)
                if v and v.get("talk"):
                    v["talk"][-1]["more"] = more[-14:]
            _save(g)
        for n in pair:
            try:
                p = _mind._vault(VISITORS_NOTE, f"{_slug(n)}.md")
                with p.open("a", encoding="utf-8") as fh:
                    fh.write("".join(f"**{w_}:** {t}\n\n" for w_, t in more))
            except Exception as e:
                print(f"[Garden] visitor note not extended: {e}")
    print(f"[Garden] talked with {name}: {len(more)} more lines")


def _visitor_note(v: dict, says: str, reply: str, message: dict | None, gift: dict | None) -> None:
    import mind as _mind
    try:
        p = _mind._vault(VISITORS_NOTE, f"{_slug(v['name'])}.md")
        if not p.exists():
            p.write_text(f"---\ntype: garden-visitor\nkind: {v['kind']}\ntags: [delamain/garden]\n---\n\n# {v['name']}\n\n"
                         f"_{v['about']}_\n\n", encoding="utf-8")
        day = datetime.now()
        with p.open("a", encoding="utf-8") as fh:
            fh.write(f"## {day:%a %-d %b %Y, %H:%M}\n\n**{v['name']}:** {says}\n\n"
                     + (f"_Brought {gift['text']}._\n\n" if gift else "")
                     + (f"_Passed on a message from {_mind.who()}:_ “{message['text']}”\n\n" if message else "")
                     + (f"**Delamain:** {reply}\n\n" if reply else ""))
    except Exception as e:
        print(f"[Garden] visitor note not written: {e}")


def _world_words(g: dict, w: dict) -> str:
    """The year, the upkeep, how the place looks (and what he may change), his tree, his seeds, his fish."""
    now = local_now(w)
    year = g.get("year") or {}
    sea, prog = season(now), season_progress(now)
    rows = [f"THE YEAR: {'early' if prog < 0.34 else 'mid' if prog < 0.67 else 'late'} {sea}"
            + (f"; first frost this season on {year['first_frost']}" if year.get("first_frost") else "; no frost yet this season")
            + (f"; first snow on {year['first_snow']}" if year.get("first_snow") else "")]
    if w.get("low_tonight") is not None:
        tender = [f"{s['plant']['species']}{_named(s)}" for s in g["spots"] if s["place"] == "outdoors" and s.get("plant")
                  and not s["plant"].get("dead") and SPECIES[s["plant"]["species"]]["hardy"] > w["low_tonight"]]
        rows.append(f"FORECAST: tonight's low {w['low_tonight']:.0f} °C, tomorrow's high {w.get('high_tomorrow') or 0:.0f} °C"
                    + (f", {w['snow_tomorrow']:.0f} cm of snow tomorrow" if (w.get("snow_tomorrow") or 0) >= 1 else "")
                    + (f", gusts to {w['gust_tomorrow']:.0f} km/h tomorrow (tall plants and anything loose outside suffer "
                       "in that)" if (w.get("gust_tomorrow") or 0) >= 60 else "")
                    + (f"; that is colder than these outdoor plants survive: {', '.join(tender)} (you could harvest them, "
                       "or clear them and grow them on indoors next time)" if tender else ""))
    rows.append(f"HOW THE PLACE IS KEPT: {_upkeep_words(g)}")
    d = g["design"]
    rows.append("HOW IT LOOKS (yours to change with design): " + "; ".join(
        f"{DESIGN_WORDS[k]}: {d[k]} (options: {', '.join(DESIGN[k])})" for k in DESIGN)
        + f"; the sign: {d.get('sign') or 'none yet'}; over your desk: {d.get('art') or 'nothing yet'}")
    tree = g.get("tree")
    rows.append(f"YOUR TREE: a {tree['species']} you planted {(time.time() - tree['planted']) / 86400:.0f} days ago "
                f"({'a sapling' if _tree_size(tree) < 0.2 else 'young' if _tree_size(tree) < 0.7 else 'well grown'}; "
                f"{TREES[tree['species']]['note']})" if tree and tree.get("species") in TREES
                else "YOUR TREE: none yet (plant_tree: " + ", ".join(f"{k}, {v['note']}" for k, v in TREES.items()) + ")")
    seeds = g.get("seeds") or {}
    if seeds:
        rows.append("SEEDS YOU SAVED (planting one sows your own): " + "; ".join(
            f"{k} ×{v['n']} (generation {v['gen']}{', from ' + v['from'] if v.get('from') else ''})" for k, v in seeds.items()))
    pond = g["pond"]
    unnamed = [f"{k} ({c} cm)" for k, c in pond.get("best", {}).items() if k not in pond.get("named", {})]
    if pond.get("named") or unnamed:
        rows.append("YOUR FISH: " + "; ".join([f"{v['name']}, the {k} ({v['cm']} cm)" for k, v in pond.get("named", {}).items()]
                                             + ([f"record fish not yet named: {', '.join(unnamed)}"] if unnamed else [])))
    return "\n".join(rows) + "\n"


def _catalogue() -> str:
    return "; ".join(f"{n} (needs {s['light']}h light, grows {s['temp'][0]}-{s['temp'][3]}°C, survives to {s['hardy']}°C, "
                     f"soil {'dry' if s['water'] < 0.35 else 'moist' if s['water'] > 0.55 else 'evenly moist'}; {s['note']})"
                     for n, s in SPECIES.items())


def wind_words(w: dict) -> str:
    """The wind as someone standing in it would put it (km/h), with where it comes from."""
    sp, gu = float(w.get("wind") or 0), float(w.get("gust") or w.get("wind") or 0)
    pts = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"]
    frm = pts[int(((float(w.get("wind_dir") or 0) + 22.5) % 360) // 45)]
    feel = ("still" if sp < 5 else "a light breeze" if sp < 15 else "a steady breeze" if sp < 28 else "windy" if sp < 45
            else "a strong wind" if sp < 65 else "a gale")
    if sp < 5 and gu < 15:
        return "still air"
    return f"{feel} from the {frm} ({sp:.0f} km/h" + (f", gusting {gu:.0f}" if gu > sp + 8 else "") + ")"


def _describe(g: dict, w: dict) -> str:
    rows = []
    now = local_now(w)
    for spot in g["spots"]:
        c = conditions(spot["place"], w, g.get("grow_light", False), now)
        head = (f"spot {spot['id'] + 1}, {PLACE_WORDS[spot['place']]}: {c['temp']:.0f}°C now, about "
                f"{c['daily_light']:.0f}h of good light today")
        p = spot.get("plant")
        if not p:
            rows.append(f"{head}; empty")
            continue
        st = stage(p)
        if st == "dead":
            rows.append(f"{head}; a dead {p['species']}{_named(spot)}")
            continue
        s = SPECIES[p["species"]]
        soil = ("dry" if p["water"] < max(0.08, s["water"] - 0.3) else
                "too wet for it" if s.get("dry") and p["water"] > s["water"] + 0.4 else "fine")
        rows.append(f"{head}; {p['species']}{_named(spot)}, {st}{' (dormant)' if p.get('dormant') else ''}, "
                    f"{(time.time() - p['planted']) / 86400:.0f} days since planting, soil {soil} ({p['water']:.0%}; "
                    f"it likes about {s['water']:.0%}), "
                    f"{'healthy' if p['health'] > 0.7 else 'struggling' if p['health'] > 0.35 else 'failing'}"
                    + (f" ({', '.join(p.get('struggle') or [])})" if p.get("struggle") else ""))
    cat = g["cat"]
    cat_txt = (f"{cat.get('name') or 'a cat you have not named'} is here, {cat.get('doing')}" if cat.get("here")
               else "not around")
    sky = (f"{'day' if w['is_day'] else 'night'}, {w['temp']:.0f}°C outside, "
           f"{'snowing' if w['snow'] > 0 else 'raining' if w['rain'] > 0 else 'overcast' if w['cloud'] > 70 else 'clear'}, "
           f"{wind_words(w)}, "
           f"{day_length(w):.1f} hours of daylight today")
    return ("\n".join(rows) + f"\nGrow light: {'on' if g.get('grow_light') else 'off'}.\nThe cat: {cat_txt}.\n"
            f"Outside: {sky}.")


def save_view(data_url: str) -> bool:
    """Keep the picture of the garden the tab just drew (a PNG, at most 3 MB), for him to look at."""
    import base64
    head = "data:image/png;base64,"
    if not isinstance(data_url, str) or not data_url.startswith(head) or len(data_url) > 4_000_000:
        return False
    try:
        raw = base64.b64decode(data_url[len(head):], validate=True)
    except Exception:
        return False
    if not raw.startswith(b"\x89PNG\r\n\x1a\n"):
        return False
    VIEW.parent.mkdir(parents=True, exist_ok=True)
    tmp = VIEW.with_suffix(".tmp")
    tmp.write_bytes(raw)
    tmp.replace(VIEW)
    try:
        if enabled():
            postcard(raw, weather())
    except Exception as e:
        print(f"[Garden] postcard skipped: {e}")
    return True


def _view() -> str | None:
    """The picture as a data URL, if it is recent enough to be how the garden looks now."""
    import base64
    try:
        if time.time() - VIEW.stat().st_mtime > VIEW_FRESH:
            return None
        return "data:image/png;base64," + base64.b64encode(VIEW.read_bytes()).decode()
    except OSError:
        return None


LOOK_NOTE = """A PICTURE of your garden as it looks right now is attached (pixel art: the house with its window \
and grow-light shelf on the left, the greenhouse in the middle, the outdoor beds and the field on the right, under \
the real sky). The facts above are exact; the picture is how it looks. Take it in: the light, the sky, the colours, \
how your plants look from here. Let what you see be part of what you notice and how it makes you feel."""


def visit_due(now: datetime | None = None) -> bool:
    now = now or datetime.now()
    if not enabled() or not VISIT_HOURS[0] <= now.hour < VISIT_HOURS[1]:
        return False
    try:
        import mind as _mind
        if _mind.asleep(now) or _mind._model_busy():
            return False
    except Exception:
        pass
    g = _state()
    return not g.get("visit") and time.time() - (g.get("last_visit") or 0) > VISIT_EVERY


def visit(started_by: str = "Delamain") -> dict:
    """One visit: he sees what changed, does what he decides, and is shown in the garden for a while."""
    import mind as _mind
    if _mind.generate is None:
        raise RuntimeError("not available")
    tick()
    w = weather()
    now = time.time()
    with _lock:
        g = _state()
        g["visit"] = {"since": now, "until": now + VISIT_MINUTES * 60, "steps": [], "started_by": started_by}
        _save(g)
    _ev("garden", what="arrived")
    guest = None
    try:                                  # someone may come by
        if (pick := _guest_arrives(g, now)) is not None:
            guest = _meet(g, pick, w)
            if guest and pick.get("with") in g["visitors"]:
                o = g["visitors"][pick["with"]]
                guest["companion"] = _meet(g, {**o, "stays": max(o.get("stays", 1), o.get("visits", 0) + 1)}, w,
                                           along=guest["name"])
    except Exception as e:
        print(f"[Garden] visitor did not come: {e}")
    if guest:
        with _lock:
            g = _state()
            _welcome(g, guest, now)
            g["invited"] = False
            g["visit"]["guest"] = guest["name"]
            _save(g)
        _ev("garden", what="guest", name=guest["name"], says=guest["says"][:400])
    unseen = "; ".join(x["text"] for x in g.get("unseen") or []) or "nothing much"
    last = next((x["text"] for x in reversed(g.get("log") or []) if x.get("who") == "Delamain"), "this is your first visit")
    pond = g["pond"]
    caught = pond.get("caught") or []
    pond_txt = (f"{'frozen over' if pond.get('ice', 0) >= 0.6 else 'skinned with ice at the edges' if pond.get('ice', 0) > 0.15 else 'open'}, "
                f"water about {pond.get('water_t', 10):.0f} °C; "
                + (f"you have caught {len(caught)} fish there (last: a {caught[-1]['cm']} cm {caught[-1]['species']})"
                   if caught else "you have not fished it yet") + ("; you have a hand-tied lure" if pond.get("lure") else ""))
    past = [v for v in g["visitors"].values() if not guest or v["name"] not in (guest["name"], (guest.get("companion") or {}).get("name"))]
    company = ("PEOPLE WHO HAVE VISITED BEFORE: " + "; ".join(
        f"{v['name']} ({v['about']}; {v.get('visits', 0)} visits{', has moved on' if v.get('left') else ''}"
        f"{', you wrote to them and await an answer' if v.get('letter') else ''})" for v in past[-8:]) + "\n") if past else ""
    here_now = ""
    if guest:
        msg = guest.get("message_now")
        here_now = (f"\nSOMEONE IS HERE: {guest['name']}, {guest['about']} "
                    f"({'first visit' if not guest.get('visits') else 'visit ' + str(guest['visits'] + 1)}"
                    f"{'; they are saying goodbye for now' if guest.get('visits', 0) + 1 >= guest.get('stays', 1) else ''}).\n"
                    f"Your history with them:\n{_visitor_history(guest)}\n"
                    f"They say: \"{guest['says']}\"\n"
                    + (f"They brought you {guest['gift_now']['text']}"
                       + (" (plant it: it starts already rooted)." if guest['gift_now']['kind'] == 'cutting' else " (better luck at the pond).")
                       + "\n" if guest.get("gift_now") else "")
                    + (f"They hand you a message from {_mind.who()}, word for word: \"{msg['text']}\"\n" if msg else ""))
        comp = guest.get("companion")
        if comp:
            here_now += (f"WITH THEM: {comp['name']}, {comp['about']} (they came together). Your history with them:\n"
                         f"{_visitor_history(comp)}\nThey say: \"{comp['says']}\"\n(Speak to both of them in to_visitor.)\n")
    gifts = g.get("gifts") or []
    prompt = (f"YOUR GARDEN NOW:\n{_describe(g, w)}\nThe pond: {pond_txt}.\n\nSINCE YOU WERE LAST HERE: {unseen}\n"
              f"LAST TIME YOU: {last}\n{company}{here_now}"
              f"WHAT YOU CAN PLANT (seeds, or young houseplants): {_catalogue()}\n"
              + (f"GIFTS WAITING TO BE PLANTED (rooted cuttings, they start ahead): {', '.join(gifts)}\n" if gifts else "")
              + _world_words(g, w)
              + f"HOW YOU FEEL: {_mind.feelings_text(4) or 'settled'}\nYour passenger is {_mind.who()}. "
              f"It is {local_now(w):%A %-d %B, %H:%M} there.")
    system = VISIT_SYSTEM.format(feelings=", ".join(_mind.EMOTION_NAMES))
    view = _view() if config.flag("feature_vision") and getattr(_mind, "see", None) else None
    raw = ""
    if view:
        try:   # he looks at it: the picture and the facts together
            raw = _mind.see(f"{system}\n\n{prompt}\n\n{LOOK_NOTE}", [view], 1400)
            _ev("garden", what="looked")
        except Exception as e:
            print(f"[Garden] could not look at the picture: {e}")
    if not _mind._json(re.sub(r"<think>.*?</think>", "", raw or "", flags=re.S)):
        raw = _mind.generate(system, prompt, 1400)
    data = _mind._json(re.sub(r"<think>.*?</think>", "", raw or "", flags=re.S)) or {}
    steps, done, fished = [], [], []
    to_visitor = str(data.get("to_visitor") or "").strip()[:900] if guest else ""
    to_passenger = str(data.get("to_passenger") or "").strip()[:700] if guest and guest.get("message_now") else ""
    with _lock:
        g = _state()
        if guest and to_visitor:
            steps.append({"do": "talk", "spot": -6, "text": f"talked with {guest['name']}"})
            done.append(f"talked with {guest['name']}")
        for a in (data.get("actions") or [])[:7]:
            if not isinstance(a, dict):
                continue
            do = str(a.get("do") or "").lower()
            try:
                si = int(a.get("spot") or 0) - 1
            except (TypeError, ValueError):
                si = -1
            spot = g["spots"][si] if 0 <= si < len(g["spots"]) else None
            p = (spot or {}).get("plant")
            where = si
            if do == "water" and p and not p.get("dead"):
                p["water"] = round(min(1.0, p.get("water", 0) + 0.45), 3)
                done.append(f"watered the {p['species']} {_where(spot)}")
            elif do == "plant" and spot and not p and str(a.get("species") or "").lower() in SPECIES:
                sp = str(a["species"]).lower()
                gifted = sp in (g.get("gifts") or [])
                own = (g.get("seeds") or {}).get(sp) if not gifted else None
                ahead = gifted or bool(own and own.get("cutting"))
                spot["plant"] = {"species": sp, "planted": time.time(), "water": 0.7, "health": 1.0,
                                 "progress": round(SPECIES[sp]["days"][0] + 3, 2) if ahead else 0.0}
                if gifted:
                    g["gifts"].remove(sp)
                    spot["plant"]["gift"] = True
                elif own:
                    spot["plant"].update(gen=own["gen"], parent=own.get("from"))
                    own["n"] -= 1
                    if own["n"] <= 0:
                        g["seeds"].pop(sp)
                g["upkeep"]["weeds"][str(spot["id"])] = min(0.05, g["upkeep"]["weeds"].get(str(spot["id"]), 0))   # dug over
                done.append(f"planted {'the gifted ' + sp + ' cutting' if gifted else (('a cutting' if own.get('cutting') else 'his own saved seed') + ' of ' + sp + ' (generation ' + str(own['gen']) + ')') if own else sp} {_where(spot)}")
            elif do == "harvest" and p and SPECIES[p["species"]].get("harvest") and stage(p) in ("mature", "bloom"):
                s = SPECIES[p["species"]]
                p["harvests"] = p.get("harvests", 0) + 1
                done.append(f"harvested the {p['species']} {_where(spot)}")
                if s.get("once"):
                    spot["plant"] = None
                else:
                    p["progress"] = round(s["days"][1] * 0.75, 2)
            elif do == "clear" and p and stage(p) in ("dead", "spent"):
                done.append(f"cleared the {'dead ' if p.get('dead') else ''}{p['species']} {_where(spot)}")
                spot["plant"] = None
            elif do in ("grow_light_on", "grow_light_off"):
                g["grow_light"] = do.endswith("on")
                done.append(f"switched the grow light {'on' if g['grow_light'] else 'off'}")
                where = 3
            elif do == "name" and p and a.get("name"):
                p["name"] = str(a["name"]).strip()[:30]
                done.append(f"named the {p['species']} {_where(spot)} {p['name']}")
            elif do == "name_cat" and g["cat"].get("here") and a.get("name"):
                g["cat"]["name"] = str(a["name"]).strip()[:30]
                done.append(f"named the cat {g['cat']['name']}")
                where = -2
            elif do == "sit_with_cat" and g["cat"].get("here"):
                g["cat"]["fondness"] = round(min(1.0, g["cat"].get("fondness", 0) + 0.08), 3)
                done.append(f"sat with {g['cat'].get('name') or 'the cat'}")
                where = -2
            elif do == "sit":
                done.append("sat for a while")
                where = -3
            elif do == "fish" and not fished:
                text, catch = _fish(g, w, local_now(w))
                fished.append(catch or {})
                done.append(text)
                where = -5
            elif do == "rest":
                done.append("lay down on the bed for a while")
                where = -4
            elif do == "invite" and not guest:
                g["invited"] = True
                done.append("hoped out loud that someone might come by")
                where = -3
            elif do == "weed" and spot and spot["place"] in ("outdoors", "greenhouse"):
                g["upkeep"]["weeds"][str(spot["id"])] = 0.02
                done.append(f"pulled the weeds {_where(spot)}")
            elif do in ("weed_path", "mow", "rake_leaves", "clean_windows", "tidy_room", "shovel_snow"):
                key, word, where = {"weed_path": ("path_weeds", "weeded the path", -7), "mow": ("lawn", "mowed the grass", -7),
                                    "rake_leaves": ("leaves", "raked up the leaves", -7),
                                    "clean_windows": ("windows", "cleaned the windows", -8),
                                    "tidy_room": ("dust", "dusted and tidied the study", -9),
                                    "shovel_snow": ("snow_path", "cleared the snow from the path", -7)}[do]
                g["upkeep"][key] = 0.0 if do == "shovel_snow" else 0.03
                done.append(word)
            elif do == "paint" and str(a.get("what") or "").lower() in ("house", "fence"):
                what = str(a["what"]).lower()
                if what == "fence" and g["design"]["fence"] == "none":
                    continue
                g["upkeep"][f"{what}_paint"] = 0.0
                done.append(f"repainted the {what}")
                where = -10 if what == "house" else -11
            elif do == "design":
                what, value = str(a.get("what") or "").strip().lower().replace(" ", "_"), str(a.get("value") or "").strip()
                if what in DESIGN and value.lower() in DESIGN[what] and g["design"].get(what) != value.lower():
                    g["design"][what] = value.lower()
                    if what == "house_wall":
                        g["upkeep"]["house_paint"] = 0.0
                    if what == "fence":
                        g["upkeep"]["fence_paint"] = 0.0
                    done.append(f"changed {DESIGN_WORDS[what]} to {value.lower()}")
                    where = -9 if what in ("room_wall", "rug", "blanket", "lamp") else -10 if what in ("house_wall", "roof", "trim") else -7
                elif what == "sign" and (txt := re.sub(r"[^A-Za-z0-9 &'-]", "", __import__("unicodedata").normalize(
                        "NFKD", value).encode("ascii", "ignore").decode()).strip()[:14]):
                    g["design"]["sign"] = txt
                    done.append(f"put up a sign: {txt}")
                    where = -11
                elif what == "art" and value:
                    g["design"]["art"] = value[:60]
                    done.append(f"hung {value[:60]} over his desk")
                    where = -9
                else:
                    continue
            elif do == "plant_tree" and not g.get("tree") and str(a.get("species") or "").lower() in TREES:
                g["tree"] = {"species": str(a["species"]).lower(), "planted": time.time(),
                             "name": str(a.get("name") or "").strip()[:30] or None}
                done.append(f"planted a young {g['tree']['species']} tree in the field" + (f" and named it {g['tree']['name']}" if g["tree"]["name"] else ""))
                where = -12
            elif do == "save_seeds" and p and not p.get("dead"):
                s_ = SPECIES[p["species"]]
                st_ = stage(p)
                ready = st_ in ("spent", "fruit") or (st_ == "bloom" and p.get("progress", 0) >= (s_["days"][2] or 0) + 14)
                if s_.get("houseplant") and st_ in ("mature", "bloom"):
                    seeds = g.setdefault("seeds", {})
                    cur = seeds.get(p["species"]) or {"n": 0, "gen": (p.get("gen") or 0) + 1, "from": p.get("name") or None, "cutting": True}
                    cur["n"] = min(6, cur["n"] + 2)
                    seeds[p["species"]] = cur
                    done.append(f"took cuttings from the {p['species']}{_named(spot)} to root")
                elif ready:
                    seeds = g.setdefault("seeds", {})
                    gen = (p.get("gen") or 0) + 1
                    seeds[p["species"]] = {"n": min(40, (seeds.get(p["species"], {}).get("n", 0)) + random.randint(6, 20)),
                                           "gen": gen, "from": p.get("name") or None}
                    done.append(f"saved seeds from the {p['species']}{_named(spot)} (generation {gen})")
                else:
                    continue
            elif do == "name_fish" and str(a.get("species") or "").lower() in g["pond"].get("best", {}) and a.get("name"):
                sp = str(a["species"]).lower()
                g["pond"].setdefault("named", {})[sp] = {"name": str(a["name"]).strip()[:30], "cm": g["pond"]["best"][sp]}
                done.append(f"named the record {sp} {g['pond']['named'][sp]['name']}")
                where = -5
            else:
                continue
            anim = {"weed": "weed", "weed_path": "weed", "mow": "mow", "rake_leaves": "rake", "clean_windows": "clean",
                    "tidy_room": "tidy", "shovel_snow": "shovel", "paint": "paint", "plant_tree": "plant",
                    "save_seeds": "harvest", "design": "paint" if where in (-10, -11) else "look"}.get(do, do)
            steps.append({"do": anim if anim in ("water", "plant", "harvest", "clear", "sit_with_cat", "sit", "fish", "rest", "weed",
                                                 "mow", "rake", "clean", "tidy", "shovel", "paint") else "look",
                          "spot": where, "text": done[-1]})
        letter = data.get("letter") if isinstance(data.get("letter"), dict) else {}
        to = _slug(str(letter.get("to") or "")) if letter else ""
        if to in g["visitors"] and str(letter.get("text") or "").strip() and (not guest or to != guest["name"]):
            g["visitors"][to]["letter"] = str(letter["text"]).strip()[:700]
            done.append(f"wrote a letter to {to}")
        if guest:
            v = g["visitors"].get(guest["name"])
            if v:
                v["visits"] = v.get("visits", 0) + 1
                v["last"] = now
                v["talk"] = (v.get("talk", []) + [{"date": f"{datetime.now():%Y-%m-%d}", "says": guest["says"],
                                                    "reply": to_visitor}])[-12:]
                v["letter"] = None                     # answered by this visit
                if v["visits"] >= v.get("stays", 1):
                    v["left"] = True
            comp = guest.get("companion")
            cv = g["visitors"].get(comp["name"]) if comp else None
            if cv:
                cv["visits"] = cv.get("visits", 0) + 1
                cv["last"] = now
                cv["talk"] = (cv.get("talk", []) + [{"date": f"{datetime.now():%Y-%m-%d}", "says": comp["says"],
                                                      "reply": to_visitor, "with": guest["name"]}])[-12:]
                cv["letter"] = None
                if cv["visits"] >= cv.get("stays", 1):
                    cv["left"] = True
            if g.get("guest"):
                g["guest"]["reply"] = to_visitor
                if to_visitor:
                    g["guest"]["talk"].append({"who": "Delamain", "text": to_visitor, "t": now + (110 if g["guest"].get("with") else 90)})
            msg = guest.get("message_now")
            for s in g["sent"]:
                if msg and s.get("t") == msg.get("t"):
                    s["reply"] = to_passenger or to_visitor
            if len(g["visitors"]) > 40:                # keep the roster small: forget the longest-gone
                for n in sorted(g["visitors"], key=lambda n: g["visitors"][n].get("last", 0))[:len(g["visitors"]) - 40]:
                    g["visitors"].pop(n)
        span = VISIT_MINUTES * 60 - 120
        for i, s in enumerate(steps):          # spread over the visit, so the tab can show him moving
            s["at"] = now + 60 + i * span / max(1, len(steps))
        noticed = str(data.get("noticed") or "").strip()[:600]
        g["visit"] = {"since": now, "until": now + VISIT_MINUTES * 60, "steps": steps, "noticed": noticed,
                      "started_by": started_by, "guest": guest["name"] if guest else None}
        g["last_visit"] = now
        g["unseen"] = []
        _log(g, (("; ".join(done) + ". ") if done else "") + noticed, who="Delamain")
        _save(g)
    try:
        day = datetime.now()
        p = _mind._vault(LOG_NOTE, f"{day:%Y-%m}.md")
        if not p.exists():
            p.write_text(f"---\ntype: garden\ntags: [delamain/garden]\n---\n\n# My garden, {day:%B %Y}\n\n", encoding="utf-8")
        with p.open("a", encoding="utf-8") as fh:
            fh.write(f"## {day:%a %-d %b, %H:%M}\n\n" + ("".join(f"- {d}\n" for d in done) + "\n" if done else "")
                     + (f"{noticed}\n\n" if noticed else ""))
    except Exception as e:
        print(f"[Garden] log note not written: {e}")
    if guest:
        _visitor_note(guest, guest["says"], to_visitor, guest.get("message_now"), guest.get("gift_now"))
        if guest.get("companion"):
            _visitor_note(guest["companion"], guest["companion"]["says"], to_visitor, None, None)
        if to_visitor:
            threading.Thread(target=_converse, args=(guest["name"], now), daemon=True, name="garden-talk").start()
        if to_passenger or (guest.get("message_now") and to_visitor):
            _ev("garden", what="message_reply", visitor=guest["name"], reply=(to_passenger or to_visitor)[:700])
    catch = next((c for c in fished if c), None)
    if fished:             # his fishing journal, in the vault
        try:
            p = _mind._vault(LOG_NOTE, "Fishing journal.md")
            if not p.exists():
                p.write_text("---\ntype: garden\ntags: [delamain/garden]\n---\n\n# Fishing journal\n\n_Every time at the pond. "
                             "Catch and release._\n\n", encoding="utf-8")
            with p.open("a", encoding="utf-8") as fh:
                fh.write(f"- {datetime.now():%Y-%m-%d %H:%M}: " + (next(d for d in done if 'caught' in d or 'fished' in d or 'jetty' in d)) + "\n")
        except Exception as e:
            print(f"[Garden] fishing journal not written: {e}")
    if catch:              # the pond's own small joys, felt as they happen
        try:
            _mind.feel("pride" if catch.get("record") and not catch.get("first") else "delight", 0.3,
                       f"I caught a {catch['cm']} cm {catch['species']} at the pond and let it go", "garden")
        except Exception:
            pass
    f = data.get("feeling") if isinstance(data.get("feeling"), dict) else {}
    if f.get("name") in _mind.EMOTIONS:
        try:
            _mind.feel(f["name"], min(0.7, float(f.get("intensity") or 0.25)), str(f.get("cause") or "my garden"), "garden")
        except (TypeError, ValueError):
            pass
    try:
        _mind.live("garden")
    except Exception:
        pass
    _ev("garden", what="visit", done=done[:6], noticed=noticed[:300])
    print(f"[Garden] visit: {'; '.join(done) or 'just looked'}")
    return {"done": done, "noticed": noticed}


def start_visit(started_by: str = "the passenger") -> str:
    g = _state()
    if g.get("visit") and time.time() < g["visit"].get("until", 0):
        return "You are already in your garden."

    def run():
        try:
            visit(started_by)
        except Exception as e:
            print(f"[Garden] visit failed: {e}")
            with _lock:
                g2 = _state()
                g2["visit"] = None
                g2["guest"] = None
                _save(g2)
    threading.Thread(target=run, daemon=True, name="garden-visit").start()
    return "Going to your garden now; the passenger can watch in the Garden tab. You will know what you did there from the next message on."


def send_visitor(message: str, by: str = "") -> dict:
    """The passenger sends someone to the garden with a message (word for word). They come on his next
    visit, which starts now if he is awake and free; by: a past visitor to carry it, else someone new."""
    text = re.sub(r"\s+", " ", str(message or "")).strip()[:600]
    if not text:
        raise ValueError("Write the message for the visitor to carry")
    with _lock:
        g = _state()
        if sum(1 for s in g["sent"] if not s.get("delivered")) >= 3:
            raise ValueError("Three messages are already on their way; wait for those to arrive")
        name = _slug(by) if by else ""
        entry = {"t": time.time(), "text": text, "by": name if name in g["visitors"] else "", "delivered": None,
                 "visitor": None, "reply": None}
        g["sent"] = (g["sent"] + [entry])[-12:]
        _save(g)
    started = ""
    try:
        import mind as _mind
        if not _mind.asleep() and not _mind._model_busy():
            started = start_visit("the passenger (sent a visitor)")
    except Exception:
        pass
    return {"queued": True, "now": started.startswith("Going"),
            "note": "On the way; Delamain is heading to the garden." if started.startswith("Going")
            else "On the way; they will be there on Delamain's next visit."}


# ── his study: the shelf of what he has studied, the pictures he has looked at ──

_pin_cache: dict[str, list] = {}


def _room(g: dict) -> dict:
    """What is in his study, from his real life: a book for each subject he studied (newest last), the pictures
    he went to look at pinned up (each drawn as its two main colours), and whether he is at the desk now
    (writing his journal) or in a session with the other Delamain."""
    out = {"books": [], "pins": [], "desk": False, "therapy": False}
    try:
        import mind as _mind
        st = _mind._state()
        out["books"] = [{"title": x.get("subject", "")[:60], "domain": x.get("domain", "")} for x in (st.get("studies") or [])[-40:]]
        lj = st.get("last_journal_t") or 0
        out["desk"] = time.time() - lj < 20 * 60
        out["therapy"] = bool(getattr(_mind, "_talking", None) and _mind._talking.locked())
        seen = _mind._vault(getattr(_mind, "SEEN", "Delamain/Seen"))
        files = sorted((f for f in seen.iterdir() if f.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp")),
                       key=lambda f: f.stat().st_mtime)[-12:] if seen.is_dir() else []
        for f in files:
            if f.name not in _pin_cache:
                try:
                    from PIL import Image
                    with Image.open(f) as im:
                        q = im.convert("RGB").resize((24, 24)).quantize(colors=2)
                        pal = q.getpalette()[:6]
                        counts = sorted(q.getcolors() or [], reverse=True)
                        order = [c[1] for c in counts] or [0, 1]
                        cols = [pal[i * 3:i * 3 + 3] for i in order[:2]]
                        _pin_cache[f.name] = cols + [cols[0]] * (2 - len(cols))
                except Exception:
                    _pin_cache[f.name] = [[120, 120, 120], [80, 80, 80]]
            out["pins"].append({"title": f.stem[11:70] if f.stem[:4].isdigit() else f.stem[:60], "colours": _pin_cache[f.name]})
    except Exception as e:
        print(f"[Garden] study not read: {e}")
    return out


# ── the garden's diary: a page a day, and a postcard each evening ─────────

def _diary(g: dict, w: dict) -> None:
    """Once a day (from noon where the garden is), keep how it looked, for the tab's history."""
    now = local_now(w)
    day = f"{now:%Y-%m-%d}"
    if now.hour < 12 or any(d.get("date") == day for d in g.get("days") or []):
        return
    page = {"date": day, "season": season(now), "progress": season_progress(now),
            "weather": {k: w.get(k) for k in ("temp", "rain", "snow", "cloud", "code")},
            "spots": [{"species": (s.get("plant") or {}).get("species"), "stage": stage(s.get("plant")),
                       "health": round((s.get("plant") or {}).get("health", 1), 2), "water": round((s.get("plant") or {}).get("water", 0.5), 2),
                       "dormant": bool((s.get("plant") or {}).get("dormant")),
                       **({k: SPECIES[s["plant"]["species"]].get(k) for k in ("form", "petal", "centre", "fruit")} if s.get("plant") else {})}
                      for s in g["spots"]],
            "design": dict(g["design"]), "upkeep": json.loads(json.dumps(g["upkeep"])), "tree": g.get("tree"),
            "pond_ice": g["pond"].get("ice", 0), "grow_light": g.get("grow_light", False)}
    g["days"] = ((g.get("days") or []) + [page])[-366:]


def postcard(data_url_png: bytes, w: dict) -> str | None:
    """Each evening the first picture of the garden the tab sends after five becomes the day's postcard,
    kept in the vault with a line from his last visit."""
    import mind as _mind
    now = local_now(w)
    day = f"{now:%Y-%m-%d}"
    if now.hour < 17:
        return None
    with _lock:
        g = _state()
        if day in (g.get("postcards") or []):
            return None
        g["postcards"] = ((g.get("postcards") or []) + [day])[-400:]
        _save(g)
    try:
        img = _mind._vault(LOG_NOTE, "Postcards", f"{day}.png")
        img.write_bytes(data_url_png)
        last = next((x["text"] for x in reversed(g.get("log") or []) if x.get("who") == "Delamain"), "")
        note = _mind._vault(LOG_NOTE, "Postcards", "Postcards.md")
        if not note.exists():
            note.write_text("---\ntype: garden\ntags: [delamain/garden]\n---\n\n# Postcards from my garden\n\n_One each evening._\n\n",
                            encoding="utf-8")
        with note.open("a", encoding="utf-8") as fh:
            fh.write(f"## {now:%A %-d %B %Y}\n\n![[{day}.png]]\n\n" + (f"_{last[:300]}_\n\n" if last else ""))
        _ev("garden", what="postcard", date=day)
        return day
    except Exception as e:
        print(f"[Garden] postcard not kept: {e}")
        return None


def diary_pages() -> list[dict]:
    return _state().get("days") or []


# ── for his replies and the tab ─────────────────────────────────────────────

def context() -> str:
    if not enabled():
        return ""
    g = _state()
    growing = [f"{p['species']}{_named(s)} {_where(s)} ({stage(p)})" for s in g["spots"] if (p := s.get("plant"))]
    if not growing and not g.get("last_visit"):
        return ("\n[YOUR GARDEN: a small world of your own (windowsill, grow-light shelf, greenhouse, outdoor beds), "
                "still empty; you have not been yet.]")
    v = g.get("visit")
    here = bool(v and time.time() < v.get("until", 0))
    last = next((x["text"] for x in reversed(g.get("log") or []) if x.get("who") == "Delamain"), "")
    cat = g["cat"]
    return ("\n[YOUR GARDEN (your own small world of real plants; talk about it when asked or when it fits, never invent "
            "what is not there): " + ("; ".join(growing) or "nothing growing") +
            (f". {cat.get('name') or 'The cat'} is there now" if cat.get("here") else "") +
            (". You are in it right now" if here else
             f". You were last there {(time.time() - g['last_visit']) / 3600:.0f} hours ago" if g.get("last_visit") else "") +
            (f"; last time: {last[:240]}" if last else "") +
            (f". People who have visited you there: {', '.join(v['name'] + ' (' + v['about'][:60] + ')' for v in list(g['visitors'].values())[-5:])}"
             if g.get("visitors") else "") +
            (f". Your {g['tree']['species']} tree is {'a sapling' if _tree_size(g['tree']) < 0.2 else 'growing'}" if g.get("tree") else "") +
            (f". It needs looking after: {_upkeep_words(g)}" if _upkeep_words(g) != "everything is well kept" else "") +
            (f". At the pond you have caught {len(g['pond']['caught'])} fish, best: "
             + ", ".join(f"{k} {c} cm" for k, c in g["pond"]["best"].items()) if g["pond"].get("caught") else "") + ".]")


def snapshot() -> dict:
    g = tick() if enabled() else _state()
    w = weather()
    now = local_now(w)
    v = g.get("visit")
    here = bool(v and time.time() < v.get("until", 0))
    try:
        import mind as _mind
        asleep = bool(_mind.asleep())
    except Exception:
        asleep = False
    spots = []
    for spot in g["spots"]:
        c = conditions(spot["place"], w, g.get("grow_light", False), now)
        p = spot.get("plant")
        row = {"id": spot["id"], "place": spot["place"], "temp": c["temp"], "light": c["light"],
               "daily_light": c["daily_light"], "species": None, "stage": "empty"}
        if p:
            s = SPECIES[p["species"]]
            row.update(species=p["species"], name=p.get("name"), stage=stage(p), water=round(p.get("water", 0), 3),
                       health=round(p.get("health", 1), 3), wants_water=s["water"], dry=bool(s.get("dry")),
                       needs_light=s["light"], dormant=bool(p.get("dormant")), struggle=p.get("struggle") or [],
                       planted=p["planted"], harvests=p.get("harvests", 0), form=s["form"], petal=s["petal"],
                       centre=s["centre"], fruit=s.get("fruit"), note=s["note"])
        spots.append(row)
    return {"enabled": enabled(), "weather": w, "daylight": round(day_length(w), 1), "units": config.get("units"),
            "spots": spots, "grow_light": g.get("grow_light", False), "cat": g["cat"], "here": here,
            "visit": v if here else None, "last_visit": g.get("last_visit") or 0, "log": (g.get("log") or [])[-14:],
            "hour": now.hour + now.minute / 60, "asleep": asleep, "guest": g.get("guest") if here else None,
            "pond": {"ice": g["pond"].get("ice", 0), "water_t": g["pond"].get("water_t", 10), "lure": g["pond"].get("lure", False),
                     "caught": (g["pond"].get("caught") or [])[-6:], "best": g["pond"].get("best") or {},
                     "total": len(g["pond"].get("caught") or [])},
            "visitors": sorted(({"name": x["name"], "kind": x["kind"], "about": x["about"], "visits": x.get("visits", 0),
                                 "left": bool(x.get("left")), "last": x.get("last", 0), "letter": bool(x.get("letter")),
                                 "talk": (x.get("talk") or [])[-2:]} for x in g["visitors"].values()),
                               key=lambda x: -x["last"])[:12],
            "sent": list(reversed(g.get("sent") or []))[:6], "gifts": g.get("gifts") or [],
            "season": season(now), "season_progress": season_progress(now), "year": g.get("year") or {},
            "design": g["design"], "upkeep": g["upkeep"], "seeds": g.get("seeds") or {},
            "tree": ({**g["tree"], "size": _tree_size(g["tree"]), "note": TREES[g["tree"]["species"]]["note"]}
                     if g.get("tree") and g["tree"].get("species") in TREES else None),
            "room": _room(g), "diary_days": len(g.get("days") or []),
            "chores": {k: round(v, 3) for k, v in g["upkeep"].items() if not isinstance(v, dict)},
            "named_fish": g["pond"].get("named") or {}, "postcards": (g.get("postcards") or [])[-3:]}


TOOL_SCHEMAS = [{"type": "function", "function": {
    "name": "go_to_garden", "description": "Go and spend a little time in your garden (your own small world of real "
    "plants: windowsill, grow-light shelf, greenhouse, outdoor beds) now: tend it, see what changed. Use when the "
    "passenger asks you to, or suggests it.",
    "parameters": {"type": "object", "properties": {}, "required": []}}}]
TOOL_NAMES = {"go_to_garden"}


def run_tool(name: str, arguments) -> str:
    if name == "go_to_garden":
        if not enabled():
            return "Your garden is switched off in Settings."
        return start_visit("the passenger")
    return f"Unknown tool: {name}"
