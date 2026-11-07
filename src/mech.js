// ---------- 機體 ----------
// 數值全部由配裝算出（parts.js computeSpec）
// 下半身（腳）朝移動方向、上半身朝瞄準方向，各自有轉速
// 移動有慣性：腳只能用「抓地力」推地面加減速，抓地力 = 地面摩擦 × 腳的力量；冰上又滑又難停
//   雙足 / 逆關節：人類一樣的腳法，可以往任何方向走
//   履帶：只能往車身前後開、原地旋轉；抓地力強、扛得重
//   懸浮：到哪都有點滑、泥地不影響、衝刺強
// 推進衝刺：直接給一段速度，不受抓地力限制
// 部位：頭、軀幹、左臂、右臂、左背、右背、腳，各自有血量和裝甲種類
import * as THREE from 'three';
import { G, addMat, addTrauma, angleDiff, approachAngle, scene } from './core.js';
import { collideBlocks, surfaceAt } from './arena.js';
import { RAMP, burnAt, burst, explosion, fire, flame, hitSparks, smoke, sparks, spawnGlow, spawnPuff, voxelBurst } from './fx.js';
import { sfx } from './audio.js';
import { EFFECT, WEAPONS, computeSpec } from './parts.js';
import { buildMechModel } from './model.js';
import { CHIPS, DEVICES, hasChip } from './tech.js';
import { collideWrecks, isWreck, startDying, startWreck } from './wreck.js';
import { damageBuilding } from './buildings.js';

export const PART_NAMES = { head: '頭部', torso: '軀幹', armL: '左臂', armR: '右臂', backL: '左背', backR: '右背', legs: '腳部' };
const ARMOR_OF = { head: 'head', torso: 'torso', armL: 'arms', armR: 'arms', backL: 'torso', backR: 'torso', legs: 'legs' };

export const GRIP = 30, AIR_DRAG = 0.1;
export const BOOST_COST = 30, BOOST_DV = 9, BOOST_TIME = 0.22, BOOST_PUSH = 18, BOOST_CD = 0.35, ENERGY_REGEN = 28, ENERGY_DELAY = 0.6;
export const CRASH_SPEED = 6;
// 厚重感：剎車比起步快（腳踩住地）、超速時用整個抓地力剎住；撞到東西不反彈，卡住一下要慢慢拔出來
const BRAKE_K = 2.2, STICK_SPEED = 2.5;

export const PLAYER_COLORS = { accent: 0x2aa8c8, glow: 0x7ff0ff };
export const ENEMY_COLORS = { accent: 0xe07a2a, glow: 0xff5040 };

export const mechs = [];
// grunt：雜魚機（{ hp }）：整台一條血、不能推進、體型 GRUNT_SCALE、不是主力機（壞了直接炸散）
export const GRUNT_SCALE = 0.8;
const TEAM_RING = new THREE.RingGeometry(0.95, 1.2, 28);
export function makeMech({ team, colors, loadout, x = 0, z = 0, yaw = Math.PI, hpMul = 1, ace = true, grunt = null }) {
  const spec = computeSpec(loadout);
  if (grunt) spec.hp.torso = grunt.hp;
  const shieldSlot = ['armL', 'armR'].find(s => loadout[s] && WEAPONS[loadout[s]].kind === 'shield');
  if (grunt && shieldSlot) { spec.turn *= 0.35; spec.legTurn *= 0.5; }   // 盾兵：轉得非常慢 → 繞背打得到
  const M = buildMechModel(loadout, colors);
  const k = grunt ? GRUNT_SCALE : 1;
  M.root.scale.setScalar(k);
  // 雜魚腳下一圈派系色的光環：一群混在一起時一眼分得出誰是哪邊
  if (grunt) {
    const ring = new THREE.Mesh(TEAM_RING, addMat(colors.glow, 0.55));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    M.root.add(ring);
  }
  M.root.position.set(x, 0, z);
  scene.add(M.root);
  const parts = {};
  for (const k in M.parts) {
    const max = (spec.hp[k] ?? 60) * hpMul;
    parts[k] = { ...M.parts[k], hp: max, max, broken: false, flash: 0, smokeT: Math.random(), armor: loadout.armor[ARMOR_OF[k]] };
  }
  const m = {
    team, colors, loadout, spec, model: M, parts, x, z, vx: 0, vz: 0, r: (loadout.legs === 'tread' ? 0.95 : 0.85) * k, k, grunt: !!grunt,
    legYaw: yaw, torsoYaw: yaw, walk: 0, lean: { x: 0, z: 0 }, lastV: { x: 0, z: 0 }, bob: 0,
    energy: 100, energyT: 0, boostT: 0, boostCd: 0, boostDir: { x: 0, z: 0 }, stuckT: 0, stuckMax: 0, stuckN: { x: 0, z: 0 },
    alive: true, ace: ace && !grunt, surf: null, guns: null, onDeath: null, swing: null,
    // 背部武器準備：ready = 那一邊現在用背部武器、deployT = 展開 / 收回中還剩幾秒（不能開火）、readyK = 動畫 0..1
    ready: { L: false, R: false }, deployT: { L: 0, R: 0 }, readyK: { L: 0, R: 0 },
    staggerT: 0, staggerMax: 0, staggerImm: 0, stagDir: { x: 0, z: 0 },
    chips: [...(loadout.chips ?? [])], device: DEVICES[loadout.device] ? { id: loadout.device, charges: DEVICES[loadout.device].charges ?? 0, cd: 0 } : null,
    shield: shieldSlot ? { slot: shieldSlot, hp: WEAPONS[loadout[shieldSlot]].guard * (grunt ? 0.7 : 1) * hpMul, max: WEAPONS[loadout[shieldSlot]].guard * (grunt ? 0.7 : 1) * hpMul, armor: loadout.armor.arms } : null,
  };
  if (m.chips.includes('lockPlus')) spec.head = { ...spec.head, lockCount: spec.head.lockCount + 1, lockArc: Math.round(spec.head.lockArc * 0.6) };   // 鎖定擴充
  mechs.push(m);
  return m;
}

