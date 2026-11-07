// ---------- 可破壞建築 ----------
// 每棟建築由 0.25 格的小方塊堆成（每格地板 4×4，一層樓 4 塊高），外牆有窗戶、樓板線、屋頂邊。
// 被打中：命中點附近的小方塊被打掉（會打出洞、往裡面越打越深），噴瓦礫和灰塵；
//   一格的耐久扣到 0 或方塊剩不到 30% → 那一格倒塌：上面的方塊全部垮下來，變成一堆瓦礫（可以走過去、子彈也能飛過）
// 受損嚴重的格子會冒煙、起火；倒塌時一大團灰塵、火光
// 碰撞 / 子彈還是以「格」為單位（arena.js 的 '#'）；倒塌後那格變成 'r'（瓦礫地面）
// resetBuildings() 把整個場地的建築蓋回來（每局開始）；setLayout() 換一套建築（換地圖時）
// 多層地圖：每層一套（buildLayerBuildings，蓋的時候 arena 要先切到那層），蓋在那層的 group 底下、用那層的迷霧；setBuildingLayer 換目前在動的那套
// 方塊依位置分到 16 × 16 格的區塊，每個區塊一個 InstancedMesh：鏡頭外的區塊整塊不畫（大地圖靠這個撐住）
import { fogMaterial } from './fog.js';
import * as THREE from 'three';
import { UNIT_BOX, scene } from './core.js';
import { H, W, grid, tileC, tileR, toWorldX, toWorldZ } from './arena.js';
import { burnAt, burst, explosion, fire, smoke, spawnPuff } from './fx.js';
import { sfx } from './audio.js';

const V = 0.25, N = 4;             // 方塊大小、每格幾塊
const FLOOR = 4;                   // 一層樓幾塊高
const R = (a, b) => a + Math.random() * (b - a);

// [c, r, w, h, 樓層數, 風格]
// 半邊的建築 [c, r, w, h, 樓層, 風格]；另一半對場地中心點對稱（兩邊出生點條件一樣），中間一棟自己對稱
const HALF = [
  [12, 6, 3, 2, 2, 0], [20, 12, 2, 3, 2, 1], [14, 18, 3, 2, 3, 2], [24, 20, 2, 2, 2, 0], [9, 31, 3, 2, 2, 1],
  [18, 36, 2, 2, 1, 2], [27, 5, 2, 2, 3, 2], [5, 12, 2, 3, 2, 0], [5, 38, 2, 2, 2, 1], [26, 30, 3, 2, 2, 1],
  [13, 25, 2, 2, 2, 0], [22, 41, 2, 1, 1, 2],
];
export const ARENA_LAYOUT = [
  ...HALF, ...HALF.map(([c, r, w, h, f, si]) => [W - c - w, H - r - h, w, h, f, (si + 1) % 3]),
  [31, 22, 2, 4, 3, 1],
];
// 風格：牆、牆暗、樓板線、窗（暗）、窗（亮燈）、屋頂
const STYLES = [
  { wall: 0x9a948a, wall2: 0x8a847a, band: 0x5e5a54, glass: 0x22303e, lit: 0xd8b860, roof: 0x5a5650 },
  { wall: 0x7c8590, wall2: 0x6e7782, band: 0x454b54, glass: 0x1a2632, lit: 0x9cc8e0, roof: 0x4a4e56 },
  { wall: 0xa47a5c, wall2: 0x946c50, band: 0x5a4234, glass: 0x24282e, lit: 0xe0a050, roof: 0x4e3e34 },
];

