// ---------- 武器與彈藥 ----------
// 四個掛載點：左手、右手、左背、右背；每一邊同時只有一把在準備（Q / E 切換，見 mech.js），左鍵 / 右鍵打那一邊準備好的
// 手臂 / 背部武器被打掉就不能用
// 種類：
//   bullet  一般子彈（機槍、機砲、霰彈、狙擊、加農砲）
//   beam    光束：吃能量，不用換彈
//   saber   光束劍：吃能量，往前突進揮一刀，打中扇形內的敵機，順便劈掉飛過來的子彈
//   pulse   脈衝光束步槍：吃能量，充能後照射一陣子的持續光束（跟瞄準雷射同一條線，停在第一個目標），每 0.05 秒判定一次
//   pile    打樁拳：蓄力後往前一拳，打在對方哪一側就打那一側的手臂
//   lance   衝擊騎槍：吃推進能量，點火後整台彈出去（衝刺本身在 mech.js driveMech），撞上的速度越快越痛
//   missile 直射飛彈：有鎖定就追目標
//   vmissile 垂直飛彈：先往上飛再從上方砸下來（越過掩體），要鎖定
//   split   分裂飛彈：飛一段後分裂成好幾顆小飛彈
//   rocket  火箭莢艙：不追蹤的直射火箭，一次好幾發
//   flame   火焰噴射器：按著一直噴，短距離扇形、穿透、被牆擋；打中的部位疊燃燒（status.js）
//   stream  汽油投射器：按著一直噴一串會飛的燃料（每顆自己飛，轉身時火舌甩出弧線），打中第一台疊燃燒，落地留油灘
//   napalm  燒夷彈：拋到瞄準點，落地小爆炸 + 一片燒好幾秒的火海（站在裡面腳會一直被點燃）
//           d.status = 'corrode' 就是酸液彈（投擲蟲）：落地不爆炸、濺開一灘酸，站在裡面腳被腐蝕
// 敵人的子彈和光束比較慢，看得到、閃得掉
import * as THREE from 'three';
import { G, GFX, UNIT_BOX, addMat, addTrauma, angleDiff, scene } from './core.js';
import { isBlock, rayBlock, wallFace } from './arena.js';
import { blastBuildings, damageBuilding, isBuilding } from './buildings.js';
import { facing, hasModule, hitMech, mechs, muzzleOf, slotBroken, slotLive, updateReady, useEnergy } from './mech.js';
import { RAMP, burnAt, explosion, flame, hitSparks, makeLaser, muzzleFlash, rampOf, scorch, setLaser, smoke, wallMark, sparks, spawnGlow, spawnPuff } from './fx.js';
import { BAL, DMG_TYPES, SLOTS, WEAPONS } from './parts.js';
import { sfx } from './audio.js';
import { chipDmgK, chipRateK, chipSpreadK, empOff } from './tech.js';
import { applyStatus, burnSpreadK } from './status.js';
import { att, log } from './combatlog.js';

export const ENEMY_SPEED = 0.55;
export function makeGuns(lo) {
  const g = {};
  const rack = ['backL', 'backR'].some(s => WEAPONS[lo[s]]?.module === 'ammo') ? WEAPONS.ammorack.ammoK : 1;   // 彈藥架：彈藥 ×1.5
  // ammo：總彈藥，打完就沒了；能量武器 Infinity
  for (const s of SLOTS) if (lo[s]) g[s] = { def: WEAPONS[lo[s]], cd: 0, ammo: WEAPONS[lo[s]].ammo ? Math.ceil(WEAPONS[lo[s]].ammo * rack) : Infinity, max: WEAPONS[lo[s]].ammo ? Math.ceil(WEAPONS[lo[s]].ammo * rack) : Infinity, base: WEAPONS[lo[s]].ammo ?? Infinity };
  return g;
}

// 供能模組：光束步槍、光束劍傷害 ×1.15
const powerDmgK = (m, d) => (d.kind === 'beam' || d.kind === 'saber') && hasModule(m, 'power') ? WEAPONS.power.dmgK : 1;
export const shots = [];
const mats = new Map();
const glowMat = c => { if (!mats.has(c)) mats.set(c, addMat(c)); const m = mats.get(c); if (m.userData.hdr !== GFX.hdr) { m.color.setHex(c).multiplyScalar(GFX.hdr); m.userData.hdr = GFX.hdr; } return m; };   // 子彈、飛彈尾焰、燃料：HDR
const CORE_MAT = addMat(0xffffff);
const R = (a, b) => a + Math.random() * (b - a);

