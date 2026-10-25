"""Install lip-synced clips made from the pre-recorded lines.

    python import_clips.py "<folder with 01_delamain/, 02_corrupted/, ... and idle/>"

Each <clip id>.mp4 is copied into line_clips/ without its audio, and its soundtrack is
saved next to it as <clip id>.wav. The generator re-renders the voice and the lips follow
that render, so the soundtrack (not the original recording) is what plays with the clip.
It is levelled to the original recording so clips and live replies sound the same.
Clips in idle/ replace the idle loops in frontend/public/. Existing files are overwritten.
"""
import os, shutil, subprocess, sys

import numpy as np

import lines
import personas
from tts_engine import CACHE_DIR, _cache_key

ROOT = os.path.dirname(os.path.abspath(__file__))
LINES_DIR = os.environ.get("DELAMAIN_LINES_DIR", os.path.join(ROOT, "line_clips"))
PUBLIC = os.path.join(ROOT, "frontend", "public")
SR = 24000


def _decode(path: str) -> np.ndarray:
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"],
                         capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32)


def _speech_rms(x: np.ndarray) -> float:
    frames = x[: len(x) // 480 * 480].reshape(-1, 480)
    rms = np.sqrt((frames ** 2).mean(1))
    loud = rms[rms > rms.max() * 0.1] if rms.size else rms
    return float(loud.mean()) if loud.size else 0.0


def _original(row: dict) -> str | None:
    h = _cache_key(row["line"])
    voice = personas.get(row["core_key"]).voice
    for name in ([f"{h}_{voice}.wav"] if voice else []) + [f"{h}.wav"]:
        if os.path.exists(os.path.join(CACHE_DIR, name)):
            return os.path.join(CACHE_DIR, name)
    return None


def import_clip(src: str, row: dict) -> bool:
    dst = os.path.join(LINES_DIR, row["id"])
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    track = _decode(src)
    if not track.size or _speech_rms(track) < 1e-3:
        print(f"  skipped {row['id']}: no soundtrack")
        return False
    gain = 1.0
    ref = _original(row)
    if ref:
        gain = _speech_rms(_decode(ref)) / _speech_rms(track)
    track = np.clip(track * gain, -1, 1)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "-",
                    "-c:a", "pcm_s16le", dst + ".wav"], input=track.tobytes(), check=True)
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-an", "-c:v", "copy",
                    "-movflags", "+faststart", dst + ".mp4"], check=True)
    return True


def main(folder: str) -> None:
    done = missing = 0
    for row in lines.registry():
        src = os.path.join(folder, row["id"] + ".mp4")
        if not os.path.exists(src):
            missing += 1
            continue
        done += import_clip(src, row)
    print(f"{done} line clips installed in {LINES_DIR}, {missing} lines still without a clip")

    idle = os.path.join(folder, "idle")
    if os.path.isdir(idle):
        loops = sorted(f for f in os.listdir(idle) if f.endswith(".mp4"))
        for f in loops:
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", os.path.join(idle, f), "-an", "-c:v", "copy",
                            "-movflags", "+faststart", os.path.join(PUBLIC, f)], check=True)
        print(f"{len(loops)} idle loops installed in {PUBLIC}")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
