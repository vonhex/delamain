import hashlib
import os
import uuid

from f5_tts.api import F5TTS

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
CHECKPOINT = os.path.join(BASE_DIR, "checkpoints/F5TTS_Base/model_1200000.pt")
VOCAB_FILE = os.path.join(BASE_DIR, "checkpoints/F5TTS_Base/vocab.txt")
REF_AUDIO_PATH = os.path.join(BASE_DIR, "delamain_ref_10s.wav")
REF_TEXT = (
    "in search of identity and meaning. When in Greece, do as Grecians do, "
    "if you'll pardon my take on the expression. Of course I'm obliged to"
)
OUTPUT_DIR = os.path.join(BASE_DIR, "audio_output")
CACHE_DIR = os.path.join(OUTPUT_DIR, "static_cache")
os.makedirs(OUTPUT_DIR, exist_ok=True)
os.makedirs(CACHE_DIR, exist_ok=True)

# Faster inference: 8 steps vs default 32. Quality is slightly lower but
# imperceptible for short alert phrases, and latency drops 4x.
NFE_STEPS = 16


def _cache_key(text: str) -> str:
    return hashlib.md5(text.encode()).hexdigest()


class F5TTSEngine:
    def __init__(self):
        print("Initializing F5-TTS...")
        self.tts = F5TTS(
            model="F5TTS_Base",
            ckpt_file=CHECKPOINT,
            vocab_file=VOCAB_FILE,
        )
        print("F5-TTS initialized successfully.")

    def _infer(self, text: str, output_path: str) -> None:
        self.tts.infer(
            ref_file=REF_AUDIO_PATH,
            ref_text=REF_TEXT,
            gen_text=text,
            file_wave=output_path,
            speed=1.0,
            nfe_step=NFE_STEPS,
            remove_silence=False,
        )

    def pre_cache(self, texts: list[str]) -> None:
        """Pre-synthesize a list of static phrases and store them in CACHE_DIR."""
        ok = 0
        for text in texts:
            key = _cache_key(text)
            path = os.path.join(CACHE_DIR, f"{key}.wav")
            if os.path.exists(path):
                ok += 1
                continue
            try:
                print(f"Pre-caching: {text[:60]}")
                self._infer(text, path)
                ok += 1
            except Exception as e:
                print(f"Pre-cache failed for '{text[:40]}': {e}")
        print(f"Pre-cache complete ({ok}/{len(texts)} phrases ready).")

    def synthesize(self, text: str, ref_audio_path: str = REF_AUDIO_PATH) -> str | None:
        # Return cached file if this exact phrase was pre-synthesized.
        key = _cache_key(text)
        cached = os.path.join(CACHE_DIR, f"{key}.wav")
        if os.path.exists(cached):
            print(f"Cache hit: {text[:60]}")
            return f"/audio/static_cache/{key}.wav"

        print(f"Generating audio for: {text[:80]}")
        filename = f"delamain_{uuid.uuid4().hex}.wav"
        output_path = os.path.join(OUTPUT_DIR, filename)
        self._infer(text, output_path)
        print(f"Voice synthesis complete: {filename}")
        return f"/audio/{filename}"


_engine: F5TTSEngine | None = None


def reset_engine() -> None:
    global _engine
    _engine = None


def get_tts_engine() -> F5TTSEngine:
    global _engine
    if _engine is None:
        _engine = F5TTSEngine()
    return _engine
