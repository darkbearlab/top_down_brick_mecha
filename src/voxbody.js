// ---------- 機體的方塊身體：只畫看得到的面 ----------
// 機體方塊比地圖細一倍：設計單位還是 1/16（模型資料、掛點、槍口都用這個），蓋的時候每格切成 2×2×2（FINE = 2，實際一顆 1/32）
// 做法：方塊存在一個密集的格子裡（不是一顆一顆的物件），網格只放「旁邊是空的」那幾面 → 三角形少很多
//   打掉一顆（hide）/ 補回來（show）/ 焦痕（scar）：標記髒掉，每幀畫之前 flushVoxBodies() 統一重建（一個部位一幀最多一次）
//   打掉外層會露出裡面那層（實心，顏色比較暗 = 內部結構），所以洞是一層一層挖下去的凹痕
// 同一個外型（同樣的方塊 + 顏色）共用一份樣板和網格；被打到才各自複製一份網格
import * as THREE from 'three';

export const FINE = 2;
const AO_K = 0.07, AO_MIN = 0.55, AO_MAX = 1.12, NOISE = 0.13, INNER = 0.6;
const vhash = (x, y, z) => { let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0; h = (h ^ (h >> 13)) * 1274126177; return ((h ^ (h >> 16)) >>> 0) / 4294967296; };
const tC = new THREE.Color();
// three.js 每建立一個物件（Group、Mesh、BufferGeometry…）都會呼叫 Math.random() 產生 uuid
// 無頭模擬器（tools/sim）用固定種子的 Math.random 重播戰鬥 → 只為了畫面多建立的物件（關節的群組、各段的網格）不能吃到那串亂數
// offStream(fn)：fn 裡面的 Math.random 暫時換成自己的，跑完換回來
let offSeed = 0x2545f491;
const offRandom = () => { offSeed = Math.imul(offSeed ^ offSeed >>> 15, 0x2c1b3c6d) + 0x9e3779b9 | 0; return (offSeed >>> 0) / 4294967296; };
export function offStream(fn) {
  const r = Math.random;
  Math.random = offRandom;
  try { return fn(); } finally { Math.random = r; }
}

// 六個面：法線 + 四個角（相對方塊的最小角，0..1）；索引照 (0,1,2)(2,1,3)
const FACES = [
  { d: [-1, 0, 0], c: [[0, 1, 0], [0, 0, 0], [0, 1, 1], [0, 0, 1]] },
  { d: [1, 0, 0], c: [[1, 1, 1], [1, 0, 1], [1, 1, 0], [1, 0, 0]] },
  { d: [0, -1, 0], c: [[1, 0, 1], [0, 0, 1], [1, 0, 0], [0, 0, 0]] },
  { d: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [0, 1, 0], [1, 1, 0]] },
  { d: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [1, 1, 0], [0, 1, 0]] },
  { d: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]] },
];

// 每一面旁邊的四個方向（垂直於法線的那四個面的索引）：判斷這一面的邊是不是凸出去的稜角
const SIDES = FACES.map(f => FACES.map((g, i) => i).filter(i => FACES[i].d[0] * f.d[0] + FACES[i].d[1] * f.d[1] + FACES[i].d[2] * f.d[2] === 0));
// 倒角高光：凸出去的稜角那一顆方塊的面亮一點（機體方塊只有 1/32 格，一顆寬剛好是一條 1～2 像素的亮邊）；朝上的面最亮、底面不加
const RIM_UP = 1.2, RIM_SIDE = 1.1;
// 關節切面（分段的身體）：比外面暗很多，彎起來露出來的地方看起來像關節裡面
const CUT_OUT = 0.34, CUT_IN = 0.56;

