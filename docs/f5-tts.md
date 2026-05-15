# F5-TTS Voice Setup

Delamain uses [F5-TTS](https://github.com/SWivid/F5-TTS) for real-time voice synthesis. The model clones a voice from a reference audio clip — you supply the clip.

## Why F5-TTS

- Zero-shot voice cloning from a 10-second reference
- Fast enough for real-time alerts with 16 diffusion steps
- Static phrase pre-cache means common alerts play instantly

## Model download

```bash
pip install huggingface_hub
huggingface-cli download SWivid/F5-TTS \
  F5TTS_Base/model_1200000.pt \
  F5TTS_Base/vocab.txt \
  --local-dir checkpoints
```

This downloads ~3GB of weights into `checkpoints/F5TTS_Base/`.

## Reference audio

The voice clone quality depends entirely on your reference audio. Requirements:

- **Format:** WAV, mono or stereo (converted automatically)
- **Length:** ~10 seconds (too short = poor quality, too long = unnecessary)
- **Content:** Clear speech, no background music, no heavy processing
- **Noise:** As clean as possible — room noise degrades cloning

### `REF_TEXT`

Edit `tts_engine.py` and set `REF_TEXT` to the exact transcript of your reference audio. Word-for-word accuracy matters — errors cause artifacts.

```python
REF_TEXT = (
    "your exact transcript here, word for word, "
    "matching the reference audio precisely"
)
```

## Performance tuning

`NFE_STEPS` in `tts_engine.py` controls diffusion quality vs. speed:

| Steps | Quality | Speed (RTX 3080) |
|---|---|---|
| 8 | Acceptable | ~0.4s |
| 16 | Good | ~0.7s (default) |
| 32 | Excellent | ~1.4s |

The static pre-cache eliminates this latency for all known alert phrases — only novel text (LLM responses) synthesizes live.

## Static phrase pre-cache

At startup, Delamain synthesizes all alert phrases that have no variable substitution (no `{speed_mph}` etc.) and stores them in `audio_output/static_cache/`. Keyed by MD5 of the text.

On the first run with a new reference audio, this takes several minutes. Subsequent startups are instant (cache is already warm).

## GPU requirement

F5-TTS benefits greatly from a CUDA GPU:

| Hardware | 16-step latency |
|---|---|
| RTX 3060 | ~0.5s |
| RTX 3080 | ~0.4s |
| RTX 4090 | ~0.25s |
| CPU only (Ryzen 9) | ~8–15s |

CPU-only is usable because of the pre-cache — real-time LLM responses will be slow, but all standard alerts will be instant.
