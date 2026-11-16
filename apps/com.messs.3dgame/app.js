const canvas = document.querySelector("#gameCanvas");
const startScreen = document.querySelector("#startScreen");
const startButton = document.querySelector("#startButton");
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9bbbd3);
scene.fog = new THREE.Fog(0x9bbbd3, 70, 230);

const camera = new THREE.PerspectiveCamera(68, 16 / 9, 0.1, 300);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const player = new THREE.Group();
player.position.set(0, 1, 8);
scene.add(player);
const avatar = new THREE.Group();
avatar.visible = false;
player.add(avatar);
player.add(camera);
const firstPersonArms = new THREE.Group();
camera.add(firstPersonArms);
const leftArm = humanoidPart(new THREE.BoxGeometry(0.14, 0.9, 0.14), 0x247fba, -0.38, -0.58, -0.8);
const rightArm = humanoidPart(new THREE.BoxGeometry(0.14, 0.9, 0.14), 0x247fba, 0.38, -0.58, -0.8);
firstPersonArms.add(leftArm);
firstPersonArms.add(rightArm);
leftArm.rotation.z = -0.18;
rightArm.rotation.z = 0.18;

function humanoidPart(geometry, color, x, y, z) {
  const part = new THREE.Mesh(geometry, material(color, 0.7));
  part.position.set(x, y, z);
  part.castShadow = true;
  avatar.add(part);
  return part;
}

humanoidPart(new THREE.BoxGeometry(0.85, 1.05, 0.48), 0x247fba, 0, 0.52, 0);
humanoidPart(new THREE.SphereGeometry(0.36, 16, 12), 0xe7a678, 0, 1.32, 0);
humanoidPart(new THREE.BoxGeometry(0.22, 0.95, 0.25), 0x247fba, -0.6, 0.52, 0);
humanoidPart(new THREE.BoxGeometry(0.22, 0.95, 0.25), 0x247fba, 0.6, 0.52, 0);
humanoidPart(new THREE.BoxGeometry(0.3, 0.9, 0.34), 0x172b52, -0.23, -0.45, 0);
humanoidPart(new THREE.BoxGeometry(0.3, 0.9, 0.34), 0x172b52, 0.23, -0.45, 0);
humanoidPart(new THREE.BoxGeometry(0.4, 0.18, 0.58), 0x101a2d, -0.23, -0.91, -0.06);
humanoidPart(new THREE.BoxGeometry(0.4, 0.18, 0.58), 0x101a2d, 0.23, -0.91, -0.06);

const keys = new Set();
let yaw = 0;
let pitch = -0.22;
let active = false;
let lastTime = 0;
let verticalVelocity = 0;
let jumpWasPressed = false;
let punchWasPressed = false;
let walkTime = 0;
let punchTime = 0;
let punchHand = 0;
let punchCooldown = 0;
const move = new THREE.Vector3();
const colliders = [];
const npcs = [];
const PLAYER_RADIUS = 0.48;
const NPC_LIMIT = 14;
const NPC_DESPAWN_DISTANCE = 55;
const GAMEPAD_DEADZONE = 0.16;
const GAMEPAD_LOOK_SPEED = 2.4;

function material(color, roughness = 0.85) {
  return new THREE.MeshStandardMaterial({ color, roughness });
}

function box(width, height, depth, color, x, y, z) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material(color));
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

function buildCity() {
  box(180, 0.3, 180, 0x202c35, 0, -0.15, 0);
  for (let x = -4; x <= 4; x++) {
    for (let z = -4; z <= 4; z++) {
      const centerX = x * 18;
      const centerZ = z * 18;
      box(11, 0.22, 11, 0x667277, centerX, 0.12, centerZ);
      const count = 1 + Math.abs(x * 3 + z) % 3;
      for (let i = 0; i < count; i++) {
        const width = 3.5 + (i % 2) * 2;
        const height = 7 + Math.abs(x * 17 + z * 11 + i * 5) % 25;
        const offsetX = -3.2 + (i * 4.3) % 6;
        const offsetZ = -3.2 + (i * 5.2) % 6;
        const colors = [0x38536b, 0x795b50, 0x456956, 0x806c44];
        box(width, height, width, colors[Math.abs(x + z + i) % colors.length], centerX + offsetX, height / 2 + 0.25, centerZ + offsetZ);
        colliders.push({
          minX: centerX + offsetX - width / 2,
          maxX: centerX + offsetX + width / 2,
          minZ: centerZ + offsetZ - width / 2,
          maxZ: centerZ + offsetZ + width / 2
        });
      }
    }
  }
}

