// ---------- 擊墜演出與殘骸 ----------
// 主力機體（m.ace，預設都是；以後的雜魚機設 ace: false 就用舊的直接炸散）被打爆時：
//   1. 慢動作特寫：鏡頭拉近、上下黑邊，軀幹噴出一大把火花，一兩個部位先被炸飛
//   2. 大爆炸：機體燒黑、往被打的方向歪倒、陷下去一點
//   3. 殘骸：留在原地一直燒（火勢先大後小、不會熄），冒黑煙柱、斷口發紅；其他機體撞到會卡住
// 殘骸留到 clearWrecks()（競技場 = 下一局開始；以後的任務 = 任務結束）
import * as THREE from 'three';
import { G, addTrauma, scene } from './core.js';
import { RAMP, explosion, fire, spawnGlow, spawnPuff, voxelBurst } from './fx.js';
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
export function clearWrecks() {
  while (wrecks.length) removeWreck(wrecks[0]);
  killCam.t = 0;
  document.body.classList.remove('killcam');
}
