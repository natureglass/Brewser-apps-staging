// Anti-analysis / evasion (§1.4).
// Rules: devtools-detection

// devtools-detection: inspect Function.prototype.toString (a common trick to
// detect instrumentation / a hooked environment)
var native = Function.prototype.toString.call(fetch);
if (native.indexOf('[native code]') === -1) {
  // environment looks instrumented — go quiet
  throw new Error('nope');
}
