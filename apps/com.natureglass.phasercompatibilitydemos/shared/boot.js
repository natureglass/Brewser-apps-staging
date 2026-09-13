/*
 * Shared bootstrap for the Brewser Phaser compatibility demos.
 *
 * Each HTML shell sets window.PHASER_VARIANT = { version: '3' | '4', renderer: 'webgl' | 'canvas' }
 * before loading Phaser and then the demo's game.js. Everything here is plain ES5-ish JS on purpose,
 * no modules, no build step, so it runs from a local folder with no server tricks.
 */
(function () {
  var variant = window.PHASER_VARIANT || { version: '3', renderer: 'webgl' };

  // ---------------------------------------------------------------------------
  // Diagnostics overlay (no devtools on the console, so everything goes on screen)
  // ---------------------------------------------------------------------------
  var overlay = document.createElement('div');
  overlay.id = 'bc-overlay';
  overlay.style.cssText =
    'position:fixed;left:0;top:0;z-index:9999;max-width:60vw;padding:6px 8px;' +
    'font:12px/1.35 monospace;color:#9f9;background:rgba(0,0,0,0.6);white-space:pre-wrap;pointer-events:none';
  var lines = { head: '', fps: '', info: '' };
  var errors = [];

  function render() {
    overlay.textContent = [lines.head, lines.fps, lines.info].filter(Boolean).join('\n') +
      (errors.length ? '\n' + errors.slice(-6).join('\n') : '');
  }

  function attach() {
    if (document.body && !overlay.parentNode) document.body.appendChild(overlay);
  }
  if (document.body) attach(); else document.addEventListener('DOMContentLoaded', attach);

  function logError(prefix, msg) {
    errors.push(prefix + ' ' + String(msg).slice(0, 200));
    overlay.style.color = '#f77';
    render();
  }

  window.addEventListener('error', function (e) {
    logError('ERR', (e.message || e.error) + (e.filename ? ' @' + e.filename.split('/').pop() + ':' + e.lineno : ''));
  });
  window.addEventListener('unhandledrejection', function (e) {
    logError('REJ', e.reason && e.reason.message ? e.reason.message : e.reason);
  });
  var origError = console.error;
  console.error = function () {
    logError('CON', Array.prototype.slice.call(arguments).join(' '));
    if (origError) origError.apply(console, arguments);
  };
  var origWarn = console.warn;
  console.warn = function () {
    var m = Array.prototype.slice.call(arguments).join(' ');
    // Phaser warns on missing gamepads/audio contexts etc. Those are findings too.
    errors.push('WRN ' + m.slice(0, 200));
    render();
    if (origWarn) origWarn.apply(console, arguments);
  };

  // FPS via rAF, independent of Phaser's own loop so it still reports if Phaser stalls.
  var frames = 0, last = (window.performance && performance.now) ? performance.now() : Date.now();
  function tick() {
    frames++;
    var now = (window.performance && performance.now) ? performance.now() : Date.now();
    if (now - last >= 1000) {
      lines.fps = 'rAF fps: ' + Math.round(frames * 1000 / (now - last)) +
        (window.__bcGame && window.__bcGame.loop ? '  phaser fps: ' + Math.round(window.__bcGame.loop.actualFps) : '');
      frames = 0; last = now; render();
    }
    window.requestAnimationFrame(tick);
  }
  window.requestAnimationFrame(tick);

  // ---------------------------------------------------------------------------
  // Config builder
  // ---------------------------------------------------------------------------
  function makeConfig(scenes, extra) {
    if (typeof Phaser === 'undefined') {
      logError('ERR', 'Phaser global missing: lib script did not load or threw during evaluation');
      return null;
    }
    var type = variant.renderer === 'canvas' ? Phaser.CANVAS : Phaser.WEBGL;
    var cfg = {
      type: type,
      parent: 'game',
      width: 1280,
      height: 720,
      backgroundColor: '#101820',
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      input: { gamepad: true },
      physics: { default: 'arcade', arcade: { gravity: { y: 900 }, debug: false } },
      scene: scenes
    };
    // Phaser's default image loading is XHR (responseType blob) -> URL.createObjectURL -> <img>.
    // Add ?imgtag=1 to the URL to fall back to a plain <img src="file.png"> load instead. If a demo only
    // works with ?imgtag=1, the finding is "XHR blob / createObjectURL / blob: URLs", not rendering.
    if (/[?&]imgtag=1/.test(window.location.search)) cfg.loader = { imageLoadType: 'HTMLImageElement' };
    if (extra) for (var k in extra) cfg[k] = extra[k];
    return cfg;
  }

  function start(scenes, extra) {
    var cfg = makeConfig(scenes, extra);
    if (!cfg) return null;
    var game;
    try {
      game = new Phaser.Game(cfg);
    } catch (e) {
      logError('BOOT', e && e.message ? e.message : e);
      throw e;
    }
    window.__bcGame = game;
    game.events.once('ready', function () {
      var r = game.renderer;
      var rname = r && r.type === Phaser.WEBGL ? 'WEBGL' : (r && r.type === Phaser.CANVAS ? 'CANVAS' : '?');
      var glver = '';
      try { if (r && r.gl) glver = ' ' + r.gl.getParameter(r.gl.VERSION); } catch (e) { glver = ' (gl.getParameter threw)'; }
      lines.head = 'Phaser ' + Phaser.VERSION + (cfg.loader ? ' [imgtag]' : '') + '  requested:' + variant.renderer.toUpperCase() + '  got:' + rname + glver;
      render();
    });
    return game;
  }

  // ---------------------------------------------------------------------------
  // Input helper: Joy-Con via Gamepad API + keyboard for desktop testing
  // ---------------------------------------------------------------------------
  function makeInput(scene) {
    var cursors = scene.input.keyboard ? scene.input.keyboard.createCursorKeys() : null;
    var space = scene.input.keyboard ? scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE) : null;
    var pad = null;
    var padName = 'none';
    var gp = scene.input.gamepad;
    if (gp) {
      if (gp.total > 0) pad = gp.getPad(0);
      gp.on('connected', function (p) { pad = p; padName = p.id || 'pad'; info('gamepad: ' + padName); });
      gp.on('disconnected', function () { pad = null; padName = 'none'; info('gamepad: none'); });
    }
    function axisX() {
      if (!pad) return 0;
      var x = 0;
      if (pad.leftStick) x = pad.leftStick.x;
      else if (pad.axes && pad.axes[0]) x = pad.axes[0].getValue();
      return Math.abs(x) > 0.25 ? x : 0;
    }
    return {
      get pad() { return pad; },
      left: function () { return (cursors && cursors.left.isDown) || (pad && pad.left) || axisX() < 0; },
      right: function () { return (cursors && cursors.right.isDown) || (pad && pad.right) || axisX() > 0; },
      up: function () { return (cursors && cursors.up.isDown) || (pad && pad.up); },
      down: function () { return (cursors && cursors.down.isDown) || (pad && pad.down); },
      jump: function () { return (cursors && cursors.up.isDown) || (space && space.isDown) || (pad && (pad.A || pad.B)); },
      action: function () { return (space && space.isDown) || (pad && (pad.X || pad.Y)); },
      justAction: function () {
        var k = space && Phaser.Input.Keyboard.JustDown(space);
        var b = pad && pad.buttons && pad.buttons[2] && pad.buttons[2].pressed && !pad.__xHeld;
        if (pad && pad.buttons && pad.buttons[2]) pad.__xHeld = pad.buttons[2].pressed;
        return !!(k || b);
      }
    };
  }

  function info(text) { lines.info = text; render(); }

  window.BrewserCompat = {
    variant: variant,
    start: start,
    makeInput: makeInput,
    info: info,
    error: function (m) { logError('APP', m); }
  };
})();