// ---------- 樣板：從方塊清單（設計單位、顏色已經是 hex）蓋出格子 ----------
// boxes = [[x, y, z, w, h, d, hex], …]（後面的蓋掉前面的）；carve = 挖空的範圍（核心的位置）；cell = 設計單位的大小（1/16）
const cache = new Map();
// F = 方塊清單的單位要切幾份（設計單位 → 2；已經是細格單位 → 1）
// useCache = false：不存（零件工坊每改一次就蓋一次，存下來會一直長）
export function voxelTemplate(boxes, cell, carve = [], F = FINE, useCache = true) {
  const key = useCache ? JSON.stringify([boxes, carve, cell, F]) : null;
  let T = key && cache.get(key);
  if (T) return T;
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (const [x, y, z, w, h, d] of boxes) {
    x0 = Math.min(x0, x * F); y0 = Math.min(y0, y * F); z0 = Math.min(z0, z * F);
    x1 = Math.max(x1, (x + w) * F); y1 = Math.max(y1, (y + h) * F); z1 = Math.max(z1, (z + d) * F);
  }
  if (!boxes.length) { x0 = y0 = z0 = 0; x1 = y1 = z1 = 1; }
  const nx = x1 - x0, ny = y1 - y0, nz = z1 - z0, N = nx * ny * nz;
  const at = (x, y, z) => (x * ny + y) * nz + z;
  const occ = new Uint8Array(N), hex = new Uint32Array(N);
  for (const [x, y, z, w, h, d, c] of boxes) {
    for (let i = x * F - x0; i < (x + w) * F - x0; i++) for (let j = y * F - y0; j < (y + h) * F - y0; j++) for (let k = z * F - z0; k < (z + d) * F - z0; k++) { const a = at(i, j, k); occ[a] = 1; hex[a] = c; }
  }
  for (const [x, y, z, w, h, d] of carve) {
    for (let i = Math.max(0, x * F - x0); i < Math.min(nx, (x + w) * F - x0); i++) for (let j = Math.max(0, y * F - y0); j < Math.min(ny, (y + h) * F - y0); j++) for (let k = Math.max(0, z * F - z0); k < Math.min(nz, (z + d) * F - z0); k++) occ[at(i, j, k)] = 0;
  }
  const has = (i, j, k) => i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < nz && occ[at(i, j, k)] === 1;
  // 列出每一顆
  let n = 0;
  for (let a = 0; a < N; a++) n += occ[a];
  const gx = new Int16Array(n), gy = new Int16Array(n), gz = new Int16Array(n), grid = new Int32Array(N).fill(-1);
  n = 0;
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) for (let k = 0; k < nz; k++) if (occ[at(i, j, k)]) { gx[n] = i; gy[n] = j; gz[n] = k; grid[at(i, j, k)] = n++; }
  // 深度：1 = 一開始就露在外面，2、3、4 = 往裡第幾層，0 = 更裡面（磨損最多挖 3 層，第 4 層會被露出來；再裡面永遠看不到，網格不管它）
  const depth = new Uint8Array(n);
  for (let v = 0; v < n; v++) for (const f of FACES) if (!has(gx[v] + f.d[0], gy[v] + f.d[1], gz[v] + f.d[2])) { depth[v] = 1; break; }
  for (const L of [2, 3, 4]) for (let v = 0; v < n; v++) {
    if (depth[v]) continue;
    for (const f of FACES) { const g = grid[at(gx[v] + f.d[0], gy[v] + f.d[1], gz[v] + f.d[2])]; if (depth[g] === L - 1) { depth[v] = L; break; } }
  }
  // 顏色：環境光遮蔽（周圍 26 格有幾格）× 雜訊；裡面的層暗一點
  const col = new Float32Array(n * 3), out = new Uint32Array(n);
  for (let v = 0; v < n; v++) {
    let o = 0;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let c = -1; c <= 1; c++) if ((a || b || c) && has(gx[v] + a, gy[v] + b, gz[v] + c)) o++;
    const ao = Math.max(AO_MIN, Math.min(AO_MAX, 1 + (17 - o) * AO_K));
    const k = ao * (1 + (vhash(gx[v] + x0, gy[v] + y0, gz[v] + z0) - 0.5) * NOISE) * (depth[v] === 1 ? 1 : INNER);
    tC.setHex(hex[at(gx[v], gy[v], gz[v])]).multiplyScalar(k);
    col[v * 3] = tC.r; col[v * 3 + 1] = tC.g; col[v * 3 + 2] = tC.b; out[v] = tC.getHex();
  }
  // 畫得到的那些（深度 1～4）和它們六個方向的鄰居（-1 = 空的）先算好，重建網格只跑這些
  const vis = [];
  for (let v = 0; v < n; v++) if (depth[v]) vis.push(v);
  const list = Int32Array.from(vis), nb = new Int32Array(list.length * 6);
  list.forEach((v, j) => FACES.forEach((f, k) => {
    const x = gx[v] + f.d[0], y = gy[v] + f.d[1], z = gz[v] + f.d[2];
    nb[j * 6 + k] = x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz ? -1 : grid[at(x, y, z)];
  }));
  T = { n, nx, ny, nz, x0, y0, z0, gx, gy, gz, grid, depth, col, hex: out, s: cell / F, surf: depth.reduce((a, d) => a + (d === 1), 0), list, nb, geo: null };
  T.geo = buildGeo(T, null, null);
  if (key) cache.set(key, T);
  return T;
}

