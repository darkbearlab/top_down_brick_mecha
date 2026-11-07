import * as THREE from 'three';
import { sampleVoxels } from './voxel.js';
import { DEBRIS_GEO, FLASH_GEO, UNIT_BOX, WALL_H, addMat, debrisMat, scene } from './core.js';
import { fogMaterial, fogU } from './fog.js';

// 粒子撞牆判定由場地模組注入（pitTest：那裡是空洞 → 碎片掉下去）
let wallTest = () => false, pitTest = () => false;
export function setWallTest(fn, pit = null) { wallTest = fn; if (pit) pitTest = pit; }

// ---------- 留在地上的碎片 ----------
// 噴出去的碎片（建築被打掉的方塊、機體炸開的碎塊）落地停住之後，「壓」進一個共用的 InstancedMesh（一整批只畫一次），一直留著
// 每層一個（掛在那層的 group 底下、用那層的迷霧）；最多 RUBBLE_MAX 塊，超過就蓋掉最舊的；換關 / 換模式時清掉
const RUBBLE_MAX = 20000;
const rubblePools = new Map();
let rubble = null;
const rM = new THREE.Matrix4(), rQ = new THREE.Quaternion(), rS = new THREE.Vector3(), rC = new THREE.Color();
// 換到第 k 層的碎片（parent = 那層的 group、U = 那層的迷霧 uniforms）
export function setRubbleLayer(k, parent = scene, U = fogU) {
  if (!rubblePools.has(k)) {
    const mesh = new THREE.InstancedMesh(DEBRIS_GEO, fogMaterial(new THREE.MeshLambertMaterial({ color: 0xffffff }), U), RUBBLE_MAX);
    mesh.count = 0; mesh.frustumCulled = false; mesh.receiveShadow = true;
    mesh.setColorAt(0, rC.set(0xffffff));
    parent.add(mesh);
    rubblePools.set(k, { mesh, next: 0 });
  }
  rubble = rubblePools.get(k);
  // 還在飛的碎片是上一層的：直接收掉
  for (const d of debris) scene.remove(d.m);
  debris.length = 0;
}
export function clearRubble() {
  for (const P of rubblePools.values()) { P.mesh.parent?.remove(P.mesh); P.mesh.dispose(); P.mesh.material.dispose(); }
  rubblePools.clear(); rubble = null;
  for (const d of debris) scene.remove(d.m);
  debris.length = 0;
}
function bake(d) {
  if (!rubble) setRubbleLayer(0);
  const R = rubble, i = R.next;
  rQ.setFromEuler(d.m.rotation);
  rM.compose(d.m.position, rQ, rS.setScalar(d.s));
  R.mesh.setMatrixAt(i, rM);
  R.mesh.setColorAt(i, rC.copy(d.m.material.color));
  R.next = (i + 1) % RUBBLE_MAX;
  R.mesh.count = Math.max(R.mesh.count, i + 1);
  R.mesh.instanceMatrix.needsUpdate = true; R.mesh.instanceColor.needsUpdate = true;
}

// ---------- 雷射（瞄準線） ----------
export function makeLaser(color) {
  const g = new THREE.Group();
  const core = new THREE.Mesh(UNIT_BOX, addMat(0xffffff));
  const glow = new THREE.Mesh(UNIT_BOX, addMat(color));
  const dot = new THREE.Mesh(FLASH_GEO, glow.material);
  dot.scale.setScalar(0.35);
  g.add(core, glow, dot);
  g.visible = false;
  scene.add(g);
  return { g, core, glow, dot };
}
export function setLaser(L, ox, oz, dx, dz, len, y, alpha, w) {
  L.g.visible = true;
  L.g.position.set(ox + dx * len / 2, y, oz + dz * len / 2);
  L.g.rotation.set(0, Math.atan2(dx, dz), 0);
  L.core.scale.set(w * 0.35, w * 0.35, len);
  L.glow.scale.set(w, w, len);
  L.dot.position.set(0, 0, len / 2);
  L.core.material.opacity = alpha;
  L.glow.material.opacity = alpha * 0.6;
}

