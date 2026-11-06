// ---------- 武器與彈藥 ----------
// 四個掛載點：左手、右手、左背、右背；每一邊同時只有一把在準備（Q / E 切換，見 mech.js），左鍵 / 右鍵打那一邊準備好的
// 手臂 / 背部武器被打掉就不能用
// 種類：
//   bullet  一般子彈（機槍、機砲、霰彈、狙擊、加農砲）
//   beam    光束：吃能量，不用換彈
//   saber   光束劍：吃能量，往前突進揮一刀，打中扇形內的敵機，順便劈掉飛過來的子彈
//   missile 直射飛彈：有鎖定就追目標
//   vmissile 垂直飛彈：先往上飛再從上方砸下來（越過掩體），要鎖定
//   split   分裂飛彈：飛一段後分裂成好幾顆小飛彈
//   rocket  火箭莢艙：不追蹤的直射火箭，一次好幾發
// 敵人的子彈和光束比較慢，看得到、閃得掉
import * as THREE from 'three';
import { UNIT_BOX, addMat, addTrauma, scene } from './core.js';
import { isBlock, rayBlock } from './arena.js';
import { blastBuildings, damageBuilding } from './buildings.js';
import { facing, hitMech, mechs, muzzleOf, slotBroken, slotLive, updateReady, useEnergy } from './mech.js';
import { explosion, flame, hitSparks, muzzleFlash, rampOf, smoke, spawnGlow, spawnPuff, sparks } from './fx.js';
import { DMG_TYPES, SLOTS, WEAPONS } from './parts.js';
import { sfx } from './audio.js';

export const ENEMY_SPEED = 0.55;
export function makeGuns(lo) {
  const g = {};
  for (const s of SLOTS) if (lo[s]) g[s] = { def: WEAPONS[lo[s]], cd: 0, ammo: WEAPONS[lo[s]].mag, reloadT: 0 };
  return g;
}

export const shots = [];
const mats = new Map();
const glowMat = c => { if (!mats.has(c)) mats.set(c, addMat(c)); return mats.get(c); };
const CORE_MAT = addMat(0xffffff);
const R = (a, b) => a + Math.random() * (b - a);

// 每幀：triggers = { L, R } 左右鍵按著沒（打那一邊目前準備好的武器）；locks = 鎖定中的目標（陣列）；aim = 瞄準點
export function updateGuns(m, triggers, dt, locks = [], aim = null) {
  updateReady(m, dt);
  if (m.salvo?.length) {
    for (let i = m.salvo.length - 1; i >= 0; i--) { const q = m.salvo[i]; q.t -= dt; if (q.t <= 0) { m.salvo.splice(i, 1); if (m.alive) q.fn(); } }
  }
  if (m.swing) updateSwing(m, dt);
  for (const slot in m.guns) {
    const gun = m.guns[slot], d = gun.def;
    gun.cd -= dt;
    if (gun.reloadT > 0) {
      gun.reloadT -= dt;
      if (gun.reloadT <= 0) { gun.ammo = d.mag; if (m.team === 'player') sfx.reloadDone(); }
      continue;
    }
    if (!triggers[slot.slice(-1)] || !slotLive(m, slot) || gun.cd > 0 || !m.alive || slotBroken(m, slot) || m.swing || m.staggerT > 0) continue;
    if (d.needLock && !locks.length && m.team === 'player') { gun.cd = 0.3; sfx.click(); continue; }
    if (d.energy && !useEnergy(m, d.energy)) continue;
    gun.cd = d.interval;
    fire(m, slot, d, locks, aim);
    if (d.mag) {
      gun.ammo--;
      if (gun.ammo <= 0) { gun.reloadT = d.reload; if (m.team === 'player') sfx.reload(); }
    }
  }
}