export const legK = m => m.parts.legs.broken ? 0.35 : 0.65 + 0.35 * m.parts.legs.hp / m.parts.legs.max;
export const facing = m => ({ x: Math.sin(m.torsoYaw), z: Math.cos(m.torsoYaw) });
export function toWorld(m, [lx, ly, lz]) {
  const s = Math.sin(m.torsoYaw), c = Math.cos(m.torsoYaw), k = m.k ?? 1;
  return { x: m.x + (lx * c + lz * s) * k, y: (m.model.hipY + ly) * k + (m.flyH ?? 0), z: m.z + (-lx * s + lz * c) * k };
}
export const slotBroken = (m, slot) => !m.parts[slot] || m.parts[slot].broken;
// 背部武器架上肩膀時往上、往前移的量（方塊單位 1/16）
const READY_OFF = [0, 3 / 16, 7 / 16];
export function muzzleOf(m, slot) {
  const b = m.model.muzzles[slot] ?? [0, 0.5, 0.8];
  const k = slot.startsWith('back') ? m.readyK?.[slot[4]] ?? 0 : 0;
  return toWorld(m, k ? [b[0], b[1] + READY_OFF[1] * k, b[2] + READY_OFF[2] * k] : b);
}

// ---------- 背部武器準備（Q / E 切換） ----------
// 按一次：手臂放下、背部武器架上肩膀，該邊滑鼠鍵改打背部武器；再按一次換回手臂
// 切換要 DEPLOY_T 秒，期間那一邊不能開火；背部武器打光 / 被打掉時自動換回手臂；手臂武器打光就自動架背部武器
export const DEPLOY_T = 0.3;
const LOCK_KINDS = new Set(['missile', 'split', 'vmissile']);
export const activeSlot = (m, side) => (m.ready[side] ? 'back' : 'arm') + side;
export function canReady(m, side) {
  const g = m.guns?.['back' + side];
  return !!g && !slotBroken(m, 'back' + side) && g.ammo > 0;
}
const deployT = m => hasChip(m, 'quickSwap') ? 0.05 : DEPLOY_T;   // 快速換裝
export function toggleReady(m, side) {
  if (!m.alive || m.swing) return false;
  const on = !m.ready[side];
  if (on && !canReady(m, side)) return false;
  m.ready[side] = on;
  m.deployT[side] = deployT(m);
  if (m.team === 'player') on ? sfx.deploy() : sfx.stow();
  return true;
}
// 這個掛載點現在能不能開火（是那一邊目前準備的武器、而且不在切換中）
export const slotLive = (m, slot) => activeSlot(m, slot.slice(-1)) === slot && m.deployT[slot.slice(-1)] <= 0;
// 現在準備中的武器有沒有要鎖定的（飛彈類）：沒有就不會開始鎖定
export function wantsLock(m) {
  for (const side of ['L', 'R']) {
    const slot = activeSlot(m, side), g = m.guns?.[slot];
    if (g && !slotBroken(m, slot) && LOCK_KINDS.has(g.def.kind)) return true;
  }
  return false;
}
export function updateReady(m, dt) {
  for (const side of ['L', 'R']) {
    if (m.deployT[side] > 0) m.deployT[side] -= dt;
    // 背部打光或被打掉：換回手臂；手上沒武器（或打光、被打掉）就架著背部武器
    const ag = m.guns?.['arm' + side], armOk = !!ag && !slotBroken(m, 'arm' + side) && ag.ammo > 0;
    if (m.ready[side] && armOk && !canReady(m, side)) { m.ready[side] = false; m.deployT[side] = deployT(m); }
    if (!m.ready[side] && !armOk && canReady(m, side)) { m.ready[side] = true; m.deployT[side] = deployT(m); }
    const k = m.readyK[side], to = m.ready[side] ? 1 : 0;
    m.readyK[side] = k + Math.sign(to - k) * Math.min(Math.abs(to - k), dt / DEPLOY_T);
  }
}

