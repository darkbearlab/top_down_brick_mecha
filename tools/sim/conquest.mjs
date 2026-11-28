// ---------- 據點戰模擬（無頭，src/conquest.js） ----------
// 跑完整的幾場 3 對 3（全 AI），印每場的勝負、時間、分數、擊墜、空投、據點換手次數
// 用法：node --import ./tools/sim/register.mjs tools/sim/conquest.mjs [--n 4] [--seed 1] [--quiet] [--lo] [--remote]
//   --remote：紅隊 3 號改成「遠端」控制器（control.js），由下面的假客戶端 botFrame 每幀送操作幀（驗證插槽：只透過幀操作也打得起來）
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => { if (v.startsWith('--')) a.push([v.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] == null ? true : all[i + 1]]); return a; }, []));
const N = +(args.n ?? 4), SEED = +(args.seed ?? 1), DT = 1 / 60;

const { G } = await import('../../src/core.js');
const { loadMap } = await import('../../src/arena.js');
const { resetBuildings, setLayout, updateBuildings } = await import('../../src/buildings.js');
const { collideMechs, driveMech, mechs, removeMech } = await import('../../src/mech.js');
const { clearShots, updateShots } = await import('../../src/weapons.js');
const { AI, DIFFS, clearMemory, enemies, stepMech, stuckStats } = await import('../../src/ai.js');
const { updateStatus } = await import('../../src/status.js');
const { clearWrecks, updateWrecks } = await import('../../src/wreck.js');
const { updateParticles } = await import('../../src/fx.js');
const { applyHeavy } = await import('../../src/heavy.js');
const { conquestArena } = await import('../../src/blockgen.js');
const C = await import('../../src/conquest.js');
const { updateDevices, clearDevices } = await import('../../src/devices.js');
const ARENA = await import('../../src/arena.js');
const { pushFrame } = await import('../../src/control.js');
const { routeDir } = await import('../../src/pathing.js');
// 假的遠端客戶端：只看得到公開的東西（自己、指揮給的目標、看得到的敵人），每幀送一份操作幀
//   照路線走去指令的目標；15 格內看得到的敵人 → 瞄準、兩手開火、保持一點距離；偶爾推進
function botFrame(e) {
  const g = e.cq?.goal, f = { mx: 0, mz: 0, aim: null, fire: { L: false, R: false }, ready: { L: false, R: false }, boost: null, device: null };
  if (g) { const d = Math.hypot(g.x - e.x, g.z - e.z); if (d > 3) { const r = routeDir(g.key, G.now, e.x, e.z, g.x, g.z) ?? { x: (g.x - e.x) / d, z: (g.z - e.z) / d }; f.mx = r.x; f.mz = r.z; } }
  let best = null, bd = 22;
  for (const o of mechs) if (o.alive && !o.drop && o.team !== e.team && o.team !== 'none' && !o.dormant) { const d = Math.hypot(o.x - e.x, o.z - e.z); if (d < bd && ARENA.rayBlock(e.x, e.z, (o.x - e.x) / d, (o.z - e.z) / d, d) >= d - o.r) { bd = d; best = o; } }
  if (best) {
    f.aim = { x: best.x, z: best.z }; f.fire = { L: true, R: true };
    if (bd < 8) { f.mx = -(best.x - e.x) / bd; f.mz = -(best.z - e.z) / bd; }
    if (Math.random() < 0.01) f.boost = { x: -(best.z - e.z) / bd, z: (best.x - e.x) / bd };
  } else if (f.mx || f.mz) f.aim = { x: e.x + f.mx * 5, z: e.z + f.mz * 5 };
  return f;
}
const BOT = { frames: 0 };   // grid 是 live binding：用命名空間讀