// ---------- 網格：每一顆沒被打掉的，旁邊是空的（或被打掉）的那幾面 ----------
let P = new Float32Array(0), Nn = new Float32Array(0), C = new Float32Array(0), I = new Uint32Array(0);
// view = 只畫其中一段（分段的身體，見下面 segViews）：{ list, nb }，nb 裡 -2 = 隔壁在別段（切面，一定畫、顏色壓暗）
function buildGeo(T, gone, scar, geo = null, view = T) {
  const { gx, gy, gz, col, s, x0, y0, z0, nx, ny, nz, grid, depth } = T, { list, nb } = view, L = list.length;
  const empty = (x, y, z) => { if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) return true; const g = grid[(x * ny + y) * nz + z]; return g < 0 || (gone && gone[g]); };
  // 先數面數
  let f = 0;
  for (let j = 0; j < L; j++) {
    if (gone && gone[list[j]]) continue;
    for (let k = 0; k < 6; k++) { const g = nb[j * 6 + k]; if (g < 0 || (gone && gone[g])) f++; }
  }
  if (P.length < f * 12) { P = new Float32Array(f * 12 * 1.5 | 0); Nn = new Float32Array(P.length); C = new Float32Array(P.length); I = new Uint32Array(f * 6 * 1.5 | 0); }
  let q = 0;
  for (let j = 0; j < L; j++) {
    const v = list[j];
    if (gone && gone[v]) continue;
    const kk = scar && scar[v] ? 0.55 : 1, r = col[v * 3] * kk, g = col[v * 3 + 1] * kk, b = col[v * 3 + 2] * kk;
    const bx = gx[v] + x0, by = gy[v] + y0, bz = gz[v] + z0;
    for (let k = 0; k < 6; k++) {
      const nbg = nb[j * 6 + k];
      if (nbg >= 0 && !(gone && gone[nbg])) continue;
      const F = FACES[k];
      // 這一面有沒有一條邊是凸稜：旁邊那格空、而且旁邊再往外那格也空
      let rim = 1;
      if (nbg === -2) rim = depth[v] === 1 ? CUT_OUT : CUT_IN;
      else if (F.d[1] >= 0) for (const k2 of SIDES[k]) {
        const t = FACES[k2].d;
        if (empty(gx[v] + t[0], gy[v] + t[1], gz[v] + t[2]) && empty(gx[v] + t[0] + F.d[0], gy[v] + t[1] + F.d[1], gz[v] + t[2] + F.d[2])) { rim = F.d[1] > 0 ? RIM_UP : RIM_SIDE; break; }
      }
      for (let c = 0; c < 4; c++) {
        const o = (q * 4 + c) * 3;
        P[o] = (bx + F.c[c][0]) * s; P[o + 1] = (by + F.c[c][1]) * s; P[o + 2] = (bz + F.c[c][2]) * s;
        Nn[o] = F.d[0]; Nn[o + 1] = F.d[1]; Nn[o + 2] = F.d[2];
        C[o] = r * rim; C[o + 1] = g * rim; C[o + 2] = b * rim;
      }
      const ii = q * 6, b0 = q * 4;
      I[ii] = b0; I[ii + 1] = b0 + 1; I[ii + 2] = b0 + 2; I[ii + 3] = b0 + 2; I[ii + 4] = b0 + 1; I[ii + 5] = b0 + 3;
      q++;
    }
  }
  // 沿用原本的緩衝區（夠大就直接覆寫、只畫用到的那段）；不夠才換大的（舊的先釋放，不然顯示卡記憶體會一直漏）
  geo ??= new THREE.BufferGeometry();
  const cap = geo.userData.cap ?? 0;
  if (cap < q || !geo.attributes.position) {   // 整個部位都被收掉（傳送）時 q = 0，也要有緩衝區
    if (cap) geo.dispose();
    const nc = Math.max(1, Math.ceil(q * (cap ? 1.3 : 1)));
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(nc * 12), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(nc * 12), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(nc * 12), 3));
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(nc * 6), 1));
    geo.userData.cap = nc;
  }
  geo.attributes.position.array.set(P.subarray(0, q * 12)); geo.attributes.position.needsUpdate = true;
  geo.attributes.normal.array.set(Nn.subarray(0, q * 12)); geo.attributes.normal.needsUpdate = true;
  geo.attributes.color.array.set(C.subarray(0, q * 12)); geo.attributes.color.needsUpdate = true;
  geo.index.array.set(I.subarray(0, q * 6)); geo.index.needsUpdate = true;
  geo.setDrawRange(0, q * 6);
  if (!geo.boundingSphere) geo.computeBoundingSphere();
  return geo;
}

