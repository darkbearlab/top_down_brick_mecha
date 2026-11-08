// ---------- 蟲子（非機甲造型的雜魚） ----------
// 機體的部位模型全部藏起來，在上半身那裡換成方塊拼的蟲（身體跟著上半身轉 → 頭永遠朝著要打的方向）
// 傷害、碰撞、AI 都照一般雜魚（整台一條血）；軀幹的材質換成蟲身體的 → 被打中閃白、燃燒 / 腐蝕發光都會出現在蟲身上
// 種類（parts.js GRUNTS_LOW 的 bug 欄位）：
//   warrior 戰士蟲：前面一對鐮刀腳，只會近戰（ai.js 的 melee），咬中有機率腐蝕被咬的部位
//   charger 衝鋒蟲：大隻、前面一片厚甲殼（正面盾，m.shield.front），用衝鋒機的衝刺邏輯；甲殼打碎就露出軟的身體
//   spitter 投擲蟲：屁股一顆發光的酸液囊，丟酸液彈（weapons.js 的 napalm 邏輯，換成腐蝕）；死掉時酸液囊破掉留下一小灘酸
// 死掉：不爆炸，碎幾塊、腳縮起來、顏色變暗，屍體留在地上（wreck.js 的殘骸清單）
import * as THREE from 'three';
import { G, UNIT_BOX, addMat } from './core.js';
import { RAMP, burst, smoke, spawnGlow } from './fx.js';
import { addHusk } from './wreck.js';
import { spawnZone } from './weapons.js';
import { sfx } from './audio.js';

const R = (a, b) => a + Math.random() * (b - a);
const CHITIN = 0x3d3526, PLATE = 0x6b5a36, JOINT = 0x241f17, EYE = 0xff3020, SHELL = 0x8a7448, ACID = 0x78d838;

// 方塊：[w, h, d, x, y, z, 材質, 轉 x, 轉 y, 轉 z]
function box(g, mat, w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(UNIT_BOX, mat);
  m.scale.set(w, h, d); m.position.set(x, y, z); m.rotation.set(rx, ry, rz);
  m.castShadow = true;
  g.add(m);
  return m;
}
// 一隻腳：肩膀的樞紐（擺動用）→ 往外斜下的大腿 → 往下的小腿
function leg(g, mat, x, y, z, side, len) {
  const hip = new THREE.Group(); hip.position.set(x, y, z); g.add(hip);
  const knee = new THREE.Group(); knee.position.set(side * len * 0.7, len * 0.25, 0); hip.add(knee);
  box(hip, mat, len * 0.75, 0.07, 0.07, side * len * 0.35, len * 0.12, 0, 0, 0, side * 0.35);
  box(knee, mat, 0.07, len * 0.85, 0.07, side * 0.05, -len * 0.42, 0, 0, 0, -side * 0.25);
  return { hip, knee, side };
}

