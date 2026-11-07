// ---------- 場地 ----------
// 一格 = 1 單位。地面：
//   混凝土 '.'：一般
//   荒地   'd'：跟混凝土差不多，阻力稍大（大地圖的荒野、廢墟）
//   泥地   'm'：抓地力正常，但阻力大，跑不快、衝刺也很快被吃掉
//   瓦礫   'r'：建築倒塌後留下的，有點卡腳
// '#' = 擋路、擋子彈：外圍圍牆和大地圖的岩壁打不壞；建築在 buildings.js（可破壞）
import * as THREE from 'three';
import { UNIT_BOX, WALL_H, scene } from './core.js';
import { setWallTest } from './fx.js';
import { fogMaterial, makeFogU } from './fog.js';

export const SURF = {
  '.': { name: '混凝土', mu: 1.0, drag: 0.0 },
  d: { name: '荒地', mu: 1.0, drag: 0.15 },
  r: { name: '瓦礫', mu: 0.85, drag: 0.6, speed: 0.85 },
  m: { name: '泥地', mu: 0.9, drag: 2.0, speed: 0.55 },
};
// 場地可以換（loadMap）：競技場 64 × 48 固定；遠征模式用 mapgen.js 產生的大地圖
// 多層地圖（loadLayers）：好幾層一樣大、共用世界座標的格子，同一時間只有一層在動（setLayer）；W、H、grid 是 live binding，換地圖 / 換層後其他模組讀到的就是新的
//   'v' = 懸空 / 空洞：走不過去（撞到 = 撞牆）、但子彈和視線都過得去；地板在那裡挖空：多層地圖看得到下面那層，不然是看不到底的深坑（坑邊一圈淺色的裂石）
//   會飛的（旋停機、蟲群）可以飛過 / 停在上面
export let W = 64, H = 48, grid = [], mapId = '', layerNo = 0;
export const SINK = 5;   // 下面那層畫在多低的地方（往下看的高度感）
// 競技場：64 × 48，兩片泥地對中心點對稱（建築另外蓋，見 buildings.js）
export function arenaMap() {
  const W = 64, H = 48;
  const grid = Array.from({ length: H }, (_, r) => Array.from({ length: W }, (_, c) => (r === 0 || c === 0 || r === H - 1 || c === W - 1) ? '#' : '.'));
  const fill = (c0, r0, w, h, ch) => { for (let r = r0; r < r0 + h; r++) for (let c = c0; c < c0 + w; c++) grid[r][c] = ch; };
  fill(16, 27, 8, 4, 'm'); fill(18, 31, 4, 2, 'm');
  fill(40, 17, 8, 4, 'm'); fill(42, 15, 4, 2, 'm');
  return { id: 'arena', W, H, grid };
}

export const toWorldX = c => c - W / 2 + 0.5;
export const toWorldZ = r => r - H / 2 + 0.5;
export const tileC = x => Math.floor(x + W / 2);
export const tileR = z => Math.floor(z + H / 2);
export const tileAt = (c, r) => (c < 0 || r < 0 || c >= W || r >= H) ? '#' : grid[r][c];
export const isBlock = (x, z) => tileAt(tileC(x), tileR(z)) === '#';
// 站得上去嗎（岩壁、建築、懸空都不行）
export const isSolid = (x, z) => { const t = tileAt(tileC(x), tileR(z)); return t === '#' || t === 'v'; };
export const surfaceAt = (x, z) => SURF[tileAt(tileC(x), tileR(z))] ?? SURF['.'];
setWallTest(isBlock, (x, z) => tileAt(tileC(x), tileR(z)) === 'v');   // 碎片撞牆、掉進空洞

