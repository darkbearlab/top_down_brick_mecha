// ---------- 機體動作檢視器 ----------
// 直接用遊戲的模型（src/model.js）和動作（src/anim.js），不含戰鬥、地圖、AI。
// 機體站在原地（跑步機），地板往後捲；移動是照 driveMech 的加減速簡化算的，只給動畫當輸入。
// 發布成 Artifact：頁面 = viewer.html，附檔 viewer.js、src/core.js ← stub-core.js、src/tech.js ← stub-tech.js，
//   其餘 src/model.js、voxbody.js、shapes.js、parts.js、gruntbodies.js、anim.js 用遊戲原本的檔案（改了動作就重新發布同一個網址）
import * as THREE from 'three';
import { buildMechModel } from './src/model.js';
import { WEAPONS, computeSpec } from './src/parts.js';
import { animMech } from './src/anim.js';
import { G } from './src/core.js';

const COLORS = { accent: 0x2aa8c8, glow: 0x7ff0ff };
const armor = { head: 'composite', torso: 'composite', arms: 'composite', legs: 'composite' };
const LO = {
  light: { name: '輕量', head: 'std', core: 'light', legs: 'biped', armL: 'mg', armR: 'saber', backL: null, backR: null, armor },
  std: { name: '標準', head: 'std', core: 'std', legs: 'biped', armL: 'autocannon', armR: 'shotgun', backL: 'missile', backR: 'rocket', armor },
  heavy: { name: '超載', head: 'array', core: 'heavy', legs: 'biped', armL: 'shield', armR: 'lance', backL: 'cannon', backR: 'cannon', armor },
  reverse: { name: '逆關節', head: 'std', core: 'light', legs: 'reverse', armL: 'sniper', armR: 'mg', backL: null, backR: 'vmissile', armor },
  tread: { name: '履帶', head: 'std', core: 'heavy', legs: 'tread', armL: 'autocannon', armR: 'autocannon', backL: 'cannon', backR: 'cannon', armor },
  hover: { name: '懸浮', head: 'std', core: 'std', legs: 'hover', armL: 'beam', armR: 'pulse', backL: 'missile', backR: null, armor },
};
const SETS = { light: ['light'], std: ['std'], heavy: ['heavy'], trio: ['light', 'std', 'heavy'], reverse: ['reverse'], tread: ['tread'], hover: ['hover'] };

