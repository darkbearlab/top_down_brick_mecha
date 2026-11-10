// ---------- AI 大腦介面 ----------
// 一個「大腦」= 一個模組，export default { name, init?(mem, me), think(obs, mem, api) → act }
//   每幀呼叫 think；mem 是這台機體自己的記憶（物件，隨便放東西）；回傳這一幀要做的事
// 掛上去：attachBrain(機體, 大腦)。內建 AI（ai.js updateEnemy）就不跑了，改成照大腦的指令動
// 看得到的東西（obs）跟能做的事（act）見 tools/sim/BRAINS.md
import { G, angleDiff } from './core.js';
import { rayBlock } from './arena.js';
import { activeSlot, facing, mechs, muzzleOf, slotBroken, slotLive, toggleReady, tryBoost, wantsLock } from './mech.js';
import { shots, updateGuns, fireZones } from './weapons.js';
import { headStats } from './sensors.js';
import { burnLockK } from './status.js';
import { BAL, SLOTS } from './parts.js';
import { AI, aiTools, brainHook } from './ai.js';
import { note } from './combatlog.js';

const r2 = v => Math.round(v * 100) / 100;
export function attachBrain(e, brain) {
  e.brain = brain; e.bmem = {}; e.block = 0;
  brain.init?.(e.bmem, e);
}

// 大腦自己選的目標（act.target）還活著就用它，不然用 fallback（最近的那台）
export function brainFoe(e, fallback) {
  if (e.btarget != null) { const t = mechs.find(o => o.id === e.btarget && o.alive && !o.drop && o.team !== e.team); if (t) return t; e.btarget = null; }
  return fallback;
}

// 一台機體看得到的樣子（自己的會多一點細節）
function view(m, self) {
  const weapons = {};
  for (const s of SLOTS) {
    const g = m.guns?.[s];
    if (!g) continue;
    const d = g.def;
    weapons[s] = {
      id: d.id, kind: d.kind, type: d.type, mount: d.mount, dmg: d.dmg, pellets: d.pellets ?? 1, salvo: d.salvo ?? 1, interval: d.interval,
      ammo: g.ammo === Infinity ? Infinity : g.ammo, max: g.max, energy: d.energy ?? 0, range: aiTools.reachOf(d), speed: d.speed ?? null,
      broken: slotBroken(m, s), active: activeSlot(m, s.slice(-1)) === s, live: slotLive(m, s) && !slotBroken(m, s), cd: self ? r2(Math.max(0, g.cd)) : undefined,
      needLock: !!d.needLock, splash: d.splash ?? 0,
    };
  }
  const hp = {};
  for (const k in m.parts) hp[k] = { hp: Math.round(m.parts[k].hp), max: Math.round(m.parts[k].max), broken: !!m.parts[k].broken, armor: m.parts[k].armor };
  const tot = Object.values(m.parts).reduce((a, p) => a + p.hp / p.max, 0) / Object.keys(m.parts).length;
  return {
    id: m.id, x: m.x, z: m.z, vx: m.vx, vz: m.vz, r: m.r, yaw: m.torsoYaw, legYaw: m.legYaw, alive: m.alive,
    energy: m.energy, staggered: m.staggerT > 0, staggerT: m.staggerT, boosting: m.boostT > 0, boostCd: Math.max(0, m.boostCd),
    charge: m.charge?.phase ?? null, swinging: !!m.swing, punching: !!m.punch, beaming: !!(m.pulses && Object.keys(m.pulses).length),
    legs: m.spec.legs.type, vmax: m.spec.vmax, turn: m.spec.turn, canBoost: !!m.spec.boost && !m.grunt, staggerAt: m.spec.legs.stagger,
    hp, hpFrac: r2(tot), weapons, ready: { ...m.ready }, deploying: { L: m.deployT.L > 0, R: m.deployT.R > 0 },
    shield: m.shield ? { hp: Math.round(m.shield.hp), slot: m.shield.slot } : null,
  };
}

