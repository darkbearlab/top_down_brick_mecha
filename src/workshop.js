// ---------- 零件工坊：編輯機體零件的外型（開發用） ----------
// 主選單「零件工坊」打開。黑底、自己的鏡頭（左鍵拖曳旋轉、右鍵拖曳平移、滾輪縮放；左鍵點一下 = 用工具）
// 一次編一個零件（key 跟 model.js getShape 一樣：head:<id>、core:<id>、arm、weapon:<id>、legs:<腳型>、leg:<腳型>、elite:<名字>:<部位>）
//   細格（1/32）編輯；筆刷 1 = 一顆細格、2 = 一顆舊的粗格（2×2×2，對齊粗格）；X 軸鏡像
//   顏色用色盤 key（a 裝甲 / f 骨架 / t 隊伍色 / g 發光 / w 武器屬性色），實際顏色照參考配裝的裝甲
//   功能磚（標記點）：軀幹的頭 / 手臂 / 背部掛點（左邊，右邊自動鏡像）、手臂的手（武器握把）、武器的槍口（子彈 / 飛彈從這裡出來）、腳的髖關節；一顆細格大小，點下去對齊格子
// 參考：整台機體半透明疊在旁邊（參考配裝 = 目前的玩家配裝，換成這個零件；菁英用菁英自己的）；武器預覽開關
// 標示：命中判定（機體中心的圓柱，半徑 = 碰撞半徑，高 2.2）、這個零件的可編輯範圍（框外放不下去）
// 存檔：草稿自動存在 localStorage（brickmecha.workshop）；「試穿」= 這次開著遊戲時把草稿套到所有機體；「匯出」= 下載 / 複製 JSON（給 Claude 合併進 src/shapes.js）
import * as THREE from 'three';
import { renderer } from './core.js';
import { CORES, ELITES, HEADS, LEGS, WEAPONS, loadLoadout } from './parts.js';
import { V, buildMechModel, getShape, legacyShape, pal, partMaterial, pointOf, shapeKeys, shapeOverrides } from './model.js';
import { SHAPES } from './shapes.js';
import { voxelBody } from './voxbody.js';
import { PLAYER_COLORS } from './mech.js';

const $ = id => document.getElementById(id);
const KEY = 'brickmecha.workshop';
const S = V / 2;   // 一顆細格（公尺）
// 可編輯範圍（設計單位，部位本地座標，[x0, y0, z0, x1, y1, z1]）
const BOUNDS = {
  head: [-7, -3, -7, 7, 10, 7], torso: [-11, -1, -11, 11, 16, 11], arm: [-4, -4, -6, 4, 13, 10],
  weapon: [-6, -6, -8, 6, 6, 24], legs: [-16, 0, -14, 16, 18, 14], leg: [-5, -18, -9, 5, 1, 9],
};
const POINTS = { torso: ['head', 'armL', 'backL'], arm: ['hand'], weapon: ['muzzle'], legs: ['legL'] };
const POINT_NAMES = { head: '頭', armL: '手臂掛點（左）', backL: '背部掛點（左）', hand: '手（武器握把）', muzzle: '槍口', legL: '髖關節（左）' };
const POINT_C = { head: 0xffe060, armL: 0x60e0ff, backL: 0xff9040, hand: 0x60ff90, muzzle: 0xff5050, legL: 0xc080ff };
const COLOR_KEYS = [['a', '裝甲'], ['f', '骨架'], ['t', '隊伍色'], ['g', '發光'], ['w', '武器色']];
const TOOLS = [['place', '堆（B）'], ['erase', '刪（E）'], ['paint', '上色（F）'], ['pick', '吸色（I）'], ['point', '功能磚（M）']];

