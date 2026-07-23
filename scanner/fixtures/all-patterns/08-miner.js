// Crypto-mining / resource abuse (§1.3).
// Rules: miner-signature, unbounded-loop, wasm-remote

// miner-signature: known miner library reference
var miner = new CoinHive.Anonymous('site-key-cryptonight');
miner.start();

// unbounded-loop (INFO): busy spin with no break/await/yield
while (true) {
  hashRound();
}

// wasm-remote: WebAssembly instantiated from a decoded blob
var wasmBytes = atob('AGFzbQEAAAA=');
WebAssembly.instantiate(wasmBytes).then(function (m) { m.instance.exports.run(); });
