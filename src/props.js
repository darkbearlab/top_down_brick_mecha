// ---------- 場景物件（遠征模式） ----------
// cache 補給箱：花零件打開，掉出一個強化模組
// weapon 武器箱：上面投影出裡面是哪一把（屬性色），花零件打開 → 變成地上的 gun（武器）
// gun 地上的武器：靠近按 F 裝上（換下來的那把也會丟在地上）
// station 修復站：花零件把整台修好（包括壞掉的部位），用一次就沒了
// portal 傳送門：state = idle（條件未達成，暗紅）/ ready（可以啟動，橘色脈動）/ boss（頭目戰中，紅）/ open（可以傳送，青色光柱）
// link 層與層的連接點（多層地圖）：p.up = 通往上面那層；地上幾圈光環往目的地的方向流動（往上 = 往上飄、往下 = 往下沉）
//   style：pad（台座，升降梯 / 彈射台）、hole（地下入口：黑色的洞）、shaft（地下那頭：往上的光柱）、edge（崖邊的跳下點：只有光環）
// 不擋路、不能打壞；玩家站在 RANGE 格內最近的那個可以互動；多層地圖每個物件有 layer，只跟目前這層的互動
import * as THREE from 'three';
import { addMat, scene } from './core.js';
import { DMG_TYPES, WEAPONS } from './parts.js';
import { fogMaterial } from './fog.js';

export const props = [];
export const RANGE = 2.6;
const CRATE = new THREE.BoxGeometry(1.1, 0.8, 0.8), LONG = new THREE.BoxGeometry(1.6, 0.6, 0.7), STRIP = new THREE.BoxGeometry(1.14, 0.12, 0.84);
const LONG_STRIP = new THREE.BoxGeometry(1.64, 0.1, 0.74), BAR = new THREE.BoxGeometry(1.1, 0.22, 0.26), RING = new THREE.RingGeometry(2.0, 2.5, 40), RING_S = new THREE.RingGeometry(0.7, 0.82, 24);
const PAD = new THREE.BoxGeometry(1.8, 0.25, 1.8), CROSS = new THREE.BoxGeometry(1.2, 0.08, 0.36);
const PILLAR = new THREE.BoxGeometry(0.5, 2.6, 0.5), BEAM = new THREE.CylinderGeometry(1.6, 1.6, 14, 24, 1, true);
const HOLE = new THREE.BoxGeometry(2.4, 0.06, 2.4), HOLE_MAT = new THREE.MeshBasicMaterial({ color: 0x030405 }), SHAFT = new THREE.CylinderGeometry(1.1, 1.1, 6, 20, 1, true);
const DARK = fogMaterial(new THREE.MeshLambertMaterial({ color: 0x3a3f4a })), DARK2 = fogMaterial(new THREE.MeshLambertMaterial({ color: 0x2a2d34 }));
const PORTAL_C = { idle: 0x803028, ready: 0xff9030, boss: 0xff3020, open: 0x60f0ff };

