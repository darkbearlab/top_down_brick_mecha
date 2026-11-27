// ---------- 街區地圖（觀戰場地 bigArena；genBlocks 是以前重火力測試模式的街區圖，現在沒有模式用） ----------
// 單層、方格街道的城市：4～5 格寬的街道切出一塊塊街廓，街廓裡塞可破壞建築（1～4 層），中間有小巷、空地；約五分之一是廣場 / 停車場（只有零星矮房當掩體）
// 外圍一圈打不壞的牆；裡面的建築全部可以打爛（buildings.js）
// 輸出格式跟 stagegen.js 的 genStage 一樣（layers、zones、sites、caches、portal、spawn），走遠征模式同一套流程
// 區域（zones）：把地圖切成 3 × 2 塊，離出發點越遠 depth 越高；每個區域放幾支小隊（sites）
import { fillBlocks, rng, streetCuts } from './mapgen.js';

export function genBlocks(seed = Math.floor(Math.random() * 1e9), { W = 96, H = 72 } = {}) {
  const R = rng(seed * 5 + 77), BORDER = 2;
  const grid = Array.from({ length: H }, (_, r) => Array.from({ length: W }, (_, c) => (Math.min(c, r, W - 1 - c, H - 1 - r) < BORDER) ? '#' : '.'));
  const deep = new Uint8Array(W * H);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (grid[r][c] === '#') deep[r * W + c] = 1;
  const toX = c => c - W / 2 + 0.5, toZ = r => r - H / 2 + 0.5;
  const ri = (a, b) => a + Math.floor(R() * (b - a + 1));

  // 街道切線：從邊牆內側開始，街道 4～5 格、街廓 7～13 格
  const cuts = (len) => {
    const out = [];   // [起點, 長度]（街廓）
    let p = BORDER + ri(4, 5);
    while (p < len - BORDER - 7) {
      const L = Math.min(ri(7, 13), len - BORDER - 3 - p);
      if (L < 5) break;
      out.push([p, L]);
      p += L + ri(4, 5);
    }
    return out;
  };
  const cols = cuts(W), rows = cuts(H);
  const buildings = [];
  const addB = (c, r, w, h, f, st) => { buildings.push([c, r, w, h, f, st]); for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) grid[y][x] = 'B'; };
  const spawnC = cols[0][0] - 2, spawnR = Math.floor(H / 2);   // 出發點：左邊第一條直街的中間

  // 街廓：切成幾棟（沿長邊切，中間留小巷），或是廣場
  const blocks = fillBlocks(R, cols, rows, addB, grid, (c, r) => Math.hypot(c - spawnC, r - spawnR) < 12);

  // 區域：3 × 2，離出發點越遠越深
  const ZX = 3, ZY = 2, zoneOf = new Uint8Array(W * H);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) zoneOf[r * W + c] = Math.min(ZY - 1, Math.floor(r / H * ZY)) * ZX + Math.min(ZX - 1, Math.floor(c / W * ZX));
  const zones = [];
  for (let y = 0; y < ZY; y++) for (let x = 0; x < ZX; x++) {
    const c = Math.floor((x + 0.5) * W / ZX), r = Math.floor((y + 0.5) * H / ZY);
    zones.push({ theme: 'city', depth: x, c, r, area: W * H / (ZX * ZY) });
  }
  const startZ = zoneOf[spawnR * W + spawnC];

  // 小隊據點：街道交叉口和廣場（周圍 3×3 是空地），離出發點 16 格以上、彼此 12 格以上、最多 10 個
  const open = (c, r, n = 1) => { for (let y = r - n; y <= r + n; y++) for (let x = c - n; x <= c + n; x++) if (grid[y]?.[x] !== '.') return false; return true; };
  const cand = [];
  for (const b of blocks) if (b.plaza) cand.push({ c: b.c + (b.w >> 1), r: b.r + (b.h >> 1) });
  for (let i = 0; i < cols.length; i++) for (let j = 0; j < rows.length; j++) {
    const c = cols[i][0] + cols[i][1] + 1, r = rows[j][0] + rows[j][1] + 1;   // 街廓右下角外面的交叉口
    cand.push({ c, r });
  }
  const sites = [];
  for (const q of cand.sort(() => R() - 0.5)) {
    if (sites.length >= 10) break;   // 敵人少一點（測試模式：少而耐打）
    let { c, r } = q;
    if (!open(c, r)) { if (open(c + 1, r + 1)) { c++; r++; } else continue; }
    if (Math.hypot(c - spawnC, r - spawnR) < 16 || sites.some(s => Math.hypot(s.c - c, s.r - r) < 12)) continue;
    const zone = zoneOf[r * W + c];
    sites.push({ c, r, x: toX(c), z: toZ(r), zone, theme: 'city', depth: zones[zone].depth, layer: 0 });
  }
  // 傳送門：離出發點最遠的那個空地據點旁邊（清完小隊後啟動 → 頭目）
  const far = [...cand].filter(q => open(q.c, q.r, 2)).sort((a, b) => Math.hypot(b.c - spawnC, b.r - spawnR) - Math.hypot(a.c - spawnC, a.r - spawnR))[0] ?? { c: W - 6, r: spawnR };
  const portal = { c: far.c, r: far.r, x: toX(far.c), z: toZ(far.r), zone: zoneOf[far.r * W + far.c], layer: 0 };

  return {
    id: 'blocks' + seed, seed, W, H, terrain: 'blocks', startZ,
    zones, sites, caches: [], links: [], portal,
    spawn: { x: toX(spawnC), z: toZ(spawnR), layer: 0 },
    layers: [{ name: '街區', grid, buildings, deep, zoneOf }],
  };
}

