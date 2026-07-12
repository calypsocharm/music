#!/bin/bash
# One-time: installs the cron job that makes the station self-updating.
( crontab -l 2>/dev/null | grep -v "calypso-radio/update.sh"
  echo "*/5 * * * * bash /opt/calypso-radio/update.sh >> /var/log/calypso-radio-update.log 2>&1"
) | crontab -
echo ""
echo "=============================================================="
echo "  Auto-update ON: the station now checks GitHub every"
echo "  5 minutes and installs new versions all by itself."
echo "=============================================================="
