// ---------- 展示空間（主選單、整備） ----------
// 主選單和整備時不畫戰場（中央的建築會把機體整個擋住），改畫一個獨立的場景：
//   一個由紫黑色方塊構成的封閉空間（地板 + 圓頂，形狀稍微不規則），機體站在正中間的地板上
//   方塊像在呼吸：每 BEAT 秒從機體往外推一圈波（地板、牆、天花板一路傳過去），經過的方塊往內推、發光的那些亮起來；另外疊一層很慢的起伏
//   機體腳下那一小塊地板不動（站得穩）
// 鏡頭：自己的一台，幾秒切一個角度（平視、俯視、低角度仰視、斜上方、近景），每個鏡頭慢慢繞、慢慢推近
//   右邊有面板（主選單 / 整備）時用 setViewOffset 把畫面往左挪，機體落在左邊空出來那塊的中間
// 機體：顯示期間把玩家機體的模型搬進這個場景（位置不變，整個空間跟著機體的位置擺）；離開時搬回去
import * as THREE from 'three';

export const showScene = new THREE.Scene();
showScene.background = new THREE.Color(0x040208);
showScene.fog = new THREE.Fog(0x05030a, 7, 17);
export const showCam = new THREE.PerspectiveCamera(40, 1, 0.1, 60);

const root = new THREE.Group();
showScene.add(root);

// 燈：偏紫的環境光 + 上方一盞白色主光（機體的影子落在地板）+ 一盞紫色輪廓光
const hemi = new THREE.HemisphereLight(0x8a70d0, 0x0c0614, 0.9);
const key = new THREE.DirectionalLight(0xfff0e6, 2.0);
key.position.set(-3, 10, 4);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
Object.assign(key.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 1, far: 30 });
key.shadow.bias = -0.0008;
const rim = new THREE.DirectionalLight(0xa060ff, 1.4);
rim.position.set(3, 4, -6);
// 補光：跟著鏡頭，從鏡頭這一側打過去（鏡頭繞到背光面時機體也看得清楚）
const fill = new THREE.DirectionalLight(0xd8d0ff, 1.1);
showScene.add(fill, fill.target);
root.add(hemi, key, key.target, rim);

// ---------- 方塊：地板 + 不規則的圓頂 ----------
const S = 0.5, RX = 8.5, RY = 7, RZ = 8.5, GLOW_P = 0.07;
const warp = (x, y, z) => 1 + 0.08 * Math.sin(x * 0.7 + 1.3) * Math.cos(z * 0.6 - 0.4) + 0.05 * Math.sin(y * 1.1 + x * 0.3);
const cells = [];
const add = (x, y, z, nx, ny, nz) => {
  const r = Math.hypot(x, z), d = Math.hypot(x, y - 0.8, z);
  cells.push({ x, y, z, nx, ny, nz, r, d, n: Math.random(), glow: Math.random() < GLOW_P, s: 0.9 + Math.random() * 0.2 });
};
const L = Math.ceil(RX * 1.2 / S);
for (let i = -L; i < L; i++) for (let k = -L; k < L; k++) {
  const x = (i + 0.5) * S, z = (k + 0.5) * S;
  // 地板：一層，範圍跟圓頂的底一樣大
  const ef = Math.hypot(x / RX, z / RZ) * warp(x, 0, z);
  if (ef <= 1.04) add(x, -S / 2, z, 0, 1, 0);
  // 圓頂：橢球殼（往內的法線 = 方塊被推的方向）
  for (let j = 0; j < Math.ceil(RY * 1.2 / S); j++) {
    const y = (j + 0.5) * S, w = warp(x, y, z);
    const e = Math.hypot(x / RX, y / RY, z / RZ) * w;
    if (e < 1 || e > 1 + S / Math.min(RX, RY) * 1.15) continue;
    const gx = x / (RX * RX), gy = y / (RY * RY), gz = z / (RZ * RZ), gl = Math.hypot(gx, gy, gz);
    add(x, y, z, -gx / gl, -gy / gl, -gz / gl);
  }
}
const N = cells.length;
const geo = new THREE.BoxGeometry(S * 0.94, S * 0.94, S * 0.94);
const dark = cells.filter(c => !c.glow), glow = cells.filter(c => c.glow);
const darkMesh = new THREE.InstancedMesh(geo, new THREE.MeshLambertMaterial({ color: 0xffffff }), dark.length);
const glowMesh = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), glow.length);
darkMesh.receiveShadow = true;
darkMesh.frustumCulled = glowMesh.frustumCulled = false;
root.add(darkMesh, glowMesh);
const c0 = new THREE.Color(), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p0 = new THREE.Vector3(), s0 = new THREE.Vector3();
const BASE = new THREE.Color(0.075, 0.06, 0.12), GLOW = new THREE.Color(0.5, 0.22, 1.0), HOT = new THREE.Color(0.9, 0.4, 1.0);