// 飛向自己的子彈 / 飛彈 / 拋射物（15 格內）：最近距離 miss、幾秒後最接近 tti
function incoming(e) {
  const out = [];
  for (const s of shots) {
    if (s.team === e.team) continue;
    const ox = e.x - s.x, oz = e.z - s.z, d = Math.hypot(ox, oz);
    if (d > 15) continue;
    const vx = s.dx != null ? s.dx * s.speed : s.vx, vz = s.dz != null ? s.dz * s.speed : s.vz, v = Math.hypot(vx, vz) || 1;
    const ux = vx / v, uz = vz / v, along = ox * ux + oz * uz;
    const miss = Math.abs(ox * uz - oz * ux);
    out.push({ kind: s.kind, w: s.wid, x: r2(s.x), z: r2(s.z), y: r2(s.y), ux: r2(ux), uz: r2(uz), speed: r2(v), dmg: Math.round(s.dmg ?? 0), heavy: !!s.heavy, splash: s.splash ?? 0,
      tti: along > 0 ? r2(along / v) : null, miss: r2(miss), target: s.target === e, point: s.point ?? (s.kind === 'napalm' ? { x: s.x + s.vx * (s.T - s.t), z: s.z + s.vz * (s.T - s.t) } : null) });
  }
  return out.sort((a, b) => (a.tti ?? 99) - (b.tti ?? 99));
}

function observe(e, foe, dt) {
  const dx = foe.x - e.x, dz = foe.z - e.z, dist = Math.hypot(dx, dz) || 1e-6;
  const los = rayBlock(e.x, e.z, dx / dist, dz / dist, dist) >= dist - 0.9;
  const lineOf = {};
  for (const s of SLOTS) { const g = e.guns?.[s]; if (g) lineOf[s] = aiTools.lineClear(e, s, g.def, foe); }
  return {
    t: r2(G.now), dt, me: view(e, true), foe: view(foe, false), dist: r2(dist), dir: { x: dx / dist, z: dz / dist }, los, lineClear: lineOf,
    lock: { locked: e.block >= 1, progress: r2(Math.min(1, e.block)), range: headStats(e).lockRange, wants: wantsLock(e) },
    // 隊友（2v2 之類）：活著的同隊機體，照距離排、多一個 dist
    allies: mechs.filter(o => o !== e && o.alive && !o.drop && o.team === e.team).map(o => ({ ...view(o, false), dist: r2(Math.hypot(o.x - e.x, o.z - e.z)), foeId: o.foe?.id ?? null })).sort((a, b) => a.dist - b.dist),
    // 所有活著的敵人（一對多時用；foe = 其中一台，對戰模擬裡是最近的那台），照距離排、多一個 dist
    enemies: mechs.filter(o => o.alive && !o.drop && o.team !== e.team && o.team !== 'none').map(o => ({ ...view(o, false), grunt: !!o.grunt, dist: r2(Math.hypot(o.x - e.x, o.z - e.z)) })).sort((a, b) => a.dist - b.dist),
    incoming: incoming(e), zones: fireZones.filter(z => Math.hypot(z.x - e.x, z.z - e.z) < z.r + 8).map(z => ({ x: r2(z.x), z: r2(z.z), r: z.r, t: r2(z.t), status: z.status, mine: z.team === e.team })),
  };
}

// 大腦能用的工具（都已經綁在這台機體上）
function tools(e, foe) {
  return {
    angleDiff,
    // 從 (x, z) 往 (dx, dz) 走多遠會撞到牆（max 為止）
    rayBlock: (x, z, dx, dz, max) => rayBlock(x, z, dx, dz, max),
    // 自己往 (ux, uz) 整台過得去多遠（肩寬三條射線，空洞也算擋住）
    clearAhead: (ux, uz, len) => aiTools.clearAhead(e, ux, uz, len),
    // 往 (ux, uz) 推進大概會滑多遠
    boostLen: (ux, uz) => aiTools.boostLen(e, ux, uz),
    // 想往 (mx, mz) 走：內建的避牆（前面有牆就轉開），回傳 { mx, mz }
    steer: (mx, mz) => aiTools.steer(e, mx, mz),
    // 某個掛點現在開火，彈道會不會馬上撞牆
    lineClear: slot => !!e.guns?.[slot] && aiTools.lineClear(e, slot, e.guns[slot].def, foe),
    // 照子彈速度預判：瞄哪個角度（沒有彈速的武器直接瞄現在的位置）
    leadYaw: slot => {
      const sp = e.guns?.[slot]?.def.speed;
      const mz = muzzleOf(e, slot);
      if (!sp) return Math.atan2(foe.x - mz.x, foe.z - mz.z);
      const spd = sp * (e.team === 'player' ? 1 : 0.55);   // 電腦的子彈比較慢（weapons.js ENEMY_SPEED）
      let tx = foe.x, tz = foe.z;
      for (let i = 0; i < 3; i++) { const t = Math.hypot(tx - mz.x, tz - mz.z) / spd; tx = foe.x + foe.vx * t; tz = foe.z + foe.vz * t; }
      return Math.atan2(tx - mz.x, tz - mz.z);
    },
    facing: () => facing(e),
    note: text => note(e, text),
  };
}

