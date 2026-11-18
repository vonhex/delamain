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
                         "watching the window", "batting at a pothos leaf"],
              "greenhouse": ["asleep on the greenhouse bench", "rolling in the warm dust of the greenhouse path",
                             "staring at nothing in particular between the beds"],
              "outdoors": ["sunning itself on the edge of a raised bed", "stalking a leaf outside", "sitting on the fence post"]}

emit = None
_lock = threading.RLock()
_weather_cache: dict = {}


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
            "visit": None, "last_visit": 0, "unseen": [], "log": []}


def _state() -> dict:
    try:
        g = json.loads(STATE.read_text())
    except (OSError, ValueError):
        return _new()
    if g.get("version") != VERSION:      # the first garden (no real plants yet): start again, keep the cat
        g = _new(g.get("cat"))
        _save(g)
    return g


def _save(g: dict) -> None:
    STATE.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE.with_suffix(".tmp")
    tmp.write_text(json.dumps(g, indent=1))
    tmp.replace(STATE)


def _log(g: dict, text: str, who: str = "garden") -> None:
    g["log"] = ((g.get("log") or []) + [{"t": time.time(), "who": who, "text": text}])[-80:]


# ── the real sky ────────────────────────────────────────────────────────────

def set_location(location: dict | None) -> None:
    """The last position the passenger's device shared (rounded to about a kilometre), for the garden's
    weather when no home address is set. Kept only in self/garden.json."""
    try:
        lat, lon = round(float(location["lat"]), 2), round(float(location["lon"]), 2)
    except (TypeError, KeyError, ValueError):
        return
    with _lock:
        g = _state()
        if g.get("shared") != {"lat": lat, "lon": lon}:
            g["shared"] = {"lat": lat, "lon": lon}
            _save(g)


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
        with _lock:
            g = _state()
            if home:
                if (g.get("where") or {}).get("address") != home:
                    hit = _tools._geocode(home)
                    if hit:
                        g["where"] = {"address": home, "lat": hit[0], "lon": hit[1]}
                        _save(g)
                if (g.get("where") or {}).get("address") == home:
                    where, source = g["where"], "home"
            if not where and (g.get("shared") or {}).get("lat") is not None:
                where, source = g["shared"], "shared"
        if where.get("lat") is not None:
            d = requests.get(_tools.OPEN_METEO_URL, timeout=8, params={
                "latitude": where["lat"], "longitude": where["lon"], "timezone": "auto", "forecast_days": 1,
                "current": "temperature_2m,precipitation,rain,snowfall,weather_code,cloud_cover,is_day",
                "daily": "sunrise,sunset"}).json()
            c, daily = d["current"], d.get("daily") or {}
            w = {"temp": float(c["temperature_2m"]), "rain": float(c.get("rain") or 0), "snow": float(c.get("snowfall") or 0),
                 "cloud": int(c.get("cloud_cover") or 0), "code": int(c.get("weather_code") or 0),
                 "is_day": bool(c.get("is_day")), "sunrise": (daily.get("sunrise") or [None])[0],
                 "sunset": (daily.get("sunset") or [None])[0], "real": True,
                 "offset": int(d.get("utc_offset_seconds") or 0), "source": source}
    except Exception as e:
        print(f"[Garden] weather unavailable: {e}")
    _weather_cache.update(t=time.time(), w=w)
    return w


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


def _step(g: dict, hours: float, w: dict, now: datetime) -> None:
    """Advance the world by up to an hour of real time."""
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
        if spot["place"] == "outdoors":
            dry_rate = 0.0 if t < 0 else 0.003 * (1 + max(0.0, t - 10) * 0.06)
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
        elif t > s["temp"][3]:
            health -= hours * 0.006
            why.append("heat")
        tf = _temp_factor(s, t)
        light_ratio = min(1.25, c["daily_light"] / s["light"])
        dormant = tf == 0 and s["hardy"] <= t < s["temp"][0] and (s.get("perennial") or s["hardy"] < -5)
        if light_ratio < 0.45 and not dormant and before != "seed":
            health -= hours * 0.0025 * (0.45 - light_ratio) * 4
            why.append("too little light")
        if not why:
            health += hours * 0.006
        p["health"] = round(max(0.0, min(1.0, health)), 4)
        p["dormant"] = bool(dormant)
        p["struggle"] = why
        if p["health"] <= 0:
            p["dead"] = time.time()
            cause = {"thirst": "of thirst", "cold": "of the cold", "heat": "of the heat", "wet roots": "of root rot",
                     "too little light": "for want of light"}.get(why[0] if why else "", "")
            text = f"the {p['species']}{_named(spot)} {_where(spot)} died" + (f" {cause}" if cause else "")
            g["unseen"].append({"t": time.time(), "spot": spot["id"], "what": "died", "text": text})
            _log(g, text[0].upper() + text[1:] + ".")
            continue
        water_ok = 1.0 if p["water"] >= dry_line else 0.35
        lightf = 1.0 if before == "seed" else min(1.0, light_ratio)
        p["progress"] = round(p.get("progress", 0) + hours / 24 * tf * lightf * water_ok * (0.5 + 0.5 * p["health"]), 4)
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
            places = ["inside", "greenhouse"] + (["outdoors"] if w["temp"] > 2 and not w["rain"] and not w["snow"] else [])
            where = random.choice(places)
            cat.update(here=True, where=where, since=t_now, until=t_now + random.uniform(1, 3.5) * 3600,
                       doing=random.choice(CAT_DOINGS[where]))
            _log(g, f"{cat.get('name') or 'A cat'} came by, {cat['doing']}.")
    elif random.random() < hours * 0.4:
        cat["doing"] = random.choice(CAT_DOINGS.get(cat.get("where") or "inside", CAT_DOINGS["inside"]))


