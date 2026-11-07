// ---------- 關卡（多層地圖） ----------
// 一關 = 好幾層一樣大、共用世界座標的地圖（layers，照高度排：0 = 最低）+ 層與層之間的連接（links）；同一時間只有玩家那層在動
// 每層：{ name, grid, buildings, edge（迷霧不看穿的格子）, zoneOf, sight（視線距離）, under, tall }
// 連接：{ kind, a: { layer, x, z }, b: { layer, x, z } }
//   lift   升降梯：雙向（a = 下面、b = 上面）
//   pad    彈射台：只能從 a（下面）往上跳到 b
//   drop   跳下點：只能從 a（崖邊）往下跳到 b
//   stairs 地下入口：雙向（a = 地下、b = 地表，同一個位置）
// 關卡地形（terrain）：
//   ruins 沙漠廢墟：現在這張大地圖（mapgen.js）當地表，加 2～3 條地下隧道：兩頭各是地表上的一個入口，中間有一兩個地下大廳（駐軍、補給）
//   hive  層疊城塞：同一套分區產生器，但每個區域有自己的「層」（往右越高），一層一層像山坡上的貧民窟
//         比自己低的區域 = 懸空（往下看得到）；比自己高的 = 崖壁；不同層的區域之間的隘口變成升降梯 / 彈射台，崖邊另外有幾個跳下點
//         傳送門在最高那層
import { genWorld, rng } from './mapgen.js';

export const TERRAINS = { ruins: '沙漠廢墟', hive: '層疊城塞' };
export const terrainOf = stage => stage % 2 === 0 ? 'hive' : 'ruins';   // 第 1、3、5… 關廢墟，2、4… 關城塞

export function genStage(seed = Math.floor(Math.random() * 1e9), stage = 1, terrain = terrainOf(stage)) {
  return terrain === 'hive' ? genHive(seed, stage) : genRuins(seed, stage);
}

const toXf = W => c => c - W / 2 + 0.5, toZf = H => r => r - H / 2 + 0.5;
const fromX = (W, x) => Math.floor(x + W / 2), fromZ = (H, z) => Math.floor(z + H / 2);

