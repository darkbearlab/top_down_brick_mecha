// ---------- 遠征遭遇模擬（無頭） ----------
// 用真的遠征地圖（stagegen.js genStage）和真的駐軍規劃（explan.js planSquads），讓內建 AI（王牌戰術）開著遠征的初始配裝，
//   一場一個遭遇點：從出發點那一側、照路程 28～36 格外走過去，把那隊主力（連同搭配的支援隊）打掉；量勝率、損血比例
// 只是參考值：電腦開的不是玩家；沒有強化模組、修理、補給、空投登場、增援、別的小隊被驚動過來（只看這一個遭遇點）
// 用法：node --import ./tools/sim/register.mjs tools/sim/expzone.mjs [--stage 1] [--maps 6] [--seed 1] [--max 150] [--lo 配裝.json]
//   --stage：第幾關（> 1 時照 startRun：空掛點補隨機武器，最多 2 把）；--maps：幾張圖（每張圖跑全部的主力遭遇點）
import { readFileSync } from 'node:fs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => { if (v.startsWith('--')) a.push([v.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] == null ? true : all[i + 1]]); return a; }, []));
const STAGE = +(args.stage ?? 1), MAPS = +(args.maps ?? 6), SEED = +(args.seed ?? 1), MAX_T = +(args.max ?? 150), DT = 1 / 60, WAKE_R = 24;

const { G } = await import('../../src/core.js');
const { loadMap, isSolid, rayBlock } = await import('../../src/arena.js');
const { resetBuildings, setLayout, updateBuildings } = await import('../../src/buildings.js');
const { collideMechs, driveMech, mechs, removeMech } = await import('../../src/mech.js');
const { clearShots, updateShots } = await import('../../src/weapons.js');
const { AI, DIFFS, enemies, spawnEnemy, stepMech, updateEnemy } = await import('../../src/ai.js');
const { DEFAULT_LOADOUT, SLOTS, WEAPONS, gruntOf } = await import('../../src/parts.js');
const { updateStatus } = await import('../../src/status.js');
const { clearWrecks, updateWrecks } = await import('../../src/wreck.js');
const { updateParticles } = await import('../../src/fx.js');
const { updateFlow } = await import('../../src/pathing.js');
const { applyHeavy } = await import('../../src/heavy.js');
const { genStage } = await import('../../src/stagegen.js');
const { rng } = await import('../../src/mapgen.js');
const { expDiff, planSquads } = await import('../../src/explan.js');
applyHeavy();
// 試調：--gspeed 雜魚極速倍率、--ghp 雜魚血量倍率（蓋掉 heavy.js 的值）
const { AI_TUNE } = await import('../../src/ai.js');
if (args.gspeed) AI_TUNE.gruntSpeedK = +args.gspeed;
if (args.ghp) AI_TUNE.gruntHpMul = +args.ghp;

const mulberry = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const START = { armL: null, armR: 'mg', backL: 'missile', backR: null };
const PLAYER_WEAPONS = Object.keys(WEAPONS).filter(k => !WEAPONS[k].low);
function aceLoadout(R) {
  const lo = { ...structuredClone(args.lo ? JSON.parse(readFileSync(args.lo, 'utf8')) : DEFAULT_LOADOUT), ...START, name: '玩家（電腦開）', chips: [], device: null };
  let n = Math.min(2, STAGE - 1);
  for (const s of SLOTS) { if (n <= 0 || lo[s]) continue; const pool = PLAYER_WEAPONS.filter(id => s.startsWith(WEAPONS[id].mount)); lo[s] = pool[Math.floor(R() * pool.length)]; n--; }
  return lo;
}
const hpK = m => { let a = 0, b = 0; for (const p of Object.values(m.parts)) { a += Math.max(0, p.hp); b += p.max; } return a / b; };
const sees = (e, o, R) => { const dx = o.x - e.x, dz = o.z - e.z, d = Math.hypot(dx, dz); return d <= R && rayBlock(e.x, e.z, dx / d, dz / d, d) >= d - o.r; };