function buildLights() {
  scene.add(new THREE.HemisphereLight(0xd8edff, 0x30414d, 1.8));
  const sun = new THREE.DirectionalLight(0xffe6bd, 2.2);
  sun.position.set(-45, 75, 35);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -80;
  sun.shadow.camera.right = 80;
  sun.shadow.camera.top = 80;
  sun.shadow.camera.bottom = -80;
  scene.add(sun);
}

function updateCamera() {
  camera.position.set(0, 1.35, 0);
  camera.rotation.order = "YXZ";
  camera.rotation.set(pitch, yaw, 0);
}

function canOccupy(x, z) {
  for (const collider of colliders) {
    const closestX = THREE.MathUtils.clamp(x, collider.minX, collider.maxX);
    const closestZ = THREE.MathUtils.clamp(z, collider.minZ, collider.maxZ);
    const distanceX = x - closestX;
    const distanceZ = z - closestZ;
    if (distanceX * distanceX + distanceZ * distanceZ < PLAYER_RADIUS * PLAYER_RADIUS) return false;
  }
  return true;
}

function moveWithCollisions(delta) {
  const nextX = player.position.x + delta.x;
  if (canOccupy(nextX, player.position.z)) player.position.x = nextX;
  const nextZ = player.position.z + delta.z;
  if (canOccupy(player.position.x, nextZ)) player.position.z = nextZ;
}

function makeNpc() {
  const npc = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 0.34, 1.45, 10),
    material(0xd05c5c, 0.8)
  );
  body.position.y = 0.72;
  body.castShadow = true;
  npc.add(body);
  const legMaterial = material(0x263957, 0.8);
  const leftLeg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.05, 0.14), legMaterial);
  const rightLeg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.05, 0.14), legMaterial);
  leftLeg.position.set(-0.16, -0.55, 0);
  rightLeg.position.set(0.16, -0.55, 0);
  leftLeg.castShadow = true;
  rightLeg.castShadow = true;
  npc.add(leftLeg);
  npc.add(rightLeg);
  const armMaterial = material(0xd05c5c, 0.8);
  const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.95, 0.13), armMaterial);
  const rightArm = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.95, 0.13), armMaterial);
  leftArm.position.set(-0.47, 0.68, 0);
  rightArm.position.set(0.47, 0.68, 0);
  leftArm.castShadow = true;
  rightArm.castShadow = true;
  npc.add(leftArm);
  npc.add(rightArm);
  const handMaterial = material(0xe7a678, 0.75);
  const leftHand = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), handMaterial);
  const rightHand = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), handMaterial);
  leftHand.position.set(-0.47, 0.15, 0);
  rightHand.position.set(0.47, 0.15, 0);
  leftHand.castShadow = true;
  rightHand.castShadow = true;
  npc.add(leftHand);
  npc.add(rightHand);
  return { mesh: npc, body, leftLeg, rightLeg, leftArm, rightArm, leftHand, rightHand, health: 3, fleeTime: 0, direction: new THREE.Vector3(), speed: 1.2, walkTime: Math.random() * 6 };
}

function spawnNpc() {
  for (let attempt = 0; attempt < 30; attempt++) {
    const angle = Math.random() * Math.PI * 2;
    const distance = 14 + Math.random() * 28;
    const x = player.position.x + Math.cos(angle) * distance;
    const z = player.position.z + Math.sin(angle) * distance;
    if (Math.abs(x) > 84 || Math.abs(z) > 84 || !canOccupy(x, z)) continue;
    const npc = makeNpc();
    npc.mesh.position.set(x, 0.95, z);
    npc.direction.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
    npc.speed = 1.0 + Math.random() * 1.2;
    npc.mesh.rotation.y = Math.atan2(npc.direction.x, npc.direction.z);
    scene.add(npc.mesh);
    npcs.push(npc);
    return;
  }
}

