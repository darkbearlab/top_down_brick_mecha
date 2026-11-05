// ---------- 機體 ----------
// 下半身（腿）朝移動方向、上半身（軀幹 + 頭 + 雙臂）朝瞄準方向，兩者各自有轉速
// 移動有慣性：腿只能用「抓地力」推地面加減速，抓地力 = 地面摩擦 × 腿的力量；冰上又滑又難停
// 推進衝刺：直接給一段速度，不受抓地力限制，之後靠摩擦慢慢收回來
// 部位：頭、軀幹、左臂、右臂、腿，各自有血量；打掉手臂那把武器就沒了、打壞腿跑不動、頭沒了瞄準線消失、軀幹沒了就爆炸
import * as THREE from 'three';
import { VoxelSet, buildVoxelMesh } from './voxel.js';
import { G, addTrauma, angleDiff, approachAngle, scene } from './core.js';
import { collideBlocks, surfaceAt } from './arena.js';
import { burnAt, burst, explosion, fire, flame, hitSparks, smoke, sparks, voxelBurst } from './fx.js';
import { sfx } from './audio.js';

export const V = 1 / 16;
export const HIP_Y = 1.0;
export const PART_NAMES = { head: '頭部', torso: '軀幹', armL: '左臂', armR: '右臂', legs: '腿部' };
const PART_HP = { head: 60, torso: 240, armL: 90, armR: 110, legs: 170 };

// 移動參數
export const VMAX = 6.5, ACC = 11, GRIP = 30, AIR_DRAG = 0.1;
export const BOOST_COST = 30, BOOST_DV = 9, BOOST_TIME = 0.22, BOOST_PUSH = 18, BOOST_CD = 0.35, ENERGY_REGEN = 28, ENERGY_DELAY = 0.6;
export const CRASH_SPEED = 6;   // 撞牆法向速度超過這個會受傷

export const PLAYER_COLORS = { main: 0xd8dde4, dark: 0x3a4250, accent: 0x2aa8c8, glow: 0x7ff0ff };
export const ENEMY_COLORS = { main: 0xc8742a, dark: 0x3b2e24, accent: 0x7a8a3a, glow: 0xff5040 };

function partMesh(set, parent) {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x000000 });
  const mesh = buildVoxelMesh(set, mat);
  const g = new THREE.Group();
  g.add(mesh);
  parent.add(g);
  return { g, mat };
}

function buildModel(C) {
  const root = new THREE.Group();
  // 腿：骨盆 + 兩條腿，各自的關節在髖部
  const legsG = new THREE.Group();
  root.add(legsG);
  const pel = new VoxelSet().box(-6, -2, -3, 12, 3, 6, C.dark);
  const legsPart = partMesh(pel, legsG);
  legsPart.g.position.y = HIP_Y;
  const legs = [-1, 1].map(s => {
    const set = new VoxelSet()
      .box(-2, -8, -3, 4, 8, 5, C.main)       // 大腿
      .box(-2, -9, -2, 4, 1, 4, C.dark)       // 膝
      .box(-3, -14, -2, 5, 5, 5, C.main)      // 小腿
      .box(-3, -16, -3, 6, 2, 9, C.dark);     // 腳掌
    const mesh = buildVoxelMesh(set, legsPart.mat);
    const g = new THREE.Group();
    g.add(mesh);
    g.position.set(s * 0.32, HIP_Y, 0);
    legsG.add(g);
    return g;
  });
  // 上半身
  const torsoG = new THREE.Group();
  torsoG.position.y = HIP_Y;
  torsoG.rotation.order = 'YXZ';
  root.add(torsoG);
  const torso = partMesh(new VoxelSet()
    .box(-7, 1, -5, 14, 10, 11, C.main)
    .box(-5, 3, 6, 10, 6, 1, C.accent)        // 胸甲
    .box(-3, 8, 6, 6, 1, 1, C.glow)           // 駕駛艙燈
    .box(-6, 3, -8, 4, 7, 3, C.dark)          // 背後推進器
    .box(2, 3, -8, 4, 7, 3, C.dark), torsoG);
  const head = partMesh(new VoxelSet()
    .box(-3, 11, -2, 6, 4, 6, C.main)
    .box(-2, 12, 4, 4, 1, 1, C.glow)          // 眼睛
    .box(2, 15, -1, 1, 3, 1, C.dark), torsoG); // 天線
  // 左臂（機體自己的左邊 = 本地 +x）：機砲
  const armL = partMesh(new VoxelSet()
    .box(-2, 5, -3, 5, 6, 7, C.dark)
    .box(-2, 4, 2, 4, 4, 6, C.main)
    .box(-1, 5, 8, 2, 2, 8, C.dark), torsoG);
  armL.g.position.x = 9.5 * V;
  // 右臂（本地 -x）：加農砲
  const armR = partMesh(new VoxelSet()
    .box(-3, 5, -3, 6, 7, 7, C.dark)
    .box(-3, 4, 2, 6, 5, 7, C.main)
    .box(-2, 5, 9, 4, 3, 9, C.dark)
    .box(-2, 4, 17, 4, 5, 1, C.accent), torsoG);
  armR.g.position.x = -10.5 * V;
  root.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return { root, legsG, legs, torsoG, parts: { legs: legsPart, torso, head, armL, armR } };
}

