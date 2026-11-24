// ---------- 街區地圖（重火力測試模式，docs/HEAVY_TEST_PLAN.md） ----------
// 單層、方格街道的密集城市：3～4 格寬的街道切出一塊塊街廓，街廓裡塞可破壞建築（1～4 層），偶爾是廣場 / 停車場（只有零星矮房當掩體）
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

  // 街道切線：從邊牆內側開始，街道 3～4 格、街廓 7～13 格
  const cuts = (len) => {
    const out = [];   // [起點, 長度]（街廓）
    let p = BORDER + ri(3, 4);
    while (p < len - BORDER - 7) {
      const L = Math.min(ri(7, 13), len - BORDER - 3 - p);
      if (L < 5) break;
      out.push([p, L]);
      p += L + ri(3, 4);
    }
    return out;
  };
  const cols = cuts(W), rows = cuts(H);
  const buildings = [];
  const addB = (c, r, w, h, f, st) => { buildings.push([c, r, w, h, f, st]); for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) grid[y][x] = 'B'; };
  const spawnC = cols[0][0] - 2, spawnR = Math.floor(H / 2);   // 出發點：左邊第一條直街的中間

  // 街廓：切成幾棟（沿長邊切，中間留 1 格小巷），或是廣場
  const blocks = [];
  for (const [bc, bw] of cols) for (const [br, bh] of rows) {
    const nearSpawn = Math.hypot(bc + bw / 2 - spawnC, br + bh / 2 - spawnR) < 12;
    const plaza = !nearSpawn && R() < 0.16;
    blocks.push({ c: bc, r: br, w: bw, h: bh, plaza });
    if (plaza) {
      // 廣場：零星 1～2 格的矮房、矮牆當掩體
      const n = ri(2, 4);
      for (let i = 0; i < n; i++) {
        const w = ri(1, 2), h = ri(1, 2), c = ri(bc + 1, bc + bw - w - 1), r = ri(br + 1, br + bh - h - 1);
        if (grid[r][c] === '.') addB(c, r, w, h, 1, ri(0, 2));
      }
      continue;
    }
    const along = bw >= bh;   // 沿長邊切
    const len = along ? bw : bh, side = along ? bh : bw;
    let p = 0;
    while (p < len) {
      let L = Math.min(len - p, ri(3, 6));
      if (len - p - L < 3) L = len - p;   // 剩下太短就併進這棟
      // 深的街廓（另一邊 ≥ 8 格）有時候前後分兩棟，中間一條小巷
      const split = side >= 8 && R() < 0.5;
      const parts = split ? [[0, Math.floor((side - 1) / 2)], [Math.floor((side - 1) / 2) + 1, side - Math.floor((side - 1) / 2) - 1]] : [[0, side]];
      for (const [o, s] of parts) {
        if (s < 2) continue;
        const f = R() < 0.15 ? 1 : R() < 0.5 ? 2 : R() < 0.7 ? 3 : 4, st = ri(0, 2);
        if (along) addB(bc + p, br + o, L, s, f, st); else addB(bc + o, br + p, s, L, f, st);
      }
      p += L + 1;   // 1 格小巷
    }
  }

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