// ---- 畫面 ----
const stage = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x10141b);
scene.fog = new THREE.Fog(0x10141b, 22, 46);
const camera = new THREE.PerspectiveCamera(42, 1, 0.3, 120);
scene.add(new THREE.HemisphereLight(0xe2ecf8, 0x4a5260, 2.6));
const sun = new THREE.DirectionalLight(0xffffff, 2.4);
sun.position.set(4, 9, 6); sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 30 });
sun.shadow.bias = -0.0015;
scene.add(sun);
// 地板：兩種深淺的方格（一格 = 遊戲裡的一格），跟著機體的移動往後捲
const tc = document.createElement('canvas'); tc.width = tc.height = 128;
{
  const c = tc.getContext('2d');
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { c.fillStyle = (i + j) % 2 ? '#2b313b' : '#262c35'; c.fillRect(i * 64, j * 64, 64, 64); }
  c.strokeStyle = '#1a1f27'; c.lineWidth = 3; c.strokeRect(0, 0, 64, 64); c.strokeRect(64, 64, 64, 64); c.strokeRect(64, 0, 64, 64); c.strokeRect(0, 64, 64, 64);
  c.fillStyle = '#39414d'; c.fillRect(8, 8, 6, 6); c.fillRect(100, 84, 5, 5);
}
const tex = new THREE.CanvasTexture(tc);
tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.repeat.set(40, 40); tex.colorSpace = THREE.SRGBColorSpace;
tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshLambertMaterial({ map: tex }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
scene.add(ground);

// ---- 機體 ----
let units = [], uid = 0;
function makeUnit(key, bx) {
  const lo = LO[key], M = buildMechModel(lo, COLORS), spec = computeSpec(lo);
  M.root.traverse(o => { if (o.isMesh && o.material.type === 'MeshLambertMaterial') o.receiveShadow = true; });
  scene.add(M.root);
  const guns = {};
  for (const s of ['armL', 'armR']) if (lo[s]) guns[s] = { cd: 0, def: WEAPONS[lo[s]] };
  // 部位耐久（只給動畫讀）；腳原本的顏色留著，「損毀」要把它塗黑、復原時塗回來
  for (const k in M.parts) Object.assign(M.parts[k], { hp: 100, max: 100, broken: false });
  M.parts.legs.col0 = M.parts.legs.mat.color.getHex();
  return {
    id: ++uid, key, loadout: lo, model: M, spec, parts: M.parts, guns, k: 1, grunt: false, fly: false,
    x: 0, z: 0, vx: 0, vz: 0, legYaw: 0, torsoYaw: 0, walk: 0, bob: 0, readyK: { L: 0, R: 0 }, swing: null, punch: null, charge: null,
    bx, px: 0, pz: 0,
  };
}
function setUnits(setKey) {
  for (const u of units) scene.remove(u.model.root);
  const keys = SETS[setKey];
  units = keys.map((k, i) => makeUnit(k, (i - (keys.length - 1) / 2) * 2.7));
  for (const u of units) { u.legYaw = u.torsoYaw = state.heading; }
  applyDamage();
  cam.tx = 0;
  const info = units.map(u => `${u.loadout.name}：總重 ${u.spec.total}・負載 ${Math.round(u.spec.loadK * 100)}%${u.spec.loadK > 1 ? '（超載）' : ''}`).join('　');
  document.getElementById('info').textContent = info;
}

// ---- 損傷：照遊戲的做法設部位耐久（腳損毀 = 塗黑不拆、手臂損毀 = 整隻拿掉）----
const HP = { ok: 100, half: 40, low: 15, broken: 0 };
function applyDamage() {
  for (const u of units) {
    const P = u.parts, set = (p, v, broken = false) => { if (p) { p.hp = v; p.broken = broken; } };
    set(P.legs, HP[state.legs], state.legs === 'broken');
    P.legs.mat.color.setHex(state.legs === 'broken' ? 0x5a5048 : P.legs.col0);
    set(P.torso, HP[state.torso]);
    for (const [slot, gone, hurt] of [['armL', 'L', 'hurt'], ['armR', 'R', 'hurt']]) {
      const p = P[slot]; if (!p) continue;
      const broken = state.arms === gone || state.arms === 'both';
      set(p, broken ? 0 : state.arms === hurt ? 15 : 100, broken);
      p.g.visible = !broken;
    }
  }
}
// 腳的出力（src/mech.js 的 legK）：腳受損跑不快
const legK = m => m.parts.legs.broken ? 0.35 : 0.65 + 0.35 * m.parts.legs.hp / m.parts.legs.max;

// ---- 移動（照 src/mech.js driveMech 的加減速簡化；只是給動畫當輸入）----
const GRIP = 30, AIR_DRAG = 0.1, BRAKE_K = 2.2;
const angDiff = (a, b) => { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };
const approach = (a, b, step) => { const d = angDiff(a, b); return Math.abs(d) <= step ? b : a + Math.sign(d) * step; };
function drive(m, dt, ml, heading, fire) {
  const S = m.spec, L = S.legs, vmax = S.vmax * legK(m);
  const mx = Math.sin(heading) * ml, mz = Math.cos(heading) * ml;
  let tx = mx * vmax, tz = mz * vmax;
  if (ml > 0.1) m.legYaw = approach(m.legYaw, heading, S.legTurn * dt);
  if (L.type === 'tread') {
    const fx = Math.sin(m.legYaw), fz = Math.cos(m.legYaw), dot = ml > 0.1 ? (mx * fx + mz * fz) / ml : 0, sp = ml * vmax * Math.max(0, dot);
    tx = fx * sp; tz = fz * sp;
  }
  const dvx = tx - m.vx, dvz = tz - m.vz, dl = Math.hypot(dvx, dvz), v = Math.hypot(m.vx, m.vz), hover = L.type === 'hover';
  const brake = v > 0.3 && dl > 1e-4 ? Math.max(0, -(dvx * m.vx + dvz * m.vz) / (dl * v)) : 0;
  const acc = Math.min(S.acc * (1 + (hover ? 0.3 : BRAKE_K - 1) * brake), GRIP * (L.slide ?? 1) * (L.grip ?? 1));
  const cap = acc * dt, k = dl > cap ? cap / dl : 1;
  m.vx += dvx * k; m.vz += dvz * k;
  const drag = Math.exp(-AIR_DRAG * dt);
  m.vx *= drag; m.vz *= drag;
  m.px += m.vx * dt; m.pz += m.vz * dt;
  m.torsoYaw = approach(m.torsoYaw, heading, S.turn * dt);
  m.walk += dt * (L.type === 'tread' || hover ? 0 : ml * 9 * (L.type === 'reverse' ? 1.15 : 1));
  m.bob += dt;
  for (const s in m.guns) {
    const g = m.guns[s];
    g.cd -= dt;
    if (fire && g.cd <= 0 && g.def.kind !== 'shield' && !m.parts[s].broken) g.cd = Math.max(0.07, g.def.interval ?? 0.5);
  }
}
function pose(m, dt) {
  const M = m.model, hover = m.spec.legs.type === 'hover' ? Math.sin(m.bob * 3) * 0.04 + 0.06 : 0;
  M.root.position.set(m.bx, hover, 0);
  M.legsG.rotation.y = m.legYaw;
  animMech(m, dt);
}

// ---- 操作狀態 ----
const state = { set: 'trio', move: 'auto', fire: false, speed: 1, heading: Math.PI / 2, t: 0, legs: 'ok', arms: 'ok', torso: 'ok' };
// 自動：跑 → 急停 → 邊走邊開火 → 轉身跑 → 停下開火
const AUTO = [[2.6, 1, 0, false], [1.6, 0, 0, false], [2.4, 0.45, 0, true], [2.8, 1, Math.PI, false], [1.4, 0, 0, false], [1.6, 0, 0, true]];
const AUTO_T = AUTO.reduce((a, s) => a + s[0], 0);
function autoAt(t) {
  let u = t % AUTO_T, turn = Math.floor(t / AUTO_T) * Math.PI;
  for (const [d, ml, dh, fire] of AUTO) { if (u < d) return { ml, heading: Math.PI / 2 + turn + dh, fire }; u -= d; }
  return { ml: 0, heading: Math.PI / 2, fire: false };
}

// ---- 鏡頭：拖曳旋轉、滾輪 / 兩指縮放 ----
const cam = { yaw: 0.25, pitch: 0.28, dist: 9.5, tx: 0 };
const VIEWS = { side: [0, 0.16, 9.5], three: [0.6, 0.42, 9.5], game: [0, 0.98, 15] };
function setView(k) { [cam.yaw, cam.pitch, cam.dist] = VIEWS[k]; if (units.length > 1 && k !== 'game') cam.dist += 2.5; }
const ptrs = new Map();
let pinch0 = 0, dist0 = 0;
const el = renderer.domElement;
el.addEventListener('pointerdown', e => { el.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch0 = Math.hypot(a.x - b.x, a.y - b.y); dist0 = cam.dist; } });
el.addEventListener('pointermove', e => {
  const p = ptrs.get(e.pointerId);
  if (!p) return;
  const dx = e.clientX - p.x, dy = e.clientY - p.y;
  p.x = e.clientX; p.y = e.clientY;
  if (ptrs.size === 1) { cam.yaw -= dx * 0.008; cam.pitch = Math.max(0.02, Math.min(1.5, cam.pitch + dy * 0.006)); }
  else if (ptrs.size === 2 && pinch0 > 0) { const [a, b] = [...ptrs.values()]; cam.dist = Math.max(3, Math.min(30, dist0 * pinch0 / Math.max(20, Math.hypot(a.x - b.x, a.y - b.y)))); }
});
const up = e => { ptrs.delete(e.pointerId); pinch0 = 0; };
el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
el.addEventListener('wheel', e => { e.preventDefault(); cam.dist = Math.max(3, Math.min(30, cam.dist * Math.exp(e.deltaY * 0.0012))); }, { passive: false });

