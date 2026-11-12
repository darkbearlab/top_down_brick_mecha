// ---------- 機體模型：照配裝把零件的方塊組起來 ----------
// 顏色：a = 該部位的裝甲色（複合深灰、陶瓷白、鏡面淡藍反光）、f = 骨架、t = 隊伍色、g = 隊伍發光色、w = 武器屬性色
// 每個部位一個群組、一個材質（受傷閃白、壞掉燒黑各自處理）
// 外型資料：每個零件一個 key（getShape）→ 優先順序：零件工坊正在試穿的（shapeOverrides）> 編輯過的正式版（src/shapes.js）> 零件原本的方塊
//   方塊一律換成細格單位（1/32）再蓋；掛點、槍口、手、頭的位置用設計單位（1/16）
import * as THREE from 'three';
import { offStream, voxelBody } from './voxbody.js';
import { addMat } from './core.js';
import { ARMORS, CORES, DMG_TYPES, ELITES, GRUNTS, GRUNTS_LOW, HEADS, LEGS, WEAPONS } from './parts.js';
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
  reverse: { pelvis: hy => [[-5, hy - 2, -2, 10, 3, 5, 'f']], x: 0.3, joints: { knee: [0.5, -7, 2], ankle: [0.5, -14, -1.5] },
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
// 有自訂外型（body）的機體：菁英、雜魚（照名字找）
const eliteOf = name => ELITES.find(E => E.name === name) ?? Object.values(GRUNTS).find(G => G.name === name && G.body) ?? Object.values(GRUNTS_LOW).find(G => G.name === name && G.body);
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
    if (kind === 'leg') return L.leg ? { boxes: L.leg, points: { ...L.joints } } : null;
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

// ---------- 關節（膝蓋、腳踝、手肘） ----------
// 關節點跟其他點同一種格式（設計單位）：腳（leg:*）knee、ankle；手臂（arm）elbow。y = 從哪個高度切開，x / z = 轉軸的位置
// 沒放點的外型（舊的、使用者在零件工坊自己做的）照外型自動算，不改資料：
//   腳踝 = 從腳底往上，前後長度明顯變短的那一層（腳掌比小腿長）；膝蓋 = 腳踝到髖關節的中間
//   手肘 = 從手的高度往上，前後長度明顯變短的那一層（前臂是橫的、上臂是直的）
// boxes：細格單位（getShape 的結果）；回傳設計單位
function layerBox(boxes, y) {
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, by, z, w, h, d] of boxes) if (by <= y && y < by + h) { x0 = Math.min(x0, x); x1 = Math.max(x1, x + w); z0 = Math.min(z0, z); z1 = Math.max(z1, z + d); }
  return x1 > x0 ? { x0, x1, z0, z1 } : null;
}
const zLen = (boxes, y) => { const b = layerBox(boxes, y); return b ? b.z1 - b.z0 : 0; };
const yRange = boxes => boxes.reduce(([a, b], [, y, , , h]) => [Math.min(a, y), Math.max(b, y + h)], [Infinity, -Infinity]);
// 那個高度的截面中心（那一層沒方塊 → 往上下找最近的一層）
function layerMid(boxes, y) {
  for (let k = 0; k < 64; k++) for (const yy of [y + k, y - 1 - k]) { const b = layerBox(boxes, yy); if (b) return [(b.x0 + b.x1) / 4, y / 2, (b.z0 + b.z1) / 4]; }
  return [0, y / 2, 0];
}
export function autoJoints(shape, kind) {
  const B = shape.boxes;
  if (!B.length) return {};
  const [y0, y1] = yRange(B);
  if (kind === 'leg') {
    const top = Math.min(y1, 0) > y0 ? Math.min(y1, 0) : y1, H = top - y0, foot = zLen(B, y0);
    let ay = null;
    for (let y = y0 + 1; y < y0 + H * 0.35; y++) if (zLen(B, y) <= foot * 0.75) { ay = y; break; }
    ay ??= Math.round(y0 + H * 0.12);
    const ky = Math.max(ay + 1, Math.round((ay + top) / 2));
    return { knee: layerMid(B, ky), ankle: layerMid(B, ay) };
  }
  if (kind === 'arm') {
    const hy = Math.round((shape.points.hand?.[1] ?? HAND[1]) * 2), base = Math.max(zLen(B, hy - 1), zLen(B, hy), zLen(B, hy + 1), 1);
    let ey = null;
    for (let y = Math.max(hy, y0) + 1; y < y1; y++) if (zLen(B, y) <= base * 0.7) { ey = y; break; }
    ey ??= Math.round(hy + (y1 - hy) * 0.25);
    return { elbow: layerMid(B, ey) };
  }
  return {};
}
// 這個外型的關節點：有放的用放的，沒放的自動算
export function jointsOf(shape, kind) {
  const A = autoJoints(shape, kind), out = {};
  for (const n in A) out[n] = shape.points[n] ?? A[n];
  return out;
}
const pv = ([x, y, z], sx = 1) => new THREE.Vector3(sx * x * V, y * V, z * V);

