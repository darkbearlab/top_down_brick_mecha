// ---------- 頭部感測：視野、雷達、鎖定 ----------
// 視野：頭決定看得到的角度和距離（被方塊擋住也看不到）；視野外的敵機整台隱形，只有雷達範圍內會定期出現紅色光點
//   身邊 3 格內一定感覺得到；頭被打掉 → 視野剩 60°、8 格，沒有雷達和鎖定
// 鎖定：準星附近（槍口方向 ±20° 或離準星 2.5 格內）、在視野和鎖定距離內的敵機會慢慢鎖上；
//   鎖定時間、同時鎖幾台看頭；鎖上的目標給飛彈追蹤用（垂直飛彈一定要鎖定）
//   只有準備中的武器有飛彈時才會開始鎖定（Q / E 架起飛彈）
//   長距鎖定頭（radarLock）：雷達範圍內的目標看不到也能鎖（隔著牆、視野外），配垂直飛彈越過掩體打
import * as THREE from 'three';
import { addMat, angleDiff, scene } from './core.js';
import { rayBlock } from './arena.js';
import { wantsLock } from './mech.js';

export const sensors = { locks: [], progress: new Map(), head: null };
const NEAR = 3;

// 視野扇形（地上淡淡的一片 + 外緣一條弧）
const fanG = new THREE.Group();
scene.add(fanG);
let fanKey = '';
function buildFan(vision, range) {
  fanG.clear();
  const v = Math.min(Math.PI * 2, vision * Math.PI / 180), start = -Math.PI / 2 - v / 2;
  const fill = new THREE.Mesh(new THREE.CircleGeometry(range, 64, start, v), addMat(0x7ff0ff, 0.035));
  const edge = new THREE.Mesh(new THREE.RingGeometry(range - 0.1, range, 64, 1, start, v), addMat(0x7ff0ff, 0.22));
  for (const m of [fill, edge]) { m.rotation.x = -Math.PI / 2; fanG.add(m); }
  if (v < Math.PI * 2) {
    for (const a of [start, start + v]) {
      const l = new THREE.Mesh(new THREE.PlaneGeometry(range, 0.06), addMat(0x7ff0ff, 0.16));
      l.rotation.x = -Math.PI / 2;
      // 平面的長邊沿著 a 方向（本地座標，翻平之前）
      l.position.set(Math.cos(a) * range / 2, 0, -Math.sin(a) * range / 2);
      l.rotation.z = a;
      fanG.add(l);
    }
  }
}

// 鎖定框：四個角，鎖定中從大縮到小（琥珀色），鎖上變紅、轉 45°
const CORNER = new THREE.PlaneGeometry(0.5, 0.09);
const lockMarks = new Map();
function markFor(t) {
  if (lockMarks.has(t)) return lockMarks.get(t);
  const g = new THREE.Group(), mat = addMat(0xffb040, 0.9);
  // 四個 L 形角：每個角在 (±0.9, ±0.9)，兩隻腳沿著方框的邊往內
  for (let i = 0; i < 4; i++) {
    const pivot = new THREE.Group();
    pivot.rotation.y = i * Math.PI / 2;
    const a = new THREE.Mesh(CORNER, mat), b = new THREE.Mesh(CORNER, mat);
    a.rotation.x = -Math.PI / 2;
    a.position.set(0.9 - 0.25, 0, 0.9);
    b.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
    b.position.set(0.9, 0, 0.9 - 0.25);
    pivot.add(a, b);
    g.add(pivot);
  }
  g.position.y = 0.06;
  scene.add(g);
  const m = { g, mat };
  lockMarks.set(t, m);
  return m;
}

// 雷達光點
const blips = [];
const BLIP_GEO = new THREE.RingGeometry(0.35, 0.5, 20);
function blip(x, z) {
  const m = new THREE.Mesh(BLIP_GEO, addMat(0xff4030, 0.8));
  m.rotation.x = -Math.PI / 2;
  m.position.set(x, 0.05, z);
  scene.add(m);
  blips.push({ m, life: 1.1 });
}

export function setSensorsVisible(v) { fanG.visible = v; for (const [, m] of lockMarks) m.g.visible = v; }

