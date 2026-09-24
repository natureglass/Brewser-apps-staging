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
