// Static vocabularies used by the JS analyzer. Kept in one place so the rule
// catalogue can grow without hunting through the traversal code.

// Code-execution sinks: passing attacker-influenced or decoded data here runs it.
export const EXEC_SINKS = new Set(['eval', 'Function', 'execScript']);

// Network / egress sinks (by simple or member name). The analyzer maps calls
// and assignments onto these.
export const NETWORK_SINK_NAMES = new Set([
  'fetch', 'sendBeacon', 'WebSocket', 'EventSource', 'XMLHttpRequest',
]);

// Globals whose aliasing/computed-access we track (defeats window['fe'+'tch']).
export const SENSITIVE_GLOBALS = new Set([
  'eval', 'Function', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource',
  'importScripts', 'atob', 'setTimeout', 'setInterval',
]);

// Decode primitives whose output we taint (decode-then-execute / -exfil).
export const DECODE_FNS = new Set([
  'atob', 'decodeURIComponent', 'unescape', 'escape', 'fromCharCode',
]);

// navigator.<x> peripheral surfaces -> the manifest permission-token family we
// expect declared. The manifest has no VID/PID structure (flat permissions[]),
// so this is a family-name heuristic, not an exact match.
export const PERIPHERAL_APIS = {
  usb: { family: 'usb', silent: 'getDevices' },
  serial: { family: 'serial', silent: 'getPorts' },
  hid: { family: 'hid', silent: 'getDevices' },
  bluetooth: { family: 'bluetooth', silent: 'getDevices' },
};
// Web NFC is a bare constructor, not a navigator.* member.
export const NFC_CTOR = 'NDEFReader';

// Known crypto-miner signature fragments (extensible blocklist).
export const MINER_SIGNATURES = [
  'coinhive', 'coin-hive', 'cryptonight', 'cryptonoter', 'jsecoin',
  'webminepool', 'deepminer', 'minero.cc', 'coinimp', 'crypto-loot',
  'cryptoloot', 'authedmine', 'wasmminer', 'monerominer',
];

// Small extensible typosquat / known-bad CDN path blocklist.
export const TYPOSQUAT_CDN = [
  'jqeury', 'jquerry', 'jquery.min.js.map.evil', 'cdn-cgi/challenge',
  'reactt', 'anguler', 'lodahs', 'boootstrap',
];

export function isPeripheralNavProp(name) {
  return Object.prototype.hasOwnProperty.call(PERIPHERAL_APIS, name);
}