function fire(m, slot, d, locks, aim) {
  const enemy = m.team !== 'player';
  const mz = muzzleOf(m, slot), f = facing(m), base = Math.atan2(f.x, f.z);
  const spreadK = m.spec.spreadMul * (m.parts.head.broken ? 2.5 : 1);
  if (d.kind === 'saber') { startSwing(m, slot, d); return; }
  if (d.kind === 'bullet' || d.kind === 'beam') {
    const n = d.pellets ?? 1;
    const spMul = enemy ? (d === WEAPONS.sniper ? 0.5 : ENEMY_SPEED) : 1;
    for (let i = 0; i < n; i++) {
      const a = base + (Math.random() - 0.5) * 2 * d.spread * spreadK;
      spawnShot(m, d, mz.x, mz.y, mz.z, Math.sin(a), Math.cos(a), d.speed * spMul * (n > 1 ? R(0.85, 1.1) : 1));
    }
    muzzleFlash(mz.x, mz.y, mz.z, d.kind === 'beam' ? DMG_TYPES.energy.hex : enemy ? 0xff6040 : 0xffd070, (d.size ?? 0.1) * 4.5);
    m.vx -= f.x * d.recoil; m.vz -= f.z * d.recoil;
    if (d.heavy) { sfx.cannon(); smoke(mz.x + f.x * 0.3, mz.y, mz.z + f.z * 0.3, 6, 1.2, 0x8a8c92); muzzleFlash(mz.x, mz.y, mz.z, 0xffc060, 1.6); if (!enemy) addTrauma(0.4); }
    else if (d.kind === 'beam') sfx.beam();
    else if (d === WEAPONS.sniper) { sfx.sniper(); if (!enemy) addTrauma(0.15); }
    else if (d === WEAPONS.shotgun) { sfx.shotgun(); if (!enemy) addTrauma(0.12); }
    else enemy ? sfx.enemyShot() : sfx.autocannon();
    return;
  }
  // 飛彈：一發一發錯開射出，每發分配一個鎖定目標
  const n = d.salvo ?? 1;
  sfx.missile();
  m.salvo ??= [];
  for (let i = 0; i < n; i++) {
    m.salvo.push({ t: i * (d.kind === 'rocket' ? 0.07 : 0.09), fn: () => {
      const p = muzzleOf(m, slot), ff = facing(m);
      const target = d.kind === 'rocket' ? null : locks.length ? locks[i % locks.length] : null;
      const side = (i % 2 ? 1 : -1) * (0.15 + 0.1 * Math.floor(i / 2));
      if (d.kind === 'vmissile') {
        const tp = target ?? (aim ? { x: aim.x, z: aim.z } : { x: m.x + ff.x * 8, z: m.z + ff.z * 8 });
        spawnMissile(m, d, p.x + R(-0.15, 0.15), p.y, p.z + R(-0.15, 0.15), { vx: R(-1, 1) + ff.x * 3, vy: R(14, 16), vz: R(-1, 1) + ff.z * 3 }, target, { x: tp.x, z: tp.z });
      } else {
        const a = Math.atan2(ff.x, ff.z) + (d.kind === 'rocket' ? R(-1, 1) * d.spread : side);
        spawnMissile(m, d, p.x, p.y, p.z, { vx: Math.sin(a) * d.speed, vy: 0, vz: Math.cos(a) * d.speed }, target, null);
      }
      smoke(p.x, p.y, p.z, 1, 0.6, 0x9a9ca2);
    } });
  }
}

