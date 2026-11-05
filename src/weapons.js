// ---------- 武器與砲彈 ----------
// 左臂：機砲（連射、傷害低、幾乎沒有擊退）
// 右臂：加農砲（單發、傷害高、打到會把對方推走，自己也會被後座力往後推）
// 敵人的砲彈比較慢，看得到、閃得掉（有慣性，要提早動）
import * as THREE from 'three';
import { UNIT_BOX, addMat, addTrauma, scene } from './core.js';
import { rayBlock } from './arena.js';
import { facing, hitMech, mechs, muzzleOf } from './mech.js';
import { muzzleFlash, sparks } from './fx.js';
import { sfx } from './audio.js';

export const GUNS = {
  autocannon: { name: '機砲', interval: 0.11, mag: 30, reload: 1.8, dmg: 7, speed: 34, spread: 0.035, kb: 0.25, recoil: 0.15, size: 0.09, color: 0xffd070 },
  cannon: { name: '加農砲', interval: 1.0, mag: 0, reload: 0, dmg: 42, speed: 26, spread: 0, kb: 4.5, recoil: 2.8, size: 0.2, color: 0xff8a40 },
};
// 敵人版本：子彈慢、傷害低一點
export const ENEMY_MOD = { speedMul: 0.5, dmgMul: 0.7 };

export function makeGuns(L = 'autocannon', R = 'cannon') {
  const g = def => ({ def: GUNS[def], cd: 0, ammo: GUNS[def].mag, reloadT: 0 });
  return { L: g(L), R: g(R) };
}

export const shots = [];
const SHOT_MATS = new Map();
const shotMat = c => { if (!SHOT_MATS.has(c)) SHOT_MATS.set(c, addMat(c)); return SHOT_MATS.get(c); };
const CORE_MAT = addMat(0xffffff);

// 手臂壞了那把就不能用
export function updateGun(m, side, trigger, dt) {
  const gun = m.guns[side], d = gun.def;
  gun.cd -= dt;
  if (gun.reloadT > 0) {
    gun.reloadT -= dt;
    if (gun.reloadT <= 0) { gun.ammo = d.mag; if (m.team === 'player') sfx.reloadDone(); }
    return;
  }
  if (!trigger || gun.cd > 0 || !m.alive || m.parts[side === 'L' ? 'armL' : 'armR'].broken) return;
  gun.cd = d.interval;
  fire(m, side, d);
  if (d.mag) {
    gun.ammo--;
    if (gun.ammo <= 0) { gun.reloadT = d.reload; if (m.team === 'player') sfx.reload(); }
  }
}

function fire(m, side, d) {
  const enemy = m.team !== 'player';
  const mz = muzzleOf(m, side), f = facing(m);
  const a = Math.atan2(f.x, f.z) + (Math.random() - 0.5) * 2 * d.spread * (m.parts.head.broken ? 2.5 : 1);
  const dx = Math.sin(a), dz = Math.cos(a);
  const speed = d.speed * (enemy ? ENEMY_MOD.speedMul : 1);
  const g = new THREE.Group();
  const glow = new THREE.Mesh(UNIT_BOX, shotMat(enemy ? 0xff3a30 : d.color));
  const core = new THREE.Mesh(UNIT_BOX, CORE_MAT);
  glow.scale.set(d.size * 1.6, d.size * 1.6, d.size * (enemy ? 2.5 : 6));
  core.scale.set(d.size * 0.7, d.size * 0.7, d.size * (enemy ? 2 : 5));
  g.add(glow, core);
  g.position.set(mz.x, mz.y, mz.z);
  g.rotation.y = a;
  scene.add(g);
  shots.push({ g, owner: m, x: mz.x, z: mz.z, y: mz.y, dx, dz, speed, life: 1.4 / (enemy ? ENEMY_MOD.speedMul : 1), dmg: d.dmg * (enemy ? ENEMY_MOD.dmgMul : 1), kb: d.kb });
  muzzleFlash(mz.x, mz.y, mz.z, enemy ? 0xff6040 : d.color, d.size * 4);
  // 後座力：往射擊反方向推自己（慣性的一部分）
  m.vx -= dx * d.recoil; m.vz -= dz * d.recoil;
  if (d === GUNS.cannon) { sfx.cannon(); if (!enemy) addTrauma(0.25); } else (enemy ? sfx.enemyShot() : sfx.autocannon());
}

export function updateShots(dt) {
  for (let i = shots.length - 1; i >= 0; i--) {
    const s = shots[i];
    const step = s.speed * dt;
    s.life -= dt;
    // 先找這一步會不會打到機體
    let hit = null, ht = step;
    for (const m of mechs) {
      if (!m.alive || m.drop || m === s.owner || m.team === s.owner.team) continue;
      const ox = m.x - s.x, oz = m.z - s.z, t = ox * s.dx + oz * s.dz;
      if (t < -m.r || t > step + m.r) continue;
      const px = ox - s.dx * t, pz = oz - s.dz * t;
      if (px * px + pz * pz > m.r * m.r) continue;
      const tt = Math.max(0, t - Math.sqrt(m.r * m.r - px * px - pz * pz));
      if (tt < ht) { ht = tt; hit = m; }
    }
    const wall = rayBlock(s.x, s.z, s.dx, s.dz, ht);
    if (wall < ht) {
      s.x += s.dx * wall; s.z += s.dz * wall;
      sparks(s.x, s.y, s.z, 0xffd080, 5, -s.dx, -s.dz);
      kill(i); continue;
    }
    s.x += s.dx * ht; s.z += s.dz * ht;
    if (hit) {
      const r = hitMech(hit, s.dmg, s.dx, s.dz, s.kb);
      const armor = r && r.mul < 1;
      sparks(s.x, s.y, s.z, armor ? 0xd8e4ff : 0xffb040, armor ? 6 : 9, -s.dx, -s.dz);
      armor ? sfx.armorHit() : sfx.hit();
      if (hit.team === 'player') addTrauma(0.15 + s.kb * 0.04);
      kill(i); continue;
    }
    if (s.life <= 0) { kill(i); continue; }
    s.g.position.set(s.x, s.y, s.z);
  }
}
function kill(i) { scene.remove(shots[i].g); shots.splice(i, 1); }
export function clearShots() { while (shots.length) kill(shots.length - 1); }
