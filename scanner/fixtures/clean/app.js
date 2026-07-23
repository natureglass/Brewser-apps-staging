// A perfectly ordinary Brewser app: canvas rendering, own-namespace storage,
// and one fetch to a manifest-declared allowed origin. Nothing here should trip
// the scanner.
const canvas = document.getElementById('c');
const gl = canvas.getContext('webgl2');

function loadSettings() {
  const raw = localStorage.getItem('com.test.clean.settings');
  return raw ? JSON.parse(raw) : { theme: 'dark' };
}

function saveSettings(s) {
  localStorage.setItem('com.test.clean.settings', JSON.stringify(s));
}

async function refresh() {
  const res = await fetch('https://api.example.com/scores');
  const data = await res.json();
  render(data);
}

function render(data) {
  const ctx2d = canvas.getContext('2d');
  ctx2d.clearRect(0, 0, canvas.width, canvas.height);
  ctx2d.fillText(String(data.length || 0), 10, 20);
}

document.getElementById('save').addEventListener('click', () => {
  saveSettings(loadSettings());
});

refresh();
