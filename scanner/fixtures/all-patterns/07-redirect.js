// Redirection / clickjacking / phishing shell (§1.3).
// Rules: external-redirect, external-window-open
// (clickjacking-overlay + meta-refresh-external live in index.html.)

// external-redirect: sends the top window to an external origin
window.location.href = 'https://evil.example/phish';

// external-window-open (INFO)
window.open('https://evil.example/popup');