// 實際噴出去的方向：沒按方向就往正前方；履帶只能沿車身前後噴
export function boostDirOf(m, mx, mz) {
  const ml = Math.hypot(mx, mz);
  let d = ml > 0.2 && !hasChip(m, 'ram') ? { x: mx / ml, z: mz / ml } : facing(m);   // 衝角推進：一律往正面噴
  if (m.loadout.legs === 'tread') { const lf = { x: Math.sin(m.legYaw), z: Math.cos(m.legYaw) }; const s = d.x * lf.x + d.z * lf.z >= 0 ? 1 : -1; d = { x: lf.x * s, z: lf.z * s }; }
  return d;
}
export const boostKOf = m => m.spec.boost * (m.parts.legs.broken ? 0.75 : 1) * (hasChip(m, 'lowCG') ? 0.6 : 1);   // 低重心：推進短
export function tryBoost(m, mx, mz) {
  if (!m.alive || m.grunt || m.staggerT > 0 || m.boostCd > 0 || m.energy < BOOST_COST) return false;
  const d = boostDirOf(m, mx, mz), k = boostKOf(m);
  // 噴射只往一個方向：原本的速度只留沿著噴射方向的分量（往反方向跑的會被抵銷），橫向的全部吃掉
  const along = Math.max(0, m.vx * d.x + m.vz * d.z);
  m.vx = d.x * (along + BOOST_DV * k); m.vz = d.z * (along + BOOST_DV * k);
  m.stuckT = 0;
  m.boostDir = d; m.boostK = k; m.boostT = BOOST_TIME; m.boostCd = BOOST_TIME + (hasChip(m, 'doubleBoost') ? 0.02 : BOOST_CD);
  m.energy -= BOOST_COST; m.energyT = ENERGY_DELAY;
  sfx.boost();
  if (m.team === 'player') addTrauma(0.12);
  return true;
}
export function useEnergy(m, n) {
  if (m.energy < n) return false;
  m.energy -= n; m.energyT = Math.max(m.energyT, ENERGY_DELAY * 0.5);
  return true;
}

// 一幀的移動：mx, mz = 想移動的方向（長度 0~1）；aimYaw = 上半身想轉到的角度
export function driveMech(m, dt, mx, mz, aimYaw) {
  if (!m.alive) return;
  const S = m.spec, L = S.legs, s = m.surf = surfaceAt(m.x, m.z);
  const lk = legK(m);
  const vmax = S.vmax * lk * (L.noMud ? 1 : (s.speed ?? 1));
  m.boostCd -= dt;
  m.energyT -= dt;
  if (m.energyT <= 0) m.energy = Math.min(100, m.energy + ENERGY_REGEN * S.regen * (hasChip(m, 'doubleBoost') ? 0.75 : 1) * dt);
  // 失衡：腳不出力、轉不太動
  if (m.staggerT > 0) { if ((m.staggerT -= dt) <= 0) m.staggerImm = STAGGER_IMM; mx = 0; mz = 0; }
  else if (m.staggerImm > 0) m.staggerImm -= dt;
  const ml = Math.hypot(mx, mz);

  // 履帶：只能沿車身前後開，方向鍵決定車身要轉去哪；往後按就倒車
  let tx = mx * vmax, tz = mz * vmax;
  if (L.type === 'tread') {
    const lf = { x: Math.sin(m.legYaw), z: Math.cos(m.legYaw) };
    const dot = ml > 0.1 ? (mx * lf.x + mz * lf.z) / ml : 0;
    const back = dot < -0.3;
    if (ml > 0.1 && m.boostT <= 0) m.legYaw = approachAngle(m.legYaw, Math.atan2(back ? -mx : mx, back ? -mz : mz), S.legTurn * lk * dt);
    const sp = ml * vmax * (back ? -0.6 : Math.max(0, dot));
    tx = lf.x * sp; tz = lf.z * sp;
  } else if (ml > 0.1 && m.boostT <= 0) m.legYaw = approachAngle(m.legYaw, Math.atan2(mx, mz), S.legTurn * lk * dt);

  if (m.boostT > 0) {
    // 噴射中不吃任何方向指令：速度鎖在噴射方向上
    m.boostT -= dt;
    const sp = Math.max(0, m.vx * m.boostDir.x + m.vz * m.boostDir.z) + BOOST_PUSH * m.boostK * dt;
    m.vx = m.boostDir.x * sp; m.vz = m.boostDir.z * sp;
    const back = { x: -m.boostDir.x, z: -m.boostDir.z }, f = facing(m);
    for (let i = 0; i < 2; i++) flame(m.x - f.x * 0.4 + (Math.random() - 0.5) * 0.4, m.model.hipY + 0.5, m.z - f.z * 0.4 + (Math.random() - 0.5) * 0.4, back.x, back.z);
  } else {
    const mu = s.mu * (L.slide ?? 1) * (L.grip ?? 1), gripMax = mu * GRIP;
    const dvx = tx - m.vx, dvz = tz - m.vz, dl = Math.hypot(dvx, dvz);
    const v = Math.hypot(m.vx, m.vz), hover = L.type === 'hover';
    // 起步慢（重）、剎車和轉向快（腳踩住地）；超速（噴射完、被撞飛）直接用整個抓地力剎住，懸浮例外
    const brake = v > 0.3 && dl > 1e-4 ? Math.max(0, -(dvx * m.vx + dvz * m.vz) / (dl * v)) : 0;
    let acc = S.acc * lk * (1 + (hover ? 0.3 : BRAKE_K - 1) * brake);
    if (!hover && v > vmax * 1.05) acc = Math.max(acc, gripMax * lk);
    acc = Math.min(acc, gripMax);
    // 撞進東西裡：剛撞到時幾乎動不了，慢慢拔出來
    if (m.stuckT > 0) { m.stuckT -= dt; acc *= 0.12 + 0.88 * (1 - m.stuckT / m.stuckMax) ** 2; }
    const cap = acc * dt, k = dl > cap ? cap / dl : 1;
    m.vx += dvx * k; m.vz += dvz * k;
    // 硬剎車揚起地上的灰
    if (!hover && v > vmax * 1.2 && Math.random() < 0.5) skidDust(m);
  }
  const drag = Math.exp(-(AIR_DRAG + (L.noMud ? 0 : s.drag)) * dt);
  m.vx *= drag; m.vz *= drag;

  m.x += m.vx * dt; m.z += m.vz * dt;
  const hit = collideBlocks(m, m.r, 0, !!m.fly);
  if (hit.hit > STICK_SPEED) {
    // 不反彈，連沿著牆滑的速度也被磨掉一大半
    const vt = m.vx * -hit.nz + m.vz * hit.nx, keep = Math.max(0.15, 1 - hit.hit * 0.08);
    m.vx = -hit.nz * vt * keep; m.vz = hit.nx * vt * keep;
    stick(m, hit.hit, hit.nx, hit.nz);
  }
  if (hit.hit > CRASH_SPEED) crash(m, hit.hit - CRASH_SPEED, hit.nx, hit.nz);
  const wh = collideWrecks(m);
  if (wh.hit > STICK_SPEED) stick(m, wh.hit, wh.nx, wh.nz);

  m.torsoYaw = approachAngle(m.torsoYaw, aimYaw, S.turn * (m.parts.head.broken ? 0.7 : 1) * (m.staggerT > 0 ? 0.2 : 1) * dt);
  const prev = m.walk;
  m.walk += dt * (L.type === 'tread' || L.type === 'hover' ? 0 : ml * 9 * lk * (L.type === 'reverse' ? 1.15 : 1));
  m.bob += dt;
  if (m.team === 'player' && Math.floor(prev / Math.PI) !== Math.floor(m.walk / Math.PI)) sfx.step();

  const ax = (m.vx - m.lastV.x) / Math.max(dt, 1e-3), az = (m.vz - m.lastV.z) / Math.max(dt, 1e-3);
  m.lastV.x = m.vx; m.lastV.z = m.vz;
  const f = facing(m), fwdA = ax * f.x + az * f.z, sideA = ax * f.z - az * f.x;
  const kL = 1 - Math.exp(-8 * dt);
  m.lean.x += (Math.max(-0.2, Math.min(0.2, -fwdA * 0.012)) - m.lean.x) * kL;
  m.lean.z += (Math.max(-0.2, Math.min(0.2, sideA * 0.012)) - m.lean.z) * kL;
}

