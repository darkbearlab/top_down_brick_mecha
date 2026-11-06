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
import { G, addTrauma, angleDiff, approachAngle, scene } from './core.js';
import { collideBlocks, surfaceAt } from './arena.js';
import { burnAt, burst, explosion, fire, flame, hitSparks, smoke, sparks, spawnPuff, voxelBurst } from './fx.js';
import { sfx } from './audio.js';
import { EFFECT, WEAPONS, computeSpec } from './parts.js';
import { buildMechModel } from './model.js';
import { collideWrecks, isWreck, startWreck } from './wreck.js';
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
export function makeMech({ team, colors, loadout, x = 0, z = 0, yaw = Math.PI, hpMul = 1, ace = true }) {
  const spec = computeSpec(loadout);
  const M = buildMechModel(loadout, colors);
  M.root.position.set(x, 0, z);
  scene.add(M.root);
  const parts = {};
  for (const k in M.parts) {
    const max = (spec.hp[k] ?? 60) * hpMul;
    parts[k] = { ...M.parts[k], hp: max, max, broken: false, flash: 0, smokeT: Math.random(), armor: loadout.armor[ARMOR_OF[k]] };
  }
  const m = {
    team, colors, loadout, spec, model: M, parts, x, z, vx: 0, vz: 0, r: loadout.legs === 'tread' ? 0.95 : 0.85,
    legYaw: yaw, torsoYaw: yaw, walk: 0, lean: { x: 0, z: 0 }, lastV: { x: 0, z: 0 }, bob: 0,
    energy: 100, energyT: 0, boostT: 0, boostCd: 0, boostDir: { x: 0, z: 0 }, stuckT: 0, stuckMax: 0, stuckN: { x: 0, z: 0 },
    alive: true, ace, surf: null, guns: null, onDeath: null, swing: null,
    // 背部武器準備：ready = 那一邊現在用背部武器、deployT = 展開 / 收回中還剩幾秒（不能開火）、readyK = 動畫 0..1
    ready: { L: false, R: false }, deployT: { L: 0, R: 0 }, readyK: { L: 0, R: 0 },
  };
  mechs.push(m);
  return m;
}

export const legK = m => m.parts.legs.broken ? 0.35 : 0.65 + 0.35 * m.parts.legs.hp / m.parts.legs.max;
export const facing = m => ({ x: Math.sin(m.torsoYaw), z: Math.cos(m.torsoYaw) });
export function toWorld(m, [lx, ly, lz]) {
  const s = Math.sin(m.torsoYaw), c = Math.cos(m.torsoYaw);
  return { x: m.x + lx * c + lz * s, y: m.model.hipY + ly, z: m.z - lx * s + lz * c };
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
// 切換要 DEPLOY_T 秒，期間那一邊不能開火；背部武器開始換彈 / 被打掉時自動換回手臂
export const DEPLOY_T = 0.3;
const LOCK_KINDS = new Set(['missile', 'split', 'vmissile']);
export const activeSlot = (m, side) => (m.ready[side] ? 'back' : 'arm') + side;
export function canReady(m, side) {
  const g = m.guns?.['back' + side];
  return !!g && !slotBroken(m, 'back' + side) && g.reloadT <= 0;
}
export function toggleReady(m, side) {
  if (!m.alive || m.swing) return false;
  const on = !m.ready[side];
  if (on && !canReady(m, side)) return false;
  m.ready[side] = on;
  m.deployT[side] = DEPLOY_T;
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
    // 換彈或被打掉：自動收回、換回手臂；那一邊手上沒武器（或被打掉）就一直架著背部武器
    const armOk = !!m.guns?.['arm' + side] && !slotBroken(m, 'arm' + side);
    if (m.ready[side] && armOk && !canReady(m, side)) { m.ready[side] = false; m.deployT[side] = DEPLOY_T; }
    if (!m.ready[side] && !armOk && m.guns?.['back' + side] && !slotBroken(m, 'back' + side)) { m.ready[side] = true; m.deployT[side] = DEPLOY_T; }
    const k = m.readyK[side], to = m.ready[side] ? 1 : 0;
    m.readyK[side] = k + Math.sign(to - k) * Math.min(Math.abs(to - k), dt / DEPLOY_T);
  }
}