// ---------- 零件清單 ----------
function partList() {
  const L = [];
  for (const [id, H] of Object.entries(HEADS)) L.push([`head:${id}`, '頭', H.name]);
  for (const [id, C] of Object.entries(CORES)) L.push([`core:${id}`, '軀幹', C.name]);
  L.push(['arm', '手臂', '手臂（共用）']);
  for (const [id, W] of Object.entries(WEAPONS)) if (W.model?.length) L.push([`weapon:${id}`, '武器', W.name + (W.low ? '（敵人用）' : '')]);
  for (const [id, Lg] of Object.entries(LEGS)) {
    L.push([`legs:${id}`, '腳', Lg.name + (legacyShape(`leg:${id}`) ? '・骨盆' : '')]);
    if (legacyShape(`leg:${id}`)) L.push([`leg:${id}`, '腳', Lg.name + '・單腳']);
  }
  for (const E of ELITES) if (E.body) for (const [sub, n] of [['torso', '軀幹'], ['head', '頭'], ['arm', '手臂'], ['legs', E.body.treads ? '履帶' : '骨盆'], ['leg', '單腳']])
    if (legacyShape(`elite:${E.name}:${sub}`)) L.push([`elite:${E.name}:${sub}`, '菁英・' + E.name, n]);
  return L;
}
// 這個 key 是哪一類部位（決定範圍、標記點、放在整台機體的哪裡）
function slotOf(key) {
  const [kind, id, sub] = key.split(':');
  if (kind === 'elite') return sub;
  return { head: 'head', core: 'torso', arm: 'arm', legs: 'legs', leg: 'leg' }[kind] ?? (kind === 'weapon' ? 'weapon' : null);
}
// 參考配裝：玩家目前的配裝換上這個零件；菁英用自己的
function refLoadout(key) {
  const [kind, id] = key.split(':');
  if (kind === 'elite') return ELITES.find(E => E.name === id);
  const lo = structuredClone(loadLoadout());
  if (kind === 'head') lo.head = id;
  if (kind === 'core') lo.core = id;
  if (kind === 'legs' || kind === 'leg') lo.legs = id;
  if (kind === 'weapon') { if (WEAPONS[id].mount === 'arm') lo.armL = id; else lo.backL = id; }
  return lo;
}

// ---------- 狀態 ----------
let open = false, onClose = null;
let key = null, slot = null, lo = null;
let vox = new Map(), points = {};          // vox：'x,y,z'（細格）→ 顏色 key
let tool = 'place', color = 'a', brush = 1, mirror = true, curPoint = null;
let show = { ghost: true, weapon: true, hit: true, bounds: true };
let undo = [], redo = [];
let drafts = {}, tryOn = false;
try { const d = JSON.parse(localStorage.getItem(KEY)); if (d?.drafts) drafts = d.drafts; } catch { /* 沒有草稿 */ }
const saveDrafts = () => { try { localStorage.setItem(KEY, JSON.stringify({ drafts, last: key })); } catch { /* 存不了就算了 */ } };

// ---------- 場景 ----------
export const wsScene = new THREE.Scene();
wsScene.background = new THREE.Color(0x000000);
export const wsCam = new THREE.PerspectiveCamera(36, 1, 0.02, 60);
wsScene.add(new THREE.HemisphereLight(0xdfe6ff, 0x30302c, 1.5));
const sun = new THREE.DirectionalLight(0xffffff, 1.8); sun.position.set(2, 4, 3); wsScene.add(sun);
const back = new THREE.DirectionalLight(0x8aa0ff, 0.6); back.position.set(-3, 2, -4); wsScene.add(back);
const world = new THREE.Group(); wsScene.add(world);
const floor = new THREE.GridHelper(4, 32, 0x2a2e38, 0x15171c); world.add(floor);
let ghost = null, editG = new THREE.Group(), editMesh = null, editMat = null, weaponPrev = null;
world.add(editG);
const ghostMat = new THREE.MeshLambertMaterial({ color: 0x8090a8, transparent: true, opacity: 0.16, depthWrite: false });
const hover = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false }));
const hoverM = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.2, depthWrite: false }));
hover.visible = hoverM.visible = false;
editG.add(hover, hoverM);
let boundsBox = null, plane = null, markers = new THREE.Group(), coreBox = null;
editG.add(markers);
// 命中判定：圓柱（碰撞半徑），高 2.2（飛彈 / 拋射物打得到的高度）
const hitG = new THREE.Group(); world.add(hitG);
function buildHit(r, h) {
  hitG.clear();
  // 只畫背面那半圈的淡牆（不擋住零件）+ 上下兩圈線 + 四條直線
  const cyl = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 48, 1, true), new THREE.MeshBasicMaterial({ color: 0xff4040, transparent: true, opacity: 0.03, side: THREE.BackSide, depthWrite: false }));
  cyl.position.y = h / 2;
  const lineM = new THREE.LineBasicMaterial({ color: 0xff5050, transparent: true, opacity: 0.7 });
  const circle = y => { const pts = []; for (let i = 0; i <= 64; i++) { const a = i / 64 * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r)); } return new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineM); };
  const vs = [];
  for (let i = 0; i < 4; i++) { const a = i / 4 * Math.PI * 2 + Math.PI / 4; vs.push(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r), new THREE.Vector3(Math.cos(a) * r, h, Math.sin(a) * r)); }
  hitG.add(cyl, circle(0.003), circle(h), new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(vs), lineM));
}

