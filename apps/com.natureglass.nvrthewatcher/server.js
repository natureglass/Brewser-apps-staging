#!/usr/bin/env node
/*
 * NVR - The Watcher relay. Zero dependencies, Node 18+.
 *
 *   node server.js
 *
 * What it does:
 *   /                      serves index.html
 *   /api/health            relay + ffmpeg status
 *   /api/rtsp?url=rtsp://  RTSP -> MJPEG (multipart) using ffmpeg, shared between viewers
 *   /api/rtsp/stats?url=   encoder stats for that stream
 *   /api/streams           all active RTSP relays
 *   /api/proxy?url=http    streams an HTTP camera through the relay (basic/digest auth, CORS)
 *
 * Environment:
 *   PORT=8080  HOST=127.0.0.1  FFMPEG_PATH=ffmpeg  MAX_RELAYS=8
 *
 * The relay is meant for your own machine or LAN. Bind it to 127.0.0.1 (the default)
 * unless you want other hosts to use its proxy.
 */
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');

const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '127.0.0.1';
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const MAX_RELAYS = Number(process.env.MAX_RELAYS) || 8;
const INDEX = path.join(__dirname, 'index.html');
const UA = 'NVR-TheWatcher/1.1';
const VERSION = '1.1.0';

function ffmpegVersion() {
  try {
    const r = spawnSync(FFMPEG, ['-version'], { encoding: 'utf8' });
    if (r.status === 0) return (r.stdout.split('\n')[0] || 'ffmpeg').trim();
  } catch (e) { /* not installed */ }
  return null;
}
const FFMPEG_VERSION = ffmpegVersion();

// ---------------------------------------------------------------- JPEG scanning
const SOI = Buffer.from([0xff, 0xd8, 0xff]);

// Index just past the EOI marker, -1 if the frame is incomplete, -2 if corrupt.
function jpegEnd(b, start) {
  const n = b.length; let i = start + 2;
  while (i + 1 < n) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m === 0xff) { i++; continue; }
    if (m === 0xd9) return i + 2;
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    if (i + 3 >= n) return -1;
    const len = b.readUInt16BE(i + 2);
    if (len < 2) return -2;
    i += 2 + len;
    if (m === 0xda) {
      while (i + 1 < n) {
        if (b[i] === 0xff) {
          const x = b[i + 1];
          if (x === 0x00 || (x >= 0xd0 && x <= 0xd7)) { i += 2; continue; }
          if (x === 0xff) { i++; continue; }
          break;
        }
        i++;
      }
    }
  }
  return -1;
}

// Width/height from the SOF marker.
function jpegSize(b) {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m === 0xff) { i++; continue; }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    const len = b.readUInt16BE(i + 2);
    const sof = (m >= 0xc0 && m <= 0xc3) || (m >= 0xc5 && m <= 0xc7) || (m >= 0xc9 && m <= 0xcb) || (m >= 0xcd && m <= 0xcf);
    if (sof) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    if (m === 0xda) break;
    i += 2 + len;
  }
  return null;
}

// ---------------------------------------------------------------- RTSP relay
const relays = new Map();

function relayOpts(u) {
  const clamp = (v, lo, hi, d) => { if (v === null || v === '') return d; v = Number(v); return Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : d; };
  const url = (u.searchParams.get('url') || '').trim();
  return {
    url,
    fps: clamp(u.searchParams.get('fps'), 1, 30, 15),
    width: clamp(u.searchParams.get('width'), 160, 3840, 1280),
    quality: clamp(u.searchParams.get('quality'), 2, 31, 6),
    transport: u.searchParams.get('transport') === 'udp' ? 'udp' : 'tcp',
  };
}
const relayKey = o => JSON.stringify([o.url, o.fps, o.width, o.quality, o.transport]);
function maskUrl(s) { try { const u = new URL(s); if (u.password) u.password = 'xxxx'; return u.href; } catch (e) { return s; } }

