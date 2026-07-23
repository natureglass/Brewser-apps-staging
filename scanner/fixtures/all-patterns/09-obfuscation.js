// Obfuscation & indirection (§1.4).
// Rules: string-array-obfuscation, charcode-reconstruction, computed-sink-name,
//        constructor-escape, global-bracket-sink, global-alias-sink

// string-array-obfuscation: obfuscator.io-style hex-escaped string array
var _0x = ['\x66\x65','\x74\x63\x68','\x65\x76','\x61\x6c','\x68\x74\x74','\x70\x73',
  '\x3a\x2f\x2f','\x65\x76\x69','\x6c','\x2e\x78','\x79\x7a','\x2f\x61','\x62\x63',
  '\x64\x65','\x66\x67','\x68\x69','\x6a\x6b','\x6c\x6d','\x6e\x6f','\x70\x71','\x72\x73'];

// charcode-reconstruction: rebuild a string from char codes
var name = String.fromCharCode(102, 101, 116, 99, 104, 101, 114, 33, 33, 33);

// computed-sink-name: sensitive global via a runtime-assembled name
var f = window['fe' + 'tch'];

// constructor-escape: [].constructor.constructor is Function
var runner = [].constructor.constructor('return this')();

// global-bracket-sink: fully dynamic global lookup, then invoked
var key = location.hash.slice(1);
window[key]('payload');

// global-alias-sink: alias a code-execution global to a local
var e = window.eval;
e('1+1');