let t = 0;
// 心跳：BEAT 秒一下，從機體胸口往外推（WAVE_V 單位 / 秒）
const BEAT = 1.8, WAVE_V = 6, BEAT_W = 0.5;
function wave(c) {
  let pulse = 0;
  for (let k = 0; k < 3; k++) {
    const front = ((t / BEAT) % 1 + k) * BEAT * WAVE_V, d = c.d - front;
    pulse += Math.exp(-(d * d) / BEAT_W) * Math.max(0, 1 - front / 22);
  }
  const slow = Math.sin(c.x * 0.55 + t * 0.7) * Math.sin(c.z * 0.5 - t * 0.5) * Math.sin(c.y * 0.6 + t * 0.4 + 1);
  // 機體腳下（地板中間 2 單位內）不動
  const still = c.ny === 1 ? THREE.MathUtils.smoothstep(c.r, 1.6, 3.2) : 1;
  return { off: (pulse * 0.32 + slow * 0.14 + 0.04 * Math.sin(t * 1.3 + c.n * 6)) * still, pulse: pulse * still };
}
function place(mesh, list, isGlow) {
  for (let i = 0; i < list.length; i++) {
    const c = list[i], { off, pulse } = wave(c);
    p0.set(c.x + c.nx * off, c.y + c.ny * off, c.z + c.nz * off);
    const sc = c.s * (1 + pulse * 0.12);
    m4.compose(p0, q, s0.set(sc, sc, sc));
    mesh.setMatrixAt(i, m4);
    if (isGlow) mesh.setColorAt(i, c0.copy(GLOW).lerp(HOT, Math.min(1, pulse)).multiplyScalar(0.06 + c.n * 0.16 + pulse * 2.4));
    else mesh.setColorAt(i, c0.copy(BASE).multiplyScalar((0.7 + c.n * 0.6) * (1 + pulse * 0.9)));
  }
  mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
}

// ---------- 鏡頭 ----------
// ty = 看機體的哪個高度、pitch = 俯仰（負的 = 從下往上看）、dist = 距離、spin = 繞的速度、push = 這個鏡頭裡推近多少
const SHOTS = [
  { name: '平視', ty: 0.9, pitch: 4, dist: 4.4, spin: 0.12, push: 0.08 },
  { name: '俯視', ty: 0.4, pitch: 72, dist: 4.8, spin: 0.07, push: 0.06 },
  { name: '低角度仰視', ty: 1.3, pitch: -16, dist: 3.4, spin: -0.14, push: 0.05 },
  { name: '斜上方', ty: 0.8, pitch: 30, dist: 5.4, spin: 0.1, push: 0.1 },
  { name: '近景', ty: 1.1, pitch: 9, dist: 2.7, spin: 0.18, push: 0.04 },
];
const SHOT_T = 4.8;
let shot = SHOTS[0], shotT = 0, yaw0 = 0.6, viewOff = 0;
function nextShot() {
  const pool = SHOTS.filter(s => s !== shot);
  shot = pool[Math.floor(Math.random() * pool.length)];
  shotT = 0; yaw0 = Math.random() * Math.PI * 2;
}
function updateCam(dt, x, z, panelPx) {
  if ((shotT += dt) > SHOT_T) nextShot();
  const k = shotT / SHOT_T, yaw = yaw0 + shotT * shot.spin, pitch = THREE.MathUtils.degToRad(shot.pitch), d = shot.dist * (1 - shot.push * k);
  const ty = shot.ty;
  showCam.position.set(x + Math.sin(yaw) * Math.cos(pitch) * d, Math.max(0.2, ty + Math.sin(pitch) * d), z + Math.cos(yaw) * Math.cos(pitch) * d);
  showCam.lookAt(x, ty, z);
  fill.position.copy(showCam.position).add(p0.set(0, 2, 0)); fill.target.position.set(x, ty, z);
  // 右邊的面板：畫面往左挪半個面板寬
  const w = innerWidth, h = innerHeight;
  viewOff += (panelPx / 2 - viewOff) * Math.min(1, dt * 6);
  showCam.aspect = w / h;
  showCam.setViewOffset(w, h, viewOff, 0, w, h);
  showCam.updateProjectionMatrix();
}

// panelPx = 右邊面板寬（CSS 像素）
export function updateShowroom(dt, x, z, panelPx = 0) {
  t += dt;
  root.position.set(x, 0, z);
  place(darkMesh, dark, false);
  place(glowMesh, glow, true);
  updateCam(dt, x, z, panelPx);
}
export const showCount = () => N;
export const showShot = () => shot.name;
export function setShot(i) { shot = SHOTS[i]; shotT = 0; }   // 測試用

// 把機體的模型搬進 / 搬出展示空間
let shown = null;
export function showMech(model) {
  if (shown && shown !== model) showScene.remove(shown);   // 換了機體（整備改配裝會重蓋）：舊的直接丟掉
  if (model.parent !== showScene) {
    showScene.add(model);
    if (!shown) { shotT = 0; shot = SHOTS[0]; yaw0 = 0.6; }   // 剛進來：從平視開始
  }
  shown = model;
}
// current = 現在的玩家機體模型：還是同一台就搬回戰場；已經換掉（開新一局重生了）就直接丟掉舊的
export function hideMech(mainScene, current) {
  if (shown?.parent === showScene) shown === current ? mainScene.add(shown) : showScene.remove(shown);
  shown = null;
}