function shotMesh(color, w, len) {
  const g = new THREE.Group();
  const glow = new THREE.Mesh(UNIT_BOX, glowMat(color)), core = new THREE.Mesh(UNIT_BOX, CORE_MAT);
  glow.scale.set(w * 1.6, w * 1.6, len); core.scale.set(w * 0.7, w * 0.7, len * 0.8);
  g.add(glow, core);
  scene.add(g);
  return g;
}
function spawnShot(m, d, x, y, z, dx, dz, speed) {
  const enemy = m.team !== 'player', beam = d.kind === 'beam';
  const color = beam ? DMG_TYPES.energy.hex : enemy ? 0xff3a30 : d === WEAPONS.sniper ? 0xfff0c0 : 0xffd070;
  const len = beam ? 1.1 : d === WEAPONS.sniper ? 1.6 : (d.size ?? 0.1) * (enemy ? 2.5 : 6);
  const g = shotMesh(color, d.size ?? 0.1, len);
  g.position.set(x, y, z); g.rotation.y = Math.atan2(dx, dz);
  shots.push({ kind: 'bullet', g, owner: m, team: m.team, x, y, z, dx, dz, speed, life: d.life * d.speed / speed, dmg: d.dmg * (m.dmgMul ?? 1), power: d.dmg, kb: d.kb, type: d.type, trail: d.trail, heavy: d.heavy, splash: d.splash });
}
function spawnMissile(m, d, x, y, z, v, target, point) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(UNIT_BOX, new THREE.MeshLambertMaterial({ color: 0xd8dce2 }));
  body.scale.set(d.size, d.size, d.size * 3);
  const tip = new THREE.Mesh(UNIT_BOX, glowMat(m.team === 'player' ? 0xffa040 : 0xff3a30));
  tip.scale.set(d.size * 1.2, d.size * 1.2, d.size * 0.8); tip.position.z = d.size * 1.6;
  g.add(body, tip);
  g.position.set(x, y, z);
  scene.add(g);
  shots.push({ kind: d.kind, g, owner: m, team: m.team, x, y, z, vx: v.vx, vy: v.vy, vz: v.vz, speed: Math.hypot(v.vx, v.vz) || 1, life: d.life, age: 0,
    dmg: d.dmg * (m.dmgMul ?? 1), power: d.dmg, kb: 1.2, type: d.type, target, point, d, splash: d.splash });
}

// ---------- 光束劍 ----------
function startSwing(m, slot, d) {
  const f = facing(m);
  // 前方有敵機就全力突進，沒有就小步往前
  let k = 0.6;
  for (const o of mechs) {
    if (!o.alive || o.team === m.team || o.drop) continue;
    const ox = o.x - m.x, oz = o.z - m.z, dist = Math.hypot(ox, oz);
    if (dist < 5.5 && (ox * f.x + oz * f.z) / dist > 0.75) { k = 1; break; }
  }
  m.vx += f.x * d.lunge * k; m.vz += f.z * d.lunge * k;
  m.swing = { slot, d, t: 0.24, dur: 0.24, done: new Set() };
  sfx.saber();
}
const SABER_RAMP = rampOf(0x60e0ff);
function updateSwing(m, dt) {
  const s = m.swing;
  s.t -= dt;
  const d = s.d, f = facing(m), base = Math.atan2(f.x, f.z), side = s.slot === 'armL' ? 1 : -1;
  const prog = 1 - s.t / s.dur;
  // 刀光：沿著揮過的弧留下一排發光方塊
  const a = base + side * (d.arc / 2 - prog * d.arc);
  for (let i = 0; i < 4; i++) {
    const r = d.reach * (0.45 + i * 0.18);
    spawnGlow({ x: m.x + Math.sin(a) * r, y: m.model.hipY + 0.4, z: m.z + Math.cos(a) * r, life: 0.18, s0: 0.16, s1: 0, ramp: SABER_RAMP, vr: 0 });
  }
  if (prog >= 0.35) {
    for (const o of mechs) {
      if (!o.alive || o.team === m.team || o.drop || s.done.has(o)) continue;
      const ox = o.x - m.x, oz = o.z - m.z, dist = Math.hypot(ox, oz) || 1;
      const da = Math.atan2(Math.sin(Math.atan2(ox, oz) - base), Math.cos(Math.atan2(ox, oz) - base));
      if (dist > d.reach + o.r || Math.abs(da) > d.arc / 2 + 0.2) continue;
      s.done.add(o);
      const nx = ox / dist, nz = oz / dist;
      const r = hitMech(o, d.dmg * (m.dmgMul ?? 1), nx, nz, d.kb, 'energy', null, d.dmg);
      hitSparks(o.x - nx * o.r, 1.2, o.z - nz * o.r, -nx, -nz, 2.2, r && r.eff < 1);
      sparks(o.x - nx * o.r, 1.2, o.z - nz * o.r, 0x60e0ff, 14, nx, nz);
      sfx.saberHit();
      addTrauma(0.3);
    }
    // 劈掉扇形內的子彈
    for (let i = shots.length - 1; i >= 0; i--) {
      const sh = shots[i];
      if (sh.team === m.team) continue;
      const ox = sh.x - m.x, oz = sh.z - m.z, dist = Math.hypot(ox, oz) || 1;
      if (dist > d.reach + 0.3 || (ox * f.x + oz * f.z) / dist < Math.cos(d.arc / 2)) continue;
      hitSparks(sh.x, sh.y, sh.z, -ox / dist, -oz / dist, 0.8, true);
      kill(i);
    }
  }
  if (s.t <= 0) m.swing = null;
}

