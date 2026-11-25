// ---------- 戰場意識圖（I 鍵開關）----------
// 把新數值王牌的戰場意識（ai.js aceAware → e.ai.tac）畫在地上：
//   威脅圖：王牌周圍 24 格、每 2 格一塊，越紅 = 越多已知敵人射程內看得到那裡（ai.js threatAt）
//   已知敵人：看得到的 = 紅框；推估的（記憶裡的位置往王牌推）= 黃框，越淡越不確定
//   出現點：看不到敵人時，推估最近那台會從哪裡冒出來 = 青色菱形（王牌預瞄那裡）
//   撤退：要被包圍 / 站的地方太危險 → 綠線指向撤退點
//   包圍角度：王牌腳下一圈弧線，橘色那段 = 已知敵人圍住的角度（超過 120° 就開始撤）
// 只看第一台有 e.ai.tac 的機體（觀戰的王牌、重火力測試的頭目）；每 0.2 秒重畫；關著完全不花效能
import * as THREE from 'three';
import { scene } from './core.js';
import { threatAt } from './ai.js';
import { mechs } from './mech.js';

const CELL = 2, R = 24, N = Math.ceil(R / CELL) * 2 + 1;
let on = false, t = 0, group = null, heat = null, marks = [], lines = null, arc = null;
const tmp = new THREE.Matrix4(), col = new THREE.Color();
const mat = (c, o) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, depthWrite: false });

function build() {
  group = new THREE.Group(); group.renderOrder = 5; scene.add(group);
  const plane = new THREE.PlaneGeometry(CELL * 0.92, CELL * 0.92); plane.rotateX(-Math.PI / 2);
  heat = new THREE.InstancedMesh(plane, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.38, depthWrite: false, vertexColors: false }), N * N);
  heat.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(N * N * 3), 3);
  heat.frustumCulled = false; group.add(heat);
  const ring = new THREE.RingGeometry(0.85, 1.05, 4, 1); ring.rotateX(-Math.PI / 2); ring.rotateY(Math.PI / 4);
  for (let i = 0; i < 16; i++) { const m = new THREE.Mesh(ring, mat(0xff4030, 0.8)); m.visible = false; group.add(m); marks.push(m); }
  lines = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false }));
  lines.frustumCulled = false; group.add(lines);
  arc = new THREE.Mesh(new THREE.BufferGeometry(), mat(0xff9a30, 0.6)); arc.frustumCulled = false; group.add(arc);
}
export function setTacView(v) { on = v; if (group) group.visible = v; }
addEventListener('keydown', e => { if (e.code === 'KeyI' && !e.repeat && !e.ctrlKey && !e.metaKey) setTacView(!on); });

export function updateTacView(dt) {
  if (!on) return;
  if (!group) build();
  if ((t -= dt) > 0) return;
  t = 0.2;
  const ace = mechs.find(m => m.alive && m.ai?.tac && !m.drop);
  group.visible = !!ace;
  if (!ace) return;
  const T = ace.ai.tac, y = 0.06;
  // 威脅圖
  const c0 = Math.round(ace.x / CELL) * CELL, z0 = Math.round(ace.z / CELL) * CELL, h = (N - 1) / 2;
  let k = 0;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const x = c0 + (i - h) * CELL, z = z0 + (j - h) * CELL, d = Math.hypot(x - ace.x, z - ace.z);
    const v = d > R ? 0 : Math.min(1, threatAt(T.foes, x, z, null) / 4);
    tmp.makeTranslation(x, y, z); heat.setMatrixAt(k, v > 0.02 ? tmp : tmp.makeScale(0, 0, 0));
    col.setRGB(0.25 + v * 0.75, 0.18 * (1 - v), 0.12 * (1 - v)); heat.setColorAt(k, col);
    k++;
  }
  heat.instanceMatrix.needsUpdate = true; heat.instanceColor.needsUpdate = true;
  // 已知敵人
  marks.forEach((m, i) => {
    const f = T.foes[i];
    m.visible = !!f;
    if (!f) return;
    m.position.set(f.x, y + 0.02, f.z);
    m.material.color.setHex(f.vis ? 0xff4030 : 0xffd040); m.material.opacity = f.vis ? 0.85 : 0.25 + 0.5 * f.conf;
  });
  // 線：推估（實際 → 推估位置，黃）、撤退（綠）、出現點（青色菱形）
  const P = [], C = [];
  const seg = (x0, z0, x1, z1, c) => { P.push(x0, y + 0.05, z0, x1, y + 0.05, z1); col.setHex(c); C.push(col.r, col.g, col.b, col.r, col.g, col.b); };
  for (const f of T.foes) if (!f.vis) seg(f.m.x, f.m.z, f.x, f.z, 0x806820);
  if (T.retreat) {
    seg(ace.x, ace.z, T.retreat.x, T.retreat.z, 0x40ff70);
    const a = Math.atan2(T.retreat.x - ace.x, T.retreat.z - ace.z);
    for (const s of [-1, 1]) seg(T.retreat.x, T.retreat.z, T.retreat.x - Math.sin(a + s * 0.5) * 1.2, T.retreat.z - Math.cos(a + s * 0.5) * 1.2, 0x40ff70);
  }
  if (T.emerge) { const { x, z } = T.emerge, r = 0.9; seg(x - r, z, x, z - r, 0x40e0ff); seg(x, z - r, x + r, z, 0x40e0ff); seg(x + r, z, x, z + r, 0x40e0ff); seg(x, z + r, x - r, z, 0x40e0ff); seg(ace.x, ace.z, x, z, 0x206070); }
  lines.geometry.dispose();
  lines.geometry = new THREE.BufferGeometry();
  lines.geometry.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  lines.geometry.setAttribute('color', new THREE.Float32BufferAttribute(C, 3));
  // 包圍角度：腳下的弧（從空隙的另一邊開始，長度 = spread）
  arc.geometry.dispose();
  if (T.spread > 0.05 && T.gapDir != null) {
    const start = T.gapDir + (Math.PI * 2 - T.spread) / 2;
    // RingGeometry 的角度 θ（躺平之後）對應世界方向 atan2(x, z) = θ + π/2
    const g = new THREE.RingGeometry(2.2, 2.6, 32, 1, start - Math.PI / 2, T.spread); g.rotateX(-Math.PI / 2);
    arc.geometry = g; arc.position.set(ace.x, y + 0.03, ace.z);
    arc.material.color.setHex(T.spread > 2.1 ? 0xff5030 : 0xffa040);
    arc.visible = true;
  } else { arc.geometry = new THREE.BufferGeometry(); arc.visible = false; }
}