// ---------- 地板與岩壁 ----------
// 地板：每格一個顏色畫在一張貼圖上（大地圖每格的像素少一點，貼圖最多 4096 寬）；懸空的格子透明（看得到下面那層）
// 載入時 grid 裡的 '#' 都是不會壞的：外圍是圍牆（灰），裡面的是岩壁（高低不一的岩塊，土褐色）；建築在 buildings.js 另外蓋
// 每層一個 group（地板、岩塊、崖壁、那層的建築）：目前這層 y = 0；下面的層往下沉 SINK、調暗；上面的層不畫
// 每層的設定（map.layers[k]）：grid、under（地下：顏色暗）、edge（看不穿的岩層：離空地 3 格以上的不蓋，反正看不到）、tall（這些岩塊蓋高一點 = 上一層的崖壁）
let built = [];
const mtx = new THREE.Matrix4(), col = new THREE.Color();
const hash = (c, r) => { let h = (c * 374761393 + r * 668265263) | 0; h = (h ^ (h >> 13)) * 1274126177; return ((h ^ (h >> 16)) >>> 0) / 4294967296; };
export const layerGroup = k => built[k]?.group;
export const layerU = k => built[k]?.U;
export const layerCount = () => built.length;
export const layerGrid = k => built[k]?.grid;
function disposeLayers() {
  for (const B of built) {
    scene.remove(B.group);
    for (const o of B.own) {
      if (o.geometry !== UNIT_BOX) o.geometry.dispose();
      o.material.map?.dispose(); o.material.dispose();
      if (o.isInstancedMesh) o.dispose();
    }
  }
  built = [];
}
export function loadMap(map) { loadLayers({ ...map, layers: [{ grid: map.grid }] }); }
export function loadLayers(map) {
  disposeLayers();
  W = map.W; H = map.H; mapId = map.id;
  map.layers.forEach((L, k) => built.push(buildLayer(map, L, k)));
  setLayer(0);
}
export function setLayer(k) {
  layerNo = k; grid = built[k].grid;
  // 下面的層：中間每一層都有懸空的地方才看得到（地表沒有洞 → 地下不用畫）
  let see = k;
  while (see > 0 && built[see].hasVoid && !built[see].bottomless) see--;   // bottomless：這層的洞是深坑（例如地表的坑不要看到地下）
  built.forEach((B, j) => {
    B.group.visible = j <= k && j >= see;
    B.group.position.y = -(k - j) * SINK;
    B.U.fogDim.value = j === k ? 1 : 0.72 * Math.pow(0.7, k - j - 1);
  });
}
function buildLayer(map, L, k) {
  const g = L.grid.map(row => row.slice()), group = new THREE.Group(), U = makeFogU(), mine = [];
  const own = o => { mine.push(o); group.add(o); return o; };
  const PX = Math.max(4, Math.min(16, Math.floor(4096 / W)));
  const cv = document.createElement('canvas');
  cv.width = W * PX; cv.height = H * PX;
  const x2 = cv.getContext('2d'), dk = L.under ? 0.62 : 1;
  const nearV = (c, r) => { for (let y = r - 1; y <= r + 1; y++) for (let x = c - 1; x <= c + 1; x++) if (g[y]?.[x] === 'v') return true; return false; };
  const rgb = (r, gg, b) => `rgb(${Math.round(r * dk)},${Math.round(gg * dk)},${Math.round(b * dk * (L.under ? 1.08 : 1))})`;
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const t = g[r][c], x = c * PX, y = r * PX, n = ((c * 7 + r * 13) % 5) * 3, q = PX / 16;
    if (t === 'v') continue;   // 懸空：透明
    if (t !== '#' && nearV(c, r)) {
      // 坑邊：淺色的裂石，加幾道裂縫
      const m = Math.floor(hash(c, r) * 8);
      x2.fillStyle = rgb(118 + m, 108 + m, 92 + m); x2.fillRect(x, y, PX, PX);
      x2.fillStyle = 'rgba(30,24,18,.55)';
      x2.fillRect(x + ((c * 5) % 11) * q, y, Math.max(1, q), PX * 0.7);
      x2.fillRect(x, y + ((r * 7) % 11) * q, PX * 0.6, Math.max(1, q));
      continue;
    }
    if (t === 'm') {
      x2.fillStyle = rgb(84 + n, 62 + n, 42 + n); x2.fillRect(x, y, PX, PX);
      x2.fillStyle = 'rgba(30,20,10,.35)'; x2.fillRect(x + ((c * 5) % 10) * q, y + ((r * 3) % 10) * q, 4 * q, 3 * q);
    } else if (t === 'd' || t === '#') {
      const m = Math.floor(hash(c, r) * 5);   // 荒地：顏色變化小一點，不要像棋盤
      x2.fillStyle = rgb(76 + m, 70 + m, 58 + m); x2.fillRect(x, y, PX, PX);
      if (hash(c, r) < 0.3) { x2.fillStyle = 'rgba(40,34,26,.35)'; x2.fillRect(x + ((c * 3) % 9) * q, y + ((r * 7) % 9) * q, 3 * q, 2 * q); }
    } else {
      x2.fillStyle = rgb(62 + n, 66 + n, 74 + n); x2.fillRect(x, y, PX, PX);
      x2.fillStyle = 'rgba(0,0,0,.28)'; x2.fillRect(x, y, PX, Math.max(1, q)); x2.fillRect(x, y, Math.max(1, q), PX);
    }
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.NearestFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  const floor = own(new THREE.Mesh(new THREE.PlaneGeometry(W, H), fogMaterial(new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5 }), U)));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;

  // 岩塊離空地幾格（8 方向 BFS，最多算到 10）：看不穿的岩層只蓋表面 2 格、邊緣那圈山蓋 9 格（迷霧看得進去 8 格），再裡面反正看不到
  const dist = new Uint8Array(W * H).fill(255), q = [];
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (g[r][c] !== '#') { dist[r * W + c] = 0; q.push(r * W + c); }
  for (let h = 0; h < q.length; h++) {
    const i = q[h], c = i % W, r = (i - c) / W, d = dist[i] + 1;
    if (d > 10) continue;
    for (let y = r - 1; y <= r + 1; y++) for (let x = c - 1; x <= c + 1; x++) { const j = y * W + x; if (x >= 0 && y >= 0 && x < W && y < H && dist[j] > d) { dist[j] = d; q.push(j); } }
  }
  const blocks = [];
  // 外圍的灰色圍牆只有競技場有；大地圖的邊緣也是岩塊
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const i = r * W + c;
    if (g[r][c] !== '#' || (L.edge?.[i] && dist[i] > 2) || (L.deep?.[i] && dist[i] > 9)) continue;
    blocks.push([c, r, map.id === 'arena' && (r === 0 || c === 0 || r === H - 1 || c === W - 1)]);
  }
  const walls = own(new THREE.InstancedMesh(UNIT_BOX, fogMaterial(new THREE.MeshLambertMaterial({ color: 0xffffff }), U), Math.max(1, blocks.length)));
  blocks.forEach(([c, r, edge], i) => {
    const x = toWorldX(c), z = toWorldZ(r);
    if (edge) { mtx.makeScale(1, WALL_H, 1).setPosition(x, WALL_H / 2, z); col.setHex(0x4a505c); }
    else {
      // 岩塊：高度和顏色隨位置變，往旁邊凸出一點，看起來不是整齊的牆；上一層的崖壁蓋到快跟上一層一樣高
      const h = L.tall?.[r * W + c] ? SINK - 0.4 + hash(c, r) * 0.8 : 2 + hash(c, r) * 1.8, kk = hash(r, c);
      mtx.makeScale(1.12, h, 1.12).setPosition(x + (kk - 0.5) * 0.15, h / 2, z + (hash(c + 7, r) - 0.5) * 0.15);
      col.setRGB((0.36 + kk * 0.1) * dk, (0.32 + kk * 0.08) * dk, (0.27 + kk * 0.06) * dk, THREE.SRGBColorSpace);
    }
    walls.setMatrixAt(i, mtx);
    walls.setColorAt(i, col);
  });
  walls.count = blocks.length;
  walls.castShadow = walls.receiveShadow = true;
  walls.computeBoundingSphere();
  // 崖壁：懸空旁邊的格子底下補一根到最底層的柱子（從上面斜斜看下去是一面牆，不會看到地板薄薄一片）
  const skirt = [];
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    if (g[r][c] === 'v') continue;
    let edge = false;
    for (let y = r - 1; y <= r + 1 && !edge; y++) for (let x = c - 1; x <= c + 1; x++) if (g[y]?.[x] === 'v') { edge = true; break; }
    if (edge) skirt.push([c, r]);
  }
  if (skirt.length) {
    const sk = own(new THREE.InstancedMesh(UNIT_BOX, fogMaterial(new THREE.MeshLambertMaterial({ color: 0xffffff }), U), skirt.length));
    const hgt = Math.max(k * SINK, 9);   // 至少 9 格深：最底層的坑看起來看不到底
    skirt.forEach(([c, r], i) => {
      mtx.makeScale(1.02, hgt, 1.02).setPosition(toWorldX(c), -hgt / 2 - 0.01, toWorldZ(r));
      sk.setMatrixAt(i, mtx);
      const kk = hash(c, r);
      sk.setColorAt(i, col.setRGB(0.26 + kk * 0.05, 0.25 + kk * 0.05, 0.25 + kk * 0.04, THREE.SRGBColorSpace));
    });
    sk.castShadow = true;
    sk.computeBoundingSphere();
  }
  scene.add(group);
  return { grid: g, group, U, own: mine, hasVoid: g.some(row => row.includes('v')), bottomless: !!L.bottomless };
}
loadMap(arenaMap());

