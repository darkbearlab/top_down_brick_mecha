// ---------- 大地圖產生器（遠征模式） ----------
// 256 × 192。區域不是整齊的格子：撒 13～15 個種子點（有抖動、各自的「大小權重」），每格歸最近的種子 → 大小、形狀都不一樣的區域
//   座標先用幾個正弦扭一下再算距離 → 邊界彎彎曲曲；離兩個種子差不多近的格子（在邊界上）就是岩壁（厚 4～8 格、打不壞）
// 隘口：相鄰的區域（共用的岩壁夠長）先連成一棵樹（每個區域都走得到），再多開三成左右，讓路線有選擇
// 每個區域一種地形主題，決定建築怎麼蓋：
//   city 街區：棋盤格街道（路寬 6～7 格）、街廓裡 2～4 棟建築，視線短、轉角多
//   open 荒野：荒地、幾塊岩石和泥地當掩體、零星建築，視線長
//   ruins 廢墟：一堆矮小的建築散落，中等視線
//   plaza 廣場：中間一大片空地、外圍一圈建築
// 遭遇點：每個區域（出發區除外）2～4 個（看面積），離隘口和彼此有一段距離；離出發區越遠（要穿過幾個隘口）越難
// 補給箱：大約七成的區域有一個（強化模組）、另外 4 個武器箱；傳送門：最深的那一半區域裡挑一個
// 回傳 { id, seed, W, H, grid, buildings: [[c, r, w, h, 樓層, 風格]], spawn, zones, zoneOf, sites, caches, portal, startZ }
export const rng = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

export const THEMES = { city: '街區', open: '荒野', ruins: '廢墟', plaza: '廣場' };