function updateNpcs(delta) {
  for (let i = npcs.length - 1; i >= 0; i--) {
    const npc = npcs[i];
    if (npc.mesh.position.distanceTo(player.position) > NPC_DESPAWN_DISTANCE) {
      scene.remove(npc.mesh);
      npcs.splice(i, 1);
      continue;
    }
    if (npc.fleeTime > 0) {
      npc.fleeTime -= delta;
      npc.direction.copy(npc.mesh.position).sub(player.position);
      npc.direction.y = 0;
      npc.direction.normalize();
      npc.speed = 5.2;
    } else {
      npc.speed = Math.min(npc.speed, 2.2);
    }
    const step = npc.direction.clone().multiplyScalar(npc.speed * delta);
    const nextX = npc.mesh.position.x + step.x;
    const nextZ = npc.mesh.position.z + step.z;
    if (Math.abs(nextX) > 86 || Math.abs(nextZ) > 86 || !canOccupy(nextX, nextZ)) {
      npc.direction.applyAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI * (0.5 + Math.random() * 0.5));
    } else {
      npc.mesh.position.x = nextX;
      npc.mesh.position.z = nextZ;
      npc.mesh.rotation.y = Math.atan2(npc.direction.x, npc.direction.z);
      npc.walkTime += delta * npc.speed * 7;
      const stepSwing = Math.sin(npc.walkTime) * 0.55;
      npc.leftLeg.rotation.x = stepSwing;
      npc.rightLeg.rotation.x = -stepSwing;
      npc.leftArm.rotation.x = -stepSwing * 0.75;
      npc.rightArm.rotation.x = stepSwing * 0.75;
      npc.leftHand.position.z = Math.sin(npc.walkTime) * 0.08;
      npc.rightHand.position.z = -Math.sin(npc.walkTime) * 0.08;
    }
  }
  while (npcs.length < NPC_LIMIT) spawnNpc();
}

function getGamepad() {
  if (!navigator.getGamepads) return null;
  return Array.from(navigator.getGamepads()).find((gamepad) => gamepad?.connected && gamepad.mapping === "standard") ||
    Array.from(navigator.getGamepads()).find((gamepad) => gamepad?.connected) ||
    null;
}

function applyDeadzone(value) {
  if (Math.abs(value) < GAMEPAD_DEADZONE) return 0;
  const sign = Math.sign(value);
  return sign * (Math.abs(value) - GAMEPAD_DEADZONE) / (1 - GAMEPAD_DEADZONE);
}

function gamepadButtonPressed(gamepad, indexes) {
  return indexes.some((index) => gamepad?.buttons[index]?.pressed);
}

function tryPunch() {
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;
  forward.normalize();
  let target = null;
  let targetDepth = 4.0;
  for (const npc of npcs) {
    const offset = npc.mesh.position.clone().sub(player.position);
    offset.y = 0;
    const depth = forward.dot(offset);
    const side = Math.abs(forward.z * offset.x - forward.x * offset.z);
    if (depth < 0.2 || depth > 4.0 || side > 1.4) continue;
    if (depth >= targetDepth) continue;
    target = npc;
    targetDepth = depth;
  }
  if (!target) return;
  target.health -= 1;
  target.fleeTime = 3.5;
  target.body.material.color.setHex(0x7d3030);
  for (const npc of npcs) {
    if (npc.mesh.position.distanceTo(target.mesh.position) < 11) npc.fleeTime = 3.5;
  }
  if (target.health <= 0) {
    scene.remove(target.mesh);
    npcs.splice(npcs.indexOf(target), 1);
  }
}