// ---------- 命中 ----------
// 火花依剋制關係：被裝甲擋下 = 藍白、剋制 = 更多更大
function impact(s, o, nx, nz, dmg, forced) {
  const r = hitMech(o, dmg, nx, nz, s.kb, s.type, forced, s.power ?? dmg);
  const p = (s.heavy ? 2 : 1) * (r && r.eff > 1 ? 1.4 : 1);
  hitSparks(s.x, s.y, s.z, -nx, -nz, p, r && r.eff < 1);
  if (s.type === 'energy') sparks(s.x, s.y, s.z, 0x60e0ff, 6, -nx, -nz);
  r && r.eff < 1 ? sfx.armorHit() : sfx.hit();
  if (o.team === 'player') addTrauma(0.12 + s.kb * 0.04);
  return r;
}
// 爆風：直接命中的那台另外算，範圍內其他機體吃 40%（打軀幹）；加農砲的砲彈爆得更大、推得更遠、外圈較弱
function blast(s, x, y, z, direct) {
  const shell = s.kind === 'bullet';
  explosion(x, y, z, shell ? 0.95 : 0.38);
  if (shell) { addTrauma(0.2); smoke(x, y, z, 6, 1.6, 0x55585f); }
  sfx.blast();
  blastBuildings(x, y, z, s.dmg, s.splash);
  for (const o of mechs) {
    if (!o.alive || o.drop || o.team === s.team || o === direct) continue;
    const dx = o.x - x, dz = o.z - z, dist = Math.hypot(dx, dz);
    if (dist > s.splash + o.r) continue;
    const fall = shell ? 1 - 0.5 * Math.max(0, dist - o.r) / s.splash : 1;   // 砲彈爆風越外圈越弱；飛彈維持原樣
    hitMech(o, s.dmg * 0.4 * fall, dx / (dist || 1), dz / (dist || 1), shell ? 3 : 0.6, s.type, 'torso', (s.power ?? s.dmg) * 0.4 * fall);
  }
}

export function updateShots(dt) {
  for (let i = shots.length - 1; i >= 0; i--) {
    const s = shots[i];
    if (s.kind === 'bullet') stepBullet(s, i, dt);
    else stepMissile(s, i, dt);
  }
}

