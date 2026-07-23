// Central rule catalogue. Every finding carries a `rule_id` from this table so
// the admin modal can group repeated hits and so severities stay consistent
// across analyzers. `base` is the severity a lone hit gets; combination
// escalation in score.mjs can push a finding higher at scan time (the finding
// stores its FINAL severity, but the base documents the intent).
import { INFO, SUSPICIOUS, DANGEROUS } from './severity.mjs';

export const RULES = {
  // --- Dynamic code construction (§1.3) ---------------------------------
  // eval / Function of a non-literal is SUSPICIOUS, not DANGEROUS: emscripten,
  // Unity, Cocos and other legit runtimes use them heavily, so a lone hit is a
  // "human, confirm this is the framework" signal — escalated by combination
  // (decode chain, exfil) into the DANGEROUS rules below.
  'eval-nonliteral':        { base: SUSPICIOUS, title: 'eval() of a non-literal value' },
  'eval-literal':           { base: INFO,       title: 'eval() of a literal string' },
  'function-constructor':   { base: SUSPICIOUS, title: 'Function() code construction from a non-literal' },
  'settimeout-string':      { base: SUSPICIOUS, title: 'setTimeout/setInterval called with a string (implicit eval)' },
  'dynamic-import-computed': { base: SUSPICIOUS, title: 'Dynamic import() with a computed specifier' },
  // `.innerHTML = someVar` is everywhere in normal DOM code — surfaced as INFO,
  // not verdict-moving on its own.
  'html-injection-sink':    { base: INFO,       title: 'DOM HTML sink assigned a non-literal value' },

  // --- Decode-then-execute (§1.3 / §1.4) --------------------------------
  'decode-exec':            { base: DANGEROUS,  title: 'Decoded data flows into a code-execution sink' },

  // --- Exfiltration surface (§1.3) --------------------------------------
  'external-egress':        { base: SUSPICIOUS, title: 'Network request to an off-package external origin' },
  'external-egress-assembled': { base: SUSPICIOUS, title: 'Network request to a runtime-assembled URL' },

  // --- Auth-token theft (§1.3, highest severity) ------------------------
  'auth-token-read':        { base: SUSPICIOUS, title: "Reads the shared session envelope localStorage['brewser_auth']" },
  'auth-exfil-dataflow':    { base: DANGEROUS,  title: 'Auth token / storage / cookie read transmitted off-device' },

  // --- Cross-namespace / storage abuse (§1.3) ---------------------------
  'cross-namespace-storage': { base: SUSPICIOUS, title: 'localStorage access outside the app namespace' },
  'indexeddb-enumeration':  { base: SUSPICIOUS, title: 'Enumerates IndexedDB databases' },
  'cookie-access':          { base: SUSPICIOUS, title: 'Reads or writes document.cookie' },

  // --- Peripheral-API misuse (Brewser-specific, §1.3 / §1.5) ------------
  'peripheral-undeclared':  { base: SUSPICIOUS, title: 'Uses a peripheral API not declared in the manifest' },
  'peripheral-silent-egress': { base: DANGEROUS, title: 'Silently accesses granted devices then egresses off-package' },

  // --- Redirection / clickjacking / phishing (§1.3) ---------------------
  'external-redirect':      { base: SUSPICIOUS, title: 'Redirects the top window to an external origin' },
  'external-window-open':   { base: INFO,       title: 'Opens an external origin in a new window' },
  'clickjacking-overlay':   { base: SUSPICIOUS, title: 'Full-viewport transparent / pointer-event overlay' },
  'meta-refresh-external':  { base: SUSPICIOUS, title: 'meta http-equiv=refresh to an external origin' },

  // --- Crypto-mining / resource abuse (§1.3) ----------------------------
  'miner-signature':        { base: DANGEROUS,  title: 'Known crypto-miner signature' },
  'unbounded-loop':         { base: INFO,       title: 'Unbounded loop with no yield/await/break' },
  'wasm-remote':            { base: SUSPICIOUS, title: 'WebAssembly instantiated from a remote / decoded source' },

  // --- Hidden: entropy / obfuscation (§1.4) -----------------------------
  // Lone high-entropy strings are usually embedded base64 assets (textures,
  // fonts, models) — INFO. A packed *payload* shows up alongside decode-exec /
  // string-array-obfuscation, which carry the weight.
  'high-entropy-string':    { base: INFO,       title: 'High-entropy string literal (possible packed payload)' },
  'high-entropy-file':      { base: INFO,       title: 'High-entropy / minified-beyond-reason file' },
  'string-array-obfuscation': { base: SUSPICIOUS, title: 'String-array rotation obfuscation pattern' },
  'charcode-reconstruction': { base: SUSPICIOUS, title: 'String.fromCharCode/charCodeAt identifier reconstruction' },
  'computed-sink-name':     { base: SUSPICIOUS, title: 'Dangerous global reached via a runtime-assembled name' },
  'constructor-escape':     { base: DANGEROUS,  title: '.constructor.constructor eval-escape chain' },
  'global-bracket-sink':    { base: SUSPICIOUS, title: 'Sink reached via computed window/self/globalThis access' },
  'global-alias-sink':      { base: SUSPICIOUS, title: 'Dangerous global aliased to a local then called' },

  // --- Hidden: time-bomb / conditional trigger (§1.4) -------------------
  'time-gated-code':        { base: SUSPICIOUS, title: 'Behaviour gated on a date/time comparison' },
  'host-gated-code':        { base: SUSPICIOUS, title: 'Behaviour gated on hostname / origin' },
  'platform-gated-code':    { base: SUSPICIOUS, title: 'Behaviour gated on userAgent / platform sniffing' },
  'random-gated-sink':      { base: SUSPICIOUS, title: 'Low-probability random-gated payload' },

  // --- Hidden: anti-analysis / evasion (§1.4) ---------------------------
  'devtools-detection':     { base: SUSPICIOUS, title: 'Anti-analysis / devtools detection' },
  'self-decoding-iife':     { base: SUSPICIOUS, title: 'Self-decoding IIFE (decodes then executes its own body)' },
  'reassembled-payload':    { base: DANGEROUS,  title: 'Fetched fragments concatenated then executed' },

  // --- Hidden: data smuggling in assets (§1.4) --------------------------
  'svg-active-content':     { base: SUSPICIOUS, title: 'Active content (script / on* handler) inside SVG' },
  'smuggled-payload-asset': { base: SUSPICIOUS, title: 'Base64/hex payload hidden in a non-code asset' },
  'trailing-data-image':    { base: SUSPICIOUS, title: 'Extra data after an image end marker' },
  'magic-byte-mismatch':    { base: DANGEROUS,  title: 'File content does not match its extension' },

  // --- Hidden: supply-chain (§1.4) --------------------------------------
  'bundled-node-modules':   { base: INFO,       title: 'Bundled node_modules / vendored dependencies' },
  'typosquat-cdn':          { base: SUSPICIOUS, title: 'Reference to a known-typosquat / malicious CDN path' },

  // --- CSS (§1.2) -------------------------------------------------------
  'css-external-url':       { base: INFO,       title: 'CSS url() / @import to an external origin' },

  // --- Manifest cross-reference (§1.5) ----------------------------------
  'declared-unused-peripheral': { base: INFO,   title: 'Peripheral declared in manifest but never used' },

  // --- Harness ----------------------------------------------------------
  'scan-error':             { base: SUSPICIOUS, title: 'The scanner failed to complete (fail-safe verdict)' },
  'file-parse-error':       { base: INFO,       title: 'A source file could not be parsed' },
  'findings-truncated':     { base: INFO,       title: 'Findings list truncated for size' },
};

export function ruleTitle(id) {
  return (RULES[id] && RULES[id].title) || id;
}

export function ruleBase(id) {
  return (RULES[id] && RULES[id].base) || SUSPICIOUS;
}