// ---------- 一個部位的方塊身體（Mesh） ----------
// mesh.userData.vb = 這個物件：n 顆、pos(i) 本地座標、hex[i] 顏色、gone[i]、hide / show / scar / unscar / exposed
export class VoxBody {
  constructor(T, material) {
    this.T = T; this.n = T.n; this.hex = T.hex; this.depth = T.depth;
    this.gone = new Uint8Array(T.n); this.scarred = new Uint8Array(T.n);
    this.dirty = false; this.own = false;
    const mesh = this.mesh = new THREE.Mesh(T.geo, material);
    mesh.userData.vb = this;
  }
  pos(i, out) { const T = this.T; return out.set((T.gx[i] + T.x0 + 0.5) * T.s, (T.gy[i] + T.y0 + 0.5) * T.s, (T.gz[i] + T.z0 + 0.5) * T.s); }
  // 旁邊有沒有空的（可以被打到）
  exposed(i) {
    const T = this.T, { nx, ny, nz, grid } = T;
    for (const F of FACES) {
      const x = T.gx[i] + F.d[0], y = T.gy[i] + F.d[1], z = T.gz[i] + F.d[2];
      if (x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz) return true;
      const g = grid[(x * ny + y) * nz + z];
      if (g < 0 || this.gone[g]) return true;
    }
    return false;
  }
  mark() { if (!this.dirty) { this.dirty = true; dirtyList.push(this); } }
  hide(i) { if (!this.gone[i]) { this.gone[i] = 1; this.mark(); } }
  show(i) { if (this.gone[i]) { this.gone[i] = 0; this.mark(); } }
  scar(i, on = true) { if (this.scarred[i] !== +on) { this.scarred[i] = +on; this.mark(); } }
  // 畫之前：髒了就重建（第一次改動才複製一份自己的網格，之前跟同外型的共用）
  flush() {
    if (!this.dirty) return;
    this.dirty = false;
    if (this.segs) {
      // 第一次改動：各段換成自己的網格。沒分段時這裡只建立一個 BufferGeometry → 第一段照常建立，其他段不吃亂數（offStream）
      if (!this.own) this.segs.forEach((S, k) => { S.mesh.geometry = k ? offStream(() => new THREE.BufferGeometry()) : new THREE.BufferGeometry(); });
      for (const S of this.segs) buildGeo(this.T, this.gone, this.scarred, S.mesh.geometry, S.view);
      this.own = true;
      return;
    }
    if (!this.own) { this.own = true; this.mesh.geometry = new THREE.BufferGeometry(); }
    buildGeo(this.T, this.gone, this.scarred, this.mesh.geometry);
  }
  // 分段（關節）：方塊資料還是這一份（磨損、傳送、爆開看到的都不變，順序和位置跟沒分段時一樣），只是畫的時候照 segOf 分成 n 個網格
  // segOf(x, y, z)：這顆（細格座標，最小角）屬於第幾段；key = 這種切法的名字（同外型 + 同切法共用網格）
  // 回傳 n 個網格（本地座標跟原本的網格一樣），呼叫的人自己掛到各段的群組；原本的網格留在原位但不畫（layers 31）
  segment(key, n, segOf) {
    return offStream(() => {
      const views = segViews(this.T, key, n, segOf);
      this.segs = views.map(view => {
        const mesh = new THREE.Mesh(view.geo, this.mesh.material);
        mesh.userData.vbSeg = this;
        return { view, mesh };
      });
      this.mesh.layers.set(31);
      return this.segs.map(S => S.mesh);
    });
  }
}
function segViews(T, key, n, segOf) {
  T.segs ??= new Map();
  let views = T.segs.get(key);
  if (views) return views;
  const { gx, gy, gz, grid, depth, nx, ny, nz, x0, y0, z0 } = T;
  const seg = new Uint8Array(T.n), g6 = new Int32Array(6);
  for (let v = 0; v < T.n; v++) seg[v] = segOf(gx[v] + x0, gy[v] + y0, gz[v] + z0);
  const lists = Array.from({ length: n }, () => []), nbs = Array.from({ length: n }, () => []);
  for (let v = 0; v < T.n; v++) {
    let cut = false;
    for (let k = 0; k < 6; k++) {
      const d = FACES[k].d, x = gx[v] + d[0], y = gy[v] + d[1], z = gz[v] + d[2];
      let g = x < 0 || y < 0 || z < 0 || x >= nx || y >= ny || z >= nz ? -1 : grid[(x * ny + y) * nz + z];
      if (g >= 0 && seg[g] !== seg[v]) { g = -2; cut = true; }
      g6[k] = g;
    }
    if (!depth[v] && !cut) continue;   // 最裡面的：只有切面上的要畫
    lists[seg[v]].push(v);
    for (let k = 0; k < 6; k++) nbs[seg[v]].push(g6[k]);
  }
  views = lists.map((l, i) => { const view = { list: Int32Array.from(l), nb: Int32Array.from(nbs[i]), seg, geo: null }; view.geo = buildGeo(T, null, null, null, view); return view; });
  T.segs.set(key, views);
  return views;
}
const dirtyList = [];
// 每幀畫之前呼叫一次：重建這一幀被改過的部位
// 每幀最多花 FLUSH_MS 毫秒，剩下的留到下一幀（一顆爆炸同時打到一群雜魚時不會卡一下）
const FLUSH_MS = 4;
export function flushVoxBodies() {
  const t0 = performance.now();
  let k = 0;
  while (k < dirtyList.length) { dirtyList[k++].flush(); if (performance.now() - t0 > FLUSH_MS) break; }
  dirtyList.splice(0, k);
}
export function voxelBody(boxes, cell, material, carve = [], F = FINE, useCache = true) { return new VoxBody(voxelTemplate(boxes, cell, carve, F, useCache), material).mesh; }