export function genWorld(seed = Math.floor(Math.random() * 1e9), { W = 256, H = 192, NX = 5, NY = 3 } = {}) {
  const rand = rng(seed), ri = (a, b) => a + Math.floor(rand() * (b - a + 1)), pick = a => a[Math.floor(rand() * a.length)];
  const grid = Array.from({ length: H }, (_, r) => Array.from({ length: W }, (_, c) => (r === 0 || c === 0 || r === H - 1 || c === W - 1) ? '#' : '.'));
  const inside = (c, r) => c > 0 && r > 0 && c < W - 1 && r < H - 1;

  // 種子：5 × 3 格各一個、大幅抖動；隨機拿掉 0～2 個 → 有的區域特別大
  const seeds = [];
  const cw = W / NX, ch = H / NY;
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++)
    seeds.push({ c: Math.max(18, Math.min(W - 18, (i + 0.5 + (rand() - 0.5) * 0.7) * cw)), r: Math.max(18, Math.min(H - 18, (j + 0.5 + (rand() - 0.5) * 0.6) * ch)), w: rand() * 9 });
  // 出發區：最左邊、偏中間的那個
  const startOf = () => seeds.reduce((b, s, k) => s.c + Math.abs(s.r - H / 2) * 0.6 < seeds[b].c + Math.abs(seeds[b].r - H / 2) * 0.6 ? k : b, 0);
  for (let n = ri(0, 2); n > 0; n--) { const s = startOf(); let k; do k = ri(0, seeds.length - 1); while (k === s); seeds.splice(k, 1); }
  const NZ = seeds.length, startZ = startOf();

  // 每格：最近的區域、第二近的、邊界距離（第二近 - 最近）
  const p = Array.from({ length: 6 }, () => rand() * 6.28);
  const zoneOf = new Uint8Array(W * H), zone2 = new Uint8Array(W * H), edge = new Float32Array(W * H);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const x = c + 6 * Math.sin(r / 13 + p[0]) + 3 * Math.sin((r + c) / 7 + p[1]), y = r + 6 * Math.sin(c / 15 + p[2]) + 3 * Math.sin((c - r) / 8 + p[3]);
    let d1 = Infinity, d2 = Infinity, z1 = 0, z2 = 0;
    for (let k = 0; k < NZ; k++) {
      const d = Math.hypot(x - seeds[k].c, y - seeds[k].r) - seeds[k].w;
      if (d < d1) { d2 = d1; z2 = z1; d1 = d; z1 = k; } else if (d < d2) { d2 = d; z2 = k; }
    }
    const i = r * W + c;
    zoneOf[i] = z1; zone2[i] = z2; edge[i] = d2 - d1;
  }
  // 岩壁：邊界附近；厚度沿著邊界慢慢變。順便記下每一對相鄰區域的邊界格子
  const pairs = new Map();
  for (let r = 1; r < H - 1; r++) for (let c = 1; c < W - 1; c++) {
    const i = r * W + c, T = 6 + 2 * Math.sin(c / 9 + p[4]) * Math.sin(r / 11 + p[5]);
    if (edge[i] >= T) continue;
    grid[r][c] = '#';
    if (edge[i] > 2) continue;
    const a = Math.min(zoneOf[i], zone2[i]), b = Math.max(zoneOf[i], zone2[i]), key = a * 64 + b;
    if (!pairs.has(key)) pairs.set(key, { a, b, n: 0, sc: 0, sr: 0, tiles: [] });
    const P = pairs.get(key); P.n++; P.sc += c; P.sr += r; P.tiles.push([c, r]);
  }

  // 隘口：共用邊界夠長的才算相鄰；先長一棵樹，再多開一些。開在那段邊界中間附近（隨機偏一點）
  const adjPairs = [...pairs.values()].filter(P => P.n >= 18);
  const parent = [...Array(NZ).keys()], find = x => parent[x] === x ? x : (parent[x] = find(parent[x]));
  const open = [];
  for (const P of adjPairs.slice().sort(() => rand() - 0.5)) {
    const a = find(P.a), b = find(P.b);
    if (a !== b) { parent[a] = b; open.push(P); } else if (rand() < 0.3) open.push(P);
  }
  const passes = [];
  for (const P of open) {
    const rt = P.tiles[Math.floor(rand() * P.tiles.length)], mc = (P.sc / P.n + rt[0]) / 2, mr = (P.sr / P.n + rt[1]) / 2;
    const t = P.tiles.reduce((b, q) => Math.hypot(q[0] - mc, q[1] - mr) < Math.hypot(b[0] - mc, b[1] - mr) ? q : b);
    const A = seeds[P.a], B = seeds[P.b], ul = Math.hypot(B.c - A.c, B.r - A.r), ux = (B.c - A.c) / ul, uy = (B.r - A.r) / ul;
    const wide = ri(8, 11);
    for (let r = t[1] - 14; r <= t[1] + 14; r++) for (let c = t[0] - 14; c <= t[0] + 14; c++) {
      if (!inside(c, r) || grid[r][c] !== '#') continue;
      const dx = c - t[0], dy = r - t[1], along = dx * ux + dy * uy, across = -dx * uy + dy * ux;
      if (Math.abs(along) <= 10 && Math.abs(across) <= wide / 2) grid[r][c] = 'd';
    }
    passes.push({ c: t[0], r: t[1], a: P.a, b: P.b });
  }
  const nearPass = (c, r, d) => passes.some(q => Math.abs(q.c - c) < d && Math.abs(q.r - r) < d);

  // 區域主題：出發區是荒野；其他隨機，但街區至少 3 個
  const themes = [];
  for (let k = 0; k < NZ; k++) themes.push(k === startZ ? 'open' : pick(['city', 'city', 'open', 'ruins', 'plaza']));
  for (let n = themes.filter(t => t === 'city').length; n < 3; n++) { let k; do k = ri(0, NZ - 1); while (k === startZ || themes[k] === 'city'); themes[k] = 'city'; }

  // 每個區域的外框、面積
  const box = Array.from({ length: NZ }, () => ({ c0: W, r0: H, c1: 0, r1: 0, area: 0 }));
  for (let r = 1; r < H - 1; r++) for (let c = 1; c < W - 1; c++) {
    if (grid[r][c] === '#') continue;
    const B = box[zoneOf[r * W + c]];
    B.c0 = Math.min(B.c0, c); B.r0 = Math.min(B.r0, r); B.c1 = Math.max(B.c1, c); B.r1 = Math.max(B.r1, r); B.area++;
  }
  // (c, r) 在區域 k 裡、邊界距離至少 m
  const inZone = (c, r, k, m = 8) => inside(c, r) && zoneOf[r * W + c] === k && edge[r * W + c] >= m;
  const free = (c0, r0, w, h, pad, k) => {
    for (let r = r0 - pad; r < r0 + h + pad; r++) for (let c = c0 - pad; c < c0 + w + pad; c++) { const t = grid[r]?.[c]; if (t === undefined || t === '#' || t === 'B' || !inZone(c, r, k, 7)) return false; }
    return !nearPass(c0 + w / 2, r0 + h / 2, 10);
  };
  const buildings = [];
  const addB = (c, r, w, h, f, st) => { buildings.push([c, r, w, h, f, st]); for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) grid[y][x] = 'B'; };
  const blob = (c, r, rad, ch, k) => { for (let y = Math.floor(r - rad); y <= r + rad; y++) for (let x = Math.floor(c - rad); x <= c + rad; x++) if (Math.hypot(x - c, y - r) <= rad && inZone(x, y, k, 3) && grid[y][x] !== 'B') grid[y][x] = ch; };
  const rndIn = (k, m = 10) => { const B = box[k]; for (let t = 0; t < 200; t++) { const c = ri(B.c0, B.c1), r = ri(B.r0, B.r1); if (inZone(c, r, k, m)) return [c, r]; } return [Math.round(seeds[k].c), Math.round(seeds[k].r)]; };

  for (let k = 0; k < NZ; k++) {
    const B = box[k], th = themes[k], style = ri(0, 2);
    // 地面：荒野、廢墟是荒地，街區、廣場是混凝土
    if (th === 'open' || th === 'ruins') for (let r = B.r0; r <= B.r1; r++) for (let c = B.c0; c <= B.c1; c++) if (grid[r][c] === '.' && zoneOf[r * W + c] === k) grid[r][c] = 'd';
    if (th === 'city') {
      // 棋盤格：街廓 9～13 格、路寬 6～7 格；每個街廓裡 2～4 棟，只蓋在這個區域裡面
      let r = B.r0 + ri(2, 6);
      while (r < B.r1 - 6) {
        const bh = ri(9, 13); let c = B.c0 + ri(2, 6);
        while (c < B.c1 - 6) {
          const bw = ri(9, 13);
          let n = ri(2, 4);
          for (let q = 0; q < 24 && buildings.length < 2000; q++) {
            const w = ri(2, 5), h = ri(2, 5), x = c + ri(0, Math.max(0, bw - w)), y = r + ri(0, Math.max(0, bh - h));
            if (free(x, y, w, h, 1, k)) { addB(x, y, w, h, ri(1, 4), rand() < 0.8 ? style : ri(0, 2)); if (--n <= 0) break; }
          }
          c += bw + ri(6, 7);
        }
        r += bh + ri(6, 7);
      }
    } else if (th === 'ruins') {
      const want = Math.round(B.area / 260);
      for (let q = 0, n = 0; q < 300 && n < want; q++) {
        const w = ri(2, 3), h = ri(2, 3), [x, y] = rndIn(k, 8);
        if (free(x, y, w, h, 3, k)) { addB(x, y, w, h, rand() < 0.7 ? 1 : 2, style); n++; }
      }
      for (let q = 0; q < 4; q++) { const [x, y] = rndIn(k); blob(x, y, ri(2, 4), 'm', k); }
    } else if (th === 'plaza') {
      const cx = Math.round(seeds[k].c), cy = Math.round(seeds[k].r);
      for (let q = 0, n = 0; q < 300 && n < 14; q++) {
        const a = rand() * Math.PI * 2, d = ri(16, 22), w = ri(2, 4), h = ri(2, 4);
        const x = Math.round(cx + Math.cos(a) * d - w / 2), y = Math.round(cy + Math.sin(a) * d - h / 2);
        if (free(x, y, w, h, 2, k)) { addB(x, y, w, h, ri(2, 4), style); n++; }
      }
      // 廣場中間幾塊低矮掩體（岩塊）
      for (let q = 0; q < 4; q++) { const a = q * Math.PI / 2 + rand(), d = ri(5, 9); blob(Math.round(cx + Math.cos(a) * d), Math.round(cy + Math.sin(a) * d), 1.2, '#', k); }
    } else {
      const n = Math.round(B.area / 450);
      for (let q = 0; q < n; q++) { const [x, y] = rndIn(k); if (!nearPass(x, y, 12)) blob(x, y, 1 + rand() * 1.8, '#', k); }
      for (let q = 0; q < ri(2, 4); q++) { const [x, y] = rndIn(k); blob(x, y, ri(3, 6), 'm', k); }
      for (let q = 0, m = 0, want = ri(2, 4); q < 80 && m < want; q++) { const w = ri(2, 3), h = ri(2, 3), [x, y] = rndIn(k); if (free(x, y, w, h, 4, k)) { addB(x, y, w, h, ri(1, 2), style); m++; } }
    }
  }

  // 出發點：出發區種子附近的空地
  const clear = (c, r, n = 2) => { for (let y = r - n; y <= r + n; y++) for (let x = c - n; x <= c + n; x++) { const t = grid[y]?.[x]; if (t === undefined || t === '#' || t === 'B') return false; } return true; };
  let sc = Math.round(seeds[startZ].c), sr = Math.round(seeds[startZ].r);
  for (let k = 0; k < 400 && !clear(sc, sr, 3); k++) [sc, sr] = rndIn(startZ, 12);

  // 連通：從出發點 flood fill，走不到的空地填成岩塊（被建築或岩石圍死的角落）
  const seen = new Uint8Array(W * H), q = [sr * W + sc];
  seen[q[0]] = 1;
  while (q.length) {
    const i = q.pop(), c = i % W, r = (i - c) / W;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = c + dc, y = r + dr, t = grid[y]?.[x];
      if (t === undefined || t === '#' || t === 'B' || seen[y * W + x]) continue;
      seen[y * W + x] = 1; q.push(y * W + x);
    }
  }
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (!seen[r * W + c] && grid[r][c] !== '#' && grid[r][c] !== 'B') grid[r][c] = '#';

  // 區域深度：從出發區穿過幾個隘口
  const adj = Array.from({ length: NZ }, () => []);
  for (const P of open) { adj[P.a].push(P.b); adj[P.b].push(P.a); }
  const depth = Array(NZ).fill(-1); depth[startZ] = 0;
  for (const qq = [startZ]; qq.length;) { const z = qq.shift(); for (const n of adj[z]) if (depth[n] < 0) { depth[n] = depth[z] + 1; qq.push(n); } }

  const toX = c => c - W / 2 + 0.5, toZ = r => r - H / 2 + 0.5;
  const ok = (c, r, n, m, k) => seen[r * W + c] && clear(c, r, n) && inZone(c, r, k, m);
  // 遭遇點
  const sites = [];
  for (let k = 0; k < NZ; k++) {
    if (k === startZ) continue;
    const want = Math.max(2, Math.min(4, Math.round(box[k].area / 1500)));
    for (let t = 0, n = 0; t < 300 && n < want; t++) {
      const [c, r] = rndIn(k, 14);
      if (!ok(c, r, 2, 14, k) || nearPass(c, r, 14) || sites.some(s => Math.hypot(s.c - c, s.r - r) < 22)) continue;
      sites.push({ c, r, x: toX(c), z: toZ(r), zone: k, theme: themes[k], depth: depth[k] });
      n++;
    }
  }
  // 傳送門：最深的那一半區域裡挑一個，離遭遇點遠一點
  const deep = [...Array(NZ).keys()].filter(k => k !== startZ).sort((a, b) => depth[b] - depth[a]);
  let portal = null;
  for (const k of deep.slice(0, Math.max(1, Math.ceil(deep.length / 2))).sort(() => rand() - 0.5)) {
    for (let t = 0; t < 200 && !portal; t++) {
      const [c, r] = rndIn(k, 14);
      if (ok(c, r, 3, 14, k) && !nearPass(c, r, 12) && !sites.some(s => Math.hypot(s.c - c, s.r - r) < 14)) portal = { c, r, x: toX(c), z: toZ(r), zone: k };
    }
    if (portal) break;
  }
  if (!portal) portal = { c: sc + 6, r: sr, x: toX(sc + 6), z: toZ(sr), zone: startZ };
  // 補給箱：七成的區域有一個強化模組箱，再撒 4 個武器箱（不放在出發區）
  const caches = [];
  const place = (k, kind) => {
    for (let t = 0; t < 200; t++) {
      const [c, r] = rndIn(k, 8);
      if (!ok(c, r, 1, 8, k) || sites.some(s => Math.hypot(s.c - c, s.r - r) < 9) || caches.some(s => Math.hypot(s.c - c, s.r - r) < 14) || Math.hypot(portal.c - c, portal.r - r) < 8 || Math.hypot(sc - c, sr - r) < 6) continue;
      caches.push({ c, r, x: toX(c), z: toZ(r), zone: k, kind });
      return;
    }
  };
  for (let k = 0; k < NZ; k++) if (rand() < 0.7) place(k, 'mod');
  for (let n = 0; n < 4; n++) { let k; do k = ri(0, NZ - 1); while (k === startZ); place(k, 'weapon'); }

  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (grid[r][c] === 'B') grid[r][c] = '.';
  return {
    id: 'world' + seed, seed, W, H, grid, buildings, spawn: { x: toX(sc), z: toZ(sr) }, zoneOf, startZ, sites, caches, portal,
    zones: themes.map((t, k) => ({ theme: t, depth: depth[k], c: seeds[k].c, r: seeds[k].r, area: box[k].area })),
  };
}
