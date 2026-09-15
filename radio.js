// The live station: one endless MP3 stream, shared by every listener.
//
// Why this exists (2026-09-14): the public channel played songs one <audio> src at a
// time, and on a phone with the screen off Android kept killing it at the song
// boundary - the next play() was refused or the tab was frozen in the silent gap.
// Two rounds of client-side patching did not cure it. A real radio stream has no
// boundaries: the browser opens /radio.mp3 once and just keeps receiving audio, the
// same way every internet radio station works on a lock screen.
//
// How it is built: a chain of ffmpeg decoders (one per song, paced to real time with
// -re) feeds raw PCM into ONE long-running ffmpeg MP3 encoder, whose output is fanned
// out to every connected listener. Uniform 128 kbps, no ID3 tags mid-stream, no gaps.
// It starts when the first listener connects and shuts down a couple of minutes after
// the last one leaves, so an idle server runs no ffmpeg at all.
const { spawn, execFile } = require('child_process');
const path = require('path');

const RING_BYTES = 64 * 1024;        // ~4 s of 128 kbps handed to a new listener so it starts at once
const IDLE_STOP_MS = 2 * 60 * 1000;  // keep encoding this long after the last listener leaves
const SLOW_CLIENT_BYTES = 2 * 1024 * 1024; // a listener this far behind is dropped, not buffered forever

function createRadio({ mediaDir, listFiles, ffmpeg = 'ffmpeg', ffprobe = 'ffprobe', log = console.log }) {
  const clients = new Set();
  let encoder = null, decoder = null;
  let ring = [], ringLen = 0;
  let idleTimer = null;
  let running = false, stopping = false;
  let current = null; // { name, title, startedAt, duration }
  let bytesOut = 0;
  const durations = new Map(); // name -> seconds (probed once)

  function titleOf(name) {
    return path.basename(name, path.extname(name)).replace(/[_-]+/g, ' ').trim();
  }

  function probeDuration(name) {
    if (durations.has(name)) return Promise.resolve(durations.get(name));
    return new Promise((resolve) => {
      execFile(ffprobe, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path.join(mediaDir, name)],
        (err, out) => {
          const d = err ? 0 : parseFloat(String(out).trim()) || 0;
          durations.set(name, d);
          resolve(d);
        });
    });
  }

  function pushRing(chunk) {
    ring.push(chunk); ringLen += chunk.length;
    while (ringLen > RING_BYTES && ring.length > 1) { ringLen -= ring[0].length; ring.shift(); }
  }

  function broadcast(chunk) {
    bytesOut += chunk.length;
    pushRing(chunk);
    for (const res of clients) {
      if (res.writableLength > SLOW_CLIENT_BYTES) { res.destroy(); continue; }
      res.write(chunk);
    }
  }

  function startEncoder() {
    encoder = spawn(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-nostdin',
      '-f', 's16le', '-ar', '44100', '-ac', '2', '-i', 'pipe:0',
      '-c:a', 'libmp3lame', '-b:a', '128k', '-ar', '44100', '-ac', '2',
      '-write_xing', '0', '-id3v2_version', '0', '-f', 'mp3', 'pipe:1',
    ], { stdio: ['pipe', 'pipe', 'pipe'] });
    encoder.stdout.on('data', broadcast);
    encoder.stderr.on('data', (d) => log('[radio] encoder: ' + String(d).trim()));
    encoder.stdin.on('error', () => {});
    encoder.on('exit', (code) => {
      log('[radio] encoder exited (' + code + ')');
      encoder = null;
      if (running && !stopping) { // crashed while people were listening: come back
        setTimeout(() => { if (running && !encoder) startEncoder(); }, 1000);
      }
    });
  }

  // Decode one song to PCM at real-time pace into the encoder. Resolves when it ends.
  function playFile(name) {
    return new Promise((resolve) => {
      if (!encoder) return resolve();
      decoder = spawn(ffmpeg, [
        '-hide_banner', '-loglevel', 'error', '-nostdin', '-re',
        '-i', path.join(mediaDir, name), '-vn',
        '-f', 's16le', '-ar', '44100', '-ac', '2', 'pipe:1',
      ], { stdio: ['ignore', 'pipe', 'pipe'] });
      const dec = decoder;
      dec.stderr.on('data', (d) => log('[radio] ' + name + ': ' + String(d).trim()));
      dec.stdout.on('error', () => {});
      dec.stdout.pipe(encoder.stdin, { end: false });
      dec.on('exit', () => { if (decoder === dec) decoder = null; resolve(); });
    });
  }

  async function loop() {
    let idx = 0;
    while (running) {
      const list = listFiles();
      if (!list.length) { await new Promise((r) => setTimeout(r, 5000)); continue; }
      if (idx >= list.length) idx = 0;
      const name = list[idx++];
      const duration = await probeDuration(name);
      if (!running) break;
      current = { name, title: titleOf(name), startedAt: Date.now(), duration };
      log('[radio] now playing: ' + current.title + ' (' + Math.round(duration) + 's, ' + clients.size + ' listening)');
      await playFile(name);
    }
    current = null;
  }

  function start() {
    if (running) return;
    running = true; stopping = false;
    ring = []; ringLen = 0;
    startEncoder();
    loop().catch((e) => log('[radio] loop error: ' + e.message));
    log('[radio] station on air');
  }

  function stop() {
    if (!running) return;
    stopping = true; running = false;
    if (decoder) { try { decoder.kill('SIGKILL'); } catch (e) {} decoder = null; }
    if (encoder) { try { encoder.stdin.end(); encoder.kill('SIGKILL'); } catch (e) {} encoder = null; }
    current = null; ring = []; ringLen = 0;
    log('[radio] station off air (no listeners)');
  }

  function addListener(req, res) {
    clearTimeout(idleTimer);
    res.writeHead(200, {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-cache, no-store',
      'Pragma': 'no-cache',
      'Connection': 'keep-alive',
      'Accept-Ranges': 'none',
      'X-Accel-Buffering': 'no',   // nginx: pass bytes straight through, do not buffer the stream
      'icy-name': 'Calypso Radio',
    });
    if (typeof res.flushHeaders === 'function') res.flushHeaders();
    start();
    for (const chunk of ring) res.write(chunk); // instant start from the recent past
    clients.add(res);
    log('[radio] listener joined (' + clients.size + ')');
    const bye = () => {
      if (!clients.delete(res)) return;
      log('[radio] listener left (' + clients.size + ')');
      if (!clients.size) {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => { if (!clients.size) stop(); }, IDLE_STOP_MS);
      }
    };
    res.on('close', bye);
    res.on('error', bye);
  }

  function nowPlaying() {
    return {
      live: running,
      listeners: clients.size,
      title: current ? current.title : '',
      name: current ? current.name : '',
      startedAt: current ? current.startedAt : 0,
      elapsed: current ? (Date.now() - current.startedAt) / 1000 : 0,
      duration: current ? current.duration : 0,
      bytesOut,
    };
  }

  return { addListener, nowPlaying, stop, start };
}

module.exports = { createRadio };