const CHUNK = 16;
let LAYOUT = ARENA_LAYOUT, chunks = new Map(), vox = [], tiles = new Map(), burning = new Set();
let sets = [], parent = scene, curMat = null;
export function setLayout(list) { LAYOUT = list; }
function disposeSets() { for (const st of sets) for (const ch of st.chunks.values()) { ch.mesh.parent?.remove(ch.mesh); ch.mesh.dispose(); } sets = []; }
function useSet(st) { ({ chunks, vox, tiles, burning, parent, mat: curMat } = st); }
// 多層：第 k 層的建築（arena.js 已經切到第 k 層）
export function buildLayerBuildings(k, layout, group, U) {
  if (k === 0) disposeSets();
  const st = { chunks: new Map(), vox: [], tiles: new Map(), burning: new Set(), parent: group, mat: fogMaterial(new THREE.MeshLambertMaterial({ color: 0xffffff }), U) };
  sets[k] = st; useSet(st);
  LAYOUT = layout; build();
}
export function setBuildingLayer(k) { useSet(sets[k]); }
const mtx = new THREE.Matrix4(), col = new THREE.Color(), HIDE = new THREE.Matrix4().makeScale(0, 0, 0);
const key = (c, r) => r * W + c;

function build() {
  for (const ch of chunks.values()) { ch.mesh.parent?.remove(ch.mesh); ch.mesh.dispose(); }
  vox.length = 0; tiles.clear(); chunks.clear();
  for (const [c0, r0, w, h, floors, si] of LAYOUT) {
    const S = STYLES[si], L = floors * FLOOR + 1, gw = w * N, gh = h * N;
    const lit = new Set();
    for (let gx = 0; gx < gw; gx++) for (let gz = 0; gz < gh; gz++) for (let y = 0; y < L; y++) {
      const edgeX = gx === 0 || gx === gw - 1, edgeZ = gz === 0 || gz === gh - 1, outer = edgeX || edgeZ;
      const top = y === L - 1;
      if (top && !outer) continue;                       // 屋頂：只有一圈女兒牆，中間是屋頂面（y = L-2）
      let c = S.wall;
      if (top) c = S.band;
      else if (y === L - 2 && !outer) c = S.roof;
      else if (outer) {
        const along = edgeX ? gz : gx, fy = y % FLOOR;
        const corner = edgeX && edgeZ;
        if (fy === 0) c = S.band;
        else if (!corner && (fy === 1 || fy === 2) && along % 4 !== 0 && along % 4 !== 3 && y >= FLOOR) {
          const wk = `${Math.floor(along / 4)},${Math.floor(y / FLOOR)},${edgeX ? 'x' + gx : 'z' + gz}`;
          if (!lit.has(wk + '?')) { lit.add(wk + '?'); if (Math.random() < 0.3) lit.add(wk); }
          c = lit.has(wk) ? S.lit : S.glass;
        } else if (y < FLOOR && fy !== 0 && along % 8 >= 3 && along % 8 <= 4 && fy <= 2) c = S.glass;   // 一樓的門
        else c = (gx * 3 + gz * 5 + y) % 7 === 0 ? S.wall2 : S.wall;
      } else if (y !== L - 2) continue;                   // 裡面是空心的（省方塊），只有屋頂面
      const tc = c0 + Math.floor(gx / N), tr = r0 + Math.floor(gz / N);
      const x = toWorldX(c0) - 0.5 + (gx + 0.5) * V, z = toWorldZ(r0) - 0.5 + (gz + 0.5) * V, yy = (y + 0.5) * V;
      const k = key(tc, tr);
      if (!tiles.has(k)) tiles.set(k, { c: tc, r: tr, vox: [], hp: 0, max: 0, alive: 0, total: 0, burn: 0, smokeT: Math.random(), down: false, S });
      const t = tiles.get(k);
      const ck = Math.floor(tc / CHUNK) + ',' + Math.floor(tr / CHUNK);
      if (!chunks.has(ck)) chunks.set(ck, { list: [], mesh: null, dirty: false, cdirty: false });
      const ch = chunks.get(ck);
      const v = { x, y: yy, z, c, alive: true, t, ch, i: ch.list.length };
      t.vox.push(v);
      ch.list.push(v);
      vox.push(v);
    }
  }
  for (const t of tiles.values()) {
    t.total = t.alive = t.vox.length;
    t.max = t.hp = 160 + t.vox.length * 2.2;
    grid[t.r][t.c] = '#';
  }
  for (const ch of chunks.values()) {
    ch.mesh = new THREE.InstancedMesh(UNIT_BOX, curMat ?? MAT, ch.list.length);
    ch.mesh.castShadow = ch.mesh.receiveShadow = true;
    for (const v of ch.list) writeVox(v);
    ch.mesh.computeBoundingSphere();
    parent.add(ch.mesh);
  }
}
const MAT = fogMaterial(new THREE.MeshLambertMaterial({ color: 0xffffff }));
function writeVox(v, s = V) {
  mtx.makeScale(s, s, s).setPosition(v.x, v.y, v.z);
  v.ch.mesh.setMatrixAt(v.i, mtx);
  v.ch.mesh.setColorAt(v.i, col.setHex(v.c));
}
// 改過的區塊這一幀結束前一起標記要更新
function touch(v, color = false) { v.ch.dirty = true; if (color) v.ch.cdirty = true; }
function flush() {
  for (const ch of chunks.values()) {
    if (ch.dirty) { ch.mesh.instanceMatrix.needsUpdate = true; ch.dirty = false; }
    if (ch.cdirty && ch.mesh.instanceColor) { ch.mesh.instanceColor.needsUpdate = true; ch.cdirty = false; }
  }
}