// ---------- 粒子 ----------
export const debris = [], fx = [];
export function burst(x, y, z, colors, n, power, bx = 0, bz = 0) {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(DEBRIS_GEO, debrisMat(colors[i % colors.length]));
    const s = 0.7 + Math.random() * 1.3;
    m.scale.setScalar(s);
    m.position.set(x + (Math.random() - 0.5) * 0.4, y + (Math.random() - 0.5) * 0.6, z + (Math.random() - 0.5) * 0.4);
    m.castShadow = true;
    scene.add(m);
    const a = Math.random() * Math.PI * 2, p = power * (0.4 + Math.random() * 0.8);
    debris.push({ m, s, life: 1.6 + Math.random() * 1.2,
      vx: Math.cos(a) * p + bx, vy: 3 + Math.random() * power, vz: Math.sin(a) * p + bz,
      sx: (Math.random() - 0.5) * 20, sz: (Math.random() - 0.5) * 20 });
  }
}
// 零件炸開：直接拿零件身上的方塊往外噴（cx, cz = 爆炸中心）
// opts.char：顏色往焦黑壓多少（0..1）；opts.burn：每塊有多少機率是著火的（飛的時候一路冒火）
const CHAR_C = new THREE.Color(0x16120f), charC = new THREE.Color();
function charred(c, k) {
  charC.set(c).lerp(CHAR_C, k);
  // 量化一下，材質快取不要爆
  const q = v => Math.round(v * 24) / 24;
  return charC.setRGB(q(charC.r), q(charC.g), q(charC.b)).getHex();
}
export function voxelBurst(root, n, power, cx, cz, bx = 0, bz = 0, opts = null) {
  for (const v of sampleVoxels(root, n)) {
    const burning = opts?.burn && Math.random() < opts.burn;
    const c = opts?.char ? charred(v.c, Math.min(1, opts.char * (0.75 + Math.random() * 0.5) + (burning ? 0.15 : 0))) : v.c;
    const m = new THREE.Mesh(DEBRIS_GEO, debrisMat(c));
    const s = 0.6 + Math.random() * 0.6;
    m.scale.setScalar(s);
    m.position.set(v.x, v.y, v.z);
    m.castShadow = true;
    scene.add(m);
    let ox = v.x - cx, oz = v.z - cz;
    const ol = Math.hypot(ox, oz) || 1;
    ox /= ol; oz /= ol;
    const p = power * (0.4 + Math.random() * 0.8);
    debris.push({ m, s, life: 2 + Math.random() * 1.5 + (burning ? 0.8 : 0),
      vx: ox * p + (Math.random() - 0.5) * 2 + bx, vy: 2 + Math.random() * power * 0.9, vz: oz * p + (Math.random() - 0.5) * 2 + bz,
      sx: (Math.random() - 0.5) * 20, sz: (Math.random() - 0.5) * 20, burn: burning ? 1 : 0, burnAcc: 0 });
  }
}
// ---------- 方塊粒子（全部用方塊：火花、火焰、爆炸、煙） ----------
// 兩個共用的 InstancedMesh：
//   glow：加法混色的發光方塊（火花、火焰、閃光），顏色照「色帶」隨時間變，最後變黑 = 淡出
//   puff：半透明的煙 / 塵方塊，顏色從 c0 漸變到 c1，先變大再縮小
const MAX_GLOW = 5000, MAX_PUFF = 2000;
const glowMesh = new THREE.InstancedMesh(UNIT_BOX, new THREE.MeshBasicMaterial({
  color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), MAX_GLOW);
const puffMesh = new THREE.InstancedMesh(UNIT_BOX, new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.72, depthWrite: false }), MAX_PUFF);
for (const m of [glowMesh, puffMesh]) {
  m.frustumCulled = false; m.count = 0;
  m.setColorAt(0, new THREE.Color());
  scene.add(m);
}
puffMesh.renderOrder = 1; glowMesh.renderOrder = 2;
const glows = [], puffs = [];

// 色帶：平均分布的顏色，取樣時線性內插
const ramp = hexes => hexes.map(h => new THREE.Color(h));
export const RAMP = {
  spark: ramp([0xffffff, 0xfff0a0, 0xffb030, 0xff5010, 0x000000]),
  armor: ramp([0xffffff, 0xd8e8ff, 0x80a8ff, 0x203060, 0x000000]),
  fire: ramp([0xfff6d0, 0xffd040, 0xff8a20, 0xd83010, 0x501008, 0x000000]),
  ember: ramp([0xffe080, 0xff7020, 0xa02008, 0x000000]),
  flash: ramp([0xffffff, 0xfff0b0, 0xff9030, 0x000000]),
};
const rampCache = new Map();
export function rampOf(hex) {
  if (!rampCache.has(hex)) {
    const c = new THREE.Color(hex);
    rampCache.set(hex, [new THREE.Color(0xffffff), c, c.clone().multiplyScalar(0.45), new THREE.Color(0)]);
  }
  return rampCache.get(hex);
}
function sampleRamp(r, t, out) {
  const f = Math.min(0.9999, Math.max(0, t)) * (r.length - 1), i = Math.floor(f);
  return out.copy(r[i]).lerp(r[i + 1], f - i);
}
const R = (a, b) => a + Math.random() * (b - a);

