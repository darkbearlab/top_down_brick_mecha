// ---------- 據點戰模擬（無頭，src/conquest.js） ----------
// 跑完整的幾場 3 對 3（全 AI），印每場的勝負、時間、分數、擊墜、空投、據點換手次數
// 用法：node --import ./tools/sim/register.mjs tools/sim/conquest.mjs [--n 4] [--seed 1] [--quiet]
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => { if (v.startsWith('--')) a.push([v.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] == null ? true : all[i + 1]]); return a; }, []));
const N = +(args.n ?? 4), SEED = +(args.seed ?? 1), DT = 1 / 60;

const { G } = await import('../../src/core.js');
const { loadMap } = await import('../../src/arena.js');
const { resetBuildings, setLayout, updateBuildings } = await import('../../src/buildings.js');
const { collideMechs, driveMech, mechs, removeMech } = await import('../../src/mech.js');
const { clearShots, updateShots } = await import('../../src/weapons.js');
const { AI, DIFFS, antiStuck, clearMemory, enemies, stuckStats, updateEnemy } = await import('../../src/ai.js');
const { updateStatus } = await import('../../src/status.js');
const { clearWrecks, updateWrecks } = await import('../../src/wreck.js');
const { updateParticles } = await import('../../src/fx.js');
const { applyHeavy } = await import('../../src/heavy.js');
const { conquestArena } = await import('../../src/blockgen.js');
const C = await import('../../src/conquest.js');

const mulberry = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const map = conquestArena();
loadMap(map); setLayout(map.buildings);
applyHeavy();
AI.onEnemyDeath = e => C.conquestDeath(e);
const none = { x: 0, z: 0, alive: false, team: 'none' };
const res = [];
for (let i = 0; i < N; i++) {
  Math.random = mulberry(SEED * 9973 + i * 7919);
  for (const m of mechs.slice()) removeMech(m);
  enemies.length = 0; clearShots(); clearWrecks(); resetBuildings(); clearMemory();
  G.now = 0; G.paused = false; G.slowMo = 0; G.hitStop = 0;
  AI.passive = false; AI.sandbox = false; AI.diff = DIFFS.hard;
  const log = [];
  C.startConquest(map, msg => log.push(msg));
  const S = C.cqState();
  let flips = 0, last = S.nodes.map(n => n.owner), firstCap = null, lead = { blue: 0, red: 0 };
  while (!S.result) {
    G.now += DT;
    C.preUpdate(DT);
    for (const e of enemies) {
      if (!e.alive && !e.fall) continue;
      updateEnemy(e, DT, e.foe ?? none);
      C.postUpdate(e);
      antiStuck(e, DT);
      if (e.alive && !e.drop) driveMech(e, DT, e.drive.mx, e.drive.mz, e.aimYaw);
    }
    collideMechs(); updateShots(DT);
    for (const m of mechs.slice()) updateStatus(m, DT);
    updateWrecks(DT, DT); updateBuildings(DT); updateParticles(DT);
    C.updateConquest(DT);
    for (let k = enemies.length - 1; k >= 0; k--) if (!enemies[k].alive && !enemies[k].fall && enemies[k].deadT == null) enemies[k].deadT = G.now; else if (enemies[k].deadT != null && G.now - enemies[k].deadT > 3) { removeMech(enemies[k]); enemies.splice(k, 1); }
    S.nodes.forEach((n, j) => { if (n.owner !== last[j]) { if (last[j] === 'blue' || last[j] === 'red') flips++; if (!firstCap && (n.owner === 'blue' || n.owner === 'red')) firstCap = Math.round(S.t); last[j] = n.owner; } });
    if (S.score.blue > S.score.red + 1) lead.blue += DT; else if (S.score.red > S.score.blue + 1) lead.red += DT;
  }
  const r = { campBuffs: S.team.blue.camps + S.team.red.camps, result: S.result, t: Math.round(S.t), score: [Math.floor(S.score.blue), Math.floor(S.score.red)], kills: [S.kills.blue, S.kills.red], drops: [S.drops.blue, S.drops.red], flips, firstCap, lead: [Math.round(lead.blue), Math.round(lead.red)] };
  res.push(r);
  console.log(`脫困 ${stuckStats.n} 次`); stuckStats.n = 0;
  console.log(`第 ${i + 1} 場 ${r.result === 'draw' ? '平手' : r.result === 'blue' ? '藍勝' : '紅勝'}  ${Math.floor(r.t / 60)}:${String(r.t % 60).padStart(2, '0')}  分數 ${r.score.join(':')}  擊墜 ${r.kills.join(':')}  空投 ${r.drops.join(':')}  營地 ${r.campBuffs}  據點換手 ${r.flips}  首次佔領 ${r.firstCap}s  領先秒數 ${r.lead.join(':')}`);
  if (!args.quiet) console.log("   ", log.slice(0, 14).join(" / "));
  if (args.log) console.log(log.filter(l => l.includes(args.log)).join('\n'));   // --log 文字：印出含這段文字的事件（例如 --log 改裝）
}
const avg = f => (res.reduce((a, r) => a + f(r), 0) / res.length).toFixed(1);
console.log(`\n${res.length} 場：藍 ${res.filter(r => r.result === 'blue').length} 紅 ${res.filter(r => r.result === 'red').length} 平 ${res.filter(r => r.result === 'draw').length}・平均 ${avg(r => r.t / 60)} 分鐘・擊墜 ${avg(r => r.kills[0] + r.kills[1])}・換手 ${avg(r => r.flips)}・翻盤（落後方最後贏）${res.filter(r => r.result !== 'draw' && r.lead[r.result === 'blue' ? 1 : 0] > 60).length}`);