// ---------- 觀戰場地（新數值用）：96 × 72，街區、點對稱 ----------
// 左半邊照街區產生（街道 3～4 格，比重火力測試的街區密一點；中間留一條 6 格寬的大道），右半邊是左半邊對中心點轉 180°（兩邊條件一樣）
// 兩邊出發點（x = ±side, z = 0）周圍清出一塊空地（11 × 25 格），放得下一整隊；正中央一棟 2 × 10 的長條建築擋火力巷
// 固定種子 → 每次都是同一張圖（觀戰、無頭模擬一樣）
export const BIG_ARENA_SEED = 4;   // 挑過的：建築約 24%
export function bigArena(seed = BIG_ARENA_SEED) {
  const W = 96, H = 72, R = rng(seed);
  const grid = Array.from({ length: H }, (_, r) => Array.from({ length: W }, (_, c) => (r === 0 || c === 0 || r === H - 1 || c === W - 1) ? '#' : '.'));
  const half = [];
  const addB = (c, r, w, h, f, st) => { half.push([c, r, w, h, f, st]); for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) grid[y][x] = 'B'; };
  const AVE = W / 2 - 3;   // 大道左緣（c 45～50）
  const side = 42, sc = Math.floor(W / 2 - side), sr = H / 2;   // 出發點那格（左邊）
  const clearC = [1, sc + 5], clearR = [sr - 12, sr + 12];
  const inClear = (c, r, w = 1, h = 1) => c < clearC[1] + 1 && c + w > clearC[0] && r < clearR[1] + 1 && r + h > clearR[0];
  fillBlocks(R, streetCuts(R, 1, AVE, 3, 4, true), streetCuts(R, 1, H - 1, 3, 4), (c, r, w, h, f, st) => { if (!inClear(c, r, w, h)) addB(c, r, w, h, f, st); }, grid, (c, r) => inClear(Math.floor(c), Math.floor(r)), 0.1, 0.3);
  // 中央建築（c 47～48、r 32～39）兩側只有 2 格（c 45～46）：貼著大道、又跟它的兩端差不到 2 列的街廓建築削掉最靠大道那一行，
  //   不然街廓的角跟中央建築的角之間只剩 2 格的縫（機體寬 1.7～1.9 格，斜著走一定卡角），削完是 3 格
  for (const b of half) {
    const [c, r, w, h] = b;
    if (c + w === AVE && w > 2 && r < H / 2 + 6 && r + h > H / 2 - 6) { for (let y = r; y < r + h; y++) grid[y][c + w - 1] = '.'; b[2] = w - 1; }
  }
  // （大道上原本有兩棟 2 × 2 的矮房當掩體：貼著街廓只留 1 格縫、卡尋路，2026-11-26 拿掉，掩體改由正中央的長條建築負責）
  const buildings = [...half, ...half.map(([c, r, w, h, f, st]) => [W - c - w, H - r - h, w, h, f, (st + 1) % 3])];
  // 正中央一棟南北長、東西窄的建築（自己就對中心點對稱）：擋住大道上的直線火力巷，兩邊不會一直在中間對射；兩側各留 2 格通道
  buildings.push([W / 2 - 1, H / 2 - 4, 2, 8, 3, 1]);   // 8 格長：兩端跟大道上的矮房之間留得出路（18 格時剛好卡住，尋路得繞一大圈；10 格時跟旁邊街廓的角重疊一列，只剩 2 格縫、機體斜著走會卡 → 改 8 格 + 削街廓的角，見上面）
  for (const [c, r, w, h] of buildings) for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) grid[y][x] = 'B';
  return { id: 'bigarena' + seed, W, H, grid, buildings, side };
}

