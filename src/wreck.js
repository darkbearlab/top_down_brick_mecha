// ---------- 擊墜演出與殘骸 ----------
// 主力機體（m.ace，預設都是；以後的雜魚機設 ace: false 就用舊的直接炸散）被打爆時：
//   1. 慢動作特寫：鏡頭拉近、上下黑邊，軀幹噴出一大把火花，一兩個部位先被炸飛
//   2. 大爆炸：機體燒黑、往被打的方向歪倒、陷下去一點
//   3. 殘骸：留在原地一直燒（火勢先大後小、不會熄），冒黑煙柱、斷口發紅；其他機體撞到會卡住
// 殘骸留到 clearWrecks()（競技場 = 下一局開始；以後的任務 = 任務結束）
import * as THREE from 'three';
import { G, addTrauma, scene } from './core.js';
import { RAMP, burnAt, explosion, fire, spawnGlow, spawnPuff, voxelBurst } from './fx.js';
import { sfx } from './audio.js';

export const wrecks = [];
const MAX_WRECKS = 10;
const SPARK_T = 0.11, FALL_T = 0.45;   // 遊戲時間（慢動作中走得很慢）
const R = (a, b) => a + Math.random() * (b - a);
const CHAR = 0x2c2622;
const tmp = new THREE.Vector3();

// 慢動作特寫（real 秒）；觀戰 / 對戰鏡頭都會用
export const killCam = { t: 0, x: 0, z: 0 };
export const SLOW_K = 0.12, KILL_SLOW = 2.0, KILL_CAM = 2.5;

export function startWreck(m, dx, dz) {
  const M = m.model;
  M.root.visible = true;
  const dl = Math.hypot(dx, dz) || 1;
  const w = {
    m, x: m.x, z: m.z, r: m.r * 0.95, t: 0, dx: dx / dl, dz: dz / dl, exploded: false,
    root: M.root, y0: M.root.position.y, flick: Math.random() * 10, fireAcc: 0, smokeAcc: 0,
    // 火點：軀幹上方 + 斷掉的部位
    spots: [], mats: [],
  };
  for (const k in m.parts) w.mats.push(m.parts[k].mat);
  // 先被炸飛的部位：還在的手臂 / 背部 / 頭，隨機一兩個
  const loose = ['armL', 'armR', 'backL', 'backR', 'head'].filter(k => m.parts[k] && m.parts[k].g.visible);
  for (let i = 0; i < Math.min(loose.length, 1 + (Math.random() < 0.5 ? 1 : 0)); i++) {
    const k = loose.splice(Math.floor(Math.random() * loose.length), 1)[0];
    blowOff(w, k, 6);
  }
  for (const k in m.parts) m.parts[k].mat.emissive.setHex(0xffffff);   // 被打爆的一瞬間整台閃白
  w.whiteT = 0.03;
  wrecks.push(w);
  while (wrecks.length > MAX_WRECKS) removeWreck(wrecks[0]);

  G.hitStop = Math.max(G.hitStop, 0.08);
  G.slowMo = Math.max(G.slowMo, KILL_SLOW);
  killCam.t = KILL_CAM; killCam.x = m.x; killCam.z = m.z;
  document.body.classList.add('killcam');
  addTrauma(0.5);
  sfx.partBreak();
  return w;
}

function blowOff(w, k, power) {
  const p = w.m.parts[k];
  if (!p || !p.g.visible) return;
  voxelBurst(p.g, 40, power, w.x, w.z, w.dx * 4, w.dz * 4);
  p.g.getWorldPosition(tmp);
  w.spots.push({ x: tmp.x - w.x, y: Math.max(0.6, tmp.y), z: tmp.z - w.z, k: 0.55 });
  p.g.visible = false;
}

function torsoY(w) { return w.m.model.hipY + 0.9; }