// 槍口在上半身本地座標的位置
const MUZZLE = { L: [9.5 * V, HIP_Y + 6 * V, 16 * V], R: [-10.5 * V, HIP_Y + 6.5 * V, 18 * V] };

export const mechs = [];
export function makeMech({ team, colors, x = 0, z = 0, yaw = Math.PI, hpMul = 1 }) {
  const M = buildModel(colors);
  M.root.position.set(x, 0, z);
  scene.add(M.root);
  const parts = {};
  for (const k in M.parts) parts[k] = { ...M.parts[k], hp: PART_HP[k] * hpMul, max: PART_HP[k] * hpMul, broken: false, flash: 0, smokeT: Math.random() };
  const m = {
    team, colors, model: M, parts, x, z, vx: 0, vz: 0, r: 0.85, mass: 1,
    legYaw: yaw, torsoYaw: yaw, walk: 0, stepSide: 0, lean: { x: 0, z: 0 }, lastV: { x: 0, z: 0 },
    energy: 100, energyT: 0, boostT: 0, boostCd: 0, boostDir: { x: 0, z: 0 },
    alive: true, surf: null, guns: null, onDeath: null,
  };
  mechs.push(m);
  return m;
}

export const legK = m => m.parts.legs.broken ? 0.35 : 0.65 + 0.35 * m.parts.legs.hp / m.parts.legs.max;
export const facing = m => ({ x: Math.sin(m.torsoYaw), z: Math.cos(m.torsoYaw) });
const tmpV = new THREE.Vector3();
export function muzzleOf(m, side) {
  const [lx, y, lz] = MUZZLE[side], s = Math.sin(m.torsoYaw), c = Math.cos(m.torsoYaw);
  return { x: m.x + lx * c + lz * s, y, z: m.z - lx * s + lz * c };
}

// 推進衝刺：往移動方向（沒在動就往上半身面向）
export function tryBoost(m, mx, mz) {
  if (!m.alive || m.boostCd > 0 || m.energy < BOOST_COST) return false;
  const ml = Math.hypot(mx, mz);
  const f = facing(m);
  const d = ml > 0.2 ? { x: mx / ml, z: mz / ml } : f;
  const k = m.parts.legs.broken ? 0.75 : 1;   // 腿壞了還是能噴，只是弱一點
  m.vx += d.x * BOOST_DV * k; m.vz += d.z * BOOST_DV * k;
  m.boostDir = d; m.boostT = BOOST_TIME; m.boostCd = BOOST_TIME + BOOST_CD;
  m.energy -= BOOST_COST; m.energyT = ENERGY_DELAY;
  sfx.boost();
  if (m.team === 'player') addTrauma(0.12);
  return true;
}

