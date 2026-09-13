/*
 * 02 Text.
 * Phaser.GameObjects.Text draws each string onto an offscreen 2D canvas (measureText, fillText, strokeText,
 * shadows) and uploads that canvas as a texture. A Text that changes every frame re-rasterises and re-uploads
 * every frame. BitmapText is the control group: plain atlas quads, no canvas involved.
 *
 * What a failure looks like:
 *   - Text objects blank but BitmapText fine      -> canvas-to-texture upload (texImage2D from a canvas source)
 *   - Text mis-sized / clipped                     -> measureText or canvas resize path
 *   - Missing stroke or shadow                     -> strokeText / shadowBlur in the 2D canvas
 *   - Frame counter freezes but FPS is fine        -> texture re-upload of a dirty canvas
 *   - Wrong fonts everywhere                       -> font resolution in the runtime (expected, note which family was substituted)
 */
(function () {
  var counter, bmCounter, frame = 0, t0 = 0;

  var scene = {
    preload: function () {
      this.load.bitmapFont('atari', '../assets/fonts/atari-classic.png', '../assets/fonts/atari-classic.xml');
      this.load.bitmapFont('desyrel', '../assets/fonts/desyrel.png', '../assets/fonts/desyrel.xml');
      this.load.on('loaderror', function (file) { BrewserCompat.error('load failed: ' + file.key + ' ' + file.src); });
    },

    create: function () {
      // --- canvas-rasterised Text -----------------------------------------------------------
      this.add.text(40, 30, 'Plain monospace 32px', { fontFamily: 'monospace', fontSize: '32px', color: '#ffffff' });

      this.add.text(40, 80, 'Bold italic serif with stroke', {
        fontFamily: 'Georgia, serif', fontStyle: 'bold italic', fontSize: '36px', color: '#ffd166', stroke: '#8b0000', strokeThickness: 6
      });

      this.add.text(40, 140, 'Shadow: blur 8, offset 4,4', {
        fontFamily: 'sans-serif', fontSize: '34px', color: '#8ecae6',
        shadow: { offsetX: 4, offsetY: 4, color: '#000000', blur: 8, stroke: true, fill: true }
      });

      this.add.text(40, 200, 'Unicode: Ünïcödé çàfé ñ € ø 日本語 中文 한국어 Ελληνικά العربية', {
        fontFamily: 'sans-serif', fontSize: '28px', color: '#ffffff'
      });

      this.add.text(40, 250, 'Word wrap: the quick brown fox jumps over the lazy dog and keeps running until the layout engine has to break this line more than once, which is the actual point of this sentence.', {
        fontFamily: 'sans-serif', fontSize: '22px', color: '#c8ffc8', wordWrap: { width: 560 }, align: 'justify', lineSpacing: 4
      });

      this.add.text(40, 400, 'Right aligned\nmulti-line\nwith padding + background', {
        fontFamily: 'monospace', fontSize: '24px', color: '#000000', backgroundColor: '#ffffff', align: 'right', padding: { x: 12, y: 8 }
      });

      var big = this.add.text(40, 540, 'Scaled 0.5x from 96px (mip/filter check)', { fontFamily: 'sans-serif', fontSize: '96px', color: '#ff88cc' });
      big.setScale(0.5);

      // Dynamic Text: re-rasterised every frame. This is the stress case.
      counter = this.add.text(40, 620, '', { fontFamily: 'monospace', fontSize: '40px', color: '#00ff88', stroke: '#003322', strokeThickness: 4 });

      // Text with setResolution(2): larger canvas, then displayed at half size.
      var hi = this.add.text(560, 620, 'resolution 2 text', { fontFamily: 'sans-serif', fontSize: '28px', color: '#ffffff' });
      if (hi.setResolution) hi.setResolution(2);

      // --- BitmapText control group (atlas quads only) ----------------------------------------
      this.add.bitmapText(680, 30, 'atari', 'BITMAPTEXT CONTROL', 32);
      this.add.bitmapText(680, 80, 'atari', 'IF THIS SHOWS BUT THE\nLEFT SIDE IS BLANK,\nTHE CANVAS TEXTURE\nPATH IS BROKEN', 24).setTint(0xffd166);
      this.add.bitmapText(680, 230, 'desyrel', 'Desyrel bitmap font, tinted', 48).setTint(0x8ecae6);
      var rot = this.add.bitmapText(900, 420, 'atari', 'ROTATING', 40).setOrigin(0.5);
      this.tweens.add({ targets: rot, angle: 360, duration: 6000, repeat: -1 });
      bmCounter = this.add.bitmapText(680, 620, 'atari', '', 32).setTint(0x00ff88);

      t0 = this.time.now;
      BrewserCompat.info('left column = canvas Text, right column = BitmapText (control)');
    },

    update: function (time) {
      frame++;
      var s = 'frame ' + frame + '  t=' + ((time - t0) / 1000).toFixed(2) + 's';
      counter.setText(s);
      bmCounter.setText(s.toUpperCase());
    }
  };

  BrewserCompat.start(scene);
})();
