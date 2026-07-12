// Minimal service worker: makes the station installable as an app.
// Deliberately has no fetch handler so audio streaming is never interfered with.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
