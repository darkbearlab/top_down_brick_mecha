// ---------- 機體模型：照配裝把零件的方塊組起來 ----------
// 顏色：a = 該部位的裝甲色（複合深灰、陶瓷白、鏡面淡藍反光）、f = 骨架、t = 隊伍色、g = 隊伍發光色、w = 武器屬性色
// 每個部位一個群組、一個材質（受傷閃白、壞掉燒黑各自處理）
import * as THREE from 'three';
import { VoxelSet, buildVoxelMesh } from './voxel.js';
import { addMat } from './core.js';
import { ARMORS, CORES, DMG_TYPES, HEADS, LEGS, WEAPONS } from './parts.js';

export const V = 1 / 16;
const FRAME = 0x2c323c;

function voxSet(boxes, pal) {
  const s = new VoxelSet();
  for (const [x, y, z, w, h, d, k] of boxes) s.box(x, y, z, w, h, d, pal[k] ?? k);
  return s;
}
function partGroup(boxes, pal, parent, armor) {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const base = ARMORS[armor]?.sheen ? 0x1a2838 : 0x000000;   // 鏡面裝甲微微發亮
  mat.emissive.setHex(base);
  const g = new THREE.Group();
  if (boxes.length) g.add(buildVoxelMesh(voxSet(boxes, pal), mat));
  parent.add(g);
  return { g, mat, base };
}
// team.tint：裝甲色往隊伍色混多少（雜魚用，整台看起來就是那一邊的顏色）
const mix = (a, b, k) => k ? new THREE.Color(a).lerp(new THREE.Color(b), k).getHex() : a;
const pal = (armor, team, wtype) => ({ a: mix(ARMORS[armor].hex, team.accent, team.tint ?? 0), f: mix(FRAME, team.accent, (team.tint ?? 0) * 0.35), t: team.accent, g: team.glow, w: wtype ? DMG_TYPES[wtype].hex : team.accent });

// 核心（菁英）：部位裡面一團發光的方塊，外面包一層 1 格厚的殼（殼在部位的方塊裡，表面被打掉就露出核心）
// 用 MeshBasic + 超過 1 的顏色 → 泛光會讓它發亮；userData.core = 不算磨損、不算殼
const CORE_C = new THREE.Color(2.6, 0.75, 0.28);
export const shellBox = ([x, y, z, w, h, d]) => [x - 1, y - 1, z - 1, w + 2, h + 2, d + 2, 'a'];
function addCore(part, [x, y, z, w, h, d], crit, gate) {
  const mat = new THREE.MeshBasicMaterial({ color: CORE_C.clone() });
  const s = new VoxelSet(); s.box(x, y, z, w, h, d, 0xffffff);
  const mesh = buildVoxelMesh(s, mat);
  mesh.castShadow = false; mesh.userData.core = true;
  part.g.add(mesh);
  // 殼的範圍（群組本地座標）：拿來判斷被打掉的方塊在哪一面
  part.core = { mesh, mat, base: CORE_C, crit, gate, c: [(x + w / 2) * V, (y + h / 2) * V, (z + d / 2) * V], half: [(w / 2 + 1) * V, (h / 2 + 1) * V, (d / 2 + 1) * V] };
}

// 腳的模型
function buildLegs(lo, team, legsG) {
  const L = LEGS[lo.legs], P = pal(lo.armor.legs, team), hy = Math.round(L.hipY * 16);
  const part = partGroup([], P, legsG, lo.armor.legs);
  const swing = [];
  const B = lo.body;
  if (B?.treads) { part.g.add(buildVoxelMesh(voxSet(B.treads, P), part.mat)); return { part, swing }; }   // 自訂履帶（不擺動）
  if (B?.leg) {
    part.g.add(buildVoxelMesh(voxSet(B.hip ?? [], P), part.mat));
    for (const s of [-1, 1]) {
      const g = new THREE.Group();
      g.add(buildVoxelMesh(voxSet(B.leg, P), part.mat));
      g.position.set(s * 0.22, L.hipY, 0);
      part.g.add(g); swing.push(g);
    }
    return { part, swing };
  }
  const addLeg = (s, boxes) => {
    const g = new THREE.Group();
    g.add(buildVoxelMesh(voxSet(boxes, P), part.mat));
    g.position.set(s, L.hipY, 0);
    part.g.add(g);
    swing.push(g);
  };
  if (L.type === 'biped') {
    part.g.add(buildVoxelMesh(voxSet([[-5, hy - 2, -2, 10, 3, 5, 'f']], P), part.mat));
    for (const s of [-1, 1]) addLeg(s * 0.28, [[-1, -7, -2, 3, 7, 4, 'f'], [-2, -9, 0, 4, 3, 3, 'a'], [-2, -14, -2, 4, 6, 4, 'a'], [-1, -15, -1, 2, 1, 2, 'f'], [-2, -16, -3, 4, 2, 8, 'f'], [-2, -16, 4, 4, 1, 1, 't']]);
  } else if (L.type === 'reverse') {
    part.g.add(buildVoxelMesh(voxSet([[-5, hy - 2, -2, 10, 3, 5, 'f']], P), part.mat));
    for (const s of [-1, 1]) addLeg(s * 0.3, [[-1, -6, 0, 3, 6, 4, 'a'], [-1, -8, 2, 3, 2, 3, 'f'], [-1, -13, -3, 3, 6, 3, 'a'], [-2, -17, -2, 4, 3, 8, 'f'], [-1, -14, -4, 2, 2, 1, 't']]);
  } else if (L.type === 'tread') {
    part.g.add(buildVoxelMesh(voxSet([
      [-5, 7, -4, 10, 6, 8, 'f'], [-11, 0, -10, 5, 8, 20, 'a'], [6, 0, -10, 5, 8, 20, 'a'],
      [-11, 0, -11, 5, 6, 1, 'f'], [6, 0, -11, 5, 6, 1, 'f'], [-11, 0, 10, 5, 6, 1, 'f'], [6, 0, 10, 5, 6, 1, 'f'],
      [-12, 2, -6, 1, 3, 12, 't'], [11, 2, -6, 1, 3, 12, 't']], P), part.mat));
  } else {
    // 懸浮：一圈裙甲，底下發光
    part.g.add(buildVoxelMesh(voxSet([
      [-4, 9, -3, 8, 5, 6, 'f'], [-9, 4, -9, 18, 4, 18, 'a'], [-7, 2, -7, 14, 2, 14, 'f'],
      [-8, 1, -8, 16, 1, 1, 'g'], [-8, 1, 7, 16, 1, 1, 'g'], [-8, 1, -7, 1, 1, 14, 'g'], [7, 1, -7, 1, 1, 14, 'g'], [-2, 8, 9, 4, 2, 1, 't']], P), part.mat));
  }
  return { part, swing };
}