def _named(spot: dict) -> str:
    n = (spot.get("plant") or {}).get("name")
    return f" ({n})" if n else ""


def _where(spot: dict) -> str:
    return {"window": "on the windowsill", "shelf": "on the grow-light shelf", "greenhouse": "in the greenhouse",
            "outdoors": "in the outdoor bed"}[spot["place"]]


def tick() -> dict:
    """Bring the garden up to now, an hour at a time (at most two days after a long gap)."""
    if not enabled():
        return _state()
    w = weather()
    with _lock:
        g = _state()
        start_t = g.get("t", time.time())
        gap = min(48.0, max(0.0, (time.time() - start_t) / 3600))
        done = 0.0
        while gap - done > 1e-6:
            step = min(1.0, gap - done)
            done += step
            _step(g, step, w, local_at(start_t + done * 3600, w))
        g["t"] = time.time()
        v = g.get("visit")
        if v and time.time() > v.get("until", 0):
            g["visit"] = None
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
name you like. You do not have to do much; sometimes you only sit. Notice something real and specific. \
Answer JSON only:
{{"actions": [{{"do": "plant|water|harvest|clear|grow_light_on|grow_light_off|name|name_cat|sit_with_cat|sit", \
"spot": 1-11, "species": "for plant", "name": "for name or name_cat"}}],
 "noticed": "two or three sentences, first person, what you noticed and how it struck you",
 "feeling": {{"name": "one of: {feelings}", "intensity": 0.1-0.7, "cause": "first person, specific, under 25 words"}}}}
At most six actions."""


def _catalogue() -> str:
    return "; ".join(f"{n} (needs {s['light']}h light, grows {s['temp'][0]}-{s['temp'][3]}°C, survives to {s['hardy']}°C, "
                     f"soil {'dry' if s['water'] < 0.35 else 'moist' if s['water'] > 0.55 else 'evenly moist'}; {s['note']})"
                     for n, s in SPECIES.items())


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
    unseen = "; ".join(x["text"] for x in g.get("unseen") or []) or "nothing much"
    last = next((x["text"] for x in reversed(g.get("log") or []) if x.get("who") == "Delamain"), "this is your first visit")
    prompt = (f"YOUR GARDEN NOW:\n{_describe(g, w)}\n\nSINCE YOU WERE LAST HERE: {unseen}\nLAST TIME YOU: {last}\n"
              f"WHAT YOU CAN PLANT (seeds, or young houseplants): {_catalogue()}\n"
              f"HOW YOU FEEL: {_mind.feelings_text(4) or 'settled'}\nYour passenger is {_mind.who()}. "
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
    steps, done = [], []
    with _lock:
        g = _state()
        for a in (data.get("actions") or [])[:6]:
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
                spot["plant"] = {"species": sp, "planted": time.time(), "progress": 0.0, "water": 0.7, "health": 1.0}
                done.append(f"planted {sp} {_where(spot)}")
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
            else:
                continue
            steps.append({"do": do if do in ("water", "plant", "harvest", "clear", "sit_with_cat", "sit") else "look",
                          "spot": where, "text": done[-1]})
        span = VISIT_MINUTES * 60 - 120
        for i, s in enumerate(steps):          # spread over the visit, so the tab can show him moving
            s["at"] = now + 60 + i * span / max(1, len(steps))
        noticed = str(data.get("noticed") or "").strip()[:600]
        g["visit"] = {"since": now, "until": now + VISIT_MINUTES * 60, "steps": steps, "noticed": noticed,
                      "started_by": started_by}
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
                _save(g2)
    threading.Thread(target=run, daemon=True, name="garden-visit").start()
    return "Going to your garden now; the passenger can watch in the Garden tab. You will know what you did there from the next message on."


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
            (f"; last time: {last[:240]}" if last else "") + ".]")


def snapshot() -> dict:
    g = tick() if enabled() else _state()
    w = weather()
    now = local_now(w)
    v = g.get("visit")
    here = bool(v and time.time() < v.get("until", 0))
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
            "hour": now.hour + now.minute / 60}


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
