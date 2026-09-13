/*
 * 01 Platformer - baseline.
 * Exercises: image + spritesheet loading, static physics group, Arcade physics (gravity, collide, overlap),
 * spritesheet animation, Gamepad API input, world bounds, basic Text (score).
 * If this one fails, stop and diagnose before touching the others.
 */
(function () {
  var player, stars, bombs, platforms, scoreText, input;
  var score = 0, gameOver = false;

  var scene = {
    preload: function () {
      this.load.image('sky', '../assets/skies/sky4.png');
      this.load.image('ground', '../assets/sprites/platform.png');
      this.load.image('star', '../assets/sprites/star.png');
      this.load.image('bomb', '../assets/sprites/apple.png');
      this.load.spritesheet('dude', '../assets/sprites/dude.png', { frameWidth: 32, frameHeight: 48 });
      this.load.on('loaderror', function (file) { BrewserCompat.error('load failed: ' + file.key + ' ' + file.src); });
    },

    create: function () {
      this.add.image(640, 360, 'sky').setDisplaySize(1280, 720);

      platforms = this.physics.add.staticGroup();
      platforms.create(640, 700, 'ground').setScale(2.8, 1).refreshBody();
      platforms.create(1000, 480, 'ground').setScale(0.8, 1).refreshBody();
      platforms.create(150, 380, 'ground').setScale(0.8, 1).refreshBody();
      platforms.create(1100, 240, 'ground').setScale(0.8, 1).refreshBody();
      platforms.create(560, 300, 'ground').setScale(0.6, 1).refreshBody();

      player = this.physics.add.sprite(100, 550, 'dude');
      player.setBounce(0.2);
      player.setCollideWorldBounds(true);

      this.anims.create({ key: 'left', frames: this.anims.generateFrameNumbers('dude', { start: 0, end: 3 }), frameRate: 10, repeat: -1 });
      this.anims.create({ key: 'turn', frames: [{ key: 'dude', frame: 4 }], frameRate: 20 });
      this.anims.create({ key: 'right', frames: this.anims.generateFrameNumbers('dude', { start: 5, end: 8 }), frameRate: 10, repeat: -1 });

      stars = this.physics.add.group({ key: 'star', repeat: 14, setXY: { x: 60, y: 0, stepX: 82 }, setScale: { x: 0.35, y: 0.35 } });
      stars.getChildren().forEach(function (child) {
        child.setBounceY(Phaser.Math.FloatBetween(0.4, 0.8));
        child.body.setCircle(child.width * 0.4);
      });

      bombs = this.physics.add.group();

      scoreText = this.add.text(16, 16, 'Score: 0', { fontSize: '32px', fontFamily: 'monospace', color: '#ffffff', stroke: '#000000', strokeThickness: 4 });
      this.add.text(16, 690, 'Left stick / d-pad: move   A/B: jump   (keyboard: arrows + space)', { fontSize: '16px', fontFamily: 'monospace', color: '#ffffff' });

      this.physics.add.collider(player, platforms);
      this.physics.add.collider(stars, platforms);
      this.physics.add.collider(bombs, platforms);
      this.physics.add.overlap(player, stars, collectStar, null, this);
      this.physics.add.collider(player, bombs, hitBomb, null, this);

      input = BrewserCompat.makeInput(this);
      BrewserCompat.info('gamepad: ' + (this.input.gamepad && this.input.gamepad.total ? 'present' : 'none yet (press a button)'));
    },

    update: function () {
      if (gameOver) return;
      if (input.left()) { player.setVelocityX(-260); player.anims.play('left', true); }
      else if (input.right()) { player.setVelocityX(260); player.anims.play('right', true); }
      else { player.setVelocityX(0); player.anims.play('turn'); }
      if (input.jump() && player.body.touching.down) player.setVelocityY(-560);
    }
  };

  function collectStar(p, star) {
    star.disableBody(true, true);
    score += 10;
    scoreText.setText('Score: ' + score);
    if (stars.countActive(true) === 0) {
      stars.getChildren().forEach(function (c) { c.enableBody(true, c.x, 0, true, true); });
      var x = p.x < 640 ? Phaser.Math.Between(640, 1260) : Phaser.Math.Between(20, 640);
      var bomb = bombs.create(x, 16, 'bomb');
      bomb.setBounce(1).setCollideWorldBounds(true).setVelocity(Phaser.Math.Between(-200, 200), 20);
      bomb.body.allowGravity = false;
      bomb.setScale(0.6);
    }
  }

  function hitBomb(p) {
    this.physics.pause();
    p.setTint(0xff0000);
    p.anims.play('turn');
    gameOver = true;
    BrewserCompat.info('game over - reload to restart');
  }

  BrewserCompat.start(scene);
})();
