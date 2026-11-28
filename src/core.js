import * as THREE from 'three';

// ---------- 無頭模式（伺服器 / 模擬器）----------
// 載入任何遊戲模組之前設 globalThis.__HEADLESS__ = true（src/headless.js）→ 只跑遊戲規則：
//   不建渲染器、場景不收東西、不蓋方塊模型 / 建築方塊 / 地板貼圖 / 粒子 / 殘骸 / 光束 / 光環…；瀏覽器裡永遠是 false
export const HEADLESS = !!globalThis.__HEADLESS__;
// 無頭時代替「只為了畫面」的物件（子彈、光環、雷射…）：大家共用這一個，位置、透明度被誰改都沒關係；add / remove 不收任何東西
class VoidObject extends THREE.Object3D {
  add() { return this; }
  remove() { return this; }
}
export const VOID = HEADLESS ? new VoidObject() : null;
if (VOID) {
  VOID.material = { opacity: 1, color: new THREE.Color(), emissive: new THREE.Color(), dispose() {} };
  VOID.geometry = { dispose() {} };
}

// ---------- 基本場景 ----------
export const container = HEADLESS ? null : document.getElementById('game');
export const renderer = HEADLESS ? null : new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
if (!HEADLESS) {
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
}

// 無頭：場景是空殼（scene.add 不收東西 → 沒人留著的畫面物件馬上可以回收）
export const scene = HEADLESS ? new VoidObject() : new THREE.Scene();
if (!HEADLESS) scene.background = new THREE.Color(0x0b0d12);

export const camera = new THREE.PerspectiveCamera(42, 1, 0.5, 160);
export const CAM_PITCH = THREE.MathUtils.degToRad(60);
export let camDist = 30;
export function resize() {
  if (!HEADLESS) renderer.setSize(innerWidth, innerHeight);
  camera.aspect = HEADLESS ? 16 / 9 : innerWidth / innerHeight;   // 無頭：沒有視窗，照 1280×720 算（camDist 有些 AI 判斷會用）
  camera.updateProjectionMatrix();
  const t = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  // 電腦版：至少看到 ~17 格高、~22 格寬
  camDist = Math.max(8.5 / t, 11 / (t * camera.aspect));
}
if (!HEADLESS) addEventListener('resize', resize);
resize();

export const hemi = HEADLESS ? null : new THREE.HemisphereLight(0xc8d8ff, 0x2a2018, 1.3);
export const sun = HEADLESS ? null : new THREE.DirectionalLight(0xfff2e0, 2.4);
if (!HEADLESS) {
  scene.add(hemi);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -22, right: 22, top: 22, bottom: -22, near: 1, far: 80 });
  sun.shadow.bias = -0.0008;
  scene.add(sun, sun.target);
}

// ---------- 共用幾何與材質 ----------
// 無頭：沒有共用幾何（用到的地方都換成 VOID 了）
export const UNIT_BOX = HEADLESS ? null : new THREE.BoxGeometry(1, 1, 1);
export const DEBRIS_GEO = HEADLESS ? null : new THREE.BoxGeometry(0.16, 0.16, 0.16);
export const FLASH_GEO = HEADLESS ? null : new THREE.IcosahedronGeometry(0.25, 0);
export const addMat = (color, opacity = 1) => new THREE.MeshBasicMaterial({
  color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
});
const debrisMats = new Map();
export const debrisMat = c => {
  if (!debrisMats.has(c)) debrisMats.set(c, new THREE.MeshLambertMaterial({ color: c }));
  return debrisMats.get(c);
};

export const WALL_H = 1.8;

// ---------- 共用狀態 ----------
export const G = { now: 0, hitStop: 0, slowMo: 0, trauma: 0, paused: false };
// 畫面：hdr = 發光的東西（火、火花、爆炸、子彈、光束）亮度乘多少（> 1 = 超過白、靠色調映射壓回來 → 亮到溢出但不死白）
//   色調映射關掉（設定）時 = 1（照舊）
export const GFX = { hdr: 2.2 };
export const camTarget = new THREE.Vector3();
export function addTrauma(v) { G.trauma = Math.min(1, G.trauma + v); }
export const angleDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
export function approachAngle(a, t, maxStep) {
  const d = angleDiff(a, t);
  return Math.abs(d) <= maxStep ? t : a + Math.sign(d) * maxStep;
}