// ---------- 碰撞 ----------
// 圓形 o（x, z, vx, vz）撞方塊：推出來、法向速度反彈 e；回傳撞擊的法向速度（沒撞到 = 0）與法線
export function collideBlocks(o, rad, e = 0.25, fly = false) {
  let hit = 0, nx = 0, nz = 0;
  const c0 = tileC(o.x), r0 = tileR(o.z), n = Math.ceil(rad) + 1;
  for (let r = r0 - n; r <= r0 + n; r++) for (let c = c0 - n; c <= c0 + n; c++) {
    const t = tileAt(c, r);
    if (t !== '#' && (t !== 'v' || fly)) continue;   // 懸空也走不過去（會飛的除外）
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

// 走路用的射線：岩壁、建築、懸空都算擋住（敵機避障用；子彈用 rayBlock）
export function rayWalk(ox, oz, dx, dz, max) {
  for (let t = 0; t <= max; t += 0.1) if (isSolid(ox + dx * t, oz + dz * t)) return t;
  return max;
}

// 隨機一塊空地（離 (fx, fz) 至少 minD）
export function randomOpenSpot(fx, fz, minD) {
  for (let k = 0; k < 400; k++) {
    const c = 3 + Math.floor(Math.random() * (W - 6)), r = 3 + Math.floor(Math.random() * (H - 6));
    let ok = true;
    for (let dr = -2; dr <= 2 && ok; dr++) for (let dc = -2; dc <= 2; dc++) if (tileAt(c + dc, r + dr) === '#' || tileAt(c + dc, r + dr) === 'v') { ok = false; break; }
    const x = toWorldX(c), z = toWorldZ(r);
    if (ok && Math.hypot(x - fx, z - fz) >= minD) return { x, z };
  }
  return { x: 0, z: 0 };
}