function stepBullet(s, i, dt) {
  const step = s.speed * dt;
  s.life -= dt;
  let hit = null, ht = step;
  for (const m of mechs) {
    if (!m.alive || m.drop || m.team === s.team) continue;
    const ox = m.x - s.x, oz = m.z - s.z, t = ox * s.dx + oz * s.dz;
    if (t < -m.r || t > step + m.r) continue;
    const px = ox - s.dx * t, pz = oz - s.dz * t;
    if (px * px + pz * pz > m.r * m.r) continue;
    const tt = Math.max(0, t - Math.sqrt(m.r * m.r - px * px - pz * pz));
    if (tt < ht) { ht = tt; hit = m; }
  }
  const wall = rayBlock(s.x, s.z, s.dx, s.dz, ht);
  if (s.trail) for (let k = 0; k < 3; k++) spawnPuff({ x: s.x + s.dx * ht * k / 3, y: s.y, z: s.z + s.dz * ht * k / 3, life: 0.35, s: 0.07, c0: 0xc8c8c8, c1: 0x6a6a6a, drag: 0 });
  if (wall < ht) {
    s.x += s.dx * wall; s.z += s.dz * wall;
    hitSparks(s.x, s.y, s.z, -s.dx, -s.dz, s.heavy ? 1.6 : 0.6);
    if (s.splash) blast(s, s.x, s.y, s.z, null);          // 加農砲：打到牆也是一團爆風
    else if (s.heavy) blastBuildings(s.x, s.y, s.z, s.dmg * 1.5, 0.7);
    else damageBuilding(s.x, s.y, s.z, s.dmg, s.dx, s.dz);
    smoke(s.x, s.y, s.z, s.heavy ? 3 : 1, 0.7, 0x6a6c72);
    kill(i); return;
  }
  s.x += s.dx * ht; s.z += s.dz * ht;
  if (hit) {
    impact(s, hit, s.dx, s.dz, s.dmg);
    if (s.splash) blast(s, s.x, s.y, s.z, hit);
    else if (s.heavy) explosion(s.x, s.y, s.z, 0.32);
    kill(i); return;
  }
  if (s.life <= 0) { if (s.splash) blast(s, s.x, Math.max(0.3, s.y), s.z, null); kill(i); return; }   // 射程盡頭落地爆炸
  s.g.position.set(s.x, s.y, s.z);
}