// 卡住：撞得越重卡越久；畫面上機體陷進去一點、震一下
export function stick(m, speed, nx, nz) {
  const t = Math.min(0.7, 0.08 + (speed - STICK_SPEED) * 0.035);
  m.boostT = 0;   // 撞到東西噴射就斷了
  if (t > m.stuckT) { m.stuckT = m.stuckMax = t; m.stuckN = { x: nx, z: nz }; m.stuckHit = Math.min(1, speed / 14); }
  if (speed > 4) burst(m.x - nx * m.r, 0.5, m.z - nz * m.r, [0x8a8478, 0x5a5650], 3, 1.5);
  if (m.team === 'player') addTrauma(Math.min(0.35, speed * 0.025));
}
function skidDust(m) {
  const a = Math.random() * Math.PI * 2;
  spawnPuff({ x: m.x + Math.cos(a) * 0.4, y: 0.12, z: m.z + Math.sin(a) * 0.4, vx: -m.vx * 0.15, vy: 0.3, vz: -m.vz * 0.15,
    life: 0.5 + Math.random() * 0.3, s: 0.22 + Math.random() * 0.12, c0: 0x8a8478, c1: 0x5a5650, drag: 3 });
}

function crash(m, over, nx, nz) {
  const dmg = over * 6;
  damagePart(m, 'legs', dmg * 0.6, nx, nz);
  if (m.alive) damagePart(m, 'torso', dmg * 0.4, nx, nz);
  hitSparks(m.x - nx * m.r, 1, m.z - nz * m.r, nx, nz, 1.2 + over * 0.15);
  damageBuilding(m.x - nx * (m.r + 0.05), 1, m.z - nz * (m.r + 0.05), over * 30, -nx, -nz);   // 衝撞建築：撞得夠快會撞垮
  burst(m.x - nx * m.r, 0.8, m.z - nz * m.r, [0x7a8090, 0x4a505c], 4, 3);
  sfx.crash();
  if (m.team === 'player') addTrauma(Math.min(0.6, 0.2 + over * 0.06));
}