export function resetBuildings() {
  disposeSets();
  const st = { chunks: new Map(), vox: [], tiles: new Map(), burning: new Set(), parent: scene, mat: MAT };
  sets = [st]; useSet(st);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (grid[r][c] === 'r') grid[r][c] = '.';
  build();
}

// 打中建築：x, y, z = 命中點；dx, dz = 子彈方向（往裡面找方塊）；dmg = 傷害
export function damageBuilding(x, y, z, dmg, dx = 0, dz = 0, splash = 0) {
  const t = tiles.get(key(tileC(x + dx * 0.05), tileR(z + dz * 0.05))) ?? tiles.get(key(tileC(x), tileR(z)));
  if (!t || t.down) return false;
  const rad = splash > 0 ? Math.min(1.1, 0.35 + splash * 0.4) : Math.min(0.75, 0.1 + Math.sqrt(dmg) * 0.05);
  // 往子彈方向找：表面打光了就往裡面挖
  let gone = [];
  for (let k = 0; k < 5 && !gone.length; k++) {
    const px = x + dx * k * V, pz = z + dz * k * V;
    for (const v of t.vox) if (v.alive && (v.x - px) ** 2 + (v.y - y) ** 2 + (v.z - pz) ** 2 < rad * rad) gone.push(v);
  }
  if (!gone.length) for (const v of t.vox) if (v.alive && Math.abs(v.y - y) < 0.4) { gone.push(v); break; }
  if (splash <= 0 && dmg < 12) gone = gone.filter(() => Math.random() < dmg / 12);   // 小口徑：不是每發都打得掉一塊
  const colors = [];
  for (const v of gone) { v.alive = false; t.alive--; v.ch.mesh.setMatrixAt(v.i, HIDE); touch(v); if (colors.length < 4) colors.push(v.c); }
  flush();
  t.hp -= dmg * (splash > 0 ? 1.4 : 1);
  burning.add(t);
  if (gone.length) {
    burst(x - dx * 0.1, y, z - dz * 0.1, colors, Math.min(6, Math.ceil(gone.length / 2)), 2.5 + Math.min(4, dmg * 0.05), -dx * 2, -dz * 2);
    for (let i = 0; i < Math.min(5, 1 + gone.length / 3); i++)
      spawnPuff({ x: x - dx * 0.2, y, z: z - dz * 0.2, vx: -dx * R(0.5, 1.5) + R(-0.4, 0.4), vy: R(0.1, 0.6), vz: -dz * R(0.5, 1.5) + R(-0.4, 0.4),
        life: R(0.7, 1.2), s: R(0.2, 0.34), c0: 0x9a948a, c1: 0x6e6a64, drag: 1.6 });
  }
  if (t.hp <= 0 || t.alive < t.total * 0.3) collapse(t, dx, dz);
  return true;
}

