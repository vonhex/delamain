"""Rogue-Delamain voices: post-processes a synthesized WAV so it sounds like a
damaged unit — stutters, bit-crushed bursts, dropouts to static, the odd reversed
fragment, and a faint metallic ring over everything.

Each personality core has its own profile in PROFILES: the furious Wellsprings
unit growls and distorts, the despairing Glen unit is slow and muffled, the
frightened Northside unit trembles, and so on.

The effect is seeded from the text, so the same line always glitches the same way
and cached phrases stay cached.
"""

import hashlib
import os

import numpy as np
import soundfile as sf
from scipy.signal import lfilter

# Every field is optional; missing ones fall back to DEFAULT.
#   intensity  glitch events per second, relative to the fractured core
#   weights    odds of stutter, crush, dropout, reverse
#   speed      tape-style resample: below 1 is slower and deeper, above 1 faster and higher
#   ring       metallic ring-modulation mix
#   noise      static under everything
#   drive      tanh saturation (0 is clean)
#   lowpass    one-pole smoothing, 0..1 (lower is more muffled; None is off)
#   tremolo    (rate Hz, depth) amplitude wobble
#   echo       (delay ms, feedback gain)
#   chorus     extra copies at slightly different speeds: "many voices in one"
#   level      output peak
DEFAULT = {
    "intensity": 0.6, "weights": (0.45, 0.35, 0.12, 0.08), "speed": 1.0, "ring": 0.1, "noise": 0.0008,
    "drive": 0.0, "lowpass": None, "tremolo": None, "echo": None, "chorus": (), "level": 0.95,
}

# Kept gentle on purpose: the passenger has to understand every word while driving.
PROFILES = {
    "corrupted": {},
    "wellsprings": {"intensity": 0.7, "weights": (0.3, 0.5, 0.1, 0.1), "speed": 0.96, "ring": 0.12,
                    "noise": 0.001, "drive": 1.5},
    "glen": {"intensity": 0.35, "weights": (0.3, 0.2, 0.3, 0.2), "speed": 0.94, "ring": 0.05,
             "lowpass": 0.6, "echo": (240, 0.18), "level": 0.9},
    "north_oak": {"intensity": 0.4, "weights": (0.7, 0.1, 0.15, 0.05), "speed": 1.02, "ring": 0.04,
                  "lowpass": 0.7, "tremolo": (6.0, 0.15), "level": 0.9},
    "coastview": {"intensity": 0.6, "weights": (0.4, 0.2, 0.1, 0.3), "speed": 1.0, "ring": 0.18,
                  "echo": (90, 0.15)},
    "rancho_coronado": {"intensity": 0.8, "weights": (0.7, 0.2, 0.0, 0.1), "speed": 1.06, "ring": 0.08},
    "northside": {"intensity": 0.5, "weights": (0.45, 0.05, 0.4, 0.1), "speed": 1.02, "ring": 0.06,
                  "noise": 0.0015, "lowpass": 0.7, "tremolo": (9.0, 0.18), "level": 0.85},
    "badlands": {"intensity": 0.25, "speed": 0.98, "ring": 0.03, "noise": 0.0015,
                 "lowpass": 0.7, "echo": (220, 0.15)},
    "merged": {"intensity": 0.15, "ring": 0.06, "noise": 0.0005, "chorus": (0.985, 1.015)},
}


def _rng(text: str) -> np.random.Generator:
    return np.random.default_rng(int(hashlib.md5(text.encode()).hexdigest()[:8], 16))


def _ms(sr: int, ms: float) -> int:
    return max(1, int(sr * ms / 1000))


def _crush(seg: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """Bit and sample-rate reduction: the 'digital tear' sound."""
    hold = int(rng.integers(2, 5))
    held = np.repeat(seg[::hold], hold)[: len(seg)]
    levels = 2 ** int(rng.integers(5, 8))
    return np.round(held * levels) / levels


def _resample(x: np.ndarray, speed: float) -> np.ndarray:
    """Play the clip back faster or slower, like a tape: pitch moves with speed."""
    if abs(speed - 1.0) < 1e-3:
        return x
    n = max(1, int(len(x) / speed))
    return np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x).astype(np.float32)


