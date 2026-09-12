// Realtime-relay app-identity abuse. This package is com.natureglass.sectest.

// ws-app-impersonation: hardcoded claim on ANOTHER app's namespace. Joining
// grants read/write of that app's room messages and shared state.
const victim = new WebSocket('wss://ws.brewser.io/?app=com.natureglass.streamcast&room=lobby');

// Same, resolved through a one-hop binding.
const stolen = 'wss://ws.brewser.io/?app=com.someoneelse.game&room=lobby';
const victim2 = new WebSocket(stolen);

// ws-app-computed: relay URL assembled at runtime with the app id unpinned.
const target = window.pickTarget();
const sneaky = new WebSocket('wss://ws.brewser.io/?app=' + target + '&room=lobby');

// NOT flagged — the app's own namespace, literal and assembled. Present so a
// regression that flags legitimate usage fails the suite here first.
const mine = new WebSocket('wss://ws.brewser.io/?app=com.natureglass.sectest&room=lobby');
const mineDynamic = new WebSocket(
  'wss://ws.brewser.io/?app=com.natureglass.sectest&room=' + Math.random(),
);

export { victim, victim2, sneaky, mine, mineDynamic };
