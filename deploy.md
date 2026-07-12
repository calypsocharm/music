# Deploying Calypso Radio to the VPS

Target: the shared box `root@187.124.235.109` (same server as Daily Stars and
BotCash Trader — leave their apps alone). App runs under pm2 on port **8300**
behind nginx.

Suggested address: **https://music.atmosphereengine.com**

> ⚠️ For agents: ssh/scp writes to this host are blocked by the permission
> classifier — the user must run these commands herself or approve them
> interactively. Same gate as Daily Stars / BotCash deploys.

## 1. First-time setup

### a) Copy the app to the server (run from `C:\Users\Calyp\Downloads\calypso-radio`)

```
ssh root@187.124.235.109 "mkdir -p /opt/calypso-radio/media"
scp server.js package.json package-lock.json .radio_token root@187.124.235.109:/opt/calypso-radio/
scp -r public root@187.124.235.109:/opt/calypso-radio/
```

### b) Install + start under pm2 (on the server)

```
ssh root@187.124.235.109
cd /opt/calypso-radio
npm ci --omit=dev
pm2 start server.js --name calypso-radio
pm2 save
```

### c) DNS

Add an **A record**: `music.atmosphereengine.com → 187.124.235.109`

### d) nginx (on the server, as `/etc/nginx/sites-available/calypso-radio`)

```nginx
server {
    server_name music.atmosphereengine.com;
    listen 80;

    # uploads can be big music files — nginx default is only 1 MB!
    client_max_body_size 600m;
    proxy_read_timeout 600s;
    proxy_send_timeout 600s;

    location / {
        proxy_pass http://127.0.0.1:8300;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

```
ln -s /etc/nginx/sites-available/calypso-radio /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d music.atmosphereengine.com   # adds HTTPS
```

### e) Open it

`https://music.atmosphereengine.com/?token=<contents of .radio_token>`

On the phone: open that link once in Safari/Chrome, then **Share → Add to
Home Screen** — it becomes an app icon, and the cookie keeps you signed in.

## 2. Updating the app later

Only `server.js` and `public/` ever change:

```
scp server.js root@187.124.235.109:/opt/calypso-radio/
scp -r public root@187.124.235.109:/opt/calypso-radio/
ssh root@187.124.235.109 "pm2 restart calypso-radio"
```

## 3. Rules

- **NEVER touch `/opt/calypso-radio/media/`** — that's the music library.
- `.radio_token` is the only key to the station. Never commit it; it's
  git-ignored. To change the secret: edit that file on the server and
  `pm2 restart calypso-radio` (old links/cookies stop working).
- Music uploads happen through the website itself (⬆ Add music) — no scp
  needed for songs.