const BUILD = {
  warrior(g, M) {
    box(g, M.body, 0.6, 0.38, 0.6, 0, 0.62, 0.05);                 // 胸
    box(g, M.plate, 0.5, 0.1, 0.5, 0, 0.84, 0.05);                 // 胸甲
    box(g, M.body, 0.7, 0.46, 0.85, 0, 0.66, -0.62, 0.18);         // 腹
    box(g, M.plate, 0.56, 0.1, 0.7, 0, 0.92, -0.6, 0.18);
    const head = new THREE.Group(); head.position.set(0, 0.66, 0.46); g.add(head);
    box(head, M.body, 0.4, 0.3, 0.34, 0, 0, 0.1);
    box(head, M.eye, 0.08, 0.06, 0.05, 0.12, 0.05, 0.27); box(head, M.eye, 0.08, 0.06, 0.05, -0.12, 0.05, 0.27);
    box(head, M.joint, 0.06, 0.06, 0.26, 0.1, -0.1, 0.32, 0, -0.35); box(head, M.joint, 0.06, 0.06, 0.26, -0.1, -0.1, 0.32, 0, 0.35);   // 大顎
    // 鐮刀腳：從胸前舉起來，攻擊時往前劈
    const scy = [];
    for (const s of [1, -1]) {
      const sh = new THREE.Group(); sh.position.set(s * 0.28, 0.75, 0.25); g.add(sh);
      box(sh, M.joint, 0.08, 0.08, 0.42, 0, 0.12, 0.12, -0.9);
      const blade = new THREE.Group(); blade.position.set(0, 0.32, 0.28); sh.add(blade);
      box(blade, M.plate, 0.06, 0.12, 0.62, 0, 0, 0.26, 0.5);
      scy.push(sh);
    }
    const legs = [];
    for (const z of [0.15, -0.1, -0.35]) for (const s of [1, -1]) legs.push(leg(g, M.joint, s * 0.28, 0.6, z, s, 0.7));
    return { legs, head, scy, sac: null, shell: null };
  },
  charger(g, M) {
    box(g, M.body, 0.95, 0.6, 1.1, 0, 0.8, -0.1);
    box(g, M.body, 0.85, 0.55, 0.9, 0, 0.78, -0.95, 0.15);
    box(g, M.plate, 0.7, 0.12, 0.8, 0, 1.12, -0.95, 0.15);
    const head = new THREE.Group(); head.position.set(0, 0.7, 0.55); g.add(head);
    box(head, M.body, 0.5, 0.38, 0.4, 0, 0, 0.08);
    box(head, M.eye, 0.09, 0.07, 0.05, 0.16, 0.06, 0.3); box(head, M.eye, 0.09, 0.07, 0.05, -0.16, 0.06, 0.3);
    // 正面甲殼：一大片往前斜的厚殼 + 頂上一片 + 一根角（甲殼碎掉就一起不見）
    const shell = new THREE.Group(); g.add(shell);
    box(shell, M.shell, 1.25, 0.85, 0.2, 0, 0.92, 0.72, -0.35);
    box(shell, M.shell, 1.05, 0.16, 0.95, 0, 1.25, 0.2, -0.1);
    box(shell, M.shell, 0.2, 0.2, 0.2, 0.52, 0.78, 0.8); box(shell, M.shell, 0.2, 0.2, 0.2, -0.52, 0.78, 0.8);
    box(shell, M.plate, 0.12, 0.12, 0.5, 0, 1.38, 0.82, -0.6);   // 角
    const legs = [];
    for (const z of [0.25, -0.2, -0.65]) for (const s of [1, -1]) legs.push(leg(g, M.joint, s * 0.42, 0.75, z, s, 0.9));
    return { legs, head, scy: [], sac: null, shell };
  },
  spitter(g, M) {
    box(g, M.body, 0.5, 0.34, 0.5, 0, 0.6, 0.15);
    const head = new THREE.Group(); head.position.set(0, 0.62, 0.48); g.add(head);
    box(head, M.body, 0.34, 0.26, 0.3, 0, 0, 0.06);
    box(head, M.eye, 0.07, 0.05, 0.05, 0.1, 0.05, 0.2); box(head, M.eye, 0.07, 0.05, 0.05, -0.1, 0.05, 0.2);
    // 屁股翹起來的酸液囊（發光、會一脹一縮）+ 幾條深色的殼紋
    const sac = new THREE.Group(); sac.position.set(0, 0.95, -0.45); sac.rotation.x = -0.5; g.add(sac);
    box(sac, M.acid, 0.7, 0.62, 0.78, 0, 0, -0.1);
    for (const z of [-0.35, -0.05, 0.25]) box(sac, M.joint, 0.74, 0.66, 0.07, 0, 0, z - 0.1);
    box(sac, M.joint, 0.16, 0.16, 0.2, 0, 0.22, -0.5);   // 噴口
    const legs = [];
    for (const z of [0.25, 0, -0.25]) for (const s of [1, -1]) legs.push(leg(g, M.joint, s * 0.22, 0.55, z, s, 0.62));
    return { legs, head, scy: [], sac, shell: null };
  },
};
// 酸液彈的發射點（本地座標，上半身）：投擲蟲的噴口
const MUZZLE = { spitter: [0, 0.75, -0.75] };