// ---------- 被打中 ----------
// 依子彈打來的方向，照權重抽打到哪個部位（被打掉的部位改打軀幹）：
//   正面 ±40°：軀幹 55%（正面裝甲最厚 ×0.6）、頭 12%、左右手各 9%（手臂擋在前面）、腳 15%
//   側面：靠這邊的手臂 45%、軀幹 25%（×0.85）、靠這邊的背部 6%、頭 8%、腳 16%
//   背面：軀幹 40%（弱點 ×1.35）、靠這邊的背部 30%、頭 8%、腳 22%
// 再乘上 武器屬性 × 裝甲種類 的剋制倍率
// 回傳 { part, eff }：eff < 1 = 被裝甲擋下、> 1 = 剋制
const HIT_TABLE = {
  front: { torso: 55, head: 12, armL: 9, armR: 9, legs: 15 },
  side: { arm: 45, torso: 25, back: 6, head: 8, legs: 16 },
  rear: { torso: 40, back: 30, head: 8, legs: 22 },
};
const TORSO_MUL = { front: 0.6, side: 0.85, rear: 1.35 };
function pickPart(m, dir, right) {
  const T = HIT_TABLE[dir], near = right ? 'R' : 'L';
  let r = Math.random() * Object.values(T).reduce((a, b) => a + b, 0), k = 'torso';
  for (const key in T) { if ((r -= T[key]) < 0) { k = key; break; } }
  const part = k === 'arm' ? 'arm' + near : k === 'back' ? 'back' + near : k;
  return !m.parts[part] || m.parts[part].broken ? 'torso' : part;
}
// power：拿來判斷失衡的武器原始威力（不吃難度倍率）；沒給就用 dmg
// splash = 爆風（盾只擋一半、蟲群吃 ×1.8）
export function hitMech(m, dmg, dx, dz, kb = 0, type = 'kinetic', forced = null, power = dmg, splash = false) {
  if (!m.alive) return null;
  // 蟲群：單發攻擊一次最多打掉一隻；爆風打到一大片
  if (m.swarm) dmg = splash ? dmg * 1.8 : Math.min(dmg, m.swarm.per);
  // 護盾發生器：正面 ±70° 的子彈 / 光束整個擋下（爆風擋不住）
  if (m.eshield && G.now < m.eshield.until && !splash) {
    const f = facing(m);
    if (-dx * f.x - dz * f.z > 0.34) { m.vx += dx * kb * 0.3; m.vz += dz * kb * 0.3; return { part: 'torso', eff: 0.3, shield: true }; }
  }
  // 盾牌：從盾那一側前方來的攻擊先打在盾上
  const Sh = m.shield;
  if (Sh && Sh.hp > 0 && !m.parts[Sh.slot]?.broken) {
    const f = facing(m), sd = Sh.slot === 'armL' ? 1 : -1;
    let cx = f.x + f.z * 0.7 * sd, cz = f.z - f.x * 0.7 * sd;
    const cl = Math.hypot(cx, cz); cx /= cl; cz /= cl;
    if (-dx * cx - dz * cz > 0.2) {
      const eff = EFFECT[type][Sh.armor] ?? 1, take = dmg * eff * (splash ? 0.5 : 1);
      Sh.hp -= take;
      m.parts[Sh.slot].flash = 0.07;
      m.vx += dx * kb * 0.5; m.vz += dz * kb * 0.5;
      if (Sh.hp <= 0) breakShield(m, dx, dz);
      if (!splash) return { part: Sh.slot, eff: Math.min(eff, 0.5), shield: true };
      dmg *= 0.5;
    }
  }
  const fromX = -dx, fromZ = -dz, f = facing(m);
  const a = Math.abs(angleDiff(m.torsoYaw, Math.atan2(fromX, fromZ)));
  const right = fromX * -f.z + fromZ * f.x > 0;
  const dir = a < 0.7 ? 'front' : a < 2.27 ? 'side' : 'rear';
  // 雜魚機整台算同一個部位
  let part = m.grunt ? 'torso' : forced ?? pickPart(m, dir, right);
  // 弱點標定：被標記的機體，大多打到軀幹以外還沒壞的部位
  if (!m.grunt && !forced && (m.markT ?? 0) > G.now && Math.random() < 0.75) {
    const opts = Object.keys(m.parts).filter(k => k !== 'torso' && !m.parts[k].broken);
    if (opts.length) part = opts[Math.floor(Math.random() * opts.length)];
  }
  const mul = part === 'torso' && !forced && !m.grunt ? TORSO_MUL[dir] : 1;
  const eff = EFFECT[type][m.parts[part].armor] ?? 1;
  m.vx += dx * kb; m.vz += dz * kb;
  // 反應裝甲：每個部位每 8 秒，第一次被打中傷害減半
  let rk = 1;
  if (hasChip(m, 'reactive') && (m.parts[part].reactT ?? 0) <= G.now) { rk = 0.5; m.parts[part].reactT = G.now + 8; }
  damagePart(m, part, dmg * mul * eff * rk, dx, dz);
  if (m.alive && power >= (m.spec.legs.stagger ?? Infinity)) stagger(m, power, dx, dz);
  return { part, eff };
}

