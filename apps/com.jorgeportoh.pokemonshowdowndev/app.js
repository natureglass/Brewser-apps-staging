const SERVER_URL = "wss://sim3.psim.us/showdown/websocket";

const status = document.querySelector("#status");
const log = document.querySelector("#log");
const lobby = document.querySelector("#lobby");
const userInfo = document.querySelector("#userInfo");
const chatLog = document.querySelector("#chatLog");
const chatText = document.querySelector("#chatText");

let socket = null;
let guestUsername = null;

function print(label, message) {
  const line = document.createElement("div");
  line.textContent = `[${label}] ${message}`;
  log.prepend(line);
}

function setStatus(text) {
  status.textContent = text;
}

function addChatLine(text) {
  const line = document.createElement("div");
  line.textContent = text;
  chatLog.append(line);
}

function connect() {
  setStatus("Conectando...");
  socket = new WebSocket(SERVER_URL);

  socket.onopen = () => {
    setStatus("Conectado. Esperando challstr...");
    print("ws", "Conexión abierta.");
  };

  socket.onmessage = (event) => {
    handleServerMessage(event.data);
  };

  socket.onerror = () => {
    print("ws", "ERROR de conexión.");
    setStatus("Error de conexión");
  };

  socket.onclose = (evt) => {
    print("ws", `Conexión cerrada. Código: ${evt.code}`);
    setStatus("Desconectado");
    lobby.hidden = true;
  };
}

function disconnect() {
  if (socket) {
    socket.close();
    socket = null;
  }
}

function send(roomId, text) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    print("send", "No hay conexión activa.");
    return;
  }
  const payload = `${roomId}|${text}`;
  socket.send(payload);
  print("send", payload);
}

// El servidor puede enviar varios bloques ">ROOMID\n...." separados por saltos de línea
function handleServerMessage(raw) {
  const blocks = splitIntoRoomBlocks(raw);

  for (const block of blocks) {
    for (const line of block.lines) {
      handleRoomLine(block.roomId, line);
    }
  }
}

function splitIntoRoomBlocks(raw) {
  const lines = raw.split("\n");
  const blocks = [];
  let currentRoom = "lobby";
  let currentLines = [];

  for (const line of lines) {
    if (line.startsWith(">")) {
      if (currentLines.length > 0) {
        blocks.push({ roomId: currentRoom, lines: currentLines });
      }
      currentRoom = line.slice(1).trim() || "lobby";
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.length > 0) {
    blocks.push({ roomId: currentRoom, lines: currentLines });
  }

  return blocks;
}

function handleRoomLine(roomId, line) {
  if (line.length === 0) return;

  if (!line.startsWith("|")) {
    addChatLine(line);
    return;
  }

  const parts = line.split("|");
  const type = parts[1];
  let joinedLobby = false;

  switch (type) {
    case "challstr": {
      const challstr = parts.slice(2).join("|");
      print("protocol", "Recibido challstr. Entrando como invitado...");
      loginAsGuest();
      break;
    }

    case "updateuser": {
      const user = parts[2];
      const named = parts[3];
      print("protocol", `updateuser: ${user} (named=${named})`);
      guestUsername = user;
      userInfo.textContent = `Conectado como: ${user}`;
      lobby.hidden = false;
      setStatus("Conectado y logueado");

      // Unirse explícitamente a la sala lobby para poder chatear ahí
      send("", "/join lobby");
      break;
    }

    case "init": {
      const roomType = parts[2];
      if (roomId === "lobby") {
        joinedLobby = true;
      }
      print("protocol", `Sala inicializada: ${roomId} (tipo: ${roomType})`);
      addChatLine(`--- Te has unido a ${roomId} ---`);
      break;
    }

    case "c:":
    case "chat": {
      const user = parts[3];
      const message = parts.slice(4).join("|");
      addChatLine(`${user}: ${message}`);
      chatLog.scrollTop = chatLog.scrollHeight;
      break;
    }

    case "j":
    case "join": {
      addChatLine(`${parts[2]} se ha unido.`);
      break;
    }

    case "l":
    case "leave": {
      addChatLine(`${parts[2]} se ha ido.`);
      break;
    }

    case "users": {
      print("protocol", `Usuarios en sala: ${parts[2]}`);
      break;
    }

    case "usercount": {
      print("protocol", `Usuarios en el servidor: ${parts[2]}`);
      break;
    }

    case "formats": {
      print("protocol", "Lista de formatos recibida.");
      break;
    }

    case "popup": {
      print("protocol", `Popup del servidor: ${parts.slice(2).join("|")}`);
      break;
    }

    default: {
      print("protocol", `[${type}] ${parts.slice(2).join("|")}`);
    }
  }
}

// Login como invitado: no llamamos a /api/login, simplemente dejamos que
// el servidor nos asigne un nombre de invitado automático.
function loginAsGuest() {
  print("login", "Usando sesión de invitado (sin autenticación).");
  // No enviamos /trn; el servidor ya nos asigna un guest tras el challstr
  // si no hacemos login explícito con usuario/contraseña.
}

document.querySelector("#connectBtn").addEventListener("click", connect);
document.querySelector("#disconnectBtn").addEventListener("click", disconnect);

document.querySelector("#sendChat").addEventListener("click", () => {
  const text = chatText.value.trim();
  if (text.length === 0) return;

  if (!joinedLobby) {
    print("chat", "Todavía no te has unido a la sala lobby.");
    return;
  }

  send("lobby", text);
  chatText.value = "";
});