function apply(e, act, dt, foe) {
  act ??= {};
  // 移動（世界方向，長度最多 1）
  let mx = act.move?.x ?? 0, mz = act.move?.z ?? 0;
  const ml = Math.hypot(mx, mz);
  if (ml > 1) { mx /= ml; mz /= ml; }
  e.drive = { mx, mz };
  // 瞄準：aimYaw（弧度，0 = +z）或 aimAt（世界座標）
  if (act.aimYaw != null) e.aimYaw = act.aimYaw;
  else if (act.aimAt) e.aimYaw = Math.atan2(act.aimAt.x - e.x, act.aimAt.z - e.z);
  // 背部武器：back.L / back.R = true 架起、false 收回（切換中不理）
  for (const side of ['L', 'R']) {
    const want = act.back?.[side];
    if (want != null && e.ready[side] !== want && e.deployT[side] <= 0) toggleReady(e, side);
  }
  if (act.boost) { const b = act.boost === true ? { x: mx, z: mz } : act.boost; tryBoost(e, b.x, b.z); }
  if (act.note) note(e, act.note);
  // 選目標：act.target = 敵人的 id（obs.enemies[].id）；下一幀起 obs.foe、鎖定、預設的 aimAt 都換成它；null = 交回預設（最近的）
  if (act.target !== undefined) e.btarget = act.target;
  // 鎖定：跟內建 AI 一樣（範圍內、看得到、有需要鎖定的武器在準備 → 慢慢鎖上）
  const H = headStats(e), dist = Math.hypot(foe.x - e.x, foe.z - e.z);
  const los = rayBlock(e.x, e.z, (foe.x - e.x) / (dist || 1), (foe.z - e.z) / (dist || 1), dist) >= dist - 0.9;
  const lockable = foe.alive && !AI.passive && (los || H.radarLock);
  if (e.lockBreak) { e.block = 0; e.lockBreak = false; }   // 失衡 / 逐發鎖定：鎖定歸零
  e.block = lockable && wantsLock(e) && dist < H.lockRange && !(G.now < (e.relockUntil ?? 0)) ? e.block + dt / (H.lockTime * (e.diff?.lock ?? 1) * burnLockK(e) * (los ? 1 : BAL.wallLockK)) : Math.max(0, e.block - dt * 2);
  const locks = e.block >= 1 ? [foe] : [];
  e.lockOn = e.block > 0 && foe.alive ? { tgt: foe, k: Math.min(1, e.block) } : null;   // 給玩家的被鎖定警示（lockwarn.js）
  const aim = act.aimAt ?? { x: foe.x, z: foe.z };
  updateGuns(e, { L: !!act.fire?.L && !AI.passive, R: !!act.fire?.R && !AI.passive }, dt, locks, aim);
  if (e.laser) e.laser.g.visible = false;
}

brainHook.run = (e, dt, foe) => {
  let act;
  try { act = e.brain.think(observe(e, foe, dt), e.bmem, tools(e, foe)); }
  catch (err) { e.brainError = (e.brainError ?? 0) + 1; if (e.brainError < 4) console.error(`[brain ${e.brain.name}]`, err); act = null; }
  apply(e, act, dt, foe);
};
