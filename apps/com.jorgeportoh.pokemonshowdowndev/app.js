const log = document.querySelector("#log");
const testImg = document.querySelector("#testImg");

function print(label, message) {
  const line = document.createElement("div");
  line.textContent = `[${label}] ${message}`;
  log.prepend(line);
}

document.querySelector("#testFetch").addEventListener("click", async () => {
  print("fetch", "Iniciando petición...");
  try {
    const response = await fetch(
      "https://play.pokemonshowdown.com/data/pokedex.json",
    );
    print("fetch", `Estado HTTP: ${response.status}`);
    const data = await response.json();
    const keys = Object.keys(data);
    print(
      "fetch",
      `OK. Recibidas ${keys.length} entradas. Ejemplo: ${keys[0]}`,
    );
  } catch (error) {
    print("fetch", `ERROR: ${error.message}`);
  }
});

document.querySelector("#testWs").addEventListener("click", () => {
  print("websocket", "Conectando a sim3.psim.us...");
  try {
    const socket = new WebSocket("wss://sim3.psim.us/showdown/websocket");

    socket.onopen = () => {
      print("websocket", "Conexión abierta correctamente.");
    };

    socket.onmessage = (event) => {
      const preview = String(event.data).slice(0, 120);
      print("websocket", `Mensaje recibido: ${preview}`);
    };

    socket.onerror = () => {
      print("websocket", "ERROR en la conexión.");
    };

    socket.onclose = (event) => {
      print("websocket", `Conexión cerrada. Código: ${event.code}`);
    };

    window.__psSocket = socket;
  } catch (error) {
    print("websocket", `ERROR al crear WebSocket: ${error.message}`);
  }
});

document.querySelector("#testStorage").addEventListener("click", () => {
  try {
    const key = "ps_brewser_test";
    const value = `guardado-${Date.now()}`;
    localStorage.setItem(key, value);
    const readBack = localStorage.getItem(key);
    print("storage", `Escrito: ${value} | Leído: ${readBack}`);
  } catch (error) {
    print("storage", `ERROR: ${error.message}`);
  }
});

document.querySelector("#testImage").addEventListener("click", () => {
  print("image", "Cargando sprite remoto...");
  testImg.style.display = "block";
  testImg.onload = () => print("image", "Imagen cargada correctamente.");
  testImg.onerror = () => print("image", "ERROR al cargar la imagen.");
  testImg.src = "https://play.pokemonshowdown.com/sprites/ani/pikachu.gif";
});

print("info", `WebSocket disponible: ${typeof WebSocket}`);
print("info", `fetch disponible: ${typeof fetch}`);
print("info", `localStorage disponible: ${typeof localStorage}`);
