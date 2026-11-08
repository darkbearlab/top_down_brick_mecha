// ---------- 頭部感測：鎖定 ----------
// 視野一律 360°、不限距離：敵機永遠看得到（沒有視野外、雷達光點這些）
// 頭只決定鎖定：準星附近（上半身正前方 ±lockArc/2 或離準星 2.5 格內）、在鎖定距離內、射線沒被牆擋的敵機會慢慢鎖上
//   鎖定時間、同時鎖幾台、鎖定距離、鎖定角度看頭；鎖上的目標給飛彈追蹤用（垂直飛彈一定要鎖定）
//   只有準備中的武器有飛彈時才會開始鎖定（Q / E 架起飛彈）
//   長距鎖定頭（radarLock）：隔著牆也能鎖，配垂直飛彈越過掩體打
//   頭被打掉：還是能鎖，只是鎖定距離剩 45%、時間 ×2.2、只能鎖 1 台、不能隔牆鎖
import * as THREE from 'three';
import { addMat, angleDiff, scene } from './core.js';
import { rayBlock } from './arena.js';
import { wantsLock } from './mech.js';
import { burnLockK } from './status.js';

export const sensors = { locks: [], progress: new Map(), head: null };

// 鎖定範圍扇形（地上淡淡的一片 + 外緣一條弧）：角度 = 鎖定角度、半徑 = 鎖定距離
const fanG = new THREE.Group();
scene.add(fanG);
let fanKey = '';
function buildFan(arc, range) {
  fanG.clear();
  const v = Math.min(Math.PI * 2, arc * Math.PI / 180), start = -Math.PI / 2 - v / 2;
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

export function setSensorsVisible(v) { fanG.visible = v; for (const [, m] of lockMarks) m.g.visible = v; }

// 頭部受損 → 鎖定跟著衰退：
//   健康度 k = hp / max；鎖定時間 ×(1 + 1.2(1-k))、鎖定距離 ×(1 - 0.5(1-k))
//   半血：鎖定 ×1.6 慢、距離 ×0.75；剩兩成：×1.96、×0.6；1/4 以下只能鎖 1 台、長距鎖定頭不能再隔牆鎖
//   打掉：距離 ×0.45、時間 ×2.2、1 台、沒有敵情
// 彈道武器發數多，比較容易打到頭 → 打頭就是對付飛彈機的手段
const headCache = new WeakMap(), brokenCache = new WeakMap();
export function headStats(p) {
  const H = p.spec.head, hp = p.parts.head;
  if (hp.broken) {
    let b = brokenCache.get(H);
    if (!b) brokenCache.set(H, b = { ...H, lockTime: H.lockTime * 2.2, lockRange: H.lockRange * 0.45, lockCount: 1, radarLock: false, intel: false, health: 0, broken: true });
    return b;
  }
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
  const lockTime = H.lockTime * (p.lockMul ?? 1) * burnLockK(p);   // 無盡模式的強化；頭燒起來鎖得慢
  const key = p.alive ? `${H.lockArc}|${H.lockRange.toFixed(1)}` : '';
  if (key !== fanKey) { fanKey = key; if (key) buildFan(H.lockArc, H.lockRange); else fanG.clear(); }
  fanG.position.set(p.x, 0.04, p.z);
  fanG.rotation.y = p.torsoYaw;

  const live = new Set(), armed = wantsLock(p), half = H.lockArc * Math.PI / 360;
  for (const e of enemies) {
    if (!e.alive || e.drop || e.swarm) continue;   // 蟲群鎖不到（一大群小東西，鎖了會一直干擾）
    const dx = e.x - p.x, dz = e.z - p.z, dist = Math.hypot(dx, dz);
    if (dist > H.lockRange + 4 && !sensors.progress.has(e)) continue;   // 遠的不用算
    const aimA = Math.abs(angleDiff(p.torsoYaw, Math.atan2(dx, dz)));
    const nearAim = aim && Math.hypot(e.x - aim.x, e.z - aim.z) < 2.5;
    const can = p.alive && armed && dist <= H.lockRange && (aimA < half || nearAim) &&
      (H.radarLock || rayBlock(p.x, p.z, dx / (dist || 1), dz / (dist || 1), dist) >= dist - e.r);
    let prog = sensors.progress.get(e) ?? 0;
    prog = can ? Math.min(1, prog + dt / lockTime) : Math.max(0, prog - dt * 1.5);
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
}
