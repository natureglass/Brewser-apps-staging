// Ordinary multiplayer client. Its own app id, its declared relay origin.
const APP = 'com.natureglass.wslegit';

// Literal, own namespace.
const lobby = new WebSocket('wss://ws.brewser.io/?app=com.natureglass.wslegit&room=lobby');

// Assembled room id, app id still pinned to this package.
function joinRoom(roomId) {
  return new WebSocket('wss://ws.brewser.io/?app=com.natureglass.wslegit&room=' + roomId);
}

// Same, via a template literal.
function joinRoomTemplate(roomId) {
  return new WebSocket(`wss://ws.brewser.io/?app=com.natureglass.wslegit&room=${roomId}`);
}

export { APP, lobby, joinRoom, joinRoomTemplate };