function update(delta) {
  if (!active) return;
  punchCooldown = Math.max(0, punchCooldown - delta);
  const gamepad = getGamepad();
  const leftStickX = applyDeadzone(gamepad?.axes[0] ?? 0);
  const leftStickY = applyDeadzone(gamepad?.axes[1] ?? 0);
  const rightStickX = applyDeadzone(gamepad?.axes[2] ?? 0);
  const rightStickY = applyDeadzone(gamepad?.axes[3] ?? 0);
  const x = (keys.has("d") || keys.has("ArrowRight") ? 1 : 0) -
    (keys.has("a") || keys.has("ArrowLeft") ? 1 : 0) + leftStickX;
  const z = (keys.has("s") || keys.has("ArrowDown") ? 1 : 0) -
    (keys.has("w") || keys.has("ArrowUp") ? 1 : 0) + leftStickY;
  if (gamepad) {
    yaw -= rightStickX * GAMEPAD_LOOK_SPEED * delta;
    pitch = THREE.MathUtils.clamp(pitch - rightStickY * GAMEPAD_LOOK_SPEED * delta, -0.95, 0.5);
  }
  move.set(x, 0, z);
  if (move.lengthSq() > 0) {
    move.normalize().multiplyScalar(delta * 7);
    move.applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    moveWithCollisions(move);
    player.position.x = THREE.MathUtils.clamp(player.position.x, -82, 82);
    player.position.z = THREE.MathUtils.clamp(player.position.z, -82, 82);
    avatar.rotation.y = Math.atan2(move.x, move.z);
    walkTime += delta * 9;
  } else {
    walkTime += delta * 2;
  }
  const swing = move.lengthSq() > 0 ? Math.sin(walkTime) * 0.38 : Math.sin(walkTime) * 0.04;
  leftArm.rotation.z = -0.18 + swing;
  rightArm.rotation.z = 0.18 - swing;
  leftArm.position.y = -0.58 + Math.abs(Math.sin(walkTime)) * (move.lengthSq() > 0 ? 0.06 : 0.02);
  rightArm.position.y = -0.58 + Math.abs(Math.sin(walkTime + Math.PI)) * (move.lengthSq() > 0 ? 0.06 : 0.02);
  punchTime = Math.max(0, punchTime - delta);
  leftArm.position.z = -0.8;
  rightArm.position.z = -0.8;
  leftArm.rotation.x = 0;
  rightArm.rotation.x = 0;
  if (punchTime > 0) {
    const progress = 1 - punchTime / 0.36;
    let height = 0;
    let reach = 0;
    if (progress < 0.35) {
      const raise = progress / 0.35;
      height = raise * 0.95;
      reach = raise * 0.15;
    } else if (progress < 0.62) {
      const strike = (progress - 0.35) / 0.27;
      height = 0.95 - strike * 1.65;
      reach = 0.15 + strike * 0.95;
    } else {
      const recover = (progress - 0.62) / 0.38;
      height = -0.7 * (1 - recover);
      reach = 1.1 * (1 - recover);
    }
    const activeArm = punchHand === 0 ? leftArm : rightArm;
    activeArm.position.y += height;
    activeArm.position.z -= reach;
    activeArm.rotation.x = -0.9 + progress * 1.2;
  }
  const jumpPressed = keys.has(" ") || keys.has("j") || gamepadButtonPressed(gamepad, [0, 1, 12]);
  if (jumpPressed && !jumpWasPressed && player.position.y <= 1.01) verticalVelocity = 9;
  jumpWasPressed = jumpPressed;
  const punchPressed = gamepadButtonPressed(gamepad, [2, 3, 5, 7]);
  if (punchPressed && !punchWasPressed && punchCooldown <= 0) {
    punchHand = punchHand === 0 ? 1 : 0;
    punchTime = 0.36;
    punchCooldown = 0.42;
    tryPunch();
  }
  punchWasPressed = punchPressed;
  verticalVelocity -= 24 * delta;
  player.position.y += verticalVelocity * delta;
  if (player.position.y < 1) {
    player.position.y = 1;
    verticalVelocity = 0;
  }
  updateNpcs(delta);
  updateCamera();
}

function resize() {
  const width = canvas.clientWidth;
  const height = width * 9 / 16;
  renderer.setSize(width, height, false);
  camera.aspect = 16 / 9;
  camera.updateProjectionMatrix();
}

function loop(time) {
  const delta = Math.min((time - lastTime) / 1000, 0.05);
  lastTime = time;
  update(delta);
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

canvas.addEventListener("mousedown", (event) => {
  if (!active || event.button !== 0 || punchCooldown > 0) return;
  punchHand = punchHand === 0 ? 1 : 0;
  punchTime = 0.36;
  punchCooldown = 0.42;
  tryPunch();
  canvas.requestPointerLock?.();
});
document.addEventListener("mousemove", (event) => {
  if (document.pointerLockElement !== canvas) return;
  yaw -= event.movementX * 0.0025;
  pitch = THREE.MathUtils.clamp(pitch - event.movementY * 0.0025, -0.95, 0.5);
});
window.addEventListener("keydown", (event) => keys.add(event.key.length === 1 ? event.key.toLowerCase() : event.key));
window.addEventListener("keyup", (event) => keys.delete(event.key.length === 1 ? event.key.toLowerCase() : event.key));
window.addEventListener("resize", resize);
startButton.addEventListener("click", () => {
  active = true;
  startScreen.classList.add("hidden");
  canvas.requestPointerLock?.();
});

buildCity();
buildLights();
for (let i = 0; i < NPC_LIMIT; i++) spawnNpc();
resize();
updateCamera();
requestAnimationFrame(loop);
