import os
import uuid
import soundfile as sf
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
os.makedirs(OUTPUT_DIR, exist_ok=True)


class F5TTSEngine:
    def __init__(self):
        print("Initializing F5-TTS...")
        self.tts = F5TTS(
            model="F5TTS_Base",
            ckpt_file=CHECKPOINT,
            vocab_file=VOCAB_FILE,
        )
        print("F5-TTS initialized successfully.")

    def synthesize(self, text: str, ref_audio_path: str = REF_AUDIO_PATH) -> str | None:
        try:
            print(f"Generating audio for: {text[:80]}")
            filename = f"delamain_{uuid.uuid4().hex}.wav"
            output_path = os.path.join(OUTPUT_DIR, filename)

            self.tts.infer(
                ref_file=ref_audio_path,
                ref_text=REF_TEXT,
                gen_text=text,
                file_wave=output_path,
                speed=1.0,
            )

            print(f"Voice synthesis complete: {filename}")
            return f"/audio/{filename}"
        except Exception as e:
            print(f"F5-TTS synthesis error: {e}")
            return None


_engine: F5TTSEngine | None = None


def get_tts_engine() -> F5TTSEngine:
    global _engine
    if _engine is None:
        _engine = F5TTSEngine()
    return _engine
