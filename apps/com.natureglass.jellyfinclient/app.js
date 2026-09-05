/**
 * Spike harness — plain JavaScript, no build step. Exercises the whole core:
 * connect -> Quick Connect / password auth -> views -> items -> resume ->
 * quality caps -> PlaybackInfo -> <video> playback -> progress reports.
 * Runs in a desktop browser and in Brewser (detected via globalThis.Switch).
 */
(function () {
  'use strict';
  const JF = globalThis.JF;

  const isBrewser = typeof globalThis.Switch !== 'undefined';
  const storage = JF.localStorageAdapter();
  const identity = {
    clientName: 'JellyfinCoreSpike',
    clientVersion: '0.1.0',
    deviceName: isBrewser ? 'Nintendo Switch (Brewser)' : 'Browser',
    deviceId: JF.createOrRestoreDeviceId(storage),
  };

  let client = null;
  let measuredBitrate;
  let currentParentId;
  let startIndex = 0;
  const PAGE = 40;

  // ---- tiny dom helpers ----------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const show = (id, on) => { $(id).classList.toggle('hidden', on === false); };
  const logEl = $('log');
  function log(msg, isErr) {
    const line = document.createElement('div');
    if (isErr) line.className = 'e';
    line.textContent = new Date().toTimeString().slice(0, 8) + '  ' + msg;
    logEl.appendChild(line);
    logEl.scrollTop = logEl.scrollHeight;
  }
  function fail(e, where) {
    const m = e instanceof JF.JellyfinError ? e.message + ' (' + e.status + ')' : String(e);
    log(where + ': ' + m, true);
  }

  // ---- connect -------------------------------------------------------------
  async function connect(url) {
    client = new JF.JellyfinClient({ baseUrl: url, identity: identity, storage: storage });
    const info = await JF.getPublicSystemInfo(client);
    $('connect-status').textContent = (info.ServerName || 'Jellyfin') + ' · v' + (info.Version || '?');
    $('connect-status').className = 'status ok';
    log('connected: ' + client.baseUrl + ' (' + info.ServerName + ' v' + info.Version + ')');
    show('sec-auth');
    const qc = await JF.isQuickConnectEnabled(client);
    $('btn-qc').disabled = !qc;
    if (!qc) log('Quick Connect is disabled on this server; use password login');
  }

  $('btn-connect').onclick = async () => {
    try { await connect($('server-url').value); }
    catch (e) {
      $('connect-status').textContent = 'could not reach a Jellyfin server there';
      $('connect-status').className = 'status err';
      fail(e, 'connect');
    }
  };

  // ---- auth ----------------------------------------------------------------
  function onAuthed() {
    $('who').textContent = (client.userName || client.userId) + ' @ ' + client.baseUrl + (isBrewser ? ' · Switch' : '');
    show('sec-connect', false);
    show('sec-auth', false);
    show('sec-browse');
    loadViews().catch((e) => fail(e, 'views'));
  }

  $('btn-login').onclick = async () => {
    if (!client) return;
    try {
      await JF.authenticateByName(client, $('auth-user').value, $('auth-pass').value);
      log('signed in as ' + client.userName);
      onAuthed();
    } catch (e) { fail(e, 'login'); }
  };

  $('btn-qc').onclick = async () => {
    if (!client) return;
    try {
      const init = await JF.initiateQuickConnect(client);
      $('qc-code').textContent = init.Code || '?';
      show('qc-panel');
      log('quick connect code ' + init.Code + '; polling…');
      await JF.waitForQuickConnect(client, init.Secret, {});
      show('qc-panel', false);
      log('quick connect approved; signed in as ' + client.userName);
      onAuthed();
    } catch (e) {
      show('qc-panel', false);
      fail(e, 'quick connect');
    }
  };

  // ---- browse --------------------------------------------------------------
  async function loadViews() {
    const views = await JF.getViews(client);
    const wrap = $('views');
    wrap.innerHTML = '';

    function chip(label, onclick) {
      const el = document.createElement('div');
      el.className = 'chip';
      el.textContent = label;
      el.onclick = () => onclick(el);
      return el;
    }
    function activate(el) {
      for (const c of Array.from(wrap.children)) c.classList.remove('active');
      el.classList.add('active');
    }

    wrap.appendChild(chip('Continue watching', (el) => {
      activate(el);
      loadResume().catch((e) => fail(e, 'resume'));
    }));
    for (const v of views.Items || []) {
      wrap.appendChild(chip(v.Name || '?', (el) => {
        currentParentId = v.Id;
        startIndex = 0;
        activate(el);
        loadItems(true).catch((e) => fail(e, 'items'));
      }));
    }
    log('views: ' + (views.Items || []).map((v) => v.Name).join(', '));
  }

  async function loadItems(reset) {
    const grid = $('items');
    if (reset) grid.innerHTML = '';
    const page = await JF.getItems(client, {
      parentId: currentParentId,
      recursive: true,
      includeItemTypes: 'Movie,Series,Episode,MusicAlbum,Audio',
      startIndex: startIndex,
      limit: PAGE,
    });
    renderItems(page.Items || [], grid);
    startIndex += (page.Items || []).length;
    const total = page.TotalRecordCount || 0;
    $('browse-status').textContent = startIndex + ' / ' + total;
    show('btn-more', startIndex < total);
    log('items: +' + (page.Items || []).length + ' (total ' + total + ')');
  }

  async function loadResume() {
    const grid = $('items');
    grid.innerHTML = '';
    const res = await JF.getResumeItems(client, { limit: 24 });
    renderItems(res.Items || [], grid);
    show('btn-more', false);
    $('browse-status').textContent = (res.Items || []).length + ' resumable';
  }

  function renderItems(items, grid) {
    for (const item of items) {
      const card = document.createElement('div');
      card.className = 'card';
      const img = document.createElement('img');
      img.loading = 'lazy';
      // Server-side resize: ask for exactly the rendered width.
      img.src = JF.imageUrl(client, item, { fillWidth: 240 }) || '';
      img.alt = '';
      const t = document.createElement('div');
      t.className = 't';
      t.textContent = item.SeriesName ? item.SeriesName + ' · ' + item.Name : (item.Name || '?');
      card.appendChild(img);
      card.appendChild(t);
      card.onclick = () => { play(item).catch((e) => fail(e, 'play')); };
      grid.appendChild(card);
    }
  }

  $('btn-more').onclick = () => { loadItems(false).catch((e) => fail(e, 'items')); };

  // ---- playback ------------------------------------------------------------
  const video = $('player');
  let progress = null;
  let progressTimer = null;

  function qualityPolicy() {
    const v = $('quality').value;
    if (v === 'auto' || v === 'source') return { mode: v };
    if (v === '480') return { mode: { maxHeight: 480, maxFps: 30 } };
    return { mode: { maxHeight: Number(v) } };
  }

  $('btn-bitrate').onclick = async () => {
    if (!client) return;
    try {
      measuredBitrate = await JF.detectBitrate(client);
      log('bitrate test: ' + (measuredBitrate / 1e6).toFixed(1) + ' Mbps');
    } catch (e) { fail(e, 'bitrate test'); }
  };

  async function play(item) {
    if (!client || !item.Id) return;
    await stopPlayback(); // report the previous item before switching
    show('sec-player');
    $('player-title').textContent = item.Name || 'Player';

    if (item.MediaType === 'Audio') {
      const url = JF.audioUniversalUrl(client, item.Id);
      log('audio universal -> ' + url);
      video.src = url;
      video.play().catch(() => { /* autoplay policy; user presses play */ });
      $('player-info').innerHTML = '<b>audio/universal</b> · ' + url;
      return;
    }

    // Folder-ish types: drill in instead of playing.
    if (item.Type === 'Series' || item.Type === 'MusicAlbum' || item.Type === 'Season') {
      currentParentId = item.Id;
      startIndex = 0;
      await loadItems(true);
      show('sec-player', false);
      return;
    }

    const caps = JF.resolveQualityCaps(qualityPolicy(), {
      screenWidth: Math.round(innerWidth * (devicePixelRatio || 1)),
      screenHeight: Math.round(innerHeight * (devicePixelRatio || 1)),
      measuredBitrate: measuredBitrate,
      isBrewser: isBrewser,
    });
    log('caps: ' + caps.maxWidth + 'x' + caps.maxHeight +
      (caps.maxFps ? '@' + caps.maxFps : '') +
      ' <= ' + (caps.maxStreamingBitrate / 1e6).toFixed(1) + ' Mbps');

    const profile = isBrewser ? JF.buildBrewserDeviceProfile(caps) : JF.buildWebDeviceProfile(caps);
    const resumeTicks = (item.UserData && item.UserData.PlaybackPositionTicks) || 0;
    const info = await JF.getPlaybackInfo(client, item.Id, {
      deviceProfile: profile,
      maxStreamingBitrate: caps.maxStreamingBitrate,
      startTimeTicks: resumeTicks,
    });
    const src = JF.resolveVideoSource(client, item.Id, info);
    log('play method: ' + src.playMethod + ' (' + src.protocol + ')');
    log('src: ' + src.url);
    if (src.playMethod === 'Transcode' && src.protocol === 'hls' && !isBrewser) {
      log('note: plain <video> on web usually needs hls.js for HLS (player-web, milestone 4)');
    }

    video.src = src.url;
    if (resumeTicks > 0 && src.playMethod === 'DirectPlay') {
      // Direct play: seek locally. (Transcodes start at startTimeTicks server-side.)
      video.currentTime = JF.ticksToSeconds(resumeTicks);
      log('resuming at ' + JF.ticksToSeconds(resumeTicks).toFixed(0) + 's');
    }
    video.play().catch(() => { /* user gesture needed; fine */ });

    progress = {
      itemId: item.Id,
      mediaSourceId: src.mediaSourceId,
      playSessionId: src.playSessionId,
      playMethod: src.playMethod,
    };
    await JF.reportPlaybackStart(client, progress, resumeTicks);
    progressTimer = setInterval(() => {
      if (!client || !progress) return;
      JF.reportPlaybackProgress(client, progress, JF.secondsToTicks(video.currentTime), video.paused)
        .catch((e) => fail(e, 'progress'));
    }, 10000);
    $('player-info').innerHTML =
      '<b>' + src.playMethod + '</b> · ' + src.protocol + ' · session ' + (src.playSessionId || '-') +
      '<br>' + src.url;
  }

  async function stopPlayback() {
    if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
    if (client && progress) {
      try {
        await JF.reportPlaybackStopped(client, progress, JF.secondsToTicks(video.currentTime));
        log('stopped @ ' + video.currentTime.toFixed(0) + 's (resume point saved)');
      } catch (e) { fail(e, 'stop report'); }
      progress = null;
    }
    video.removeAttribute('src');
    video.load();
  }

  $('btn-seek').onclick = () => {
    video.currentTime += 30;
    log('seek -> ' + video.currentTime.toFixed(0) + 's');
  };
  $('btn-stop').onclick = () => { stopPlayback(); };
  video.addEventListener('ended', () => { stopPlayback(); });

  // ---- boot ----------------------------------------------------------------
  log('platform: ' + (isBrewser ? 'Brewser/Switch' : 'browser') + ' · deviceId ' + identity.deviceId.slice(0, 8) + '…');
  const restored = JF.restoreSession(storage, identity);
  if (restored) {
    client = restored;
    log('restored session for ' + (client.userName || client.userId));
    $('server-url').value = client.baseUrl;
    onAuthed();
  }

  // Expose for poking around in devtools / re-login testing.
  globalThis.jf = {
    get client() { return client; },
    logout: async () => { if (client) { await JF.logout(client); location.reload(); } },
  };
})();
