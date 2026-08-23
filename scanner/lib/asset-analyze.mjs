// Binary / unknown-asset analyzer: magic-byte vs extension mismatch, trailing
// data after image end markers (stego-ish), and high-entropy blobs that could
// smuggle a payload. Also handles JSON files for embedded-URL / high-entropy
// signals (the manifest itself is handled separately).
import { makeFinding } from './finding.mjs';
import { INFO, SUSPICIOUS, DANGEROUS } from './severity.mjs';
import { byteEntropy, shannonEntropy, base64ishRatio } from './entropy.mjs';

// Extension -> [expected leading byte signatures]. Each signature is a byte
// array; a match means the first bytes equal it.
const MAGIC = {
  '.png': [[0x89, 0x50, 0x4e, 0x47]],
  '.gif': [[0x47, 0x49, 0x46, 0x38]],
  '.jpg': [[0xff, 0xd8, 0xff]],
  '.jpeg': [[0xff, 0xd8, 0xff]],
  '.webp': [[0x52, 0x49, 0x46, 0x46]], // RIFF (….WEBP)
  '.bmp': [[0x42, 0x4d]],
  '.pdf': [[0x25, 0x50, 0x44, 0x46]],
  '.wasm': [[0x00, 0x61, 0x73, 0x6d]],
  '.ico': [[0x00, 0x00, 0x01, 0x00]],
  '.woff': [[0x77, 0x4f, 0x46, 0x46]],
  '.woff2': [[0x77, 0x4f, 0x46, 0x32]],
  '.ttf': [[0x00, 0x01, 0x00, 0x00], [0x74, 0x72, 0x75, 0x65]],
  '.zip': [[0x50, 0x4b, 0x03, 0x04]],
  // '.mp3' is intentionally absent — MP3 has too many valid leading signatures
  // to enumerate as fixed prefixes (ID3 tag, or an MPEG-1/2/2.5 Layer I/II/III
  // frame sync, with/without CRC). It is checked via isMp3Signature() below.
  '.mp4': [], // box-based, ftyp at offset 4 — skip strict check
  '.ogg': [[0x4f, 0x67, 0x67, 0x53]],
  '.wav': [[0x52, 0x49, 0x46, 0x46]],
};

// Byte patterns that indicate executable/script/archive content masquerading
// as something else.
const SUSPECT_CONTENT = [
  { sig: [0x4d, 0x5a], what: 'a Windows PE executable (MZ)' },
  { sig: [0x50, 0x4b, 0x03, 0x04], what: 'a zip archive (PK)' },
  { sig: [0x7f, 0x45, 0x4c, 0x46], what: 'an ELF executable' },
];

