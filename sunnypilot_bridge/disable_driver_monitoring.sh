#!/usr/bin/env bash
# Disables sunnypilot driver monitoring (dmonitoringd) permanently.
# Run once on the Comma 4: bash /data/disable_driver_monitoring.sh
set -e

SP=/data/openpilot
PARAMS_BIN="PYTHONPATH=$SP /usr/local/venv/bin/python3"

echo "=== Delamain: Disabling Driver Monitoring ==="

# 1. Try to disable via Params (cleanest — survives SP updates)
$PARAMS_BIN - <<'PYEOF'
import sys
sys.path.insert(0, '/data/openpilot')
from openpilot.common.params import Params
p = Params()

# Print all params that mention monitoring so we know what's available
all_keys = []
try:
    # openpilot stores params as files in /dev/shm/params or similar
    import os
    param_dir = p._params_path if hasattr(p, '_params_path') else '/dev/shm/params/d'
    all_keys = [k for k in os.listdir(param_dir) if 'monitor' in k.lower() or 'Monitor' in k]
    print("Found monitoring-related params:", all_keys)
except Exception as e:
    print("Could not list params:", e)

# Known param keys across openpilot/sunnypilot versions
candidates = [
    'IsDriverMonitoringEnabled',
    'EnableDriverMonitoring',
    'DisableDriverMonitoring',
    'RecordFrontLock',
    'dm_engaged',
]
for key in candidates:
    try:
        existing = p.get(key)
        print(f"  {key} = {existing!r}")
    except Exception:
        pass
PYEOF

# 2. Check process_config.py for dmonitoringd entry
echo ""
echo "=== Checking process_config.py ==="
PC="$SP/selfdrive/manager/process_config.py"
if [ -f "$PC" ]; then
    grep -n "dmonitor\|driver_monitor\|DriverMonitor" "$PC" || echo "(no matches)"
else
    echo "process_config.py not found at $PC"
    find "$SP/selfdrive" -name "process_config.py" 2>/dev/null | head -3
fi

# 3. Patch process_config.py — comment out dmonitoringd line
echo ""
echo "=== Patching process_config.py ==="
if [ -f "$PC" ]; then
    # Backup first (only once)
    [ -f "${PC}.delamain_backup" ] || cp "$PC" "${PC}.delamain_backup"

    # Comment out any line that starts the dmonitoringd process
    # Pattern: NativeProcess("dmonitoringd", ...) or similar
    python3 - "$PC" <<'PYEOF'
import sys, re

path = sys.argv[1]
with open(path, 'r') as f:
    lines = f.readlines()

patched = False
out = []
for line in lines:
    # Match lines that register dmonitoringd as a process
    if re.search(r'dmonitor', line, re.IGNORECASE) and not line.lstrip().startswith('#'):
        out.append('  # [Delamain] disabled: ' + line.lstrip())
        print(f"Commented out: {line.rstrip()}")
        patched = True
    else:
        out.append(line)

if patched:
    with open(path, 'w') as f:
        f.writelines(out)
    print("process_config.py patched successfully.")
else:
    print("No dmonitor lines found to patch — nothing changed.")
PYEOF
fi

# 4. Also check if sunnypilot has a toggles/params system
echo ""
echo "=== Checking for SP toggle params ==="
$PARAMS_BIN - <<'PYEOF'
import sys
sys.path.insert(0, '/data/openpilot')
try:
    from openpilot.common.params import Params
    p = Params()
    # Try setting known disable keys (no-op if key doesn't exist in their schema,
    # but harmless)
    for key, val in [
        ('IsDriverMonitoringEnabled', b'0'),
        ('EnableDriverMonitoring', b'0'),
    ]:
        try:
            p.put(key, val)
            print(f"Set {key} = 0")
        except Exception as e:
            print(f"Could not set {key}: {e}")
except Exception as e:
    print("Params import failed:", e)
PYEOF

echo ""
echo "=== Done. Restart sunnypilot to apply: ==="
echo "  sudo systemctl restart comma"
echo "  -- or --"
echo "  pkill -f manager.py && sleep 2 && cd /data/openpilot && python3 selfdrive/manager/manager.py &"
