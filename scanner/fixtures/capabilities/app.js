// External-script capability detection: WebRTC (no network egress — no URL),
// Web NFC and the sensor / orientation APIs. Benign; the only security finding is
// the undeclared NFC peripheral (manifest declares no permission), which does not
// affect the capability slugs asserted by the regression suite.
const pc = new RTCPeerConnection();
const reader = new NDEFReader();
const accel = new Accelerometer({ frequency: 60 });
window.addEventListener('deviceorientation', function (e) { /* read tilt */ });
