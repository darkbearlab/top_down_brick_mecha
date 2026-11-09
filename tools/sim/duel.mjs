// ---------- 無頭對戰模擬 ----------
// 不開瀏覽器、不畫畫面，直接跑遊戲本身的戰鬥程式（src/*.js），固定 60 幀 / 秒、跑得比即時快很多
// 用法（在專案根目錄）：
//   node --import ./tools/sim/register.mjs tools/sim/duel.mjs --a 突擊型 --b 狙擊型 [--n 10] [--seed 1] [--diff hard] [--max 120] [--out tools/sim/out/xxx] [--quiet]
//   --a / --b：機體名字（parts.js 的 ENEMY_PRESETS、ELITES），或配裝 JSON 檔的路徑
//   --b squad:<小隊>[+<小隊>…]：B 方換成一群雜魚（parts.js 的 SQUADS，例如 squad:rush、squad:rush+ambush），用內建 AI；A 一對多，foe = 最近的那台
//   --diff：雙方的電腦難度（easy / normal / hard；大腦也吃它的傷害 / 鎖定倍率）
//   --brainA / --brainB：大腦（src/brains/ 裡的名字，或 .js 檔路徑）；沒給 = 遊戲內建的 AI（default）
//   結果：每場一個 battle-N.jsonl（所有事件 + 每 0.25 秒的狀態）、summary.json（每場的整理 + 總結）
// 場地：對戰模式那張 64×48 對稱場地，A 在左（-26, 0）、B 在右（26, 0）
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { aggregate, summarize } from './analyze.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => { if (v.startsWith('--')) a.push([v.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] == null ? true : all[i + 1]]); return a; }, []));
const N = +(args.n ?? 1), SEED = +(args.seed ?? 1), MAX_T = +(args.max ?? 120), DT = 1 / 60, SAMPLE = 0.25;

const { G } = await import('../../src/core.js');
const { arenaMap, loadMap } = await import('../../src/arena.js');
const { ARENA_LAYOUT, resetBuildings, setLayout, updateBuildings } = await import('../../src/buildings.js');
const { collideMechs, driveMech, mechs, removeMech } = await import('../../src/mech.js');
const { clearShots, updateShots } = await import('../../src/weapons.js');
const { AI, DIFFS, enemies, spawnEnemy, updateEnemy } = await import('../../src/ai.js');
const { ARMORS, CORES, ELITES, ENEMY_PRESETS, GRUNTS, GRUNTS_LOW, HEADS, LEGS, SQUADS, WEAPONS, gruntOf } = await import('../../src/parts.js');
const { updateStatus } = await import('../../src/status.js');
const { clearWrecks, updateWrecks } = await import('../../src/wreck.js');
const { updateParticles } = await import('../../src/fx.js');
const { CL, log, logStart, logStop } = await import('../../src/combatlog.js');
const { attachBrain } = await import('../../src/brainapi.js');
const loadBrain = async b => {
  if (!b || b === true || b === 'default') return null;
  const p = existsSync(b) ? resolve(b) : resolve('src', 'brains', b.endsWith('.js') ? b : b + '.js');
  return (await import(pathToFileURL(p).href)).default;
};
const BA = await loadBrain(args.brainA), BB = await loadBrain(args.brainB);
const brainName = B => B?.name ?? 'default';