// ---------- 失衡 ----------
// 單發傷害（打中前的原始威力）超過腳的門檻就失衡：雙足 50、逆關節 30、懸浮 25、履帶不會
// 失衡中：腳不出力（只剩摩擦剎車）、不能推進、不能開火、上半身轉得很慢、鎖定被打斷；整台往被打的方向歪、晃
// 時間 0.35～0.6 秒（超過門檻越多越久）；恢復後 1 秒內不會再失衡（避免被連鎖定身）
export const STAGGER_IMM = 1.0;
export function stagger(m, dmg, dx, dz) {
  if (m.staggerT > 0 || m.staggerImm > 0 || hasChip(m, 'lowCG')) return;   // 低重心：不會失衡
  const th = m.spec.legs.stagger, over = Math.min(1, dmg / th - 1);
  m.staggerT = m.staggerMax = 0.35 + 0.25 * over;
  m.stagDir = { x: dx, z: dz };
  m.boostT = 0;
  m.lockBreak = true;   // 鎖定進度歸零（玩家：sensors；電腦：ai.lockT）
  sparks(m.x, 0.3, m.z, 0xffd060, 14, 0, 0, 0.8);
  burst(m.x, 0.2, m.z, [0x8a8478, 0x5a5650], 5, 2);
  if (m.team === 'player') addTrauma(0.35);
}

export function damagePart(m, name, dmg, dx = 0, dz = 0) {
  if (m.grunt) name = 'torso';
  const p = m.parts[name];
  if (!m.alive || !p) return;
  p.flash = 0.07;
  if (p.broken && name !== 'torso') return;
  p.hp -= dmg;
  if (p.hp > 0) return;
  p.hp = 0;
  if (name === 'torso') { destroyMech(m, dx, dz); return; }
  if (p.broken) return;
  p.broken = true;
  breakPart(m, name, dx, dz);
}

const tmpV = new THREE.Vector3();
// 盾牌打爆：那隻手臂（連盾）炸掉
function breakShield(m, dx, dz) {
  const p = m.parts[m.shield.slot];
  m.shield.hp = 0;
  if (m.grunt) {
    voxelBurst(p.g, 40, 5, m.x, m.z, dx * 3, dz * 3);
    p.g.visible = false; p.broken = true;
    sfx.partBreak();
  } else if (!p.broken) { p.hp = 0; p.broken = true; breakPart(m, m.shield.slot, dx, dz); }
}
function breakPart(m, name, dx, dz) {
  const p = m.parts[name];
  voxelBurst(p.g, name === 'legs' ? 30 : 45, 5, m.x, m.z, dx * 3, dz * 3);
  p.g.getWorldPosition(tmpV);
  explosion(tmpV.x, partY(m, name, tmpV.y), tmpV.z, name.startsWith('back') ? 0.6 : 0.45);
  sfx.partBreak();
  G.hitStop = Math.max(G.hitStop, 0.05);
  addTrauma(m.team === 'player' ? 0.45 : 0.25);
  if (name === 'legs') {
    p.mat.color.setHex(0x5a5048);   // 腳壞了不拆掉，燒黑、拖著走
  } else p.g.visible = false;
}

