// ---------- 遠征的駐軍規劃（main.js startStage、無頭模擬 tools/sim/expzone.mjs 共用） ----------
// 每個區域兩種駐軍輪流排在遭遇點、三成五是增援據點（出發區、第一圈除外）；支援隊搭在主力旁邊；守備據點蓋工事
// R：用地圖種子做的亂數 → 同一張圖一樣；呼叫前要先套上新數值（heavy.js applyHeavy：小隊表會被改）
import { DIFFS } from './ai.js';
import { HEAVY } from './heavy.js';
import { SQUADS, canEnter, pickSquad, pickSupport } from './parts.js';

export const DROP_CHANCE = 0.4;   // 一般小隊（不是守備 / 巡邏 / 支援）整隊空投登場的機率
// 敵人難度：新手為底，越深（depth：離出發區幾個隘口）、越後面的關卡越強
export function expDiff(depth, stage) {
  const D = DIFFS.easy, L = depth * 0.6 + (stage - 1) * 1.2;
  return { ...D, dmg: D.dmg * (1 + 0.2 * L), hp: D.hp * (1 + 0.15 * L), rest: Math.max(1.2, D.rest - 0.12 * L), err: Math.max(0.05, D.err - 0.02 * L) };
}
export function planSquads(map, R) {
  // 每個區域：兩種駐軍輪流排、三成五是增援據點（出發區、第一圈除外）；用地圖的種子決定 → 同一張圖一樣
  const zones = map.zones.map((Z, k) => ({ ...Z, squads: [pickSquad(Z.squadTheme ?? Z.theme, Z.depth, R, map.terrain), pickSquad(Z.squadTheme ?? Z.theme, Z.depth, R, map.terrain)], reinforce: k !== map.startZ && Z.depth >= 2 && R() < 0.35, n: 0 }));
  const mkSquad = (S, key, support = false) => {
    const D = SQUADS[key], units = D.units.slice(0, HEAVY.packSquadMax);   // 每隊最多 3 台（深處也不加人；跟觀戰的雜魚包一樣）
    return { ...S, layer: S.layer ?? 0, key, name: D.name, units: units.map(k => ({ key: k, hp: null, dead: false })), members: [], awake: false, found: false, cleared: false, hold: D.hold ?? 0, patrol: !support && !!D.patrol, wp: 0, legT: 0, link: [],
      entry: !support && !D.hold && !D.patrol && R() < DROP_CHANCE && units.every(k => canEnter(k, 'drop')) ? 'drop' : 'spread' };   // 登場方式：散開站著 / 玩家靠近才整隊空投
  };
  const squads = map.sites.map(S => { const Z = zones[S.zone]; return mkSquad(S, Z.squads[Z.n++ % 2]); });
  // 支援隊（SQUADS 的 support：砲擊陣地、狙擊組、突擊隊、旋停機隊）：單獨打不出傷害 → 不自己出現，
  //   跟同區的一隊主力搭在一起（主力後面 9～14 格，背對出發點那一側），兩隊互相連動（一隊醒、另一隊也醒）
  //   出發區、第一圈不放；越深越常有（第二圈 40%，每深一圈 +10%，最多 70%）
  for (const [k, Z] of zones.entries()) {
    if (k === map.startZ || Z.depth < 2 || R() > Math.min(0.7, 0.2 + 0.1 * Z.depth)) continue;
    const mains = squads.filter(S => S.zone === k && !S.hold && !S.support);
    if (!mains.length) continue;
    const M = mains[Math.floor(R() * mains.length)], key = pickSupport(Z.squadTheme ?? Z.theme, Z.depth, R);
    const at = key && supportSpot(map, M, R);
    if (!at) continue;
    const S = mkSquad({ ...M, ...at }, key, true);
    S.support = true; S.link = [M]; M.link.push(S);
    squads.push(S);
  }
  for (const S of squads) if (S.hold) fortify(map.layers[S.layer], map.W, map.H, S, R);
  return { zones, squads };
}
// 支援隊的位置：主力據點往「背對出發點」那一側 9～14 格（±50°），同一區、同一層、周圍 2 格都是空地（不是岩壁、懸崖、建築）
export function supportSpot(map, M, R) {
  const L = map.layers[M.layer ?? 0], W = map.W, H = map.H, zoneOf = L.zoneOf ?? map.zoneOf;
  const inB = (c, r) => L.buildings.some(([bc, br, bw, bh]) => c >= bc - 1 && c <= bc + bw && r >= br - 1 && r <= br + bh);
  const free = (c, r) => { for (let y = r - 2; y <= r + 2; y++) for (let x = c - 2; x <= c + 2; x++) { if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) return false; const t = L.grid[y][x]; if (t === '#' || t === 'v') return false; } return !inB(c, r); };
  const base = Math.atan2(M.z - map.spawn.z, M.x - map.spawn.x);
  for (let t = 0; t < 60; t++) {
    const a = base + (R() - 0.5) * 1.75, d = 9 + R() * 5, x = M.x + Math.cos(a) * d, z = M.z + Math.sin(a) * d;
    const c = Math.floor(x + W / 2), r = Math.floor(z + H / 2);
    if (c < 3 || r < 3 || c >= W - 3 || r >= H - 3 || (zoneOf && zoneOf[r * W + c] !== M.zone) || !free(c, r)) continue;
    return { x, z, c, r };
  }
  return null;
}
// 守備據點的工事：據點周圍半徑 5 格一圈 6 段矮掩體（1 層樓的建築，打得壞），中間留缺口
export function fortify(L, W, H, S, R) {
  const used = new Set();
  for (const [c, r, w, h] of L.buildings) for (let y = r - 1; y <= r + h; y++) for (let x = c - 1; x <= c + w; x++) used.add(y * W + x);
  const free = (c, r) => c > 1 && r > 1 && c < W - 2 && r < H - 2 && L.grid[r][c] !== '#' && L.grid[r][c] !== 'v' && !used.has(r * W + c);
  const a0 = R() * Math.PI * 2;
  for (let i = 0; i < 6; i++) {
    const a = a0 + i * Math.PI / 3 + (R() - 0.5) * 0.3, ns = Math.abs(Math.sin(a)) > 0.7, w = ns ? 2 : 1, h = ns ? 1 : 2;
    const c0 = Math.round(S.c + Math.cos(a) * 5 - w / 2), r0 = Math.round(S.r + Math.sin(a) * 5 - h / 2);
    let ok = true;
    for (let y = r0; y < r0 + h; y++) for (let x = c0; x < c0 + w; x++) if (!free(x, y)) ok = false;
    if (!ok) continue;
    L.buildings.push([c0, r0, w, h, 1, Math.floor(R() * 3)]);
    for (let y = r0; y < r0 + h; y++) for (let x = c0; x < c0 + w; x++) used.add(y * W + x);
  }
}
