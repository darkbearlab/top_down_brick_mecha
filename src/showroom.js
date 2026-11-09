// ---------- 展示空間（主選單、整備） ----------
// 主選單和整備時不畫戰場（中央的建築會把機體整個擋住），改畫一個獨立的場景：
//   中間一塊暗色的圓台（機體站在上面，台邊一圈紫光跟著脈動）
//   四周一大片方塊柱，像從機體往外推的心跳一樣一圈一圈起伏；波峰經過時柱頂的發光條亮起來（紫 → 偏粉），泛光讓它暈開
//   越外面越高（像碗的內壁）、越外面越暗（霧），畫面邊緣自然收進黑暗
// 機體：顯示期間把玩家機體的模型搬進這個場景（位置不變，整個展示空間跟著機體的位置擺）；離開時搬回去
import * as THREE from 'three';

export const showScene = new THREE.Scene();
showScene.background = new THREE.Color(0x06040b);
showScene.fog = new THREE.Fog(0x06040b, 9, 22);

const root = new THREE.Group();
showScene.add(root);

// 燈：偏紫的環境光 + 一盞白色主光（有影子）+ 背後一盞紫色輪廓光
const hemi = new THREE.HemisphereLight(0x9a86d8, 0x120a1c, 1.0);
const key = new THREE.DirectionalLight(0xfff0e6, 2.2);
key.position.set(-5, 12, 7);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
Object.assign(key.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 40 });
key.shadow.bias = -0.0008;
const rim = new THREE.DirectionalLight(0xa060ff, 1.6);
rim.position.set(4, 5, -9);
root.add(hemi, key, key.target, rim);

// 方塊柱：格子上的圓環（半徑 PAD 以內是圓台）
// 方塊邊長 CELL（比機體的方塊大、比地圖格子小）；圓台只比機體大一點
const PAD = 1.9, OUTER = 17, CELL = 0.5, COL_H = 4, GAP = CELL * 0.92;
const cells = [];
for (let i = -OUTER / CELL; i <= OUTER / CELL; i++) for (let j = -OUTER / CELL; j <= OUTER / CELL; j++) {
  const x = i * CELL, z = j * CELL, r = Math.hypot(x, z);
  if (r < PAD + 0.35 || r > OUTER) continue;
  cells.push({ x, z, r, a: Math.atan2(z, x), n: Math.random() });
}
const N = cells.length;
const boxGeo = new THREE.BoxGeometry(GAP, COL_H, GAP);
const colMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
const cols = new THREE.InstancedMesh(boxGeo, colMat, N);
cols.receiveShadow = true;
// 柱頂的發光條（薄薄一片，比柱子小一圈）
const capGeo = new THREE.BoxGeometry(GAP * 0.6, 0.05, GAP * 0.6);
const capMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
const caps = new THREE.InstancedMesh(capGeo, capMat, N);
const c0 = new THREE.Color();
cells.forEach((c, i) => {
  // 柱子本身：深紫灰，每根亮度差一點
  cols.setColorAt(i, c0.setRGB(0.085, 0.07, 0.13).multiplyScalar(0.75 + c.n * 0.5));
  caps.setColorAt(i, c0.setRGB(0, 0, 0));
});
cols.frustumCulled = caps.frustumCulled = false;
root.add(cols, caps);

// 中間的圓台：暗色、邊上一圈發光
const pad = new THREE.Mesh(new THREE.CylinderGeometry(PAD, PAD + 0.15, 0.6, 48), new THREE.MeshLambertMaterial({ color: 0x1c1826 }));
pad.position.y = -0.3; pad.receiveShadow = true;
const ringMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
const ring = new THREE.Mesh(new THREE.TorusGeometry(PAD - 0.08, 0.03, 6, 64), ringMat);
ring.rotation.x = Math.PI / 2; ring.position.y = 0.02;
const inner = new THREE.Mesh(new THREE.TorusGeometry(PAD * 0.6, 0.015, 6, 48), ringMat);
inner.rotation.x = Math.PI / 2; inner.position.y = 0.02;
root.add(pad, ring, inner);

const GLOW = new THREE.Color(0.55, 0.25, 1.0), HOT = new THREE.Color(0.95, 0.4, 0.95);
const m4 = new THREE.Matrix4();
let t = 0;
// 心跳的波：BEAT 秒一下，從中間往外推（WAVE_V 格 / 秒）；另外疊一層很慢的大起伏
const BEAT = 1.6, WAVE_V = 5, BEAT_W = 0.45;
function topAt(c) {
  const base = 0.1 * (c.r - PAD) + 0.035 * (c.r - PAD) ** 1.5 - 0.12;                    // 越外面越高
  const swell = Math.sin(c.r * 0.5 - t * 0.6 + c.a * 3) * 0.12 + Math.sin(c.x * 0.9 + t * 0.4) * Math.sin(c.z * 0.8 - t * 0.3) * 0.08;                            // 慢的大起伏
  // 心跳：上一次、上上次的波前各推出去一圈
  let pulse = 0;
  for (let k = 0; k < 3; k++) {
    const front = ((t / BEAT) % 1 + k) * BEAT * WAVE_V, d = c.r - PAD - front;
    pulse += Math.exp(-(d * d) / BEAT_W) * Math.max(0, 1 - (front / (OUTER * 1.1)));
  }
  return { y: base + swell + pulse * 0.55, g: pulse };
}
export function updateShowroom(dt, x, z) {
  t += dt;
  root.position.set(x, 0, z);
  key.target.position.set(0, 0, 0);
  for (let i = 0; i < N; i++) {
    const c = cells[i], { y, g } = topAt(c);
    m4.makeTranslation(c.x, y - COL_H / 2, c.z); cols.setMatrixAt(i, m4);
    m4.makeTranslation(c.x, y + 0.03, c.z); caps.setMatrixAt(i, m4);
    // 發光：平常很暗的紫，波峰經過亮起來、最亮偏粉；離中間越遠越淡
    const fade = Math.max(0, 1 - c.r / OUTER), k = 0.05 + g * 1.7;
    caps.setColorAt(i, c0.copy(GLOW).lerp(HOT, Math.min(1, g)).multiplyScalar(k * (0.35 + 0.65 * fade)));
  }
  cols.instanceMatrix.needsUpdate = caps.instanceMatrix.needsUpdate = true;
  caps.instanceColor.needsUpdate = true;
  // 圓台邊的光圈跟著心跳亮一下
  const beat = Math.exp(-(((t % BEAT) / 0.18) ** 2));
  ringMat.color.copy(GLOW).multiplyScalar(1.2 + beat * 2.5);
}

// 把機體的模型搬進 / 搬出展示空間
let shown = null;
export function showMech(model, mainScene) {
  if (shown && shown !== model) showScene.remove(shown);   // 換了機體（整備改配裝會重蓋）：舊的直接丟掉
  if (model.parent !== showScene) showScene.add(model);
  shown = model;
}
// current = 現在的玩家機體模型：還是同一台就搬回戰場；已經換掉（開新一局重生了）就直接丟掉舊的
export function hideMech(mainScene, current) {
  if (shown?.parent === showScene) shown === current ? mainScene.add(shown) : showScene.remove(shown);
  shown = null;
}
