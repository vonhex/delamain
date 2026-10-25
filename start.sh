#!/bin/bash
# Start Delamain on http://localhost:${PORT:-8888}.
# .env is optional: everything can be set in the web UI's Settings instead. Its lines are
# read as plain KEY=value (no shell quoting needed, so paths with spaces work).
cd "$(dirname "$0")"
if [ -f .env ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
    key="${BASH_REMATCH[1]}"; value="${BASH_REMATCH[2]}"
    [[ "$value" =~ ^\"(.*)\"$ || "$value" =~ ^\'(.*)\'$ ]] && value="${BASH_REMATCH[1]}"
    export "$key=$value"
  done < .env
fi
exec venv/bin/uvicorn main:app \
  --host 0.0.0.0 \
  --port "${PORT:-8888}" \
  --ws-ping-interval 60 \
  --ws-ping-timeout 30 \
  --log-level warning
