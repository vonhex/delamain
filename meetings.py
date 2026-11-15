"""Meeting notes: record a meeting, transcribe it on this computer, and file the notes in the vault.

The page records with the microphone and uploads the audio in pieces as it goes, so a dropped
link loses little. When the recording stops, one job at a time:

  1. transcribe: faster-whisper on the CPU (it leaves the GPU to the language model and the voice),
     loaded for the job and freed afterwards;
  2. summarise: the language model writes a summary, decisions, action items and open questions,
     a part at a time for long meetings, then merged;
  3. file it: Delamain/Meetings/<date> <time> <title>.md in the vault, with the full transcript.

Each meeting lives in its own folder under MEETINGS_DIR with a meta.json; the audio is deleted
once the notes are written (unless keep_audio is set), and kept when something fails so the job
can be retried.
"""
import asyncio
import gc
import json
import os
import re
import shutil
import subprocess
import threading
import time
import uuid
from datetime import datetime
from pathlib import Path

import config

BASE_DIR = Path(__file__).resolve().parent
MEETINGS_DIR = Path(os.environ.get("DELAMAIN_MEETINGS_DIR", BASE_DIR / "meetings"))
VAULT_FOLDER = "Delamain/Meetings"
MAX_CHUNK_BYTES = 25 * 1024 * 1024
PART_WORDS = 6000           # the transcript is summarised in parts about this long
STATES = ("recording", "queued", "transcribing", "summarising", "done", "error")

_queue: asyncio.Queue | None = None
_lock = threading.Lock()


# ── storage ───────────────────────────────────────────────────────────────────

def _folder(mid: str) -> Path:
    """The folder for one meeting. Only a 32-character hex id is accepted, and the resolved path
    must stay inside MEETINGS_DIR, so an id can never point anywhere else on disk."""
    if not isinstance(mid, str) or not re.fullmatch(r"[0-9a-f]{32}", mid):
        raise KeyError(mid)
    base = os.path.realpath(MEETINGS_DIR)
    path = os.path.realpath(os.path.join(base, mid))
    if not path.startswith(base + os.sep):
        raise KeyError(mid)
    return Path(path)


def load(mid: str) -> dict:
    p = _folder(mid) / "meta.json"
    if not p.is_file():
        raise KeyError(mid)
    return json.loads(p.read_text())


def save(meta: dict) -> dict:
    with _lock:
        f = _folder(meta["id"])
        f.mkdir(parents=True, exist_ok=True)
        tmp = f / "meta.json.tmp"
        tmp.write_text(json.dumps(meta, indent=1))
        tmp.replace(f / "meta.json")
    return meta


def update(mid: str, **changes) -> dict:
    meta = load(mid)
    meta.update(changes)
    return save(meta)


def public(meta: dict) -> dict:
    """What the page sees: no file system paths."""
    return {k: v for k, v in meta.items() if k not in ("ext",)}


def list_recent(limit: int = 30) -> list[dict]:
    out = []
    if MEETINGS_DIR.is_dir():
        for f in MEETINGS_DIR.iterdir():
            try:
                out.append(public(load(f.name)))
            except (KeyError, ValueError, OSError):
                continue
    out.sort(key=lambda m: m.get("started", 0), reverse=True)
    return out[:limit]


def start(title: str = "", mime: str = "") -> dict:
    ext = "mp4" if "mp4" in mime else "ogg" if "ogg" in mime else "webm"
    meta = {"id": uuid.uuid4().hex, "title": (title or "").strip()[:120], "started": time.time(),
            "status": "recording", "chunks": 0, "bytes": 0, "ext": ext, "progress": 0.0}
    return save(meta)


def add_chunk(mid: str, seq: int, data: bytes) -> dict:
    meta = load(mid)
    if meta["status"] != "recording":
        raise ValueError("This meeting is no longer recording.")
    if not 0 <= seq < 100000 or len(data) > MAX_CHUNK_BYTES:
        raise ValueError("Bad chunk.")
    (_folder(mid) / f"chunk_{seq:05d}.{meta['ext']}").write_bytes(data)
    meta["chunks"] = max(meta["chunks"], seq + 1)
    meta["bytes"] = meta.get("bytes", 0) + len(data)
    meta["last_chunk"] = time.time()
    return save(meta)


def discard(mid: str) -> None:
    shutil.rmtree(_folder(mid), ignore_errors=True)


# ── the job ───────────────────────────────────────────────────────────────────

def _merge_audio(mid: str) -> Path:
    """The pieces, in order, joined (the recorder's pieces only make a file together), then
    decoded to 16 kHz mono for Whisper."""
    meta, f = load(mid), _folder(mid)
    chunks = sorted(f.glob(f"chunk_*.{meta['ext']}"))
    if not chunks:
        raise RuntimeError("No audio was received.")
    joined = f / f"audio.{meta['ext']}"
    with open(joined, "wb") as out:
        for c in chunks:
            out.write(c.read_bytes())
    wav = f / "audio16k.wav"
    r = subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(joined), "-ac", "1", "-ar", "16000", str(wav)],
                       capture_output=True, text=True)
    if r.returncode != 0 or not wav.exists():
        raise RuntimeError(f"Could not read the audio: {r.stderr.strip()[:300]}")
    return wav


