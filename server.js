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

const AUDIO_EXT = new Set(['.mp3', '.m4a', '.aac', '.wav', '.ogg', '.opus', '.flac']);
const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov', '.m4v']);
const allowedExt = (name) => {
  const ext = path.extname(name).toLowerCase();
  return AUDIO_EXT.has(ext) || VIDEO_EXT.has(ext);
};

const app = express();
app.disable('x-powered-by');

// --- auth: open the link once with ?token=..., a cookie remembers you for a year ---
app.use((req, res, next) => {
  const fromQuery = req.query.token;
  const cookieMatch = (req.headers.cookie || '').match(/(?:^|;\s*)radio=([^;]+)/);
  const fromCookie = cookieMatch ? cookieMatch[1] : null;
  if (fromQuery && fromQuery === TOKEN) {
    res.setHeader('Set-Cookie',
      `radio=${TOKEN}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly`);
    return next();
  }
  if (fromCookie === TOKEN) return next();
  res.status(401).send(
    '<body style="font-family:sans-serif;background:#1a1025;color:#eee;display:grid;place-items:center;height:100vh;margin:0">' +
    '<div style="text-align:center"><h1>🔒 Calypso Radio</h1>' +
    '<p>This is a private station. Open your secret link (the one ending in <code>?token=...</code>).</p></div></body>');
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
