/*
 * 03 Particles.
 * Exercises: the sprite batch (streaming vertex buffers, many quads per draw call), blend mode switching
 * between ADD and NORMAL, per-particle tint, alpha and scale interpolation, and raw throughput on Tegra X1.
 * Textures are procedurally generated (assets/particles/glow.png, spark.png) so licensing is clean.
 *
 * Press X (or space) to add another 1000-particle burst emitter; keep pressing until fps drops.
 * The overlay shows the alive particle count so you get a number, not a feeling.
 *
 * What a failure looks like:
 *   - Hard-edged squares instead of soft glows   -> alpha texture / premultiply issue
 *   - ADD emitter looks the same as NORMAL        -> blendFunc not applied per batch flush
 *   - Colours wrong on the tinted emitter         -> tint attribute packing / byte order
 *   - Frame rate collapse well below 10k particles -> buffer upload (bufferSubData) cost on the bridge
 */
(function () {
  var emitters = [];
  var input, scene;

  function aliveCount() {
    var n = 0;
    for (var i = 0; i < emitters.length; i++) n += emitters[i].getAliveParticleCount ? emitters[i].getAliveParticleCount() : 0;
    return n;
  }

  function addBurst(s) {
    var e = s.add.particles(Phaser.Math.Between(200, 1080), Phaser.Math.Between(150, 570), 'spark', {
      speed: { min: 50, max: 400 },
      angle: { min: 0, max: 360 },
      scale: { start: 1.2, end: 0 },
      alpha: { start: 1, end: 0 },
      lifespan: 2500,
      quantity: 20,
      frequency: 50,
      maxAliveParticles: 1000,
      tint: [0xff3355, 0xffaa22, 0x22ddff, 0x88ff44],
      blendMode: 'ADD'
    });
    emitters.push(e);
  }

  scene = {
    preload: function () {
      this.load.image('glow', '../assets/particles/glow.png');
      this.load.image('spark', '../assets/particles/spark.png');
      this.load.image('space', '../assets/skies/space3.png');
      this.load.on('loaderror', function (file) { BrewserCompat.error('load failed: ' + file.key + ' ' + file.src); });
    },

    create: function () {
      this.add.image(640, 360, 'space').setDisplaySize(1280, 720).setAlpha(0.6);

      // 1. Additive fountain with gravity
      emitters.push(this.add.particles(320, 640, 'glow', {
        speed: { min: 300, max: 600 },
        angle: { min: 250, max: 290 },
        gravityY: 900,
        scale: { start: 0.9, end: 0.1 },
        alpha: { start: 1, end: 0 },
        lifespan: 2200,
        frequency: 8,
        quantity: 3,
        tint: [0x44aaff, 0xffffff, 0x88ddff],
        blendMode: 'ADD'
      }));

      // 2. Same fountain, NORMAL blend, warm tint: visual A/B for blend modes
      emitters.push(this.add.particles(960, 640, 'glow', {
        speed: { min: 300, max: 600 },
        angle: { min: 250, max: 290 },
        gravityY: 900,
        scale: { start: 0.9, end: 0.1 },
        alpha: { start: 1, end: 0 },
        lifespan: 2200,
        frequency: 8,
        quantity: 3,
        tint: [0xff6a00, 0xffcc33, 0xff2266],
        blendMode: 'NORMAL'
      }));

      // 3. Ring emitter following a circular path, rapid tint cycling
      var ring = this.add.particles(640, 300, 'spark', {
        speed: 60,
        scale: { start: 0.8, end: 0 },
        lifespan: 1200,
        frequency: 4,
        quantity: 4,
        tint: { onEmit: function (p) { return Phaser.Display.Color.HSLToColor((p.life / 1200 + Math.random()) % 1, 1, 0.6).color; } },
        blendMode: 'ADD'
      });
      emitters.push(ring);
      var t = 0;
      this.events.on('update', function (time, delta) {
        t += delta * 0.001;
        ring.setPosition(640 + Math.cos(t * 1.5) * 260, 300 + Math.sin(t * 2.3) * 150);
      });

      this.add.text(16, 690, 'X / space: add a 1000-particle burst   left=ADD blend   right=NORMAL blend', { fontFamily: 'monospace', fontSize: '16px', color: '#ffffff' });
      input = BrewserCompat.makeInput(this);
    },

    update: function () {
      if (input.justAction()) addBurst(this);
      BrewserCompat.info('emitters: ' + emitters.length + '  alive particles: ' + aliveCount());
    }
  };

  BrewserCompat.start(scene, { physics: undefined });
})();