// 每幀：triggers = { L, R } 左右鍵按著沒（打那一邊目前準備好的武器）；locks = 鎖定中的目標（陣列）；aim = 瞄準點
export function updateGuns(m, triggers, dt, locks = [], aim = null) {
  updateReady(m, dt);
  if (m.salvo?.length) {
    for (let i = m.salvo.length - 1; i >= 0; i--) { const q = m.salvo[i]; q.t -= dt; if (q.t <= 0) { m.salvo.splice(i, 1); if (m.alive) q.fn(); } }
  }
  if (m.swing) updateSwing(m, dt);
  if (m.pulses) updatePulses(m, dt);
  if (m.punch) updatePunch(m, dt);
  for (const slot in m.guns) {
    const gun = m.guns[slot], d = gun.def;
    if (d.kind === 'shield' || d.kind === 'module') continue;   // 盾牌、背部模組：純被動
    gun.cd -= dt;
    if (!triggers[slot.slice(-1)] || !slotLive(m, slot) || gun.cd > 0 || !m.alive || slotBroken(m, slot) || m.swing || m.punch || m.charge || m.staggerT > 0 || empOff(m)) continue;
    if (gun.ammo <= 0) { gun.cd = 0.3; if (m.team === 'player') sfx.click(); continue; }   // 彈盡
    if (d.needLock && !locks.length && m.team === 'player') { gun.cd = 0.3; sfx.click(); continue; }
    if (d.energy && !useEnergy(m, d.energy * (hasModule(m, 'power') ? WEAPONS.power.costK : 1))) continue;   // 供能模組：耗能 ×0.7
    gun.cd = d.interval * (m.rateMul ?? 1) * chipRateK(m);   // rateMul：無盡模式的射速強化
    // 飛彈 / 火箭一次好幾發，剩不夠就只射剩下的
    const n = Math.min(d.salvo ?? 1, gun.ammo);
    fire(m, slot, d, locks, aim, n);
    log('fire', { m: m.id, slot, w: d.id, n });
    // 飛彈逐發鎖定（BAL.relock）：要鎖定的飛彈射出去就把鎖定清掉，下一發要重新鎖
    if (BAL.relock !== 'off' && (d.kind === 'missile' || d.kind === 'vmissile' || d.kind === 'split')) { m.lockBreak = true; if (BAL.relock === 'after') m.relockUntil = G.now + gun.cd; }
    gun.ammo -= n;
    if (gun.ammo <= 0 && m.team === 'player') sfx.reload();
  }
}

function fire(m, slot, d, locks, aim, salvoN = d.salvo ?? 1) {
  const enemy = m.team !== 'player';
  const mz = muzzleOf(m, slot), f = facing(m), base = Math.atan2(f.x, f.z);
  const spreadK = m.spec.spreadMul * (m.parts.head.broken ? 2.5 : 1) * chipSpreadK(m) * burnSpreadK(m, slot);   // 那個掛點燒起來散布變大
  if (d.kind === 'saber') { startSwing(m, slot, d); return; }
  if (d.kind === 'pulse') { startPulse(m, slot, d); return; }
  if (d.kind === 'pile') { startPunch(m, slot, d); return; }
  if (d.kind === 'lance') { m.charge = BAL.lanceMode === 'thrust' ? { slot, d, phase: 'thrust', t: BAL.thrustT } : { slot, d, phase: 'ignite', t: BAL.lanceIgnite ?? d.ignite }; sfx.stow(); return; }   // 衝刺本身在 mech.js
  if (d.kind === 'flame') { flameCone(m, d, mz, base, spreadK); return; }
  if (d.kind === 'stream') { sprayFuel(m, d, mz, base, spreadK); return; }
  if (d.kind === 'napalm') { lobNapalm(m, d, mz, aim, f); return; }
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
  const n = salvoN;
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
  shots.push({ kind: 'bullet', g, wid: d.id, owner: m, team: m.team, x, y, z, dx, dz, speed, life: d.life * d.speed / speed, dmg: d.dmg * (m.dmgMul ?? 1) * chipDmgK(m) * powerDmgK(m, d), power: d.dmg, kb: d.kb, type: d.type, trail: d.trail, heavy: d.heavy, splash: d.splash });
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
  const vk = BAL.missileK;   // 飛彈 / 火箭速度倍率（敵我一樣，parts.js BAL）
  shots.push({ kind: d.kind, g, wid: d.id, owner: m, team: m.team, x, y, z, vk, vx: v.vx * vk, vy: v.vy, vz: v.vz * vk, speed: Math.hypot(v.vx, v.vz) || 1, life: d.life, age: 0,
    dmg: d.dmg * (m.dmgMul ?? 1) * chipDmgK(m), power: d.dmg, kb: 1.2, type: d.type, target, point, d, splash: d.splash });
}

