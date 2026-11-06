// ---------- 試玩場地 ----------
// 一格 = 1 單位。地面：
//   混凝土 '.'：一般
//   泥地   'm'：抓地力正常，但阻力大，跑不快、衝刺也很快被吃掉
//   瓦礫   'r'：建築倒塌後留下的，有點卡腳
// '#' = 擋路、擋子彈：外圍是打不壞的圍牆；裡面的建築在 buildings.js（可破壞）
import * as THREE from 'three';
import { UNIT_BOX, WALL_H, scene } from './core.js';
import { setWallTest } from './fx.js';

export const SURF = {
  '.': { name: '混凝土', mu: 1.0, drag: 0.0 },
  r: { name: '瓦礫', mu: 0.85, drag: 0.6, speed: 0.85 },
  m: { name: '泥地', mu: 0.9, drag: 2.0, speed: 0.55 },
};
export const W = 44, H = 34;
export const grid = Array.from({ length: H }, (_, r) => Array.from({ length: W }, (_, c) => (r === 0 || c === 0 || r === H - 1 || c === W - 1) ? '#' : '.'));
const fill = (c0, r0, w, h, ch) => { for (let r = r0; r < r0 + h; r++) for (let c = c0; c < c0 + w; c++) grid[r][c] = ch; };
// 右下一片泥（建築另外蓋，見 buildings.js）
fill(29, 20, 8, 5, 'm');
fill(33, 17, 6, 3, 'm');

export const toWorldX = c => c - W / 2 + 0.5;
export const toWorldZ = r => r - H / 2 + 0.5;
export const tileC = x => Math.floor(x + W / 2);
export const tileR = z => Math.floor(z + H / 2);
export const tileAt = (c, r) => (c < 0 || r < 0 || c >= W || r >= H) ? '#' : grid[r][c];
export const isBlock = (x, z) => tileAt(tileC(x), tileR(z)) === '#';
export const surfaceAt = (x, z) => SURF[tileAt(tileC(x), tileR(z))] ?? SURF['.'];
setWallTest(isBlock);

// ---------- 地板：每格一個顏色的貼圖 ----------
const PX = 16;
const cv = document.createElement('canvas');
cv.width = W * PX; cv.height = H * PX;
const g = cv.getContext('2d');
for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
  const t = grid[r][c], x = c * PX, y = r * PX, n = ((c * 7 + r * 13) % 5) * 3;
  if (t === 'm') {
    g.fillStyle = `rgb(${84 + n},${62 + n},${42 + n})`; g.fillRect(x, y, PX, PX);
    g.fillStyle = 'rgba(30,20,10,.35)'; g.fillRect(x + (c * 5) % 10, y + (r * 3) % 10, 4, 3);
  } else {
    g.fillStyle = `rgb(${62 + n},${66 + n},${74 + n})`; g.fillRect(x, y, PX, PX);
    g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(x, y, PX, 1); g.fillRect(x, y, 1, PX);
  }
}
const tex = new THREE.CanvasTexture(cv);
tex.magFilter = THREE.NearestFilter;
tex.colorSpace = THREE.SRGBColorSpace;
const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshLambertMaterial({ map: tex }));
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const blocks = [];
for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (grid[r][c] === '#' && (r === 0 || c === 0 || r === H - 1 || c === W - 1)) blocks.push([toWorldX(c), toWorldZ(r), r === 0 || c === 0 || r === H - 1 || c === W - 1]);
const inst = new THREE.InstancedMesh(UNIT_BOX, new THREE.MeshLambertMaterial({ color: 0xffffff }), blocks.length);
const mtx = new THREE.Matrix4(), col = new THREE.Color();
blocks.forEach(([x, z, edge], i) => {
  mtx.makeScale(1, WALL_H, 1).setPosition(x, WALL_H / 2, z);
  inst.setMatrixAt(i, mtx);
  inst.setColorAt(i, col.setHex(0x4a505c));
});
inst.castShadow = inst.receiveShadow = true;
scene.add(inst);

// ---------- 碰撞 ----------
// 圓形 o（x, z, vx, vz）撞方塊：推出來、法向速度反彈 e；回傳撞擊的法向速度（沒撞到 = 0）與法線
export function collideBlocks(o, rad, e = 0.25) {
  let hit = 0, nx = 0, nz = 0;
  const c0 = tileC(o.x), r0 = tileR(o.z), n = Math.ceil(rad) + 1;
  for (let r = r0 - n; r <= r0 + n; r++) for (let c = c0 - n; c <= c0 + n; c++) {
    if (tileAt(c, r) !== '#') continue;
    const minX = c - W / 2, minZ = r - H / 2;
    const px = Math.max(minX, Math.min(o.x, minX + 1)), pz = Math.max(minZ, Math.min(o.z, minZ + 1));
    let dx = o.x - px, dz = o.z - pz, d = Math.hypot(dx, dz);
    if (d >= rad) continue;
    if (d < 1e-5) { dx = 0; dz = -1; d = 1; }   // 中心進到方塊裡：往上推（很少發生）
    const ux = dx / d, uz = dz / d;
    o.x += ux * (rad - d); o.z += uz * (rad - d);
    const vn = o.vx * ux + o.vz * uz;
    if (vn < 0) {
      o.vx -= (1 + e) * vn * ux; o.vz -= (1 + e) * vn * uz;
      if (-vn > hit) { hit = -vn; nx = ux; nz = uz; }
    }
  }
  return { hit, nx, nz };
}

// 射線打方塊：回傳距離（小步前進，子彈用）
export function rayBlock(ox, oz, dx, dz, max) {
  const step = 0.1;
  for (let t = 0; t <= max; t += step) if (isBlock(ox + dx * t, oz + dz * t)) return t;
  return max;
}

// 隨機一塊空地（離 (fx, fz) 至少 minD）
export function randomOpenSpot(fx, fz, minD) {
  for (let k = 0; k < 400; k++) {
    const c = 3 + Math.floor(Math.random() * (W - 6)), r = 3 + Math.floor(Math.random() * (H - 6));
    let ok = true;
    for (let dr = -2; dr <= 2 && ok; dr++) for (let dc = -2; dc <= 2; dc++) if (tileAt(c + dc, r + dr) === '#') { ok = false; break; }
    const x = toWorldX(c), z = toWorldZ(r);
    if (ok && Math.hypot(x - fx, z - fz) >= minD) return { x, z };
  }
  return { x: 0, z: 0 };
}
