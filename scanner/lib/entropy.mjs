// Shannon entropy helpers. Used for both per-string-literal scoring (packed
// payloads / embedded base64) and whole-file "minified beyond reason" scoring.

export function shannonEntropy(str) {
  if (!str || str.length === 0) return 0;
  const freq = new Map();
  for (const ch of str) freq.set(ch, (freq.get(ch) || 0) + 1);
  const len = str.length;
  let bits = 0;
  for (const count of freq.values()) {
    const p = count / len;
    bits -= p * Math.log2(p);
  }
  return bits;
}

// Byte-level entropy for binary blobs (0..8 bits/byte). A high value across a
// whole file is the classic "this is compressed/encrypted/packed" tell.
export function byteEntropy(buf) {
  if (!buf || buf.length === 0) return 0;
  const freq = new Uint32Array(256);
  for (let i = 0; i < buf.length; i++) freq[buf[i]]++;
  const len = buf.length;
  let bits = 0;
  for (let i = 0; i < 256; i++) {
    if (freq[i] === 0) continue;
    const p = freq[i] / len;
    bits -= p * Math.log2(p);
  }
  return bits;
}

// Fraction of characters that look like base64/hex alphabet — cheap corroborator
// so a natural-language string (which can also be ~4.3 bits) doesn't trip the
// packed-payload rule.
export function base64ishRatio(str) {
  if (!str) return 0;
  let n = 0;
  for (const ch of str) {
    if (/[A-Za-z0-9+/=_-]/.test(ch)) n++;
  }
  return n / str.length;
}