// o: x,y,z, vx,vy,vz, life, s0（開始大小）, s1（結束大小）, ramp, g（重力）, drag, bounce, puff（先變大再縮小）, delay
export function spawnGlow(o) {
  if (glows.length >= MAX_GLOW) return;
  glows.push({ vx: 0, vy: 0, vz: 0, g: 0, drag: 0, s1: 0, delay: 0, ...o, max: o.life, rx: Math.random() * 3, ry: Math.random() * 3, vr: o.vr ?? R(-8, 8) });
}
// o: x,y,z, vx,vy,vz, life, s（最大）, c0, c1, drag, delay, g
export function spawnPuff(o) {
  if (puffs.length >= MAX_PUFF) return;
  puffs.push({ vx: 0, vy: 0, vz: 0, g: 0, drag: 0.8, delay: 0, ...o, max: o.life,
    col0: new THREE.Color(o.c0 ?? 0x2a2b30), col1: new THREE.Color(o.c1 ?? 0x6a6c72), rx: Math.random() * 3, ry: Math.random() * 3, vr: R(-1.5, 1.5) });
}

// ---------- 效果 ----------
// 一般火花：有重力、會在地上彈
export function sparks(x, y, z, color, n, nx = 0, nz = 0, speed = 1) {
  const rp = rampOf(color);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, p = R(3, 8) * speed;
    spawnGlow({ x, y, z, vx: Math.cos(a) * p + nx * 5, vy: R(1, 5), vz: Math.sin(a) * p + nz * 5,
      life: R(0.2, 0.45), s0: R(0.06, 0.1), s1: 0.02, ramp: rp, g: 20, drag: 1.5, bounce: true });
  }
}
// 被擊中：一下閃光 + 一束往回彈的火花（nx, nz = 往子彈來的方向）；power 越大越多、越遠；armor = 被裝甲彈開（藍白色）
export function hitSparks(x, y, z, nx, nz, power = 1, armor = false) {
  const rp = armor ? RAMP.armor : RAMP.spark;
  spawnGlow({ x, y, z, life: 0.07, s0: 0.3 + 0.15 * power, s1: 0.1, ramp: RAMP.flash, vr: 0 });
  const n = Math.round(7 + 6 * power);
  for (let i = 0; i < n; i++) {
    const sp = R(4, 10) * (0.8 + power * 0.3), a = Math.atan2(nx, nz) + R(-1.1, 1.1);
    spawnGlow({ x, y, z, vx: Math.sin(a) * sp, vy: R(0.5, 4.5) * (0.7 + power * 0.3), vz: Math.cos(a) * sp,
      life: R(0.2, 0.5), s0: R(0.06, 0.11), s1: 0.02, ramp: rp, g: 22, drag: 1.8, bounce: true });
  }
  if (power > 0.8) for (let i = 0; i < 2; i++) spawnPuff({ x, y, z, vx: nx * 0.8, vy: R(0.6, 1.2), vz: nz * 0.8, life: R(0.5, 0.8), s: R(0.18, 0.28), c0: 0x4a4c52, c1: 0x7a7c82 });
}
// 火：一顆往上竄的火焰方塊（越往上越小，白黃→橘→紅→暗），偶爾飛出火星、冒一團黑煙；k = 大小
export function fire(x, y, z, k = 1) {
  spawnGlow({ x: x + R(-0.15, 0.15) * k, y, z: z + R(-0.15, 0.15) * k, vx: R(-0.4, 0.4), vy: R(1.4, 2.6) * (0.6 + 0.4 * k), vz: R(-0.4, 0.4),
    life: R(0.35, 0.6), s0: R(0.16, 0.3) * k, s1: 0, ramp: RAMP.fire, drag: 1 });
  if (Math.random() < 0.15) spawnGlow({ x, y, z, vx: R(-1.5, 1.5), vy: R(2.5, 5), vz: R(-1.5, 1.5), life: R(0.6, 1.1), s0: 0.06, s1: 0.02, ramp: RAMP.ember, g: 4, drag: 0.6 });
  if (Math.random() < 0.25) spawnPuff({ x, y: y + 0.5 * k, z, vx: R(-0.3, 0.3), vy: R(0.9, 1.5), vz: R(-0.3, 0.3), life: R(1.2, 1.9), s: R(0.25, 0.4) * k, c0: 0x18181c, c1: 0x4a4c54 });
}
// 煙
export function smoke(x, y, z, n = 1, size = 1, color) {
  for (let i = 0; i < n; i++) spawnPuff({ x: x + R(-0.2, 0.2), y, z: z + R(-0.2, 0.2), vx: R(-0.4, 0.4), vy: R(1, 1.8), vz: R(-0.4, 0.4),
    life: R(0.9, 1.5), s: R(0.2, 0.32) * size, c0: color ?? 0x3a3c42, c1: color ?? 0x6a6c72 });
}
// 爆炸：閃光 → 往外炸開的火球方塊（很快被空氣擋下來、慢慢上浮）→ 地面一圈塵 → 火星 → 晚一點冒出的黑煙柱
export function explosion(x, y, z, scale = 1) {
  spawnGlow({ x, y, z, life: 0.12, s0: 1.4 * scale, s1: 2.2 * scale, ramp: RAMP.flash, vr: 0 });
  const n = Math.round(46 * scale);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, el = R(-0.2, 1), sp = R(2.5, 8) * scale;
    spawnGlow({ x: x + R(-0.2, 0.2), y: y + R(-0.2, 0.2), z: z + R(-0.2, 0.2),
      vx: Math.cos(a) * Math.cos(el) * sp, vy: Math.sin(el) * sp * 0.8 + 1, vz: Math.sin(a) * Math.cos(el) * sp,
      life: R(0.45, 0.95), s0: 0, s1: R(0.3, 0.65) * scale, puff: true, ramp: RAMP.fire, drag: 4.5, g: -1.5 });
  }
  const ring = Math.round(14 + 12 * scale);
  for (let i = 0; i < ring; i++) {
    const a = i / ring * Math.PI * 2 + R(-0.1, 0.1), sp = R(7, 11) * Math.sqrt(scale);
    spawnPuff({ x, y: 0.15, z, vx: Math.cos(a) * sp, vy: R(0, 0.4), vz: Math.sin(a) * sp, life: R(0.55, 0.85), s: R(0.25, 0.4) * Math.sqrt(scale), c0: 0x8a8478, c1: 0x5a5650, drag: 3.2 });
  }
  for (let i = 0; i < Math.round(22 * scale); i++) {
    const a = Math.random() * Math.PI * 2, sp = R(2, 6) * scale;
    spawnGlow({ x, y, z, vx: Math.cos(a) * sp, vy: R(4, 10), vz: Math.sin(a) * sp, life: R(1, 1.9), s0: R(0.06, 0.1), s1: 0.03, ramp: RAMP.ember, g: 14, drag: 0.4, bounce: true });
  }
  for (let i = 0; i < Math.round(16 * scale); i++) {
    spawnPuff({ x: x + R(-0.4, 0.4) * scale, y: y + R(0, 0.5), z: z + R(-0.4, 0.4) * scale, vx: R(-0.6, 0.6), vy: R(1.4, 2.6), vz: R(-0.6, 0.6),
      life: R(1.8, 2.9), s: R(0.45, 0.85) * scale, c0: 0x141418, c1: 0x55575e, delay: R(0.1, 0.45), drag: 0.6 });
  }
}
// 持續燃燒的點（殘骸）：火勢隨時間變小
const burners = [];
export function burnAt(x, y, z, dur = 4, k = 1) { burners.push({ x, y, z, t: 0, dur, k, acc: 0 }); }

