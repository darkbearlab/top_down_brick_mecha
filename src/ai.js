// ---------- 試玩場的敵機 ----------
// 每台隨機挑一套配裝（parts.js ENEMY_PRESETS），用跟玩家同一套物理和武器
// 距離依武器決定：有劍 / 霰彈就貼近、有狙擊就拉遠、其他保持中距離繞圈
// 看到玩家的加農砲 / 飛彈飛過來會往旁邊噴開；狙擊開槍前會先亮紅色雷射預告
// 背部武器跟玩家一樣要先架起來（toggleReady）：用得上才架、架一陣子或換彈就收回；只有架著飛彈才會鎖定
// 避牆：移動前用三條射線探路（越快探越遠）、速度朝牆而且來不及停就先剎車；推進前確認噴出去的方向夠空
// 被打爆後過幾秒，新的一台從天上降落（地上先出現紅圈，站在下面會被砸）
import * as THREE from 'three';
import { G, addMat, addTrauma, angleDiff, scene } from './core.js';
import { randomOpenSpot, rayBlock } from './arena.js';
import { headStats } from './sensors.js';
import { BOOST_DV, BOOST_PUSH, BOOST_TIME, ENEMY_COLORS, activeSlot, boostDirOf, boostKOf, legK, damagePart, facing, makeMech, muzzleOf, removeMech, slotBroken, toggleReady, tryBoost, wantsLock } from './mech.js';
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
  const D = opts.diff ?? AI.diff;   // 每台可以有自己的難度（王牌 vs 雜魚：王牌強敵、雜魚普通）
  const e = makeMech({ team: opts.team ?? 'enemy', colors: opts.colors ?? ENEMY_COLORS, loadout: P, x: p.x, z: p.z, yaw: Math.atan2(player.x - p.x, player.z - p.z), hpMul: D.hp,
    grunt: opts.grunt ? { hp: P.hp } : null });
  e.diff = D;
  e.dmgMul = D.dmg;
  e.seed = Math.random() * 10;
  e.guns = makeGuns(P);
  e.preset = P;
  const ws = SLOTS.map(s => P[s]).filter(Boolean);
  e.ai = {
    strafe: Math.random() < 0.5 ? -1 : 1, t: 1, burst: 0, rest: 1 + Math.random(), reposition: 3 + Math.random() * 3, lockT: 0, snipeT: 0, hold: { L: Math.random(), R: Math.random() },
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
const reachOf = d => d.kind === 'saber' ? d.reach + 1.2 : d.kind === 'bullet' || d.kind === 'beam' ? d.speed * d.life : d.kind === 'rocket' ? 26 : 18;   // 敵人子彈慢，但飛得一樣久 → 射程一樣

export function updateEnemy(e, dt, player) {
  if (!e.alive) return;
  if (e.drop) { if (updateDrop(e, dt, player)) return; }
  const A = e.ai, DF = e.diff ?? AI.diff;
  const dx = player.x - e.x, dz = player.z - e.z, dist = Math.hypot(dx, dz) || 1;
  const nx = dx / dist, nz = dz / dist;
  const los = rayBlock(e.x, e.z, nx, nz, dist) >= dist - 0.9;

  // 移動：遠了靠近、近了後退，中間繞圈
  A.t -= dt;
  if (A.t <= 0) { A.t = 2 + Math.random() * 2.5; if (Math.random() < 0.5) A.strafe *= -1; }
  let mx, mz;
  if (!player.alive) { mx = 0; mz = 0; }
  else if (dist > A.want + 4 || !los) { mx = nx; mz = nz; }
  else if (A.lineBlockedT > 0.4) {
    // 看得到但槍口被轉角擋住（槍口在身體側邊）：往被擋的反方向橫移、同時靠近一點，讓出射線
    // 左邊掛點在機體本地 +x = 世界 (nz, -nx)；往被擋那一邊的反方向移
    const s2 = A.blockSide === 'L' ? -1 : 1;
    const lx = nz, lz = -nx;
    mx = lx * s2 * 0.9 + nx * 0.4; mz = lz * s2 * 0.9 + nz * 0.4;
  }
  else if (dist < A.want - 2) { mx = -nx; mz = -nz; }
  else { mx = -nz * A.strafe + nx * 0.15; mz = nx * A.strafe + nz * 0.15; }
  ({ mx, mz } = steer(e, mx, mz));

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
  if (boost && !DF.dodge && !(A.reposition > 3.9)) boost = false;
  if (boost && e.energy > 55) {
    // 噴出去的方向要夠空，不然換反方向 / 斜的，都不行就不噴（推進撞牆是以前的頭號死因）
    const d = Math.hypot(bx, bz) || 1, ux = bx / d, uz = bz / d;
    for (const [cx, cz] of [[ux, uz], [ux * 0.7 - uz * 0.7, uz * 0.7 + ux * 0.7], [ux * 0.7 + uz * 0.7, uz * 0.7 - ux * 0.7], [-ux, -uz]]) {
      const bd = boostDirOf(e, cx, cz), len = boostLen(e, bd.x, bd.z);
      if (clearAhead(e, bd.x, bd.z, len) >= len) { if (tryBoost(e, cx, cz)) A.lastBoost = { x: e.x, z: e.z, len, t: G.now }; break; }
    }
  }
  e.drive = { mx, mz };

  // 瞄準：稍微預判
  const lead = dist / 18 * 0.5;
  e.aimYaw = Math.atan2(player.x + player.vx * lead - e.x, player.z + player.vz * lead - e.z) + Math.sin(G.now * 1.7 + e.seed) * DF.err;
  const canShoot = los && player.alive && !AI.passive;
  const onTarget = Math.abs(angleDiff(e.torsoYaw, e.aimYaw)) < 0.14 && canShoot;
  // 鎖定玩家（給飛彈用）：在範圍內、看得到就慢慢鎖上
  const H = headStats(e);   // 頭受損鎖定也會變差（sensors.js）
  if (e.lockBreak) { A.lockT = 0; e.lockBreak = false; }   // 失衡：鎖定被打斷
  updateReadyChoice(e, dt, dist, canShoot, player);
  // 長距鎖定頭：看不到（隔著牆）也能靠雷達鎖
  const lockable = player.alive && !AI.passive && (los || (H.radarLock && dist < H.radar));
  A.lockT = lockable && wantsLock(e) && dist < H.lockRange && !e.parts.head.broken ? A.lockT + dt : Math.max(0, A.lockT - dt * 2);
  const locks = A.lockT >= H.lockTime * DF.lock ? [player] : [];

  // 手臂：連射武器一陣一陣打；狙擊先亮雷射；劍貼近才揮；飛彈有鎖定才射
  const trig = { L: false, R: false };
  if (A.burst > 0) A.burst -= dt;
  else { A.rest -= dt; if (A.rest <= 0 && onTarget) { A.burst = 0.8; A.rest = (1 + Math.random() * 1.2) * DF.rest; } }
  let laserSlot = null, anyClear = false, blockedSide = null;
  for (const side of ['L', 'R']) {
    const slot = activeSlot(e, side), g = e.guns[slot];
    if (!g || slotBroken(e, slot) || e.deployT[side] > 0) continue;
    const d = g.def;
    // 這把的射線會不會馬上被擋住（轉角游擊時槍口常常在牆後）
    const clear = !canShoot || lineClear(e, slot, d, player);
    if (canShoot) { if (clear) anyClear = true; else blockedSide = side; }
    const inRange = clear && dist < reachOf(d);
    let t = false;
    if (d.kind === 'saber') t = inRange && canShoot && Math.abs(angleDiff(e.torsoYaw, e.aimYaw)) < 0.4;
    else if (d.kind === 'missile' || d.kind === 'split') t = canShoot && clear && locks.length > 0 && Math.random() < dt * 1.6 / DF.rest;
    else if (d.kind === 'vmissile') t = clear && locks.length > 0 && dist > 6 && Math.random() < dt * 1.2 / DF.rest;
    else if (d.speed > 50) {
      // 狙擊：瞄 0.8 秒（紅色雷射）才開槍
      if (onTarget && inRange && g.cd <= 0 && g.reloadT <= 0) { A.snipeT += dt; laserSlot = slot; if (A.snipeT >= 0.8) { t = true; A.snipeT = 0; } }
      else A.snipeT = Math.max(0, A.snipeT - dt);
    } else if (d.interval >= 1) t = onTarget && inRange && Math.random() < dt * 1.2 / DF.rest;
    else t = A.burst > 0 && onTarget && inRange;
    trig[side] = t;
  }
  // 連續一陣子所有武器都被擋 → 移動時去讓出射線
  A.lineBlockedT = canShoot && !anyClear && blockedSide ? (A.lineBlockedT ?? 0) + dt : 0;
  if (blockedSide) A.blockSide = blockedSide;
  updateGuns(e, trig, dt, locks, { x: player.x, z: player.z });
  if (laserSlot) {
    const mz = muzzleOf(e, laserSlot), f = facing(e);
    const len = Math.min(rayBlock(mz.x, mz.z, f.x, f.z, 30), dist);
    setLaser(e.laser, mz.x, mz.z, f.x, f.z, len, mz.y, 0.3 + A.snipeT * 0.8, 0.04 + A.snipeT * 0.05);
  } else e.laser.g.visible = false;
}

// ---------- 背部武器要不要架起來 ----------
// 用得上（飛彈：看得到、在鎖定距離內；加農砲：看得到、打得到）才架；架著一陣子後多半收回來用手臂
// 手上是劍而且已經貼近：一定用劍
// 射線檢查：從槍口沿著上半身正前方，到目標的距離內有沒有方塊
//   子彈 / 光束：整段要通；直射 / 分裂飛彈：轉得慢，前面 5 格要空；垂直飛彈越過掩體、劍是近戰，不用管
function lineClear(e, slot, d, tgt) {
  if (d.kind === 'saber' || d.kind === 'vmissile') return true;
  const mz = muzzleOf(e, slot), f = facing(e);
  const md = Math.hypot(tgt.x - mz.x, tgt.z - mz.z);
  const need = d.kind === 'missile' || d.kind === 'split' ? Math.min(md - 0.5, 5) : md - tgt.r;
  return need <= 0 || rayBlock(mz.x, mz.z, f.x, f.z, need) >= need;
}
function backUseful(e, slot, d, dist, canShoot, head, tgt) {
  // 垂直飛彈 + 長距鎖定頭：隔著牆也能鎖、越過掩體打
  if (d.kind === 'vmissile' && head.radarLock && tgt.alive && !AI.passive) return dist > 6 && dist < head.lockRange;
  if (!canShoot || !lineClear(e, slot, d, tgt)) return false;
  if (d.kind === 'missile' || d.kind === 'split') return dist < head.lockRange;
  if (d.kind === 'vmissile') return dist > 5 && dist < head.lockRange;
  return dist < reachOf(d);
}
function updateReadyChoice(e, dt, dist, canShoot, tgt) {
  const A = e.ai;
  for (const side of ['L', 'R']) {
    const back = e.guns['back' + side], arm = e.guns['arm' + side];
    if (!back || slotBroken(e, 'back' + side) || !arm || slotBroken(e, 'arm' + side)) continue;   // 沒得選（沒手臂武器的會自動架著）
    if (e.deployT[side] > 0) continue;
    const melee = arm.def.kind === 'saber' && dist < 5;
    if (e.ready[side] && melee) { toggleReady(e, side); A.hold[side] = 1.5; continue; }
    if ((A.hold[side] -= dt) > 0) continue;
    const useful = back.reloadT <= 0 && backUseful(e, 'back' + side, back.def, dist, canShoot, headStats(e), tgt);
    if (!e.ready[side]) {
      if (useful && !melee && Math.random() < 0.6) { toggleReady(e, side); A.hold[side] = 2.5 + Math.random() * 2; }
      else A.hold[side] = 0.6 + Math.random() * 0.8;
    } else if (!useful || Math.random() < 0.6) { toggleReady(e, side); A.hold[side] = 1.5 + Math.random() * 1.5; }
    else A.hold[side] = 1 + Math.random();
  }
}

// ---------- 避牆 ----------
// 三條射線（中間 + 左右肩寬）裡最短的那條：機體整台過不過得去
function clearAhead(e, ux, uz, len) {
  const o = e.r * 0.8;
  return Math.min(rayBlock(e.x, e.z, ux, uz, len), rayBlock(e.x - uz * o, e.z + ux * o, ux, uz, len), rayBlock(e.x + uz * o, e.z - ux * o, ux, uz, len));
}
const hoverOf = e => e.spec.legs.type === 'hover';
// 往 (ux, uz) 推進會滑多遠：噴射段 + 從噴射速度剎回極速的距離 + 餘裕（原本就往那邊跑的速度會疊上去）
// 剎車：一般腳超速時用整個抓地力（約 26），懸浮只有約 7；腳受傷都更差
function boostLen(e, ux, uz) {
  const k = boostKOf(e), along = Math.max(0, e.vx * ux + e.vz * uz);
  const v0 = along + BOOST_DV * k + BOOST_PUSH * k * BOOST_TIME, vmax = e.spec.vmax;
  const decel = (hoverOf(e) ? 7 : 26) * legK(e);
  return v0 * BOOST_TIME + Math.max(0, v0 * v0 - vmax * vmax) / (2 * decel) + 1.5;
}
// 想往 (mx, mz) 走：前面有牆就轉開（越快看越遠）；速度朝著牆、照現在的剎車來不及停就先往反方向踩
function steer(e, mx, mz) {
  const ml = Math.hypot(mx, mz), v = Math.hypot(e.vx, e.vz), A = e.ai;
  const decel = (hoverOf(e) ? 6 : 13) * legK(e);
  if (v > 2) {
    const ux = e.vx / v, uz = e.vz / v, stop = v * v / (2 * decel) + 0.6;
    if (clearAhead(e, ux, uz, stop + 0.5) < stop) return { mx: -ux, mz: -uz };
  }
  if (ml < 0.1) return { mx, mz };
  const look = 1.4 + v * (hoverOf(e) ? 0.75 : 0.45);
  const base = Math.atan2(mx, mz);
  let best = null, bestLen = -1;
  for (const turn of [0, 0.45, -0.45, 0.9, -0.9, 1.4, -1.4, 2, -2, 2.6, -2.6]) {
    const a = base + turn * A.strafe, ux = Math.sin(a), uz = Math.cos(a);
    const len = clearAhead(e, ux, uz, look);
    if (len >= look) {
      if (Math.abs(turn) > 1.2) A.strafe *= -1;   // 繞圈繞到牆邊：換個方向繞
      return { mx: ux * ml, mz: uz * ml };
    }
    if (len > bestLen) { bestLen = len; best = [ux, uz]; }
  }
  return { mx: best[0] * ml * 0.5, mz: best[1] * ml * 0.5 };
}

export function keepEnemies(player) {
  if (!AI.sandbox) return;
  while (enemies.length < AI.count) spawnEnemy(player);
}
