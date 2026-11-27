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
// conquest：據點戰用（src/conquest.js）——清出 3 × 3 塊據點空地（世界座標 x = -22 / 0 / 22、z = -22 / 0 / 22），每塊周圍有 2 × 2 的矮房當掩體；
//   正中央那棟長條建築不蓋（中央據點在那裡）；一樣點對稱（巢穴種類也照點對稱配：轉 180° 後同一種）
export const CQ_NODES = [-22, 0, 22].flatMap(z => [-22, 0, 22].map(x => ({ x, z })));
export function bigArena(seed = BIG_ARENA_SEED, conquest = false) {
  const W = 96, H = 72, R = rng(seed);
  const grid = Array.from({ length: H }, (_, r) => Array.from({ length: W }, (_, c) => (r === 0 || c === 0 || r === H - 1 || c === W - 1) ? '#' : '.'));
  const half = [];
  const addB = (c, r, w, h, f, st) => { half.push([c, r, w, h, f, st]); for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) grid[y][x] = 'B'; };
  const AVE = W / 2 - 3;   // 大道左緣（c 45～50）
  const side = 42, sc = Math.floor(W / 2 - side), sr = H / 2;   // 出發點那格（左邊）
  const clearC = [1, sc + 5], clearR = [sr - 12, sr + 12];
  const box = (c0, c1, r0, r1) => (c, r, w, h) => c < c1 + 1 && c + w > c0 && r < r1 + 1 && r + h > r0;
  const clears = [box(clearC[0], clearC[1], clearR[0], clearR[1]), ...(conquest ? [box(39, 56, 8, 19), box(39, 56, 30, 41), box(39, 56, 52, 63), box(20, 31, 8, 19), box(20, 31, 30, 41), box(20, 31, 52, 63)] : [])];   // 據點空地（左半邊的部分；右半邊轉 180° 自己有）
  const inClear = (c, r, w = 1, h = 1) => clears.some(f => f(c, r, w, h));
  fillBlocks(R, streetCuts(R, 1, AVE, 3, 4, true), streetCuts(R, 1, H - 1, 3, 4), (c, r, w, h, f, st) => { if (!inClear(c, r, w, h)) addB(c, r, w, h, f, st); }, grid, (c, r) => inClear(Math.floor(c), Math.floor(r)), 0.1, 0.3);
  // 中央建築（c 47～48、r 32～39）兩側只有 2 格（c 45～46）：貼著大道、又跟它的兩端差不到 2 列的街廓建築削掉最靠大道那一行，
  //   不然街廓的角跟中央建築的角之間只剩 2 格的縫（機體寬 1.7～1.9 格，斜著走一定卡角），削完是 3 格
  for (const b of half) {
    const [c, r, w, h] = b;
    if (c + w === AVE && w > 2 && r < H / 2 + 6 && r + h > H / 2 - 6) { for (let y = r; y < r + h; y++) grid[y][c + w - 1] = '.'; b[2] = w - 1; }
  }
  // （大道上原本有兩棟 2 × 2 的矮房當掩體：貼著街廓只留 1 格縫、卡尋路，2026-11-26 拿掉，掩體改由正中央的長條建築負責）
  if (conquest) for (const [c, r] of [[41, 9], [41, 16], [53, 9], [53, 16], [41, 31], [41, 37], [21, 9], [29, 16], [21, 31], [29, 38], [21, 53], [29, 60]]) addB(c, r, 2, 2, 1, 0);   // 據點掩體（轉 180° 後上下、中央各 4 棟）
  const buildings = [...half, ...half.map(([c, r, w, h, f, st]) => [W - c - w, H - r - h, w, h, f, (st + 1) % 3])];
  // 正中央一棟南北長、東西窄的建築（自己就對中心點對稱）：擋住大道上的直線火力巷，兩邊不會一直在中間對射；兩側各留 2 格通道
  if (!conquest) buildings.push([W / 2 - 1, H / 2 - 4, 2, 8, 3, 1]);   // 8 格長：兩端跟大道上的矮房之間留得出路（18 格時剛好卡住，尋路得繞一大圈；10 格時跟旁邊街廓的角重疊一列，只剩 2 格縫、機體斜著走會卡 → 改 8 格 + 削街廓的角，見上面）
  for (const [c, r, w, h] of buildings) for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) grid[y][x] = 'B';
  return { id: (conquest ? 'cqarena' : 'bigarena') + seed, W, H, grid, buildings, side };
}
