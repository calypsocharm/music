#!/bin/bash
# Calypso Radio self-updater — run by cron every 5 minutes on the VPS.
# Pulls new code from GitHub when there is any, and restarts the app.
cd /opt/calypso-radio || exit 1
git fetch -q origin main || exit 1
if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
  echo "[$(date)] update found, installing..."
  git reset --hard -q origin/main
  npm ci --omit=dev --silent 2>/dev/null
  pm2 restart calypso-radio
  echo "[$(date)] updated to $(git rev-parse --short HEAD)"
fi