export function muzzleFlash(x, y, z, color, size = 1) {
  spawnGlow({ x, y, z, life: 0.06, s0: 0.42 * size, s1: 0.2 * size, ramp: rampOf(color), vr: 0 });
}
// 推進器火焰
export function flame(x, y, z, dx, dz) {
  const p = R(5, 9);
  spawnGlow({ x, y, z, vx: dx * p + R(-1, 1), vy: R(-0.5, 1), vz: dz * p + R(-1, 1), life: R(0.15, 0.28), s0: R(0.14, 0.22), s1: 0,
    ramp: Math.random() < 0.5 ? RAMP.fire : rampOf(0x60c8ff), drag: 2 });
}

const dummy = new THREE.Object3D(), tmpC = new THREE.Color();
function stepList(list, dt, mesh, write) {
  let n = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    if (p.delay > 0) { p.delay -= dt; continue; }
    p.life -= dt;
    if (p.life <= 0) { list[i] = list[list.length - 1]; list.pop(); continue; }
    const d = Math.exp(-p.drag * dt);
    p.vx *= d; p.vy *= d; p.vz *= d;
    p.vy -= p.g * dt;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    p.rx += p.vr * dt; p.ry += p.vr * 0.7 * dt;
    const s = write(p, 1 - p.life / p.max);
    if (p.y < s / 2) {
      p.y = s / 2;
      if (p.bounce && p.vy < -1) { p.vy *= -0.4; p.vx *= 0.6; p.vz *= 0.6; } else { p.vy = 0; p.vx *= 0.9; p.vz *= 0.9; }
    }
    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.set(p.rx, p.ry, 0);
    dummy.scale.setScalar(Math.max(0.001, s));
    dummy.updateMatrix();
    mesh.setMatrixAt(n, dummy.matrix);
    mesh.setColorAt(n, tmpC);
    n++;
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

export function updateParticles(dt) {
  for (let i = debris.length - 1; i >= 0; i--) {
    const d = debris[i], p = d.m.position;
    d.vy -= 24 * dt;
    p.x += d.vx * dt; p.y += d.vy * dt; p.z += d.vz * dt;
    d.m.rotation.x += d.sx * dt; d.m.rotation.z += d.sz * dt;
    const pit = pitTest(p.x, p.z);
    if (p.y < 0.08 && !pit) { p.y = 0.08; d.vy *= -0.35; d.vx *= 0.55; d.vz *= 0.55; d.sx *= 0.5; d.sz *= 0.5; }
    if (wallTest(p.x, p.z) && p.y < WALL_H) { d.vx *= -0.4; d.vz *= -0.4; p.x += d.vx * dt * 2; p.z += d.vz * dt * 2; }
    d.life -= dt;
    // 掉進空洞：一路掉下去，看不到了就收掉
    if (pit && p.y < -8) { scene.remove(d.m); debris.splice(i, 1); continue; }
    // 落地停住（或時間到、已經在地上）：壓進留在地上的碎片
    const rest = p.y <= 0.09 && !pit && Math.abs(d.vy) < 0.8 && Math.hypot(d.vx, d.vz) < 0.25;
    if (!pit && p.y <= 0.09 && (rest && !(d.burn && d.life > 0.3) || d.life <= 0)) { p.y = 0.08 * d.s; bake(d); scene.remove(d.m); debris.splice(i, 1); continue; }
    if (d.life <= 0 && !pit) { d.life = 0.1; continue; }   // 還在空中：等落地
    // 著火的碎塊：一路冒火、拖黑煙，火慢慢變小
    if (d.burn && d.life > 0.3) {
      d.burnAcc += dt * 28;
      while (d.burnAcc >= 1) {
        d.burnAcc--;
        spawnGlow({ x: p.x + R(-0.06, 0.06), y: p.y + 0.05, z: p.z + R(-0.06, 0.06), vx: R(-0.3, 0.3), vy: R(1, 2.2), vz: R(-0.3, 0.3),
          life: R(0.25, 0.45), s0: R(0.12, 0.22) * Math.min(1, d.life / 1.5 + 0.3), s1: 0, ramp: RAMP.fire, drag: 1 });
      }
      if (Math.random() < dt * 6) spawnPuff({ x: p.x, y: p.y + 0.15, z: p.z, vx: 0, vy: R(0.6, 1.1), vz: 0, life: R(0.8, 1.3), s: R(0.12, 0.2), c0: 0x16161a, c1: 0x3a3c42, drag: 0.6 });
    }
    if (d.life <= 0) { scene.remove(d.m); debris.splice(i, 1); }
  }
  for (let i = burners.length - 1; i >= 0; i--) {
    const b = burners[i];
    b.t += dt;
    if (b.t >= b.dur) { burners.splice(i, 1); continue; }
    const k = b.k * (1 - b.t / b.dur);
    b.acc += dt * 40 * k;
    while (b.acc >= 1) { b.acc--; fire(b.x + R(-0.5, 0.5), b.y, b.z + R(-0.5, 0.5), 0.5 + k * 0.6); }
  }
  stepList(glows, dt, glowMesh, (p, t) => {
    sampleRamp(p.ramp, t, tmpC);
    return p.puff ? p.s1 * Math.sin(Math.PI * Math.min(1, Math.pow(t, 0.55))) + 0.02 : p.s0 + (p.s1 - p.s0) * t;
  });
  stepList(puffs, dt, puffMesh, (p, t) => {
    tmpC.copy(p.col0).lerp(p.col1, t);
    return p.s * (t < 0.25 ? 0.4 + 2.4 * t : 1 - Math.max(0, (t - 0.6) / 0.4) * 0.9);
  });
}
