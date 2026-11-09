// ---------- 機體模型：照配裝把零件的方塊組起來 ----------
// 顏色：a = 該部位的裝甲色（複合深灰、陶瓷白、鏡面淡藍反光）、f = 骨架、t = 隊伍色、g = 隊伍發光色、w = 武器屬性色
// 每個部位一個群組、一個材質（受傷閃白、壞掉燒黑各自處理）
// 外型資料：每個零件一個 key（getShape）→ 優先順序：零件工坊正在試穿的（shapeOverrides）> 編輯過的正式版（src/shapes.js）> 零件原本的方塊
//   方塊一律換成細格單位（1/32）再蓋；掛點、槍口、手、頭的位置用設計單位（1/16）
import * as THREE from 'three';
import { voxelBody } from './voxbody.js';
import { addMat } from './core.js';
import { ARMORS, CORES, DMG_TYPES, ELITES, HEADS, LEGS, WEAPONS } from './parts.js';
import { SHAPES } from './shapes.js';

export const V = 1 / 16;
const FRAME = 0x2c323c;

// ---------- 零件原本的外型 ----------
// 手臂：手在 (0, 1, 4)
const ARM = [[-2, 6, -3, 5, 5, 6, 'a'], [-1, 3, -1, 3, 4, 3, 'f'], [-2, 0, -1, 4, 3, 5, 'a'], [-2, 7, -3, 5, 1, 2, 't']];
const HAND = [0, 1, 4];
// 腳：pelvis = 不擺動的那塊（骨盆 / 整組履帶 / 懸浮裙甲）；leg = 一隻腳（原點 = 髖關節，往下長）；x = 髖關節離中線多遠（單位）
const LEG_SHAPES = {
  biped: { pelvis: hy => [[-5, hy - 2, -2, 10, 3, 5, 'f']], x: 0.28,
    leg: [[-1, -7, -2, 3, 7, 4, 'f'], [-2, -9, 0, 4, 3, 3, 'a'], [-2, -14, -2, 4, 6, 4, 'a'], [-1, -15, -1, 2, 1, 2, 'f'], [-2, -16, -3, 4, 2, 8, 'f'], [-2, -16, 4, 4, 1, 1, 't']] },
  reverse: { pelvis: hy => [[-5, hy - 2, -2, 10, 3, 5, 'f']], x: 0.3,
    leg: [[-1, -6, 0, 3, 6, 4, 'a'], [-1, -8, 2, 3, 2, 3, 'f'], [-1, -13, -3, 3, 6, 3, 'a'], [-2, -17, -2, 4, 3, 8, 'f'], [-1, -14, -4, 2, 2, 1, 't']] },
  tread: { pelvis: () => [
    [-5, 7, -4, 10, 6, 8, 'f'], [-11, 0, -10, 5, 8, 20, 'a'], [6, 0, -10, 5, 8, 20, 'a'],
    [-11, 0, -11, 5, 6, 1, 'f'], [6, 0, -11, 5, 6, 1, 'f'], [-11, 0, 10, 5, 6, 1, 'f'], [6, 0, 10, 5, 6, 1, 'f'],
    [-12, 2, -6, 1, 3, 12, 't'], [11, 2, -6, 1, 3, 12, 't']] },
  // 懸浮：一圈裙甲，底下發光
  hover: { pelvis: () => [
    [-4, 9, -3, 8, 5, 6, 'f'], [-9, 4, -9, 18, 4, 18, 'a'], [-7, 2, -7, 14, 2, 14, 'f'],
    [-8, 1, -8, 16, 1, 1, 'g'], [-8, 1, 7, 16, 1, 1, 'g'], [-8, 1, -7, 1, 1, 14, 'g'], [7, 1, -7, 1, 1, 14, 'g'], [-2, 8, 9, 4, 2, 1, 't']] },
};
const corePoints = C => ({ head: [0, C.top, 0], armL: [C.halfW + 3, 0, 0], backL: [C.halfW - 2, C.top - 1, -6] });
const eliteOf = name => ELITES.find(E => E.name === name);
// 原本的外型（設計單位）：{ boxes, points }；沒有這個零件 → null
export function legacyShape(key) {
  const [kind, id, sub] = key.split(':');
  if (kind === 'head') return HEADS[id] && { boxes: HEADS[id].model, points: {} };
  if (kind === 'core') return CORES[id] && { boxes: CORES[id].model, points: corePoints(CORES[id]) };
  if (kind === 'arm') return { boxes: ARM, points: { hand: HAND } };
  if (kind === 'weapon') return WEAPONS[id] && { boxes: WEAPONS[id].model, points: { muzzle: WEAPONS[id].muzzle } };
  if (kind === 'legs' || kind === 'leg') {
    const L = LEG_SHAPES[LEGS[id]?.type ?? id], hy = Math.round((LEGS[id]?.hipY ?? 1) * 16);
    if (!L) return null;
    if (kind === 'leg') return L.leg ? { boxes: L.leg, points: {} } : null;
    return { boxes: L.pelvis(hy), points: L.leg ? { legL: [L.x * 16, hy, 0] } : {} };
  }
  if (kind === 'elite') {
    const E = eliteOf(id), B = E?.body;
    if (!B) return null;
    const hy = Math.round(LEGS[E.legs].hipY * 16);
    if (sub === 'torso') return B.torso ? { boxes: B.torso, points: corePoints(CORES[E.core]) } : legacyShape(`core:${E.core}`);
    if (sub === 'head') return B.head ? { boxes: B.head, points: {} } : legacyShape(`head:${E.head}`);
    if (sub === 'arm') return B.arm ? { boxes: B.arm, points: { hand: HAND } } : legacyShape('arm');
    if (sub === 'legs') return B.treads ? { boxes: B.treads, points: {} } : B.leg ? { boxes: B.hip ?? [], points: { legL: [0.22 * 16, hy, 0] } } : legacyShape(`legs:${E.legs}`);
    if (sub === 'leg') return B.treads ? null : B.leg ? { boxes: B.leg, points: {} } : legacyShape(`leg:${E.legs}`);
  }
  return null;
}
// 零件工坊試穿中的外型（這次開著遊戲才有效）
export const shapeOverrides = {};
// 細格單位的外型：{ boxes（1/32）, points（1/16）}
const toFine = S => S && { boxes: S.fine ? S.boxes : S.boxes.map(([x, y, z, w, h, d, k]) => [x * 2, y * 2, z * 2, w * 2, h * 2, d * 2, k]), points: S.points ?? {} };
export function getShape(key) {
  if (shapeOverrides[key]) return toFine({ ...shapeOverrides[key], fine: true });
  if (SHAPES[key]) return toFine({ ...SHAPES[key], fine: true });
  return toFine(legacyShape(key));
}
// 這台機體每個部位用哪個 key（菁英用自己的）
export function shapeKeys(lo) {
  const E = lo.body ? `elite:${lo.name}:` : null;
  return {
    torso: E ? E + 'torso' : `core:${lo.core}`, head: E ? E + 'head' : `head:${lo.head}`, arm: E ? E + 'arm' : 'arm',
    legs: E ? E + 'legs' : `legs:${lo.legs}`, leg: E ? E + 'leg' : `leg:${lo.legs}`,
  };
}
// 左邊的點 → 右邊鏡像
const mirrorPt = ([x, y, z]) => [-x, y, z];
export function pointOf(shape, name) {
  if (shape.points[name]) return shape.points[name];
  const L = name.endsWith('R') ? name.slice(0, -1) + 'L' : null;
  return L && shape.points[L] ? mirrorPt(shape.points[L]) : null;
}