export function updateWrecks(dt, raw) {
  if (killCam.t > 0 && (killCam.t -= raw) <= 0) document.body.classList.remove('killcam');
  updateDying(dt);
  for (const w of wrecks) {
    w.t += dt;
    if (w.whiteT > 0 && (w.whiteT -= raw) <= 0) for (const k in w.m.parts) w.m.parts[k].mat.emissive.setHex(w.m.parts[k].base);
    const ty = torsoY(w);
    // 1. 火花噴泉（慢動作裡看得到一根根飛出去）
    if (!w.exploded) {
      const n = Math.round(dt * 1600);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, el = R(0.15, 1.2), sp = R(7, 19);
        spawnGlow({ x: w.x + R(-0.3, 0.3), y: ty + R(-0.3, 0.4), z: w.z + R(-0.3, 0.3),
          vx: Math.cos(a) * Math.cos(el) * sp + w.dx * 4, vy: Math.sin(el) * sp, vz: Math.sin(a) * Math.cos(el) * sp + w.dz * 4,
          life: R(0.5, 1.2), s0: R(0.09, 0.16), s1: 0.02, ramp: RAMP.spark, g: 20, drag: 0.9, bounce: true });
      }
      if (Math.random() < dt * 60) spawnGlow({ x: w.x + R(-0.4, 0.4), y: ty + R(-0.3, 0.3), z: w.z + R(-0.4, 0.4), life: 0.08, s0: R(0.5, 0.9), s1: 0.2, ramp: RAMP.flash, vr: 0 });
      if (w.t >= SPARK_T) explode(w);
    }
    // 2. 歪倒、陷下去
    if (w.exploded) {
      const f = Math.min(1, (w.t - SPARK_T) / FALL_T), e = 1 - (1 - f) ** 3;
      const tilt = 0.38 * e;
      w.root.rotation.set(w.dz * tilt, w.root.rotation.y, -w.dx * tilt);
      w.root.position.y = w.y0 - 0.28 * e;
    }
    // 3. 燒：火勢先大後小、不會熄
    const age = Math.max(0, w.t - SPARK_T);
    const k = w.exploded ? 0.45 + 0.75 * Math.exp(-age / 3) : 0;
    w.fireAcc += dt * 45 * k;
    while (w.fireAcc >= 1) {
      w.fireAcc--;
      const s = w.spots.length && Math.random() < 0.45 ? w.spots[Math.floor(Math.random() * w.spots.length)] : null;
      if (s) fire(w.x + s.x, s.y, w.z + s.z, 0.4 + s.k * k);
      else fire(w.x + R(-0.35, 0.35), ty - 0.2, w.z + R(-0.35, 0.35), 0.55 + k * 0.6);
    }
    // 黑煙柱
    w.smokeAcc += dt * (w.exploded ? 3.5 : 0);
    while (w.smokeAcc >= 1) {
      w.smokeAcc--;
      spawnPuff({ x: w.x + R(-0.3, 0.3), y: ty + 0.4, z: w.z + R(-0.3, 0.3), vx: R(-0.2, 0.2) + 0.25, vy: R(1.3, 2), vz: R(-0.2, 0.2) - 0.15,
        life: R(2.4, 3.4), s: R(0.45, 0.7), c0: 0x121216, c1: 0x46484e, drag: 0.35 });
    }
    // 偶爾劈啪一下：火星和小火花
    if (w.exploded && Math.random() < dt * 1.2) {
      for (let i = 0; i < 8; i++) {
        const a = Math.random() * Math.PI * 2, sp = R(2, 6);
        spawnGlow({ x: w.x, y: ty, z: w.z, vx: Math.cos(a) * sp, vy: R(3, 7), vz: Math.sin(a) * sp, life: R(0.4, 0.9), s0: 0.07, s1: 0.02, ramp: RAMP.spark, g: 18, drag: 1, bounce: true });
      }
    }
    // 燒紅的餘燼在鋼板底下一閃一閃
    if (w.exploded && !(w.whiteT > 0)) {
      w.flick += dt * 9;
      const glow = (0.5 + 0.5 * Math.sin(w.flick) * Math.sin(w.flick * 0.37 + 1)) * (0.35 + 0.65 * k);
      const hex = (Math.round(0x40 * glow) << 16) | (Math.round(0x0c * glow) << 8);
      for (const mat of w.mats) mat.emissive.setHex(hex);
    }
  }
}

function explode(w) {
  w.exploded = true;
  const ty = torsoY(w);
  explosion(w.x, ty, w.z, 1.5);
  setTimeout(() => wrecks.includes(w) && explosion(w.x + R(-0.6, 0.6), ty - 0.3, w.z + R(-0.6, 0.6), 0.7), 220);
  // 再炸掉一點：剩下的手臂一半機率飛走
  for (const k of ['armL', 'armR', 'backL', 'backR', 'head']) if (Math.random() < 0.35) blowOff(w, k, 8);
  for (const mat of w.mats) mat.color.setHex(CHAR);
  w.whiteT = 0;
  sfx.explode();
  addTrauma(0.8);
}

// 機體撞到殘骸：推出來、不反彈（回傳撞擊速度給呼叫的人決定要不要卡住）
export function collideWrecks(o) {
  let hit = 0, nx = 0, nz = 0;
  for (const w of wrecks) {
    if (w.m === o) continue;
    const dx = o.x - w.x, dz = o.z - w.z, d = Math.hypot(dx, dz), min = o.r + w.r;
    if (d >= min || d < 1e-4) continue;
    const ux = dx / d, uz = dz / d;
    o.x = w.x + ux * min; o.z = w.z + uz * min;
    const vn = o.vx * ux + o.vz * uz;
    if (vn < 0) { o.vx -= vn * ux; o.vz -= vn * uz; if (-vn > hit) { hit = -vn; nx = ux; nz = uz; } }
  }
  return { hit, nx, nz };
}

