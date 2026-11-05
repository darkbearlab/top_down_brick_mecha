// ---------- 試玩場的敵機 ----------
// 每台隨機挑一套配裝（parts.js ENEMY_PRESETS），用跟玩家同一套物理和武器
// 距離依武器決定：有劍 / 霰彈就貼近、有狙擊就拉遠、其他保持中距離繞圈
// 看到玩家的加農砲 / 飛彈飛過來會往旁邊噴開；狙擊開槍前會先亮紅色雷射預告
// 被打爆後過幾秒，新的一台從天上降落（地上先出現紅圈，站在下面會被砸）
import * as THREE from 'three';
import { G, addMat, addTrauma, angleDiff, scene } from './core.js';
import { randomOpenSpot, rayBlock } from './arena.js';
import { ENEMY_COLORS, damagePart, facing, makeMech, muzzleOf, removeMech, slotBroken, tryBoost } from './mech.js';
import { makeGuns, shots, updateGuns } from './weapons.js';
import { ENEMY_PRESETS, SLOTS } from './parts.js';
import { burst, hitSparks, makeLaser, setLaser, smoke } from './fx.js';
import { sfx } from './audio.js';

export const enemies = [];
// 難度：dmg 敵機傷害倍率、hp 耐久倍率、rest 射擊間隔倍率、err 瞄準晃動（弧度）、dodge 會不會噴開閃避、lock 鎖定時間倍率
export const DIFFS = {
  easy: { name: '新手', dmg: 0.45, hp: 0.7, rest: 2.0, err: 0.16, dodge: false, lock: 1.8 },
  normal: { name: '普通', dmg: 0.7, hp: 0.85, rest: 1.3, err: 0.07, dodge: true, lock: 1.2 },
  hard: { name: '強敵', dmg: 1, hp: 1, rest: 1, err: 0.02, dodge: true, lock: 1 },
};
export const AI = { passive: false, count: 2, diff: DIFFS.normal, sandbox: false };
const DROP_TIME = 1.1, DROP_H = 16;
const RING_GEO = new THREE.RingGeometry(0.8, 0.95, 36);

// player = 要打的對象（觀戰模式是另一台電腦機體）；opts.team / opts.colors 換隊伍
export function spawnEnemy(player, preset, at = null, opts = {}) {
  const P = preset ?? ENEMY_PRESETS[Math.floor(Math.random() * ENEMY_PRESETS.length)];
  const p = at ?? randomOpenSpot(player.x, player.z, 10);
  const D = AI.diff;
  const e = makeMech({ team: opts.team ?? 'enemy', colors: opts.colors ?? ENEMY_COLORS, loadout: P, x: p.x, z: p.z, yaw: Math.atan2(player.x - p.x, player.z - p.z), hpMul: D.hp });
  e.dmgMul = D.dmg;
  e.seed = Math.random() * 10;
  e.guns = makeGuns(P);
  e.preset = P;
  const ws = SLOTS.map(s => P[s]).filter(Boolean);
  e.ai = {
    strafe: Math.random() < 0.5 ? -1 : 1, t: 1, burst: 0, rest: 1 + Math.random(), reposition: 3 + Math.random() * 3, lockT: 0, snipeT: 0,
    want: ws.includes('saber') || ws.includes('shotgun') ? 3 : ws.includes('sniper') ? 13 : 8,
  };
  e.laser = makeLaser(0xff3020);
  const ring = new THREE.Mesh(RING_GEO, addMat(0xff4030, 0.8));
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(p.x, 0.04, p.z);
  scene.add(ring);
  e.drop = { t: 0, ring };
  e.model.root.position.y = DROP_H;
  e.onDeath = () => {
    e.laser.g.visible = false;
    AI.onEnemyDeath?.(e);
    setTimeout(() => removeEnemy(e), 2500);   // 殘骸留一下才補新的
  };
  enemies.push(e);
  return e;
}

export function removeEnemy(e) {
  const i = enemies.indexOf(e);
  if (i < 0) return;
  enemies.splice(i, 1);
  removeMech(e);
  e.laser.g.visible = false;
  if (e.drop) { scene.remove(e.drop.ring); e.drop = null; }
}
export function clearEnemies() { for (const e of enemies.slice()) removeEnemy(e); }

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