// 細格方塊清單（顏色用色盤 key）→ 只畫看得到的面的方塊身體（src/voxbody.js）
const mk = (boxes, pal, mat, carve = []) => voxelBody(boxes.map(([x, y, z, w, h, d, k]) => [x, y, z, w, h, d, pal[k] ?? k]), V / 2, mat, carve, 1);
export function partMaterial(armor) {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
  mat.emissive.setHex(ARMORS[armor]?.sheen ? 0x1a2838 : 0x000000);   // 鏡面裝甲微微發亮
  return mat;
}
function partGroup(boxes, pal, parent, armor, carve = []) {
  const mat = partMaterial(armor);
  const g = new THREE.Group();
  if (boxes.length) g.add(mk(boxes, pal, mat, carve));
  parent.add(g);
  return { g, mat, base: mat.emissive.getHex() };
}
// team.tint：裝甲色往隊伍色混多少（雜魚用，整台看起來就是那一邊的顏色）
const mix = (a, b, k) => k ? new THREE.Color(a).lerp(new THREE.Color(b), k).getHex() : a;
export const pal = (armor, team, wtype) => ({ a: mix(ARMORS[armor].hex, team.accent, team.tint ?? 0), f: mix(FRAME, team.accent, (team.tint ?? 0) * 0.35), t: team.accent, g: team.glow, w: wtype ? DMG_TYPES[wtype].hex : team.accent });
export { mk as fineBody };