// ---------- 據點戰的大地圖（2026-11-27 第四版）：152 × 112，點對稱，大本營在左上 / 右下 ----------
// 整張圖 = 一張「通道網」：只有通道（路 7 格寬、叢林小徑 5 格寬）、巢穴空地、營地、大本營走得到，其他全部填滿
//   （打不壞的岩壁 '#'，夾一些深坑 'v'：擋路，但子彈、視線過得去）→ 沒有死路、沒有藏在叢林裡的小空地
//   路 14 格寬、叢林小徑 10 格寬、巢穴空地半徑 10：要留得出閃避的空間
//   每條通道兩端都接在大本營 / 巢穴 / 岔路口上，營地都在小徑中間 → 走進去一定走得出來
// 路線故意繞：通道照折線走（每段之間有轉角），相鄰兩點的路程比直線遠
//   上路：左上大本營 → 沿上緣蛇行 → 右上角轉下 → 紅隊的甲殼巢（轉 180° = 下路）；左緣那段：藍隊的甲殼巢 → 大本營
//   中路：大本營 → 增援巢 → 折兩次 → 母巢
//   叢林小徑：酸腺巢 ↔ 增援巢（經過營地）、甲殼巢 ↔ 增援巢（經過營地）、甲殼巢 → 營地 → 岔路口 → 發光巢、岔路口 → 母巢
// 路上、空地有可破壞的矮房當掩體（路中間永遠留 4 格以上）；被通道圍起來的小島整塊是可破壞的建築、大岩塊也大部分是建築（只留零散的岩心）→ 越打越寬闊
// 生成：只做左半邊，右半邊 = 左半邊轉 180°；大本營到每座巢穴、每個營地、對面大本營一定走得到（不通就換種子重做）
export const CQ_W = 152, CQ_H = 112;
export const CQ_BASES = [{ x: -64, z: -44 }, { x: 64, z: 44 }];   // 藍、紅
const sym = L => [...L, ...L.filter(p => p.x || p.z).map(p => ({ ...p, x: -p.x, z: -p.z }))];
export const CQ_NODES = [
  { x: 0, z: 0, type: 'core' },
  ...sym([{ x: -30, z: -22, type: 'reinforce' }, { x: -10, z: -46, type: 'attack' }, { x: -62, z: 0, type: 'armor' }]),
  { x: 30, z: -44, type: 'speed' }, { x: -30, z: 44, type: 'energy' },   // 兩個大本營的垂直平分線上（一樣遠）→ 可以是不同種類
];
export const CQ_CAMPS = sym([{ x: -18, z: -33, kind: 'rage' }, { x: -48, z: -10, kind: 'haste' }, { x: -46, z: 17, kind: 'rage' }]);
// 通道：[寬, 折線…]（左半邊那份；右半邊自動轉 180°）
const LANE = 14, PATH = 10;   // 路寬、叢林小徑寬（2026-11-27：要留得出閃避的空間，7 / 5 太窄）
const NET = (() => {
  const B = CQ_BASES[0];
  const L = [
    [LANE, [B.x, B.z], [-40, -50], [-10, -46], [12, -51], [30, -44], [52, -50], [66, -30], [60, -12], [62, 0]],   // 上路
    [LANE, [-62, 0], [-68, -20], [B.x, B.z]],                                                                       // 左緣（下路的尾巴）
    [LANE, [B.x, B.z], [-48, -30], [-30, -22], [-16, -20], [-12, -6], [0, 0]],                                      // 中路
    [PATH, [-10, -46], [-18, -33], [-30, -22]],                                                                     // 酸腺巢 ↔ 增援巢
    [PATH, [-62, 0], [-48, -10], [-30, -22]],                                                                       // 甲殼巢 ↔ 增援巢
    [PATH, [-62, 0], [-46, 17], [-30, 26], [-30, 44]],                                                              // 甲殼巢 → 發光巢
    [PATH, [-30, 26], [-14, 14], [0, 0]],                                                                           // 岔路口 → 母巢
  ];
  const out = [];
  for (const [w, ...P] of L) for (let i = 0; i + 1 < P.length; i++) {
    const [ax, az] = P[i], [bx, bz] = P[i + 1];
    out.push([ax, az, bx, bz, w], [-ax, -az, -bx, -bz, w]);
  }
  return out;
})();
export function conquestArena(seed = 7) {
  for (let k = 0; k < 40; k++) { const m = tryConquest(seed + k * 101); if (m) return m; }
  throw new Error('conquestArena: 找不到連通的地圖');
}
function tryConquest(seed) {
  const W = CQ_W, H = CQ_H, R = rng(seed), HW = W / 2;
  const ri = (a, b) => a + Math.floor(R() * (b - a + 1));
  const toC = x => x + HW, toR = z => z + H / 2;
  const wx = c => c - HW + 0.5, wz = r => r - H / 2 + 0.5;
  const segD = (x, z, [ax, az, bx, bz]) => { const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz))); return Math.hypot(x - ax - dx * t, z - az - dz * t); };
  const spots = [...CQ_NODES.map(p => [p.x, p.z, 10]), ...CQ_CAMPS.map(p => [p.x, p.z, 6.5]), ...CQ_BASES.map(p => [p.x, p.z, 13])];
  const walk = (c, r) => { const x = wx(c), z = wz(r); return spots.some(([sx, sz, rr]) => Math.hypot(x - sx, z - sz) < rr) || NET.some(S => segD(x, z, S) < S[4] / 2); };
  // 全部先填成岩壁，通道挖空；深坑一塊一塊撒在岩壁裡（不碰通道）
  const grid = Array.from({ length: H }, (_, r) => Array.from({ length: W }, (_, c) => (r < 1 || c < 1 || r >= H - 1 || c >= W - 1 || !walk(c, r)) ? '#' : '.'));
  for (let i = 0; i < 70; i++) {
    const w = ri(3, 9), h = ri(3, 7), c0 = ri(2, HW - 2), r0 = ri(2, H - h - 2);
    for (let r = r0; r < r0 + h; r++) for (let c = c0; c < Math.min(HW, c0 + w); c++) if (grid[r][c] === '#' && r > 1 && c > 1 && r < H - 2) grid[r][c] = 'v';
  }
  // 掩體：路上（離中線 2～3.5 格）、空地裡（離中心 3～6 格）的矮房
  const half = [];
  const ok = (c, r, w, h, allow) => {
    if (c < 1 || c + w > HW) return false;
    for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) if (grid[y][x] !== '.' || !allow(wx(x), wz(y))) return false;
    for (let y = r - 1; y <= r + h; y++) for (let x = c - 1; x <= c + w; x++) if (grid[y]?.[x] === 'B') return false;
    return true;
  };
  const addB = (c, r, w, h, f, st) => { half.push([c, r, w, h, f, st]); for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) grid[y][x] = 'B'; };
  const nearSpot = (x, z, pad) => spots.some(([sx, sz, rr]) => Math.hypot(x - sx, z - sz) < rr + pad);
  const laneEdge = (x, z) => !nearSpot(x, z, 1) && NET.some(S => segD(x, z, S) >= S[4] / 2 - 3 && segD(x, z, S) < S[4] / 2 - 0.5) && !NET.some(S => segD(x, z, S) < S[4] / 2 - 3);   // 通道邊緣 3 格內，中間永遠空著
  for (let i = 0; i < 1400; i++) { const w = ri(2, 3), c = ri(1, HW - w), r = ri(1, H - 3); if (ok(c, r, w, 2, laneEdge)) addB(c, r, w, 2, ri(1, 2), ri(0, 2)); }
  for (const p of CQ_NODES) {
    if (p.x > 0 || p.x === 0 && p.z > 0) continue;
    for (let i = 0; i < 30; i++) {
      const a = R() * Math.PI * 2, d = 5 + R() * 3, c = Math.floor(toC(p.x + Math.cos(a) * d)), r = Math.floor(toR(p.z + Math.sin(a) * d));
      if (ok(c, r, 2, 2, (x, z) => Math.hypot(x - p.x, z - p.z) > 2.8)) addB(c, r, 2, 2, 1, ri(0, 2));
      if (half.filter(([bc, br]) => Math.hypot(wx(bc) - p.x, wz(br) - p.z) < 10).length >= (p.x === 0 ? 2 : 3)) break;
    }
  }
  // 右半邊 = 左半邊轉 180°
  for (let r = 0; r < H; r++) for (let c = HW; c < W; c++) grid[r][c] = grid[H - 1 - r][W - 1 - c];
  // 可破壞的街區：被通道圍起來的「島」（不碰地圖邊緣的岩壁塊）裡，小於 700 格的整塊換成建築（深坑留著）
  //   → 打穿哪一面都是通到另一條通道（不會打出死路）；大的島、外圍一圈還是打不壞的岩壁
  //   島是點對稱成對的（大小一樣 → 一起換）；切成最大 4 × 4 的建築，左半邊切、右半邊轉過去
  const isl = new Uint8Array(W * H), seenI = new Uint8Array(W * H), comp = new Int32Array(W * H).fill(-1), bigs = [];
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    if (seenI[r * W + c] || grid[r][c] === '.' || grid[r][c] === 'B') continue;
    const q = [r * W + c]; seenI[q[0]] = 1;
    let edge = false;
    for (let i = 0; i < q.length; i++) {
      const j = q[i], x = j % W, y = (j - x) / W;
      if (x <= 1 || y <= 1 || x >= W - 2 || y >= H - 2) edge = true;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Y = y + dy, k = Y * W + X; if (X >= 0 && Y >= 0 && X < W && Y < H && !seenI[k] && grid[Y][X] !== '.' && grid[Y][X] !== 'B') { seenI[k] = 1; q.push(k); } }
    }
    if (!edge && q.length < 700) for (const j of q) isl[j] = 1;
    else { for (const j of q) comp[j] = bigs.length; bigs.push(q); }
  }
  // 大塊的岩壁（含外圍那一圈）：大部分也換成建築，只留下零散的岩心（打不壞的柱子 / 小岩堆）和地圖邊緣 3 格
  //   → 越打地圖越寬闊（爆炸型、穿牆型的武器有發揮的地方）；岩心照種子撒（每 110 格一顆、半徑 1.5～3.5）
  const keep = new Uint8Array(W * H);
  for (const q of bigs) {
    const n = Math.max(2, Math.round(q.length / 110));
    for (let i = 0; i < n; i++) {
      const j = q[Math.floor(R() * q.length)], x0 = j % W, y0 = (j - x0) / W, rr = 1.5 + R() * 2;
      for (let y = Math.floor(y0 - rr); y <= y0 + rr; y++) for (let x = Math.floor(x0 - rr); x <= x0 + rr; x++) if (Math.hypot(x - x0, y - y0) <= rr && x >= 0 && y >= 0 && x < W && y < H) keep[y * W + x] = 1;
    }
  }
  const usedT = new Uint8Array(W * H), canT = (x, y) => x < HW && comp[y * W + x] >= 0 && !keep[y * W + x] && !usedT[y * W + x] && grid[y][x] === '#'
    && x > 3 && y > 3 && y < H - 4;
  for (let r = 0; r < H; r++) for (let c = 0; c < HW; c++) {
    if (!canT(c, r)) continue;
    let w = 1; while (w < 4 && canT(c + w, r)) w++;
    let h = 1; while (h < 4) { let okRow = true; for (let x = c; x < c + w; x++) if (!canT(x, r + h)) { okRow = false; break; } if (!okRow) break; h++; }
    for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) usedT[y * W + x] = 1;
    half.push([c, r, w, h, ri(1, 4), ri(0, 2)]);
  }
  const used = new Uint8Array(W * H), canI = (x, y) => x < HW && isl[y * W + x] && !used[y * W + x] && grid[y][x] === '#';
  for (let r = 0; r < H; r++) for (let c = 0; c < HW; c++) {
    if (!canI(c, r)) continue;
    let w = 1; while (w < 4 && canI(c + w, r)) w++;
    let h = 1; while (h < 4) { let okRow = true; for (let x = c; x < c + w; x++) if (!canI(x, r + h)) { okRow = false; break; } if (!okRow) break; h++; }
    for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) used[y * W + x] = 1;
    half.push([c, r, w, h, ri(1, 4), ri(0, 2)]);
  }
  const buildings = [...half, ...half.map(([c, r, w, h, f, st]) => [W - c - w, H - r - h, w, h, f, (st + 1) % 3])];
  for (const [c, r, w, h] of buildings) for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) grid[y][x] = 'B';
  // 連通：只走空地（建築打得壞，但不能靠它）
  const seen = new Uint8Array(W * H), q = [toR(CQ_BASES[0].z) * W + toC(CQ_BASES[0].x)];
  seen[q[0]] = 1;
  for (let i = 0; i < q.length; i++) {
    const j = q[i], c = j % W, r = (j - c) / W;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const x = c + dc, y = r + dr, k = y * W + x; if (!seen[k] && grid[y]?.[x] === '.') { seen[k] = 1; q.push(k); } }
  }
  const reach = p => seen[toR(p.z) * W + toC(p.x + 3)] || seen[toR(p.z + 3) * W + toC(p.x)];
  if (![...CQ_NODES, ...CQ_CAMPS, CQ_BASES[1]].every(reach)) return null;
  // 每一格空地都要連得到（沒有被掩體隔開的小角落）
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (grid[r][c] === '.' && !seen[r * W + c]) return null;
  return { id: 'cq' + seed, W, H, grid, buildings, side: 64, bases: CQ_BASES };
}