const presetOf = s => {
  if (typeof s !== 'string') throw new Error('需要 --a 和 --b');
  if (existsSync(s)) {
    // 配裝檔：只能用整備裡選得到的零件（雜魚用的低階武器、菁英專用武器不行）；name 沒寫就用檔名
    const L = JSON.parse(readFileSync(s, 'utf8'));
    const bad = [];
    if (!HEADS[L.head]) bad.push(`head ${L.head}`); if (!CORES[L.core]) bad.push(`core ${L.core}`); if (!LEGS[L.legs]) bad.push(`legs ${L.legs}`);
    for (const k of ['armL', 'armR', 'backL', 'backR']) { const w = L[k]; if (w == null) continue; const W = WEAPONS[w]; if (!W || W.low || W.mount !== k.slice(0, -1)) bad.push(`${k} ${w}`); }
    for (const k of ['head', 'torso', 'arms', 'legs']) if (!ARMORS[L.armor?.[k]]) bad.push(`armor.${k} ${L.armor?.[k]}`);
    if (bad.length) throw new Error(`配裝檔 ${s} 不合法：${bad.join('、')}`);
    return { ...L, name: L.name ?? s.split(/[\/]/).slice(-2).join('/'), chips: [], device: null };
  }
  const P = [...ENEMY_PRESETS, ...ELITES].find(p => p.name === s);
  if (!P) throw new Error(`找不到機體「${s}」；可用：${[...ENEMY_PRESETS, ...ELITES].map(p => p.name).join('、')}`);
  return P;
};
const PACK = typeof args.b === 'string' && args.b.startsWith('squad:') ? args.b.slice(6).split('+').flatMap(k => { if (!SQUADS[k]) throw new Error(`沒有小隊「${k}」；可用：${Object.keys(SQUADS).join('、')}`); return SQUADS[k].units; }) : null;
const gruntDef = k => gruntOf(k);   // 跟遊戲一樣：裝甲每台隨機
const PA = presetOf(args.a), PB = PACK ? { name: args.b } : presetOf(args.b);
const diff = DIFFS[args.diff ?? 'hard'];
// 可重現：每場用自己的種子取代 Math.random
const mulberry = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };

const ARENA = arenaMap();
loadMap(ARENA); setLayout(ARENA_LAYOUT);
const out = args.out ?? join('tools', 'sim', 'out', `${new Date().toISOString().replace(/[:.]/g, '-')}`);
mkdirSync(out, { recursive: true });

const parts = m => Object.fromEntries(Object.entries(m.parts).map(([k, p]) => [k, Math.round(p.hp)]));
const ammo = m => Object.fromEntries(Object.entries(m.guns ?? {}).map(([k, g]) => [k, g.ammo === Infinity ? -1 : g.ammo]));
const r2 = v => Math.round(v * 100) / 100;