// 腳的模型
// 有腳的（雙足、逆關節）每隻腳切成大腿、小腿、腳掌三段：髖（g）→ 大腿 + 膝（kneeG）→ 小腿 + 踝（ankleG）→ 腳掌
//   方塊身體還是一隻腳一個（voxbody.js 的 segment），所以磨損、模擬器看到的跟沒切的時候一樣
//   有自訂身體的（菁英、雜魚）不切（split = false）
function buildLegs(lo, team, legsG, K, split) {
  const P = pal(lo.armor.legs, team), L = LEGS[lo.legs];
  const part = partGroup([], P, legsG, lo.armor.legs);
  const swing = [], rig = [];
  const pelvis = getShape(K.legs), leg = getShape(K.leg);
  if (pelvis?.boxes.length) part.g.add(mk(pelvis.boxes, P, part.mat));
  const at = pelvis && pointOf(pelvis, 'legL');
  if (leg && at) for (const side of ['L', 'R']) {
    const [x, y, z] = pointOf(pelvis, 'leg' + side), g = new THREE.Group();
    // 右腳 = 左腳左右鏡像（腳的方塊不一定置中，不鏡像的話兩隻腳會往同一邊偏）
    const mesh = mk(side === 'L' ? leg.boxes : leg.boxes.map(([bx, by, bz, w, h, d, k]) => [-bx - w, by, bz, w, h, d, k]), P, part.mat);
    g.add(mesh);
    g.position.set(x * V, y * V, z * V);
    part.g.add(g); swing.push(g);
    if (split && leg.boxes.length) {
      const J = jointsOf(leg, 'leg'), sx = side === 'L' ? 1 : -1;
      const ay = Math.round(J.ankle[1] * 2), ky = Math.max(ay + 1, Math.round(J.knee[1] * 2));
      const [thigh, shin, foot] = mesh.userData.vb.segment(`leg:${ky}:${ay}`, 3, (vx, vy) => vy >= ky ? 0 : vy >= ay ? 1 : 2);
      const [kneeG, ankleG] = offStream(() => [new THREE.Group(), new THREE.Group()]), KP = pv(J.knee, sx), AP = pv(J.ankle, sx);   // 多出來的群組不能吃模擬器的亂數（voxbody.js 的 offStream）
      KP.y = ky * V / 2; AP.y = ay * V / 2;
      kneeG.position.copy(KP); shin.position.copy(KP).negate();
      ankleG.position.copy(AP).sub(KP); foot.position.copy(AP).negate();
      g.add(thigh, kneeG); kneeG.add(shin, ankleG); ankleG.add(foot);
      // hipP = 髖關節在腳部群組裡的位置；kneeP / ankleP = 相對髖關節；sole = 腳底的高度（相對髖關節）
      rig.push({ side, hip: g, knee: kneeG, ankle: ankleG, hipP: g.position.clone(), kneeP: KP, ankleP: AP, sole: yRange(leg.boxes)[0] * V / 2 });
    }
  }
  return { part, swing, rig, hipY: L.hipY };
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
  const split = !lo.body;   // 關節：先做王牌機（一般零件組的）；有自訂身體的菁英、雜魚維持一整塊
  const legs = buildLegs(lo, team, legsG, K, split);
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
  const weapons = {}, muzzles = {}, arms = {};
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
    const nArm = boxes.length;
    if (WS) for (const [x, y, z, w, h, d, k] of WS.boxes) boxes.push([x + off[0] * 2, y + off[1] * 2, z + off[2] * 2, w, h, d, k]);
    // 右邊（armR、backR）= 左邊的鏡像：手臂、武器、槍口、刀身都左右翻過來
    const R = slot.endsWith('R'), sx = R ? -1 : 1;
    const p = partGroup(R ? boxes.map(([x, y, z, w, h, d, k]) => [-x - w, y, z, w, h, d, k]) : boxes, P, torsoG, armorKey);
    p.g.position.set(mx * V, my * V, mz * V);
    parts[slot] = p;
    // 手臂切成上臂、前臂（含武器）：肩（p.g）→ 上臂 + 肘（foreG）→ 前臂；手肘高度以下的、還有武器的方塊都算前臂
    let foreG = p.g, EP = null;
    if (arm && split) {
      const J = jointsOf(armS, 'arm'), ey = Math.round(J.elbow[1] * 2), wb = boxes.slice(nArm);
      const [upper, fore] = p.g.children[0].userData.vb.segment(`arm:${ey}:${id ?? ''}:${R ? 'R' : 'L'}`, 2, (vx, vy, vz) => {
        if (vy < ey) return 1;
        const ux = R ? -vx - 1 : vx;
        for (const [x, y, z, w, h, d] of wb) if (ux >= x && ux < x + w && vy >= y && vy < y + h && vz >= z && vz < z + d) return 1;
        return 0;
      });
      EP = pv(J.elbow, sx); EP.y = ey * V / 2;
      foreG = offStream(() => new THREE.Group());
      foreG.position.copy(EP); fore.position.copy(EP).negate();
      p.g.add(upper, foreG); foreG.add(fore);
      arms[slot] = { shoulder: p.g, elbow: foreG, elbowP: EP, handP: pv(off, sx) };
    }
    if (W) {
      const mu = pointOf(WS, 'muzzle') ?? W.muzzle;
      muzzles[slot] = [(mx + sx * (off[0] + mu[0])) * V, (my + off[1] + mu[1]) * V, (mz + off[2] + mu[2]) * V];
      // 光束劍：發光的刀身
      if (W.kind === 'saber') {
        const blade = new THREE.Group();
        const core = new THREE.Mesh(new THREE.BoxGeometry(1.2 * V, 1.2 * V, W.blade * V), addMat(0xffffff, 0.95));
        const glow = new THREE.Mesh(new THREE.BoxGeometry(3 * V, 3 * V, (W.blade + 1) * V), addMat(DMG_TYPES.energy.hex, 0.55));
        blade.add(core, glow);
        blade.position.set(sx * off[0] * V, (off[1] + 0.5) * V, (off[2] + 3 + W.blade / 2) * V);
        if (EP) blade.position.sub(EP);
        foreG.add(blade);
        weapons[slot] = { blade };
      }
    }
  }
  root.traverse(o => { if (o.isMesh && o.material.type === 'MeshLambertMaterial') o.castShadow = true; });
  // rig：動畫用的關節（src/anim.js）；沒切的機體 legs = []、arms = {}
  return { root, legsG, legs: legs.swing, torsoG, parts, muzzles, weapons, hipY, rig: { legs: legs.rig, arms } };
}
