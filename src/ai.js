// ---------- 試玩場的敵機 ----------
// 跟玩家同一套物理：保持中距離繞著玩家走、偶爾推進換位置、看到砲彈飛過來會往旁邊噴開
// 機砲一陣一陣打、加農砲隔幾秒一發；手臂被打掉就少一把武器、腿壞了就追不上
// 被打爆後過幾秒，新的一台從天上降落（落地前地上有紅圈，站在下面會被砸到）
import * as THREE from 'three';
import { G, addMat, addTrauma, angleDiff, scene } from './core.js';
import { randomOpenSpot, rayBlock } from './arena.js';
import { ENEMY_COLORS, damagePart, makeMech, removeMech, tryBoost } from './mech.js';
import { ENEMY_MOD, GUNS, makeGuns, shots, updateGun } from './weapons.js';
import { burst, hitSparks, smoke } from './fx.js';
import { sfx } from './audio.js';

export const enemies = [];
export const AI = { passive: false, count: 2 };
const DROP_TIME = 1.1, DROP_H = 16;
const RING_GEO = new THREE.RingGeometry(0.8, 0.95, 36);

export function spawnEnemy(player) {
  const p = randomOpenSpot(player.x, player.z, 10);
  const e = makeMech({ team: 'enemy', colors: ENEMY_COLORS, x: p.x, z: p.z, yaw: Math.atan2(player.x - p.x, player.z - p.z), hpMul: 0.85 });
  e.guns = makeGuns();
  e.ai = { strafe: Math.random() < 0.5 ? -1 : 1, t: 1, burst: 0, rest: 1 + Math.random(), cannon: 1.5 + Math.random() * 1.5, reposition: 3 + Math.random() * 3 };
  const ring = new THREE.Mesh(RING_GEO, addMat(0xff4030, 0.8));
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(p.x, 0.04, p.z);
  scene.add(ring);
  e.drop = { t: 0, ring };
  e.model.root.position.y = DROP_H;
  e.onDeath = () => setTimeout(() => { removeMech(e); enemies.splice(enemies.indexOf(e), 1); }, 2500);   // 殘骸留一下，過 2.5 秒才補新的一台
  enemies.push(e);
  return e;
}

// 降落：從天上掉下來，落地砸一下
function updateDrop(e, dt, player) {
  const D = e.drop;
  D.t += dt;
  const k = Math.min(1, D.t / DROP_TIME);
  e.model.root.position.set(e.x, DROP_H * (1 - k * k), e.z);
  D.ring.material.opacity = 0.4 + 0.5 * Math.abs(Math.sin(D.t * 14));
  D.ring.scale.setScalar(1.6 - 0.6 * k);
  if (k < 1) return true;
  scene.remove(D.ring); D.ring.material.dispose();
  e.drop = null;
  e.model.root.position.y = 0;
  burst(e.x, 0.3, e.z, [0x6a6e78, 0x4a4e58], 10, 5);
  smoke(e.x, 0.3, e.z, 8, 1.5, 0x55585f);
  for (const a of [0, 1.6, 3.2, 4.8]) hitSparks(e.x, 0.2, e.z, Math.sin(a), Math.cos(a), 0.8);
  sfx.land();
  const d = Math.hypot(player.x - e.x, player.z - e.z);
  addTrauma(Math.max(0.1, 0.6 - d * 0.04));
  if (player.alive && d < e.r + player.r + 0.3) {
    const nx = (player.x - e.x) / (d || 1), nz = (player.z - e.z) / (d || 1);
    player.vx += nx * 10; player.vz += nz * 10;
    damagePart(player, 'torso', 35, nx, nz);
  }
  return false;
}

export function updateEnemy(e, dt, player) {
  if (!e.alive) return;
  if (e.drop) { if (updateDrop(e, dt, player)) return; }
  const A = e.ai;
  const dx = player.x - e.x, dz = player.z - e.z, dist = Math.hypot(dx, dz) || 1;
  const nx = dx / dist, nz = dz / dist;
  const los = rayBlock(e.x, e.z, nx, nz, dist) >= dist - 0.9;

  // 移動：遠了靠近、近了後退，中間繞圈
  A.t -= dt;
  if (A.t <= 0) { A.t = 2 + Math.random() * 2.5; if (Math.random() < 0.5) A.strafe *= -1; }
  let mx, mz;
  if (!player.alive) { mx = 0; mz = 0; }
  else if (dist > 12 || !los) { mx = nx; mz = nz; }
  else if (dist < 6.5) { mx = -nx; mz = -nz; }
  else { mx = -nz * A.strafe + nx * 0.15; mz = nx * A.strafe + nz * 0.15; }
  // 前面有方塊就轉開
  const ml = Math.hypot(mx, mz);
  if (ml > 0.1) {
    for (const turn of [0, 0.8, -0.8, 1.6, -1.6]) {
      const a = Math.atan2(mx, mz) + turn * A.strafe;
      if (rayBlock(e.x, e.z, Math.sin(a), Math.cos(a), 2.4) >= 2.4) { mx = Math.sin(a) * ml; mz = Math.cos(a) * ml; break; }
    }
  }

  // 推進：看到玩家的砲彈飛過來往旁邊噴；偶爾推進換位置
  A.reposition -= dt;
  let boost = false, bx = mx, bz = mz;
  for (const s of shots) {
    if (s.owner.team === 'enemy') continue;
    const ox = e.x - s.x, oz = e.z - s.z, t = ox * s.dx + oz * s.dz;
    if (t < 0 || t > 6) continue;
    const px = ox - s.dx * t, pz = oz - s.dz * t;
    if (px * px + pz * pz < 1.4 && s.dmg > 20 && Math.random() < dt * 6) {
      boost = true; const side = px * -s.dz + pz * s.dx > 0 ? 1 : -1;
      bx = -s.dz * side; bz = s.dx * side;
    }
  }
  if (A.reposition <= 0 && player.alive) { A.reposition = 4 + Math.random() * 4; boost = true; }
  if (boost && e.energy > 55) tryBoost(e, bx, bz);
  e.drive = { mx, mz };

  // 瞄準：稍微預判玩家的移動
  const lead = dist / (GUNS.autocannon.speed * ENEMY_MOD.speedMul) * 0.5;
  e.aimYaw = Math.atan2(player.x + player.vx * lead - e.x, player.z + player.vz * lead - e.z);
  const onTarget = Math.abs(angleDiff(e.torsoYaw, e.aimYaw)) < 0.12 && los && player.alive && !AI.passive && dist < 18;

  // 機砲：打 0.7 秒、停 1～2 秒；加農砲：2.5～4 秒一發
  let fireL = false, fireR = false;
  if (A.burst > 0) { A.burst -= dt; fireL = onTarget; }
  else { A.rest -= dt; if (A.rest <= 0 && onTarget) { A.burst = 0.7; A.rest = 1 + Math.random(); } }
  A.cannon -= dt;
  if (A.cannon <= 0 && onTarget) { fireR = true; A.cannon = 2.5 + Math.random() * 1.5; }
  updateGun(e, 'L', fireL, dt);
  updateGun(e, 'R', fireR, dt);
}

export function keepEnemies(player) {
  if (G.now < 1) return;
  while (enemies.length < AI.count) spawnEnemy(player);
}