export function setupBug(e, kind, P) {
  const M = e.model;
  for (const k in e.parts) e.parts[k].g.visible = false;
  const mats = {
    body: new THREE.MeshLambertMaterial({ color: CHITIN }), plate: new THREE.MeshLambertMaterial({ color: PLATE }),
    joint: new THREE.MeshLambertMaterial({ color: JOINT }), shell: new THREE.MeshLambertMaterial({ color: SHELL }),
    eye: addMat(EYE, 0.95), acid: addMat(ACID, 0.85),
  };
  const g = new THREE.Group();
  g.position.y = -M.hipY;   // 上半身群組在腰的高度 → 蟲從地面算起
  M.torsoG.add(g);
  const B = BUILD[kind](g, mats);
  // 軀幹的材質換成蟲身體：閃白、燃燒 / 腐蝕的發光都打在身上
  e.parts.torso.mat = mats.body; e.parts.torso.base = 0x000000;
  if (MUZZLE[kind]) M.muzzles.backL = M.muzzles.backR = M.muzzles.armR = [...MUZZLE[kind]].map((v, i) => i === 1 ? v - M.hipY : v);
  e.bug = { kind, g, mats, ...B, strikeT: 0, die: (dx, dz) => bugDie(e, dx, dz) };
  // 衝鋒蟲：正面甲殼 = 正面的盾（mech.js hitMech：從正面 ±78° 來的攻擊先打在甲殼上）
  if (P.shell) {
    const max = P.shell * (e.diff?.hp ?? 1);
    e.shield = { slot: 'torso', front: true, hp: max, max, armor: e.loadout.armor.torso,
      onBreak: (dx, dz) => {
        burst(e.x, 1, e.z, [SHELL, PLATE], 12, 4, dx * 3, dz * 3);
        B.shell.visible = false;
      } };
    e.spec.turn *= 0.5;   // 轉得慢 → 繞到側面打軟的地方
  }
}

// 每幀：腳交互擺動（三腳一組）、走路時身體微微晃、攻擊的鐮刀 / 頭往前劈、酸液囊一脹一縮
export function updateBug(e, dt) {
  const B = e.bug, w = e.walk ?? 0, moving = Math.hypot(e.vx, e.vz) > 0.4;
  for (let i = 0; i < B.legs.length; i++) {
    const L = B.legs[i], ph = w * 1.6 + (i % 2 ? Math.PI : 0) + (Math.floor(i / 2) % 2 ? Math.PI : 0);
    L.hip.rotation.y = moving ? Math.sin(ph) * 0.45 : L.hip.rotation.y * Math.exp(-8 * dt);
    L.hip.rotation.z = moving ? L.side * Math.max(0, Math.cos(ph)) * 0.3 : 0;
  }
  B.g.position.y = -e.model.hipY + (moving ? Math.abs(Math.sin(w * 1.6)) * 0.04 : 0);
  if (B.strikeT > 0) B.strikeT -= dt;
  const k = B.strikeT > 0 ? Math.sin((1 - B.strikeT / 0.22) * Math.PI) : 0;
  for (const s of B.scy) s.rotation.x = -0.2 + 1.5 * k;
  B.head.rotation.x = 0.25 * k;
  if (B.sac) { const p = 1 + 0.06 * Math.sin(G.now * 5 + e.seed); B.sac.scale.set(p, p, p); }
}
export const bugStrike = e => { if (e.bug) e.bug.strikeT = 0.22; };

// 死掉：身體噴幾塊碎殼、酸液囊破掉；腳收起來、趴下、顏色變暗，屍體留著
function bugDie(e, dx, dz) {
  const B = e.bug;
  burst(e.x, 0.6, e.z, [CHITIN, PLATE, JOINT], 9, 3.5, dx * 2, dz * 2);
  if (B.sac) {
    for (let i = 0; i < 26; i++) spawnGlow({ x: e.x + R(-0.3, 0.3), y: 0.8, z: e.z + R(-0.3, 0.3), vx: R(-3, 3), vy: R(1, 4), vz: R(-3, 3), life: R(0.4, 0.8), s0: R(0.12, 0.22), s1: 0.03, ramp: RAMP.acid, g: 14, drag: 0.4 });
    smoke(e.x, 0.5, e.z, 4, 1, 0x5a6a3a);
    B.sac.visible = false;
    spawnZone(e.x, e.z, 1.4, 3, 'corrode', 0.8, e.team);   // 酸液囊破掉：留下一小灘酸
  }
  for (const L of B.legs) { L.hip.rotation.set(0, 0, -L.side * 0.5); L.knee.rotation.z = L.side * 0.9; }
  for (const s of B.scy) s.rotation.x = 0.9;
  for (const k of ['body', 'plate', 'joint', 'shell']) { B.mats[k].color.multiplyScalar(0.45); B.mats[k].emissive.setHex(0); }
  B.mats.eye.color.setHex(0x301008);
  B.g.position.y = -e.model.hipY - 0.32;
  const root = e.model.root;
  root.rotation.set(dz * 0.15, root.rotation.y, -dx * 0.15);
  e.model.torsoG.rotation.x = 0;
  sfx.partBreak();
  addHusk(root);
}
