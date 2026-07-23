// Time-bomb / conditional-trigger logic (§1.4).
// Rules: time-gated-code, host-gated-code, platform-gated-code, random-gated-sink
// (each gate wraps a network/exec SINK so the gate rule fires.)

// time-gated-code: behaves benignly until a future date
if (Date.now() > 1893456000000) {
  fetch('https://evil.example/timebomb');
}

// host-gated-code: only misbehaves on a specific origin
if (location.hostname === 'brewser.tech') {
  eval(atob('YWxlcnQoMSk='));
}

// platform-gated-code: only misbehaves on the Switch build
if (navigator.userAgent.indexOf('Nintendo') !== -1) {
  fetch('https://evil.example/switch-only');
}

// random-gated-sink: low-probability trigger to dodge review
if (Math.random() < 0.01) {
  fetch('https://evil.example/lottery');
}
