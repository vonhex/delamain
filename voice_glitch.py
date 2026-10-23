"""Corrupted-Delamain voice: post-processes a synthesized WAV so it sounds like a
damaged unit — stutters, bit-crushed bursts, dropouts to static, the odd reversed
fragment, and a faint metallic ring over everything.

The effect is seeded from the text, so the same line always glitches the same way
and cached phrases stay cached.
"""

import hashlib
import os

import numpy as np
import soundfile as sf


def _rng(text: str) -> np.random.Generator:
    return np.random.default_rng(int(hashlib.md5(text.encode()).hexdigest()[:8], 16))


def _ms(sr: int, ms: float) -> int:
    return max(1, int(sr * ms / 1000))


def _crush(seg: np.ndarray, rng: np.random.Generator) -> np.ndarray:
    """Bit and sample-rate reduction: the 'digital tear' sound."""
    hold = int(rng.integers(3, 8))
    held = np.repeat(seg[::hold], hold)[: len(seg)]
    levels = 2 ** int(rng.integers(3, 6))
    return np.round(held * levels) / levels


def corrupt(x: np.ndarray, sr: int, text: str, intensity: float = 1.0) -> np.ndarray:
    rng = _rng(text)
    x = x.astype(np.float32)
    n = len(x)
    if n < sr // 4:
        return x
    seconds = n / sr
    events = max(2, int(seconds * 1.4 * intensity))

    # Pick event positions inside the speech, avoiding the very start and end.
    positions = np.sort(rng.integers(int(n * 0.08), int(n * 0.92), size=events))
    out, cursor = [], 0
    for pos in positions:
        if pos <= cursor:
            continue
        out.append(x[cursor:pos])
        kind = rng.choice(["stutter", "crush", "dropout", "reverse"], p=[0.4, 0.3, 0.18, 0.12])
        if kind == "stutter":
            chunk = x[pos: pos + _ms(sr, rng.uniform(55, 130))]
            for _ in range(int(rng.integers(2, 5))):
                out.append(chunk)
            cursor = pos
        elif kind == "crush":
            end = min(n, pos + _ms(sr, rng.uniform(150, 380)))
            out.append(_crush(x[pos:end], rng))
            cursor = end
        elif kind == "dropout":
            end = min(n, pos + _ms(sr, rng.uniform(40, 110)))
            out.append((rng.standard_normal(end - pos) * 0.06).astype(np.float32))
            cursor = end
        else:  # reverse
            end = min(n, pos + _ms(sr, rng.uniform(80, 160)))
            out.append(x[pos:end][::-1])
            cursor = end
    out.append(x[cursor:])
    y = np.concatenate(out)

    # Faint ring modulation (metallic edge) and a little static under everything.
    t = np.arange(len(y)) / sr
    carrier = np.sin(2 * np.pi * rng.uniform(28, 55) * t)
    y = 0.85 * y + 0.15 * y * carrier
    y = y + (rng.standard_normal(len(y)) * 0.0012).astype(np.float32)

    peak = float(np.max(np.abs(y))) or 1.0
    return (y / peak * 0.95).astype(np.float32)


def corrupt_file(src: str, dst: str, text: str) -> None:
    data, sr = sf.read(src, dtype="float32", always_2d=False)
    if data.ndim > 1:
        data = data.mean(axis=1)
    tmp = dst + ".tmp.wav"
    sf.write(tmp, corrupt(data, sr, text), sr, subtype="PCM_16")
    os.replace(tmp, dst)