// 從據點照路程（4 方向 BFS、不穿岩壁 / 懸崖 / 建築）找 28～36 格外、周圍 1 格空曠的格子，挑離出發點最近的（玩家從那邊過來）
function startSpot(L, W, H, S, spawn) {
  const blocked = new Uint8Array(W * H);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) { const t = L.grid[r][c]; if (t === '#' || t === 'v') blocked[r * W + c] = 1; }
  for (const [c, r, w, h] of L.buildings) for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) blocked[y * W + x] = 1;
  const dist = new Int32Array(W * H).fill(-1), q = [S.r * W + S.c];
  dist[q[0]] = 0;
  for (let i = 0; i < q.length; i++) {
    const j = q[i], c = j % W, r = (j - c) / W;
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const x = c + dc, y = r + dr, k = y * W + x; if (x > 0 && y > 0 && x < W - 1 && y < H - 1 && !blocked[k] && dist[k] < 0) { dist[k] = dist[j] + 1; q.push(k); } }
  }
  let best = null, bd = Infinity;
  for (const j of q) {
    if (dist[j] < 28 || dist[j] > 36) continue;
    const c = j % W, r = (j - c) / W;
    let open = true;
    for (let y = r - 1; y <= r + 1 && open; y++) for (let x = c - 1; x <= c + 1; x++) if (blocked[y * W + x]) { open = false; break; }
    if (!open) continue;
    const x = c - W / 2 + 0.5, z = r - H / 2 + 0.5, d = Math.hypot(x - spawn.x, z - spawn.z);
    if (d < bd) { bd = d; best = { x, z }; }
  }
  return best;
}
function spreadAt(S, taken, R) {
  const [r0, r1] = S.hold ? [2, 4] : [3, 7];
  for (let t = 0; t < 40; t++) {
    const a = R() * Math.PI * 2, r = r0 + R() * (r1 - r0), x = S.x + Math.cos(a) * r, z = S.z + Math.sin(a) * r;
    let ok = !taken.some(p => Math.hypot(p.x - x, p.z - z) < 2.5);
    for (let dz = -1; dz <= 1 && ok; dz++) for (let dx = -1; dx <= 1; dx++) if (isSolid(x + dx * 1.2, z + dz * 1.2)) { ok = false; break; }
    if (ok) return { x, z };
  }
  return { x: S.x, z: S.z };
}