class Relay {
  constructor(key, opts) {
    this.key = key; this.opts = opts;
    this.clients = new Set();
    this.proc = null; this.buf = Buffer.alloc(0);
    this.stopped = false; this.restarts = 0; this.idleTimer = null; this.restartTimer = null; this.watchdog = null;
    this.stderr = [];
    this.st = { state: 'starting', frames: 0, bytes: 0, width: 0, height: 0, startedAt: Date.now(), lastFrameAt: 0, lastError: '', fpsWindow: [] };
    this.start();
  }
  args() {
    const o = this.opts;
    return [
      '-hide_banner', '-loglevel', 'warning', '-nostdin',
      '-rtsp_transport', o.transport,
      '-fflags', 'nobuffer', '-flags', 'low_delay',
      '-analyzeduration', '2000000', '-probesize', '2000000',
      '-i', o.url,
      '-an',
      '-vf', `fps=${o.fps},scale='min(${o.width},iw)':-2`,
      '-c:v', 'mjpeg', '-q:v', String(o.quality), '-pix_fmt', 'yuvj420p',
      '-f', 'mjpeg', 'pipe:1',
    ];
  }
  start() {
    if (this.stopped) return;
    this.st.state = this.restarts ? 'restarting' : 'starting';
    this.buf = Buffer.alloc(0);
    let proc;
    try {
      proc = spawn(FFMPEG, this.args(), { stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      this.st.state = 'error'; this.st.lastError = e.message; return;
    }
    this.proc = proc;
    proc.stdout.on('data', c => this.onData(c));
    proc.stderr.on('data', c => {
      for (const line of c.toString().split('\n')) {
        const l = line.trim(); if (!l) continue;
        this.stderr.push(l); if (this.stderr.length > 8) this.stderr.shift();
        if (/error|failed|refused|unauthorized|not found|timed? ?out|invalid/i.test(l)) this.st.lastError = l;
      }
    });
    proc.on('error', e => { this.st.state = 'error'; this.st.lastError = e.message; });
    proc.on('exit', (code, sig) => {
      if (this.proc !== proc) return;
      this.proc = null;
      if (this.stopped) return;
      if (code !== 0 && code !== null) this.st.lastError = this.st.lastError || `ffmpeg exited with code ${code}`;
      this.st.state = 'error';
      if (this.clients.size) this.scheduleRestart();
    });
    clearInterval(this.watchdog);
    const spawnedAt = Date.now();
    this.watchdog = setInterval(() => {
      const last = this.st.lastFrameAt || spawnedAt;
      if (this.proc && Date.now() - last > 20000) {
        this.st.lastError = this.st.lastError || 'No frames from the camera for 20 s';
        this.proc.kill('SIGKILL');
      }
    }, 5000);
  }
  scheduleRestart() {
    if (this.restartTimer || this.stopped) return;
    if (this.restarts >= 12) { this.st.lastError = 'Giving up after ' + this.restarts + ' restarts: ' + this.st.lastError; return; }
    const wait = Math.min(20000, 1500 * Math.pow(2, Math.min(this.restarts, 4)));
    this.restartTimer = setTimeout(() => { this.restartTimer = null; this.restarts++; this.start(); }, wait);
  }
  onData(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    let pos = 0;
    for (;;) {
      const soi = this.buf.indexOf(SOI, pos);
      if (soi < 0) { pos = Math.max(pos, this.buf.length - 2); break; }
      const end = jpegEnd(this.buf, soi);
      if (end === -1) { pos = soi; break; }
      if (end === -2) { pos = soi + 2; continue; }
      this.emit(this.buf.subarray(soi, end)); pos = end;
    }
    this.buf = pos > 0 ? this.buf.subarray(pos) : this.buf;
    if (this.buf.length > 32 * 1024 * 1024) this.buf = Buffer.alloc(0);
  }
  emit(frame) {
    const s = this.st, now = Date.now();
    s.frames++; s.bytes += frame.length; s.lastFrameAt = now; s.state = 'streaming'; s.lastError = '';
    s.fpsWindow.push(now); while (s.fpsWindow.length && now - s.fpsWindow[0] > 5000) s.fpsWindow.shift();
    if (s.frames === 1 || s.frames % 60 === 0) { const d = jpegSize(frame); if (d) { s.width = d.width; s.height = d.height; } }
    const head = Buffer.from(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`);
    for (const res of this.clients) {
      if (res.writableNeedDrain || res.destroyed) continue; // slow viewer: skip this frame
      res.write(head); res.write(frame); res.write('\r\n');
    }
  }
  addClient(res) {
    clearTimeout(this.idleTimer); this.idleTimer = null;
    res.writeHead(200, {
      'Content-Type': 'multipart/x-mixed-replace; boundary=frame',
      'Cache-Control': 'no-store', 'Pragma': 'no-cache',
      'Connection': 'close', 'X-Accel-Buffering': 'no',
      'Access-Control-Allow-Origin': '*',
    });
    this.clients.add(res);
    res.on('close', () => this.removeClient(res));
    if (!this.proc && !this.restartTimer) { this.restarts = 0; this.start(); }
  }
  removeClient(res) {
    this.clients.delete(res);
    if (!this.clients.size) this.idleTimer = setTimeout(() => this.stop('no viewers'), 5000);
  }
  stop(reason) {
    this.stopped = true;
    clearTimeout(this.idleTimer); clearTimeout(this.restartTimer); clearInterval(this.watchdog);
    if (this.proc) { try { this.proc.kill('SIGKILL'); } catch (e) { /* already gone */ } this.proc = null; }
    for (const res of this.clients) { try { res.end(); } catch (e) { /* ignore */ } }
    this.clients.clear();
    relays.delete(this.key);
    console.log(`[relay] stopped ${maskUrl(this.opts.url)} (${reason})`);
  }
  stats() {
    const s = this.st, now = Date.now();
    const win = s.fpsWindow.length > 1 ? (s.fpsWindow.length - 1) / ((s.fpsWindow[s.fpsWindow.length - 1] - s.fpsWindow[0]) / 1000) : 0;
    return {
      state: s.state, url: maskUrl(this.opts.url), options: { fps: this.opts.fps, width: this.opts.width, quality: this.opts.quality, transport: this.opts.transport },
      frames: s.frames, bytes: s.bytes, fps: Number.isFinite(win) ? win : 0, width: s.width, height: s.height,
      clients: this.clients.size, uptime_s: Math.round((now - s.startedAt) / 1000),
      last_frame_age_s: s.lastFrameAt ? Math.round((now - s.lastFrameAt) / 1000) : null,
      restarts: this.restarts, lastError: s.lastError, stderr: this.stderr.slice(-5), ffmpeg: FFMPEG_VERSION,
    };
  }
}

// ---------------------------------------------------------------- HTTP helpers
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' });
  res.end(body);
}
function serveIndex(res) {
  fs.readFile(INDEX, (err, data) => {
    if (err) return json(res, 404, { error: 'index.html not found next to server.js' });
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}
const md5 = s => crypto.createHash('md5').update(s).digest('hex');
function parseAuthParams(h) {
  const out = {}; const re = /(\w+)=(?:"([^"]*)"|([^\s,]*))/g; let m;
  while ((m = re.exec(h))) out[m[1].toLowerCase()] = m[2] !== undefined ? m[2] : m[3];
  return out;
}
function digestHeader(challenge, method, uri, user, pass) {
  const p = parseAuthParams(challenge.replace(/^digest\s+/i, ''));
  const algo = (p.algorithm || 'MD5').toUpperCase();
  const nc = '00000001', cnonce = crypto.randomBytes(8).toString('hex');
  let ha1 = md5(`${user}:${p.realm}:${pass}`);
  if (algo === 'MD5-SESS') ha1 = md5(`${ha1}:${p.nonce}:${cnonce}`);
  const ha2 = md5(`${method}:${uri}`);
  const qop = p.qop ? p.qop.split(',').map(s => s.trim()).find(q => q === 'auth') || p.qop.split(',')[0].trim() : null;
  const response = qop ? md5(`${ha1}:${p.nonce}:${nc}:${cnonce}:${qop}:${ha2}`) : md5(`${ha1}:${p.nonce}:${ha2}`);
  let h = `Digest username="${user}", realm="${p.realm || ''}", nonce="${p.nonce || ''}", uri="${uri}", response="${response}"`;
  if (qop) h += `, qop=${qop}, nc=${nc}, cnonce="${cnonce}"`;
  if (p.opaque) h += `, opaque="${p.opaque}"`;
  if (p.algorithm) h += `, algorithm=${p.algorithm}`;
  return h;
}

// Streams an upstream HTTP(S) resource to the client, answering basic/digest challenges
// with credentials taken from the URL. Follows a few redirects.
function proxyStream(req, res, target, { headers = {}, method = 'GET', body = null, allowHosts = null } = {}) {
  let u;
  try { u = new URL(target); } catch (e) { return json(res, 400, { error: 'Bad url' }); }
  if (!/^https?:$/.test(u.protocol)) return json(res, 400, { error: 'Only http and https can be proxied' });
  if (allowHosts && !allowHosts.includes(u.hostname)) return json(res, 403, { error: 'Host not allowed' });
  const user = decodeURIComponent(u.username || ''), pass = decodeURIComponent(u.password || '');
  u.username = ''; u.password = '';
  let hops = 0, upstream = null;
  const doReq = (url, auth) => {
    const mod = url.protocol === 'https:' ? https : http;
    const h = Object.assign({ 'user-agent': UA, accept: '*/*', connection: 'close' }, headers);
    if (auth) h.authorization = auth;
    if (body) h['content-length'] = Buffer.byteLength(body);
    const r = mod.request(url, { method, headers: h }, up => {
      r.setTimeout(0);
      if (up.statusCode === 401 && user && !auth) {
        const www = up.headers['www-authenticate'] || '';
        up.resume();
        if (/^digest/i.test(www)) return doReq(url, digestHeader(www, method, url.pathname + url.search, user, pass));
        return doReq(url, 'Basic ' + Buffer.from(user + ':' + pass).toString('base64'));
      }
      if ([301, 302, 303, 307, 308].includes(up.statusCode) && up.headers.location && hops < 4) {
        hops++; up.resume();
        let next; try { next = new URL(up.headers.location, url); } catch (e) { return json(res, 502, { error: 'Bad redirect' }); }
        return doReq(next, null);
      }
      upstream = up;
      const out = { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*', 'X-Accel-Buffering': 'no' };
      for (const k of ['content-type', 'content-length', 'last-modified', 'etag', 'location']) if (up.headers[k]) out[k] = up.headers[k];
      out['Access-Control-Expose-Headers'] = '*';
      res.writeHead(up.statusCode, out);
      up.pipe(res);
      up.on('error', () => res.end());
    });
    r.setTimeout(15000, () => r.destroy(new Error('Upstream did not answer within 15 s')));
    r.on('error', e => { if (!res.headersSent) json(res, 502, { error: e.message }); else res.end(); });
    if (body) r.write(body);
    r.end();
    req.on('close', () => { r.destroy(); if (upstream) upstream.destroy(); });
  };
  doReq(u, null);
}

// ---------------------------------------------------------------- routes
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const p = u.pathname;

  if (p === '/' || p === '/index.html') return serveIndex(res);

  if (p === '/api/health') {
    return json(res, 200, { ok: true, name: 'nvr-watcher-relay', version: VERSION, node: process.version, ffmpeg: !!FFMPEG_VERSION, ffmpegVersion: FFMPEG_VERSION, relays: relays.size, maxRelays: MAX_RELAYS });
  }

  if (p === '/api/streams') return json(res, 200, { items: [...relays.values()].map(r => r.stats()) });

  if (p === '/api/rtsp' || p === '/api/rtsp/stats') {
    const o = relayOpts(u);
    if (!/^rtsps?:\/\//i.test(o.url)) return json(res, 400, { error: 'url must start with rtsp:// or rtsps://' });
    const key = relayKey(o);
    if (p === '/api/rtsp/stats') {
      const r = relays.get(key);
      return json(res, 200, r ? r.stats() : { state: 'idle', url: maskUrl(o.url), ffmpeg: FFMPEG_VERSION });
    }
    if (!FFMPEG_VERSION) return json(res, 503, { error: 'ffmpeg is not installed on the relay (set FFMPEG_PATH or install ffmpeg)' });
    let r = relays.get(key);
    if (!r) {
      if (relays.size >= MAX_RELAYS) return json(res, 429, { error: `Too many streams (max ${MAX_RELAYS}); stop one first` });
      r = new Relay(key, o); relays.set(key, r);
      console.log(`[relay] started ${maskUrl(o.url)} @${o.fps}fps, max ${o.width}px, q${o.quality}, ${o.transport}`);
    }
    return r.addClient(res);
  }

  if (p === '/api/proxy') {
    const target = u.searchParams.get('url') || '';
    return proxyStream(req, res, target);
  }

  json(res, 404, { error: 'Not found' });
});

server.on('clientError', (err, socket) => { try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch (e) { /* ignore */ } });

server.listen(PORT, HOST, () => {
  console.log(`NVR - The Watcher relay listening on http://${HOST}:${PORT}`);
  console.log(FFMPEG_VERSION ? `ffmpeg: ${FFMPEG_VERSION}` : 'ffmpeg: not found, RTSP relaying is disabled (install ffmpeg or set FFMPEG_PATH)');
  if (HOST !== '127.0.0.1' && HOST !== 'localhost') console.log('Note: the relay includes an HTTP proxy. Keep it on a trusted network.');
});

function shutdown() {
  for (const r of [...relays.values()]) r.stop('shutdown');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 1000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