// ---------- 火焰噴射器 ----------
// 每一下（interval）：扇形範圍內、看得到的敵機都吃一點傷害（化學、算爆風 → 繞得過盾、蟲群一次燒一片）+ 被打中的部位疊燃燒
function flameCone(m, d, mz, base, spreadK) {
  const fx = Math.sin(base), fz = Math.cos(base);
  const reach = Math.min(d.range, rayBlock(mz.x, mz.z, fx, fz, d.range));
  const arc = d.arc * Math.min(1.6, 0.7 + 0.3 * spreadK);
  // 火舌：一團一團往前噴、越遠越大，噴到牆就停
  for (let i = 0; i < 6; i++) {
    const a = base + R(-1, 1) * arc * 0.8, sp = R(11, 15);
    spawnGlow({ x: mz.x, y: mz.y, z: mz.z, vx: Math.sin(a) * sp, vy: R(-0.3, 1), vz: Math.cos(a) * sp,
      life: reach / sp * R(0.75, 1.05), s0: R(0.08, 0.14), s1: R(0.4, 0.6), ramp: RAMP.fire, drag: 0.4 });
  }
  if (Math.random() < 0.35) spawnPuff({ x: mz.x + fx * reach, y: mz.y + 0.3, z: mz.z + fz * reach, vx: 0, vy: R(0.8, 1.4), vz: 0, life: R(0.6, 1), s: R(0.25, 0.4), c0: 0x2a2a2e, c1: 0x4a4c52, drag: 0.6 });
  if (reach < d.range - 0.1) damageBuilding(mz.x + fx * reach, mz.y, mz.z + fz * reach, d.dmg * 0.5, fx, fz);
  m._flameN = (m._flameN ?? 0) + 1;
  if (m._flameN % 3 === 0) sfx.flame();
  const dmg = d.dmg * (m.dmgMul ?? 1) * chipDmgK(m);
  for (const o of mechs) {
    if (!o.alive || o.drop || o.team === m.team) continue;
    const ox = o.x - mz.x, oz = o.z - mz.z, dist = Math.hypot(ox, oz) || 0.01;
    if (dist > reach + o.r) continue;
    const ang = Math.atan2(ox, oz), da = Math.abs(Math.atan2(Math.sin(ang - base), Math.cos(ang - base)));
    if (da > arc + Math.atan2(o.r, dist)) continue;
    if (rayBlock(mz.x, mz.z, ox / dist, oz / dist, dist) < dist - o.r) continue;
    const r = att(m, d.id, () => hitMech(o, dmg, ox / dist, oz / dist, d.kb, 'chemical', null, d.dmg, true));
    if (r && o.alive) applyStatus(o, 'burn', { part: r.part, stacks: d.burn });
  }
}