// ---------- 載入 / 換零件 ----------
const fineKey = (x, y, z) => `${x},${y},${z}`;
function fromBoxes(boxes) {
  const m = new Map();
  for (const [x, y, z, w, h, d, k] of boxes) for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) for (let l = 0; l < d; l++) m.set(fineKey(x + i, y + j, z + l), k);
  return m;
}
// 細格 → 盒子（貪婪合併：同顏色先往 x 延伸、再 y、再 z）
function toBoxes(m) {
  const seen = new Set(), out = [];
  const cells = [...m.keys()].map(k => k.split(',').map(Number)).sort((a, b) => a[2] - b[2] || a[1] - b[1] || a[0] - b[0]);
  const same = (x, y, z, c) => { const k = fineKey(x, y, z); return !seen.has(k) && m.get(k) === c; };
  for (const [x, y, z] of cells) {
    const k0 = fineKey(x, y, z);
    if (seen.has(k0)) continue;
    const c = m.get(k0);
    let w = 1, h = 1, d = 1;
    while (same(x + w, y, z, c)) w++;
    grow: for (;;) { for (let i = 0; i < w; i++) if (!same(x + i, y + h, z, c)) break grow; h++; }
    grow2: for (;;) { for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) if (!same(x + i, y + j, z + d, c)) break grow2; d++; }
    for (let i = 0; i < w; i++) for (let j = 0; j < h; j++) for (let l = 0; l < d; l++) seen.add(fineKey(x + i, y + j, z + l));
    out.push([x, y, z, w, h, d, c]);
  }
  return out;
}
const snapshot = () => JSON.stringify({ b: toBoxes(vox), p: points });
function restore(s) { const o = JSON.parse(s); vox = fromBoxes(o.b); points = o.p; }
// 原本的（不含草稿）：正式版 shapes.js 有就用它，不然零件原本的
function original(k) {
  if (SHAPES[k]) return { boxes: SHAPES[k].boxes, points: structuredClone(SHAPES[k].points ?? {}) };
  const L = legacyShape(k);
  return { boxes: L.boxes.map(([x, y, z, w, h, d, c]) => [x * 2, y * 2, z * 2, w * 2, h * 2, d * 2, c]), points: structuredClone(L.points ?? {}) };
}
function load(k) {
  key = k; slot = slotOf(k); lo = refLoadout(k);
  const src = drafts[k] ?? original(k);
  vox = fromBoxes(src.boxes); points = structuredClone(src.points ?? {});
  // 沒有的標記點補上原本的
  const o = original(k);
  for (const n of POINTS[slot] ?? []) if (!points[n] && o.points[n]) points[n] = o.points[n];
  if (slot === 'legs' && !legacyShape(k.replace(/^legs:/, 'leg:').replace(/:legs$/, ':leg'))) delete points.legL;
  undo = []; redo = [];
  curPoint = (POINTS[slot] ?? []).find(n => points[n]) ?? null;
  rebuildAll(true);
  renderPanel();
}
// 改動：存草稿（跟原本一樣就刪掉草稿）
function commit() {
  const b = toBoxes(vox), o = original(key);
  const same = JSON.stringify(b) === JSON.stringify(toBoxes(fromBoxes(o.boxes))) && JSON.stringify(points) === JSON.stringify(o.points);
  if (same) delete drafts[key]; else drafts[key] = { boxes: b, points: structuredClone(points) };
  saveDrafts();
  if (tryOn) applyTryOn();
  renderStatus();
}
function act(fn) {
  const before = snapshot();
  if (fn() === false) return;
  undo.push(before); if (undo.length > 120) undo.shift();
  redo = [];
  commit(); rebuildEdit(); rebuildGhost();
}
function doUndo() { if (!undo.length) return; redo.push(snapshot()); restore(undo.pop()); commit(); rebuildAll(); renderPanel(); }
function doRedo() { if (!redo.length) return; undo.push(snapshot()); restore(redo.pop()); commit(); rebuildAll(); renderPanel(); }

