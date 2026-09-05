/**
 * Jellyfin client app — plain JavaScript, no build step.
 * Screens: connect -> auth -> library (shared folders) -> browse (folder
 * navigation with thumbnails) -> detail (pre-launch view) -> player.
 * Settings holds the app log, quality policy, bitrate test and sign-out.
 */
(function () {
  'use strict';
  const JF = globalThis.JF;

  const isBrewser = typeof globalThis.Switch !== 'undefined';
  const storage = JF.localStorageAdapter();
  const identity = {
    clientName: 'BrewserJellyfin',
    clientVersion: '0.2.0',
    deviceName: isBrewser ? 'Nintendo Switch (Brewser)' : 'Browser',
    deviceId: JF.createOrRestoreDeviceId(storage),
  };

  let client = null;
  let measuredBitrate;
  let qcCancelled = false;

  // ---- helpers -------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  const logEl = $('log');

  function log(msg, isErr) {
    const line = document.createElement('div');
    if (isErr) line.className = 'e';
    line.textContent = new Date().toTimeString().slice(0, 8) + '  ' + msg;
    logEl.appendChild(line);
    while (logEl.childNodes.length > 400) logEl.removeChild(logEl.firstChild);
    logEl.scrollTop = logEl.scrollHeight;
  }
  function fail(e, where) {
    const m = e instanceof JF.JellyfinError ? e.message + ' (' + e.status + ')' : String(e && e.message || e);
    log(where + ': ' + m, true);
    return m;
  }

  const SCREENS = ['connect', 'auth', 'library', 'browse', 'detail', 'player', 'settings'];
  let currentScreen = 'connect';
  let settingsReturnTo = 'library';

  function go(name) {
    for (const s of SCREENS) $('screen-' + s).classList.toggle('hidden', s !== name);
    if (name !== 'settings') settingsReturnTo = name;
    currentScreen = name;
    window.scrollTo(0, 0);
  }

  function el(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text != null) n.textContent = text;
    return n;
  }

  function thumbClass(item) {
    if (item.Type === 'Episode' || item.Type === 'CollectionFolder') return 'thumb landscape';
    if (item.MediaType === 'Audio' || item.Type === 'MusicAlbum' || item.Type === 'MusicArtist') return 'thumb square';
    return 'thumb';
  }

  function card(item, onClick) {
    const c = el('button', 'card');
    const img = document.createElement('img');
    img.className = thumbClass(item);
    img.loading = 'lazy';
    img.alt = '';
    const w = img.className.indexOf('landscape') >= 0 ? 440 : 300;
    img.src = JF.imageUrl(client, item, { fillWidth: w }) || '';
    c.appendChild(img);
    c.appendChild(el('div', 'label', item.Name || '?'));
    const sub = subLabel(item);
    if (sub) c.appendChild(el('div', 'sub', sub));
    c.onclick = onClick;
    return c;
  }

  function subLabel(item) {
    if (item.Type === 'Episode') {
      const s = item.ParentIndexNumber != null ? 'S' + item.ParentIndexNumber : '';
      const e = item.IndexNumber != null ? 'E' + item.IndexNumber : '';
      return [item.SeriesName, (s + e) || null].filter(Boolean).join(' · ');
    }
    if (item.ProductionYear) return String(item.ProductionYear);
    return '';
  }

  function runtimeText(ticks) {
    if (!ticks) return null;
    const mins = Math.round(JF.ticksToSeconds(ticks) / 60);
    if (mins < 60) return mins + 'm';
    return Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm';
  }

  function endsAtText(remainingTicks) {
    if (!remainingTicks) return null;
    const t = new Date(Date.now() + JF.ticksToSeconds(remainingTicks) * 1000);
    let h = t.getHours(), m = t.getMinutes();
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    return 'Ends at ' + h + ':' + (m < 10 ? '0' + m : m) + ' ' + ampm;
  }

  // ---- connect -------------------------------------------------------------
  function setStatus(id, msg, isErr) {
    const n = $(id);
    n.textContent = msg || '';
    n.className = 'form-status' + (isErr ? ' err' : '');
  }

  $('btn-connect').onclick = async () => {
    const url = $('server-url').value;
    if (!url.trim()) { setStatus('connect-status', 'Enter your server address', true); return; }
    setStatus('connect-status', 'Connecting…');
    try {
      client = new JF.JellyfinClient({ baseUrl: url, identity: identity, storage: storage });
      const info = await JF.getPublicSystemInfo(client);
      log('connected: ' + client.baseUrl + ' (' + info.ServerName + ' v' + info.Version + ')');
      setStatus('connect-status', '');
      $('auth-server-name').textContent = 'Sign in to ' + (info.ServerName || 'Jellyfin');
      const qc = await JF.isQuickConnectEnabled(client);
      $('btn-qc').classList.toggle('hidden', !qc);
      if (!qc) log('Quick Connect is disabled on this server');
      go('auth');
    } catch (e) {
      fail(e, 'connect');
      setStatus('connect-status',
        'Could not reach a Jellyfin server there. Check the address (scheme, host, port).', true);
    }
  };
  $('server-url').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') $('btn-connect').click(); });

  // ---- auth ----------------------------------------------------------------
  $('btn-login').onclick = async () => {
    if (!client) return;
    setStatus('auth-status', 'Signing in…');
    try {
      await JF.authenticateByName(client, $('auth-user').value, $('auth-pass').value);
      log('signed in as ' + client.userName);
      onAuthed();
    } catch (e) {
      fail(e, 'login');
      setStatus('auth-status', e instanceof JF.JellyfinError && e.status === 401
        ? 'Wrong username or password.' : 'Sign-in failed. See the log in Settings.', true);
    }
  };
  $('auth-pass').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') $('btn-login').click(); });

  $('btn-qc').onclick = async () => {
    if (!client) return;
    qcCancelled = false;
    try {
      const init = await JF.initiateQuickConnect(client);
      $('qc-code').textContent = init.Code || '?';
      $('auth-choices').classList.add('hidden');
      $('qc-panel').classList.remove('hidden');
      setStatus('auth-status', '');
      log('quick connect code ' + init.Code + '; waiting for approval');
      await JF.waitForQuickConnect(client, init.Secret, { shouldCancel: () => qcCancelled });
      log('quick connect approved; signed in as ' + client.userName);
      onAuthed();
    } catch (e) {
      if (!qcCancelled) {
        fail(e, 'quick connect');
        setStatus('auth-status', 'Quick Connect failed or expired. Try again.', true);
      }
    } finally {
      $('qc-panel').classList.add('hidden');
      $('auth-choices').classList.remove('hidden');
    }
  };
  $('btn-qc-cancel').onclick = () => { qcCancelled = true; };
  $('btn-change-server').onclick = () => { qcCancelled = true; go('connect'); };

  function onAuthed() {
    setStatus('auth-status', '');
    loadLibraries().catch((e) => fail(e, 'libraries'));
  }

  // ---- libraries (shared folders) -----------------------------------------
  async function loadLibraries() {
    const views = await JF.getViews(client);
    const grid = $('views-grid');
    grid.innerHTML = '';
    for (const v of views.Items || []) {
      grid.appendChild(card(Object.assign({}, v, { Type: 'CollectionFolder' }), () => {
        openFolder(v, true);
      }));
    }
    log('libraries: ' + (views.Items || []).map((v) => v.Name).join(', '));
    go('library');
  }

  // ---- browse (folder navigation) -----------------------------------------
  // Stack of { id, name, sortBy, startIndex } — back pops one level.
  let browseStack = [];

  function openFolder(item, resetStack) {
    if (resetStack) browseStack = [];
    const sortBy = (item.Type === 'Series' || item.Type === 'Season' || item.Type === 'MusicAlbum')
      ? 'IndexNumber,SortName' : 'SortName';
    browseStack.push({ id: item.Id, name: item.Name || '?', sortBy: sortBy, startIndex: 0 });
    loadFolder(true).catch((e) => fail(e, 'browse'));
  }

  const PAGE = 60;

  async function loadFolder(reset) {
    const top = browseStack[browseStack.length - 1];
    const grid = $('items-grid');
    if (reset) { grid.innerHTML = ''; top.startIndex = 0; }
    $('browse-title').textContent = top.name;
    go('browse');

    const page = await JF.getItems(client, {
      parentId: top.id,
      recursive: false, // natural hierarchy: folders stay folders
      sortBy: top.sortBy,
      startIndex: top.startIndex,
      limit: PAGE,
    });
    const items = page.Items || [];
    for (const item of items) grid.appendChild(card(item, () => onItemClick(item)));
    top.startIndex += items.length;
    const total = page.TotalRecordCount || 0;
    $('btn-more').classList.toggle('hidden', top.startIndex >= total);
    $('browse-empty').classList.toggle('hidden', total > 0);
    log('browse "' + top.name + '": ' + top.startIndex + '/' + total);
  }

  function onItemClick(item) {
    if (item.MediaType === 'Video' || item.MediaType === 'Audio') {
      openDetail(item.Id).catch((e) => fail(e, 'detail'));
    } else {
      openFolder(item, false);
    }
  }

  $('btn-more').onclick = () => { loadFolder(false).catch((e) => fail(e, 'browse')); };

  $('btn-browse-back').onclick = () => {
    browseStack.pop();
    if (browseStack.length === 0) { go('library'); return; }
    loadFolder(true).catch((e) => fail(e, 'browse'));
  };

  // ---- pre-launch detail ---------------------------------------------------
  let detailItem = null;

  async function openDetail(itemId) {
    const item = await JF.getItem(client, itemId);
    detailItem = item;

    $('detail-thumb').src =
      JF.imageUrl(client, item, { fillWidth: 600 }) ||
      JF.imageUrl(client, item, { type: 'Backdrop', fillWidth: 600 }) || '';
    $('detail-title').textContent = item.Name || '?';

    const meta = $('detail-meta');
    meta.innerHTML = '';
    const bits = [];
    if (item.SeriesName) bits.push(item.SeriesName);
    if (item.ProductionYear) bits.push(String(item.ProductionYear));
    const rt = runtimeText(item.RunTimeTicks);
    if (rt) bits.push(rt);
    const resumeTicks = (item.UserData && item.UserData.PlaybackPositionTicks) || 0;
    const ends = endsAtText((item.RunTimeTicks || 0) - resumeTicks);
    if (ends) bits.push(ends);
    for (const b of bits) meta.appendChild(el('span', null, b));

    // Stream rows, jellyfin-web style: "Video   720p H264 SDR"
    const streams = $('detail-streams');
    streams.innerHTML = '';
    const source = item.MediaSources && item.MediaSources[0];
    if (source && source.MediaStreams) {
      const v = source.MediaStreams.find((s) => s.Type === 'Video');
      const a = source.MediaStreams.find((s) => s.Type === 'Audio');
      const sub = source.MediaStreams.filter((s) => s.Type === 'Subtitle');
      if (v) addKv(streams, 'Video', [
        v.Height ? v.Height + 'p' : null,
        v.Codec ? v.Codec.toUpperCase() : null,
        v.VideoRange || 'SDR',
      ].filter(Boolean).join(' '));
      if (a) addKv(streams, 'Audio', [
        a.Codec ? a.Codec.toUpperCase() : null,
        a.Channels ? a.Channels + 'ch' : null,
        a.Language || null,
      ].filter(Boolean).join(' '));
      if (sub.length) addKv(streams, 'Subtitles', sub.map((s) => s.Language || s.DisplayTitle || '?').join(', '));
      if (source.Container) addKv(streams, 'Container', source.Container);
    }
    if (item.Genres && item.Genres.length) addKv(streams, 'Genre', item.Genres.join(', '));

    $('detail-overview').textContent = item.Overview || '';

    // Resume / Play buttons
    const hasResume = resumeTicks > 0;
    $('btn-resume').classList.toggle('hidden', !hasResume);
    if (hasResume) {
      const s = JF.ticksToSeconds(resumeTicks);
      const mm = Math.floor(s / 60), ss = Math.floor(s % 60);
      $('resume-label').textContent = 'Resume from ' + mm + ':' + (ss < 10 ? '0' + ss : ss);
      $('btn-play').classList.add('secondary');
      $('btn-play').querySelector('span').textContent = 'Play from beginning';
    } else {
      $('btn-play').classList.remove('secondary');
      $('btn-play').querySelector('span').textContent = 'Play';
    }

    go('detail');

    // More Like This (after showing the screen; non-blocking)
    const simGrid = $('similar-grid');
    simGrid.innerHTML = '';
    $('similar-h').classList.add('hidden');
    JF.getSimilarItems(client, item.Id, 8).then((sim) => {
      const arr = sim.Items || [];
      if (!arr.length) return;
      $('similar-h').classList.remove('hidden');
      for (const s of arr) simGrid.appendChild(card(s, () => onItemClick(s)));
    }).catch((e) => fail(e, 'similar'));
  }

  function addKv(parent, k, v) {
    if (!v) return;
    const row = el('div', 'kv-row');
    row.appendChild(el('span', 'k', k));
    row.appendChild(el('span', 'v', v));
    parent.appendChild(row);
  }

  $('btn-detail-back').onclick = () => {
    go(browseStack.length ? 'browse' : 'library');
  };
  $('btn-play').onclick = () => { if (detailItem) play(detailItem, 0).catch((e) => fail(e, 'play')); };
  $('btn-resume').onclick = () => {
    if (detailItem) {
      const t = (detailItem.UserData && detailItem.UserData.PlaybackPositionTicks) || 0;
      play(detailItem, t).catch((e) => fail(e, 'play'));
    }
  };

  // ---- player --------------------------------------------------------------
  const video = $('player-video');
  let progress = null;
  let progressTimer = null;

  function qualityPolicy() {
    const v = $('quality').value;
    if (v === 'auto' || v === 'source') return { mode: v };
    if (v === '480') return { mode: { maxHeight: 480, maxFps: 30 } };
    return { mode: { maxHeight: Number(v) } };
  }

  async function play(item, resumeTicks) {
    await stopPlayback();
    $('player-title').textContent = item.Name || '';
    go('player');

    if (item.MediaType === 'Audio') {
      const url = JF.audioUniversalUrl(client, item.Id);
      log('audio universal -> ' + url);
      video.src = url;
      video.play().catch(() => { /* user gesture needed; fine */ });
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
    const info = await JF.getPlaybackInfo(client, item.Id, {
      deviceProfile: profile,
      maxStreamingBitrate: caps.maxStreamingBitrate,
      startTimeTicks: resumeTicks,
    });
    const src = JF.resolveVideoSource(client, item.Id, info);
    log('play method: ' + src.playMethod + ' (' + src.protocol + ')');
    log('src: ' + src.url);
    if (src.playMethod === 'Transcode' && src.protocol === 'hls' && !isBrewser) {
      log('note: plain <video> on web usually needs hls.js for HLS (player-web milestone)');
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

  async function exitPlayer() {
    await stopPlayback();
    if (detailItem) {
      // Re-open detail so the resume position reflects what just happened.
      openDetail(detailItem.Id).catch((e) => fail(e, 'detail'));
    } else {
      go(browseStack.length ? 'browse' : 'library');
    }
  }

  $('btn-player-back').onclick = () => { exitPlayer(); };
  video.addEventListener('ended', () => { exitPlayer(); });

  // ---- settings ------------------------------------------------------------
  function openSettings() {
    $('set-server').textContent = client ? client.baseUrl : '-';
    $('set-user').textContent = client ? (client.userName || client.userId || '-') : '-';
    $('set-platform').textContent = (isBrewser ? 'Brewser / Switch' : 'Browser') +
      ' · device ' + identity.deviceId.slice(0, 8);
    go('settings');
    logEl.scrollTop = logEl.scrollHeight;
  }
  $('btn-settings').onclick = openSettings;
  $('btn-settings-2').onclick = openSettings;
  $('btn-settings-back').onclick = () => { go(settingsReturnTo); };

  $('quality').onchange = () => { storage.set('quality', $('quality').value); };

  $('btn-bitrate').onclick = async () => {
    if (!client) return;
    $('set-bitrate').textContent = 'measuring…';
    try {
      measuredBitrate = await JF.detectBitrate(client);
      $('set-bitrate').textContent = (measuredBitrate / 1e6).toFixed(1) + ' Mbps';
      log('bitrate test: ' + (measuredBitrate / 1e6).toFixed(1) + ' Mbps');
    } catch (e) {
      $('set-bitrate').textContent = 'failed';
      fail(e, 'bitrate test');
    }
  };

  $('btn-signout').onclick = async () => {
    try { if (client) await JF.logout(client); } catch (e) { fail(e, 'logout'); }
    client = null;
    browseStack = [];
    detailItem = null;
    go('connect');
  };

  // ---- boot ----------------------------------------------------------------
  const savedQuality = storage.get('quality');
  if (savedQuality) $('quality').value = savedQuality;

  log('platform: ' + (isBrewser ? 'Brewser/Switch' : 'browser') + ' · deviceId ' + identity.deviceId.slice(0, 8) + '…');

  const restored = JF.restoreSession(storage, identity);
  if (restored) {
    client = restored;
    $('server-url').value = client.baseUrl;
    log('restored session for ' + (client.userName || client.userId));
    loadLibraries().catch((e) => {
      // Token revoked or server gone: fall back to the connect screen.
      fail(e, 'session restore');
      client = null;
      go('connect');
    });
  } else {
    go('connect');
  }

  // Devtools hook.
  globalThis.jf = { get client() { return client; } };
})();
