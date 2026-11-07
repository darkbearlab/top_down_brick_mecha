// ---------- 試玩場的敵機 ----------
// 每台隨機挑一套配裝（parts.js ENEMY_PRESETS），用跟玩家同一套物理和武器
// 距離依武器決定：有劍 / 霰彈就貼近、有狙擊就拉遠、其他保持中距離繞圈
// 看到玩家的加農砲 / 飛彈飛過來會往旁邊噴開；狙擊開槍前會先亮紅色雷射預告
// 背部武器跟玩家一樣要先架起來（toggleReady）：用得上才架、架一陣子或換彈就收回；只有架著飛彈才會鎖定
// 避牆：移動前用三條射線探路（越快探越遠）、速度朝牆而且來不及停就先剎車；推進前確認噴出去的方向夠空
// 被打爆後過幾秒，新的一台從天上降落（地上先出現紅圈，站在下面會被砸）
// 分散：3 格內的同伴互相推開；射擊型（偏好距離 6 格以上）看得到玩家、進到射程後各自找射擊位置（看得到玩家、離同伴遠、離自己近；
//   會飛的喜歡停在空洞上），每 2～4 秒或被打到就換一個 → 散開成扇形游擊，不會排成一列
// 特殊雜魚（parts.js GRUNTS_LOW 的 bomber / charger / fly / swarm）：自爆、衝鋒、旋停、蟲群，見下面各自的函式
import * as THREE from 'three';
import { G, addMat, addTrauma, angleDiff, scene } from './core.js';
import { isBlock, isSolid, randomOpenSpot, rayBlock, rayWalk, tileAt, tileC, tileR } from './arena.js';
import { headStats } from './sensors.js';
import { BOOST_DV, BOOST_PUSH, BOOST_TIME, ENEMY_COLORS, activeSlot, boostDirOf, boostKOf, legK, damagePart, facing, hitMech, makeMech, muzzleOf, mechs, removeMech, slotBroken, stagger, toggleReady, tryBoost, wantsLock } from './mech.js';
import { makeGuns, shots, updateGuns } from './weapons.js';
import { ENEMY_PRESETS, SLOTS } from './parts.js';
import { burst, explosion, hitSparks, makeLaser, setLaser, smoke, sparks } from './fx.js';
import { blastBuildings } from './buildings.js';
import { sfx } from './audio.js';
import { flowDir, flyDir } from './pathing.js';
import { smokeBlocks } from './tech.js';
import { UNIT_BOX } from './core.js';

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
  const has = k => ws.includes(k) || ws.includes(k + '_l');   // 低階版也算
  e.ai = {
    strafe: Math.random() < 0.5 ? -1 : 1, t: 1, burst: 0, rest: 1 + Math.random(), reposition: 3 + Math.random() * 3, lockT: 0, snipeT: 0, hold: { L: Math.random(), R: Math.random() },
    want: has('saber') || has('shotgun') ? 3 : has('sniper') ? 13 : 8,
  };
  e.laser = makeLaser(0xff3020);
  // 特殊雜魚
  if (P.speedMul) e.spec.vmax *= P.speedMul;
  if (P.fly) { e.fly = true; e.flyH = 1.3; }
  if (P.quad) setupQuad(e);
  if (P.bomber) e.bomber = { fuse: -1, beep: 0 };
  if (P.charger) e.charger = { state: 'idle', t: 0, cd: 1.5 + Math.random() * 2 };
  if (P.swarm) setupSwarm(e, P.swarm);
  if (P.bomber || P.charger || P.swarm) e.ai.want = 0;
  if (P.fly && !P.swarm) e.ai.want = 9;
  // noDrop：直接站在地上（遠征模式的遭遇小隊），不然從天上降落
  if (opts.noDrop) { e.drive = { mx: 0, mz: 0 }; e.aimYaw = e.torsoYaw; }
  else {
    const ring = new THREE.Mesh(RING_GEO, addMat(0xff4030, 0.8));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(p.x, 0.04, p.z);
    scene.add(ring);
    e.drop = { t: 0, ring };
    e.model.root.position.y = DROP_H;
  }
  e.onDeath = () => {
    e.laser.g.visible = false;
    clearTele(e);
    if (e.bomber && !e.bomber.done) { e.bomber.done = true; bomberBlast(e, 0.75); }   // 被打爆也會炸（小一點）
    if (e.swarm) burst(e.x, 0.3, e.z, [0x2a2a30, 0xff3020], 18, 5);
    if (e.quad) burst(e.x, 2, e.z, [0x3a3d45, 0xa8321a, 0x8a8e98], 14, 6);
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
  clearTele(e);
  if (e.drop) { scene.remove(e.drop.ring); e.drop = null; }
}
export function clearEnemies() { for (const e of enemies.slice()) removeEnemy(e); }
// 多層地圖：追到別層的敵機先「收起來」（不在場上、不更新），過一陣子再從連接點那邊空降出來（unparkEnemy）
export function parkEnemy(e) {
  const i = enemies.indexOf(e);
  if (i >= 0) enemies.splice(i, 1);
  const j = mechs.indexOf(e);
  if (j >= 0) mechs.splice(j, 1);
  scene.remove(e.model.root);
  e.laser.g.visible = false;
  if (e.drop) { scene.remove(e.drop.ring); e.drop = null; }
}
export function unparkEnemy(e, x, z) {
  e.x = x; e.z = z; e.vx = e.vz = 0;
  scene.add(e.model.root);
  mechs.push(e); enemies.push(e);
  const ring = new THREE.Mesh(RING_GEO, addMat(0xff4030, 0.8));
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.04, z);
  scene.add(ring);
  e.drop = { t: 0, ring };
  e.model.root.position.set(x, DROP_H, z);
}

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
  if (e.fall) { updateFall(e, dt); return; }
  if (!e.alive) return;
  if (e.swarm) updateSwarmFx(e, dt);
  if (e.quad) for (const [i, r] of e.quad.rotors.entries()) r.rotation.y += dt * (i % 2 ? 38 : -38);
  if (e.drop) { if (updateDrop(e, dt, player)) return; }
  // 待命（遠征模式還沒發現玩家的小隊）：站著不動、偶爾轉頭看看
  if (e.dormant) {
    e.drive = { mx: 0, mz: 0 };
    // 巡邏：慢慢走向 e.patrol（遠征模式每幀更新路線點），看著前進方向
    const P = e.patrol, pd = P ? Math.hypot(P.x - e.x, P.z - e.z) : 0;
    if (P && pd > 1 && !e.fixed) { e.drive = steer(e, (P.x - e.x) / pd * 0.4, (P.z - e.z) / pd * 0.4); e.aimYaw = Math.atan2(P.x - e.x, P.z - e.z); }
    else if (Math.random() < dt * 0.25) e.aimYaw = e.torsoYaw + (Math.random() - 0.5) * 2;
    e.laser.g.visible = false;
    updateGuns(e, { L: false, R: false }, dt, [], null);
    return;
  }
  const A = e.ai, DF = e.diff ?? AI.diff;
  const dx = player.x - e.x, dz = player.z - e.z, dist = Math.hypot(dx, dz) || 1;
  const nx = dx / dist, nz = dz / dist;
  const los = rayBlock(e.x, e.z, nx, nz, dist) >= dist - 0.9 && !smokeBlocks(e.x, e.z, player.x, player.z);   // 煙霧彈：看不穿

  // 衝鋒機：預告、衝刺、暈眩的時候不走一般的移動
  if (e.charger && updateCharger(e, dt, player, dist, nx, nz, los)) { updateGuns(e, { L: false, R: false }, dt, [], null); e.laser.g.visible = false; return; }
  // 自爆機：貼近後點火，時間到就炸
  if (e.bomber && updateBomber(e, dt, player, dist, los)) return;
  // 蟲群：貼著玩家就一直啃
  if (e.swarm && player.alive && dist < 2.3 && (A.bite = (A.bite ?? 0) - dt) <= 0) {
    A.bite = 0.3;
    hitMech(player, 6 * (e.dmgMul ?? 1), nx, nz, 0.15, 'kinetic', null, 6);
    sparks(player.x, 1, player.z, 0xff5030, 3, -nx, -nz);
  }

  // 移動：看不到 → 照流場繞過去；射擊型看得到、在射程內 → 去自己的射擊位置；近戰型 → 直衝；近了後退
  A.t -= dt;
  if (A.t <= 0) { A.t = 2 + Math.random() * 2.5; if (Math.random() < 0.5) A.strafe *= -1; }
  let mx, mz;
  const ranged = A.want >= 6;
  if (!player.alive) { mx = 0; mz = 0; }
  else if (!los || dist > A.want + (ranged ? 6 : 4)) {
    // 看不到玩家：照流場繞過去（pathing.js；會飛的用飛行流場）；看得到就直線靠近
    const f = !los && player.team === 'player' ? (e.fly ? flyDir(e.x, e.z) : flowDir(e.x, e.z)) : null;
    if (f) { mx = f.x; mz = f.z; } else { mx = nx; mz = nz; }
    A.spot = null;
  }
  else if (A.lineBlockedT > 0.4) {
    // 看得到但槍口被轉角擋住（槍口在身體側邊）：往被擋的反方向橫移、同時靠近一點，讓出射線
    // 左邊掛點在機體本地 +x = 世界 (nz, -nx)；往被擋那一邊的反方向移
    const s2 = A.blockSide === 'L' ? -1 : 1;
    const lx = nz, lz = -nx;
    mx = lx * s2 * 0.9 + nx * 0.4; mz = lz * s2 * 0.9 + nz * 0.4;
  }
  else if (dist < A.want - 2 && !ranged) { mx = -nx; mz = -nz; }
  else if (ranged && !e.hold && !e.fixed) {
    // 射擊位置：沒有、時間到、被打到、或那裡看不到玩家了 → 重挑
    A.spotT = (A.spotT ?? 0) - dt;
    const hp = e.parts.torso.hp, hurt = hp < (A.spotHp ?? hp) - 0.5;
    A.spotHp = hp;
    if (!A.spot || A.spotT <= 0 || hurt) { A.spot = pickSpot(e, player); A.spotT = 2 + Math.random() * 2; }
    const sx = A.spot.x - e.x, sz = A.spot.z - e.z, sd = Math.hypot(sx, sz);
    if (sd > 1.2) { mx = sx / sd; mz = sz / sd; }
    else { mx = -nz * A.strafe * 0.35; mz = nx * A.strafe * 0.35; }   // 到了：小幅左右晃
  }
  else if (dist < A.want - 2) { mx = -nx; mz = -nz; }
  else { mx = -nz * A.strafe + nx * 0.15; mz = nx * A.strafe + nz * 0.15; }
  // 分散：3 格內的同伴互相推開
  if (player.alive && !e.fixed) {
    for (const o of enemies) {
      if (o === e || !o.alive || o.team !== e.team || o.dormant) continue;
      const ox = e.x - o.x, oz = e.z - o.z, od = Math.hypot(ox, oz);
      if (od < 3 && od > 1e-3) { const k = (3 - od) / 3 * 0.9; mx += ox / od * k; mz += oz / od * k; }
    }
    const ml = Math.hypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; }
  }
  // 守備：離據點 hold.r 格以上就回去；靠近邊緣時不再往外走（只保留沿著邊緣的分量）
  const Hd = e.hold;
  if (Hd) {
    const ax = Hd.x - e.x, az = Hd.z - e.z, ad = Math.hypot(ax, az) || 1;
    if (ad > Hd.r) { mx = ax / ad; mz = az / ad; }
    else if (ad > Hd.r * 0.6) { const out = -(mx * ax + mz * az) / ad; if (out > 0) { mx += ax / ad * out; mz += az / ad * out; } }
  }
  ({ mx, mz } = steer(e, mx, mz));
  if (e.fixed) mx = mz = 0;   // 砲塔

  // 推進：重的子彈 / 飛彈飛過來往旁邊噴；偶爾推進換位置；近戰型推進衝過去
  A.reposition -= dt;
  let boost = false, bx = mx, bz = mz;
  if (DF.dodge) for (const s of shots) {
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
  if (e.fixed || Hd) boost = false;
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
  // 長距鎖定頭：隔著牆也能鎖；頭被打掉還是能鎖（距離短、慢）
  const lockable = player.alive && !AI.passive && (los || (H.radarLock && !smokeBlocks(e.x, e.z, player.x, player.z)));
  A.lockT = lockable && wantsLock(e) && dist < H.lockRange ? A.lockT + dt : Math.max(0, A.lockT - dt * 2);
  const locks = A.lockT >= H.lockTime * DF.lock ? [player] : [];

  // 手臂：連射武器一陣一陣打；狙擊先亮雷射；劍貼近才揮；飛彈有鎖定才射
  const trig = { L: false, R: false };
  if (A.burst > 0) A.burst -= dt;
  else { A.rest -= dt; if (A.rest <= 0 && onTarget) { A.burst = 0.8; A.rest = (1 + Math.random() * 1.2) * DF.rest; } }
  let laserSlot = null, anyClear = false, blockedSide = null;
  for (const side of ['L', 'R']) {
    const slot = activeSlot(e, side), g = e.guns[slot];
    if (!g || slotBroken(e, slot) || e.deployT[side] > 0 || g.ammo <= 0 || g.def.kind === 'shield') continue;
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
      if (onTarget && inRange && g.cd <= 0 && g.ammo > 0) { A.snipeT += dt; laserSlot = slot; if (A.snipeT >= 0.8) { t = true; A.snipeT = 0; } }
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
    const useful = back.ammo > 0 && backUseful(e, 'back' + side, back.def, dist, canShoot, headStats(e), tgt);
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
  const o = e.r * 0.8, ray = e.fly ? rayBlock : rayWalk;   // 走路的空洞也算擋住；會飛的只看岩壁和建築
  return Math.min(ray(e.x, e.z, ux, uz, len), ray(e.x - uz * o, e.z + ux * o, ux, uz, len), ray(e.x + uz * o, e.z - ux * o, ux, uz, len));
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

// ---------- 射擊位置 ----------
// 在玩家周圍偏好距離附近抽 12 個點打分：從那裡看得到玩家（最重要）、離其他同伴（和它們的射擊位置）遠、離自己現在的位置近、
//   會飛的停在空洞上加分（地面機體過不去）；站不住的點不要
function pickSpot(e, tgt) {
  const base = Math.atan2(e.x - tgt.x, e.z - tgt.z), want = e.ai.want;
  let best = null, bs = -1e9;
  for (let i = 0; i < 12; i++) {
    const a = base + (Math.random() - 0.5) * 2.4, r = want * (0.75 + Math.random() * 0.45);
    const x = tgt.x + Math.sin(a) * r, z = tgt.z + Math.cos(a) * r;
    if (e.fly ? isBlock(x, z) : (isSolid(x, z) || isSolid(x + 0.9, z) || isSolid(x - 0.9, z) || isSolid(x, z + 0.9) || isSolid(x, z - 0.9))) continue;
    const dx = tgt.x - x, dz = tgt.z - z, d = Math.hypot(dx, dz) || 1;
    const see = rayBlock(x, z, dx / d, dz / d, d) >= d - 1;
    let sep = 8;
    for (const o of enemies) {
      if (o === e || !o.alive || o.dormant) continue;
      sep = Math.min(sep, Math.hypot(o.x - x, o.z - z));
      if (o.ai?.spot) sep = Math.min(sep, Math.hypot(o.ai.spot.x - x, o.ai.spot.z - z));
    }
    const score = (see ? 10 : -20) + sep * 1.3 - Math.hypot(x - e.x, z - e.z) * 0.3 + (e.fly && tileAt(tileC(x), tileR(z)) === 'v' ? 6 : 0);
    if (score > bs) { bs = score; best = { x, z }; }
  }
  return best ?? { x: e.x, z: e.z };
}

// ---------- 自爆機 ----------
// 4 格內看得到玩家 → 點火：0.7 秒閃紅光、嗶嗶叫（越來越快），然後自爆（敵我都炸，連鎖引爆其他自爆機）
function updateBomber(e, dt, player, dist, los) {
  const B = e.bomber;
  if (B.fuse < 0) {
    if (player.alive && los && dist < 4) { B.fuse = 0.7; B.beep = 0; sfx.lock(); }
    return false;
  }
  B.fuse -= dt;
  e.drive = { mx: 0, mz: 0 };
  if ((B.beep -= dt) <= 0) { B.beep = 0.12; sfx.lock(); sparks(e.x, 1.2, e.z, 0xff3020, 4, 0, 0, 0.6); }
  e.parts.torso.flash = 0.06;
  e.model.root.scale.setScalar(e.k * (1 + 0.12 * Math.sin(G.now * 40)));
  if (B.fuse <= 0) { B.done = true; bomberBlast(e, 1); damagePart(e, 'torso', 1e6); }
  e.laser.g.visible = false;
  updateGuns(e, { L: false, R: false }, dt, [], null);
  return true;
}
function bomberBlast(e, k) {
  const R = 4.5 * (0.7 + 0.3 * k), x = e.x, z = e.z;
  explosion(x, 1, z, 1.3 * k);
  sfx.explode(); addTrauma(0.5 * k);
  blastBuildings(x, 0.6, z, 90 * k, 2.4);
  for (const m of mechs.slice()) {
    if (m === e || !m.alive) continue;
    const dx = m.x - x, dz = m.z - z, d = Math.hypot(dx, dz);
    if (d > R + m.r) continue;
    const dmg = 95 * k * (1 - 0.6 * Math.max(0, d - m.r) / R) * (m.team === e.team ? 1 : e.dmgMul ?? 1);
    hitMech(m, dmg, dx / (d || 1), dz / (d || 1), 7, 'chemical', 'torso', dmg, true);
  }
}

// ---------- 衝鋒機 ----------
// idle：照一般方式靠近；冷卻好了、看得到、4～17 格 → wind：停下來對準、地上亮紅色衝刺線 0.85 秒 →
// go：沿直線用 24 的速度衝（最多 18 格）。撞到玩家：重傷 + 擊退 + 失衡；被牆擋下：暈 1.6 秒；前面是空洞：直接摔下去死掉
const CHARGE_V = 24;
function updateCharger(e, dt, player, dist, nx, nz, los) {
  const C = e.charger;
  C.cd -= dt;
  if (C.state === 'idle') {
    if (C.cd <= 0 && e.staggerT <= 0 && los && dist > 4 && dist < 17 && player.alive && !AI.passive) {
      C.state = 'wind'; C.t = 0.85; C.dx = nx; C.dz = nz; C.len = Math.min(18, dist + 5);
      showTele(e, C);
      sfx.deploy();
    }
    return false;
  }
  if (C.state === 'wind') {
    C.t -= dt;
    e.drive = { mx: 0, mz: 0 };
    e.aimYaw = Math.atan2(C.dx, C.dz);
    e.legYaw = e.aimYaw;
    if (e.tele) e.tele.material.opacity = 0.35 + 0.35 * Math.abs(Math.sin(G.now * 18));
    if (C.t <= 0) {
      C.state = 'go'; C.t = C.len / CHARGE_V;
      e.vx = C.dx * CHARGE_V; e.vz = C.dz * CHARGE_V;
      e.boostT = C.t; e.boostDir = { x: C.dx, z: C.dz }; e.boostK = 0.3;
      clearTele(e); sfx.boost();
    }
    return true;
  }
  // go
  C.t -= dt;
  e.drive = { mx: C.dx, mz: C.dz };
  e.aimYaw = Math.atan2(C.dx, C.dz);
  const end = cd => { C.state = 'idle'; C.cd = cd; e.boostT = 0; };
  // 前面是空洞：摔下去
  const ax = e.x + C.dx * (e.r + 0.5), az = e.z + C.dz * (e.r + 0.5);
  if (tileAt(tileC(ax), tileR(az)) === 'v') { startFall(e, C.dx, C.dz); return true; }
  if (player.alive && Math.hypot(player.x - e.x, player.z - e.z) < e.r + player.r + 0.4) {
    const dmg = 70 * (e.dmgMul ?? 1);
    hitMech(player, dmg, C.dx, C.dz, 14, 'kinetic', 'torso', 70);
    stagger(player, 999, C.dx, C.dz);
    sfx.crash(); addTrauma(0.6);
    e.vx *= 0.2; e.vz *= 0.2;
    end(4);
    return true;
  }
  if (e.boostT <= 0 || C.t <= 0 || Math.hypot(e.vx, e.vz) < CHARGE_V * 0.4) {
    if (C.t > 0.08) { e.staggerT = e.staggerMax = 1.6; e.stagDir = { x: -C.dx, z: -C.dz }; sfx.crash(); }   // 撞牆：暈
    end(3.5);
  }
  return true;
}
function showTele(e, C) {
  clearTele(e);
  const m = new THREE.Mesh(UNIT_BOX, addMat(0xff3020, 0.5));
  m.scale.set(1.3, 0.04, C.len);
  m.position.set(e.x + C.dx * C.len / 2, 0.05, e.z + C.dz * C.len / 2);
  m.rotation.y = Math.atan2(C.dx, C.dz);
  scene.add(m);
  e.tele = m;
}
function clearTele(e) { if (e.tele) { scene.remove(e.tele); e.tele.material.dispose(); e.tele = null; } }
// 摔進空洞：算擊破（掉落物、小隊進度照算），模型往前翻滾掉下去，1.2 秒後收掉
function startFall(e, dx, dz) {
  e.alive = false;
  e.fall = { t: 0, vx: dx * 10, vz: dz * 10 };
  e.laser.g.visible = false;
  clearTele(e);
  sfx.crash();
  AI.onEnemyDeath?.(e);
}
function updateFall(e, dt) {
  const F = e.fall;
  F.t += dt;
  e.x += F.vx * dt; e.z += F.vz * dt;
  F.vx *= Math.exp(-2 * dt); F.vz *= Math.exp(-2 * dt);
  e.model.root.position.set(e.x, -F.t * F.t * 14, e.z);
  e.model.root.rotation.x += dt * 4;
  if (F.t > 1.2) { e.fall = null; removeEnemy(e); }
}

// ---------- 蟲群 ----------
// 機體模型藏起來，改畫 n 隻在地上爬的小機械蟲（扁平深色方塊 + 紅眼），在中心附近亂竄；剩幾隻照剩多少血
const DRONE_GEO = new THREE.BoxGeometry(0.24, 0.09, 0.32), EYE_GEO = new THREE.BoxGeometry(0.12, 0.05, 0.05);
const DRONE_MAT = new THREE.MeshLambertMaterial({ color: 0x2c2d34 }), EYE_MAT = addMat(0xff3020, 0.95);
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(), tmpP = new THREE.Vector3(), ONE = new THREE.Vector3(1, 1, 1), ZERO = new THREE.Vector3(0, 0, 0);
const EYE_OFF = new THREE.Matrix4().makeTranslation(0, 0.03, 0.16);   // 紅眼：蟲的頭
function setupSwarm(e, n) {
  for (const k in e.parts) e.parts[k].g.visible = false;
  e.spec.legs = { ...e.spec.legs, stagger: Infinity };
  e.r = 1.15;
  const body = new THREE.InstancedMesh(DRONE_GEO, DRONE_MAT, n), eye = new THREE.InstancedMesh(EYE_GEO, EYE_MAT, n);
  body.frustumCulled = eye.frustumCulled = false;
  body.castShadow = true;
  e.model.root.add(body, eye);
  e.swarm = { n, per: e.parts.torso.max / n, body, eye, ph: Array.from({ length: n }, () => [Math.random() * 6.28, 0.35 + Math.random() * 1.1, 0, 1 + Math.random() * 1.5]) };
}
function updateSwarmFx(e) {
  const S = e.swarm, t = G.now, live = Math.max(1, Math.ceil(e.parts.torso.hp / e.parts.torso.max * S.n));
  for (let i = 0; i < S.n; i++) {
    // 在地上亂竄：各自在中心附近繞來繞去、頭朝著跑的方向，身體貼地微微顛
    const [ph, rad, , sp] = S.ph[i], a = ph + Math.sin(t * 0.9 * sp + ph * 3) * 1.3, r = rad * (0.75 + 0.35 * Math.sin(t * 1.4 * sp + ph));
    tmpP.set(Math.cos(a) * r, 0.05 + Math.abs(Math.sin(t * 22 + ph * 5)) * 0.025, Math.sin(a) * r);
    tmpQ.setFromEuler(tmpE.set(0, -a + Math.sin(t * 6 + ph) * 0.8, 0));
    tmpM.compose(tmpP, tmpQ, i < live ? ONE : ZERO);   // 打掉的那幾隻縮成 0
    S.body.setMatrixAt(i, tmpM);
    S.eye.setMatrixAt(i, tmpM.multiply(EYE_OFF));
  }
  S.body.instanceMatrix.needsUpdate = true; S.eye.instanceMatrix.needsUpdate = true;
}

// ---------- 旋停機：四旋翼無人機 ----------
// 機體模型藏起來，在上半身那裡換成：扁平機身 + 四支斜臂 + 四個旋翼（半透明圓盤，一直轉）；武器掛在機身下面（槍口也移到那裡）
const QUAD_BODY = new THREE.BoxGeometry(0.72, 0.2, 0.8), QUAD_ARM = new THREE.BoxGeometry(0.1, 0.08, 0.95), QUAD_HUB = new THREE.BoxGeometry(0.16, 0.14, 0.16);
const QUAD_ROTOR = new THREE.CylinderGeometry(0.36, 0.36, 0.02, 18), QUAD_GUN = new THREE.BoxGeometry(0.1, 0.1, 0.55), QUAD_POD = new THREE.BoxGeometry(0.22, 0.16, 0.36);
function setupQuad(e) {
  const M = e.model;
  for (const k in e.parts) e.parts[k].g.visible = false;
  const dark = new THREE.MeshLambertMaterial({ color: 0x3a3d45 }), acc = new THREE.MeshLambertMaterial({ color: e.colors.accent }), metal = new THREE.MeshLambertMaterial({ color: 0x8a8e98 });
  const q = new THREE.Group();
  const body = new THREE.Mesh(QUAD_BODY, dark); q.add(body);
  const stripe = new THREE.Mesh(QUAD_BODY, acc); stripe.scale.set(0.5, 0.3, 1.02); stripe.position.y = 0.09; q.add(stripe);
  const eye = new THREE.Mesh(EYE_GEO, EYE_MAT); eye.scale.set(1.6, 1.4, 1); eye.position.set(0, 0.02, 0.42); q.add(eye);
  const rotors = [];
  for (const [sx, sz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
    const arm = new THREE.Mesh(QUAD_ARM, dark); arm.position.set(sx * 0.33, 0.04, sz * 0.33); arm.rotation.y = Math.atan2(sx, sz); q.add(arm);
    const hub = new THREE.Mesh(QUAD_HUB, metal); hub.position.set(sx * 0.62, 0.1, sz * 0.62); q.add(hub);
    const rot = new THREE.Mesh(QUAD_ROTOR, addMat(0xd0d6e0, 0.28)); rot.position.set(sx * 0.62, 0.19, sz * 0.62); q.add(rot);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.015, 0.06), metal); rot.add(blade);
    rotors.push(rot);
  }
  // 武器掛在下面：右手機槍（右邊 = 本地 -x）、左背飛彈莢艙
  const gun = new THREE.Mesh(QUAD_GUN, metal); gun.position.set(-0.17, -0.18, 0.22); q.add(gun);
  const pod = new THREE.Mesh(QUAD_POD, dark); pod.position.set(0.17, -0.17, 0.08); q.add(pod);
  q.traverse(o => { if (o.isMesh && o.material.type === 'MeshLambertMaterial') o.castShadow = true; });
  q.position.y = 0.15;
  M.torsoG.add(q);
  M.muzzles.armR = [-0.17, -0.03, 0.5];
  M.muzzles.backL = [0.17, -0.02, 0.27];
  e.quad = { g: q, rotors };
}
