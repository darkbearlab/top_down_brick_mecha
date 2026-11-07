// ---------- 主動裝置（R / 滑鼠中鍵 / 手把 Y） ----------
// 資料在 tech.js（DEVICES）；這裡是用的時候發生什麼、場上的東西（手榴彈、煙、地雷、標記、誘餌）每幀怎麼動
// 次數型（手榴彈、地雷、煙霧彈）：用完要到彈藥補給站補；冷卻型（其他）：冷卻好了就能再用
import * as THREE from 'three';
import { G, UNIT_BOX, addMat, addTrauma, scene } from './core.js';
import { isBlock } from './arena.js';
import { PLAYER_COLORS, facing, hitMech, makeMech, mechs, removeMech } from './mech.js';
import { enemies } from './ai.js';
import { blastBuildings } from './buildings.js';
import { burst, explosion, hitSparks, smoke, spawnPuff, sparks } from './fx.js';
import { sfx } from './audio.js';
import { DEVICES, smokes } from './tech.js';

const R = (a, b) => a + Math.random() * (b - a);
const things = [];   // 場上的東西：{ kind, ..., update(dt) → false 就收掉, dispose() }

// 能不能用：次數 / 冷卻
export function deviceReady(m) {
  const d = m.device;
  if (!d || !m.alive) return false;
  const D = DEVICES[d.id];
  return D.charges ? d.charges > 0 : d.cd <= 0;
}
export function updateDeviceCd(m, dt) { if (m.device && m.device.cd > 0) m.device.cd -= dt; }

// 用：aim = 游標在地上的點；回傳有沒有用出去
export function useDevice(m, aim) {
  if (!deviceReady(m)) { sfx.click(); return false; }
  const d = m.device, D = DEVICES[d.id];
  const ok = USE[d.id](m, aim);
  if (!ok) { sfx.click(); return false; }
  if (D.charges) d.charges--; else d.cd = D.cd;
  return true;
}

// 範圍爆炸：owner 的敵人吃傷害（爆風）、建築也會壞
function areaBlast(owner, x, z, rad, dmg) {
  explosion(x, 0.6, z, rad / 2.4);
  sfx.blast(); addTrauma(0.25);
  blastBuildings(x, 0.6, z, dmg * 0.8, rad * 0.6);
  for (const o of mechs.slice()) {
    if (!o.alive || o.team === owner.team || o.decoy) continue;
    const dx = o.x - x, dz = o.z - z, d = Math.hypot(dx, dz);
    if (d > rad + o.r) continue;
    const k = 1 - 0.55 * Math.max(0, d - o.r) / rad;
    hitMech(o, dmg * k, dx / (d || 1), dz / (d || 1), 3, 'chemical', 'torso', dmg * k, true);
  }
}

// 拋物線丟出去：0.7 秒落地（最遠 14 格），落地呼叫 land(x, z)
const LOB_G = 22, NADE = new THREE.BoxGeometry(0.22, 0.22, 0.22);
function lob(m, aim, color, land) {
  let tx = aim?.x ?? m.x + facing(m).x * 8, tz = aim?.z ?? m.z + facing(m).z * 8;
  const dx = tx - m.x, dz = tz - m.z, d = Math.hypot(dx, dz);
  if (d > 14) { tx = m.x + dx / d * 14; tz = m.z + dz / d * 14; }
  const T = 0.7, mesh = new THREE.Mesh(NADE, new THREE.MeshLambertMaterial({ color })), glow = new THREE.Mesh(NADE, addMat(color, 0.6));
  glow.scale.setScalar(1.8); mesh.add(glow);
  const p = { x: m.x, y: 1.6, z: m.z, vx: (tx - m.x) / T, vz: (tz - m.z) / T, vy: (0.15 - 1.6 + 0.5 * LOB_G * T * T) / T };
  mesh.position.set(p.x, p.y, p.z); scene.add(mesh);
  things.push({
    update(dt) {
      p.vy -= LOB_G * dt;
      const nx = p.x + p.vx * dt, nz = p.z + p.vz * dt;
      if (isBlock(nx, nz)) { p.vx *= -0.3; p.vz *= -0.3; } else { p.x = nx; p.z = nz; }   // 撞牆彈回來一點
      p.y += p.vy * dt;
      mesh.position.set(p.x, p.y, p.z); mesh.rotation.x += dt * 9; mesh.rotation.z += dt * 7;
      if (p.y > 0.15) return true;
      land(p.x, p.z);
      return false;
    },
    dispose() { scene.remove(mesh); mesh.material.dispose(); glow.material.dispose(); },
  });
  sfx.reload();
  return true;
}

