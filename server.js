// Calypso Radio — private music/video library + player
// Run: node server.js   (PORT and MEDIA_DIR overridable via env)
const express = require('express');
const multer = require('multer');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 8300;
const MEDIA_DIR = process.env.MEDIA_DIR || path.join(__dirname, 'media');
fs.mkdirSync(MEDIA_DIR, { recursive: true });

// --- secret token (like BotCash): from env, or .radio_token file, or auto-generated ---
const TOKEN_FILE = path.join(__dirname, '.radio_token');
let TOKEN = process.env.RADIO_TOKEN;
if (!TOKEN) {
  if (fs.existsSync(TOKEN_FILE)) {
    TOKEN = fs.readFileSync(TOKEN_FILE, 'utf8').trim();
  } else {
    TOKEN = crypto.randomBytes(12).toString('hex');
    fs.writeFileSync(TOKEN_FILE, TOKEN + '\n');
  }
}

// --- short phone code: 6 digits, easy to type on a phone keyboard ---
const PIN_FILE = path.join(__dirname, '.radio_pin');
let PIN;
if (fs.existsSync(PIN_FILE)) {
  PIN = fs.readFileSync(PIN_FILE, 'utf8').trim();
} else {
  PIN = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  fs.writeFileSync(PIN_FILE, PIN + '\n');
}

const AUDIO_EXT = new Set(['.mp3', '.m4a', '.aac', '.wav', '.ogg', '.opus', '.flac']);
const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov', '.m4v']);
const allowedExt = (name) => {
  const ext = path.extname(name).toLowerCase();
  return AUDIO_EXT.has(ext) || VIDEO_EXT.has(ext);
};

const app = express();
app.disable('x-powered-by');
app.use(express.urlencoded({ extended: false }));

const grantCookie = (res) => res.setHeader('Set-Cookie',
  `radio=${TOKEN}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly`);

const loginPage = (msg) => `<!DOCTYPE html><html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Calypso Radio</title></head>
<body style="font-family:-apple-system,'Segoe UI',sans-serif;background:linear-gradient(160deg,#1a1025,#241536);color:#f3ecff;display:grid;place-items:center;min-height:100vh;margin:0">
<form method="POST" action="/login" style="text-align:center;padding:24px;max-width:340px">
  <div style="font-size:3rem">✦</div>
  <h1 style="margin:8px 0 4px">Calypso Radio</h1>
  <p style="color:#a894c9;margin:0 0 22px">Your private station</p>
  ${msg ? `<p style="color:#e05c9c;font-weight:600">${msg}</p>` : ''}
  <input name="code" placeholder="Enter your code" autocomplete="off" autocapitalize="off"
    autofocus style="width:100%;box-sizing:border-box;padding:16px;font-size:1.3rem;text-align:center;
    letter-spacing:3px;border-radius:14px;border:2px solid #3a2458;background:#2d1b44;color:#f3ecff;outline:none">
  <button style="width:100%;margin-top:14px;padding:16px;font-size:1.1rem;font-weight:800;border:0;
    border-radius:14px;background:linear-gradient(135deg,#f0a35e,#e05c9c);color:#2a1020;cursor:pointer">
    Open my station</button>
</form></body></html>`;

// --- rate limit code guesses: 8 tries per 15 minutes per visitor ---
const attempts = new Map();
app.post('/login', (req, res) => {
  const ip = req.headers['x-real-ip'] || req.socket.remoteAddress || '?';
  const now = Date.now();
  let a = attempts.get(ip) || { count: 0, ts: now };
  if (now - a.ts > 15 * 60 * 1000) a = { count: 0, ts: now };
  if (a.count >= 8) {
    return res.status(429).send(loginPage('Too many tries — take a 15 minute breather 🌙'));
  }
  const code = String((req.body && req.body.code) || '').trim();
  if (code && (code === TOKEN || code === PIN)) {
    attempts.delete(ip);
    grantCookie(res);
    return res.redirect('/');
  }
  a.count++;
  attempts.set(ip, a);
  res.status(401).send(loginPage("That code didn't match — try again"));
});

// --- auth: ?token= link, year-long cookie, or the /login form above ---
// (app-install files are public: phones fetch them without the login cookie)
const PUBLIC_FILES = new Set(['/manifest.webmanifest', '/sw.js', '/icon-512.png']);
app.use((req, res, next) => {
  if (PUBLIC_FILES.has(req.path)) return next();
  const fromQuery = req.query.token;
  const cookieMatch = (req.headers.cookie || '').match(/(?:^|;\s*)radio=([^;]+)/);
  const fromCookie = cookieMatch ? cookieMatch[1] : null;
  if (fromQuery && fromQuery === TOKEN) {
    grantCookie(res);
    return next();
  }
  if (fromCookie === TOKEN) return next();
  res.status(401).send(loginPage(''));
});

// --- station info for the player page (already behind auth) ---
app.get('/api/info', (req, res) => res.json({ pin: PIN }));

// --- let her choose her own station passcode (already behind auth) ---
app.post('/api/passcode', (req, res) => {
  const code = String((req.body && req.body.code) || '').trim();
  if (code.length < 6 || code.length > 60) {
    return res.status(400).json({ error: 'Passcode needs to be 6 to 60 characters.' });
  }
  PIN = code;
  fs.writeFileSync(PIN_FILE, PIN + '\n');
  res.json({ ok: true, pin: PIN });
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/media', express.static(MEDIA_DIR)); // supports Range requests for seeking

// --- track list, newest first ---
app.get('/api/tracks', (req, res) => {
  const files = fs.readdirSync(MEDIA_DIR)
    .filter(allowedExt)
    .map((name) => {
      const st = fs.statSync(path.join(MEDIA_DIR, name));
      const ext = path.extname(name).toLowerCase();
      return {
        name,
        title: path.basename(name, ext).replace(/[_-]+/g, ' ').trim(),
        url: '/media/' + encodeURIComponent(name),
        size: st.size,
        mtime: st.mtimeMs,
        kind: VIDEO_EXT.has(ext) ? 'video' : 'audio',
      };
    })
    .sort((a, b) => b.mtime - a.mtime);
  res.json(files);
});

// --- upload (multiple files) ---
const storage = multer.diskStorage({
  destination: MEDIA_DIR,
  filename: (req, file, cb) => {
    // browsers send latin1; recover utf8 names, then sanitize
    let name = Buffer.from(file.originalname, 'latin1').toString('utf8');
    name = path.basename(name).replace(/[\\/:*?"<>|]/g, '_');
    const ext = path.extname(name);
    const base = path.basename(name, ext);
    let candidate = name;
    let n = 2;
    while (fs.existsSync(path.join(MEDIA_DIR, candidate))) {
      candidate = `${base} (${n++})${ext}`;
    }
    cb(null, candidate);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB per file
  fileFilter: (req, file, cb) => cb(null, allowedExt(file.originalname)),
});

app.post('/api/upload', upload.array('files', 50), (req, res) => {
  res.json({ uploaded: (req.files || []).map((f) => f.filename) });
});

// --- delete a track ---
app.delete('/api/tracks/:name', (req, res) => {
  const name = path.basename(req.params.name);
  const full = path.join(MEDIA_DIR, name);
  if (!allowedExt(name) || !fs.existsSync(full)) {
    return res.status(404).json({ error: 'not found' });
  }
  fs.unlinkSync(full);
  res.json({ deleted: name });
});

app.listen(PORT, () => {
  console.log(`Calypso Radio on http://localhost:${PORT}/?token=${TOKEN}`);
  console.log(`Media folder: ${MEDIA_DIR}`);
});