// 實際噴出去的方向：沒按方向就往正前方；履帶只能沿車身前後噴
export function boostDirOf(m, mx, mz) {
  const ml = Math.hypot(mx, mz);
  let d = ml > 0.2 ? { x: mx / ml, z: mz / ml } : facing(m);
  if (m.loadout.legs === 'tread') { const lf = { x: Math.sin(m.legYaw), z: Math.cos(m.legYaw) }; const s = d.x * lf.x + d.z * lf.z >= 0 ? 1 : -1; d = { x: lf.x * s, z: lf.z * s }; }
  return d;
}
export const boostKOf = m => m.spec.boost * (m.parts.legs.broken ? 0.75 : 1);
export function tryBoost(m, mx, mz) {
  if (!m.alive || m.boostCd > 0 || m.energy < BOOST_COST) return false;
  const d = boostDirOf(m, mx, mz), k = boostKOf(m);
  // 噴射只往一個方向：原本的速度只留沿著噴射方向的分量（往反方向跑的會被抵銷），橫向的全部吃掉
  const along = Math.max(0, m.vx * d.x + m.vz * d.z);
  m.vx = d.x * (along + BOOST_DV * k); m.vz = d.z * (along + BOOST_DV * k);
  m.stuckT = 0;
  m.boostDir = d; m.boostK = k; m.boostT = BOOST_TIME; m.boostCd = BOOST_TIME + BOOST_CD;
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
  if (m.energyT <= 0) m.energy = Math.min(100, m.energy + ENERGY_REGEN * S.regen * dt);
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
  const hit = collideBlocks(m, m.r, 0);
  if (hit.hit > STICK_SPEED) {
    // 不反彈，連沿著牆滑的速度也被磨掉一大半
    const vt = m.vx * -hit.nz + m.vz * hit.nx, keep = Math.max(0.15, 1 - hit.hit * 0.08);
    m.vx = -hit.nz * vt * keep; m.vz = hit.nx * vt * keep;
    stick(m, hit.hit, hit.nx, hit.nz);
  }
  if (hit.hit > CRASH_SPEED) crash(m, hit.hit - CRASH_SPEED, hit.nx, hit.nz);
  const wh = collideWrecks(m);
  if (wh.hit > STICK_SPEED) stick(m, wh.hit, wh.nx, wh.nz);

  m.torsoYaw = approachAngle(m.torsoYaw, aimYaw, S.turn * (m.parts.head.broken ? 0.7 : 1) * dt);
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
export function hitMech(m, dmg, dx, dz, kb = 0, type = 'kinetic', forced = null) {
  if (!m.alive) return null;
  const fromX = -dx, fromZ = -dz, f = facing(m);
  const a = Math.abs(angleDiff(m.torsoYaw, Math.atan2(fromX, fromZ)));
  const right = fromX * -f.z + fromZ * f.x > 0;
  const dir = a < 0.7 ? 'front' : a < 2.27 ? 'side' : 'rear';
  const part = forced ?? pickPart(m, dir, right);
  const mul = part === 'torso' && !forced ? TORSO_MUL[dir] : 1;
  const eff = EFFECT[type][m.parts[part].armor] ?? 1;
  m.vx += dx * kb; m.vz += dz * kb;
  damagePart(m, part, dmg * mul * eff, dx, dz);
  return { part, eff };
}

export function damagePart(m, name, dmg, dx = 0, dz = 0) {
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

function destroyMech(m, dx, dz) {
  m.alive = false;
  // 主力機體：慢動作特寫 + 留下燒著的殘骸（src/wreck.js）
  if (m.ace) { startWreck(m, dx, dz); m.onDeath?.(m); return; }
  for (const k in m.parts) if (m.parts[k].g.visible) voxelBurst(m.parts[k].g, 40, 7, m.x, m.z, dx * 3, dz * 3);
  burst(m.x, 1, m.z, [0x2a2a2e, 0x1a1a1e, m.colors.accent], 14, 7);
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
  if (!isWreck(m)) scene.remove(m.model.root);   // 殘骸的模型歸 wreck.js 管
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
    if (rel > STICK_SPEED) { stick(a, rel * ka * 2, -nx, -nz); stick(b, rel * kb * 2, nx, nz); }
    if (rel > 5) {
      const dmg = (rel - 5) * 9;
      damagePart(a, 'torso', dmg * ka * 1.6, nx, nz);
      damagePart(b, 'torso', dmg * kb * 1.6, -nx, -nz);
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
  M.root.position.set(m.x, hover, m.z);
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