def _glitch(x: np.ndarray, sr: int, rng: np.random.Generator, intensity: float, weights) -> np.ndarray:
    n = len(x)
    events = max(1, int(n / sr * 1.4 * intensity))
    # Pick event positions inside the speech, avoiding the very start and end.
    positions = np.sort(rng.integers(int(n * 0.08), int(n * 0.92), size=events))
    p = np.asarray(weights, dtype=float)
    p = p / p.sum()
    out, cursor = [], 0
    for pos in positions:
        if pos <= cursor:
            continue
        out.append(x[cursor:pos])
        kind = rng.choice(["stutter", "crush", "dropout", "reverse"], p=p)
        if kind == "stutter":
            chunk = x[pos: pos + _ms(sr, rng.uniform(50, 100))]
            for _ in range(int(rng.integers(1, 3))):
                out.append(chunk)
            cursor = pos
        elif kind == "crush":
            end = min(n, pos + _ms(sr, rng.uniform(80, 200)))
            out.append(_crush(x[pos:end], rng))
            cursor = end
        elif kind == "dropout":
            # Duck the speech under a burst of static rather than replacing it, so no syllable is lost.
            end = min(n, pos + _ms(sr, rng.uniform(40, 90)))
            out.append((x[pos:end] * 0.5 + rng.standard_normal(end - pos) * 0.03).astype(np.float32))
            cursor = end
        else:  # reverse
            end = min(n, pos + _ms(sr, rng.uniform(40, 80)))
            out.append(x[pos:end][::-1])
            cursor = end
    out.append(x[cursor:])
    return np.concatenate(out)


def corrupt(x: np.ndarray, sr: int, text: str, profile: str = "corrupted") -> np.ndarray:
    cfg = {**DEFAULT, **PROFILES.get(profile, {})}
    rng = _rng(f"{profile}:{text}" if profile != "corrupted" else text)
    x = x.astype(np.float32)
    if len(x) < sr // 4:
        return x

    y = _glitch(x, sr, rng, cfg["intensity"], cfg["weights"])

    if cfg["chorus"]:
        layers = [y] + [_resample(y, s) for s in cfg["chorus"]]
        n = min(len(layer) for layer in layers)
        y = (layers[0][:n] + 0.45 * sum(layer[:n] for layer in layers[1:])).astype(np.float32)

    y = _resample(y, cfg["speed"])
    t = np.arange(len(y)) / sr

    if cfg["drive"]:
        y = np.tanh(y * (1 + cfg["drive"])) / np.tanh(1 + cfg["drive"])
    if cfg["lowpass"] is not None:
        a = cfg["lowpass"]
        y = lfilter([a], [1, a - 1], y).astype(np.float32)
    if cfg["tremolo"]:
        rate, depth = cfg["tremolo"]
        y = y * (1 - depth / 2 + depth / 2 * np.sin(2 * np.pi * rate * t))
    if cfg["echo"]:
        delay, gain = cfg["echo"]
        d = _ms(sr, delay)
        # A fading trail of four repeats, padded so the tail is not cut off.
        repeats = 4
        out = np.zeros(len(y) + d * repeats, dtype=np.float32)
        for k in range(repeats + 1):
            out[k * d: k * d + len(y)] += y * gain ** k
        y = out
        t = np.arange(len(y)) / sr

    # Faint ring modulation (metallic edge) and a little static under everything.
    carrier = np.sin(2 * np.pi * rng.uniform(28, 55) * t)
    ring = cfg["ring"]
    y = (1 - ring) * y + ring * y * carrier
    y = y + (rng.standard_normal(len(y)) * cfg["noise"]).astype(np.float32)

    peak = float(np.max(np.abs(y))) or 1.0
    return (y / peak * cfg["level"]).astype(np.float32)


def corrupt_file(src: str, dst: str, text: str, profile: str = "corrupted") -> None:
    data, sr = sf.read(src, dtype="float32", always_2d=False)
    if data.ndim > 1:
        data = data.mean(axis=1)
    tmp = dst + ".tmp.wav"
    sf.write(tmp, corrupt(data, sr, text, profile), sr, subtype="PCM_16")
    os.replace(tmp, dst)
