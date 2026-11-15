"""Delamain's brain: a live feed of what Delamain is doing, for the Brain view.

main.py calls emit() at the real moments of a turn: a message is heard, a pre-recorded
reflex answers it, the LLM thinks (each round, with its token counts and time), a tool
runs, Delamain catches itself promising something it has not done, a route is planned,
the voice is synthesized, a reply is spoken, the personality core changes. The page
subscribes over Server-Sent Events (/api/brain/events) and draws it.

Nothing here talks to the LLM or changes a reply; it only records. emit() is safe to call
from the event loop or from worker threads.

Optionally it also reads the LLM server's Prometheus /metrics (llama.cpp and compatible
servers publish one) to show generation speed; servers without it are simply skipped.
"""
from __future__ import annotations

import asyncio
import json
import re
import time
from collections import deque

import requests

import config

# Which part of the brain each tool belongs to (see the Brain view's legend).
TOOL_REGION = {
    "web_search": "senses", "read_webpage": "senses", "get_news": "senses", "get_weather": "senses",
    "get_route": "navigation",
    "remember": "memory", "forget": "memory", "write_note": "memory", "append_to_note": "memory",
    "read_note": "memory", "list_notes": "memory", "search_notes": "memory",
    "set_reminder": "plans", "list_reminders": "plans", "cancel_reminder": "plans",
    "list_adventures": "imagination", "start_adventure": "imagination", "pause_adventure": "imagination",
    "end_adventure": "imagination", "note_fact": "imagination",
}

_loop: asyncio.AbstractEventLoop | None = None
_subscribers: set[asyncio.Queue] = set()
_recent: deque = deque(maxlen=120)
_seq = 0


def _new_day() -> dict:
    return {"day": time.strftime("%Y-%m-%d"), "heard": 0, "replies": 0, "reflexes": 0, "llm_rounds": 0,
            "tokens_in": 0, "tokens_out": 0, "think_ms": 0, "tools": {}, "corrections": 0,
            "voice_ms": 0, "routes": 0, "reminders": 0}


_today = _new_day()
_state = {"phase": "idle", "persona": "delamain", "clients": 0, "since": time.time(), "dungeon": None}
_metrics = {"available": None, "tps": None, "busy": None, "checked": 0.0}


def bind_loop(loop: asyncio.AbstractEventLoop) -> None:
    """Call once from the server's startup, so threads can hand events to the loop."""
    global _loop
    _loop = loop


def _count(event: dict) -> None:
    global _today
    if _today["day"] != time.strftime("%Y-%m-%d"):
        _today = _new_day()
    k = event["kind"]
    if k == "heard":
        _today["heard"] += 1
    elif k == "reflex":
        _today["reflexes"] += 1
    elif k == "think_end":
        _today["llm_rounds"] += 1
        _today["tokens_in"] += event.get("prompt_tokens") or 0
        _today["tokens_out"] += event.get("completion_tokens") or 0
        _today["think_ms"] += event.get("ms") or 0
    elif k == "tool_start":
        _today["tools"][event["name"]] = _today["tools"].get(event["name"], 0) + 1
    elif k == "correction":
        _today["corrections"] += 1
    elif k == "voice_end":
        _today["voice_ms"] += event.get("ms") or 0
    elif k == "navigate":
        _today["routes"] += 1
    elif k == "spoke":
        _today["replies"] += 1
        if event.get("source") == "reminder":
            _today["reminders"] += 1


_PHASE = {"heard": "hearing", "think_start": "thinking", "tool_start": "tool", "voice_start": "voice",
          "reflex": "reflex", "spoke": "speaking", "correction": "thinking", "navigate": "tool"}


def emit(kind: str, **data) -> None:
    """Record an event and send it to every open Brain view."""
    global _seq
    _seq += 1
    event = {"seq": _seq, "t": round(time.time(), 3), "kind": kind, **data}
    if kind in _PHASE:
        _state["phase"], _state["since"] = _PHASE[kind], event["t"]
    if kind == "core" and data.get("persona"):
        _state["persona"] = data["persona"]
    if kind == "heard" and data.get("persona"):
        _state["persona"] = data["persona"]
    if kind == "clients":
        _state["clients"] = data.get("count", 0)
    if kind == "spoke":
        _state["dungeon"] = data.get("dungeon")
    if kind == "idle":
        _state["phase"], _state["since"] = "idle", event["t"]
    _count(event)
    _recent.append(event)
    msg = f"data: {json.dumps(event, separators=(',', ':'))}\n\n"
    if _loop is None:
        return
    try:
        running = asyncio.get_running_loop()
    except RuntimeError:
        running = None
    if running is _loop:
        _broadcast(msg)
    else:
        _loop.call_soon_threadsafe(_broadcast, msg)


