# ── Web UI ───────────────────────────────────────────────────────────────────
FROM node:20-alpine AS frontend
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ── Backend (also serves the web UI) ─────────────────────────────────────────
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

# App source and the built web UI
COPY *.py delamain_ref_10s.wav ./
COPY --from=frontend /frontend/dist /app/frontend_dist

# Directories mounted at runtime via volumes:
#   /app/checkpoints  — F5-TTS model weights, downloaded on first start
#   /app/data         — database, settings, recorded audio and lip-synced clips (downloaded on first start)
#   /vault            — optional Obsidian vault for notes and memory
# The bundled reference voice is used unless DELAMAIN_REF_AUDIO points at another clip.
RUN mkdir -p /app/checkpoints /app/data

ENV PYTHONUNBUFFERED=1 \
    DELAMAIN_DB=/app/data/delamain.db \
    DELAMAIN_AUDIO_DIR=/app/data/audio_output \
    DELAMAIN_LINES_DIR=/app/data/line_clips \
    FRONTEND_DIST=/app/frontend_dist \
    OBSIDIAN_VAULT_PATH=/vault

EXPOSE 8888

CMD ["python", "-m", "uvicorn", "main:app", \
     "--host", "0.0.0.0", \
     "--port", "8888", \
     "--ws-ping-interval", "0"]
