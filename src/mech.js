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
import { RAMP, burnAt, burst, chipDebris, explosion, fire, flame, hitSparks, smoke, sparks, spawnGlow, spawnPuff, voxelBurst } from './fx.js';
import { sfx } from './audio.js';
import { BAL, EFFECT, WEAPONS, computeSpec } from './parts.js';
import { buildMechModel } from './model.js';
import { CHIPS, DEVICES, hasChip } from './tech.js';
import { collideWrecks, isWreck, startDying, startWreck } from './wreck.js';
import { damageBuilding } from './buildings.js';
import { burnLegK, clearStatus, corrodeK, hasStatus, reduceStatus, setStatusHooks } from './status.js';
import { CL, att, log, srcOf } from './combatlog.js';

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
let MECH_ID = 0;
export function makeMech({ team, colors, loadout, x = 0, z = 0, yaw = Math.PI, hpMul = 1, ace = true, grunt = null }) {
  const spec = computeSpec(loadout);
  if (grunt) spec.hp.torso = grunt.hp;
  // 菁英：數值蓋掉零件算出來的
  const E = loadout.elite;
  if (E) {
    for (const p in spec.hp) spec.hp[p] *= E.hpMul ?? 1;
    if (E.vmax) spec.vmax = E.vmax; if (E.acc) spec.acc = E.acc; if (E.boost != null) spec.boost = E.boost;   // boost 0 = 不能推進
    if (E.turn) spec.turn = E.turn; if (E.legTurn) spec.legTurn = E.legTurn;
    if (E.stagger) spec.legs = { ...spec.legs, stagger: E.stagger };
    spec.regen = 1; spec.backOver = false;   // 肩炮很重但不拖慢能量回復（推進要常用）
  }
  const shieldSlot = ['armL', 'armR'].find(s => loadout[s] && WEAPONS[loadout[s]].kind === 'shield');
  if (grunt && shieldSlot) { spec.turn *= 0.35; spec.legTurn *= 0.5; }   // 盾兵：轉得非常慢 → 繞背打得到
  const M = buildMechModel(loadout, colors);
  const k = grunt ? GRUNT_SCALE : E?.scale ?? 1;
  M.root.scale.setScalar(k);
  // 雜魚腳下一圈派系色的光環：一群混在一起時一眼分得出誰是哪邊
  if (grunt) {
    const ring = new THREE.Mesh(TEAM_RING, addMat(colors.glow, 0.55));
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.04;
    M.root.add(ring); M.teamRing = ring;
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
    alive: true, ace: ace && !grunt, elite: !!E, surf: null, guns: null, onDeath: null, swing: null,
    // 背部武器準備：ready = 那一邊現在用背部武器、deployT = 展開 / 收回中還剩幾秒（不能開火）、readyK = 動畫 0..1
    ready: { L: false, R: false }, deployT: { L: 0, R: 0 }, readyK: { L: 0, R: 0 },
    staggerT: 0, staggerMax: 0, staggerImm: 0, stagDir: { x: 0, z: 0 },
    chips: [...(loadout.chips ?? [])], device: DEVICES[loadout.device] ? { id: loadout.device, charges: DEVICES[loadout.device].charges ?? 0, cd: 0 } : null,
    shield: shieldSlot ? { slot: shieldSlot, hp: WEAPONS[loadout[shieldSlot]].guard * (grunt ? 0.7 : 1) * hpMul, max: WEAPONS[loadout[shieldSlot]].guard * (grunt ? 0.7 : 1) * hpMul, armor: loadout.armor.arms } : null,
  };
  if (m.chips.includes('lockPlus')) spec.head = { ...spec.head, lockCount: spec.head.lockCount + 1, lockArc: Math.round(spec.head.lockArc * 0.6) };   // 鎖定擴充
  m.id = ++MECH_ID;
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
// 背部模組有沒有在作用（裝著、那個背部沒壞）
export const hasModule = (m, kind) => ['backL', 'backR'].some(s => m.guns?.[s]?.def.module === kind && !slotBroken(m, s));
export function canReady(m, side) {
  const g = m.guns?.['back' + side];
  return !!g && g.def.kind !== 'module' && !slotBroken(m, 'back' + side) && g.ammo > 0;
}
const deployT = m => hasChip(m, 'quickSwap') ? 0.05 : DEPLOY_T;   // 快速換裝
// 盾牌那一邊：盾一直舉著、不能被選成使用中，那一側的滑鼠鍵固定打背部武器
const shieldArm = (m, side) => m.guns?.['arm' + side]?.def.kind === 'shield' && !slotBroken(m, 'arm' + side);
export function toggleReady(m, side) {
  if (!m.alive || m.swing) return false;
  const on = !m.ready[side];
  if (!on && shieldArm(m, side)) return false;
  if (on && !canReady(m, side)) return false;
  m.ready[side] = on;
  m.deployT[side] = deployT(m);
  log('ready', { m: m.id, side, back: on });
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
    const ag = m.guns?.['arm' + side], armOk = !!ag && !slotBroken(m, 'arm' + side) && ag.ammo > 0 && ag.def.kind !== 'shield';
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
  if (!m.alive || m.grunt || !m.spec.boost || m.staggerT > 0 || m.boostCd > 0 || m.energy < BOOST_COST || m.charge) return false;
  const d = boostDirOf(m, mx, mz), k = boostKOf(m);
  // 噴射只往一個方向：原本的速度只留沿著噴射方向的分量（往反方向跑的會被抵銷），橫向的全部吃掉
  const along = Math.max(0, m.vx * d.x + m.vz * d.z);
  m.vx = d.x * (along + BOOST_DV * k); m.vz = d.z * (along + BOOST_DV * k);
  m.stuckT = 0;
  m.boostDir = d; m.boostK = k; m.boostT = BOOST_TIME; m.boostCd = BOOST_TIME + (hasChip(m, 'doubleBoost') ? 0.02 : BOOST_CD);
  m.energy -= BOOST_COST; m.energyT = ENERGY_DELAY;
  log('boost', { m: m.id, dx: Math.round(d.x * 100) / 100, dz: Math.round(d.z * 100) / 100 });
  reduceStatus(m, 'burn', 1.5);   // 推進甩掉一些火
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
  const vmax = S.vmax * lk * (L.noMud ? 1 : (s.speed ?? 1)) * burnLegK(m);   // 腳燒起來會變慢（status.js）
  m.boostCd -= dt;
  m.energyT -= dt;
  if (m.energyT <= 0) m.energy = Math.min(100, m.energy + ENERGY_REGEN * S.regen * (hasChip(m, 'doubleBoost') ? 0.75 : 1) * dt);
  // 失衡：腳不出力、轉不太動
  if (m.staggerT > 0) { if ((m.staggerT -= dt) <= 0) m.staggerImm = STAGGER_IMM; mx = 0; mz = 0; m.charge = null; }
  else if (m.staggerImm > 0) m.staggerImm -= dt;
  // 騎槍衝鋒（weapons.js 開的頭）：點火時站住不動、衝刺時整台鎖在一個方向；兩段都不吃移動指令
  const C = m.charge;
  if (C && C.phase === 'thrust') { if ((C.t -= dt) <= 0) m.charge = null; }   // 刺擊（平衡實驗）：照常走路 / 推進，下面撞到才算
  else if (C) {
    mx = mz = 0;
    if ((C.t -= dt) <= 0) {
      if (C.phase === 'ignite') {
        const f = facing(m);
        Object.assign(C, { phase: 'dash', t: C.d.dashT, dx: f.x, dz: f.z, v: C.d.speed });
        log('charge', { m: m.id, phase: 'dash' });
        sfx.boost(); sfx.cannon();
        for (let i = 0; i < 10; i++) flame(m.x - f.x * 0.5, m.model.hipY + 0.5, m.z - f.z * 0.5, -f.x * 2 + (Math.random() - 0.5), -f.z * 2 + (Math.random() - 0.5));
        smoke(m.x - f.x * 0.6, 0.4, m.z - f.z * 0.6, 4, 1.2, 0x9a9ca2);
        if (m.team === 'player') addTrauma(0.3);
      } else m.charge = null;
    }
  }
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

  if (C && m.charge && C.phase !== 'thrust') {
    const f = facing(m);
    if (C.phase === 'dash') {
      m.vx = C.dx * C.v; m.vz = C.dz * C.v;
      for (let i = 0; i < 3; i++) flame(m.x - C.dx * 0.5 + (Math.random() - 0.5) * 0.4, m.model.hipY + 0.5, m.z - C.dz * 0.5 + (Math.random() - 0.5) * 0.4, -C.dx * 1.5, -C.dz * 1.5);
    } else {
      // 點火：剎住、背後的噴射器火越來越大
      const k = Math.exp(-14 * dt); m.vx *= k; m.vz *= k;
      const heat = 1 - C.t / C.d.ignite;
      for (let i = 0; i < 1 + heat * 3; i++) flame(m.x - f.x * 0.45 + (Math.random() - 0.5) * 0.3, m.model.hipY + 0.5, m.z - f.z * 0.45 + (Math.random() - 0.5) * 0.3, -f.x * (0.3 + heat), -f.z * (0.3 + heat));
    }
  } else if (m.boostT > 0) {
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
  const dashing = m.charge?.phase === 'dash';
  if (dashing) lanceHit(m);
  else if (m.charge?.phase === 'thrust') { const f = facing(m); Object.assign(m.charge, { dx: f.x, dz: f.z, v: Math.max(0, m.vx * f.x + m.vz * f.z) }); lanceHit(m); }
  const hit = collideBlocks(m, m.r, 0, !!m.fly);
  // 騎槍衝刺撞牆 / 建築：撞敵機會給的那一下，全部吃在拿騎槍的那隻手上
  if (dashing && m.charge && hit.hit > 2) {
    const C2 = m.charge, dmg = Math.min(C2.d.dmgMax, C2.v * C2.d.dmgK) * BAL.lanceWallK;
    m.charge = null;
    // 拿騎槍的那隻手扛下撞擊（那隻手已經沒了就算軀幹）
    log('charge', { m: m.id, phase: 'wall', dmg: Math.round(dmg) });
    att(m, 'lance', () => hitMech(m, dmg, hit.nx, hit.nz, 0, 'kinetic', m.parts[C2.slot] && !m.parts[C2.slot].broken ? C2.slot : 'torso', dmg));
    damageBuilding(m.x - hit.nx * (m.r + 0.05), 1, m.z - hit.nz * (m.r + 0.05), dmg * 1.5, -hit.nx, -hit.nz);
    hitSparks(m.x - hit.nx * m.r, 1, m.z - hit.nz * m.r, hit.nx, hit.nz, 2.4);
    burst(m.x - hit.nx * m.r, 0.8, m.z - hit.nz * m.r, [0x7a8090, 0x4a505c], 6, 3.5);
    sfx.crash();
    if (m.team === 'player') addTrauma(0.6);
    stick(m, hit.hit, hit.nx, hit.nz);
    hit.hit = 0;   // 不再另外算一般的撞牆傷害
  }
  if (hit.hit > STICK_SPEED) {
    // 不反彈，連沿著牆滑的速度也被磨掉一大半
    const vt = m.vx * -hit.nz + m.vz * hit.nx, keep = Math.max(0.15, 1 - hit.hit * 0.08);
    m.vx = -hit.nz * vt * keep; m.vz = hit.nx * vt * keep;
    stick(m, hit.hit, hit.nx, hit.nz);
  }
  if (hit.hit > CRASH_SPEED) crash(m, hit.hit - CRASH_SPEED, hit.nx, hit.nz);
  const wh = collideWrecks(m);
  if (wh.hit > STICK_SPEED) stick(m, wh.hit, wh.nx, wh.nz);

  if (!dashing) m.torsoYaw = approachAngle(m.torsoYaw, aimYaw, S.turn * (m.parts.head.broken ? 0.7 : 1) * (m.staggerT > 0 ? 0.2 : 1) * (m.beamTurnK ?? 1) * dt);   // 衝刺中上半身鎖住；光束照射中轉得慢
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

// 騎槍衝刺撞上敵機：正前方、碰到（槍尖多算 0.45 格）就撞
// 傷害 = 撞上去的相對速度（自己的速度 − 對方沿衝刺方向的速度：迎面衝過來的更痛）× dmgK，最多 dmgMax；自己不受傷、停下來
function lanceHit(m) {
  const C = m.charge, d = C.d;
  for (const o of mechs) {
    if (o === m || !o.alive || o.drop || o.team === m.team) continue;
    const ox = o.x - m.x, oz = o.z - m.z, dist = Math.hypot(ox, oz);
    if (dist > m.r + o.r + 0.45 || ox * C.dx + oz * C.dz < 0) continue;
    const closing = Math.max(0, C.v - (o.vx * C.dx + o.vz * C.dz));
    const dmg = Math.min(d.dmgMax, closing * d.dmgK) * (m.dmgMul ?? 1);
    log('charge', { m: m.id, phase: 'hit', tgt: o.id, speed: Math.round(closing * 10) / 10 });
    att(m, 'lance', () => hitMech(o, dmg, C.dx, C.dz, d.kb, 'kinetic', null, closing * d.dmgK));
    const hx = m.x + C.dx * (m.r + 0.3), hz = m.z + C.dz * (m.r + 0.3);
    hitSparks(hx, 1.1, hz, -C.dx, -C.dz, 3);
    explosion(hx, 1.1, hz, 0.35);
    burst(hx, 1, hz, [0x8a909a, 0x5a606c], 6, 4);
    sfx.crash(); sfx.hit();
    if (m.team === 'player' || o.team === 'player') addTrauma(0.55);
    m.vx = C.dx * 1.5; m.vz = C.dz * 1.5;
    m.charge = null;
    return;
  }
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
  att(null, 'crash', () => { damagePart(m, 'legs', dmg * 0.6, nx, nz); if (m.alive) damagePart(m, 'torso', dmg * 0.4, nx, nz); });
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
    if (-dx * f.x - dz * f.z > 0.34) { m.vx += dx * kb * 0.3; m.vz += dz * kb * 0.3; if (CL.on) log('hit', { tgt: m.id, ...srcOf(), part: 'eshield', raw: Math.round(dmg), eff: 0, eshield: true }); return { part: 'torso', eff: 0.3, shield: true }; }
  }
  // 盾牌：從盾那一側前方來的攻擊先打在盾上
  const Sh = m.shield;
  if (Sh && Sh.hp > 0 && !m.parts[Sh.slot]?.broken) {
    const f = facing(m), sd = Sh.front ? 0 : Sh.slot === 'armL' ? 1 : -1;   // front：正面的甲殼（衝鋒蟲），不偏哪一邊
    let cx = f.x + f.z * 0.7 * sd, cz = f.z - f.x * 0.7 * sd;
    const cl = Math.hypot(cx, cz); cx /= cl; cz /= cl;
    if (-dx * cx - dz * cz > 0.2) {
      const eff = EFFECT[type][Sh.armor] ?? 1, take = dmg * eff * (splash ? 0.5 : 1);
      Sh.hp -= take;
      if (CL.on) log('hit', { tgt: m.id, ...srcOf(), part: 'shield', raw: Math.round(dmg), eff, shield: true, amt: Math.round(take) });
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
  if (!m.grunt && !forced && hasStatus(m, 'mark') && Math.random() < 0.75) {
    const opts = Object.keys(m.parts).filter(k => k !== 'torso' && !m.parts[k].broken);
    if (opts.length) part = opts[Math.floor(Math.random() * opts.length)];
  }
  // 核心：殼在攻擊者那一面被剝開了 → 子彈大多打進去（瞄準中間），打到就一擊打爆那個部位（關鍵部位 = 整台）
  if (!m.grunt) {
    if (!forced && part !== 'torso' && m.parts.torso.core && !m.parts.torso.broken && coreOpen(m, 'torso', fromX, fromZ) && Math.random() < 0.6) part = 'torso';
    const P = m.parts[part];
    if (P.core && !P.broken && coreOpen(m, part, fromX, fromZ)) { m.vx += dx * kb; m.vz += dz * kb; if (CL.on) log('hit', { tgt: m.id, ...srcOf(), part, raw: Math.round(dmg), eff: 2, dir, core: true }); coreBreak(m, part, dx, dz); return { part, eff: 2, core: true }; }
  }
  const mul = part === 'torso' && !forced && !m.grunt ? TORSO_MUL[dir] : 1;
  const eff = EFFECT[type][m.parts[part].armor] ?? 1;
  m.vx += dx * kb; m.vz += dz * kb;
  // 反應裝甲：每個部位每 8 秒，第一次被打中傷害減半
  let rk = 1;
  if (hasChip(m, 'reactive') && (m.parts[part].reactT ?? 0) <= G.now) { rk = 0.5; m.parts[part].reactT = G.now + 8; }
  if (CL.on) log('hit', { tgt: m.id, ...srcOf(), part, raw: Math.round(dmg * 10) / 10, eff, dir });
  damagePart(m, part, dmg * mul * eff * rk * corrodeK(m, part), dx, dz);   // 被腐蝕的部位吃更多傷害（status.js）
  const th = m.spec.legs.stagger ?? Infinity;
  if (m.alive && BAL.staggerAccum && th !== Infinity) {
    // 累積制（平衡實驗）：上次被打到現在消退一些，再加上這一下的威力
    m.stagBuild = Math.max(0, (m.stagBuild ?? 0) - (G.now - (m.stagAt ?? G.now)) * th * BAL.staggerDecay) + power; m.stagAt = G.now;
    if (m.stagBuild >= th) { stagger(m, m.stagBuild, dx, dz); if (m.staggerT > 0) m.stagBuild = 0; }
  } else if (m.alive && power >= th) stagger(m, power, dx, dz);
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
  log('stagger', { m: m.id, power: Math.round(dmg) });
  m.stagDir = { x: dx, z: dz };
  m.boostT = 0;
  m.lockBreak = true;   // 鎖定進度歸零（玩家：sensors；電腦：ai.lockT）
  sparks(m.x, 0.3, m.z, 0xffd060, 14, 0, 0, 0.8);
  burst(m.x, 0.2, m.z, [0x8a8478, 0x5a5650], 5, 2);
  if (m.team === 'player') addTrauma(0.35);
}

// 持續效果（status.js）要扣血 / 殉爆時用的：燃燒照化學對那個部位裝甲的倍率扣
setStatusHooks({
  damage(m, part, dmg, type) {
    const p = m.parts[m.grunt ? 'torso' : part] ?? m.parts.torso;
    damagePart(m, m.grunt ? 'torso' : part, dmg * (EFFECT[type][p.armor] ?? 1));
  },
  // 背部武器被燒到殉爆：還有彈藥（不是能量武器）才會；那個掛點直接炸掉，軀幹也吃一下
  cookOff(m, slot) {
    const g = m.guns?.[slot];
    if (!m.alive || !g || !isFinite(g.ammo) || g.ammo <= 0 || m.parts[slot]?.broken) return;
    g.ammo = 0;
    damagePart(m, slot, 1e6);
    if (m.alive) damagePart(m, 'torso', 18 + (g.def.dmg ?? 20) * 0.4);
    addTrauma(m.team === 'player' ? 0.5 : 0.15);
    if (m.team === 'player') sfx.explode();
  },
});
// ---------- 外觀磨損：耐久掉多少，表面的方塊就被打掉多少 ----------
// 部位耐久每少 1%，就打掉那個部位表面 WEAR_MAX% 的方塊（打滿 = 剩一口氣時缺了 WEAR_MAX 那麼多）；優先打朝向攻擊方向那一面
// 打掉的方塊往外彈、落地留在地上（fx.js chipDebris → 碎片堆）；旁邊再挑一顆壓暗當焦痕。修回來就照比例補回去（最後打掉的先補）
// 方塊是實心的：打掉外層露出裡面那層（比較暗），所以是一層一層挖下去
// 雜魚只有一條血（軀幹）：整台的方塊一起算；蟲子是另外做的模型，不磨損
const WEAR_MAX = 0.32, WEAR_FX_MAX = 6, SCAR_K = 0.55;
// 有核心的部位：殼可以剝掉更多（CORE_WEAR）；殼的某一面被打掉 CORE_OPEN 以上 = 那一面的核心露出來
const CORE_WEAR = 0.72, CORE_OPEN = 0.7, CORE_HP = 0.3;   // 而且耐久要掉到 CORE_HP 以下才算露出（殼本身也有厚度）
const FACES = ['x+', 'x-', 'z+', 'z-', 'y+', 'y-'];
const wV = new THREE.Vector3();
// 候選：每個方塊身體（src/voxbody.js）裡深度 ≤ 2（有核心的部位 ≤ 3）的方塊；要「現在露在外面」才打得掉 → 一層一層往裡挖
// 數量照一開始露在外面的方塊數算（surf），跟解析度無關
function wearPool(m, p) {
  if (p.wear) return p.wear;
  const groups = m.grunt ? Object.values(m.parts).map(q => q.g) : [p.g];
  const bodies = [], cb = [], ci = [];
  let surf = 0;
  const maxD = p.core ? 3 : 2;
  for (const g of groups) g.traverse(o => {
    const b = o.userData.vb;
    if (!b || o.userData.core) return;
    const k = bodies.push({ o, b }) - 1;
    for (let i = 0; i < b.n; i++) { const d = b.depth[i]; if (d && d <= maxD) { cb.push(k); ci.push(i); if (d === 1) surf++; } }
  });
  const W = p.wear = { bodies, cb: Int32Array.from(cb), ci: Int32Array.from(ci), cf: new Int8Array(cb.length).fill(-1), surf, gone: [], scar: [], tot: {}, open: {}, anyOpen: false };
  // 核心的殼：每顆方塊算是哪一面（離核心中心最遠的那一軸）
  const C = p.core;
  if (C) {
    for (const f of FACES) { W.tot[f] = 0; W.open[f] = 0; }
    for (let k = 0; k < W.cb.length; k++) {
      bodies[W.cb[k]].b.pos(W.ci[k], wV);
      const rx = (wV.x - C.c[0]) / C.half[0], ry = (wV.y - C.c[1]) / C.half[1], rz = (wV.z - C.c[2]) / C.half[2];
      const ax = Math.abs(rx), ay = Math.abs(ry), az = Math.abs(rz);
      if (Math.max(ax, ay, az) > 1.01) continue;
      const f = ax >= ay && ax >= az ? (rx > 0 ? 0 : 1) : az >= ay ? (rz > 0 ? 2 : 3) : (ry > 0 ? 4 : 5);
      W.cf[k] = f; W.tot[FACES[f]]++;
    }
  }
  return W;
}
// quiet：不噴碎片（剛生出來 / 重組時照耐久直接套上去）
export function syncWear(m, name, dx = 0, dz = 0, quiet = false) {
  if (m.bug || m.swarm) return;
  const p = m.parts[name];
  if (!p?.g || p.broken && name !== 'legs') return;
  const W = wearPool(m, p), NC = W.cb.length;
  if (!NC) return;
  const want = Math.floor(W.surf * (p.core ? CORE_WEAR : WEAR_MAX) * Math.max(0, 1 - p.hp / p.max));
  let fx = 0;
  // 被打：挑幾顆露在外面的候選，選最朝向攻擊者的那顆打掉
  for (let tries = 0; W.gone.length < want && tries < 600; tries++) {
    let best = -1, bs = Infinity, bx = 0, by = 0, bz = 0;
    for (let k = 0; k < 16; k++) {   // 細方塊很多：多抽幾顆才夠偏向打過來的那一面
      const c = Math.floor(Math.random() * NC), B = W.bodies[W.cb[c]], i = W.ci[c];
      if (B.b.gone[i] || B.o.parent && !B.o.parent.visible || !B.b.exposed(i)) continue;
      B.b.pos(i, wV).applyMatrix4(B.o.matrixWorld);
      const sc = (dx || dz) ? (wV.x - m.x) * dx + (wV.z - m.z) * dz : Math.random();
      if (sc < bs) { bs = sc; best = c; bx = wV.x; by = wV.y; bz = wV.z; }
    }
    if (best < 0) continue;
    const B = W.bodies[W.cb[best]], i = W.ci[best];
    B.b.hide(i);
    W.gone.push(best);
    if (W.cf[best] >= 0) W.open[FACES[W.cf[best]]]++;
    if (!quiet && fx++ < WEAR_FX_MAX) chipDebris(bx, by, bz, B.b.hex[i], -dx * 0.7, -dz * 0.7);   // 往打過來的那一側彈
    // 旁邊的一顆壓暗（焦痕）
    const s = Math.floor(Math.random() * NC), S = W.bodies[W.cb[s]].b, si = W.ci[s];
    if (!S.gone[si] && !S.scarred[si]) { S.scar(si); W.scar.push(s); }
  }
  // 修好：照比例補回去，焦痕也一起淡掉
  while (W.gone.length > want) {
    const c = W.gone.pop();
    if (W.cf[c] >= 0) W.open[FACES[W.cf[c]]]--;
    W.bodies[W.cb[c]].b.show(W.ci[c]);
    const s = W.scar.pop();
    if (s != null) W.bodies[W.cb[s]].b.scar(W.ci[s], false);
  }
  // 核心剛露出來：噴一下火花提示
  if (p.core) {
    const any = p.hp <= p.max * (p.core.gate ?? CORE_HP) && FACES.some(f => W.tot[f] && W.open[f] / W.tot[f] >= CORE_OPEN);
    if (any && !W.anyOpen && !quiet) { const w = coreWorld(m, p); sparks(w.x, w.y, w.z, 0xffa040, 18, -dx, -dz, 1); sfx.partBreak(); }
    W.anyOpen = any;
  }
}
// ---------- 核心 ----------
// 攻擊從哪一面來（部位本地座標：+z 前、+x 左邊…照模型的 x）；軀幹 / 頭跟著上半身轉，腳跟著腳轉
const cV = new THREE.Vector3();
function coreWorld(m, p) { p.core.mesh.updateWorldMatrix(true, false); cV.set(...p.core.c).applyMatrix4(p.core.mesh.matrixWorld); return { x: cV.x, y: cV.y, z: cV.z }; }
export function coreOpen(m, name, fromX, fromZ) {
  const p = m.parts[name], W = p?.core && wearPool(m, p);
  if (!W) return false;
  const yaw = name === 'legs' ? m.legYaw : m.torsoYaw, s = Math.sin(yaw), c = Math.cos(yaw);
  const lx = fromX * c - fromZ * s, lz = fromX * s + fromZ * c;
  const f = Math.abs(lx) > Math.abs(lz) ? (lx > 0 ? 'x+' : 'x-') : (lz > 0 ? 'z+' : 'z-');
  return p.hp <= p.max * (p.core.gate ?? CORE_HP) && W.tot[f] > 0 && W.open[f] / W.tot[f] >= CORE_OPEN;
}
// 核心被打中：一團光炸開、定格，部位直接打爆；關鍵部位（crit）= 整台擊毀
function coreBreak(m, name, dx, dz) {
  const p = m.parts[name], w = coreWorld(m, p);
  p.core.mesh.visible = false;
  sparks(w.x, w.y, w.z, 0xffc060, 50, dx, dz, 1.6);
  for (let i = 0; i < 30; i++) {
    const a = Math.random() * Math.PI * 2, sp = 3 + Math.random() * 7;
    spawnGlow({ x: w.x, y: w.y, z: w.z, vx: Math.cos(a) * sp + dx * 4, vy: 2 + Math.random() * 6, vz: Math.sin(a) * sp + dz * 4, life: 0.4 + Math.random() * 0.6, s0: 0.12, s1: 0.02, ramp: RAMP.spark, g: 14, drag: 0.7, bounce: true });
  }
  explosion(w.x, w.y, w.z, 0.9);
  G.hitStop = Math.max(G.hitStop, 0.14);
  addTrauma(0.5);
  damagePart(m, name, 1e9, dx, dz);
  if (p.core.crit && name !== 'torso' && m.alive) damagePart(m, 'torso', 1e9, dx, dz);
}
export function damagePart(m, name, dmg, dx = 0, dz = 0) {
  if (m.grunt) name = 'torso';
  const p = m.parts[name];
  if (!m.alive || !p) return;
  p.flash = 0.07;
  if (p.broken && name !== 'torso') return;
  if (CL.on) log('dmg', { tgt: m.id, part: name, amt: Math.round(Math.min(dmg, p.hp) * 10) / 10, ...srcOf() });
  p.hp -= dmg;
  if (p.hp > 0) { syncWear(m, name, dx, dz); return; }
  p.hp = 0;
  if (name === 'torso') { if (CL.on) log('kill', { tgt: m.id, ...srcOf() }); destroyMech(m, dx, dz); return; }
  if (p.broken) return;
  p.broken = true;
  if (CL.on) log('break', { tgt: m.id, part: name, ...srcOf() });
  breakPart(m, name, dx, dz);
}

const tmpV = new THREE.Vector3();
// 盾牌打爆：那隻手臂（連盾）炸掉
function breakShield(m, dx, dz) {
  const p = m.parts[m.shield.slot];
  m.shield.hp = 0;
  if (m.shield.front) { m.shield.onBreak?.(dx, dz); sfx.partBreak(); return; }   // 衝鋒蟲的正面甲殼：碎掉就好，本體不受影響
  if (m.grunt) {
    voxelBurst(p.g, 40, 5, m.x, m.z, dx * 3, dz * 3);
    p.g.visible = false; p.broken = true;
    sfx.partBreak();
  } else if (!p.broken) { p.hp = 0; p.broken = true; breakPart(m, m.shield.slot, dx, dz); }
}
function breakPart(m, name, dx, dz) {
  // 彈藥架被打壞：彈藥壓回原本的上限、殉爆打軀幹
  const mod = m.guns?.[name]?.def;
  if (mod?.module === 'ammo' && !hasModule(m, 'ammo')) {
    for (const g of Object.values(m.guns)) if (g.base !== Infinity && g.base != null) { g.max = g.base; g.ammo = Math.min(g.ammo, g.base); }
    explosion(m.x, m.model.hipY + 0.8, m.z, 0.4);
    att(null, 'cookoff', () => damagePart(m, 'torso', mod.cookoff, dx, dz));
  }
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
  const burning = hasStatus(m, 'burn');
  for (const k in m.parts) { const C = m.parts[k].core; if (C) C.mat.color.setHex(0x2a0c04); }   // 核心熄掉
  clearStatus(m);
  m.alive = false;
  if (m.model.teamRing) m.model.teamRing.visible = false;   // 被擊毀就把腳下的派系光環收掉
  // 主力機體：慢動作特寫 + 留下燒著的殘骸（src/wreck.js）
  if (m.ace) { startWreck(m, dx, dz); m.onDeath?.(m); return; }
  // 雜魚（自爆機、蟲群以外）：部位一個個被誘爆，或原地燒成焦炭（src/wreck.js 的 startDying）
  if (m.grunt && !m.bomber && !m.swarm && !m.bug) {
    startDying(m, dx, dz, { chain: !!m.fly, burn: burning && !m.fly, boom: () => gruntBoom(m, dx, dz) });   // 燒死的一定是原地燒成焦炭
    G.hitStop = Math.max(G.hitStop, 0.02);
    addTrauma(0.2);
    m.onDeath?.(m);
    return;
  }
  // 蟲子（src/bugs.js）：不爆炸，碎幾塊、留下屍體
  if (m.bug) { m.dying = true; m.bug.die(dx, dz); addTrauma(0.15); m.onDeath?.(m); return; }
  // 蟲群：不爆炸，剩下的蟲各自碎掉（ai.js 的 onDeath）
  if (m.swarm) { m.onDeath?.(m); return; }
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
  // 核心一直脈動；露出來之後更亮、跳得更快
  for (const k in m.parts) {
    const C = m.parts[k].core;
    if (!C || m.parts[k].broken) continue;
    const open = m.parts[k].wear?.anyOpen, b = open ? 1.25 + 0.45 * Math.sin(G.now * 11) : 0.85 + 0.2 * Math.sin(G.now * 4);
    C.mat.color.copy(C.base).multiplyScalar(b);
  }
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
    // 背部武器準備中：手臂垂下、往外張開一點（拿盾的手臂不放下，盾一直舉著）
    const e = m.guns?.[slot]?.def.kind === 'shield' ? 0 : ease(m.readyK[slot[3]]);
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
