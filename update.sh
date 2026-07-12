#!/bin/bash
# Calypso Radio self-updater — run by cron hourly on the VPS.
# Cron runs with a bare PATH, so first make sure we can find git/npm/pm2.
export PATH="/usr/local/bin:/usr/local/sbin:/usr/bin:/usr/sbin:/bin:/sbin:$PATH"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
if ! command -v pm2 >/dev/null 2>&1; then
  for d in /root/.nvm/versions/node/*/bin /usr/lib/node_modules/.bin; do
    [ -d "$d" ] && PATH="$d:$PATH"
  done
fi
command -v pm2 >/dev/null 2>&1 || { echo "[$(date)] ERROR: cannot find pm2"; exit 1; }

cd /opt/calypso-radio || exit 1
git fetch -q origin main || { echo "[$(date)] ERROR: git fetch failed"; exit 1; }
if [ "$(git rev-parse HEAD)" != "$(git rev-parse origin/main)" ]; then
  echo "[$(date)] update found, installing..."
  git reset --hard -q origin/main
  npm ci --omit=dev --silent || echo "[$(date)] WARN: npm ci failed (continuing)"
  pm2 restart calypso-radio
  echo "[$(date)] updated to $(git rev-parse --short HEAD)"
fi