const RR = (a, b) => a + Math.random() * (b - a);
function gruntBoom(m, dx, dz) {
  const x = m.x, z = m.z, y = m.model.hipY * m.k + 0.4;
  explosion(x, y, z, 1.15);
  setTimeout(() => explosion(x + RR(-0.5, 0.5), y - 0.2, z + RR(-0.5, 0.5), 0.75), 120);
  // 火花：很多、很快、往四面八方（偏向被打的方向）噴，落地會彈
  for (let i = 0; i < 160; i++) {
    const a = Math.random() * Math.PI * 2, el = RR(0.1, 1.25), sp = RR(6, 17);
    spawnGlow({ x: x + RR(-0.2, 0.2), y: y + RR(-0.2, 0.3), z: z + RR(-0.2, 0.2),
      vx: Math.cos(a) * Math.cos(el) * sp + dx * 3, vy: Math.sin(el) * sp, vz: Math.sin(a) * Math.cos(el) * sp + dz * 3,
      life: RR(0.5, 1.3), s0: RR(0.07, 0.14), s1: 0.02, ramp: RAMP.spark, g: 18, drag: 0.8, bounce: true });
  }
  // 火塊：大顆、慢一點、拖著燒
  for (let i = 0; i < 26; i++) {
    const a = Math.random() * Math.PI * 2, sp = RR(3, 8);
    spawnGlow({ x, y, z, vx: Math.cos(a) * sp + dx * 2, vy: RR(3, 8), vz: Math.sin(a) * sp + dz * 2,
      life: RR(0.7, 1.4), s0: RR(0.2, 0.34), s1: 0.04, ramp: RAMP.fire, g: 10, drag: 0.7, bounce: true });
  }
  for (let i = 0; i < 40; i++) {
    const a = Math.random() * Math.PI * 2, sp = RR(2, 6);
    spawnGlow({ x, y, z, vx: Math.cos(a) * sp, vy: RR(2, 6), vz: Math.sin(a) * sp, life: RR(0.8, 1.6), s0: 0.06, s1: 0.02, ramp: RAMP.ember, g: 5, drag: 0.6 });
  }
  smoke(x, y, z, 6, 1.4, 0x2a2a2e);
  G.hitStop = Math.max(G.hitStop, 0.03);
}
function destroyMech(m, dx, dz) {
  m.alive = false;
  // 主力機體：慢動作特寫 + 留下燒著的殘骸（src/wreck.js）
  if (m.ace) { startWreck(m, dx, dz); m.onDeath?.(m); return; }
  // 雜魚（自爆機、蟲群以外）：部位一個個被誘爆，或原地燒成焦炭（src/wreck.js 的 startDying）
  if (m.grunt && !m.bomber && !m.swarm) {
    startDying(m, dx, dz, { chain: !!m.fly, boom: () => gruntBoom(m, dx, dz) });
    G.hitStop = Math.max(G.hitStop, 0.02);
    addTrauma(0.2);
    m.onDeath?.(m);
    return;
  }
  // 雜魚：碎片燒得焦黑、三成還著火（被火焰籠罩的感覺）
  const fxOpts = m.grunt ? { char: 0.72, burn: 0.3 } : null;
  for (const k in m.parts) if (m.parts[k].g.visible) voxelBurst(m.parts[k].g, m.grunt ? 55 : 40, 7, m.x, m.z, dx * 3, dz * 3, fxOpts);
  burst(m.x, 1, m.z, [0x2a2a2e, 0x1a1a1e, m.colors.accent], 14, 7);
  if (m.grunt) {
    // 雜魚：不停格、不慢動作（一大群一直死），但要炸得好看：兩段爆炸 + 一大把往外噴的火花和火塊
    gruntBoom(m, dx, dz);
    burnAt(m.x, 0.25, m.z, 3.5, 0.9);
    scene.remove(m.model.root);
    sfx.explode();
    addTrauma(0.35);
    m.onDeath?.(m);
    return;
  }
  explosion(m.x, 1.1, m.z, 1.25);
  setTimeout(() => explosion(m.x + (Math.random() - 0.5) * 0.8, 0.8, m.z + (Math.random() - 0.5) * 0.8, 0.6), 160);
  burnAt(m.x, 0.25, m.z, 5, 1.1);
  scene.remove(m.model.root);
  sfx.explode();
  G.hitStop = Math.max(G.hitStop, 0.1);
  G.slowMo = Math.max(G.slowMo, 0.5);
  addTrauma(0.7);
  m.onDeath?.(m);
}

export function removeMech(m) {
  if (!isWreck(m) && !m.dying) scene.remove(m.model.root);   // 殘骸 / 擊破演出中的模型歸 wreck.js 管
  const i = mechs.indexOf(m);
  if (i >= 0) mechs.splice(i, 1);
}

// 機體互撞：依重量分開、交換法向速度；相對速度夠快兩台都受傷 = 衝撞攻擊（重的那台吃虧少）
export function collideMechs() {
  for (let i = 0; i < mechs.length; i++) for (let j = i + 1; j < mechs.length; j++) {
    const a = mechs[i], b = mechs[j];
    if (!a.alive || !b.alive || a.drop || b.drop) continue;
    const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz), min = a.r + b.r;
    if (d >= min || d < 1e-4) continue;
    const nx = dx / d, nz = dz / d, ov = min - d;
    const wa = a.spec.total, wb = b.spec.total, ka = wb / (wa + wb), kb = wa / (wa + wb);
    a.x -= nx * ov * ka; a.z -= nz * ov * ka; b.x += nx * ov * kb; b.z += nz * ov * kb;
    const rel = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;
    if (rel <= 0) continue;
    const imp = 1.05 * rel;   // 幾乎完全不反彈：撞上去就黏在一起推
    a.vx -= imp * ka * nx; a.vz -= imp * ka * nz; b.vx += imp * kb * nx; b.vz += imp * kb * nz;
    // 同一邊的雜魚互撞：只推開，不卡住、不受傷（叫雜魚互相閃避太貴）；王牌和雜魚、不同邊照舊
    if (a.grunt && b.grunt && a.team === b.team) continue;
    if (rel > STICK_SPEED) { stick(a, rel * ka * 2, -nx, -nz); stick(b, rel * kb * 2, nx, nz); }
    if (rel > 5) {
      const dmg = (rel - 5) * 9;
      // 衝角推進：主動撞過去的那台（沿撞擊方向在動）自己受傷 −70%、對方 ×2.5 並失衡
      const ramA = hasChip(a, 'ram') && a.vx * nx + a.vz * nz > 2, ramB = hasChip(b, 'ram') && -(b.vx * nx + b.vz * nz) > 2;
      damagePart(a, 'torso', dmg * ka * 1.6 * (ramA ? 0.3 : 1) * (ramB ? 2.5 : 1), nx, nz);
      damagePart(b, 'torso', dmg * kb * 1.6 * (ramB ? 0.3 : 1) * (ramA ? 2.5 : 1), -nx, -nz);
      if (ramA && b.alive) stagger(b, 999, nx, nz);
      if (ramB && a.alive) stagger(a, 999, -nx, -nz);
      hitSparks((a.x + b.x) / 2, 1.1, (a.z + b.z) / 2, -nx, -nz, 2);
      hitSparks((a.x + b.x) / 2, 1.1, (a.z + b.z) / 2, nx, nz, 2);
      sfx.crash();
      addTrauma(0.4);
      G.hitStop = Math.max(G.hitStop, 0.06);
    }
  }
}

