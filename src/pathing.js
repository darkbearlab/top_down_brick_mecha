// ---------- 流場尋路 ----------
// 從玩家所在的格子往外算「走到玩家要多遠」（Dijkstra，8 方向、不切牆角），只算玩家周圍 R 格的方框
// 敵機看不到玩家時，往周圍距離最小的格子走 → 會自己繞過岩壁、從隘口過來，不會卡在牆邊
// 貼牆的格子多算一點成本（機體有體積，盡量走路中間）；兩邊都是牆的一格寬縫當成過不去
// 玩家換格子、或每 0.6 秒（建築被打掉、地形會變）重算一次；大地圖上約 2～6 ms
// 兩份：地面（岩壁、建築、空洞都過不去）、飛行（空洞可以飛過去；有會飛的敵機在用才算）
import { H, W, grid, gridVer } from './arena.js';

const R = 80;                     // 只算玩家周圍這麼多格
const INF = 0x7fffffff;
const S = 2 * R + 1;
const DIRS = [[1, 0, 10], [-1, 0, 10], [0, 1, 10], [0, -1, 10], [1, 1, 14], [1, -1, 14], [-1, 1, 14], [-1, -1, 14]];
let heap = new Int32Array(S * S * 4), hk = new Int32Array(S * S * 4), hn = 0;

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

function makeField(isBlock) {
  const F = { dist: new Int32Array(S * S), ox: 0, oy: 0, srcC: -99, srcR: -99, timer: 0, mapW: 0, mapH: 0, mapG: null };
  const blocked = (c, r) => c < 0 || r < 0 || c >= W || r >= H || isBlock(grid[r][c]);
  // 1 格寬的縫：左右都是牆、或上下都是牆
  const narrow = (c, r) => (blocked(c - 1, r) && blocked(c + 1, r)) || (blocked(c, r - 1) && blocked(c, r + 1));
  const nearWall = (c, r) => { for (let y = r - 1; y <= r + 1; y++) for (let x = c - 1; x <= c + 1; x++) if (blocked(x, y)) return true; return false; };
  F.compute = (pc, pr) => {
    const dist = F.dist;
    dist.fill(INF);
    F.ox = pc - R; F.oy = pr - R; hn = 0;
    if (blocked(pc, pr)) return;
    const i0 = R * S + R;
    dist[i0] = 0; push(i0, 0);
    while (hn) {
      const k = hk[0], i = pop();
      if (k > dist[i]) continue;
      const lc = i % S, lr = (i - lc) / S, c = lc + F.ox, r = lr + F.oy;
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
  };
  F.update = (dt, x, z) => {
    const c = Math.floor(x + W / 2), r = Math.floor(z + H / 2);
    F.timer -= dt;
    if (F.mapW !== W || F.mapH !== H || F.mapG !== grid || F.ver !== gridVer) { F.mapW = W; F.mapH = H; F.mapG = grid; F.ver = gridVer; F.timer = 0; }
    // 目標換格子（最多每 0.3 秒一次）、地形變了（gridVer）才重算；保險起見最久 3 秒也重算一次
    if ((c !== F.srcC || r !== F.srcR) && F.timer < 2.7 || F.timer <= 0) { F.srcC = c; F.srcR = r; F.timer = 3; F.compute(c, r); }
  };
  const at = (c, r) => { const lc = c - F.ox, lr = r - F.oy; return lc < 0 || lr < 0 || lc >= S || lr >= S ? INF : F.dist[lr * S + lc]; };
  // 到玩家的路程（格）；算不到 = Infinity
  F.distAt = (x, z) => { const d = at(Math.floor(x + W / 2), Math.floor(z + H / 2)); return d === INF ? Infinity : d / 10; };
  // 往玩家走的方向：沿著距離往下走 3 步，往那格中心走（比只看隔壁一格順）；算不到 = null
  F.dirAt = (x, z) => {
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
  };
  return F;
}

const ground = makeField(t => t === '#' || t === 'v');
const fly = makeField(t => t === '#');
let flyUsed = 0;   // 最近有沒有會飛的在問路（沒有就不算飛行流場）

// 每幀呼叫：玩家換格子或時間到才重算
export function updateFlow(dt, x, z) {
  ground.update(dt, x, z);
  if ((flyUsed -= dt) > 0) fly.update(dt, x, z);
}
// 往任意目標的路（新數值的王牌戰術：觀戰 / 模擬裡打的不是玩家，流場用不上）
// key = 目標（機體 id）；目標換格子且過了 0.3 秒、或每 0.6 秒重算；now = 遊戲時間（G.now）
const routes = new Map();
export function routeDir(key, now, fx, fz, tx, tz) {
  let F = routes.get(key);
  if (!F) {
    if (routes.size >= 24) { let ok = null, ot = Infinity; for (const [k, R] of routes) if (R.used < ot) { ot = R.used; ok = k; } routes.delete(ok); }   // 滿了丟最久沒用的那份
    F = makeField(t => t === '#' || t === 'v'); F.t = -99; routes.set(key, F);
  }
  F.used = now;
  const c = Math.floor(tx + W / 2), r = Math.floor(tz + H / 2);
  // 重算：地形變了（gridVer）、目標換格子（最多每 0.3 秒）、保險最久 3 秒
  if (F.mapG !== grid || F.mapW !== W || F.mapH !== H || F.ver !== gridVer || now < F.t || ((c !== F.srcC || r !== F.srcR) && now - F.t > 0.3) || now - F.t > 3) {
    F.mapG = grid; F.mapW = W; F.mapH = H; F.ver = gridVer; F.srcC = c; F.srcR = r; F.t = now; F.compute(c, r);
  }
  return F.dirAt(fx, fz);
}
export const flowDist = (x, z) => ground.distAt(x, z);
export const flowDir = (x, z) => ground.dirAt(x, z);
export const flyDist = (x, z) => { flyUsed = 2; return fly.distAt(x, z); };
export const flyDir = (x, z) => { if (flyUsed <= 0) fly.timer = 0; flyUsed = 2; return fly.dirAt(x, z); };