def _transcribe(mid: str, wav: Path) -> list[dict]:
    import numpy as np
    from faster_whisper import WhisperModel   # imported here: only meetings need it

    pcm = subprocess.run(["ffmpeg", "-loglevel", "error", "-i", str(wav), "-f", "s16le", "-ac", "1", "-ar", "16000", "-"],
                         capture_output=True, check=True).stdout
    audio = np.frombuffer(pcm, np.int16).astype(np.float32) / 32768.0
    duration = len(audio) / 16000
    update(mid, duration=round(duration, 1))
    name = config.get("meeting_whisper_model") or "large-v3-turbo"
    threads = max(2, min(16, (os.cpu_count() or 4) // 2))   # half the cores: the rest of him keeps running
    model = WhisperModel(name, device="cpu", compute_type="int8", cpu_threads=threads)
    try:
        lang = (config.get("meeting_language") or "").strip() or None
        segments, _info = model.transcribe(audio, vad_filter=True, language=lang, beam_size=5)
        out, last = [], 0.0
        for s in segments:
            text = s.text.strip()
            if text:
                out.append({"start": round(s.start, 1), "end": round(s.end, 1), "text": text})
            if duration and time.time() - last > 2:
                update(mid, progress=round(min(0.99, s.end / duration), 3))
                last = time.time()
        return out
    finally:
        del model
        gc.collect()


def _clock(t: float) -> str:
    t = int(t)
    return f"{t // 3600}:{t % 3600 // 60:02d}:{t % 60:02d}" if t >= 3600 else f"{t // 60:02d}:{t % 60:02d}"


def _paragraphs(segs: list[dict]) -> list[tuple[float, str]]:
    """Segments joined into paragraphs at pauses (or every ~90 s), each with its start time."""
    paras, cur, start, prev_end = [], [], 0.0, 0.0
    for s in segs:
        if cur and (s["start"] - prev_end > 2.5 or s["start"] - start > 90):
            paras.append((start, " ".join(cur)))
            cur = []
        if not cur:
            start = s["start"]
        cur.append(s["text"])
        prev_end = s["end"]
    if cur:
        paras.append((start, " ".join(cur)))
    return paras


NOTES_SYSTEM = (
    "You write meeting notes from a raw, automatic transcript. The transcript has no speaker names and may "
    "contain recognition mistakes; fix obvious ones silently and never invent facts, names or numbers that are "
    "not in it. Write in plain, concise English, in Markdown, with exactly these sections:\n"
    "TITLE: <a short title for the meeting, 3 to 8 words>\n"
    "## Summary\n<3 to 8 sentences: what the meeting was about and what came of it>\n"
    "## Decisions\n<bullets; 'None recorded.' if none>\n"
    "## Action items\n<'- [ ] Who: what (by when)' for each, leaving out who or when when the transcript does not say; "
    "'None recorded.' if none>\n"
    "## Open questions\n<bullets; 'None.' if none>\n"
    "Output only these sections, starting with the TITLE line."
)
PART_SYSTEM = (
    "You take notes on one part of a longer meeting, from a raw automatic transcript (no speaker names, possible "
    "recognition mistakes). List, as short bullets: the topics discussed, any decisions, any action items (who, what, "
    "when, if said), and open questions. No timestamps. Never invent anything that is not in the transcript."
)


async def _summarise(mid: str, paras: list[tuple[float, str]], think) -> tuple[str, str]:
    """(title, notes markdown). `think(payload)` makes one LLM call (main adds its settings and
    reports it to the Brain view)."""
    async def ask(system: str, user: str, max_tokens: int) -> str:
        resp = await think({"model": config.get("llm_model"), "temperature": 0.2, "max_tokens": max_tokens,
                            "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]})
        text = (resp.json()["choices"][0]["message"].get("content") or "").strip()
        return re.sub(r"<think>.*?</think>", "", text, flags=re.S).strip()

    parts, cur, words = [], [], 0
    for t, p in paras:
        line = f"[{_clock(t)}] {p}"
        cur.append(line)
        words += len(p.split())
        if words >= PART_WORDS:
            parts.append("\n".join(cur)); cur, words = [], 0
    if cur:
        parts.append("\n".join(cur))
    meta = load(mid)
    hint = f"The meeting was called: {meta['title']}\n\n" if meta.get("title") else ""
    if len(parts) <= 1:
        body = await ask(NOTES_SYSTEM, hint + "Transcript:\n" + (parts[0] if parts else ""), 2500)
    else:
        notes = []
        for i, part in enumerate(parts, 1):
            update(mid, progress=round((i - 1) / (len(parts) + 1), 3))
            notes.append(f"### Part {i} of {len(parts)}\n" + await ask(PART_SYSTEM, f"Part {i} of {len(parts)}:\n{part}", 1500))
        update(mid, progress=round(len(parts) / (len(parts) + 1), 3))
        body = await ask(NOTES_SYSTEM, hint + "The meeting was long, so here are notes on each part, in order. "
                         "Write the notes for the whole meeting from them, as one meeting: do not mention the parts, and no timestamps.\n\n" + "\n\n".join(notes), 2500)
    m = re.match(r"\s*TITLE:\s*(.+)", body)
    title = re.sub(r"^meeting notes:\s*", "", m.group(1).strip().strip('"*# '), flags=re.I) if m else ""
    body = body[m.end():].strip() if m else body
    return title, body


def _note_path(meta: dict, title: str) -> Path:
    when = datetime.fromtimestamp(meta["started"])
    safe = re.sub(r"\s+", " ", re.sub(r'[\\/:*?"<>|#^\[\]]+', " ", title)).strip()[:80] or "Meeting"
    base = config.vault() / VAULT_FOLDER
    p = base / f"{when:%Y-%m-%d %H%M} {safe}.md"
    n = 2
    while p.exists():
        p = base / f"{when:%Y-%m-%d %H%M} {safe} ({n}).md"; n += 1
    return p


def _write_note(meta: dict, title: str, body: str, paras: list[tuple[float, str]]) -> str:
    when = datetime.fromtimestamp(meta["started"])
    mins = round((meta.get("duration") or 0) / 60)
    p = _note_path(meta, title)
    p.parent.mkdir(parents=True, exist_ok=True)
    transcript = "\n\n".join(f"**[{_clock(t)}]** {text}" for t, text in paras) or "_Nothing was said._"
    p.write_text(
        f"---\ntype: meeting\ndate: {when:%Y-%m-%d}\ntime: \"{when:%H:%M}\"\nduration_minutes: {mins}\n"
        f"tags: [meeting, delamain]\n---\n\n# {title}\n\n"
        f"*Recorded {when:%A %B %-d, %Y at %-I:%M %p}, {mins} minute{'s' if mins != 1 else ''}. "
        f"Transcribed and summarised by Delamain on this computer; check names and numbers against the transcript.*\n\n"
        f"{body}\n\n## Transcript\n\n{transcript}\n", encoding="utf-8")
    return str(p.relative_to(config.vault()))


async def _run(mid: str, think, notify) -> None:
    loop = asyncio.get_running_loop()
    try:
        update(mid, status="transcribing", progress=0.0, error=None)
        await notify(mid)
        wav = await loop.run_in_executor(None, _merge_audio, mid)
        segs = await loop.run_in_executor(None, _transcribe, mid, wav)
        (_folder(mid) / "transcript.json").write_text(json.dumps(segs))
        paras = _paragraphs(segs)
        update(mid, status="summarising", progress=0.0, words=sum(len(t.split()) for _, t in paras))
        await notify(mid)
        if paras:
            title, body = await _summarise(mid, paras, think)
        else:
            title, body = "", "## Summary\nNo speech was recognised in this recording."
        meta = load(mid)
        title = meta.get("title") or title or "Meeting"
        note = await loop.run_in_executor(None, _write_note, meta, title, body, paras)
        update(mid, status="done", progress=1.0, title=title, note=note, summary=body[:4000], finished=time.time())
        if not config.flag("meeting_keep_audio"):
            for f in _folder(mid).iterdir():
                if f.name != "meta.json":
                    f.unlink(missing_ok=True)
        print(f"[Meeting] {mid}: notes filed at {note}")
    except Exception as e:
        print(f"[Meeting] {mid} failed: {e!r}")
        try:
            update(mid, status="error", error=str(e)[:300] or type(e).__name__)
        except KeyError:
            return   # discarded meanwhile
    await notify(mid)


async def worker(think, notify) -> None:
    """Runs for the life of the server: one meeting at a time."""
    global _queue
    _queue = asyncio.Queue()
    for m in list_recent(200):   # anything a restart interrupted goes back in line
        if m["status"] in ("queued", "transcribing", "summarising"):
            await _queue.put(m["id"])
    while True:
        mid = await _queue.get()
        try:
            load(mid)
        except KeyError:
            continue
        await _run(mid, think, notify)


async def finish(mid: str, title: str | None = None) -> dict:
    meta = load(mid)
    if meta["status"] not in ("recording", "error"):
        return public(meta)
    changes = {"status": "queued", "progress": 0.0, "error": None, "stopped": meta.get("stopped") or time.time()}
    if title is not None and title.strip():
        changes["title"] = title.strip()[:120]
    meta = update(mid, **changes)
    if _queue is not None:
        await _queue.put(mid)
    return public(meta)
