#!/bin/bash
# Calypso Radio — one-time server setup (runs ON the VPS, called by deploy-now.bat)
set -e
cd /opt/calypso-radio

echo "=== 1/4 Installing app dependencies ==="
npm ci --omit=dev

echo "=== 2/4 Starting under pm2 ==="
pm2 restart calypso-radio 2>/dev/null || pm2 start server.js --name calypso-radio
pm2 save

echo "=== 3/4 Configuring nginx ==="
NGINX_CONF='server {
    server_name music.atmosphereengine.com;
    listen 80;
    client_max_body_size 600m;
    proxy_read_timeout 600s;
    proxy_send_timeout 600s;
    location / {
        proxy_pass http://127.0.0.1:8300;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}'
if [ -d /etc/nginx/sites-available ]; then
  echo "$NGINX_CONF" > /etc/nginx/sites-available/calypso-radio
  ln -sf /etc/nginx/sites-available/calypso-radio /etc/nginx/sites-enabled/calypso-radio
else
  echo "$NGINX_CONF" > /etc/nginx/conf.d/calypso-radio.conf
fi
nginx -t && systemctl reload nginx

echo "=== 4/4 HTTPS certificate ==="
certbot --nginx -d music.atmosphereengine.com --non-interactive \
  || echo "!! certbot needs a human: run  certbot --nginx -d music.atmosphereengine.com"

echo ""
echo "================================================================"
echo "  ALL DONE! Your station is live at:"
echo "  https://music.atmosphereengine.com/?token=$(cat .radio_token)"
echo "================================================================"