function startsWith(buf, sig) {
  if (buf.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (buf[i] !== sig[i]) return false;
  return true;
}

// MP3 signature check. An MP3 is either ID3v2-tagged ("ID3" at offset 0) or
// begins directly with an MPEG-audio frame. The frame sync is 11 bits — the
// whole first byte (0xFF) plus the top 3 bits of the second byte — so a fixed
// prefix like FF FB only matches MPEG-1 and misses legitimate MPEG-2 (FF F3 /
// FF F2) and MPEG-2.5 (FF E3 / FF E2) files. Check the sync by bitmask and
// reject only the reserved version/layer encodings, which never appear in a
// real frame. Non-0xFF payloads (MZ/ELF/PK/scripts) still fail and escalate.
function isMp3Signature(buf) {
  if (buf.length >= 3 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return true; // "ID3"
  if (buf.length < 2) return false;
  if (buf[0] !== 0xff || (buf[1] & 0xe0) !== 0xe0) return false; // 11-bit frame sync
  const version = (buf[1] >> 3) & 0x03; // 01 = reserved
  const layer = (buf[1] >> 1) & 0x03;   // 00 = reserved
  return version !== 0b01 && layer !== 0b00;
}

function looksLikeScript(buf) {
  const head = buf.slice(0, 256).toString('utf8');
  return /<script|function\s*\(|=>|eval\(|document\.|window\.|var\s+\w+\s*=/.test(head);
}

export function analyzeAsset(fileObj, ctx) {
  const findings = [];
  const { rel: file, ext, buffer } = fileObj;
  const add = (f) => findings.push(makeFinding(f));

  // 1. Magic-byte vs extension mismatch.
  const expected = MAGIC[ext];
  const hasMagicCheck = ext === '.mp3' || (expected && expected.length > 0);
  if (hasMagicCheck) {
    const ok = ext === '.mp3'
      ? isMp3Signature(buffer)
      : expected.some((sig) => startsWith(buffer, sig));
    if (!ok) {
      // Only escalate to DANGEROUS if the real content is executable/archive/script.
      const suspect = SUSPECT_CONTENT.find((s) => startsWith(buffer, s.sig));
      if (suspect || looksLikeScript(buffer)) {
        add({ rule_id: 'magic-byte-mismatch', severity: DANGEROUS, file, line: 0,
          detail: 'File claims ' + ext + ' but its bytes are ' + (suspect ? suspect.what : 'script/text content') + ' — a smuggled payload.',
          evidence: buffer.slice(0, 24).toString('hex') });
      } else {
        add({ rule_id: 'magic-byte-mismatch', severity: SUSPICIOUS, file, line: 0,
          detail: 'File extension ' + ext + ' does not match its content signature.',
          evidence: buffer.slice(0, 24).toString('hex') });
      }
    }
  }

  // 2. Trailing data after an image end marker (best-effort stego check).
  if (ext === '.png') {
    const iend = buffer.indexOf(Buffer.from([0x49, 0x45, 0x4e, 0x44])); // "IEND"
    if (iend >= 0) {
      const endOfImage = iend + 8; // IEND + 4-byte CRC
      const trailing = buffer.length - endOfImage;
      if (trailing > 64) {
        add({ rule_id: 'trailing-data-image', severity: SUSPICIOUS, file, line: 0,
          detail: trailing + ' bytes follow the PNG IEND marker — possible appended payload.',
          evidence: buffer.slice(endOfImage, endOfImage + 24).toString('hex') });
      }
    }
  } else if (ext === '.jpg' || ext === '.jpeg') {
    const eoi = buffer.lastIndexOf(Buffer.from([0xff, 0xd9]));
    if (eoi >= 0 && buffer.length - (eoi + 2) > 64) {
      const trailing = buffer.length - (eoi + 2);
      add({ rule_id: 'trailing-data-image', severity: SUSPICIOUS, file, line: 0,
        detail: trailing + ' bytes follow the JPEG EOI marker — possible appended payload.',
        evidence: buffer.slice(eoi + 2, eoi + 26).toString('hex') });
    }
  }

  // 3. High-entropy blob in a non-media, non-compressed unknown file. Media &
  // already-compressed formats are legitimately high-entropy, so exclude them.
  const COMPRESSED = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.woff', '.woff2', '.mp3', '.mp4', '.ogg', '.wav', '.zip', '.gz', '.br', '.wasm', '.bin', '.ico', '.pdf', '.ttf', '.otf', '.eot', '.data', '.unity3d', '.assets', '.bundle', '.mov', '.webm', '.m4a', '.aac', '.flac']);
  if (!COMPRESSED.has(ext) && buffer.length > 4096) {
    // Sample the first 2 MB for large files — byte-entropy of a representative
    // slice is enough to flag a packed blob, and it keeps a 100+ MB asset from
    // costing a full-buffer byte loop.
    const ENTROPY_SAMPLE = 2 * 1024 * 1024;
    const ent = byteEntropy(buffer.length > ENTROPY_SAMPLE ? buffer.subarray(0, ENTROPY_SAMPLE) : buffer);
    if (ent > 7.2) {
      add({ rule_id: 'high-entropy-file', severity: INFO, file, line: 0,
        detail: 'High byte-entropy (' + ent.toFixed(2) + '/8) in a ' + (ext || 'no-extension') + ' file — could be a packed/encrypted blob.',
        evidence: buffer.slice(0, 24).toString('hex') });
    }
  }

  return findings;
}

// JSON assets (not the manifest): embedded base64 payloads.
export function analyzeJsonAsset(text, file) {
  const findings = [];
  // Look for long base64-ish string values.
  const strRe = /"((?:[A-Za-z0-9+/]{80,}={0,2}))"/g;
  let m, count = 0, largest = 0, sample = '';
  while ((m = strRe.exec(text)) !== null) {
    const v = m[1];
    if (shannonEntropy(v) > 4.3 && base64ishRatio(v) > 0.9) {
      count++;
      if (v.length > largest) { largest = v.length; sample = v; }
    }
  }
  if (count > 0) {
    findings.push(makeFinding({ rule_id: 'smuggled-payload-asset', severity: SUSPICIOUS, file, line: 0,
      detail: count + ' long base64-like string(s) embedded in JSON (largest ' + largest + ' chars) — possible hidden payload.',
      evidence: sample }));
  }
  return findings;
}
