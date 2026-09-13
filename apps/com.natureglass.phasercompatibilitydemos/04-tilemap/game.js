/*
 * 04 Tilemap.
 * Exercises: JSON loading via XMLHttpRequest (the loader's text path, not an <img>), Tiled map parsing,
 * the static/dynamic tilemap layer render path (very different from the sprite batch), camera scrolling
 * with world bounds, tile-based collision, tile index callbacks (coin pickup removes the tile).
 * Map: tile-collision-test.json from the Phaser examples repo, 50x18 tiles of 32px = 1600x576 world.
 *
 * What a failure looks like:
 *   - Stuck on preload, no tiles              -> XHR / JSON loading (images load through Image, JSON does not)
 *   - Tiles drawn but seams/gaps between them -> texture filtering / half-pixel offset on the bridge
 *   - Player falls through the ground          -> Arcade tile collision (not a render issue)
 *   - Camera does not follow                   -> camera scroll matrix in the layer renderer
 *   - Collected coins do not disappear         -> layer redraw after tile removal (dirty flag / re-cull)
 */
(function () {
  var player, coins = 0, coinText, input, groundLayer, coinLayer;

  var scene = {
    preload: function () {
      this.load.tilemapTiledJSON('map', '../assets/tilemaps/tile-collision-test.json');
      this.load.image('tiles', '../assets/tilemaps/ground_1x1.png');
      this.load.image('coin', '../assets/sprites/coin.png');
      this.load.spritesheet('dude', '../assets/sprites/dude.png', { frameWidth: 32, frameHeight: 48 });
      this.load.on('loaderror', function (file) { BrewserCompat.error('load failed: ' + file.key + ' ' + file.src); });
    },

    create: function () {
      var map = this.make.tilemap({ key: 'map' });
      var groundTiles = map.addTilesetImage('ground_1x1', 'tiles');
      var coinTiles = map.addTilesetImage('coin', 'coin');

      map.createLayer('Background Layer', groundTiles, 0, 0);
      groundLayer = map.createLayer('Ground Layer', groundTiles, 0, 0);
      groundLayer.setCollisionBetween(1, 25);
      coinLayer = map.createLayer('Coin Layer', coinTiles, 0, 0);
      // coin tileset starts at gid 26; the map uses index 26 for the coin frame
      coinLayer.setTileIndexCallback([26, 27, 28, 29, 30, 31], collectCoin, this);

      this.physics.world.bounds.width = groundLayer.width;
      this.physics.world.bounds.height = groundLayer.height;

      player = this.physics.add.sprite(80, 400, 'dude');
      player.setBounce(0.1).setCollideWorldBounds(true);
      this.anims.create({ key: 'left', frames: this.anims.generateFrameNumbers('dude', { start: 0, end: 3 }), frameRate: 10, repeat: -1 });
      this.anims.create({ key: 'turn', frames: [{ key: 'dude', frame: 4 }], frameRate: 20 });
      this.anims.create({ key: 'right', frames: this.anims.generateFrameNumbers('dude', { start: 5, end: 8 }), frameRate: 10, repeat: -1 });

      this.physics.add.collider(player, groundLayer);
      this.physics.add.overlap(player, coinLayer);

      this.cameras.main.setBounds(0, 0, map.widthInPixels, map.heightInPixels);
      this.cameras.main.startFollow(player, true, 0.1, 0.1);
      this.cameras.main.setBackgroundColor('#4488cc');
      this.cameras.main.setZoom(1.25);

      coinText = this.add.text(16, 16, 'Coins: 0', { fontFamily: 'monospace', fontSize: '28px', color: '#ffffff', stroke: '#000', strokeThickness: 4 }).setScrollFactor(0);
      this.add.text(16, 690, 'Move with left stick / d-pad, jump with A/B. Run to the right edge to prove the camera scrolls.', { fontFamily: 'monospace', fontSize: '16px', color: '#ffffff' }).setScrollFactor(0);

      input = BrewserCompat.makeInput(this);
      BrewserCompat.info('map ' + map.width + 'x' + map.height + ' tiles, ' + map.widthInPixels + 'x' + map.heightInPixels + ' px');
    },

    update: function () {
      if (input.left()) { player.setVelocityX(-220); player.anims.play('left', true); }
      else if (input.right()) { player.setVelocityX(220); player.anims.play('right', true); }
      else { player.setVelocityX(0); player.anims.play('turn'); }
      if (input.jump() && player.body.blocked.down) player.setVelocityY(-520);
    }
  };

  function collectCoin(sprite, tile) {
    coinLayer.removeTileAt(tile.x, tile.y);
    coins++;
    coinText.setText('Coins: ' + coins);
    return false;
  }

  BrewserCompat.start(scene);
})();
