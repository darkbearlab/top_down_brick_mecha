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
import { burnAt, burst, explosion, fire, flame, hitSparks, smoke, sparks, voxelBurst } from './fx.js';
import { sfx } from './audio.js';
import { EFFECT, WEAPONS, computeSpec } from './parts.js';
import { buildMechModel } from './model.js';

export const PART_NAMES = { head: '頭部', torso: '軀幹', armL: '左臂', armR: '右臂', backL: '左背', backR: '右背', legs: '腳部' };
const ARMOR_OF = { head: 'head', torso: 'torso', armL: 'arms', armR: 'arms', backL: 'torso', backR: 'torso', legs: 'legs' };

export const GRIP = 30, AIR_DRAG = 0.1;
export const BOOST_COST = 30, BOOST_DV = 9, BOOST_TIME = 0.22, BOOST_PUSH = 18, BOOST_CD = 0.35, ENERGY_REGEN = 28, ENERGY_DELAY = 0.6;
export const CRASH_SPEED = 6;

export const PLAYER_COLORS = { accent: 0x2aa8c8, glow: 0x7ff0ff };
export const ENEMY_COLORS = { accent: 0xe07a2a, glow: 0xff5040 };

export const mechs = [];
export function makeMech({ team, colors, loadout, x = 0, z = 0, yaw = Math.PI, hpMul = 1 }) {
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
    energy: 100, energyT: 0, boostT: 0, boostCd: 0, boostDir: { x: 0, z: 0 },
    alive: true, surf: null, guns: null, onDeath: null, swing: null,
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
export const muzzleOf = (m, slot) => toWorld(m, m.model.muzzles[slot] ?? [0, 0.5, 0.8]);
export const slotBroken = (m, slot) => !m.parts[slot] || m.parts[slot].broken;

export function tryBoost(m, mx, mz) {
  if (!m.alive || m.boostCd > 0 || m.energy < BOOST_COST) return false;
  const ml = Math.hypot(mx, mz), f = facing(m);
  let d = ml > 0.2 ? { x: mx / ml, z: mz / ml } : f;
  if (m.loadout.legs === 'tread') { const lf = { x: Math.sin(m.legYaw), z: Math.cos(m.legYaw) }; const s = d.x * lf.x + d.z * lf.z >= 0 ? 1 : -1; d = { x: lf.x * s, z: lf.z * s }; }
  const k = m.spec.boost * (m.parts.legs.broken ? 0.75 : 1);
  m.vx += d.x * BOOST_DV * k; m.vz += d.z * BOOST_DV * k;
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
    if (ml > 0.1) m.legYaw = approachAngle(m.legYaw, Math.atan2(back ? -mx : mx, back ? -mz : mz), S.legTurn * lk * dt);
    const sp = ml * vmax * (back ? -0.6 : Math.max(0, dot));
    tx = lf.x * sp; tz = lf.z * sp;
  } else if (ml > 0.1) m.legYaw = approachAngle(m.legYaw, Math.atan2(mx, mz), S.legTurn * lk * dt);

  if (m.boostT > 0) {
    m.boostT -= dt;
    m.vx += m.boostDir.x * BOOST_PUSH * m.boostK * dt; m.vz += m.boostDir.z * BOOST_PUSH * m.boostK * dt;
    const back = { x: -m.boostDir.x, z: -m.boostDir.z }, f = facing(m);
    for (let i = 0; i < 2; i++) flame(m.x - f.x * 0.4 + (Math.random() - 0.5) * 0.4, m.model.hipY + 0.5, m.z - f.z * 0.4 + (Math.random() - 0.5) * 0.4, back.x, back.z);
  } else {
    const mu = s.mu * (L.slide ?? 1) * (L.grip ?? 1);
    const acc = Math.min(S.acc * lk, mu * GRIP);
    const dvx = tx - m.vx, dvz = tz - m.vz, dl = Math.hypot(dvx, dvz), cap = acc * dt;
    const k = dl > cap ? cap / dl : 1;
    m.vx += dvx * k; m.vz += dvz * k;
  }
  const drag = Math.exp(-(AIR_DRAG + (L.noMud ? 0 : s.drag)) * dt);
  m.vx *= drag; m.vz *= drag;

  m.x += m.vx * dt; m.z += m.vz * dt;
  const hit = collideBlocks(m, m.r, 0.3);
  if (hit.hit > CRASH_SPEED) crash(m, hit.hit - CRASH_SPEED, hit.nx, hit.nz);

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

function crash(m, over, nx, nz) {
  const dmg = over * 6;
  damagePart(m, 'legs', dmg * 0.6, nx, nz);
  if (m.alive) damagePart(m, 'torso', dmg * 0.4, nx, nz);
  hitSparks(m.x - nx * m.r, 1, m.z - nz * m.r, nx, nz, 1.2 + over * 0.15);
  burst(m.x - nx * m.r, 0.8, m.z - nz * m.r, [0x7a8090, 0x4a505c], 4, 3);
  sfx.crash();
  if (m.team === 'player') addTrauma(Math.min(0.6, 0.2 + over * 0.06));
}

// ---------- 被打中 ----------
// 依子彈打來的方向決定打到哪：
//   正面 ±40°：軀幹（正面減傷 ×0.75），兩成打到頭
//   側面：那一側的手臂（手臂沒了打軀幹）
//   背面：一半打到那一側的背部武器，其他打軀幹弱點（×1.4）
//   另外一成五機率打到腳
// 再乘上 武器屬性 × 裝甲種類 的剋制倍率
// 回傳 { part, eff }：eff < 1 = 被裝甲擋下、> 1 = 剋制
export function hitMech(m, dmg, dx, dz, kb = 0, type = 'kinetic', forced = null) {
  if (!m.alive) return null;
  const fromX = -dx, fromZ = -dz, f = facing(m);
  const a = Math.abs(angleDiff(m.torsoYaw, Math.atan2(fromX, fromZ)));
  const right = fromX * -f.z + fromZ * f.x > 0;
  let part = forced, mul = 1;
  if (!part) {
    if (!m.parts.legs.broken && Math.random() < 0.15) part = 'legs';
    else if (a < 0.7) { part = !m.parts.head.broken && Math.random() < 0.2 ? 'head' : 'torso'; if (part === 'torso') mul = 0.75; }
    else if (a < 2.27) { part = right ? 'armR' : 'armL'; if (m.parts[part].broken) part = 'torso'; }
    else {
      const back = right ? 'backR' : 'backL';
      if (m.parts[back] && !m.parts[back].broken && Math.random() < 0.5) part = back;
      else { part = 'torso'; mul = 1.4; }
    }
  }
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
  scene.remove(m.model.root);
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
    const imp = 1.35 * rel;
    a.vx -= imp * ka * nx; a.vz -= imp * ka * nz; b.vx += imp * kb * nx; b.vz += imp * kb * nz;
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
// 各部位冒火 / 爆炸的高度
function partY(m, name, y) {
  return name === 'legs' ? m.model.hipY * 0.55 : name === 'head' ? y + 0.2 : name === 'torso' ? y + 0.5 : name.startsWith('back') ? y + 0.1 : y + 0.3;
}
export { WEAPONS };