const mulberry = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const map = conquestArena();
loadMap(map); setLayout(map.buildings);
applyHeavy();
AI.onEnemyDeath = e => C.conquestDeath(e);
const none = { x: 0, z: 0, alive: false, team: 'none' };
const res = [], LO = new Map();   // 每種配裝累計的戰績
for (let i = 0; i < N; i++) {
  Math.random = mulberry(SEED * 9973 + i * 7919);
  for (const m of mechs.slice()) removeMech(m);
  enemies.length = 0; clearDevices(); clearShots(); clearWrecks(); resetBuildings(); clearMemory();
  G.now = 0; G.paused = false; G.slowMo = 0; G.hitStop = 0;
  AI.passive = false; AI.sandbox = false; AI.diff = DIFFS.hard;
  const log = [];
  C.startConquest(map, msg => log.push(msg), args.remote ? { ctrl: { red: ['ai', 'ai', 'remote'] } } : {});
  const S = C.cqState();
  let flips = 0, last = S.nodes.map(n => n.owner), firstCap = null, lead = { blue: 0, red: 0 };
  while (!S.result) {
    G.now += DT;
    C.preUpdate(DT);
    if (args.remote) for (const e of enemies) if (e.alive && e.ctrl?.kind === 'remote') { pushFrame(e, botFrame(e)); BOT.frames++; }
    for (const e of enemies) {
      if (!e.alive && !e.fall) continue;
      stepMech(e, DT, e.foe ?? none, C.postUpdate);   // 控制器出幀 → 執行器（control.js）；遠端的位置從 bot 送來的幀
    }
    collideMechs(); updateShots(DT);
    for (const m of mechs.slice()) updateStatus(m, DT);
    updateWrecks(DT, DT); updateBuildings(DT); updateDevices(DT); updateParticles(DT);
    C.updateConquest(DT);
    for (let k = enemies.length - 1; k >= 0; k--) if (!enemies[k].alive && !enemies[k].fall && enemies[k].deadT == null) enemies[k].deadT = G.now; else if (enemies[k].deadT != null && G.now - enemies[k].deadT > 3) { removeMech(enemies[k]); enemies.splice(k, 1); }
    S.nodes.forEach((n, j) => { if (n.owner !== last[j]) { if (last[j] === 'blue' || last[j] === 'red') flips++; if (!firstCap && (n.owner === 'blue' || n.owner === 'red')) firstCap = Math.round(S.t); last[j] = n.owner; } });
    if (S.score.blue > S.score.red + 1) lead.blue += DT; else if (S.score.red > S.score.blue + 1) lead.red += DT;
  }
  const down = ARENA.grid.reduce((a, row) => a + row.filter(c => c === 'r').length, 0);   // 倒掉的建築格
  const r = { tier: [S.tier.blue, S.tier.red], supers: S.supers ?? 0, outposts: S.outposts, down, breaches: S.breaches, dug: S.dug, devices: S.devices, campBuffs: S.team.blue.camps + S.team.red.camps, result: S.result, t: Math.round(S.t), score: [Math.floor(S.score.blue), Math.floor(S.score.red)], kills: [S.kills.blue, S.kills.red], drops: [S.drops.blue, S.drops.red], flips, firstCap, lead: [Math.round(lead.blue), Math.round(lead.red)] };
  res.push(r);
  for (const [n, v] of S.lo) { const a = LO.get(n) ?? { t: 0, k: 0, d: 0, cap: 0, camp: 0, gk: 0, bk: 0 }; for (const key in a) a[key] += v[key]; LO.set(n, a); }
  console.log(`脫困 ${stuckStats.n} 次`); stuckStats.n = 0;
  if (args.remote) { const R = S.stats.red[2]; console.log(`遠端控制的紅 6 號：送了 ${BOT.frames} 幀・擊墜 ${R.k}・損毀 ${R.d}・佔領 ${R.cap}・配裝 ${S.aces.red[2].cq.lo.name}`); BOT.frames = 0; }
  console.log(`第 ${i + 1} 場 ${r.result === 'draw' ? '平手' : r.result === 'blue' ? '藍勝' : '紅勝'}  ${Math.floor(r.t / 60)}:${String(r.t % 60).padStart(2, '0')}  分數 ${r.score.join(':')}  擊墜 ${r.kills.join(':')}  空投 ${r.drops.join(':')}  營地 ${r.campBuffs}  倒塌 ${r.down}・開路 ${r.breaches}/${r.dug}・裝置 ${r.devices}・階 ${r.tier.join(":")}・超級 ${r.supers}・增援據點 ${r.outposts}  據點換手 ${r.flips}  首次佔領 ${r.firstCap}s  領先秒數 ${r.lead.join(':')}`);
  if (!args.quiet) console.log("   ", log.slice(0, 14).join(" / "));
  if (args.log) console.log(log.filter(l => l.includes(args.log)).join('\n'));   // --log 文字：印出含這段文字的事件（例如 --log 改裝）
}
const avg = f => (res.reduce((a, r) => a + f(r), 0) / res.length).toFixed(1);
console.log(`\n${res.length} 場：藍 ${res.filter(r => r.result === 'blue').length} 紅 ${res.filter(r => r.result === 'red').length} 平 ${res.filter(r => r.result === 'draw').length}・平均 ${avg(r => r.t / 60)} 分鐘・擊墜 ${avg(r => r.kills[0] + r.kills[1])}・換手 ${avg(r => r.flips)}・翻盤（落後方最後贏）${res.filter(r => r.result !== 'draw' && r.lead[r.result === 'blue' ? 1 : 0] > 60).length}`);
// 配裝表（--lo）：每 5 分鐘上場時間的擊墜 / 被擊墜 / 佔領 / 營地 / 雜魚 / 蟲
if (args.lo) {
  console.log('\n配裝            上場分  擊墜/5m 被墜/5m  K/D  佔領/5m 營地/5m 雜魚/5m 蟲/5m');
  const per = (v, t) => (v / Math.max(1, t) * 300).toFixed(1).padStart(6);
  for (const [n, a] of [...LO].sort((x, y) => (y[1].k + 1) / (y[1].d + 1) - (x[1].k + 1) / (x[1].d + 1)))
    console.log(`${n.padEnd(8, '　')} ${(a.t / 60).toFixed(1).padStart(5)} ${per(a.k, a.t)} ${per(a.d, a.t)} ${((a.k + 1) / (a.d + 1)).toFixed(2).padStart(5)} ${per(a.cap, a.t)} ${per(a.camp, a.t)} ${per(a.gk, a.t)} ${per(a.bk, a.t)}`);
}
