let count = 0;

const status = document.querySelector("#status");
const counter = document.querySelector("#counter");
const result = document.querySelector("#result");
const testButton = document.querySelector("#testButton");
const resetButton = document.querySelector("#resetButton");

function render() {
  counter.textContent = `Contador: ${count}`;
}

testButton.addEventListener("click", () => {
  count += 1;
  result.textContent = "La interacción funciona correctamente.";
  render();
});

resetButton.addEventListener("click", () => {
  count = 0;
  result.textContent = "Estado reiniciado.";
  render();
});

window.addEventListener("error", (event) => {
  status.textContent = `Error JavaScript: ${event.message}`;
});

render();

const diagnostics = document.createElement("pre");
diagnostics.textContent = [
  `User agent: ${navigator.userAgent}`,
  `Viewport: ${window.innerWidth}x${window.innerHeight}`,
  `WebSocket: ${typeof WebSocket}`,
  `Fetch: ${typeof fetch}`,
  `localStorage: ${typeof localStorage}`,
].join("\n");

document.querySelector("#app").append(diagnostics);

const cssInfo = document.createElement("pre");
cssInfo.textContent = [
  `devicePixelRatio: ${window.devicePixelRatio}`,
  `innerWidth: ${window.innerWidth}`,
  `innerHeight: ${window.innerHeight}`,
  `outerWidth: ${window.outerWidth}`,
  `outerHeight: ${window.outerHeight}`,
  `Flexbox soportado: ${CSS.supports("display", "flex")}`,
  `Grid soportado: ${CSS.supports("display", "grid")}`,
  `Gap soportado: ${CSS.supports("gap", "16px")}`,
  `Border-radius soportado: ${CSS.supports("border-radius", "10px")}`,
].join("\n");

document.querySelector("#app").append(cssInfo);