// 頭部受損 → 鎖定跟著衰退（視野、雷達不變；打掉才一起沒）：
//   健康度 k = hp / max；鎖定時間 ×(1 + 1.2(1-k))、鎖定距離 ×(1 - 0.5(1-k))
//   半血：鎖定 ×1.6 慢、距離 ×0.75；剩兩成：×1.96、×0.6；1/4 以下只能鎖 1 台、長距鎖定頭不能再隔牆鎖
// 彈道武器發數多，比較容易打到頭 → 打頭就是對付飛彈機的手段
const BROKEN_HEAD = { vision: 60, range: 8, radar: 0, lockTime: 9, lockCount: 0, lockRange: 0, intel: false };
const headCache = new WeakMap();
export function headStats(p) {
  const H = p.spec.head, hp = p.parts.head;
  if (hp.broken) return BROKEN_HEAD;
  const k = hp.hp / hp.max;
  if (k >= 0.999) return H;
  const q = Math.round(k * 50) / 50;   // 量化，避免每幀都產生新物件
  let c = headCache.get(p);
  if (c?.q !== q || c.H !== H) {
    const d = 1 - q;
    c = { q, H, s: { ...H, lockTime: H.lockTime * (1 + 1.2 * d), lockRange: H.lockRange * (1 - 0.5 * d),
      lockCount: q < 0.25 ? Math.min(1, H.lockCount) : H.lockCount, radarLock: q < 0.25 ? false : H.radarLock, health: q } };
    headCache.set(p, c);
  }
  return c.s;
}

export function updateSensors(p, enemies, aim, dt) {
  const H = sensors.head = headStats(p);
  const key = p.alive ? `${H.vision}|${H.range}` : '';
  if (key !== fanKey) { fanKey = key; if (key) buildFan(H.vision, H.range); else fanG.clear(); }
  fanG.position.set(p.x, 0.04, p.z);
  fanG.rotation.y = p.torsoYaw;

  const live = new Set(), armed = wantsLock(p);
  for (const e of enemies) {
    if (!e.alive) continue;
    if (e.drop) { e.model.root.visible = true; continue; }   // 降落中看得到（紅圈預告）
    const dx = e.x - p.x, dz = e.z - p.z, dist = Math.hypot(dx, dz);
    const ang = Math.abs(angleDiff(p.torsoYaw, Math.atan2(dx, dz)));
    const los = rayBlock(p.x, p.z, dx / (dist || 1), dz / (dist || 1), dist) >= dist - e.r;
    const seen = !p.alive || dist < NEAR || (dist <= H.range && (H.vision >= 360 || ang <= H.vision * Math.PI / 360) && los);
    e.seen = seen;
    e.model.root.visible = seen;
    // 看不到但在雷達範圍內：每 1.2 秒亮一次光點
    if (!seen && dist < H.radar) {
      e.radarT = (e.radarT ?? Math.random()) - dt;
      if (e.radarT <= 0) { e.radarT = 1.2; blip(e.x, e.z); }
    }
    // 鎖定
    const aimA = Math.abs(angleDiff(p.torsoYaw, Math.atan2(dx, dz)));
    const nearAim = aim && Math.hypot(e.x - aim.x, e.z - aim.z) < 2.5;
    const can = p.alive && armed && (seen || (H.radarLock && dist <= H.radar)) && H.lockCount > 0 && dist <= H.lockRange && (aimA < 0.35 || nearAim);
    let prog = sensors.progress.get(e) ?? 0;
    prog = can ? Math.min(1, prog + dt / H.lockTime) : Math.max(0, prog - dt * (seen ? 1.2 : 3));
    if (prog > 0) { sensors.progress.set(e, prog); live.add(e); } else sensors.progress.delete(e);
  }
  // 鎖上的：進度滿的，依進度排序取前 lockCount 台
  const full = [...sensors.progress.entries()].filter(([e, v]) => v >= 1 && e.alive).map(([e]) => e);
  full.sort((a, b) => Math.hypot(a.x - p.x, a.z - p.z) - Math.hypot(b.x - p.x, b.z - p.z));
  sensors.locks = full.slice(0, H.lockCount);

  // 鎖定框
  for (const [t, m] of lockMarks) {
    const prog = sensors.progress.get(t) ?? 0;
    if (!t.alive || prog <= 0 || !live.has(t)) { scene.remove(m.g); m.mat.dispose(); lockMarks.delete(t); }
  }
  for (const t of live) {
    const prog = sensors.progress.get(t), m = markFor(t), locked = sensors.locks.includes(t);
    m.g.position.x = t.x; m.g.position.z = t.z;
    m.g.scale.setScalar((locked ? 1 : 2.2 - prog * 1.2) * (t.r / 0.85));
    m.g.rotation.y = locked ? Math.PI / 4 + Math.sin(performance.now() / 120) * 0.05 : prog * Math.PI / 2;
    m.mat.color.setHex(locked ? 0xff3030 : 0xffb040);
    m.mat.opacity = locked ? 0.95 : 0.4 + prog * 0.5;
  }
  for (let i = blips.length - 1; i >= 0; i--) {
    const b = blips[i];
    b.life -= dt;
    b.m.material.opacity = Math.max(0, b.life / 1.1) * 0.8;
    b.m.scale.setScalar(1 + (1.1 - b.life) * 0.6);
    if (b.life <= 0) { scene.remove(b.m); b.m.material.dispose(); blips.splice(i, 1); }
  }
}