function encounter(map, L, M, R, idx) {
  for (const m of mechs.slice()) removeMech(m);
  enemies.length = 0;
  clearShots(); clearWrecks(); resetBuildings();
  G.now = 0; G.paused = false; G.slowMo = 0; G.hitStop = 0;
  AI.passive = false; AI.sandbox = false; AI.diff = DIFFS.easy;
  const at = startSpot(L, map.W, map.H, M, map.spawn);
  if (!at) return null;
  const dummy = { x: M.x, z: M.z, alive: true, team: 'none' };
  const ace = spawnEnemy(dummy, aceLoadout(R), at, { team: 'player', diff: DIFFS.hard });
  const groups = [M, ...M.link], reds = [];
  for (const S of groups) {
    S.members = []; S.awake = false; S.mem = {};
    const taken = [];
    for (const u of S.units) {
      const p = spreadAt(S, taken, R); taken.push(p);
      const P = gruntOf(u.key), e = spawnEnemy(dummy, P, p, { team: 'enemy', diff: expDiff(S.depth, STAGE), grunt: true, noDrop: true });
      e.dormant = true; e.squad = S; e.fixed = !!P.fixed; e.foe = ace; e.seenHp = e.parts.torso.hp;
      if (S.hold) e.hold = { x: S.x, z: S.z, r: S.hold };
      S.members.push(e); reds.push(e);
    }
  }
  let t = 0, win = null;
  while (t < MAX_T) {
    G.now += DT; t += DT;
    updateFlow(DT, ace.x, ace.z);
    // 醒來：看到玩家（24 格內）或被打 → 連動的小隊一起醒、共享記憶（main.js alertNear）
    for (const S of groups) {
      if (S.awake) continue;
      const live = S.members.filter(e => e.alive);
      let hit = false;
      for (const e of live) { if (e.parts.torso.hp < e.seenHp - 0.01) hit = true; e.seenHp = e.parts.torso.hp; }
      if (live.some(e => sees(e, ace, WAKE_R)) || hit) for (const O of groups) { O.awake = true; O.mem[ace.id] = { x: ace.x, z: ace.z, t: G.now, src: 'sight' }; for (const e of O.members) e.dormant = false; }
    }
    // 玩家（電腦）：打最近的醒著的；都沒醒 → 往最近的那台走（照路線）
    let bd = Infinity, near = null;
    const awakeAny = reds.some(e => e.alive && !e.dormant);
    for (const e of reds) if (e.alive && (!awakeAny || !e.dormant)) { const d = Math.hypot(e.x - ace.x, e.z - ace.z); if (d < bd) { bd = d; near = e; } }
    ace.foe = near;
    for (const e of [ace, ...reds]) {
      if (!e.alive || !e.foe) continue;
      stepMech(e, DT, e.foe, null, false);   // 控制器 → 執行器（control.js）；這個模擬原本沒有卡點迴避
    }
    collideMechs(); updateShots(DT);
    for (const m of mechs.slice()) updateStatus(m, DT);
    updateWrecks(DT, DT); updateBuildings(DT); updateParticles(DT);
    if (!ace.alive) { win = false; break; }
    if (!reds.some(e => e.alive)) { win = true; break; }
  }
  return { win, timeout: win === null, lost: 1 - (ace.alive ? hpK(ace) : 0), t: Math.round(t), depth: M.depth, theme: M.theme, keys: groups.map(S => S.key).join('+'), kills: reds.filter(e => !e.alive).length, n: reds.length };
}

const res = [];
for (let mi = 0; mi < MAPS; mi++) {
  const seed = SEED * 7919 + mi * 104729;
  const map = genStage(seed, STAGE);
  const { squads } = planSquads(map, rng(map.seed * 7 + 13));
  for (const [li, L] of map.layers.entries()) {
    loadMap({ id: `exp${seed}-${li}`, W: map.W, H: map.H, grid: L.grid });
    setLayout(L.buildings);
    for (const M of squads.filter(S => S.layer === li && !S.support)) {
      const R = mulberry(seed + M.c * 131 + M.r);
      Math.random = R;
      const r = encounter(map, L, M, R, res.length);
      if (r) { res.push(r); if (!args.quiet) console.log(`圖${mi} 層${li} 深${r.depth} ${r.theme.padEnd(5)} ${r.keys.padEnd(22)} ${r.win ? '勝' : r.timeout ? '時間到' : '敗'}  損血 ${Math.round(r.lost * 100)}%  ${r.t}s  擊殺 ${r.kills}/${r.n}`); }
    }
  }
}
const sum = list => list.length ? `${list.length} 場・勝 ${Math.round(list.filter(r => r.win).length / list.length * 100)}%・平均損血 ${Math.round(list.reduce((a, r) => a + r.lost, 0) / list.length * 100)}%` : '-';
console.log(`\n第 ${STAGE} 關 總計：${sum(res)}`);
for (const d of [...new Set(res.map(r => r.depth))].sort((a, b) => a - b)) console.log(`  深 ${d}：${sum(res.filter(r => r.depth === d))}`);
const byKey = {};
for (const r of res) (byKey[r.keys.split('+')[0]] ??= []).push(r);
for (const [k, l] of Object.entries(byKey).sort((a, b) => a[1].reduce((s, r) => s + r.lost, 0) / a[1].length - b[1].reduce((s, r) => s + r.lost, 0) / b[1].length)) console.log(`  ${k.padEnd(9)} ${sum(l)}`);
console.log(JSON.stringify({ stage: STAGE, n: res.length, win: res.filter(r => r.win).length, lost: res.reduce((a, r) => a + r.lost, 0) / res.length }));
