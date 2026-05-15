#!/usr/bin/env bash
# Run from the laptop: deploys and executes the DM-disable script on Comma 4.
set -e
# Set this to your Comma device's SSH address (find it in Settings → About → SSH)
COMMA=comma@<YOUR_COMMA_IP>

echo "Copying script to Comma 4..."
scp "$(dirname "$0")/disable_driver_monitoring.sh" "$COMMA:/data/disable_driver_monitoring.sh"

echo "Running on Comma 4..."
ssh "$COMMA" "bash /data/disable_driver_monitoring.sh"

echo ""
echo "Restarting sunnypilot..."
ssh "$COMMA" "sudo systemctl restart comma" 2>/dev/null || \
ssh "$COMMA" "cd /data/openpilot && pkill -f manager.py; sleep 2; nohup python3 selfdrive/manager/manager.py > /tmp/sp.log 2>&1 &"

echo "Done."
