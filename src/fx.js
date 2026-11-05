import * as THREE from 'three';
import { sampleVoxels } from './voxel.js';
import { DEBRIS_GEO, FLASH_GEO, UNIT_BOX, WALL_H, addMat, debrisMat, scene } from './core.js';

// 粒子撞牆判定由場地模組注入
let wallTest = () => false;
export function setWallTest(fn) { wallTest = fn; }

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
export function voxelBurst(root, n, power, cx, cz, bx = 0, bz = 0) {
  for (const v of sampleVoxels(root, n)) {
    const m = new THREE.Mesh(DEBRIS_GEO, debrisMat(v.c));
    const s = 0.6 + Math.random() * 0.6;
    m.scale.setScalar(s);
    m.position.set(v.x, v.y, v.z);
    m.castShadow = true;
    scene.add(m);
    let ox = v.x - cx, oz = v.z - cz;
    const ol = Math.hypot(ox, oz) || 1;
    ox /= ol; oz /= ol;
    const p = power * (0.4 + Math.random() * 0.8);
    debris.push({ m, s, life: 2 + Math.random() * 1.5,
      vx: ox * p + (Math.random() - 0.5) * 2 + bx, vy: 2 + Math.random() * power * 0.9, vz: oz * p + (Math.random() - 0.5) * 2 + bz,
      sx: (Math.random() - 0.5) * 20, sz: (Math.random() - 0.5) * 20 });
  }
}
export function sparks(x, y, z, color, n, nx = 0, nz = 0, speed = 1) {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(UNIT_BOX, addMat(color));
    m.scale.setScalar(0.08);
    m.position.set(x, y, z);
    scene.add(m);
    const a = Math.random() * Math.PI * 2, p = (3 + Math.random() * 6) * speed;
    fx.push({ m, life: 0.12 + Math.random() * 0.18, max: 0.3, base: 0.08,
      vx: Math.cos(a) * p + nx * 5, vy: Math.random() * 4, vz: Math.sin(a) * p + nz * 5 });
  }
}
export function muzzleFlash(x, y, z, color, size = 1) {
  const m = new THREE.Mesh(FLASH_GEO, addMat(color));
  m.position.set(x, y, z);
  m.rotation.set(Math.random() * 3, Math.random() * 3, 0);
  scene.add(m);
  fx.push({ m, life: 0.06, max: 0.06, vx: 0, vy: 0, vz: 0, grow: size });
}
// 煙：灰色方塊往上飄、慢慢變大變淡
const SMOKE_MATS = [0x3a3c42, 0x55585f, 0x2a2b30].map(c => c);
export function smoke(x, y, z, n = 1, size = 1, color) {
  for (let i = 0; i < n; i++) {
    const mat = new THREE.MeshLambertMaterial({ color: color ?? SMOKE_MATS[Math.floor(Math.random() * 3)], transparent: true, opacity: 0.8, depthWrite: false });
    const m = new THREE.Mesh(UNIT_BOX, mat);
    m.position.set(x + (Math.random() - 0.5) * 0.3, y, z + (Math.random() - 0.5) * 0.3);
    m.rotation.set(Math.random() * 3, Math.random() * 3, 0);
    scene.add(m);
    fx.push({ m, life: 0.9 + Math.random() * 0.6, max: 1.5, smoke: size * (0.18 + Math.random() * 0.12),
      vx: (Math.random() - 0.5) * 0.6, vy: 1.2 + Math.random() * 0.8, vz: (Math.random() - 0.5) * 0.6 });
  }
}
// 推進器火焰：加法混色的小方塊往後噴
export function flame(x, y, z, dx, dz) {
  const m = new THREE.Mesh(UNIT_BOX, addMat(Math.random() < 0.5 ? 0xffb040 : 0x60c8ff));
  m.position.set(x, y, z);
  scene.add(m);
  const p = 5 + Math.random() * 4;
  fx.push({ m, life: 0.15 + Math.random() * 0.1, max: 0.25, base: 0.16,
    vx: dx * p + (Math.random() - 0.5) * 2, vy: (Math.random() - 0.3) * 1.5, vz: dz * p + (Math.random() - 0.5) * 2 });
}

export function updateParticles(dt) {
  for (let i = debris.length - 1; i >= 0; i--) {
    const d = debris[i], p = d.m.position;
    d.vy -= 24 * dt;
    p.x += d.vx * dt; p.y += d.vy * dt; p.z += d.vz * dt;
    d.m.rotation.x += d.sx * dt; d.m.rotation.z += d.sz * dt;
    if (p.y < 0.08) { p.y = 0.08; d.vy *= -0.35; d.vx *= 0.55; d.vz *= 0.55; d.sx *= 0.5; d.sz *= 0.5; }
    if (wallTest(p.x, p.z) && p.y < WALL_H) { d.vx *= -0.4; d.vz *= -0.4; p.x += d.vx * dt * 2; p.z += d.vz * dt * 2; }
    d.life -= dt;
    if (d.life < 0.4) d.m.scale.setScalar(d.s * Math.max(0, d.life / 0.4));
    if (d.life <= 0) { scene.remove(d.m); debris.splice(i, 1); }
  }
  for (let i = fx.length - 1; i >= 0; i--) {
    const f = fx[i], p = f.m.position;
    p.x += f.vx * dt; p.y += f.vy * dt; p.z += f.vz * dt;
    f.life -= dt;
    const k = Math.max(0, f.life / f.max);
    if (f.smoke) { f.m.scale.setScalar(f.smoke * (1 + (1 - k) * 2.5)); f.m.material.opacity = 0.75 * k; f.vx *= 0.98; f.vz *= 0.98; }
    else if (f.grow) { f.m.scale.setScalar(f.grow * (0.6 + (1 - k) * 0.5)); f.m.material.opacity = k; }
    else { f.m.scale.setScalar(f.base * (0.3 + k)); f.m.material.opacity = k; }
    if (f.life <= 0) { scene.remove(f.m); f.m.material.dispose(); fx.splice(i, 1); }
  }
}
