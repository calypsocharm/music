# ✦ Calypso Radio

Private music (and someday video) station for Calypso's AI tracks —
positivity & abundance for walks. Upload from any device, listen anywhere.

- **Run locally:** `node server.js` → http://localhost:8300/?token=<see .radio_token>
- **Auth:** secret token in the link (like BotCash Trader). First visit sets a
  year-long cookie, so bookmarking / add-to-home-screen just works after that.
- **Files live in** `media/` (git-ignored — never delete on deploy!)
- **Formats:** mp3, m4a, aac, wav, ogg, opus, flac + mp4, webm, mov videos
- **Deploy:** see [deploy.md](deploy.md)

No database, no accounts, no build step. One Node server (Express + Multer),
one HTML page.