def _broadcast(msg: str) -> None:
    for q in list(_subscribers):
        try:
            q.put_nowait(msg)
        except asyncio.QueueFull:
            pass


def snapshot() -> dict:
    return {"state": _state, "today": _today, "recent": list(_recent)[-40:],
            "metrics": {k: _metrics[k] for k in ("available", "tps", "busy")},
            "tool_regions": TOOL_REGION, "llm_model": config.get("llm_model")}


async def stream(is_disconnected):
    """The SSE body: a snapshot first, then events as they happen, with keepalives."""
    q: asyncio.Queue = asyncio.Queue(maxsize=500)
    _subscribers.add(q)
    try:
        yield "retry: 3000\n\n"
        yield f"event: snapshot\ndata: {json.dumps(snapshot(), separators=(',', ':'))}\n\n"
        while not await is_disconnected():
            try:
                yield await asyncio.wait_for(q.get(), timeout=3)
            except asyncio.TimeoutError:   # every quiet 3 s: the LLM server's speed (also a keepalive)
                m = await asyncio.to_thread(metrics)
                yield f"event: metrics\ndata: {json.dumps(m)}\n\n"
    finally:
        _subscribers.discard(q)


# ── Optional: the LLM server's own speed, from Prometheus /metrics ────────────────
_PROM = re.compile(r"^([a-zA-Z_:][\w:]*)(?:\{[^}]*\})?\s+([-\d.eE+]+)$")
_last_counts: dict = {}


def metrics() -> dict:
    """Generation speed and busy flag from the LLM server, when it publishes /metrics.
    Checked at most every 2 s; a server without the endpoint is retried once a minute."""
    now = time.time()
    if now - _metrics["checked"] < (2 if _metrics["available"] is not False else 60):
        return {k: _metrics[k] for k in ("available", "tps", "busy")}
    _metrics["checked"] = now
    url = re.sub(r"/v1/.*$", "", config.get("llm_url") or "").rstrip("/") + "/metrics"
    try:
        r = requests.get(url, headers=config.llm_headers(), timeout=1.5)
        if r.status_code != 200 or "# TYPE" not in r.text:
            raise ValueError("no metrics")
        vals = {}
        for line in r.text.splitlines():
            m = _PROM.match(line.strip())
            if m:
                vals[m.group(1)] = float(m.group(2))
        toks = vals.get("llamacpp:tokens_predicted_total")
        secs = vals.get("llamacpp:tokens_predicted_seconds_total")
        tps = None
        if toks is not None and secs and _last_counts.get("secs") is not None and secs > _last_counts["secs"]:
            tps = round((toks - _last_counts["toks"]) / (secs - _last_counts["secs"]), 1)
        elif toks and secs:
            tps = round(toks / secs, 1)
        _last_counts.update(toks=toks, secs=secs)
        _metrics.update(available=True, tps=tps, busy=bool(vals.get("llamacpp:requests_processing")))
    except Exception:
        _metrics.update(available=False, tps=None, busy=None)
    return {k: _metrics[k] for k in ("available", "tps", "busy")}


def usage_of(response_json: dict) -> dict:
    """Token counts and server speed from a chat completion, whatever the server reports."""
    u = response_json.get("usage") or {}
    t = response_json.get("timings") or {}
    details = u.get("completion_tokens_details") or {}
    return {"prompt_tokens": u.get("prompt_tokens"), "completion_tokens": u.get("completion_tokens"),
            "reasoning_tokens": details.get("reasoning_tokens"),
            "tps": round(t["predicted_per_second"], 1) if t.get("predicted_per_second") else None,
            "cached_tokens": t.get("cache_n") or (u.get("prompt_tokens_details") or {}).get("cached_tokens")}