// ---------- 沙漠廢墟 + 地下 ----------
function genRuins(seed, stage) {
  const m = genWorld(seed), R = rng(seed * 3 + 101), { W, H } = m, toX = toXf(W), toZ = toZf(H);
  const A = m.grid, zones = m.zones.map(Z => ({ ...Z, layer: 1 }));
  const B = Array.from({ length: H }, () => Array(W).fill('#')), zoneB = new Uint8Array(W * H).fill(255);
  const clearA = (c, r, n) => { for (let y = r - n; y <= r + n; y++) for (let x = c - n; x <= c + n; x++) { const t = A[y]?.[x]; if (t === undefined || t === '#') return false; } return true; };
  const inBuilding = (c, r, pad) => m.buildings.some(([bc, br, bw, bh]) => c >= bc - pad && c < bc + bw + pad && r >= br - pad && r < br + bh + pad);
  const far = (c, r, list, d) => list.every(q => Math.hypot(q.c - c, q.r - r) >= d);
  const used = [];
  const entrance = k => {
    for (let t = 0; t < 300; t++) {
      const c = Math.round(m.zones[k].c + (R() - 0.5) * 50), r = Math.round(m.zones[k].r + (R() - 0.5) * 40);
      if (c < 12 || r < 12 || c > W - 13 || r > H - 13 || m.zoneOf[r * W + c] !== k || m.edge[r * W + c] < 7) continue;
      if (!clearA(c, r, 2) || inBuilding(c, r, 2) || !far(c, r, m.sites, 9) || !far(c, r, m.caches, 6) || !far(c, r, used, 30) || Math.hypot(m.portal.c - c, m.portal.r - r) < 12) continue;
      const sc = fromX(W, m.spawn.x), sr = fromZ(H, m.spawn.z);
      if (Math.hypot(sc - c, sr - r) < 10) continue;
      return { c, r };
    }
    return null;
  };
  const carve = (c, r, rad, ch = '.') => {
    for (let y = Math.floor(r - rad); y <= r + rad; y++) for (let x = Math.floor(c - rad); x <= c + rad; x++)
      if (x > 6 && y > 6 && x < W - 7 && y < H - 7 && Math.hypot(x - c, y - r) <= rad) { B[y][x] = ch; zoneB[y * W + x] = zoneId; }
  };
  let zoneId = 0;
  const links = [], sites = [], caches = [];
  const tunnels = 2 + (stage >= 3 ? 1 : 0);
  const cand = [...Array(m.zones.length).keys()].filter(k => k !== m.startZ);
  for (let n = 0, tries = 0; n < tunnels && tries < 40; tries++) {
    const za = cand[Math.floor(R() * cand.length)], zb = cand[Math.floor(R() * cand.length)];
    if (za === zb) continue;
    const pa = entrance(za); if (!pa) continue;
    const pb = entrance(zb); if (!pb) continue;
    const L = Math.hypot(pb.c - pa.c, pb.r - pa.r);
    if (L < 45 || L > 130) continue;
    used.push(pa, pb);
    zoneId = zones.length;
    // 路線：起點、一兩個大廳（往旁邊偏）、終點；沿線挖 5～6 格寬、寬度慢慢變的隧道
    const ux = (pb.c - pa.c) / L, uy = (pb.r - pa.r) / L, halls = L > 80 ? 2 : 1, pts = [pa];
    for (let h = 1; h <= halls; h++) {
      const t = h / (halls + 1), off = (R() - 0.5) * 36;
      pts.push({ c: Math.max(18, Math.min(W - 19, pa.c + (pb.c - pa.c) * t - uy * off)), r: Math.max(18, Math.min(H - 19, pa.r + (pb.r - pa.r) * t + ux * off)), hall: true });
    }
    pts.push(pb);
    const ph = R() * 6;
    for (let i = 0; i + 1 < pts.length; i++) {
      const P = pts[i], Q = pts[i + 1], d = Math.hypot(Q.c - P.c, Q.r - P.r), bend = (R() - 0.5) * 14;
      for (let s = 0; s <= d; s += 0.5) {
        const t = s / d, w = Math.sin(t * Math.PI) * bend;
        const c = P.c + (Q.c - P.c) * t - (Q.r - P.r) / d * w, r = P.r + (Q.r - P.r) * t + (Q.c - P.c) / d * w;
        carve(c, r, 2.5 + 0.6 * Math.sin(s / 5 + ph), R() < 0.15 ? 'd' : '.');
      }
    }
    carve(pa.c, pa.r, 4.5); carve(pb.c, pb.r, 4.5);
    const depth = Math.max(m.zones[za].depth, m.zones[zb].depth) + 1;
    for (const P of pts.filter(q => q.hall)) {
      const rad = 7 + R() * 2.5;
      carve(P.c, P.r, rad);
      // 大廳裡幾根柱子當掩體
      for (let q = 0; q < 4; q++) { const a = q * Math.PI / 2 + R(), d = rad * 0.5; const x = Math.round(P.c + Math.cos(a) * d), y = Math.round(P.r + Math.sin(a) * d); B[y][x] = '#'; if (R() < 0.5) B[y][x + 1] = '#'; }
      const c = Math.round(P.c), r = Math.round(P.r);
      sites.push({ c, r, x: toX(c), z: toZ(r), zone: zoneId, theme: 'under', depth, layer: 0 });
      const a = R() * Math.PI * 2, cc = Math.round(P.c + Math.cos(a) * (rad - 2.5)), cr = Math.round(P.r + Math.sin(a) * (rad - 2.5));
      if (B[cr][cc] !== '#') caches.push({ c: cc, r: cr, x: toX(cc), z: toZ(cr), zone: zoneId, kind: R() < 0.65 ? 'mod' : 'weapon', layer: 0 });
    }
    zones.push({ theme: 'under', squadTheme: 'city', depth, c: pts[1].c, r: pts[1].r, area: 0, layer: 0 });
    for (const P of [pa, pb]) links.push({ kind: 'stairs', a: { layer: 0, x: toX(P.c), z: toZ(P.r) }, b: { layer: 1, x: toX(P.c), z: toZ(P.r) } });
    n++;
  }
  const edgeB = new Uint8Array(W * H);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (B[r][c] === '#') edgeB[r * W + c] = 1;
  return {
    ...m, terrain: 'ruins', zones, links,
    sites: [...m.sites.map(s => ({ ...s, layer: 1 })), ...sites],
    caches: [...m.caches.map(s => ({ ...s, layer: 1 })), ...caches],
    portal: { ...m.portal, layer: 1 },
    spawn: { ...m.spawn, layer: 1 },
    layers: [
      { name: '地下', grid: B, buildings: [], edge: edgeB, zoneOf: zoneB, under: true, sight: 20 },
      { name: '地表', grid: A, buildings: m.buildings, edge: m.edgeBand, zoneOf: m.zoneOf },
    ],
  };
}