// 一幀的移動：mx, mz = 想移動的方向（長度 0~1）；aimYaw = 上半身想轉到的角度
export function driveMech(m, dt, mx, mz, aimYaw) {
  if (!m.alive) return;
  const s = m.surf = surfaceAt(m.x, m.z);
  const lk = legK(m);
  const vmax = VMAX * lk * (s.speed ?? 1);
  m.boostCd -= dt;
  m.energyT -= dt;
  if (m.energyT <= 0) m.energy = Math.min(100, m.energy + ENERGY_REGEN * dt);

  if (m.boostT > 0) {
    // 衝刺中：推進器持續推，不受抓地力影響
    m.boostT -= dt;
    m.vx += m.boostDir.x * BOOST_PUSH * dt; m.vz += m.boostDir.z * BOOST_PUSH * dt;
    const b = facing(m), back = { x: -m.boostDir.x, z: -m.boostDir.z };
    for (let i = 0; i < 2; i++) flame(m.x - b.x * 0.35 + (Math.random() - 0.5) * 0.4, HIP_Y + 0.45, m.z - b.z * 0.35 + (Math.random() - 0.5) * 0.4, back.x, back.z);
  } else {
    // 腿推地面：速度往目標速度靠，每秒最多改變 min(腿力, 地面摩擦 × 抓地力)
    const acc = Math.min(ACC * lk, s.mu * GRIP);
    const dvx = mx * vmax - m.vx, dvz = mz * vmax - m.vz, dl = Math.hypot(dvx, dvz), cap = acc * dt;
    const k = dl > cap ? cap / dl : 1;
    m.vx += dvx * k; m.vz += dvz * k;
  }
  const drag = Math.exp(-(AIR_DRAG + s.drag) * dt);
  m.vx *= drag; m.vz *= drag;

  m.x += m.vx * dt; m.z += m.vz * dt;
  const hit = collideBlocks(m, m.r, 0.3);
  if (hit.hit > CRASH_SPEED) crash(m, hit.hit - CRASH_SPEED, hit.nx, hit.nz);

  // 腿朝移動輸入的方向；沒輸入（在滑）就不轉、不踏步 → 看得出來是在滑
  const ml = Math.hypot(mx, mz);
  if (ml > 0.1) m.legYaw = approachAngle(m.legYaw, Math.atan2(mx, mz), 8 * lk * dt);
  const turn = m.parts.head.broken ? 3.4 : 5;
  m.torsoYaw = approachAngle(m.torsoYaw, aimYaw, turn * dt);
  const prevPhase = m.walk;
  m.walk += dt * ml * 9 * lk;
  if (m.team === 'player' && Math.floor(prevPhase / Math.PI) !== Math.floor(m.walk / Math.PI)) sfx.step();

  // 慣性的傾斜：加速往後仰、煞車往前傾（上半身本地座標）
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
//   正面 ±40°：軀幹（正面裝甲，傷害 ×0.7），兩成打到頭
//   側面：那一側的手臂（手臂沒了就打軀幹）
//   背面：軀幹弱點（傷害 ×1.5）
//   另外一成五機率打到腿（低的子彈）
export function hitMech(m, dmg, dx, dz, kb = 0) {
  if (!m.alive) return null;
  const fromX = -dx, fromZ = -dz;
  const a = Math.abs(angleDiff(m.torsoYaw, Math.atan2(fromX, fromZ)));
  let part, mul = 1;
  if (!m.parts.legs.broken && Math.random() < 0.15) part = 'legs';
  else if (a < 0.7) { part = !m.parts.head.broken && Math.random() < 0.2 ? 'head' : 'torso'; if (part === 'torso') mul = 0.7; }
  else if (a < 2.27) {
    // 機體的右邊 = (-fz, fx)
    const f = facing(m), right = fromX * -f.z + fromZ * f.x > 0;
    part = right ? 'armR' : 'armL';
    if (m.parts[part].broken) part = 'torso';
  } else { part = 'torso'; mul = 1.5; }
  m.vx += dx * kb; m.vz += dz * kb;
  damagePart(m, part, dmg * mul, dx, dz);
  return { part, mul };
}

export function damagePart(m, name, dmg, dx = 0, dz = 0) {
  const p = m.parts[name];
  if (!m.alive) return;
  p.flash = 0.07;
  if (p.broken) { if (name !== 'torso') return; }
  p.hp -= dmg;
  if (p.hp > 0) return;
  p.hp = 0;
  if (name === 'torso') { destroyMech(m, dx, dz); return; }
  if (p.broken) return;
  p.broken = true;
  breakPart(m, name, dx, dz);
}

function breakPart(m, name, dx, dz) {
  const p = m.parts[name];
  voxelBurst(p.g, name === 'legs' ? 30 : 45, 5, m.x, m.z, dx * 3, dz * 3);
  tmpV.set(0, 0, 0); p.g.getWorldPosition(tmpV);
  explosion(tmpV.x, partY(name, tmpV.y), tmpV.z, 0.45);
  sfx.partBreak();
  G.hitStop = Math.max(G.hitStop, 0.05);
  addTrauma(m.team === 'player' ? 0.45 : 0.25);
  if (name === 'legs') {
    // 腿壞了不拆掉，燒黑、拖著走
    p.mat.color.setHex(0x5a5048);
    for (const l of m.model.legs) l.children[0].material = p.mat;
  } else p.g.visible = false;
}

function destroyMech(m, dx, dz) {
  m.alive = false;
  for (const k in m.parts) if (m.parts[k].g.visible) voxelBurst(m.parts[k].g, 40, 7, m.x, m.z, dx * 3, dz * 3);
  for (const l of m.model.legs) voxelBurst(l, 20, 5, m.x, m.z);
  burst(m.x, 1, m.z, [0x2a2a2e, 0x1a1a1e, m.colors.main], 14, 7);
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

// 機體互撞：依質量分開、法向速度互相交換（有點彈性）；相對速度夠快兩台都受傷 = 衝撞攻擊
export function collideMechs() {
  for (let i = 0; i < mechs.length; i++) for (let j = i + 1; j < mechs.length; j++) {
    const a = mechs[i], b = mechs[j];
    if (!a.alive || !b.alive || a.drop || b.drop) continue;
    const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz), min = a.r + b.r;
    if (d >= min || d < 1e-4) continue;
    const nx = dx / d, nz = dz / d, ov = min - d;
    a.x -= nx * ov / 2; a.z -= nz * ov / 2; b.x += nx * ov / 2; b.z += nz * ov / 2;
    const rel = (a.vx - b.vx) * nx + (a.vz - b.vz) * nz;   // > 0 = 互相靠近
    if (rel <= 0) continue;
    const e = 0.35, imp = (1 + e) * rel / 2;
    a.vx -= imp * nx; a.vz -= imp * nz; b.vx += imp * nx; b.vz += imp * nz;
    if (rel > 5) {
      const dmg = (rel - 5) * 9;
      // 跑比較快的那台是撞人的：正面撞，自己少受一點
      const aFast = Math.hypot(a.vx, a.vz) >= Math.hypot(b.vx, b.vz);
      damagePart(a, 'torso', dmg * (aFast ? 0.4 : 1), nx, nz);
      damagePart(b, 'torso', dmg * (aFast ? 1 : 0.4), -nx, -nz);
      hitSparks((a.x + b.x) / 2, 1.1, (a.z + b.z) / 2, -nx, -nz, 2);
      hitSparks((a.x + b.x) / 2, 1.1, (a.z + b.z) / 2, nx, nz, 2);
      sfx.crash();
      addTrauma(0.4);
      G.hitStop = Math.max(G.hitStop, 0.06);
    }
  }
}

// 畫面：位置、轉向、踏步、傾斜、受傷閃白、冒煙
export function poseMech(m, dt) {
  if (!m.alive || m.drop) return;
  const M = m.model;
  M.root.position.set(m.x, 0, m.z);
  M.legsG.rotation.y = m.legYaw;
  const sw = Math.sin(m.walk) * 0.45;
  M.legs[0].rotation.x = sw; M.legs[1].rotation.x = -sw;
  const limp = m.parts.legs.broken ? 0.06 : 0;
  M.torsoG.position.y = HIP_Y + Math.abs(Math.sin(m.walk)) * 0.05 - limp;
  M.torsoG.rotation.set(m.lean.x, m.torsoYaw, m.lean.z + (limp ? Math.sin(m.walk) * 0.05 : 0));
  for (const k in m.parts) {
    const p = m.parts[k];
    if (p.flash > 0) { p.flash -= dt; p.mat.emissive.setHex(p.flash > 0 ? 0x808080 : 0x000000); }
    // 半血以下冒煙；1/4 以下開始冒小火；壞掉的斷口一直燒、偶爾噴火花
    const k01 = p.hp / p.max;
    if (!p.broken && k01 >= 0.5) continue;
    p.g.getWorldPosition(tmpV);
    const y = partY(k, tmpV.y);
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
// 各部位冒火 / 爆炸的高度（零件群組原點在髖部高度）
function partY(name, y) {
  return name === 'legs' ? 0.55 : name === 'head' ? y + 0.8 : name === 'torso' ? y + 0.5 : y + 0.45;
}
