#!/usr/bin/env bash
# Full Delamain deploy: bridge, DM stub, continue.sh — run from laptop.
set -e
# Set this to your Comma device's SSH address (find it in Settings → About → SSH)
COMMA=comma@<YOUR_COMMA_IP>
BRIDGE_DIR="$(dirname "$0")"
SP=/data/openpilot

echo "=== Deploying bridge ==="
scp "$BRIDGE_DIR/delamaind.py" "$COMMA:/data/delamain/delamaind.py"

echo "=== Deploying DM stub ==="
scp "$BRIDGE_DIR/dmonitoringd_stub.py" "$COMMA:/data/delamain/dmonitoringd_stub.py"

echo "=== Applying DM stub to SP ==="
ssh "$COMMA" "cp /data/delamain/dmonitoringd_stub.py $SP/selfdrive/monitoring/dmonitoringd.py && echo stub applied"

echo "=== Disabling dmonitoringmodeld in process_config ==="
ssh "$COMMA" "python3 - $SP/system/manager/process_config.py << 'PYEOF'
import sys
path = sys.argv[1]
with open(path) as f: lines = f.readlines()
out = []
for line in lines:
    if 'dmonitoringmodeld' in line and not line.lstrip().startswith('#'):
        out.append('  # [Delamain] ' + line.lstrip())
        print('Disabled:', line.rstrip())
    else:
        out.append(line)
with open(path, 'w') as f: f.writelines(out)
print('process_config done.')
PYEOF"

echo "=== Restarting bridge ==="
ssh "$COMMA" "pkill -f delamaind.py 2>/dev/null; sleep 1; PYTHONPATH=$SP PYTHONUNBUFFERED=1 nohup /usr/local/venv/bin/python3 -u /data/delamain/delamaind.py >> /data/delamain/delamaind.log 2>&1 &"
sleep 4
ssh "$COMMA" "tail -6 /data/delamain/delamaind.log"

echo ""
echo "=== Done. Restart sunnypilot to activate DM stub: ==="
echo "  ssh $COMMA 'sudo systemctl restart comma'"
