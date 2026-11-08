// ---------- 持續效果（通用、可以分部位） ----------
// 每台機體一張清單 m.st = [{ id, part, t, stacks, acc }]：part = 掛在哪個部位（null = 整台）、t = 還剩幾秒、stacks = 層數（可以是小數）
// 規則都寫在 STATUS 表：dur 預設秒數、max 最多幾層、tick 每隔幾秒觸發一次 onTick、fx 每幀的特效、onEnd 結束時
// 同一種效果掛在同一個部位會合併：秒數取比較長的、層數相加（不超過 max）
// 這個檔案只 import core / fx（不 import mech，避免循環）；要扣血 / 殉爆時呼叫 mech.js 用 setStatusHooks 掛進來的函式
import * as THREE from 'three';
import { G } from './core.js';
import { RAMP, smoke, spawnGlow } from './fx.js';

const hooks = { damage: null, cookOff: null };
export function setStatusHooks(h) { Object.assign(hooks, h); }

const R = (a, b) => a + Math.random() * (b - a);
const tmpV = new THREE.Vector3();
const partPos = (m, part) => {
  const p = m.parts[part] ?? m.parts.torso;
  return p.g.visible ? p.g.getWorldPosition(tmpV) : tmpV.set(m.x, m.model.hipY + 0.6, m.z);
};

// ---------- 燃燒 ----------
// 打中哪個部位就燒哪個部位；每層每秒扣 BURN_DPS（照化學對那個部位裝甲的剋制倍率）；那個部位壞了 → 火延燒到軀幹
// 各部位燒起來的額外影響（給 mech / weapons / sensors / ai 查）：
//   頭：鎖定變慢 ×(1 + 0.15 × 層數)　手臂 / 背部：那把武器散布變大 ×(1 + 0.15 × 層數)
//   背部：有彈藥的武器有機率殉爆（每秒 3% × 層數）　腳：移動變慢（每層 −7%，最多 −35%）
// 推進一次甩掉 1.5 層（全部部位）
export const BURN_DPS = 3.2, BURN_MAX = 5, BURN_DUR = 3;
const BURN_TICK = 0.25;

export const STATUS = {
  mark: { dur: 8, max: 1 },     // 弱點標定（devices.js）：打中時大多打到軀幹以外的部位（mech.js hitMech）
  emp: { dur: 2, max: 1 },      // 電磁脈衝（devices.js）：武器停擺（tech.js empOff）
  burn: {
    dur: BURN_DUR, max: BURN_MAX, tick: BURN_TICK,
    onTick(m, s) {
      hooks.damage?.(m, s.part ?? 'torso', BURN_DPS * s.stacks * BURN_TICK, 'chemical');
      // 背部武器殉爆
      if ((s.part === 'backL' || s.part === 'backR') && Math.random() < 0.03 * s.stacks * BURN_TICK) hooks.cookOff?.(m, s.part);
    },
    fx(m, s, dt) {
      const p = m.parts[s.part ?? 'torso'];
      if (!p) return;
      s.fxAcc = (s.fxAcc ?? 0) + dt * (6 + 7 * s.stacks);
      if (s.fxAcc >= 1) {
        const w = partPos(m, s.part ?? 'torso');
        while (s.fxAcc >= 1) {
          s.fxAcc--;
          spawnGlow({ x: w.x + R(-0.25, 0.25), y: w.y + R(-0.1, 0.25), z: w.z + R(-0.25, 0.25), vx: R(-0.4, 0.4), vy: R(1.5, 3), vz: R(-0.4, 0.4),
            life: R(0.25, 0.5), s0: R(0.14, 0.26), s1: 0, ramp: RAMP.fire, drag: 1 });
        }
        if (Math.random() < 0.25) smoke(w.x, w.y + 0.3, w.z, 1, 0.5, 0x2a2a2e);
      }
      // 燒著的部位一閃一閃發橘光（被打中的白閃優先）
      if (p.flash <= 0 && p.mat) p.mat.emissive.setRGB(0.35 + 0.25 * Math.sin(G.now * 23 + s.stacks), 0.1, 0);
    },
    onEnd(m, s) { const p = m.parts[s.part ?? 'torso']; if (p?.mat && p.flash <= 0) p.mat.emissive.setHex(p.base); },
  },
};

const find = (m, id, part) => m.st?.find(s => s.id === id && s.part === part);
// 掛上效果：o = { part, dur, stacks }
export function applyStatus(m, id, o = {}) {
  if (!m.alive) return null;
  const D = STATUS[id], part = o.part ?? null;
  m.st ??= [];
  let s = find(m, id, part);
  if (!s) { s = { id, part, t: 0, stacks: 0, acc: 0 }; m.st.push(s); }
  s.t = Math.max(s.t, o.dur ?? D.dur);
  s.stacks = Math.min(D.max ?? 1, s.stacks + (o.stacks ?? 1));
  return s;
}
// 有沒有（part 不給 = 任何部位都算）
export const hasStatus = (m, id, part) => !!m.st?.some(s => s.id === id && (part === undefined || s.part === part));
// 層數（part 不給 = 全部部位加起來）
export function statusStacks(m, id, part) {
  let n = 0;
  if (m.st) for (const s of m.st) if (s.id === id && (part === undefined || s.part === part)) n += s.stacks;
  return n;
}
// 減層（全部部位）：推進甩火之類
export function reduceStatus(m, id, n) {
  if (!m.st) return;
  for (const s of m.st) if (s.id === id) { s.stacks -= n; if (s.stacks <= 0) s.t = 0; }
}
export function clearStatus(m) {
  if (!m.st) return;
  for (const s of m.st) STATUS[s.id].onEnd?.(m, s);
  m.st.length = 0;
}

export function updateStatus(m, dt) {
  if (!m.st?.length) return;
  if (!m.alive) { clearStatus(m); return; }
  for (let i = m.st.length - 1; i >= 0; i--) {
    const s = m.st[i], D = STATUS[s.id];
    // 掛的部位壞掉了（不是軀幹）：燒到軀幹
    if (s.part && s.part !== 'torso' && (!m.parts[s.part] || m.parts[s.part].broken)) {
      D.onEnd?.(m, s);
      m.st.splice(i, 1);
      if (s.id === 'burn' && s.t > 0) applyStatus(m, 'burn', { part: 'torso', dur: s.t, stacks: s.stacks * 0.7 });
      continue;
    }
    s.t -= dt;
    if (D.tick) { s.acc += dt; while (s.acc >= D.tick && m.alive) { s.acc -= D.tick; D.onTick(m, s); } }
    if (!m.alive) return;
    if (s.t <= 0 || s.stacks <= 0) { D.onEnd?.(m, s); m.st.splice(i, 1); continue; }
    D.fx?.(m, s, dt);
  }
}

// ---------- 給其他模組查的倍率 ----------
// 某個掛點的武器燒起來 → 散布變大
export const burnSpreadK = (m, slot) => 1 + 0.15 * statusStacks(m, 'burn', slot);
// 頭燒起來 → 鎖定變慢
export const burnLockK = m => 1 + 0.15 * statusStacks(m, 'burn', 'head');
// 腳燒起來 → 變慢
export const burnLegK = m => 1 - Math.min(0.35, 0.07 * statusStacks(m, 'burn', 'legs'));
