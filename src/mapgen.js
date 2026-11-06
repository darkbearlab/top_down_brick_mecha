// ---------- 大地圖產生器（探索模式） ----------
// 地圖切成 ZC × ZR 個區域，區域之間是岩壁（彎彎曲曲、厚 3～6 格、打不壞），岩壁上開幾個隘口：
//   先連成一棵樹（每個區域都走得到），再多開三成左右的隘口，讓路線有選擇
// 每個區域一種地形主題，決定建築怎麼蓋、遭遇哪些敵人：
//   city 街區：棋盤格街道（路寬 6～7 格）、街廓裡 2～4 棟建築，視線短、轉角多
//   open 荒野：荒地、幾塊岩石和泥地當掩體、零星建築，視線長
//   ruins 廢墟：一堆矮小的建築散落，中等視線
//   plaza 廣場：中間一大片空地、外圍一圈建築
// 遭遇點：每個區域（出發區除外）2～3 個，離隘口和彼此有一段距離；離出發區越遠（要穿過幾個隘口）越難
// 回傳 { id, W, H, grid, buildings: [[c, r, w, h, 樓層, 風格]], spawn: {x, z}, zones, sites: [{ x, z, zone, depth }] }
const rng = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

export const THEMES = { city: '街區', open: '荒野', ruins: '廢墟', plaza: '廣場' };