// ---------- 汽油投射器 ----------
// 每一下（interval）：射出一顆燃料（拉長的發光方塊，前後幾顆接成一條火舌），自己沿拋物線飛、約 range 格落地
//   上半身轉 → 新的往新方向、舊的照舊飛 → 整條火舌甩出弧線；射手的速度帶一部分進去（邊跑邊噴會拖出去）
const FUEL_G = 14;
const FUEL_RAMP = rampOf(0xff8a2a);
function sprayFuel(m, d, mz, base, spreadK) {
  const a = base + R(-1, 1) * 0.04 * spreadK, T = d.range / d.speed * R(0.92, 1.05), y0 = Math.max(0.3, mz.y - 0.05);
  const vx = Math.sin(a) * d.speed + (m.vx ?? 0) * 0.4, vz = Math.cos(a) * d.speed + (m.vz ?? 0) * 0.4;
  const g = new THREE.Mesh(UNIT_BOX, glowMat(m.team === 'player' ? 0xffa040 : 0xff6a28));
  g.position.set(mz.x, mz.y, mz.z); scene.add(g);
  shots.push({ kind: 'fuel', g, wid: d.id, owner: m, team: m.team, x: mz.x, y: mz.y, z: mz.z, vx, vy: (0.5 * FUEL_G * T * T - y0) / T, vz, age: 0, T, d, wob: R(0.8, 1.25),
    dmg: d.dmg * (m.dmgMul ?? 1) * chipDmgK(m), power: d.dmg, kb: d.kb, type: 'chemical' });
  if (Math.random() < 0.5) spawnGlow({ x: mz.x, y: mz.y, z: mz.z, vx: vx * 0.25, vy: R(0, 0.6), vz: vz * 0.25, life: R(0.08, 0.14), s0: R(0.14, 0.2), s1: 0.05, ramp: RAMP.fire });
  m._flameN = (m._flameN ?? 0) + 1;
  if (m._flameN % 4 === 0) sfx.flame();
}
function stepFuel(s, i, dt) {
  const D = s.d;
  s.age += dt;
  s.vy -= FUEL_G * dt;
  const sp = Math.hypot(s.vx, s.vz) || 1, dx = s.vx / sp, dz = s.vz / sp, step = sp * dt;
  // 第一台被這一段路線碰到的敵機（2D，跟子彈一樣）
  let hit = null, ht = step;
  for (const o of mechs) {
    if (!o.alive || o.drop || o.team === s.team) continue;
    const ox = o.x - s.x, oz = o.z - s.z, t = ox * dx + oz * dz;
    if (t < -o.r || t > step + o.r) continue;
    const px = ox - dx * t, pz = oz - dz * t;
    if (px * px + pz * pz > o.r * o.r) continue;
    const tt = Math.max(0, t - Math.sqrt(o.r * o.r - px * px - pz * pz));
    if (tt < ht) { ht = tt; hit = o; }
  }
  const wall = rayBlock(s.x, s.z, dx, dz, ht);
  const splash = (x, y, z, n, nx, nz) => { for (let k = 0; k < n; k++) spawnGlow({ x, y, z, vx: -nx * R(0.5, 2) + R(-1.5, 1.5), vy: R(0.5, 2.5), vz: -nz * R(0.5, 2) + R(-1.5, 1.5), life: R(0.2, 0.4), s0: R(0.12, 0.22), s1: 0.02, ramp: RAMP.fire, drag: 1 }); };
  if (wall < ht) {
    s.x += dx * wall; s.z += dz * wall;
    splash(s.x, s.y, s.z, 3, dx, dz);
    damageBuilding(s.x, s.y, s.z, s.dmg * 0.6, dx, dz);
    if (Math.random() < 0.3) addPuddle(s.x - dx * 0.5, s.z - dz * 0.5, D, s.team);   // 沿著牆流下來
    kill(i); return;
  }
  s.x += dx * ht; s.z += dz * ht; s.y += s.vy * dt;
  if (hit) {
    const r = att(s.owner, s.wid, () => hitMech(hit, s.dmg, dx, dz, s.kb, 'chemical', null, s.power));
    if (r && hit.alive) applyStatus(hit, 'burn', { part: r.part, stacks: D.burn });
    splash(s.x, Math.max(0.4, s.y), s.z, 2, dx, dz);
    if (Math.random() < 0.12 && !hit.fly) addPuddle(hit.x + R(-0.4, 0.4), hit.z + R(-0.4, 0.4), D, s.team);   // 滴到腳下
    kill(i); return;
  }
  if (s.y <= 0.06) { splash(s.x, 0.1, s.z, 2, dx, dz); addPuddle(s.x, s.z, D, s.team); kill(i); return; }
  // 火舌的樣子：沿著速度拉長，越飛越粗（一顆接一顆連成一條）
  const k = Math.min(1, s.age / s.T), w = D.size * (1 + 2.6 * k) * s.wob;
  s.g.position.set(s.x, s.y, s.z);
  s.g.rotation.set(0, Math.atan2(dx, dz), 0);
  s.g.rotateX(Math.atan2(-s.vy, sp));
  s.g.scale.set(w, w * 0.8, Math.max(0.5, sp * D.interval * 1.4));
  // 外面一圈翻滾的火（越遠越散、越大），讓火舌不像雷射
  for (let n = 0; n < (k > 0.35 ? 2 : 1); n++) {
    const off = 0.08 + 0.35 * k;
    spawnGlow({ x: s.x + R(-off, off), y: s.y + R(-off, off) * 0.6, z: s.z + R(-off, off), vx: s.vx * 0.2 + R(-0.8, 0.8), vy: R(0.4, 1.6), vz: s.vz * 0.2 + R(-0.8, 0.8),
      life: R(0.12, 0.28), s0: w * R(1.1, 1.8), s1: 0, ramp: k > 0.45 ? RAMP.fire : FUEL_RAMP, drag: 1.5 });
  }
  if (k > 0.5 && Math.random() < 0.08) spawnPuff({ x: s.x, y: s.y + 0.3, z: s.z, vx: 0, vy: R(0.8, 1.4), vz: 0, life: R(0.5, 0.8), s: R(0.18, 0.3), c0: 0x2a2a2e, c1: 0x4a4c52, drag: 0.6 });
}
// 油灘：附近已經有自己這邊的油灘 → 續燒、稍微變大；沒有 → 開一小灘新的
function addPuddle(x, z, D, team) {
  if (isBlock(x, z)) return;
  for (const p of fireZones) {
    if (!p.puddle || p.team !== team || Math.hypot(p.x - x, p.z - z) > p.r * 0.8) continue;
    p.t = Math.max(p.t, D.puddleT);
    p.r = Math.min(D.puddleMax, p.r + 0.03); p.ring.scale.setScalar(p.r);
    return;
  }
  spawnZone(x, z, D.puddle, D.puddleT, 'burn', D.puddleBurn, team, { puddle: true, fires: 1 });
}