export const isWreck = m => wrecks.some(w => w.m === m);

function removeWreck(w) {
  const i = wrecks.indexOf(w);
  if (i >= 0) wrecks.splice(i, 1);
  scene.remove(w.root);
}
// ---------- 雜魚的擊破演出（startDying） ----------
// 兩種（隨機，飛的一定是第一種）：
//   chain：某個部位先炸開，其他部位一個接一個被誘爆（間隔 0.1～0.35 秒），還沒炸的部位冒火、燒紅；軀幹最後大爆炸
//   burn：不炸，原地燒：慢慢歪倒、陷下去、越燒越黑，3.5～5 秒後火熄掉，焦炭殘骸一直留著（toHusk）
// 模型歸這裡管（removeMech 看到 m.dying 不會拿掉），演完自己拿掉
const dyings = [];
const CHAR_D = new THREE.Color(0x231e1a), WHITE = new THREE.Color(0xffffff);
const DYING_CHAIN = 0.6;   // 誘爆的機率（其他是原地燒）
export function startDying(m, dx, dz, o = {}) {
  const dl = Math.hypot(dx, dz) || 1;
  const keys = Object.keys(m.parts).filter(k => m.parts[k].g.visible);
  const d = { m, root: m.model.root, x: m.x, z: m.z, dx: dx / dl, dz: dz / dl, t: 0, boom: o.boom, y0: m.model.root.position.y,
    fireAcc: 0, smokeAcc: 0, flick: Math.random() * 10, mats: keys.map(k => m.parts[k].mat) };
  m.dying = true;
  const rest = keys.filter(k => k !== 'torso');
  if (!o.burn && (o.chain || rest.length === 0 || Math.random() < DYING_CHAIN)) {
    d.mode = 'chain'; d.queue = [];
    for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
    let t = 0;
    for (const k of rest) { d.queue.push({ k, t }); t += R(0.1, 0.35); }
    d.queue.push({ k: 'torso', t: t + R(0.05, 0.25) });
  } else {
    d.mode = 'burn'; d.end = R(3.5, 5);
    explosion(d.x, d.y0 + m.model.hipY + 0.6, d.z, 0.55);
    sfx.partBreak();
  }
  dyings.push(d);
  return d;
}
function partPos(d, k) { d.m.parts[k].g.getWorldPosition(tmp); return tmp; }
function popPart(d, k) {
  const p = d.m.parts[k];
  if (k === 'torso') {
    d.boom?.();
    for (const kk in d.m.parts) if (d.m.parts[kk].g.visible) voxelBurst(d.m.parts[kk].g, kk === 'torso' ? 55 : 30, 7, d.x, d.z, d.dx * 3, d.dz * 3, { char: 0.72, burn: 0.3 });
    burnAt(d.x, 0.25, d.z, 3.5, 0.9);
    sfx.explode(); addTrauma(0.3);
    endDying(d);
    return;
  }
  if (!p?.g.visible) return;
  voxelBurst(p.g, 40, 6, d.x, d.z, d.dx * 2, d.dz * 2, { char: 0.55, burn: 0.35 });
  const P = partPos(d, k);
  explosion(P.x, Math.max(0.5, P.y), P.z, 0.5);
  p.g.visible = false;
  sfx.partBreak(); addTrauma(0.15);
}
function endDying(d) {
  const i = dyings.indexOf(d);
  if (i >= 0) dyings.splice(i, 1);
  scene.remove(d.root);
}
function updateDying(dt) {
  for (const d of dyings.slice()) {
    d.t += dt;
    const ty = d.y0 + d.m.model.hipY + 0.5;
    if (d.mode === 'chain') {
      while (d.queue.length && d.queue[0].t <= d.t) { const q = d.queue.shift(); popPart(d, q.k); if (!dyings.includes(d)) break; }
      if (!dyings.includes(d)) continue;
      // 還沒炸的部位：冒火、火花，鋼板燒紅（越接近下一次爆炸越亮）
      d.fireAcc += dt * 40;
      while (d.fireAcc >= 1) { d.fireAcc--; fire(d.x + R(-0.4, 0.4), ty + R(-0.3, 0.4), d.z + R(-0.4, 0.4), 0.55); }
      if (Math.random() < dt * 25) {
        const a = Math.random() * Math.PI * 2, sp = R(3, 9);
        spawnGlow({ x: d.x, y: ty, z: d.z, vx: Math.cos(a) * sp, vy: R(2, 7), vz: Math.sin(a) * sp, life: R(0.3, 0.7), s0: 0.08, s1: 0.02, ramp: RAMP.spark, g: 18, drag: 1, bounce: true });
      }
      d.flick += dt * 30;
      const g = 0.6 + 0.4 * Math.sin(d.flick);
      const hex = (Math.round(0x70 * g) << 16) | (Math.round(0x18 * g) << 8);
      for (const mat of d.mats) mat.emissive.setHex(hex);
      continue;
    }
    // burn：歪倒、陷下去、燒黑
    const f = Math.min(1, d.t / d.end), e = 1 - (1 - Math.min(1, d.t / 1.2)) ** 3;
    d.root.rotation.set(d.dz * 0.3 * e, d.root.rotation.y, -d.dx * 0.3 * e);
    d.root.position.y = d.y0 - 0.22 * e - 0.15 * f;
    const ck = Math.min(1, d.t / 2.4);
    for (const mat of d.mats) mat.color.copy(WHITE).lerp(CHAR_D, ck);
    d.flick += dt * 9;
    const glow = (0.5 + 0.5 * Math.sin(d.flick) * Math.sin(d.flick * 0.37 + 1)) * (1 - f * 0.7);
    const hex = (Math.round(0x50 * glow) << 16) | (Math.round(0x10 * glow) << 8);
    for (const mat of d.mats) mat.emissive.setHex(hex);
    d.fireAcc += dt * 34 * (1 - f * 0.65);
    while (d.fireAcc >= 1) {
      d.fireAcc--;
      const ks = Object.keys(d.m.parts).filter(k => d.m.parts[k].g.visible), P = partPos(d, ks[Math.floor(Math.random() * ks.length)]);
      fire(P.x + R(-0.25, 0.25), Math.max(0.3, P.y), P.z + R(-0.25, 0.25), 0.45 + 0.4 * (1 - f));
    }
    d.smokeAcc += dt * 3;
    while (d.smokeAcc >= 1) {
      d.smokeAcc--;
      spawnPuff({ x: d.x + R(-0.3, 0.3), y: ty + 0.3, z: d.z + R(-0.3, 0.3), vx: R(-0.2, 0.2) + 0.2, vy: R(1.2, 1.8), vz: R(-0.2, 0.2) - 0.1,
        life: R(2, 3), s: R(0.4, 0.6), c0: 0x121216, c1: 0x46484e, drag: 0.35 });
    }
    if (d.t >= d.end) toHusk(d);
  }
}
// ---------- 焦炭殘骸（原地燒完的雜魚） ----------
// 燒完不散掉，焦黑的機體一直留在原地（只是看的，不擋路）；每層各自一份（換層隱藏、回來再出現），換關 / 換模式時清掉
// 最多 HUSK_MAX 台，超過就拿掉最舊的
const husks = [], HUSK_MAX = 150;
let huskLayer = 0;
function toHusk(d) {
  for (const mat of d.mats) { mat.color.copy(CHAR_D); mat.emissive.setHex(0x000000); }
  // 腳、手臂（連手上的武器 / 光束劍）、背部武器燒斷掉下來（焦炭碎塊幾乎原地落下），只剩軀幹和頭坐在地上
  for (const k of ['legs', 'armL', 'armR', 'backL', 'backR']) {
    const p = d.m.parts[k];
    if (!p?.g.visible) continue;
    voxelBurst(p.g, 24, 1, d.x, d.z, 0, 0, { char: 1 });
    p.g.visible = false;
  }
  const M = d.m.model;
  d.root.rotation.set(d.dz * 0.22, d.root.rotation.y, -d.dx * 0.22);
  d.root.position.y = d.y0 - M.hipY * M.root.scale.y * 0.8;
  const i = dyings.indexOf(d);
  if (i >= 0) dyings.splice(i, 1);
  husks.push({ root: d.root, layer: huskLayer });
  while (husks.length > HUSK_MAX) scene.remove(husks.shift().root);
}
export function setHuskLayer(k) {
  huskLayer = k;
  for (const h of husks) h.root.visible = h.layer === k;
}
export function clearHusks() {
  for (const h of husks) scene.remove(h.root);
  husks.length = 0;
}

export function clearWrecks() {
  while (dyings.length) dyings[0].mode === 'burn' ? toHusk(dyings[0]) : endDying(dyings[0]);   // 正在燒的直接變成焦炭殘骸
  while (wrecks.length) removeWreck(wrecks[0]);
  killCam.t = 0;
  document.body.classList.remove('killcam');
}
