FROM python:3.12-slim

# CUDA support: if you have an NVIDIA GPU, use the nvidia/cuda base instead:
# FROM nvidia/cuda:12.4.1-runtime-ubuntu22.04
# Then install python3.12 manually.

WORKDIR /app

# System deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Python deps
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# App source
COPY main.py auth.py db.py tts_engine.py ./

# Directories mounted at runtime via volumes:
#   /app/checkpoints  — F5-TTS model weights
#   /app/data         — database, audio output, reference audio
RUN mkdir -p /app/audio_output/static_cache /app/checkpoints /app/data

# Symlink audio_output into data volume so it persists
RUN ln -s /app/data/audio_output /app/audio_output || true

EXPOSE 8888

ENV PYTHONUNBUFFERED=1

CMD ["python", "-m", "uvicorn", "main:app", \
     "--host", "0.0.0.0", \
     "--port", "8888", \
     "--ws-ping-interval", "0"]
