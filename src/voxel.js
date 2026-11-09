import * as THREE from 'three';

// 方塊尺寸：1 格 = 1/16 單位
export const V = 1 / 16;
const VOX_GEO = new THREE.BoxGeometry(V, V, V);

// 整數座標的方塊集合；顏色存色盤 key 或直接存 hex
export class VoxelSet {
  constructor() { this.map = new Map(); }
  set(x, y, z, c) { this.map.set(`${x},${y},${z}`, [x, y, z, c]); }
  has(x, y, z) { return this.map.has(`${x},${y},${z}`); }
  // 實心方塊；c 可以是函式 (i, j, k) => 顏色，回傳 null 就跳過該格
  box(x, y, z, w, h, d, c) {
    for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) for (let k = 0; k < d; k++) {
      const col = typeof c === 'function' ? c(i, j, k) : c;
      if (col !== null && col !== undefined) this.set(x + i, y + j, z + k, col);
    }
    return this;
  }
}

// 對齊方式：'center' | 'min' | 'max' | 'none'（保留原始座標）
function axisOffset(mode, min, max) {
  if (mode === 'center') return -(min + max + 1) / 2;
  if (mode === 'min') return -min;
  if (mode === 'max') return -(max + 1);
  return 0;
}

// ---------- 每顆方塊的明暗：環境光遮蔽 + 顏色雜訊 ----------
// 遮蔽：數周圍 26 格有幾格有方塊。平面上的方塊 = 17 格；凹進去的角落、縫隙更多 → 壓暗；凸出的邊角更少 → 稍微亮一點（像邊緣反光）
// 雜訊：照座標雜湊，每顆亮度差一點點（同一個模型每次蓋出來都一樣）
const AO_K = 0.07, AO_MIN = 0.55, AO_MAX = 1.12, NOISE = 0.13;
const vhash = (x, y, z) => { let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0; h = (h ^ (h >> 13)) * 1274126177; return ((h ^ (h >> 16)) >>> 0) / 4294967296; };
export function shadeOf(set, x, y, z) {
  let occ = 0;
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (let k = -1; k <= 1; k++) if ((i || j || k) && set.has(x + i, y + j, z + k)) occ++;
  const ao = Math.max(AO_MIN, Math.min(AO_MAX, 1 + (17 - occ) * AO_K));
  return ao * (1 + (vhash(x, y, z) - 0.5) * NOISE);
}

// 只放外露的方塊（被六面包住的看不到，省效能）
export function buildVoxelMesh(set, material, palette = {}, anchor = { x: 'none', y: 'none', z: 'none' }) {
  const all = [...set.map.values()];
  const mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (const v of all) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], v[a]); mx[a] = Math.max(mx[a], v[a]); }
  const off = all.length
    ? [axisOffset(anchor.x, mn[0], mx[0]), axisOffset(anchor.y, mn[1], mx[1]), axisOffset(anchor.z, mn[2], mx[2])]
    : [0, 0, 0];
  const surf = all.filter(([x, y, z]) => !(set.has(x + 1, y, z) && set.has(x - 1, y, z) && set.has(x, y + 1, z)
    && set.has(x, y - 1, z) && set.has(x, y, z + 1) && set.has(x, y, z - 1)));

  const mesh = new THREE.InstancedMesh(VOX_GEO, material, Math.max(1, surf.length));
  mesh.count = surf.length;
  const m = new THREE.Matrix4(), col = new THREE.Color();
  const voxels = [];
  surf.forEach(([x, y, z, c], i) => {
    const px = (x + 0.5 + off[0]) * V, py = (y + 0.5 + off[1]) * V, pz = (z + 0.5 + off[2]) * V;
    const hex = typeof c === 'number' ? c : (palette[c] ?? 0xff00ff);
    m.makeTranslation(px, py, pz);
    mesh.setMatrixAt(i, m);
    col.setHex(hex).multiplyScalar(shadeOf(set, x, y, z));
    mesh.setColorAt(i, col);
    voxels.push({ x: px, y: py, z: pz, c: col.getHex() });   // c = 實際顯示的顏色（磨損的碎片、焦痕照這個）
  });
  mesh.castShadow = true;
  mesh.frustumCulled = false;     // 實例會偏離原點，預設的包圍球不準
  mesh.userData.voxels = voxels;
  return mesh;
}

// 從一個物件底下所有方塊網格隨機取 n 顆的世界座標（爆開用）
const tmp = new THREE.Vector3();
export function sampleVoxels(root, n) {
  root.updateMatrixWorld(true);
  const all = [];
  root.traverse(o => {
    if (o.isInstancedMesh && o.userData.voxels) for (const v of o.userData.voxels) if (!v.gone) all.push([o, v]);   // gone：已經被打掉（mech.js syncChips）
  });
  const out = [];
  for (let i = 0; i < n && all.length; i++) {
    const j = Math.floor(Math.random() * all.length);
    const [o, v] = all[j];
    all[j] = all[all.length - 1]; all.pop();
    tmp.set(v.x, v.y, v.z).applyMatrix4(o.matrixWorld);
    out.push({ x: tmp.x, y: tmp.y, z: tmp.z, c: v.c });
  }
  return out;
}