// ---------- 畫面上的東西 ----------
// 這個部位在整台機體（模型本地座標）的位置（設計單位）
function placeOf() {
  const K = shapeKeys(lo), hipY = LEGS[lo.legs].hipY * 16;
  const torso = getShape(K.torso), cur = { boxes: [], points };
  const T = (s, n) => pointOf(s, n) ?? [0, 0, 0];
  const torsoPts = slot === 'torso' ? cur : torso;
  if (slot === 'torso') return [0, hipY, 0];
  if (slot === 'head') { const h = T(torsoPts, 'head'); return [h[0], hipY + h[1], h[2]]; }
  if (slot === 'arm') { const a = T(torsoPts, 'armL'); return [a[0], hipY + a[1], a[2]]; }
  if (slot === 'weapon') {
    const W = WEAPONS[key.split(':')[1]];
    if (W.mount === 'arm') { const a = T(torso, 'armL'), h = T(getShape(K.arm), 'hand'); return [a[0] + h[0], hipY + a[1] + h[1], a[2] + h[2]]; }
    const b = T(torso, 'backL'); return [b[0], hipY + b[1], b[2]];
  }
  if (slot === 'legs') return [0, 0, 0];
  if (slot === 'leg') return T(getShape(K.legs), 'legL');
  return [0, 0, 0];
}
function curPalette() {
  const armor = slot === 'head' ? lo.armor.head : slot === 'arm' || slot === 'weapon' ? lo.armor.arms : slot === 'legs' || slot === 'leg' ? lo.armor.legs : lo.armor.torso;
  const wid = key.startsWith('weapon:') ? key.split(':')[1] : lo.armL;
  return pal(armor, PLAYER_COLORS, wid ? WEAPONS[wid]?.type : null);
}
function rebuildEdit() {
  if (editMesh) { editG.remove(editMesh); editMesh.geometry.dispose(); }
  editMat ??= partMaterial('composite');
  const P = curPalette(), boxes = [];
  for (const [k, c] of vox) { const [x, y, z] = k.split(',').map(Number); boxes.push([x, y, z, 1, 1, 1, P[c] ?? c]); }
  editMesh = boxes.length ? voxelBody(boxes, S, editMat, [], 1, false) : null;
  if (editMesh) editG.add(editMesh);
  // 標記點
  markers.clear();
  for (const n of POINTS[slot] ?? []) {
    const p = points[n];
    if (!p) continue;
    for (const [q, main] of [[p, true], ...(n.endsWith('L') ? [[[-p[0], p[1], p[2]], false]] : [])]) {
      // 功能磚：佔一顆細格（點的位置 = 這格的角落），透過其他方塊也看得到
      const m = new THREE.Mesh(new THREE.BoxGeometry(S * 1.02, S * 1.02, S * 1.02), new THREE.MeshBasicMaterial({ color: POINT_C[n], transparent: true, opacity: main ? 0.95 : 0.4, depthTest: false }));
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: main ? 0.9 : 0.3 }));
      m.add(e);
      m.position.set(q[0] * V + (main ? 0.5 : -0.5) * S, q[1] * V + 0.5 * S, q[2] * V + 0.5 * S); m.renderOrder = e.renderOrder = 5;
      if (n === curPoint && main) m.scale.setScalar(1.5);
      markers.add(m);
    }
  }
}
function rebuildGhost() {
  if (ghost) world.remove(ghost.root);
  if (weaponPrev) { editG.remove(weaponPrev); weaponPrev = null; }
  // 整台機體：這個零件用目前的編輯（標記點會影響別的零件擺哪）
  const saved = shapeOverrides[key];
  shapeOverrides[key] = { boxes: toBoxes(vox), points };
  ghost = buildMechModel(lo, PLAYER_COLORS);
  if (saved) shapeOverrides[key] = saved; else delete shapeOverrides[key];
  const P = ghost.parts;
  ghost.root.traverse(o => { if (o.isMesh) { o.material = ghostMat; o.castShadow = false; } });
  // 編輯中的那個零件不畫（用實心的那份）
  const hide = { head: [P.head.g], torso: [P.torso.g], arm: [P.armL?.g], weapon: [(WEAPONS[key.split(':')[1]]?.mount === 'arm' ? P.armL : P.backL)?.g] }[slot] ?? [];
  for (const g of hide) if (g) g.visible = false;
  if (slot === 'legs') for (const c of P.legs.g.children) if (!ghost.legs.includes(c)) c.visible = false;
  if (slot === 'leg' && ghost.legs[0]) ghost.legs[0].visible = false;
  // 武器預覽：軀幹 → 手臂、背部武器顯示 / 不顯示；手臂 → 手上接一把參考武器（實心）
  if (slot === 'torso') for (const s of ['armL', 'armR', 'backL', 'backR']) if (P[s]) P[s].g.visible = show.weapon;
  if (slot === 'arm' && show.weapon && lo.armL) {
    const W = getShape(`weapon:${lo.armL}`), h = pointOf({ points }, 'hand') ?? [0, 0, 0], Pal = pal(lo.armor.arms, PLAYER_COLORS, WEAPONS[lo.armL].type);
    weaponPrev = voxelBody(W.boxes.map(([x, y, z, w, hh, d, c]) => [x + h[0] * 2, y + h[1] * 2, z + h[2] * 2, w, hh, d, Pal[c] ?? c]), S, partMaterial(lo.armor.arms));
    editG.add(weaponPrev);
  }
  ghost.root.visible = show.ghost;
  world.add(ghost.root);
  const p = placeOf();
  editG.position.set(p[0] * V, p[1] * V, p[2] * V);
  // 命中判定：碰撞半徑（菁英的模型有放大，這裡畫的是放大前的模型，所以半徑 / 高度照比例換算）
  const k = lo.elite?.scale ?? 1;
  buildHit(lo.legs === 'tread' ? 0.95 : 0.85, 2.2 / k);
  hitG.visible = show.hit;
}
function rebuildFrame() {
  // 可編輯範圍
  if (boundsBox) editG.remove(boundsBox);
  const b = BOUNDS[slot];
  const box = new THREE.Box3(new THREE.Vector3(b[0] * V, b[1] * V, b[2] * V), new THREE.Vector3(b[3] * V, b[4] * V, b[5] * V));
  boundsBox = new THREE.Box3Helper(box, 0x4a8cff);
  boundsBox.visible = show.bounds;
  editG.add(boundsBox);
  // 空的時候點這片地板放第一顆（看不到，只拿來點）
  if (plane) editG.remove(plane);
  const py = Math.max(b[1], Math.min(b[4] - 1, 0)) * V;
  plane = new THREE.Mesh(new THREE.PlaneGeometry((b[3] - b[0]) * V, (b[5] - b[2]) * V), new THREE.MeshBasicMaterial({ visible: false }));
  plane.rotation.x = -Math.PI / 2; plane.position.set((b[0] + b[3]) / 2 * V, py, (b[2] + b[5]) / 2 * V);
  editG.add(plane);
  // 菁英的核心：發光的框（殼會自動包一層，不用自己堆）
  if (coreBox) { editG.remove(coreBox); coreBox = null; }
  const C = lo.cores?.[slot === 'torso' ? 'torso' : slot === 'head' ? 'head' : '_'];
  if (C) {
    const [x, y, z, w, h, d] = C.box;
    coreBox = new THREE.Mesh(new THREE.BoxGeometry(w * V, h * V, d * V), new THREE.MeshBasicMaterial({ color: 0xff8030, transparent: true, opacity: 0.35, depthWrite: false }));
    coreBox.position.set((x + w / 2) * V, (y + h / 2) * V, (z + d / 2) * V);
    editG.add(coreBox);
  }
}
function rebuildAll(resetCam = false) {
  rebuildFrame(); rebuildEdit(); rebuildGhost();
  if (resetCam) {
    const b = BOUNDS[slot], p = placeOf();
    cam.target.set((p[0] + (b[0] + b[3]) / 2) * V, (p[1] + (b[1] + b[4]) / 2) * V, (p[2] + (b[2] + b[5]) / 2) * V);
    cam.dist = Math.max(1.2, Math.max(b[3] - b[0], b[4] - b[1], b[5] - b[2]) * V * 3.4);
  }
}

