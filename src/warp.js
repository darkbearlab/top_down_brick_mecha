// ---------- 傳送演出：機體分解成小方塊往上飛走 ----------
// 一條青色掃描環從頭頂往腳下掃（SWEEP 秒），掃過的地方機體的方塊消失；每消失一些就放出一顆發光的小方塊
// 小方塊先是原本的顏色、很快變成青白色，越飛越快往上、邊飛邊縮小
// 方塊直接拿模型身上的 voxel（壞掉藏起來的部位不算），用一個 InstancedMesh 畫
import * as THREE from 'three';
import { UNIT_BOX, addMat, scene } from './core.js';

const SWEEP = 1.1, MAX = 1400, CUBES = 650;
const mesh = new THREE.InstancedMesh(UNIT_BOX, new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), MAX);
mesh.frustumCulled = false; mesh.count = 0;
mesh.setColorAt(0, new THREE.Color());
scene.add(mesh);
const ring = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.0, 40), addMat(0x60f0ff, 0.9));
ring.rotation.x = -Math.PI / 2; ring.visible = false;
scene.add(ring);

const ZERO = new THREE.Matrix4().makeScale(0, 0, 0), mtx = new THREE.Matrix4(), col = new THREE.Color(), HOT = new THREE.Color(0xb0faff), v3 = new THREE.Vector3();
let W = null;
const cubes = [];

// 這個物件（和它所有的上層）都看得到
const shown = (o, root) => { for (let p = o; p; p = p.parent) { if (!p.visible) return false; if (p === root) return true; } return true; };

export function startWarp(root) {
  root.updateMatrixWorld(true);
  const vox = [];
  root.traverse(o => {
    if (o.isInstancedMesh && o.userData.voxels) {
      if (!shown(o, root)) return;
      o.userData.voxels.forEach((v, i) => { v3.set(v.x, v.y, v.z).applyMatrix4(o.matrixWorld); vox.push({ o, i, x: v3.x, y: v3.y, z: v3.z, c: v.c }); });
    } else if (o.isMesh) o.visible = false;   // 腳下的圈、推進器的火之類：直接收掉
  });
  vox.sort((a, b) => b.y - a.y);
  const top = vox.length ? vox[0].y : 2, bot = vox.length ? vox[vox.length - 1].y : 0;
  const pos = root.getWorldPosition(new THREE.Vector3());
  W = { t: 0, vox, n: 0, top: top + 0.05, bot: bot - 0.05, p: Math.min(1, CUBES / Math.max(1, vox.length)), x: pos.x, z: pos.z };
  ring.position.set(W.x, W.top, W.z); ring.visible = true; ring.scale.setScalar(1);
}
export const warpActive = () => !!W;

export function updateWarp(dt) {
  if (W) {
    W.t += dt;
    const k = Math.min(1, W.t / SWEEP), line = W.top - (W.top - W.bot) * k * k * (3 - 2 * k);
    const touched = new Set();
    while (W.n < W.vox.length && W.vox[W.n].y > line) {
      const v = W.vox[W.n++];
      v.o.setMatrixAt(v.i, ZERO); touched.add(v.o);
      if (Math.random() < W.p && cubes.length < MAX) {
        const a = Math.random() * Math.PI * 2, s = 0.5 + Math.random();
        cubes.push({ x: v.x, y: v.y, z: v.z, vx: Math.cos(a) * s, vy: 0.5 + Math.random() * 1.5, vz: Math.sin(a) * s,
          t: 0, life: 0.9 + Math.random() * 0.6, s: 0.1 + Math.random() * 0.09, c: new THREE.Color(v.c), r: Math.random() * 3, vr: (Math.random() - 0.5) * 10 });
      }
    }
    for (const o of touched) o.instanceMatrix.needsUpdate = true;
    ring.position.y = line;
    ring.scale.setScalar(0.8 + 0.4 * Math.sin(k * Math.PI));
    ring.material.opacity = k < 1 ? 0.9 : Math.max(0, 0.9 - (W.t - SWEEP) * 4);
    if (W.t > SWEEP + 0.3) { ring.visible = false; W = null; }
  }
  // 飛走的方塊
  let n = 0;
  for (let i = cubes.length - 1; i >= 0; i--) {
    const q = cubes[i];
    if ((q.t += dt) >= q.life) { cubes[i] = cubes[cubes.length - 1]; cubes.pop(); continue; }
    q.vy += 22 * dt; q.vx *= 1 - 2 * dt; q.vz *= 1 - 2 * dt;
    q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt; q.r += q.vr * dt;
    const f = q.t / q.life, s = q.s * (1 - f * f);
    mtx.makeRotationY(q.r).scale(v3.set(s, s, s)).setPosition(q.x, q.y, q.z);
    mesh.setMatrixAt(n, mtx);
    mesh.setColorAt(n, col.copy(q.c).lerp(HOT, Math.min(1, q.t * 4)));
    n++;
  }
  mesh.count = n;
  if (n) { mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true; }
}
export function clearWarp() { W = null; cubes.length = 0; mesh.count = 0; ring.visible = false; }