// 掛點在上半身的位置（方塊單位）
export function mountPos(lo, slot) {
  const C = CORES[lo.core], s = slot.endsWith('L') ? 1 : -1;
  return slot.startsWith('arm') ? [s * (C.halfW + 3), 0, 0] : [s * (C.halfW - 2), C.top - 1, -6];
}
// 手臂：手在 (0, 1, 4)
const ARM = [[-2, 6, -3, 5, 5, 6, 'a'], [-1, 3, -1, 3, 4, 3, 'f'], [-2, 0, -1, 4, 3, 5, 'a'], [-2, 7, -3, 5, 1, 2, 't']];
const HAND = [0, 1, 4];

export function buildMechModel(lo, team) {
  const root = new THREE.Group();
  const legsG = new THREE.Group();
  root.add(legsG);
  const legs = buildLegs(lo, team, legsG);
  const C = CORES[lo.core], H = HEADS[lo.head], hipY = LEGS[lo.legs].hipY;
  const torsoG = new THREE.Group();
  torsoG.position.y = hipY;
  torsoG.rotation.order = 'YXZ';
  root.add(torsoG);
  const parts = { legs: legs.part };
  const B = lo.body, CO = lo.cores ?? {};
  const shell = k => CO[k] ? [shellBox(CO[k].box)] : [];
  parts.torso = partGroup([...shell('torso'), ...(B?.torso ?? C.model)], pal(lo.armor.torso, team), torsoG, lo.armor.torso);
  parts.head = partGroup([...shell('head'), ...(B?.head ?? H.model)], pal(lo.armor.head, team), torsoG, lo.armor.head);
  for (const k of ['torso', 'head']) if (CO[k]) addCore(parts[k], CO[k].box, !!CO[k].crit, CO[k].gate);
  parts.head.g.position.y = C.top * V;
  const weapons = {}, muzzles = {};
  for (const slot of ['armL', 'armR', 'backL', 'backR']) {
    const id = lo[slot], W = id ? WEAPONS[id] : null;
    const [mx, my, mz] = mountPos(lo, slot);
    const arm = slot.startsWith('arm');
    if (!arm && !W) continue;
    const armorKey = arm ? lo.armor.arms : lo.armor.torso;
    const P = pal(armorKey, team, W?.type);
    const boxes = arm ? [...(lo.body?.arm ?? ARM)] : [];
    // 武器接在手上 / 背上
    const off = arm ? HAND : [0, 0, 0];
    if (W) for (const [x, y, z, w, h, d, k] of W.model) boxes.push([x + off[0], y + off[1], z + off[2], w, h, d, k]);
    const p = partGroup(boxes, P, torsoG, armorKey);
    p.g.position.set(mx * V, my * V, mz * V);
    parts[slot] = p;
    if (W) {
      muzzles[slot] = [(mx + off[0] + W.muzzle[0]) * V, (my + off[1] + W.muzzle[1]) * V, (mz + off[2] + W.muzzle[2]) * V];
      // 光束劍：發光的刀身
      if (W.kind === 'saber') {
        const blade = new THREE.Group();
        const core = new THREE.Mesh(new THREE.BoxGeometry(1.2 * V, 1.2 * V, W.blade * V), addMat(0xffffff, 0.95));
        const glow = new THREE.Mesh(new THREE.BoxGeometry(3 * V, 3 * V, (W.blade + 1) * V), addMat(DMG_TYPES.energy.hex, 0.55));
        blade.add(core, glow);
        blade.position.set((off[0] + 0) * V, (off[1] + 0.5) * V, (off[2] + 3 + W.blade / 2) * V);
        p.g.add(blade);
        weapons[slot] = { blade };
      }
    }
  }
  root.traverse(o => { if (o.isMesh && o.material.type === 'MeshLambertMaterial') o.castShadow = true; });
  return { root, legsG, legs: legs.swing, torsoG, parts, muzzles, weapons, hipY };
}
