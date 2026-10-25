#!/usr/bin/env bash
# One-step installer for Delamain on Linux and macOS.
#
#   ./install.sh             install, then start Delamain on http://localhost:8888
#   ./install.sh --service   also start it at login (systemd user service, Linux)
#   ./install.sh --no-start  install only
#
# It installs uv (which brings its own Python), PyTorch for this machine's GPU (NVIDIA,
# AMD or none), Delamain's Python packages and a private copy of Node.js, all inside
# this folder, and builds the web UI. Nothing else on the system is changed. The voice
# model and the lip-synced clips download on the first start. Safe to run again to update.
#
# Override the PyTorch build with TORCH_INDEX=<url>, e.g. https://download.pytorch.org/whl/cpu
set -euo pipefail
cd "$(dirname "$0")"

SERVICE=0
START=1
for arg in "$@"; do
  case "$arg" in
    --service) SERVICE=1 ;;
    --no-start) START=0 ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg"; exit 1 ;;
  esac
done

say() { printf '\n\033[1;36m== %s\033[0m\n' "$*"; }

# ── uv and Python ─────────────────────────────────────────────────────────────
if ! command -v uv >/dev/null 2>&1; then
  say "Installing uv (Python package manager)"
  if command -v curl >/dev/null 2>&1; then curl -LsSf https://astral.sh/uv/install.sh | sh
  else wget -qO- https://astral.sh/uv/install.sh | sh; fi
  export PATH="$HOME/.local/bin:$HOME/.cargo/bin:$PATH"
fi

if [ ! -x venv/bin/python ]; then
  say "Creating the Python environment"
  uv venv --python 3.12 venv
fi
PIP=(uv pip install --python venv/bin/python)

# ── PyTorch for this machine ──────────────────────────────────────────────────
if [ -z "${TORCH_INDEX:-}" ]; then
  if [ "$(uname)" = "Darwin" ]; then
    TORCH_INDEX=""                                              # Apple silicon: the standard build uses Metal
  elif command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L >/dev/null 2>&1; then
    TORCH_INDEX="https://download.pytorch.org/whl/cu126"        # NVIDIA
  elif [ -e /dev/kfd ] && ls /sys/class/drm/card*/device/vendor 2>/dev/null | xargs cat 2>/dev/null | grep -q 0x1002; then
    TORCH_INDEX="https://download.pytorch.org/whl/rocm7.2"      # AMD (ROCm)
  else
    TORCH_INDEX="https://download.pytorch.org/whl/cpu"          # no supported GPU: CPU only
  fi
fi
if ! venv/bin/python -c "import torch, torchaudio" >/dev/null 2>&1; then
  say "Installing PyTorch (${TORCH_INDEX:-standard build})"
  if [ -n "$TORCH_INDEX" ]; then
    "${PIP[@]}" torch torchaudio --index-url "$TORCH_INDEX"
  else
    "${PIP[@]}" torch torchaudio
  fi
fi

say "Installing Delamain's Python packages"
"${PIP[@]}" -r requirements.txt

# ── Node.js and the web UI ────────────────────────────────────────────────────
node_ok() { "$1" -e 'process.exit(+process.versions.node.split(".")[0] < 20)' >/dev/null 2>&1; }
if ! node_ok node; then
  if [ ! -x venv/bin/node ] || ! node_ok venv/bin/node; then
    say "Installing a private copy of Node.js (only inside this folder)"
    "${PIP[@]}" nodeenv
    VIRTUAL_ENV="$PWD/venv" venv/bin/nodeenv --python-virtualenv --node=lts --prebuilt
  fi
  export PATH="$PWD/venv/bin:$PATH"
fi

say "Building the web UI"
(cd frontend && npm ci --no-audit --no-fund --loglevel=error && npm run build)

# ── Start it ──────────────────────────────────────────────────────────────────
if [ "$SERVICE" = 1 ]; then
  if command -v systemctl >/dev/null 2>&1; then
    say "Installing the delamain systemd user service"
    mkdir -p "$HOME/.config/systemd/user"
    cat > "$HOME/.config/systemd/user/delamain.service" <<EOF
[Unit]
Description=Delamain
After=network-online.target

[Service]
WorkingDirectory=$PWD
ExecStart=$PWD/start.sh
Restart=on-failure

[Install]
WantedBy=default.target
EOF
    systemctl --user daemon-reload
    systemctl --user enable --now delamain.service
    loginctl enable-linger "$USER" >/dev/null 2>&1 || true   # keep running after logout, where allowed
    START=0
    echo "Delamain is running as a service: systemctl --user status delamain"
  else
    echo "systemd is not available; start Delamain with ./start.sh"
  fi
fi

say "Done"
cat <<EOF
Open http://localhost:8888 (or http://<this computer's address>:8888 from your phone),
choose a password, and point Settings → Integrations at your LLM.
The first start downloads the voice model (about 1.3 GB) and the lip-synced clips
(about 240 MB), then records Delamain's fixed lines in the background.
Start it again later with ./start.sh
EOF

if [ "$START" = 1 ]; then
  ( sleep 4; command -v xdg-open >/dev/null && xdg-open http://localhost:8888 >/dev/null 2>&1 \
      || command -v open >/dev/null && open http://localhost:8888 ) >/dev/null 2>&1 &
  exec ./start.sh
fi