// ---------- 層疊城塞 ----------
function genHive(seed, stage) {
  const m = genWorld(seed, { themePool: ['city', 'city', 'city', 'ruins', 'plaza'] }), R = rng(seed * 5 + 77), { W, H } = m, toX = toXf(W), toZ = toZf(H);
  const NZ = m.zones.length, NL = stage >= 4 ? 4 : 3;
  // 每個區域的層：越往右越高（加一點亂數），出發區 0；用到的層壓緊成 0..n-1
  const cs = m.zones.map(Z => Z.c), c0 = Math.min(...cs), c1 = Math.max(...cs);
  let lvl = m.zones.map((Z, k) => k === m.startZ ? 0 : Math.max(0, Math.min(NL - 1, Math.floor((Z.c - c0) / (c1 - c0 + 1e-6) * NL + (R() - 0.5) * 0.9))));
  const usedL = [...new Set(lvl)].sort((a, b) => a - b);
  lvl = lvl.map(l => usedL.indexOf(l));
  const NLy = usedL.length;
  const RIDGE = 8.5;   // 邊界距離小於這個的岩壁 = 區域之間的岩脊（不是區域裡的岩塊）
  const layers = [];
  for (let k = 0; k < NLy; k++) {
    const g = Array.from({ length: H }, () => Array(W)), edge = new Uint8Array(W * H), tall = new Uint8Array(W * H);
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      const i = r * W + c, base = m.grid[r][c], l1 = lvl[m.zoneOf[i]], l2 = lvl[m.zone2[i]];
      let t;
      if (m.edgeBand[i]) { t = '#'; edge[i] = 1; }
      else if (l1 === k) t = base === '#' && m.edge[i] < RIDGE && l2 !== k ? 'd' : base;   // 跟不同層的區域交界：岩脊打開（崖邊 / 崖腳）
      else if (l1 < k) t = 'v';
      else { t = '#'; edge[i] = 1; tall[i] = 1; }
      g[r][c] = t;
    }
    layers.push({ name: `第 ${k + 1} 層`, grid: g, edge, tall, zoneOf: m.zoneOf, buildings: m.buildings.filter(([c, r, w, h]) => lvl[m.zoneOf[(r + (h >> 1)) * W + c + (w >> 1)]] === k) });
  }
  const at = (k, c, r) => layers[k].grid[r]?.[c];
  const stand = (k, c, r, n = 1) => { for (let y = r - n; y <= r + n; y++) for (let x = c - n; x <= c + n; x++) { const t = at(k, x, y); if (t === undefined || t === '#' || t === 'v') return false; } return !inBld(k, c, r); };
  const inBld = (k, c, r) => layers[k].buildings.some(([bc, br, bw, bh]) => c >= bc - 1 && c < bc + bw + 1 && r >= br - 1 && r < br + bh + 1);
  // 在 (c, r) 附近找第 k 層、區域 z 裡站得住的格子（離中心最近的）
  const near = (k, z, c, r, rad = 12, n = 1) => {
    let best = null, bd = Infinity;
    for (let y = r - rad; y <= r + rad; y++) for (let x = c - rad; x <= c + rad; x++) {
      if (m.zoneOf[y * W + x] !== z && z >= 0) continue;
      const d = Math.hypot(x - c, y - r);
      if (d < bd && stand(k, x, y, n)) { bd = d; best = { c: x, r: y }; }
    }
    return best;
  };
  const P = (k, q) => ({ layer: k, x: toX(q.c), z: toZ(q.r) });
  // 連接：不同層的區域之間的隘口 → 樹上的是升降梯（雙向），多開的是彈射台（只能往上）
  const links = [];
  for (const ps of m.passes) {
    const la = lvl[ps.a], lb = lvl[ps.b];
    if (la === lb) continue;
    const [lo, hi] = la < lb ? [ps.a, ps.b] : [ps.b, ps.a];
    const qa = near(lvl[lo], lo, ps.c, ps.r), qb = near(lvl[hi], hi, ps.c, ps.r);
    if (!qa || !qb) continue;
    links.push({ kind: ps.tree ? 'lift' : 'pad', a: P(lvl[lo], qa), b: P(lvl[hi], qb) });
  }
  // 跳下點：崖邊（旁邊兩格內就是懸空）往外看，下面那層站得住的地方
  const drops = [];
  for (let t = 0; t < 4000 && drops.length < 4 + NLy; t++) {
    const k = 1 + Math.floor(R() * (NLy - 1)), c = 10 + Math.floor(R() * (W - 20)), r = 10 + Math.floor(R() * (H - 20));
    if (!stand(k, c, r, 1) || drops.some(d => Math.hypot(d.c - c, d.r - r) < 30)) continue;
    let hit = null;
    for (let a = 0; a < 8 && !hit; a++) {
      const dx = Math.round(Math.cos(a * Math.PI / 4)), dy = Math.round(Math.sin(a * Math.PI / 4));
      if (at(k, c + dx * 3, r + dy * 3) !== 'v') continue;
      for (let s = 4; s <= 9; s++) {
        const x = c + dx * s, y = r + dy * s, lk = lvl[m.zoneOf[y * W + x]];
        if (lk < k && stand(lk, x, y, 1)) { hit = { k: lk, c: x, r: y }; break; }
      }
    }
    if (!hit) continue;
    drops.push({ c, r });
    links.push({ kind: 'drop', a: P(k, { c, r }), b: P(hit.k, hit) });
  }
  // 每層從出發點 / 連接點 flood fill，走不到的地方填成岩塊（被崖壁圍死的角落）
  const sc = fromX(W, m.spawn.x), sr = fromZ(H, m.spawn.z);
  for (let k = 0; k < NLy; k++) {
    const g = layers[k].grid, seen = new Uint8Array(W * H), q = [];
    const seed0 = (x, z) => { const c = fromX(W, x), r = fromZ(H, z), i = r * W + c; if (!seen[i] && g[r][c] !== '#' && g[r][c] !== 'v') { seen[i] = 1; q.push(i); } };
    if (k === 0) seed0(m.spawn.x, m.spawn.z);
    for (const L of links) for (const e of [L.a, L.b]) if (e.layer === k) seed0(e.x, e.z);
    while (q.length) {
      const i = q.pop(), c = i % W, r = (i - c) / W;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const x = c + dc, y = r + dr, t = g[y]?.[x];
        if (t === undefined || t === '#' || t === 'v' || seen[y * W + x]) continue;
        seen[y * W + x] = 1; q.push(y * W + x);
      }
    }
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) if (!seen[r * W + c] && g[r][c] !== '#' && g[r][c] !== 'v') { g[r][c] = '#'; layers[k].edge[r * W + c] = 1; }
    layers[k].buildings = layers[k].buildings.filter(([c, r]) => g[r][c] !== '#');
  }
  const ok = (k, c, r) => stand(k, c, r, 1);
  const sites = m.sites.map(s => ({ ...s, layer: lvl[s.zone] })).filter(s => ok(s.layer, s.c, s.r));
  const caches = m.caches.map(s => ({ ...s, layer: lvl[s.zone] })).filter(s => ok(s.layer, s.c, s.r));
  // 傳送門：最高那層、最深的區域，離遭遇點遠一點
  const top = [...Array(NZ).keys()].filter(k => lvl[k] === NLy - 1).sort((a, b) => m.zones[b].depth - m.zones[a].depth);
  let portal = null;
  for (const z of top) {
    for (let t = 0; t < 200 && !portal; t++) {
      const c = Math.round(m.zones[z].c + (R() - 0.5) * 30), r = Math.round(m.zones[z].r + (R() - 0.5) * 24);
      if (m.zoneOf[r * W + c] === z && stand(NLy - 1, c, r, 3) && sites.every(s => Math.hypot(s.c - c, s.r - r) > 14) && layers[NLy - 1].grid[r][c] !== '#')
        portal = { c, r, x: toX(c), z: toZ(r), zone: z, layer: NLy - 1 };
    }
    if (portal) break;
  }
  if (!portal) { const z = top[0], q = near(NLy - 1, z, Math.round(m.zones[z].c), Math.round(m.zones[z].r), 30, 2); portal = { c: q.c, r: q.r, x: toX(q.c), z: toZ(q.r), zone: z, layer: NLy - 1 }; }
  return {
    ...m, terrain: 'hive', links, sites, caches, portal,
    zones: m.zones.map((Z, k) => ({ ...Z, layer: lvl[k] })),
    spawn: { ...m.spawn, layer: 0 },
    layers,
  };
}
