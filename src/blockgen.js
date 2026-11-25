// ---------- 街區地圖（觀戰場地 bigArena；genBlocks 是以前重火力測試模式的街區圖，現在沒有模式用） ----------
// 單層、方格街道的城市：4～5 格寬的街道切出一塊塊街廓，街廓裡塞可破壞建築（1～4 層），中間有小巷、空地；約五分之一是廣場 / 停車場（只有零星矮房當掩體）
// 外圍一圈打不壞的牆；裡面的建築全部可以打爛（buildings.js）
// 輸出格式跟 stagegen.js 的 genStage 一樣（layers、zones、sites、caches、portal、spawn），走遠征模式同一套流程
// 區域（zones）：把地圖切成 3 × 2 塊，離出發點越遠 depth 越高；每個區域放幾支小隊（sites）
import { rng } from './mapgen.js';

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

// 街廓填建築（genBlocks、bigArena 共用）：cols / rows = [起點, 長度] 的街廓切線；near(c, r) = 不要當廣場的地方（出發點附近）
// 每塊：約五分之一是廣場（零星 1～2 格矮房），其他沿長邊切成 3～6 格寬的幾棟（深的街廓前後分兩棟），中間 1～2 格小巷，一成多留空
function fillBlocks(R, cols, rows, addB, grid, near, plazaP = 0.2, skipP = 0.12) {
  const ri = (a, b) => a + Math.floor(R() * (b - a + 1));
  const blocks = [];
  for (const [bc, bw] of cols) for (const [br, bh] of rows) {
    const plaza = !near(bc + bw / 2, br + bh / 2) && R() < plazaP;
    blocks.push({ c: bc, r: br, w: bw, h: bh, plaza });
    if (plaza) {
      const n = ri(2, 4);
      for (let i = 0; i < n; i++) {
        const w = ri(1, 2), h = ri(1, 2), c = ri(bc + 1, bc + bw - w - 1), r = ri(br + 1, br + bh - h - 1);
        if (grid[r][c] === '.') addB(c, r, w, h, 1, ri(0, 2));
      }
      continue;
    }
    const along = bw >= bh;
    const len = along ? bw : bh, side = along ? bh : bw;
    let p = 0;
    while (p < len) {
      let L = Math.min(len - p, ri(3, 6));
      if (len - p - L < 3) L = len - p;   // 剩下太短就併進這棟
      const split = side >= 8 && R() < 0.5;
      const parts = split ? [[0, Math.floor((side - 1) / 2)], [Math.floor((side - 1) / 2) + 1, side - Math.floor((side - 1) / 2) - 1]] : [[0, side]];
      for (const [o, s] of parts) {
        if (s < 2 || R() < skipP) continue;   // 留空（空地、停車場）
        const f = R() < 0.15 ? 1 : R() < 0.5 ? 2 : R() < 0.7 ? 3 : 4, st = ri(0, 2);
        if (along) addB(bc + p, br + o, L, s, f, st); else addB(bc + o, br + p, s, L, f, st);
      }
      p += L + ri(1, 2);   // 1～2 格小巷
    }
  }
  return blocks;
}
// 街道切線：from 起、到 to 為止（最後一塊貼著 to）；街道 s0～s1 格、街廓 7～13 格 → [起點, 長度] 的清單
function streetCuts(R, from, to, s0 = 4, s1 = 5, flush = false) {
  const ri = (a, b) => a + Math.floor(R() * (b - a + 1));
  const out = [];
  let p = from + ri(s0, s1);
  while (p <= to - 4) {
    const L = Math.min(ri(7, 13), to - p);   // 最後一塊貼到 to（大道 / 邊牆旁邊）
    if (L < 4) break;
    out.push([p, L]);
    p += L + ri(s0, s1);
  }
  if (flush && out.length) { const q = out[out.length - 1]; q[1] = to - q[0]; }   // flush：最後一塊一直延伸到 to（貼著大道，中間不留一大片空地）
  return out;
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
