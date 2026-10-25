#!/bin/bash
# .env is optional: everything can be set in the web UI's Settings instead.
if [ -f "$(dirname "$0")/.env" ]; then
  set -a
  source "$(dirname "$0")/.env"
  set +a
fi
exec "$(dirname "$0")/venv/bin/uvicorn" main:app \
  --host 0.0.0.0 \
  --port 8888 \
  --ws-ping-interval 60 \
  --ws-ping-timeout 30 \
  --log-level warning