// 這把武器打得到多遠
const reachOf = d => d.kind === 'saber' ? d.reach + 1.2 : d.kind === 'bullet' || d.kind === 'beam' ? d.speed * d.life : 18;   // 敵人子彈慢，但飛得一樣久 → 射程一樣

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
  else if (dist > A.want + 4 || !los) { mx = nx; mz = nz; }
  else if (dist < A.want - 2) { mx = -nx; mz = -nz; }
  else { mx = -nz * A.strafe + nx * 0.15; mz = nx * A.strafe + nz * 0.15; }
  const ml = Math.hypot(mx, mz);
  if (ml > 0.1) {
    for (const turn of [0, 0.8, -0.8, 1.6, -1.6]) {
      const a = Math.atan2(mx, mz) + turn * A.strafe;
      if (rayBlock(e.x, e.z, Math.sin(a), Math.cos(a), 2.4) >= 2.4) { mx = Math.sin(a) * ml; mz = Math.cos(a) * ml; break; }
    }
  }

  // 推進：重的子彈 / 飛彈飛過來往旁邊噴；偶爾推進換位置；近戰型推進衝過去
  A.reposition -= dt;
  let boost = false, bx = mx, bz = mz;
  for (const s of shots) {
    if (s.team === e.team || !(s.heavy || s.kind !== 'bullet' || s.dmg > 20)) continue;
    const sdx = s.dx ?? s.vx / s.speed, sdz = s.dz ?? s.vz / s.speed;
    const ox = e.x - s.x, oz = e.z - s.z, t = ox * sdx + oz * sdz;
    if (t < 0 || t > 6) continue;
    const px = ox - sdx * t, pz = oz - sdz * t;
    if (px * px + pz * pz < 1.6 && Math.random() < dt * 6) {
      boost = true; const side = px * -sdz + pz * sdx > 0 ? 1 : -1;
      bx = -sdz * side; bz = sdx * side;
    }
  }
  if (A.reposition <= 0 && player.alive) { A.reposition = 4 + Math.random() * 4; boost = true; if (A.want <= 3 && dist > 4) { bx = nx; bz = nz; } }
  if (boost && !AI.diff.dodge && !(A.reposition > 3.9)) boost = false;
  if (boost && e.energy > 55) tryBoost(e, bx, bz);
  e.drive = { mx, mz };

  // 瞄準：稍微預判
  const lead = dist / 18 * 0.5;
  e.aimYaw = Math.atan2(player.x + player.vx * lead - e.x, player.z + player.vz * lead - e.z) + Math.sin(G.now * 1.7 + e.seed) * AI.diff.err;
  const canShoot = los && player.alive && !AI.passive;
  const onTarget = Math.abs(angleDiff(e.torsoYaw, e.aimYaw)) < 0.14 && canShoot;
  // 鎖定玩家（給飛彈用）：在範圍內、看得到就慢慢鎖上
  const H = e.spec.head;
  A.lockT = canShoot && dist < H.lockRange && !e.parts.head.broken ? A.lockT + dt : Math.max(0, A.lockT - dt * 2);
  const locks = A.lockT >= H.lockTime * AI.diff.lock ? [player] : [];

  // 手臂：連射武器一陣一陣打；狙擊先亮雷射；劍貼近才揮；飛彈有鎖定才射
  const trig = { armL: false, armR: false, backL: false, backR: false };
  if (A.burst > 0) A.burst -= dt;
  else { A.rest -= dt; if (A.rest <= 0 && onTarget) { A.burst = 0.8; A.rest = (1 + Math.random() * 1.2) * AI.diff.rest; } }
  let laserSlot = null;
  for (const slot of SLOTS) {
    const g = e.guns[slot];
    if (!g || slotBroken(e, slot)) continue;
    const d = g.def, inRange = dist < reachOf(d);
    if (d.kind === 'saber') trig[slot] = inRange && canShoot && Math.abs(angleDiff(e.torsoYaw, e.aimYaw)) < 0.4;
    else if (d.kind === 'missile' || d.kind === 'split') trig[slot] = locks.length > 0 && Math.random() < dt * 0.8 / AI.diff.rest;
    else if (d.kind === 'vmissile') trig[slot] = locks.length > 0 && dist > 5 && Math.random() < dt * 0.6 / AI.diff.rest;
    else if (d.speed > 50) {
      // 狙擊：瞄 0.8 秒（紅色雷射）才開槍
      if (onTarget && inRange && g.cd <= 0 && g.reloadT <= 0) { A.snipeT += dt; laserSlot = slot; if (A.snipeT >= 0.8) { trig[slot] = true; A.snipeT = 0; } }
      else A.snipeT = Math.max(0, A.snipeT - dt);
    } else if (d.interval >= 1) trig[slot] = onTarget && inRange && Math.random() < dt * 0.7 / AI.diff.rest;
    else trig[slot] = A.burst > 0 && onTarget && inRange;
  }
  updateGuns(e, trig, dt, locks, { x: player.x, z: player.z });
  if (laserSlot) {
    const mz = muzzleOf(e, laserSlot), f = facing(e);
    const len = Math.min(rayBlock(mz.x, mz.z, f.x, f.z, 30), dist);
    setLaser(e.laser, mz.x, mz.z, f.x, f.z, len, mz.y, 0.3 + A.snipeT * 0.8, 0.04 + A.snipeT * 0.05);
  } else e.laser.g.visible = false;
}

export function keepEnemies(player) {
  if (!AI.sandbox) return;
  while (enemies.length < AI.count) spawnEnemy(player);
}