// ---------- 鏡頭 ----------
const cam = { target: new THREE.Vector3(0, 0.8, 0), yaw: 0.7, pitch: 0.35, dist: 2 };
function updateCam() {
  const c = Math.cos(cam.pitch);
  wsCam.position.set(cam.target.x + Math.sin(cam.yaw) * c * cam.dist, cam.target.y + Math.sin(cam.pitch) * cam.dist, cam.target.z + Math.cos(cam.yaw) * c * cam.dist);
  wsCam.lookAt(cam.target);
  const w = innerWidth, h = innerHeight, panel = Math.min(340, w * 0.4);
  wsCam.aspect = w / h;
  wsCam.setViewOffset(w, h, -panel / 2, 0, w, h);   // 左邊面板：畫面往右挪
  wsCam.updateProjectionMatrix();
}

// ---------- 點選 ----------
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), lp = new THREE.Vector3(), ln = new THREE.Vector3();
// 回傳 { cell: 點到的那顆（沒有 = null）, place: 要放的那格 }
function pickAt(cx, cy) {
  ndc.set(cx / innerWidth * 2 - 1, -(cy / innerHeight) * 2 + 1);
  ray.setFromCamera(ndc, wsCam);
  editG.updateMatrixWorld(true);
  const hits = ray.intersectObjects([editMesh, plane].filter(Boolean), false);
  if (!hits.length) return null;
  const h = hits[0];
  editG.worldToLocal(lp.copy(h.point));
  if (h.object === plane) { const c = [Math.floor(lp.x / S), Math.round(lp.y / S), Math.floor(lp.z / S)]; return { cell: null, place: c }; }
  ln.copy(h.face.normal);
  const c = [Math.floor(lp.x / S - ln.x * 0.5), Math.floor(lp.y / S - ln.y * 0.5), Math.floor(lp.z / S - ln.z * 0.5)];
  return { cell: c, place: [c[0] + ln.x, c[1] + ln.y, c[2] + ln.z].map(Math.round) };
}
const inBounds = ([x, y, z]) => { const b = BOUNDS[slot]; return x >= b[0] * 2 && y >= b[1] * 2 && z >= b[2] * 2 && x < b[3] * 2 && y < b[4] * 2 && z < b[5] * 2; };
// 筆刷：1 = 這一格；2 = 包含它的那顆粗格（2×2×2）
function brushCells(c) {
  if (brush === 1) return [c];
  const b = c.map(v => Math.floor(v / 2) * 2), out = [];
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) for (let k = 0; k < 2; k++) out.push([b[0] + i, b[1] + j, b[2] + k]);
  return out;
}
const withMirror = cells => mirror ? [...cells, ...cells.map(([x, y, z]) => [-x - 1, y, z])] : cells;
function apply(cx, cy) {
  const p = pickAt(cx, cy);
  if (!p) return;
  if (tool === 'pick') { if (p.cell) { color = vox.get(fineKey(...p.cell)) ?? color; renderPanel(); } return; }
  if (tool === 'point') {
    if (!curPoint) return;
    const c = p.place;   // 功能磚放在點到的那一面外面（例如槍管前端）
    act(() => { points[curPoint] = [c[0] / 2, c[1] / 2, c[2] / 2]; });
    renderPanel(); return;
  }
  if (tool === 'place') act(() => { let n = 0; for (const c of withMirror(brushCells(p.place))) if (inBounds(c)) { vox.set(fineKey(...c), color); n++; } return n > 0; });
  else if (!p.cell) return;
  else if (tool === 'erase') act(() => { for (const c of withMirror(brushCells(p.cell))) vox.delete(fineKey(...c)); });
  else if (tool === 'paint') act(() => { for (const c of withMirror(brushCells(p.cell))) if (vox.has(fineKey(...c))) vox.set(fineKey(...c), color); });
}
function updateHover(cx, cy) {
  hover.visible = hoverM.visible = false;
  if (tool === 'pick') return;
  const p = pickAt(cx, cy);
  if (!p) return;
  const c = tool === 'place' || tool === 'point' ? p.place : p.cell;
  if (!c) return;
  const b = brush === 2 && tool !== 'point' ? c.map(v => Math.floor(v / 2) * 2) : c, n = brush === 2 && tool !== 'point' ? 2 : 1;
  const ok = tool !== 'place' || inBounds(c);
  hover.material.color.setHex(!ok ? 0xff3030 : tool === 'erase' ? 0xff6060 : tool === 'point' ? POINT_C[curPoint] ?? 0xffffff : 0xffffff);
  hover.scale.setScalar(n * S * 1.04); hover.position.set((b[0] + n / 2) * S, (b[1] + n / 2) * S, (b[2] + n / 2) * S); hover.visible = true;
  if (mirror && tool !== 'point') { hoverM.scale.copy(hover.scale); hoverM.position.set((-b[0] - n / 2) * S, hover.position.y, hover.position.z); hoverM.material.color.copy(hover.material.color); hoverM.visible = true; }
}