function battle(i) {
  Math.random = mulberry(SEED * 7919 + i);
  // 清場
  for (const m of mechs.slice()) removeMech(m);
  enemies.length = 0;
  clearShots(); clearWrecks(); resetBuildings();
  G.now = 0; G.paused = false; G.slowMo = 0; G.hitStop = 0;
  AI.passive = false; AI.sandbox = false; AI.diff = diff;
  const dummy = { x: 26, z: 0, alive: true, team: 'none' };
  const a = spawnEnemy(dummy, PA, { x: -26, z: 0 }, { team: 'blue', diff, noDrop: true });
  let b, pack = [];
  if (PACK) {
    // 雜魚小隊：在右邊散開站，全部打 A
    pack = PACK.map((k, j) => { const g = spawnEnemy(dummy, gruntDef(k), { x: 24 + (j % 2) * 3, z: (j - (PACK.length - 1) / 2) * 3 }, { team: 'red', diff, noDrop: true, grunt: true }); g.foe = a; g.side = 'B'; g.torsoYaw = g.legYaw = g.aimYaw = -Math.PI / 2; return g; });
    b = pack[0];
  } else b = spawnEnemy(dummy, PB, { x: 26, z: 0 }, { team: 'red', diff, noDrop: true });
  a.foe = b; if (!PACK) b.foe = a; a.side = 'A'; b.side = 'B';
  const reds = PACK ? pack : [b];
  if (BA) attachBrain(a, BA);
  if (BB) attachBrain(b, BB);
  a.torsoYaw = a.legYaw = a.aimYaw = Math.PI / 2; b.torsoYaw = b.legYaw = b.aimYaw = -Math.PI / 2;
  logStart();
  let t = 0, sampleT = 0, winner = null;
  while (t < MAX_T) {
    G.now += DT; t += DT; CL.t = t;
    if (PACK && a.alive) { let bd = Infinity; for (const g of reds) if (g.alive) { const d = Math.hypot(g.x - a.x, g.z - a.z); if (d < bd) { bd = d; a.foe = g; } } }
    for (const e of [a, ...reds]) {
      if (!e.alive) continue;
      updateEnemy(e, DT, e.foe);
      if (e.alive && !e.drop) driveMech(e, DT, e.drive.mx, e.drive.mz, e.aimYaw);
    }
    collideMechs();
    updateShots(DT);
    for (const m of mechs.slice()) updateStatus(m, DT);
    updateWrecks(DT, DT);
    updateBuildings(DT);
    updateParticles(DT);
    if ((sampleT += DT) >= SAMPLE) {
      sampleT -= SAMPLE;
      const dist = r2(Math.hypot(a.x - a.foe.x, a.z - a.foe.z));
      log('state', { dt: SAMPLE, mechs: [a, ...reds].filter(m => m.alive || m === a).map(m => ({ m: m.id, x: r2(m.x), z: r2(m.z), yaw: r2(m.torsoYaw), v: r2(Math.hypot(m.vx, m.vz)), e: Math.round(m.energy), hp: parts(m), ammo: ammo(m), dist, alive: m.alive })) });
    }
    const redAlive = reds.some(m => m.alive);
    if (!a.alive || !redAlive) { winner = a.alive ? 'A' : redAlive ? 'B' : null; break; }
  }
  // 時間到：比剩下的耐久比例
  let timeout = false;
  if (a.alive && reds.some(m => m.alive)) {
    timeout = true;
    const k = m => Object.values(m.parts).reduce((s, p) => s + p.hp / p.max, 0) / Object.keys(m.parts).length;
    const live = reds.filter(m => m.alive), ka = k(a), kb = live.reduce((s, m) => s + k(m), 0) / reds.length;
    winner = Math.abs(ka - kb) < 0.03 ? null : ka > kb ? 'A' : 'B';
  }
  const events = logStop();
  writeFileSync(join(out, `battle-${i}.jsonl`), events.map(e => JSON.stringify(e)).join('\n'));
  return summarize(events, { battle: i, seed: SEED * 7919 + i, time: r2(t), winner, timeout, diff: args.diff ?? 'hard',
    mechs: [{ id: a.id, side: 'A', name: PA.name, brain: brainName(BA) }, ...reds.map(m => ({ id: m.id, side: 'B', name: PACK ? m.preset.name : PB.name, brain: PACK ? 'default' : brainName(BB) }))] });
}

const t0 = Date.now(), list = [];
for (let i = 0; i < N; i++) {
  const s = battle(i);
  list.push(s);
  if (!args.quiet) console.log(`#${i} ${s.winner ? `${s.winner} 勝` : '平手'}  ${s.time}s${s.timeout ? '（時間到）' : ''}  ` + s.mechs.map(m => `${m.side} ${m.name}：輸出 ${m.dealt} / 承受 ${m.taken}`).join('  '));
}
const agg = aggregate(list);
writeFileSync(join(out, 'summary.json'), JSON.stringify({ args, battles: list, aggregate: agg }, null, 1));
console.log(`\n${N} 場，${((Date.now() - t0) / 1000).toFixed(1)} 秒 → ${out}`);
for (const A of agg) console.log(`${A.side} ${A.name}（${A.brain}）：勝率 ${A.winRate}（${A.wins}/${A.n}，平手 ${A.draws}）・平均擊殺 ${A.avgKillT ?? '-'}s・平均輸出 ${A.dealt}・承受 ${A.taken}・武器 ${Object.entries(A.dealtBy).map(([k, v]) => `${k} ${v}`).join(' / ')}`);