const RING = new THREE.RingGeometry(0.85, 1, 40);
const USE = {
  grenade: (m, aim) => lob(m, aim, 0x6a7a3a, (x, z) => areaBlast(m, x, z, 2.8, 75)),
  smoke: (m, aim) => lob(m, aim, 0x9aa0a8, (x, z) => {
    const S = { x, z, r: 4.2, until: G.now + 8 };
    smokes.push(S);
    sfx.boost();
    let acc = 0;
    things.push({
      update(dt) {
        if (G.now > S.until) return false;
        if ((acc += dt) > 0.05) {
          acc = 0;
          const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * S.r;
          spawnPuff({ x: x + Math.cos(a) * r, y: R(0.3, 1.8), z: z + Math.sin(a) * r, vx: R(-0.3, 0.3), vy: R(0.05, 0.3), vz: R(-0.3, 0.3), life: R(1.6, 2.6), s: R(1.1, 1.8), c0: 0x9a9ea6, c1: 0x6c7078, drag: 1.2 });
        }
        return true;
      },
      dispose() { const i = smokes.indexOf(S); if (i >= 0) smokes.splice(i, 1); },
    });
  }),
  mine: m => {
    const mine = { x: m.x - facing(m).x * 1.4, z: m.z - facing(m).z * 1.4, arm: G.now + 0.8, owner: m };
    const g = new THREE.Group(), base = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.38, 0.12, 12), new THREE.MeshLambertMaterial({ color: 0x3a3d34 }));
    const lamp = new THREE.Mesh(UNIT_BOX, addMat(0xff3020, 0.9)); lamp.scale.setScalar(0.1); lamp.position.y = 0.1;
    base.position.y = 0.06; g.add(base, lamp); g.position.set(mine.x, 0, mine.z); scene.add(g);
    // 場上最多 3 顆：多的把最舊的引爆
    const mine3 = things.filter(t => t.mine);
    if (mine3.length >= 3) mine3[0].boom = true;
    things.push({
      mine: true,
      update() {
        lamp.visible = G.now < mine.arm ? Math.sin(G.now * 30) > 0 : Math.sin(G.now * 6) > 0.6;
        const near = G.now >= mine.arm && enemies.some(e => e.alive && e.team !== m.team && !e.fly && Math.hypot(e.x - mine.x, e.z - mine.z) < 1.6 + e.r);
        if (!near && !this.boom) return true;
        areaBlast(m, mine.x, mine.z, 2.6, 110);
        return false;
      },
      dispose() { scene.remove(g); base.geometry.dispose(); base.material.dispose(); lamp.material.dispose(); },
    });
    sfx.reload();
    return true;
  },
  mark: (m, aim) => {
    // 游標 6 格內、看得到（迷霧裡的不算）、最近的那台
    let best = null, bd = 6;
    for (const e of enemies) {
      if (!e.alive || e.team === m.team || e.fogVis === false || e.dormant && Math.hypot(e.x - m.x, e.z - m.z) > 30) continue;
      const d = Math.hypot(e.x - (aim?.x ?? m.x), e.z - (aim?.z ?? m.z));
      if (d < bd) { bd = d; best = e; }
    }
    if (!best) return false;
    best.markT = G.now + 8;
    const ring = new THREE.Mesh(RING, addMat(0xffc040, 0.9)); ring.rotation.x = -Math.PI / 2; scene.add(ring);
    const cross = new THREE.Group();
    for (const a of [0, Math.PI / 2]) { const b = new THREE.Mesh(UNIT_BOX, ring.material); b.scale.set(2.6, 0.03, 0.06); b.rotation.y = a; cross.add(b); }
    scene.add(cross);
    things.push({
      update() {
        if (!best.alive || G.now > best.markT) return false;
        const k = best.boss ? 1.4 : 1;
        ring.position.set(best.x, 0.08, best.z); ring.scale.setScalar(k * (1.1 + 0.08 * Math.sin(G.now * 8)));
        cross.position.set(best.x, 0.09, best.z); cross.rotation.y = G.now * 1.5; cross.scale.setScalar(k);
        ring.visible = cross.visible = best.model.root.visible;
        return true;
      },
      dispose() { scene.remove(ring, cross); ring.material.dispose(); },
    });
    sfx.lock();
    return true;
  },
  emp: m => {
    const RAD = 7;
    for (const e of enemies) {
      if (!e.alive || e.team === m.team || Math.hypot(e.x - m.x, e.z - m.z) > RAD + e.r) continue;
      e.empT = G.now + 2;
      e.staggerT = e.staggerMax = e.grunt ? 1.5 : 0.8;
      e.stagDir = { x: (e.x - m.x) / RAD, z: (e.z - m.z) / RAD };
      if (e.ai) e.ai.lockT = 0;
      if (e.bomber && e.bomber.fuse >= 0) { e.bomber.fuse = -1; e.model.root.scale.setScalar(e.k); }
      sparks(e.x, 1.2, e.z, 0x80e0ff, 8, 0, 0, 0.8);
    }
    const ring = new THREE.Mesh(RING, addMat(0x80e0ff, 0.9)); ring.rotation.x = -Math.PI / 2; ring.position.set(m.x, 0.3, m.z); scene.add(ring);
    let t = 0;
    things.push({
      update(dt) { t += dt; ring.scale.setScalar(0.5 + t / 0.35 * RAD); ring.material.opacity = 0.9 * (1 - t / 0.35); return t < 0.35; },
      dispose() { scene.remove(ring); ring.material.dispose(); },
    });
    sfx.beam(); addTrauma(0.2);
    return true;
  },
  shieldGen: m => {
    m.eshield = { until: G.now + 3 };
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(1.7, 1.7, 2.4, 20, 1, true, -1.2, 2.4), addMat(0x60d0ff, 0.22));
    mesh.material.side = THREE.DoubleSide;
    mesh.position.y = 0.4;
    m.model.torsoG.add(mesh);
    things.push({
      update() { mesh.material.opacity = 0.16 + 0.08 * Math.sin(G.now * 20); return m.alive && G.now < m.eshield.until; },
      dispose() { m.model.torsoG.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); },
    });
    sfx.deploy();
    return true;
  },
  overload: m => {
    m.overload = { until: G.now + 5 };
    let acc = 0;
    things.push({
      update(dt) {
        if (!m.alive || G.now > m.overload.until + 3) return false;
        if ((acc += dt) > 0.12) { acc = 0; const hot = G.now > m.overload.until; sparks(m.x, 1.4, m.z, hot ? 0xff5020 : 0xffd040, 2, 0, 0, 0.5); if (hot) smoke(m.x, 1.6, m.z, 1, 0.6); }
        return true;
      },
      dispose() {},
    });
    sfx.reloadDone();
    return true;
  },
  decoy: m => {
    const d = makeMech({ team: m.team, colors: PLAYER_COLORS, loadout: m.loadout, x: m.x, z: m.z, yaw: m.torsoYaw, hpMul: 0.45, ace: false });
    d.decoy = true; d.guns = {};
    d.model.root.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.5; o.castShadow = false; } });
    const until = G.now + 6, fooled = [];
    for (const e of enemies) if (e.alive && e.team !== m.team && Math.hypot(e.x - m.x, e.z - m.z) < 30) { e.foe = d; fooled.push(e); }
    things.push({
      update() { return d.alive && G.now < until; },
      dispose() {
        for (const e of fooled) if (e.foe === d) e.foe = null;
        if (d.alive) burst(d.x, 1, d.z, [0x60d0ff, 0x2aa8c8], 12, 4);
        d.alive = false; removeMech(d);
      },
    });
    sfx.deploy();
    return true;
  },
};

export function updateDevices(dt) {
  for (let i = things.length - 1; i >= 0; i--) if (!things[i].update(dt)) { things[i].dispose(); things.splice(i, 1); }
}
export function clearDevices() {
  for (const t of things) t.dispose();
  things.length = 0; smokes.length = 0;
}