// 範圍傷害（飛彈、爆炸）：附近的每一格都吃
export function blastBuildings(x, y, z, dmg, splash) {
  const c0 = tileC(x), r0 = tileR(z), n = Math.ceil(splash) + 1;
  for (let r = r0 - n; r <= r0 + n; r++) for (let c = c0 - n; c <= c0 + n; c++) {
    const t = tiles.get(key(c, r));
    if (!t || t.down) continue;
    const cx = toWorldX(c), cz = toWorldZ(r);
    const px = Math.max(cx - 0.5, Math.min(x, cx + 0.5)), pz = Math.max(cz - 0.5, Math.min(z, cz + 0.5));
    const d = Math.hypot(px - x, pz - z);
    if (d > splash + 0.3) continue;
    const l = Math.hypot(cx - x, cz - z) || 1;
    damageBuilding(px, Math.max(0.3, Math.min(y, 2.2)), pz, dmg * (1 - d / (splash + 0.6)), (cx - x) / l, (cz - z) / l, splash);
  }
}

function collapse(t, dx, dz) {
  t.down = true;
  grid[t.r][t.c] = 'r';
  const cx = toWorldX(t.c), cz = toWorldZ(t.r);
  // 剩下的方塊：一部分炸飛、其他垮成一堆瓦礫
  const live = t.vox.filter(v => v.alive);
  const colors = [...new Set(live.slice(0, 40).map(v => v.c))].slice(0, 4);
  burst(cx, 1, cz, colors.length ? colors : [0x8a847a], 16, 4, dx * 2, dz * 2);
  let n = 0;
  for (const v of live) {
    if (Math.random() < 0.55 || n >= 60) { v.alive = false; v.ch.mesh.setMatrixAt(v.i, HIDE); touch(v); continue; }
    // 瓦礫堆：中間高、旁邊低
    const ox = R(-0.48, 0.48), oz = R(-0.48, 0.48), hgt = Math.max(0, 0.5 - Math.hypot(ox, oz)) * 1.3;
    v.x = cx + ox; v.z = cz + oz; v.y = R(0.06, 0.12 + hgt);
    v.c = shade(v.c, 0.7);
    mtx.makeRotationFromEuler(new THREE.Euler(R(-0.6, 0.6), R(0, 3), R(-0.6, 0.6)));
    mtx.scale(new THREE.Vector3(V * R(0.8, 1.2), V * R(0.6, 1), V * R(0.8, 1.2))).setPosition(v.x, v.y, v.z);
    v.ch.mesh.setMatrixAt(v.i, mtx);
    v.ch.mesh.setColorAt(v.i, col.setHex(v.c));
    touch(v, true);
    n++;
  }
  flush();
  // 一大團灰塵往外推 + 火光
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2, sp = R(1.5, 5);
    spawnPuff({ x: cx + R(-0.4, 0.4), y: R(0.2, 1.6), z: cz + R(-0.4, 0.4), vx: Math.cos(a) * sp, vy: R(0.2, 1.2), vz: Math.sin(a) * sp,
      life: R(1.4, 2.4), s: R(0.45, 0.8), c0: 0xa8a298, c1: 0x6a665e, drag: 1.8, delay: R(0, 0.25) });
  }
  if (Math.random() < 0.6) { explosion(cx, 0.8, cz, 0.45); burnAt(cx, 0.3, cz, R(4, 8), 0.6); }
  sfx.blast();
}
const shade = (hex, k) => { col.setHex(hex).multiplyScalar(k); return col.getHex(); };

// 受損的格子冒煙、起火
// burning：受損過的格子（大地圖上格子很多，只看打過的）
export function updateBuildings(dt) {
  for (const t of burning) {
    if (t.down) { burning.delete(t); continue; }
    const dmgK = 1 - t.hp / t.max;
    if (dmgK < 0.35) continue;
    t.smokeT -= dt;
    if (t.smokeT <= 0) {
      t.smokeT = R(0.25, 0.6) / dmgK;
      const v = t.vox[Math.floor(Math.random() * t.vox.length)];
      smoke(v.x, Math.max(0.6, v.y), v.z, 1, 1.1, 0x2c2c30);
    }
    if (dmgK > 0.6) {
      t.burn += dt * 14 * (dmgK - 0.5);
      while (t.burn >= 1) { t.burn--; const v = t.vox[Math.floor(Math.random() * t.vox.length)]; fire(v.x, Math.max(0.3, v.y), v.z, 0.5); }
    }
  }
}

resetBuildings();
