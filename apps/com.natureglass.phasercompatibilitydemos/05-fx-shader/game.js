/*
 * 05 FX + Shader.
 * Exercises: render-to-texture through framebuffers (bloom/glow/blur pipelines), a user-supplied GLSL
 * fragment shader on a quad, and the Graphics object (CPU tessellated fills/strokes, curves, rounded rects).
 * This is the closest Phaser gets to the Three.js bloom teardown issue: multiple FBO passes per frame,
 * framebuffer switching, and texture re-binding.
 *
 * Phaser 3 and 4 differ here, so the code branches on Phaser.VERSION:
 *   3.x: sprite.postFX.addBloom(), sprite.preFX.addBlur(), this.add.shader(new Phaser.Display.BaseShader(...))
 *   4.x: sprite.enableFilters(); sprite.filters.external.addGlow(); filters.internal.addBlur();
 *        this.add.shader({ fragmentSource, setupUniforms })
 *
 * WebGL only. The canvas shells for this demo will boot but the shader quad and FX are skipped by Phaser.
 *
 * What a failure looks like:
 *   - Logo visible but no glow/bloom halo         -> FBO pass ran but result not composited (framebuffer bind / blit)
 *   - Logo disappears entirely when FX is on      -> render target creation (texImage2D null / framebufferTexture2D)
 *   - Plasma quad is black                        -> shader compile/link or uniform upload (check overlay for GL errors)
 *   - Everything renders once then freezes        -> FBO restore after pass (this is the teardown-shaped bug)
 *   - Graphics shapes have holes/ragged edges     -> vertex buffer for TRIANGLES path (not FBO related)
 */
(function () {
  var isV4 = typeof Phaser !== 'undefined' && String(Phaser.VERSION).charAt(0) === '4';

  var plasmaFrag = [
    'precision mediump float;',
    'uniform float time;',
    'varying vec2 outTexCoord;',
    'void main () {',
    '  vec2 p = outTexCoord * 6.0;',
    '  float v = sin(p.x + time) + sin(p.y + time * 0.7) + sin((p.x + p.y) * 0.5 + time * 1.3)',
    '          + sin(length(p - vec2(3.0)) * 1.5 - time);',
    '  vec3 c = 0.5 + 0.5 * cos(vec3(0.0, 2.1, 4.2) + v * 1.5);',
    '  gl_FragColor = vec4(c, 1.0);',
    '}'
  ].join('\n');

  var scene = {
    preload: function () {
      this.load.image('logo', '../assets/sprites/phaser3-logo.png');
      this.load.image('apple', '../assets/sprites/apple.png');
      this.load.image('star', '../assets/sprites/star.png');
      this.load.on('loaderror', function (file) { BrewserCompat.error('load failed: ' + file.key + ' ' + file.src); });
    },

    create: function () {
      var isWebGL = this.sys.game.renderer.type === Phaser.WEBGL;
      var s = this;

      // --- 1. Custom fragment shader on a quad ---------------------------------------------
      if (isWebGL) {
        try {
          if (isV4) {
            this.add.shader({
              name: 'plasma',
              fragmentSource: plasmaFrag,
              setupUniforms: function (setUniform) { setUniform('time', s.game.loop.getDuration()); }
            }, 320, 200, 560, 340);
          } else {
            var base = new Phaser.Display.BaseShader('plasma', plasmaFrag);
            this.add.shader(base, 320, 200, 560, 340);
          }
        } catch (e) { BrewserCompat.error('shader create: ' + e.message); }
      } else {
        this.add.text(60, 60, 'Canvas renderer: shader + FX skipped by design', { fontFamily: 'monospace', fontSize: '20px', color: '#ffaa00' });
      }

      // --- 2. FX pipelines (framebuffer passes) --------------------------------------------
      var logo = this.add.image(920, 200, 'logo');
      var apple = this.add.image(920, 420, 'apple').setScale(2);
      var star = this.add.image(1120, 420, 'star');

      if (isWebGL) {
        try {
          if (isV4) {
            logo.enableFilters();
            logo.filters.external.addGlow(0xffee88, 12, 0, 1.5);
            apple.enableFilters();
            apple.filters.internal.addBlur(1, 2, 2, 1);
            star.enableFilters();
            star.filters.external.addGlow(0x66ccff, 8, 2, 1);
          } else {
            logo.postFX.addBloom(0xffffff, 1, 1, 1.2, 1.6, 4);
            apple.preFX.addBlur(1, 2, 2, 1);
            star.postFX.addGlow(0x66ccff, 8, 0, false, 0.1, 24);
          }
        } catch (e) { BrewserCompat.error('fx create: ' + e.message); }
      }
      this.tweens.add({ targets: logo, scale: 1.15, yoyo: true, repeat: -1, duration: 1200, ease: 'Sine.easeInOut' });
      this.tweens.add({ targets: apple, angle: 360, repeat: -1, duration: 3000 });
      this.tweens.add({ targets: star, y: 480, yoyo: true, repeat: -1, duration: 900, ease: 'Sine.easeInOut' });

      // --- 3. Graphics tessellation (works on both renderers) -----------------------------
      var g = this.add.graphics();
      g.fillStyle(0x2a9d8f, 1);
      g.fillRoundedRect(40, 420, 200, 120, 24);
      g.lineStyle(6, 0xe9c46a, 1);
      g.strokeRoundedRect(40, 420, 200, 120, 24);
      g.fillStyle(0xe76f51, 1);
      g.fillCircle(340, 480, 50);
      g.lineStyle(4, 0xffffff, 1);
      g.strokeCircle(340, 480, 50);
      g.fillStyle(0xf4a261, 1);
      g.slice(480, 480, 60, Phaser.Math.DegToRad(30), Phaser.Math.DegToRad(300), false);
      g.fillPath();
      g.lineStyle(8, 0x8ecae6, 1);
      g.beginPath();
      for (var i = 0; i <= 40; i++) {
        var x = 40 + i * 14, y = 620 + Math.sin(i * 0.45) * 30;
        if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
      }
      g.strokePath();
      g.fillStyle(0xffffff, 0.8);
      g.fillTriangle(660, 620, 720, 520, 780, 620);

      // A rotating Graphics object: re-tessellated only once; transform each frame.
      var spinner = this.add.graphics({ x: 1120, y: 600 });
      for (var k = 0; k < 8; k++) {
        spinner.fillStyle(Phaser.Display.Color.HSLToColor(k / 8, 0.9, 0.55).color, 1);
        spinner.slice(0, 0, 70, Phaser.Math.DegToRad(k * 45), Phaser.Math.DegToRad(k * 45 + 40), false);
        spinner.fillPath();
      }
      this.tweens.add({ targets: spinner, angle: 360, repeat: -1, duration: 4000 });

      this.add.text(16, 690, (isV4 ? 'Phaser 4 filters (glow/blur) + shader config' : 'Phaser 3 postFX bloom/glow + preFX blur + BaseShader') +
        '   Graphics on the left/bottom is tessellated geometry', { fontFamily: 'monospace', fontSize: '16px', color: '#ffffff' });
      BrewserCompat.info(isWebGL ? 'FBO passes per frame: 3 objects with FX + 1 shader quad' : 'canvas renderer');
    }
  };

  BrewserCompat.start(scene, { physics: undefined });
})();