// ---------- 燒夷彈 ----------
// 拋物線 0.75 秒落到瞄準點（最遠 d.range），落地：小爆炸 + 火海（d.zone 半徑、燒 d.zoneT 秒）
const NAPALM_T = 0.75, LOB_G = 22;
const ZONE_GEO = new THREE.CircleGeometry(1, 28);
export const fireZones = [];
function lobNapalm(m, d, mz, aim, f) {
  let tx = aim?.x ?? m.x + f.x * 9, tz = aim?.z ?? m.z + f.z * 9;
  const dx = tx - m.x, dz = tz - m.z, dl = Math.hypot(dx, dz);
  if (dl > d.range) { tx = m.x + dx / dl * d.range; tz = m.z + dz / dl * d.range; }
  const g = new THREE.Group();
  const acid = d.status === 'corrode';
  const body = new THREE.Mesh(UNIT_BOX, new THREE.MeshLambertMaterial({ color: acid ? 0x3a5a18 : 0x5a3a24 })); body.scale.setScalar(d.size);
  const glow = new THREE.Mesh(UNIT_BOX, glowMat(acid ? 0x8ae040 : 0xff7a30)); glow.scale.setScalar(d.size * 1.5);
  g.add(body, glow); g.position.set(mz.x, mz.y, mz.z); scene.add(g);
  const T = d.lobT ?? NAPALM_T;
  // 落點警示圈（榴彈砲）：地上一圈紅色，越接近落地越亮
  let mark = null;
  if (d.mark) { mark = new THREE.Mesh(ZONE_GEO, addMat(0xff3020, 0.12)); mark.rotation.x = -Math.PI / 2; mark.position.set(tx, 0.07, tz); mark.scale.setScalar(d.splash); scene.add(mark); }
  shots.push({ kind: 'napalm', g, wid: d.id, mark, t: 0, T, owner: m, team: m.team, x: mz.x, y: mz.y, z: mz.z, vx: (tx - mz.x) / T, vz: (tz - mz.z) / T,
    vy: (0.2 - mz.y + 0.5 * LOB_G * T * T) / T, d, dmg: d.dmg * (m.dmgMul ?? 1) * chipDmgK(m), power: d.dmg, kb: 0.6, type: 'chemical', splash: d.splash });
  smoke(mz.x, mz.y, mz.z, 2, 0.7, 0x8a8c92);
  acid ? sfx.stow() : sfx.missile();
}
function stepNapalm(s, i, dt) {
  s.vy -= LOB_G * dt;
  s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt;
  const D = s.d, acid = D.status === 'corrode';
  if (Math.random() < 0.7) spawnGlow({ x: s.x, y: s.y, z: s.z, vx: 0, vy: 0.3, vz: 0, life: 0.3, s0: 0.16, s1: 0, ramp: acid ? RAMP.acid : RAMP.fire });
  if (s.mark) { s.t += dt; s.mark.material.opacity = 0.12 + 0.4 * Math.min(1, s.t / s.T) ** 2; }
  if (s.y > 0.2) { s.g.position.set(s.x, s.y, s.z); s.g.rotation.x += dt * 9; return; }
  if (acid) acidSplash(s); else blast(s, s.x, 0.3, s.z, null);
  if (D.zone) spawnZone(s.x, s.z, D.zone, D.zoneT, D.status ?? 'burn', D.burn, s.team);
  kill(i);
}
// 酸液彈落地：不爆炸，濺開一圈酸（範圍內的敵機吃一點化學傷害、軀幹被腐蝕）
function acidSplash(s) {
  for (let k = 0; k < 22; k++) { const a = Math.random() * 6.28, v = R(2, 5); spawnGlow({ x: s.x, y: 0.3, z: s.z, vx: Math.cos(a) * v, vy: R(1.5, 4), vz: Math.sin(a) * v, life: R(0.35, 0.7), s0: R(0.12, 0.2), s1: 0.03, ramp: RAMP.acid, g: 14, drag: 0.4 }); }
  smoke(s.x, 0.3, s.z, 3, 1, 0x5a6a3a);
  sfx.hit();
  for (const o of mechs) {
    if (!o.alive || o.drop || o.team === s.team) continue;
    const dx = o.x - s.x, dz = o.z - s.z, dist = Math.hypot(dx, dz);
    if (dist > s.splash + o.r) continue;
    att(s.owner, s.wid, () => hitMech(o, s.dmg * 0.5, dx / (dist || 1), dz / (dist || 1), 0.3, 'chemical', 'torso', s.dmg * 0.3, true));
    if (o.alive) applyStatus(o, 'corrode', { part: 'torso', stacks: 1 });
  }
}
// 地上一片會持續上狀態的區域：status = 'burn'（火海）/ 'corrode'（酸液）；每秒對裡面的敵機（team 以外）的腳疊 stacks 層
const ZONE_LOOK = { burn: { color: 0xff5a18, ramp: 'fire' }, corrode: { color: 0x6ac828, ramp: 'acid' } };
const ACID_STAIN = [0x0c2004, 0x102808];   // 酸蝕過的地：偏綠的壓暗
export function spawnZone(x, z, r, t, status, stacks, team, opt = {}) {
  const L = ZONE_LOOK[status] ?? ZONE_LOOK.burn;
  const ring = new THREE.Mesh(ZONE_GEO, addMat(L.color, 0.3));
  ring.rotation.x = -Math.PI / 2; ring.position.set(x, 0.06, z); ring.scale.setScalar(r); scene.add(ring);
  // 火海的火：幾個點分散在圓裡（酸液沒有火，靠下面冒泡）
  if (status === 'burn') for (let k = 0; k < (opt.fires ?? 6); k++) { const a = Math.random() * 6.28, rr = Math.sqrt(Math.random()) * r * 0.85; burnAt(x + Math.cos(a) * rr, 0.15, z + Math.sin(a) * rr, t * R(0.8, 1), 0.8); }
  fireZones.push({ x, z, r, t, burn: stacks, status, ramp: RAMP[L.ramp], team, ring, acc: 0, puddle: !!opt.puddle });
  scorch(x, z, r * 0.85, status === 'corrode' ? ACID_STAIN : undefined, false);   // 地上留下燒過 / 被酸蝕過的痕跡
}
// 火海：每 0.2 秒點燃裡面的敵機的腳（雜魚整台算一個部位；會飛的燒不到）
function updateFireZones(dt) {
  for (let i = fireZones.length - 1; i >= 0; i--) {
    const z = fireZones[i];
    z.t -= dt; z.acc += dt;
    z.ring.material.opacity = 0.3 * Math.min(1, z.t) * (0.85 + 0.15 * Math.sin(z.t * 17));
    if (Math.random() < dt * (z.status === 'corrode' ? 16 : 10)) { const a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * z.r, acid = z.status === 'corrode'; spawnGlow({ x: z.x + Math.cos(a) * r, y: 0.12, z: z.z + Math.sin(a) * r, vx: 0, vy: acid ? R(0.3, 0.8) : R(1.2, 2.4), vz: 0, life: R(0.3, 0.6), s0: acid ? R(0.1, 0.18) : R(0.18, 0.3), s1: 0, ramp: z.ramp, drag: 1 }); }
    while (z.acc >= 0.2) {
      z.acc -= 0.2;
      for (const o of mechs) {
        if (!o.alive || o.drop || o.fly || o.team === z.team) continue;
        if (Math.hypot(o.x - z.x, o.z - z.z) > z.r + o.r * 0.5) continue;
        applyStatus(o, z.status ?? 'burn', { part: o.parts.legs && !o.parts.legs.broken ? 'legs' : 'torso', stacks: z.burn * 0.2 });
      }
    }
    if (z.t <= 0) { scene.remove(z.ring); z.ring.material.dispose(); fireZones.splice(i, 1); }
  }
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
      const r = att(m, d.id, () => hitMech(o, d.dmg * (m.dmgMul ?? 1) * chipDmgK(m) * powerDmgK(m, d), nx, nz, d.kb, 'energy', null, d.dmg));
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

// ---------- 脈衝光束步槍 ----------
// 線 = 從槍口沿上半身正前方（跟瞄準雷射一樣）：停在第一面牆或第一台敵機；充能時細細一條在閃，照射時粗、亮
// 判定每 PULSE_TICK 秒一次（跟幀率無關），總傷害平均分到每一下；照射中上半身轉速 ×turnK（driveMech 看 m.beamTurnK）
const PULSE_TICK = 0.05, livePulses = [];
function startPulse(m, slot, d) {
  m.pulses ??= {}; m.pulseL ??= {};
  const L = m.pulseL[slot] ??= makeLaser(DMG_TYPES.energy.hex);
  const n = Math.round(d.dur / PULSE_TICK);
  const P = { m, slot, d, L, t: -d.charge, acc: 0, n: 0, per: d.dmg / n * (m.dmgMul ?? 1) * chipDmgK(m), power: d.dmg / n };
  m.pulses[slot] = P; livePulses.push(P);
  sfx.beam();
}
// 從 (x, z) 往 (dx, dz) 的射線：第一台敵機（圓）在多遠、是哪台
function rayMech(m, x, z, dx, dz, maxLen) {
  let best = null, bt = maxLen;
  for (const o of mechs) {
    if (!o.alive || o.drop || o.team === m.team) continue;
    const ox = o.x - x, oz = o.z - z, t = ox * dx + oz * dz;
    if (t < -o.r || t > bt + o.r) continue;
    const px = ox - dx * t, pz = oz - dz * t, h = o.r * o.r - px * px - pz * pz;
    if (h < 0) continue;
    const tt = Math.max(0, t - Math.sqrt(h));
    if (tt < bt) { bt = tt; best = o; }
  }
  return { o: best, t: bt };
}
function updatePulses(m, dt) {
  let any = false;
  for (const slot in m.pulses) {
    const P = m.pulses[slot], d = P.d;
    P.t += dt;
    if (!m.alive || slotBroken(m, slot) || P.t >= d.dur) { P.done = true; P.L.g.visible = false; delete m.pulses[slot]; continue; }
    any = P.t >= 0;
    const mz = muzzleOf(m, slot), f = facing(m);
    const wall = rayBlock(mz.x, mz.z, f.x, f.z, d.range), hit = rayMech(m, mz.x, mz.z, f.x, f.z, wall);
    const len = hit.o ? hit.t : wall, ex = mz.x + f.x * len, ez = mz.z + f.z * len;
    if (P.t < 0) { setLaser(P.L, mz.x, mz.z, f.x, f.z, len, mz.y, 0.2 + Math.random() * 0.35, 0.02); continue; }   // 充能
    setLaser(P.L, mz.x, mz.z, f.x, f.z, len, mz.y, 0.9, 0.08 + Math.random() * 0.03);
    if (Math.random() < 0.6) spawnGlow({ x: ex, y: mz.y, z: ez, vx: -f.x * 2, vy: R(0, 2), vz: -f.z * 2, life: 0.15, s0: 0.14, s1: 0, ramp: RAMP.armor });
    P.acc += dt;
    while (P.acc >= PULSE_TICK) {
      P.acc -= PULSE_TICK; P.n++;
      if (hit.o) {
        const r = att(m, d.id, () => hitMech(hit.o, P.per, f.x, f.z, d.kb, 'energy', null, P.power));
        sparks(ex, mz.y, ez, 0x60e0ff, 3, -f.x, -f.z);
        if (P.n % 3 === 0) { hitSparks(ex, mz.y, ez, -f.x, -f.z, 0.7, r && r.eff < 1); r && r.eff < 1 ? sfx.armorHit() : sfx.hit(); }
      } else if (wall < d.range - 0.05) {
        damageBuilding(ex, mz.y, ez, P.per, f.x, f.z);
        if (P.n % 4 === 0) { hitSparks(ex, mz.y, ez, -f.x, -f.z, 0.5); if (!isBuilding(ex + f.x * 0.05, ez + f.z * 0.05)) wallMark(wallFace(ex, ez, f.x, f.z), mz.y, 0.18); }
      }
    }
  }
  m.beamTurnK = any ? Object.values(m.pulses)[0]?.d.turnK ?? 1 : 1;
}
// 機體死掉 / 被移除時光束還亮著：每幀收掉
function sweepPulses() {
  for (let i = livePulses.length - 1; i >= 0; i--) {
    const P = livePulses[i];
    if (P.done || !P.m.alive) { P.L.g.visible = false; if (P.m.pulses) delete P.m.pulses[P.slot]; livePulses.splice(i, 1); }
  }
}

// ---------- 打樁拳 ----------
// 蓄力 windup 秒（拳頭發光、整台往前踏一點）→ 一拳：拳頭往前 reach 格內的第一台敵機（被牆擋就打牆）
// 打哪個部位：拳頭落在對方身體的哪一側（對方本地座標左右偏 0.28 格以上）就打那一側的手臂；正中間 / 那隻手沒了 → 軀幹（照方向打折）
function startPunch(m, slot, d) {
  const f = facing(m);
  m.punch = { slot, d, t: d.windup };
  m.vx += f.x * d.lunge; m.vz += f.z * d.lunge;
  sfx.stow();
}
function updatePunch(m, dt) {
  const P = m.punch, d = P.d;
  P.t -= dt;
  const mz = muzzleOf(m, P.slot), f = facing(m);
  if (P.t > 0) { spawnGlow({ x: mz.x, y: mz.y, z: mz.z, vx: R(-1, 1), vy: R(0, 1), vz: R(-1, 1), life: 0.14, s0: 0.1, s1: 0, ramp: RAMP.spark }); return; }
  m.punch = null;
  if (!m.alive || slotBroken(m, P.slot)) return;
  const enemy = m.team !== 'player';
  const wall = rayBlock(mz.x, mz.z, f.x, f.z, d.reach + 0.3), hit = rayMech(m, mz.x, mz.z, f.x, f.z, Math.min(wall, d.reach));
  muzzleFlash(mz.x + f.x * 0.3, mz.y, mz.z + f.z * 0.3, 0xffc060, 1.3);
  smoke(mz.x, mz.y, mz.z, 3, 0.8, 0x8a8c92);
  sfx.shotgun();
  if (hit.o) {
    const o = hit.o, px = mz.x + f.x * hit.t - o.x, pz = mz.z + f.z * hit.t - o.z;
    const s = Math.sin(o.torsoYaw), c = Math.cos(o.torsoYaw), lx = (px * c - pz * s) / (o.k ?? 1);   // 拳頭落點在對方本地的左右（+x = 左手）
    let part = Math.abs(lx) > 0.28 ? (lx > 0 ? 'armL' : 'armR') : 'torso';
    if (o.grunt || !o.parts[part] || o.parts[part].broken) part = 'torso';
    let dmg = d.dmg * (m.dmgMul ?? 1) * chipDmgK(m);
    if (part === 'torso' && !o.grunt) { const a = Math.abs(angleDiff(o.torsoYaw, Math.atan2(-f.x, -f.z))); dmg *= a < 0.7 ? 0.6 : a < 2.27 ? 0.85 : 1.35; }
    const r = att(m, d.id, () => hitMech(o, dmg, f.x, f.z, d.kb, 'kinetic', part, d.dmg));
    const hx = mz.x + f.x * hit.t, hz = mz.z + f.z * hit.t;
    hitSparks(hx, mz.y, hz, -f.x, -f.z, 2.6, r && r.eff < 1);
    explosion(hx, mz.y, hz, 0.3);
    r && r.eff < 1 ? sfx.armorHit() : sfx.hit();
    sfx.crash();
    addTrauma(enemy ? (o.team === 'player' ? 0.45 : 0) : 0.35);
  } else if (wall < d.reach + 0.3) {
    const hx = mz.x + f.x * wall, hz = mz.z + f.z * wall;
    damageBuilding(hx, mz.y, hz, d.dmg * 1.5, f.x, f.z);
    hitSparks(hx, mz.y, hz, -f.x, -f.z, 1.6);
    if (!isBuilding(hx + f.x * 0.05, hz + f.z * 0.05)) wallMark(wallFace(hx, hz, f.x, f.z), mz.y, 0.5);
    sfx.crash();
    if (!enemy) addTrauma(0.2);
  } else for (let i = 0; i < 5; i++) spawnPuff({ x: mz.x + f.x * d.reach * i / 5, y: mz.y, z: mz.z + f.z * d.reach * i / 5, life: 0.25, s: 0.1, c0: 0xc8c8c8, c1: 0x6a6a6a, drag: 2 });   // 揮空
}

// ---------- 命中 ----------
// 火花依剋制關係：被裝甲擋下 = 藍白、剋制 = 更多更大
function impact(s, o, nx, nz, dmg, forced) {
  const r = att(s.owner, s.wid, () => hitMech(o, dmg, nx, nz, s.kb, s.type, forced, s.power ?? dmg));
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
  if (y < 1.8) scorch(x, z, Math.min(1.8, 0.5 + (s.splash ?? 1) * (shell ? 0.6 : 0.4)));   // 地上留一塊焦痕、噴土
  for (const o of mechs) {
    if (!o.alive || o.drop || o.team === s.team || o === direct) continue;
    const dx = o.x - x, dz = o.z - z, dist = Math.hypot(dx, dz);
    if (dist > s.splash + o.r) continue;
    const fall = shell ? 1 - 0.5 * Math.max(0, dist - o.r) / s.splash : 1;   // 砲彈爆風越外圈越弱；飛彈維持原樣
    att(s.owner, s.wid, () => hitMech(o, s.dmg * 0.4 * fall, dx / (dist || 1), dz / (dist || 1), shell ? 3 : 0.6, s.type, 'torso', (s.power ?? s.dmg) * 0.4 * fall, true));
  }
}

export function updateShots(dt) {
  sweepPulses();
  for (let i = shots.length - 1; i >= 0; i--) {
    const s = shots[i];
    if (s.kind === 'bullet') stepBullet(s, i, dt);
    else if (s.kind === 'napalm') stepNapalm(s, i, dt);
    else if (s.kind === 'fuel') stepFuel(s, i, dt);
    else stepMissile(s, i, dt);
  }
  updateFireZones(dt);
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
    if (!isBuilding(s.x + s.dx * 0.05, s.z + s.dz * 0.05)) wallMark(wallFace(s.x, s.z, s.dx, s.dz), s.y, s.splash ? 0.9 : s.heavy ? 0.6 : Math.min(0.45, 0.12 + Math.sqrt(s.dmg) * 0.06));   // 打不壞的牆：燻黑
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
    const v = Math.hypot(s.vx, s.vy, s.vz) || 1, sp = Math.min(d.maxSpeed * (s.vk ?? 1), v + d.accel * (s.vk ?? 1) * dt);
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
    for (const m of mechs) if (m.alive && !m.drop && !m.swarm && m.team !== s.team && s.y < 2.2 && Math.hypot(m.x - s.x, m.z - s.z) < m.r + 0.2) direct = m;
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
    s.speed = Math.min((d.maxSpeed ?? 20) * (s.vk ?? 1), s.speed + (d.accel ?? 10) * (s.vk ?? 1) * dt);
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
      if (m.swarm && s.kind !== 'rocket') continue;   // 飛彈從蟲群頭上掠過（鎖不到、也撞不到；火箭照樣撞）
      if (Math.hypot(m.x - (s.x + dx * step), m.z - (s.z + dz * step)) < m.r + 0.1) { hit = m; break; }
    }
    s.x += dx * step; s.z += dz * step;
    trail(s);
    if (hit) { impact(s, hit, dx, dz, s.dmg); blast(s, s.x, s.y, s.z, hit); kill(i); return; }
    if (isBlock(s.x, s.z) && !isBuilding(s.x, s.z)) wallMark(wallFace(s.x, s.z, dx, dz), s.y, 0.9);   // 炸在打不壞的牆上：燻黑一大片
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

function kill(i) { const s = shots[i]; scene.remove(s.g); if (s.mark) { scene.remove(s.mark); s.mark.material.dispose(); } shots.splice(i, 1); }
export function clearShots() {
  while (shots.length) kill(shots.length - 1);
  for (const z of fireZones) { scene.remove(z.ring); z.ring.material.dispose(); }
  fireZones.length = 0;
}