// 畫面：位置、轉向、踏步、傾斜、受傷閃白、冒煙著火、揮劍
export function poseMech(m, dt) {
  if (!m.alive || m.drop) return;
  const M = m.model, L = m.spec.legs;
  const hover = L.type === 'hover' ? Math.sin(m.bob * 3) * 0.04 + 0.06 : 0;
  M.root.position.set(m.x, hover + (m.flyH ?? 0) + (m.fly ? Math.sin(m.bob * 2.2 + m.x) * 0.12 : 0), m.z);
  // 失衡：整台往被打的方向歪、快速晃
  if (m.staggerT > 0) {
    const k = m.staggerT / m.staggerMax, e = Math.sin((1 - k) * Math.PI) * 0.22 + Math.sin(m.bob * 38) * 0.04 * k;
    M.root.rotation.set(m.stagDir.z * e, 0, -m.stagDir.x * e);
  } else if (M.root.rotation.x || M.root.rotation.z) M.root.rotation.set(0, 0, 0);
  // 卡住時整台往撞到的方向陷進去一點、微微顫動（像在用力拔出來）
  if (m.stuckT > 0) {
    const k = m.stuckT / m.stuckMax, dent = 0.14 * m.stuckHit * k, sh = 0.025 * k * Math.sin(m.bob * 70);
    M.root.position.x += -m.stuckN.x * dent + m.stuckN.z * sh;
    M.root.position.z += -m.stuckN.z * dent - m.stuckN.x * sh;
    M.root.position.y -= 0.05 * m.stuckHit * k;
  }
  M.legsG.rotation.y = m.legYaw;
  const sw = Math.sin(m.walk) * 0.45;
  if (M.legs.length === 2) { M.legs[0].rotation.x = sw; M.legs[1].rotation.x = -sw; }
  const limp = m.parts.legs.broken ? 0.06 : 0;
  M.torsoG.position.y = M.hipY + Math.abs(Math.sin(m.walk)) * 0.05 - limp;
  M.torsoG.rotation.set(m.lean.x, m.torsoYaw, m.lean.z + (limp ? Math.sin(m.walk) * 0.05 : 0));
  // 揮劍：那隻手臂由外往內掃過去
  for (const slot of ['armL', 'armR']) {
    const p = m.parts[slot];
    if (!p) continue;
    const s = m.swing?.slot === slot ? m.swing : null;
    if (s) { const t = 1 - s.t / s.dur, side = slot === 'armL' ? 1 : -1; p.g.rotation.y = side * (1.1 - t * 2.4); }
    else p.g.rotation.y *= Math.exp(-12 * dt);
    // 背部武器準備中：手臂垂下、往外張開一點
    const e = ease(m.readyK[slot[3]]);
    p.g.rotation.x = 0.85 * e;
    p.g.rotation.z = (slot === 'armL' ? 1 : -1) * 0.12 * e;
  }
  // 背部武器架上肩膀：往上、往前移，炮口從朝後上方轉成朝前
  for (const side of ['L', 'R']) {
    const p = m.parts['back' + side];
    if (!p) continue;
    p.base0 ??= p.g.position.clone();
    const e = ease(m.readyK[side]);
    p.g.position.set(p.base0.x, p.base0.y + READY_OFF[1] * e, p.base0.z + READY_OFF[2] * e);
    p.g.rotation.x = -0.5 * Math.sin(e * Math.PI);   // 架上去的途中炮口先翹起來
  }
  for (const k in m.parts) {
    const p = m.parts[k];
    if (p.flash > 0) { p.flash -= dt; p.mat.emissive.setHex(p.flash > 0 ? 0x808080 : p.base); }
    const k01 = p.hp / p.max;
    if (!p.broken && k01 >= 0.5) continue;
    p.g.getWorldPosition(tmpV);
    const y = partY(m, k, tmpV.y);
    if (p.broken || k01 < 0.25) {
      p.fireAcc = (p.fireAcc ?? 0) + dt * (p.broken ? 22 : 7);
      while (p.fireAcc >= 1) { p.fireAcc--; fire(tmpV.x, y, tmpV.z, p.broken ? 0.75 : 0.45); }
      if (p.broken && Math.random() < dt * 1.5) sparks(tmpV.x, y, tmpV.z, 0xffb040, 4, 0, 0, 0.6);
    }
    p.smokeT -= dt * (p.broken ? 2.5 : 1.2);
    if (p.smokeT > 0) continue;
    p.smokeT = 0.35 + Math.random() * 0.3;
    smoke(tmpV.x, y + 0.2, tmpV.z, 1, 0.8, p.broken ? 0x1e1f22 : undefined);
  }
}
const ease = k => k * k * (3 - 2 * k);
// 各部位冒火 / 爆炸的高度
function partY(m, name, y) {
  return name === 'legs' ? m.model.hipY * 0.55 : name === 'head' ? y + 0.2 : name === 'torso' ? y + 0.5 : name.startsWith('back') ? y + 0.1 : y + 0.3;
}
export { WEAPONS };