export function genWorld(seed = Math.floor(Math.random() * 1e9), { ZC = 4, ZR = 3, ZS = 64 } = {}) {
  const rand = rng(seed), ri = (a, b) => a + Math.floor(rand() * (b - a + 1)), pick = a => a[Math.floor(rand() * a.length)];
  const W = ZC * ZS, H = ZR * ZS;
  const grid = Array.from({ length: H }, (_, r) => Array.from({ length: W }, (_, c) => (r === 0 || c === 0 || r === H - 1 || c === W - 1) ? '#' : '.'));
  const inside = (c, r) => c > 0 && r > 0 && c < W - 1 && r < H - 1;
  const set = (c, r, ch) => { if (inside(c, r)) grid[r][c] = ch; };
  const zid = (i, j) => j * ZC + i;

  // 區域主題：出發區（左邊中間）是荒野；其他隨機，但街區至少 3 個
  const startZ = zid(0, Math.floor(ZR / 2));
  const themes = [];
  for (let k = 0; k < ZC * ZR; k++) themes.push(k === startZ ? 'open' : pick(['city', 'city', 'open', 'ruins', 'plaza']));
  for (let n = themes.filter(t => t === 'city').length; n < 3; n++) { let k; do k = ri(0, ZC * ZR - 1); while (k === startZ || themes[k] === 'city'); themes[k] = 'city'; }

  // 岩壁：每條區域邊界一條，位置用幾個正弦疊起來晃動
  const wob = () => { const p = [rand() * 6.28, rand() * 6.28, rand() * 6.28], a = [3.5, 2, 1]; return t => a[0] * Math.sin(t / 11 + p[0]) + a[1] * Math.sin(t / 5 + p[1]) + a[2] * Math.sin(t / 2.3 + p[2]); };
  const thick = () => { const p = rand() * 6.28; return t => 3 + 1.5 * (1 + Math.sin(t / 7 + p)); };
  const vW = [], hW = [];   // vW[i] = 第 i 條直的岩壁（x = (i+1)*ZS 附近），hW[j] = 橫的
  for (let i = 0; i < ZC - 1; i++) { const w = wob(), th = thick(), x0 = (i + 1) * ZS; vW.push({ x: r => x0 + w(r), th }); for (let r = 1; r < H - 1; r++) { const x = x0 + w(r), t = th(r); for (let c = Math.round(x - t / 2); c <= Math.round(x + t / 2); c++) set(c, r, '#'); } }
  for (let j = 0; j < ZR - 1; j++) { const w = wob(), th = thick(), y0 = (j + 1) * ZS; hW.push({ y: c => y0 + w(c), th }); for (let c = 1; c < W - 1; c++) { const y = y0 + w(c), t = th(c); for (let r = Math.round(y - t / 2); r <= Math.round(y + t / 2); r++) set(c, r, '#'); } }

  // 隘口：區域相鄰的邊，先隨機長一棵樹，再多開一些
  const edges = [];
  for (let j = 0; j < ZR; j++) for (let i = 0; i < ZC; i++) { if (i < ZC - 1) edges.push([zid(i, j), zid(i + 1, j), 'v', i, j]); if (j < ZR - 1) edges.push([zid(i, j), zid(i, j + 1), 'h', i, j]); }
  const parent = [...Array(ZC * ZR).keys()], find = x => parent[x] === x ? x : (parent[x] = find(parent[x]));
  const open = [];
  for (const e of edges.slice().sort(() => rand() - 0.5)) {
    const a = find(e[0]), b = find(e[1]);
    if (a !== b) { parent[a] = b; open.push(e); } else if (rand() < 0.3) open.push(e);
  }
  const passes = [];
  for (const [, , dir, i, j] of open) {
    const t = ri(18, ZS - 18), wide = ri(7, 11);
    if (dir === 'v') {
      const r0 = j * ZS + t, x0 = (i + 1) * ZS;
      for (let r = r0 - (wide >> 1); r < r0 - (wide >> 1) + wide; r++) for (let c = x0 - 10; c <= x0 + 10; c++) if (grid[r]?.[c] === '#' && inside(c, r)) grid[r][c] = 'd';
      passes.push({ c: Math.round(vW[i].x(r0)), r: r0 });
    } else {
      const c0 = i * ZS + t, y0 = (j + 1) * ZS;
      for (let c = c0 - (wide >> 1); c < c0 - (wide >> 1) + wide; c++) for (let r = y0 - 10; r <= y0 + 10; r++) if (grid[r]?.[c] === '#' && inside(c, r)) grid[r][c] = 'd';
      passes.push({ c: c0, r: Math.round(hW[j].y(c0)) });
    }
  }
  const nearPass = (c, r, d) => passes.some(p => Math.abs(p.c - c) < d && Math.abs(p.r - r) < d);

  // 區域的範圍（扣掉岩壁附近）：每個區域用 flood fill 找出屬於它的格子太慢，這裡直接用格子中心往外縮一圈
  const zoneRect = k => { const i = k % ZC, j = Math.floor(k / ZC); return { c0: i * ZS + 8, r0: j * ZS + 8, c1: (i + 1) * ZS - 8, r1: (j + 1) * ZS - 8 }; };
  const free = (c0, r0, w, h, pad) => {
    for (let r = r0 - pad; r < r0 + h + pad; r++) for (let c = c0 - pad; c < c0 + w + pad; c++) { const t = grid[r]?.[c]; if (t === undefined || t === '#' || t === 'B') return false; }
    return !nearPass(c0 + w / 2, r0 + h / 2, 10);
  };
  const buildings = [];
  const addB = (c, r, w, h, f, st) => { buildings.push([c, r, w, h, f, st]); for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) grid[y][x] = 'B'; };
  const blob = (c, r, rad, ch) => { for (let y = Math.floor(r - rad); y <= r + rad; y++) for (let x = Math.floor(c - rad); x <= c + rad; x++) if (Math.hypot(x - c, y - r) <= rad && inside(x, y) && grid[y][x] !== 'B') grid[y][x] = ch; };

  for (let k = 0; k < ZC * ZR; k++) {
    const R = zoneRect(k), th = themes[k], style = ri(0, 2);
    // 地面：荒野、廢墟是荒地，街區、廣場是混凝土
    if (th === 'open' || th === 'ruins') for (let r = R.r0 - 8; r < R.r1 + 8; r++) for (let c = R.c0 - 8; c < R.c1 + 8; c++) if (grid[r]?.[c] === '.') grid[r][c] = 'd';
    if (th === 'city') {
      // 棋盤格：街廓 9～13 格、路寬 6～7 格；每個街廓裡 1～3 棟，貼著街廓邊
      let r = R.r0;
      while (r < R.r1 - 6) {
        const bh = ri(9, 13); let c = R.c0 + ri(0, 4);
        while (c < R.c1 - 6) {
          const bw = ri(9, 13);
          let n = ri(2, 4);
          for (let q = 0; q < 24 && buildings.length < 2000; q++) {
            const w = ri(2, 5), h = ri(2, 5), x = c + ri(0, Math.max(0, bw - w)), y = r + ri(0, Math.max(0, bh - h));
            if (x + w > R.c1 || y + h > R.r1) continue;
            if (free(x, y, w, h, 1)) { addB(x, y, w, h, ri(1, 4), rand() < 0.8 ? style : ri(0, 2)); if (--n <= 0) break; }
          }
          c += bw + ri(6, 7);
        }
        r += bh + ri(6, 7);
      }
    } else if (th === 'ruins') {
      for (let q = 0, n = 0; q < 200 && n < 16; q++) {
        const w = ri(2, 3), h = ri(2, 3), x = ri(R.c0, R.c1 - w), y = ri(R.r0, R.r1 - h);
        if (free(x, y, w, h, 3)) { addB(x, y, w, h, rand() < 0.7 ? 1 : 2, style); n++; }
      }
      for (let q = 0; q < 4; q++) blob(ri(R.c0, R.c1), ri(R.r0, R.r1), ri(2, 4), 'm');
    } else if (th === 'plaza') {
      const cx = (R.c0 + R.c1) / 2, cy = (R.r0 + R.r1) / 2;
      for (let q = 0, n = 0; q < 300 && n < 14; q++) {
        const a = rand() * Math.PI * 2, d = ri(17, 22), w = ri(2, 4), h = ri(2, 4);
        const x = Math.round(cx + Math.cos(a) * d - w / 2), y = Math.round(cy + Math.sin(a) * d - h / 2);
        if (free(x, y, w, h, 2)) { addB(x, y, w, h, ri(2, 4), style); n++; }
      }
      // 廣場中間幾塊低矮掩體（岩塊）
      for (let q = 0; q < 4; q++) { const a = q * Math.PI / 2 + rand(), d = ri(5, 9); blob(Math.round(cx + Math.cos(a) * d), Math.round(cy + Math.sin(a) * d), 1.2, '#'); }
    } else {
      for (let q = 0; q < ri(6, 10); q++) { const x = ri(R.c0, R.c1), y = ri(R.r0, R.r1); if (!nearPass(x, y, 12)) blob(x, y, 1 + rand() * 1.8, '#'); }
      for (let q = 0; q < ri(2, 4); q++) blob(ri(R.c0, R.c1), ri(R.r0, R.r1), ri(3, 6), 'm');
      for (let q = 0, n = 0; q < 80 && n < ri(2, 4); q++) { const w = ri(2, 3), h = ri(2, 3), x = ri(R.c0, R.c1 - w), y = ri(R.r0, R.r1 - h); if (free(x, y, w, h, 4)) { addB(x, y, w, h, ri(1, 2), style); n++; } }
    }
  }

  // 出發點：出發區中間附近的空地
  const clear = (c, r, n = 2) => { for (let y = r - n; y <= r + n; y++) for (let x = c - n; x <= c + n; x++) { const t = grid[y]?.[x]; if (t === undefined || t === '#' || t === 'B') return false; } return true; };
  const sR = zoneRect(startZ);
  let sc = Math.round((sR.c0 + sR.c1) / 2), sr = Math.round((sR.r0 + sR.r1) / 2);
  for (let k = 0; k < 400 && !clear(sc, sr, 3); k++) { sc = ri(sR.c0, sR.c1); sr = ri(sR.r0, sR.r1); }

  // 連通：從出發點 flood fill，走不到的空地填成岩塊（被建築或岩石圍死的角落）
  const seen = new Uint8Array(W * H), q = [sr * W + sc];
  seen[q[0]] = 1;
  while (q.length) {
    const p = q.pop(), c = p % W, r = (p - c) / W;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = c + dc, y = r + dr, t = grid[y]?.[x];
      if (t === undefined || t === '#' || t === 'B' || seen[y * W + x]) continue;
      seen[y * W + x] = 1; q.push(y * W + x);
    }
  }
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (!seen[r * W + c] && grid[r][c] !== '#' && grid[r][c] !== 'B') grid[r][c] = '#';

  // 區域深度：從出發區穿過幾個隘口
  const adj = Array.from({ length: ZC * ZR }, () => []);
  for (const [a, b] of open) { adj[a].push(b); adj[b].push(a); }
  const depth = Array(ZC * ZR).fill(-1); depth[startZ] = 0;
  for (const qq = [startZ]; qq.length;) { const z = qq.shift(); for (const n of adj[z]) if (depth[n] < 0) { depth[n] = depth[z] + 1; qq.push(n); } }

  // 遭遇點
  const toX = c => c - W / 2 + 0.5, toZ = r => r - H / 2 + 0.5;
  const sites = [];
  for (let k = 0; k < ZC * ZR; k++) {
    if (k === startZ) continue;
    const R = zoneRect(k), want = ri(2, 3);
    for (let t = 0, n = 0; t < 300 && n < want; t++) {
      const c = ri(R.c0, R.c1), r = ri(R.r0, R.r1);
      if (!seen[r * W + c] || !clear(c, r, 2) || nearPass(c, r, 14) || sites.some(s => Math.hypot(s.c - c, s.r - r) < 22)) continue;
      sites.push({ c, r, x: toX(c), z: toZ(r), zone: k, theme: themes[k], depth: depth[k] });
      n++;
    }
  }

  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (grid[r][c] === 'B') grid[r][c] = '.';
  return { id: 'world' + seed, seed, W, H, grid, buildings, spawn: { x: toX(sc), z: toZ(sr) }, zones: themes.map((t, k) => ({ theme: t, depth: depth[k], ...zoneRect(k) })), sites, startZ };
}