let curLayer = 0;
export function setPropLayer(k) { curLayer = k; }   // 之後新增的物件預設放在這層
export function addProp(kind, x, z, data = {}) {
  const g = new THREE.Group(), p = { kind, x, z, g, t: Math.random() * 6, layer: curLayer, ...data };
  if (kind === 'cache') {
    p.box = new THREE.Mesh(CRATE, DARK); p.box.position.y = 0.4; p.box.castShadow = true;
    p.glow = new THREE.Mesh(STRIP, addMat(0xc080ff, 0.9)); p.glow.position.y = 0.55;
    g.add(p.box, p.glow);
  } else if (kind === 'weapon' || kind === 'gun') {
    const c = DMG_TYPES[WEAPONS[p.weapon].type].hex;
    if (kind === 'weapon') {
      p.box = new THREE.Mesh(LONG, DARK2); p.box.position.y = 0.3; p.box.castShadow = true;
      p.glow = new THREE.Mesh(LONG_STRIP, addMat(c, 0.8)); p.glow.position.y = 0.42;
      g.add(p.box, p.glow);
    }
    // 浮在上面的「武器」：一條屬性色的棒子
    p.bar = new THREE.Mesh(BAR, new THREE.MeshBasicMaterial({ color: c }));
    p.bar.position.y = kind === 'weapon' ? 1.2 : 0.7;
    p.ring = new THREE.Mesh(RING_S, addMat(c, 0.6)); p.ring.rotation.x = -Math.PI / 2; p.ring.position.y = 0.04;
    g.add(p.bar, p.ring);
  } else if (kind === 'station') {
    p.box = new THREE.Mesh(PAD, DARK); p.box.position.y = 0.12; p.box.castShadow = true;
    p.glow = new THREE.Mesh(CROSS, addMat(0x60ff90, 0.9)); p.glow.position.y = 0.3;
    p.glow2 = new THREE.Mesh(CROSS, p.glow.material); p.glow2.position.y = 0.3; p.glow2.rotation.y = Math.PI / 2;
    p.ring = new THREE.Mesh(RING_S, addMat(0x60ff90, 0.5)); p.ring.rotation.x = -Math.PI / 2; p.ring.position.y = 0.04; p.ring.scale.setScalar(1.6);
    g.add(p.box, p.glow, p.glow2, p.ring);
  } else if (kind === 'link') {
    const c = p.up ? 0x60d0ff : 0xffb040;
    if (p.style === 'pad') { p.box = new THREE.Mesh(PAD, DARK); p.box.position.y = 0.12; p.box.castShadow = true; g.add(p.box); }
    else if (p.style === 'hole') { p.box = new THREE.Mesh(HOLE, HOLE_MAT); p.box.position.y = 0.03; g.add(p.box); }
    else if (p.style === 'shaft') { p.beam = new THREE.Mesh(SHAFT, addMat(c, 0.12)); p.beam.position.y = 3; g.add(p.beam); }
    p.ring = new THREE.Mesh(RING_S, addMat(c, 0.7)); p.ring.rotation.x = -Math.PI / 2; p.ring.position.y = 0.05; p.ring.scale.setScalar(1.7);
    p.rings = [0, 1, 2].map(() => { const m = new THREE.Mesh(RING_S, addMat(c, 0.6)); m.rotation.x = -Math.PI / 2; m.scale.setScalar(1.25); g.add(m); return m; });
    g.add(p.ring);
  } else if (kind === 'portal') {
    p.ring = new THREE.Mesh(RING, addMat(PORTAL_C.idle, 0.8)); p.ring.rotation.x = -Math.PI / 2; p.ring.position.y = 0.05;
    p.pillars = [];
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2 + Math.PI / 4, m = new THREE.Mesh(PILLAR, DARK); m.position.set(Math.sin(a) * 2.9, 1.3, Math.cos(a) * 2.9); m.castShadow = true;
      const tip = new THREE.Mesh(STRIP, addMat(PORTAL_C.idle, 0.9)); tip.scale.set(0.5, 1, 0.65); tip.position.set(m.position.x, 2.65, m.position.z);
      p.pillars.push(tip); g.add(m, tip);
    }
    p.beam = new THREE.Mesh(BEAM, addMat(PORTAL_C.open, 0.25)); p.beam.position.y = 7; p.beam.visible = false;
    g.add(p.ring, p.beam);
    p.state = 'idle';
  }
  g.position.set(x, 0, z);
  scene.add(g);
  props.push(p);
  return p;
}
export function setPortal(p, state) {
  p.state = state;
  const c = PORTAL_C[state];
  p.ring.material.color.setHex(c);
  for (const t of p.pillars) t.material.color.setHex(c);
  p.beam.visible = state === 'open';
}
// 打開過的箱子：燈熄掉、蓋子歪一邊
export function spendProp(p) {
  p.used = true;
  if (p.glow) p.glow.visible = false;
  if (p.glow2) p.glow2.visible = false;
  if (p.kind === 'station') p.ring.visible = false;
  if (p.bar && p.kind === 'weapon') p.bar.visible = p.ring.visible = false;
  if (p.box && p.kind !== 'station') { p.box.rotation.z = 0.25; p.box.position.y = 0.32; }
}
export function removeProp(p) {
  const i = props.indexOf(p);
  if (i >= 0) props.splice(i, 1);
  scene.remove(p.g);
  p.g.traverse(o => { if (o.material && o.material !== DARK && o.material !== DARK2 && o.material !== HOLE_MAT) o.material.dispose(); });
}
export function clearProps() { while (props.length) removeProp(props[props.length - 1]); }

export function updateProps(dt) {
  for (const p of props) {
    p.t += dt;
    if (p.bar) { p.bar.rotation.y = p.t * 1.5; p.bar.position.y = (p.kind === 'weapon' ? 1.2 : 0.7) + Math.sin(p.t * 2.5) * 0.1; }
    if (p.glow && !p.used) p.glow.material.opacity = 0.6 + 0.3 * Math.sin(p.t * 3);
    if (p.rings) p.rings.forEach((m, i) => {
      const f = (p.t * 0.7 + i / 3) % 1;
      m.position.y = 0.1 + (p.up ? f : 1 - f) * 2.6;
      m.material.opacity = 0.75 * Math.sin(f * Math.PI);
    });
    if (p.kind === 'portal') {
      const k = p.state === 'ready' || p.state === 'boss' ? 0.55 + 0.4 * Math.sin(p.t * (p.state === 'boss' ? 8 : 4)) : p.state === 'open' ? 0.9 : 0.5;
      p.ring.material.opacity = k;
      p.ring.rotation.z = p.t * (p.state === 'open' ? 1.5 : 0.3);
      if (p.beam.visible) p.beam.material.opacity = 0.18 + 0.08 * Math.sin(p.t * 5);
    }
  }
}
// 玩家附近可以互動的那個（用過的箱子不算）
export function nearProp(x, z, layer = undefined) {
  let best = null, bd = RANGE;
  for (const p of props) {
    if (p.used || (layer !== undefined && p.layer !== layer)) continue;
    const d = Math.hypot(p.x - x, p.z - z) - (p.kind === 'portal' ? 1.5 : 0);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}