function stepMissile(s, i, dt) {
  const d = s.d;
  s.age += dt; s.life -= dt;
  const tgt = s.target?.alive ? s.target : null;
  if (s.kind === 'vmissile') {
    // 先往上飛，到頂後轉向目標（或目標點）砸下來
    const tp = tgt ?? s.point;
    // 三段：爬升（往上衝、很快慢下來，頂點約 5～6 格高）→ 平飛（水平方向每秒最多轉 d.turn，轉彎半徑大）→ 接近目標俯衝
    const v = Math.hypot(s.vx, s.vy, s.vz) || 1, sp = Math.min(d.maxSpeed, v + d.accel * dt);
    if (s.age < 0.35) s.vy -= 30 * dt;
    else {
      const hx = tp.x - s.x, hz = tp.z - s.z, hd = Math.hypot(hx, hz) || 1;
      if (!s.dive && hd < s.y * 2 + 3) { s.dive = true; s.divePt = { x: tp.x, z: tp.z }; }
      if (s.dive) {
        // 俯衝：瞄開始俯衝那一刻目標的位置，之後只慢慢修正（每秒 1.5 格）→ 俯衝時橫移就閃得掉
        const P = s.divePt, gx = tp.x - P.x, gz = tp.z - P.z, gl = Math.hypot(gx, gz), mv = Math.min(gl, 1.5 * dt);
        if (gl > 1e-4) { P.x += gx / gl * mv; P.z += gz / gl * mv; }
        const ax = P.x - s.x, az = P.z - s.z, ty = 0.8 - s.y, tl = Math.hypot(ax, ty, az) || 1;
        let ux = s.vx / v, uy = s.vy / v, uz = s.vz / v;
        const wx = ax / tl, wy = ty / tl, wz = az / tl;
        const ang = Math.acos(Math.max(-1, Math.min(1, ux * wx + uy * wy + uz * wz)));
        if (ang > 1e-4) {
          const k = Math.min(1, d.turn * 2.5 * dt / ang);
          ux += (wx - ux) * k; uy += (wy - uy) * k; uz += (wz - uz) * k;
          const ul = Math.hypot(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
        }
        s.vx = ux * sp; s.vy = uy * sp; s.vz = uz * sp;
      } else {
        // 平飛：高度慢慢穩住，水平方向轉向目標（有上限）
        s.vy *= Math.exp(-5 * dt);
        let dir = Math.atan2(s.vx, s.vz);
        const diff = Math.atan2(Math.sin(Math.atan2(hx, hz) - dir), Math.cos(Math.atan2(hx, hz) - dir));
        dir += Math.max(-d.turn * dt, Math.min(d.turn * dt, diff));
        const hs = Math.sqrt(Math.max(1, sp * sp - s.vy * s.vy));
        s.vx = Math.sin(dir) * hs; s.vz = Math.cos(dir) * hs;
      }
    }
    s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
    trail(s);
    let direct = null;
    for (const m of mechs) if (m.alive && !m.drop && m.team !== s.team && s.y < 2.2 && Math.hypot(m.x - s.x, m.z - s.z) < m.r + 0.2) direct = m;
    if (direct || s.y <= 0.15 || s.life <= 0) {
      if (direct) {
        // 從上面砸下來：容易打到頭和背部武器
        const roll = Math.random(), P = direct.parts;
        const part = roll < 0.3 && !P.head.broken ? 'head' : roll < 0.55 && P.backL && !P.backL.broken ? 'backL' : roll < 0.8 && P.backR && !P.backR.broken ? 'backR' : 'torso';
        impact(s, direct, 0, 1, s.dmg, part);
      }
      blast(s, s.x, Math.max(0.3, s.y), s.z, direct);
      kill(i); return;
    }
  } else {
    // 直射 / 分裂：加速、有目標就慢慢轉過去
    let dir = Math.atan2(s.vx, s.vz);
    if (tgt) {
      const want = Math.atan2(tgt.x - s.x, tgt.z - s.z);
      const diff = Math.atan2(Math.sin(want - dir), Math.cos(want - dir));
      dir += Math.max(-d.turn * dt, Math.min(d.turn * dt, diff));
    }
    s.speed = Math.min(d.maxSpeed ?? 20, s.speed + (d.accel ?? 10) * dt);
    s.vx = Math.sin(dir) * s.speed; s.vz = Math.cos(dir) * s.speed;
    // 分裂：飛 0.45 秒或接近目標時裂成好幾顆
    if (s.kind === 'split' && (s.age > 0.45 || (tgt && Math.hypot(tgt.x - s.x, tgt.z - s.z) < 4.5))) {
      explosion(s.x, s.y, s.z, 0.15);
      for (let k = 0; k < d.bomblets; k++) {
        const a = dir + (k / (d.bomblets - 1) - 0.5) * 1.3;
        spawnMissile(s.owner, { ...d, kind: 'missile', size: 0.08, turn: 1.6, accel: 22, maxSpeed: 28, life: 0.95 }, s.x, s.y, s.z, { vx: Math.sin(a) * 14, vy: 0, vz: Math.cos(a) * 14 }, tgt, null);
      }
      kill(i); return;
    }
    const step = s.speed * dt, dx = s.vx / s.speed, dz = s.vz / s.speed;
    let hit = null;
    for (const m of mechs) {
      if (!m.alive || m.drop || m.team === s.team) continue;
      if (Math.hypot(m.x - (s.x + dx * step), m.z - (s.z + dz * step)) < m.r + 0.1) { hit = m; break; }
    }
    s.x += dx * step; s.z += dz * step;
    trail(s);
    if (hit) { impact(s, hit, dx, dz, s.dmg); blast(s, s.x, s.y, s.z, hit); kill(i); return; }
    if (isBlock(s.x, s.z) || s.life <= 0) { blast(s, s.x, s.y, s.z, null); kill(i); return; }
  }
  s.g.position.set(s.x, s.y, s.z);
  s.g.rotation.set(-Math.atan2(s.vy, Math.hypot(s.vx, s.vz)), Math.atan2(s.vx, s.vz), 0, 'YXZ');
}
function trail(s) {
  const l = Math.hypot(s.vx, s.vy, s.vz) || 1;
  flame(s.x - s.vx / l * 0.2, s.y - s.vy / l * 0.2, s.z - s.vz / l * 0.2, -s.vx / l * 0.3, -s.vz / l * 0.3);
  if (Math.random() < 0.6) spawnPuff({ x: s.x, y: s.y, z: s.z, vx: 0, vy: 0.3, vz: 0, life: R(0.6, 1), s: R(0.12, 0.2), c0: 0xb8bac0, c1: 0x6a6c72, drag: 1 });
}

function kill(i) { scene.remove(shots[i].g); shots.splice(i, 1); }
export function clearShots() { while (shots.length) kill(shots.length - 1); }
