const log = document.querySelector("#log");
const testImg = document.querySelector("#testImg");

const SCALE_FACTOR = 2;

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

function playSpriteSheet(
  canvas,
  spriteSheetSrc,
  frameWidth,
  frameHeight,
  frameCount,
  columns,
  fps,
) {
  const ctx = canvas.getContext("2d");
  const img = new Image();

  img.onload = () => {
    canvas.width = frameWidth;
    canvas.height = frameHeight;
    // Sincroniza el tamaño de visualización con el tamaño real del buffer
    canvas.style.setProperty(
      "--sprite-width",
      `${frameWidth * SCALE_FACTOR}px`,
    );
    canvas.style.setProperty(
      "--sprite-height",
      `${frameHeight * SCALE_FACTOR}px`,
    );
    print("sprite", `Sprite sheet cargado: ${img.width}x${img.height}`);

    let currentFrame = 0;

    setInterval(() => {
      const col = currentFrame % columns;
      const row = Math.floor(currentFrame / columns);

      ctx.clearRect(0, 0, frameWidth, frameHeight);
      ctx.drawImage(
        img,
        col * frameWidth,
        row * frameHeight,
        frameWidth,
        frameHeight,
        0,
        0,
        frameWidth,
        frameHeight,
      );

      currentFrame = (currentFrame + 1) % frameCount;
    }, 1000 / fps);
  };

  img.onerror = () => {
    print("sprite", "ERROR al cargar el sprite sheet.");
  };

  img.src = spriteSheetSrc;
}

document.querySelector("#testSpriteSheet").addEventListener("click", () => {
  print("sprite", "Iniciando prueba de sprite sheet...");
  const canvas = document.querySelector("#spriteCanvas");

  // Sustituye estos valores por los datos reales de tu sprite sheet
  playSpriteSheet(
    canvas,
    "https://i.imgur.com/mYaXw75.png",
    60, // frameWidth
    60, // frameHeight
    33, // frameCount (el número real de frames extraídos)
    6, // columns (columnas reales del grid generado)
    25, // fps deseado
  );
});
