// ---------- 流場尋路 ----------
// 從玩家所在的格子往外算「走到玩家要多遠」（Dijkstra，8 方向、不切牆角），只算玩家周圍 R 格的方框
// 敵機看不到玩家時，往周圍距離最小的格子走 → 會自己繞過岩壁、從隘口過來，不會卡在牆邊
// 貼牆的格子多算一點成本（機體有體積，盡量走路中間）；兩邊都是牆的一格寬縫當成過不去
// 玩家換格子、或每 0.6 秒（建築被打掉、地形會變）重算一次；大地圖上約 2～4 ms
import { H, W, grid } from './arena.js';

const R = 80;                     // 只算玩家周圍這麼多格
const INF = 0x7fffffff;
let dist = new Int32Array(0), ox = 0, oy = 0, S = 0, srcC = -99, srcR = -99, timer = 0, mapW = 0, mapH = 0, mapG = null;
let heap = new Int32Array(0), hk = new Int32Array(0), hn = 0;

const blocked = (c, r) => c < 0 || r < 0 || c >= W || r >= H || grid[r][c] === '#' || grid[r][c] === 'v';   // 懸空也過不去
// 1 格寬的縫：左右都是牆、或上下都是牆
const narrow = (c, r) => (blocked(c - 1, r) && blocked(c + 1, r)) || (blocked(c, r - 1) && blocked(c, r + 1));
const nearWall = (c, r) => { for (let y = r - 1; y <= r + 1; y++) for (let x = c - 1; x <= c + 1; x++) if (blocked(x, y)) return true; return false; };

function push(i, k) {
  let n = hn++;
  while (n > 0) { const p = (n - 1) >> 1; if (hk[p] <= k) break; heap[n] = heap[p]; hk[n] = hk[p]; n = p; }
  heap[n] = i; hk[n] = k;
}
function pop() {
  const top = heap[0], li = heap[--hn], lk = hk[hn];
  let n = 0;
  for (;;) {
    let c = 2 * n + 1;
    if (c >= hn) break;
    if (c + 1 < hn && hk[c + 1] < hk[c]) c++;
    if (hk[c] >= lk) break;
    heap[n] = heap[c]; hk[n] = hk[c]; n = c;
  }
  heap[n] = li; hk[n] = lk;
  return top;
}

const DIRS = [[1, 0, 10], [-1, 0, 10], [0, 1, 10], [0, -1, 10], [1, 1, 14], [1, -1, 14], [-1, 1, 14], [-1, -1, 14]];
function compute(pc, pr) {
  S = 2 * R + 1;
  if (dist.length !== S * S) { dist = new Int32Array(S * S); heap = new Int32Array(S * S * 4); hk = new Int32Array(S * S * 4); }
  dist.fill(INF);
  ox = pc - R; oy = pr - R; hn = 0;
  if (blocked(pc, pr)) return;
  const i0 = R * S + R;
  dist[i0] = 0; push(i0, 0);
  while (hn) {
    const k = hk[0], i = pop();
    if (k > dist[i]) continue;
    const lc = i % S, lr = (i - lc) / S, c = lc + ox, r = lr + oy;
    for (const [dc, dr, w] of DIRS) {
      const nc = lc + dc, nr = lr + dr;
      if (nc < 0 || nr < 0 || nc >= S || nr >= S) continue;
      const x = c + dc, y = r + dr;
      if (blocked(x, y) || narrow(x, y)) continue;
      if (dc && dr && (blocked(c + dc, r) || blocked(c, r + dr))) continue;   // 不切牆角
      const nd = k + w + (nearWall(x, y) ? 12 : 0), j = nr * S + nc;
      if (nd < dist[j]) { dist[j] = nd; push(j, nd); }
    }
  }
}

// 每幀呼叫：玩家換格子或時間到才重算
export function updateFlow(dt, x, z) {
  const c = Math.floor(x + W / 2), r = Math.floor(z + H / 2);
  timer -= dt;
  if (mapW !== W || mapH !== H || mapG !== grid) { mapW = W; mapH = H; mapG = grid; timer = 0; }
  if ((c !== srcC || r !== srcR) && timer < 0.3 || timer <= 0) { srcC = c; srcR = r; timer = 0.6; compute(c, r); }
}
// 到玩家的路徑距離（格）；算不到 = Infinity
export function flowDist(x, z) {
  const lc = Math.floor(x + W / 2) - ox, lr = Math.floor(z + H / 2) - oy;
  if (lc < 0 || lr < 0 || lc >= S || lr >= S) return Infinity;
  const d = dist[lr * S + lc];
  return d === INF ? Infinity : d / 10;
}
const at = (c, r) => { const lc = c - ox, lr = r - oy; return lc < 0 || lr < 0 || lc >= S || lr >= S ? INF : dist[lr * S + lc]; };
// 往玩家走的方向：沿著距離往下走 3 步，往那格中心走（比只看隔壁一格順）；算不到 = null
export function flowDir(x, z) {
  let c = Math.floor(x + W / 2), r = Math.floor(z + H / 2);
  if (at(c, r) === INF) {
    // 站在牆邊 / 縫裡（不算可走的格子）：看隔壁有沒有算得到的
    let best = INF, bc = c, br = r;
    for (const [dc, dr] of DIRS) { const d = at(c + dc, r + dr); if (d < best) { best = d; bc = c + dc; br = r + dr; } }
    if (best === INF) return null;
    c = bc; r = br;
  }
  for (let step = 0; step < 3; step++) {
    let best = at(c, r), bc = c, br = r;
    for (const [dc, dr] of DIRS) {
      if (dc && dr && (blocked(c + dc, r) || blocked(c, r + dr))) continue;
      const d = at(c + dc, r + dr);
      if (d < best) { best = d; bc = c + dc; br = r + dr; }
    }
    if (bc === c && br === r) break;
    c = bc; r = br;
  }
  const tx = c - W / 2 + 0.5 - x, tz = r - H / 2 + 0.5 - z, l = Math.hypot(tx, tz);
  return l < 0.05 ? null : { x: tx / l, z: tz / l };
}
