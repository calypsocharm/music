// Calypso Radio service worker v2 — offline engine.
// ❤️ hearted songs are stored in 'radio-media-v1' by the page; this worker
// serves them (with Range support, so seeking works) when the network is gone,
// and keeps the app shell + track list openable offline.
const MEDIA_CACHE = 'radio-media-v1';
const SHELL_CACHE = 'radio-shell-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== 'GET') return;
  if (url.pathname.startsWith('/media/')) {
    e.respondWith(serveMedia(e.request));
  } else if (e.request.mode === 'navigate' ||
             url.pathname === '/api/tracks' || url.pathname === '/api/info') {
    e.respondWith(networkFirst(e.request));
  }
});

// saved songs play from the phone; everything else streams as usual
async function serveMedia(req) {
  const cache = await caches.open(MEDIA_CACHE);
  const cached = await cache.match(req.url);
  if (!cached) return fetch(req);
  const range = (req.headers.get('range') || '').match(/bytes=(\d+)-(\d*)/);
  if (!range) return cached.clone();
  const buf = await cached.clone().arrayBuffer();
  const start = Number(range[1]);
  const end = range[2] ? Math.min(Number(range[2]), buf.byteLength - 1) : buf.byteLength - 1;
  return new Response(buf.slice(start, end + 1), {
    status: 206,
    headers: {
      'Content-Type': cached.headers.get('Content-Type') || 'audio/mpeg',
      'Content-Range': `bytes ${start}-${end}/${buf.byteLength}`,
      'Content-Length': String(end - start + 1),
      'Accept-Ranges': 'bytes',
    },
  });
}

// live from the network when possible; last known copy when not
async function networkFirst(req) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (_) {
    const hit = await cache.match(req, { ignoreSearch: true });
    return hit || new Response('You are offline and this page is not saved.', { status: 503 });
  }
}