function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);

// ---- 介面 ----
function bindGroup(id, key, onChange) {
  const box = document.getElementById(id);
  const sync = () => box.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(String(state[key]) === b.dataset.v)));
  box.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    state[key] = isNaN(+b.dataset.v) || b.dataset.v === '' ? b.dataset.v : +b.dataset.v;
    sync(); onChange?.(state[key]);
  });
  sync();
}
bindGroup('gSet', 'set', v => { setUnits(v); });
bindGroup('gMove', 'move', () => { state.t = 0; });
bindGroup('gSpeed', 'speed');
for (const k of ['legs', 'arms', 'torso']) bindGroup('gD' + k, k, applyDamage);
const fireBtn = document.getElementById('bFire');
fireBtn.addEventListener('click', () => { state.fire = !state.fire; fireBtn.setAttribute('aria-pressed', String(state.fire)); });
document.getElementById('bTurn').addEventListener('click', () => { state.heading += Math.PI / 2; if (state.move === 'auto') { state.move = 'run'; document.querySelectorAll('#gMove button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === 'run'))); } });
document.getElementById('gView').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setView(b.dataset.v); });

// ---- 每幀 ----
const ML = { stand: 0, walk: 0.45, run: 1 };
let last = performance.now();
function frame(now) {
  const raw = Math.min(0.05, (now - last) / 1000); last = now;
  const dt = raw * state.speed;
  if (dt > 0) {
    G.now += dt; state.t += dt;
    const a = state.move === 'auto' ? autoAt(state.t) : { ml: ML[state.move], heading: state.heading, fire: false };
    for (const u of units) { drive(u, dt, a.ml, a.heading, a.fire || state.fire); pose(u, dt); }
    const lead = units[Math.floor(units.length / 2)];
    if (lead) tex.offset.set(lead.px / 2, -lead.pz / 2);
  }
  const cy = Math.cos(cam.pitch);
  // 直式螢幕（手機）：拉遠一點，並排的機體才不會被切掉
  const d = cam.dist * (camera.aspect < 1 ? Math.pow(1 / camera.aspect, units.length > 1 ? 0.9 : 0.35) : 1);
  camera.position.set(cam.tx + Math.sin(cam.yaw) * cy * d, 0.85 + Math.sin(cam.pitch) * d, Math.cos(cam.yaw) * cy * d);
  camera.lookAt(cam.tx, 0.85, 0);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
window.__av = { get units() { return units; }, state, cam };   // 除錯用
setUnits(state.set); setView('three'); resize();
document.getElementById('boot').hidden = true;
requestAnimationFrame(frame);