// 核心（菁英）：部位裡面一團發光的方塊，外面包一層殼（設計單位 1 格厚 = 細方塊 2 層；殼裡面核心的位置挖空，殼被打穿就露出核心）
// 用 MeshBasic + 超過 1 的顏色 → 泛光會讓它發亮；userData.core = 不算磨損、不算殼
const CORE_C = new THREE.Color(2.6, 0.75, 0.28);
export const shellBox = ([x, y, z, w, h, d]) => [x - 1, y - 1, z - 1, w + 2, h + 2, d + 2, 'a'];
const fineBox = ([x, y, z, w, h, d, k]) => [x * 2, y * 2, z * 2, w * 2, h * 2, d * 2, k];
function addCore(part, [x, y, z, w, h, d], crit, gate) {
  const mat = new THREE.MeshBasicMaterial({ color: CORE_C.clone(), vertexColors: true });
  const mesh = voxelBody([[x, y, z, w, h, d, 0xffffff]], V, mat);
  mesh.castShadow = false; mesh.userData.core = true;
  part.g.add(mesh);
  // 殼的範圍（群組本地座標）：拿來判斷被打掉的方塊在哪一面
  part.core = { mesh, mat, base: CORE_C, crit, gate, c: [(x + w / 2) * V, (y + h / 2) * V, (z + d / 2) * V], half: [(w / 2 + 1) * V, (h / 2 + 1) * V, (d / 2 + 1) * V] };
}

// 腳的模型
function buildLegs(lo, team, legsG, K) {
  const P = pal(lo.armor.legs, team), L = LEGS[lo.legs];
  const part = partGroup([], P, legsG, lo.armor.legs);
  const swing = [];
  const pelvis = getShape(K.legs), leg = getShape(K.leg);
  if (pelvis?.boxes.length) part.g.add(mk(pelvis.boxes, P, part.mat));
  const at = pelvis && pointOf(pelvis, 'legL');
  if (leg && at) for (const side of ['L', 'R']) {
    const [x, y, z] = pointOf(pelvis, 'leg' + side), g = new THREE.Group();
    // 右腳 = 左腳左右鏡像（腳的方塊不一定置中，不鏡像的話兩隻腳會往同一邊偏）
    g.add(mk(side === 'L' ? leg.boxes : leg.boxes.map(([bx, by, bz, w, h, d, k]) => [-bx - w, by, bz, w, h, d, k]), P, part.mat));
    g.position.set(x * V, y * V, z * V);
    part.g.add(g); swing.push(g);
  }
  return { part, swing, hipY: L.hipY };
}

// 掛點在上半身的位置（方塊單位）
export function mountPos(lo, slot) {
  return pointOf(getShape(shapeKeys(lo).torso), slot) ?? [0, 0, 0];
}

export function buildMechModel(lo, team) {
  const K = shapeKeys(lo);
  const root = new THREE.Group();
  const legsG = new THREE.Group();
  root.add(legsG);
  const legs = buildLegs(lo, team, legsG, K);
  const hipY = LEGS[lo.legs].hipY;
  const torsoG = new THREE.Group();
  torsoG.position.y = hipY;
  torsoG.rotation.order = 'YXZ';
  root.add(torsoG);
  const parts = { legs: legs.part };
  const CO = lo.cores ?? {};
  const torsoS = getShape(K.torso), headS = getShape(K.head), armS = getShape(K.arm);
  const shell = k => CO[k] ? [fineBox(shellBox(CO[k].box))] : [];
  const carve = k => CO[k] ? [fineBox(CO[k].box)] : [];
  parts.torso = partGroup([...shell('torso'), ...torsoS.boxes], pal(lo.armor.torso, team), torsoG, lo.armor.torso, carve('torso'));
  parts.head = partGroup([...shell('head'), ...headS.boxes], pal(lo.armor.head, team), torsoG, lo.armor.head, carve('head'));
  for (const k of ['torso', 'head']) if (CO[k]) addCore(parts[k], CO[k].box, !!CO[k].crit, CO[k].gate);
  const hp = pointOf(torsoS, 'head') ?? [0, CORES[lo.core].top, 0];
  parts.head.g.position.set(hp[0] * V, hp[1] * V, hp[2] * V);
  const weapons = {}, muzzles = {};
  for (const slot of ['armL', 'armR', 'backL', 'backR']) {
    const id = lo[slot], W = id ? WEAPONS[id] : null;
    const [mx, my, mz] = pointOf(torsoS, slot) ?? [0, 0, 0];
    const arm = slot.startsWith('arm');
    if (!arm && !W) continue;
    const armorKey = arm ? lo.armor.arms : lo.armor.torso;
    const P = pal(armorKey, team, W?.type);
    const boxes = arm ? [...armS.boxes] : [];
    // 武器接在手上 / 背上（細格單位：位移 ×2）
    const off = arm ? pointOf(armS, 'hand') ?? HAND : [0, 0, 0];
    const WS = W && getShape(`weapon:${id}`);
    if (WS) for (const [x, y, z, w, h, d, k] of WS.boxes) boxes.push([x + off[0] * 2, y + off[1] * 2, z + off[2] * 2, w, h, d, k]);
    const p = partGroup(boxes, P, torsoG, armorKey);
    p.g.position.set(mx * V, my * V, mz * V);
    parts[slot] = p;
    if (W) {
      const mu = pointOf(WS, 'muzzle') ?? W.muzzle;
      muzzles[slot] = [(mx + off[0] + mu[0]) * V, (my + off[1] + mu[1]) * V, (mz + off[2] + mu[2]) * V];
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