// ---------- 滑鼠 / 鍵盤 ----------
let drag = null;
const el = renderer.domElement;
el.addEventListener('pointerdown', e => {
  if (!open) return;
  drag = { x: e.clientX, y: e.clientY, b: e.button, moved: false, yaw: cam.yaw, pitch: cam.pitch, t: cam.target.clone() };
  el.setPointerCapture(e.pointerId);
});
el.addEventListener('pointermove', e => {
  if (!open) return;
  if (!drag) { updateHover(e.clientX, e.clientY); return; }
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  if (!drag.moved && Math.hypot(dx, dy) > 4) drag.moved = true;
  if (!drag.moved) return;
  hover.visible = hoverM.visible = false;
  if (drag.b === 0 && !e.shiftKey) { cam.yaw = drag.yaw - dx * 0.008; cam.pitch = Math.max(-1.45, Math.min(1.45, drag.pitch + dy * 0.008)); }
  else {
    // 平移：沿著畫面的左右、上下
    const k = cam.dist * 0.0016, r = new THREE.Vector3().setFromMatrixColumn(wsCam.matrixWorld, 0), u = new THREE.Vector3().setFromMatrixColumn(wsCam.matrixWorld, 1);
    cam.target.copy(drag.t).addScaledVector(r, -dx * k).addScaledVector(u, dy * k);
  }
});
el.addEventListener('pointerup', e => {
  if (!open || !drag) return;
  if (!drag.moved && drag.b === 0) apply(e.clientX, e.clientY);
  drag = null;
});
el.addEventListener('contextmenu', e => { if (open) e.preventDefault(); });
el.addEventListener('wheel', e => { if (!open) return; e.preventDefault(); cam.dist = Math.max(0.25, Math.min(8, cam.dist * Math.exp(e.deltaY * 0.0012))); }, { passive: false });
addEventListener('keydown', e => {
  if (!open || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
  if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); doRedo(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const T = { b: 'place', e: 'erase', f: 'paint', i: 'pick', m: 'point' }[k];
  if (T) { tool = T; renderPanel(); }
  else if (k === 'x') { mirror = !mirror; renderPanel(); }
  else if (k === '1' || k === '2') { brush = +k; renderPanel(); }
  else if (e.key === 'Escape') closeWorkshop();
});

// ---------- 介面 ----------
const root = document.createElement('div');
root.id = 'workshop'; root.className = 'hidden';
root.innerHTML = `<div class="wpanel"><div class="whead"><b>零件工坊</b><button id="wsClose">完成（Esc）</button></div><div id="wsBody"></div></div>
  <div class="whint">左鍵點：用工具・左鍵拖曳：旋轉・右鍵（或 Shift + 左鍵）拖曳：平移・滾輪：縮放・Ctrl+Z / Ctrl+Y：復原 / 重做</div>
  <div id="wsStatus"></div>`;
document.body.appendChild(root);
$('wsClose').onclick = () => closeWorkshop();
function seg(name, opts, cur, pick, title = '') {
  return `<div class="wrow"><span>${name}</span><div class="seg">${opts.map(([v, l]) => `<button data-g="${title || name}" data-v="${v}" class="${String(v) === String(cur) ? 'on' : ''}">${l}</button>`).join('')}</div></div>`;
}
function renderPanel() {
  if (!key) return;
  const P = curPalette(), list = partList();
  const groups = [...new Set(list.map(l => l[1]))];
  const hasW = slot === 'torso' || (slot === 'arm' && lo.armL);
  let h = `<div class="wrow col"><span>編輯對象</span><select id="wsKey">${groups.map(g => `<optgroup label="${g}">${list.filter(l => l[1] === g).map(([k, , n]) => `<option value="${k}" ${k === key ? 'selected' : ''}>${n}${drafts[k] ? ' ＊' : ''}</option>`).join('')}</optgroup>`).join('')}</select></div>`;
  h += seg('工具', TOOLS, tool, v => tool = v, 'tool');
  h += `<div class="wrow"><span>顏色</span><div class="wsw">${COLOR_KEYS.map(([c, n]) => `<button data-c="${c}" class="${c === color ? 'on' : ''}" title="${n}" style="--c:#${new THREE.Color(P[c]).getHexString()}"><i></i>${n}</button>`).join('')}</div></div>`;
  h += seg('筆刷', [[1, '細格'], [2, '粗格 2×2×2']], brush, null, 'brush');
  h += seg('X 鏡像', [[1, '開'], [0, '關']], mirror ? 1 : 0, null, 'mirror');
  h += `<div class="wrow col"><span>顯示</span><div class="wchk">${[['ghost', '整台機體（半透明）'], ...(hasW ? [['weapon', '武器預覽']] : []), ['hit', '命中判定'], ['bounds', '可編輯範圍']].map(([k, n]) => `<label><input type="checkbox" data-s="${k}" ${show[k] ? 'checked' : ''}>${n}</label>`).join('')}</div></div>`;
  const pts = (POINTS[slot] ?? []).filter(n => points[n] || slot !== 'legs');
  if (pts.length) h += `<div class="wrow col"><span>功能磚（選一個，用功能磚工具點在方塊的某一面上；左邊的會自動鏡像到右邊）</span>${pts.map(n => `<div class="wpt ${n === curPoint ? 'on' : ''}" data-p="${n}"><i style="background:#${new THREE.Color(POINT_C[n]).getHexString()}"></i><b>${POINT_NAMES[n]}</b>${['x', 'y', 'z'].map((a, i) => `<input type="number" step="0.5" data-pi="${n},${i}" value="${points[n]?.[i] ?? 0}">`).join('')}</div>`).join('')}</div>`;
  if (lo.cores?.[slot]) h += `<div class="wnote">橘色框 = 核心的位置；外面會自動包 1 粗格（2 細格）的殼，不用自己堆</div>`;
  h += `<div class="wrow"><button class="wbtn" id="wsUndo">復原</button><button class="wbtn" id="wsRedo">重做</button><button class="wbtn" id="wsReset">還原這個零件</button></div>`;
  h += `<div class="wrow col"><span id="wsDrafts"></span><div class="wbtns"><label class="wtry"><input type="checkbox" id="wsTry" ${tryOn ? 'checked' : ''}>試穿（這次開著遊戲時套到所有機體）</label>
    <button class="wbtn" id="wsDl">下載 JSON</button><button class="wbtn" id="wsCopy">複製 JSON</button></div></div>`;
  $('wsBody').innerHTML = h;
  $('wsKey').onchange = e => load(e.target.value);
  $('wsBody').querySelectorAll('.seg button').forEach(b => b.onclick = () => {
    const g = b.dataset.g, v = b.dataset.v;
    if (g === 'tool') tool = v; else if (g === 'brush') brush = +v; else if (g === 'mirror') mirror = v === '1';
    renderPanel();
  });
  $('wsBody').querySelectorAll('.wsw button').forEach(b => b.onclick = () => { color = b.dataset.c; if (tool === 'erase' || tool === 'pick' || tool === 'point') tool = 'place'; renderPanel(); });
  $('wsBody').querySelectorAll('[data-s]').forEach(c => c.onchange = () => { show[c.dataset.s] = c.checked; rebuildFrame(); rebuildGhost(); });
  $('wsBody').querySelectorAll('.wpt').forEach(r => r.onclick = e => { if (e.target.tagName === 'INPUT') return; curPoint = r.dataset.p; tool = 'point'; renderPanel(); rebuildEdit(); });
  $('wsBody').querySelectorAll('[data-pi]').forEach(inp => inp.onchange = () => {
    const [n, i] = inp.dataset.pi.split(','), v = +inp.value;
    act(() => { points[n] = [...(points[n] ?? [0, 0, 0])]; points[n][+i] = v; });
    renderPanel();
  });
  $('wsUndo').onclick = doUndo; $('wsRedo').onclick = doRedo;
  $('wsReset').onclick = () => { if (!drafts[key]) return; act(() => { const o = original(key); vox = fromBoxes(o.boxes); points = o.points; }); rebuildAll(); renderPanel(); };
  $('wsTry').onchange = e => { tryOn = e.target.checked; applyTryOn(); };
  $('wsDl').onclick = download;
  $('wsCopy').onclick = () => navigator.clipboard?.writeText(exportJson()).then(() => flash('已複製'), () => flash('複製失敗（請用下載）'));
  renderStatus();
}
function renderStatus() {
  const d = $('wsDrafts'); if (d) d.textContent = `草稿 ${Object.keys(drafts).length} 個零件（清單裡標 ＊）`;
  const o = $('wsKey')?.querySelector(`option[value="${key}"]`); if (o) o.textContent = o.textContent.replace(/ ＊$/, '') + (drafts[key] ? ' ＊' : '');
  $('wsStatus').textContent = `${key}・${vox.size} 顆細格${drafts[key] ? '・已修改' : ''}${tryOn ? '・試穿中' : ''}`;
}
let flashT = 0;
function flash(t) { const s = $('wsStatus'); s.textContent = t; clearTimeout(flashT); flashT = setTimeout(renderStatus, 1500); }

// ---------- 試穿 / 匯出 ----------
function applyTryOn() {
  for (const k of Object.keys(shapeOverrides)) delete shapeOverrides[k];
  if (tryOn) for (const [k, d] of Object.entries(drafts)) shapeOverrides[k] = d;
}
const exportJson = () => JSON.stringify({ version: 1, unit: 'boxes = 細格 1/32；points = 設計單位 1/16', shapes: drafts }, null, 1);
function download() {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([exportJson()], { type: 'application/json' }));
  a.download = `brickmecha-shapes-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  flash('已下載');
}

// ---------- 開 / 關 ----------
export const workshopOpen = () => open;
export function openWorkshop(done) {
  open = true; onClose = done;
  root.classList.remove('hidden');
  let last = null;
  try { last = JSON.parse(localStorage.getItem(KEY))?.last; } catch { /* 沒有 */ }
  load(last && partList().some(l => l[0] === last) ? last : `core:${loadLoadout().core}`);
}
export function closeWorkshop() {
  open = false;
  root.classList.add('hidden');
  hover.visible = hoverM.visible = false;
  onClose?.(tryOn);
}
export function updateWorkshop() { updateCam(); }
