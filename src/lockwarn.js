// ---------- 被鎖定警示 ----------
// 畫面上方一條警示 + 玩家機體周圍一圈方向箭頭 + 嗶聲：
//   鎖定警告（黃）：有敵人正在鎖你（顯示最快那台的進度條，嗶聲越鎖越快）
//   已被鎖定（紅，閃）：有敵人鎖上了（下一輪就會射飛彈）
//   飛彈接近（紅，快閃）：有追蹤你的飛彈在飛（顯示幾發）
// 箭頭：指向正在鎖你的敵人（黃 / 紅）和追過來的飛彈（紅、比較大），貼在玩家機體在螢幕上的位置周圍
// 來源：ai.js / brainapi.js 每幀給每台機體的 e.lockOn = { tgt, k 0..1 }；weapons.js 的 shots 裡 target 是玩家的飛彈
import * as THREE from 'three';
import { camera } from './core.js';
import { shots } from './weapons.js';
import { mechs } from './mech.js';
import { sfx } from './audio.js';

const bar = document.createElement('div');
bar.id = 'lockWarn'; bar.className = 'hidden';
bar.innerHTML = '<b></b><i><s></s></i>';
const ring = document.createElement('div');
ring.id = 'lockRing';
document.body.append(bar, ring);
const label = bar.querySelector('b'), fill = bar.querySelector('s');
const arrows = [];
const arrow = i => { while (arrows.length <= i) { const a = document.createElement('div'); a.className = 'lockArrow'; ring.appendChild(a); arrows.push(a); } return arrows[i]; };
const v0 = new THREE.Vector3(), v1 = new THREE.Vector3();
let beepT = 0, lastState = '';

// 世界方向 (dx, dz) → 螢幕上的角度（從玩家在螢幕上的位置看）
function screenAngle(p, dx, dz) {
  v0.set(p.x, 1, p.z).project(camera); v1.set(p.x + dx * 3, 1, p.z + dz * 3).project(camera);
  return Math.atan2(-(v1.y - v0.y), v1.x - v0.x);
}

export function updateLockWarn(dt, player, show) {
  if (!show || !player?.alive) { bar.classList.add('hidden'); for (const a of arrows) a.style.display = 'none'; lastState = ''; return; }
  const lockers = mechs.filter(e => e.alive && e.lockOn?.tgt === player && e.lockOn.k > 0);
  const missiles = shots.filter(s => s.target === player && (s.kind === 'missile' || s.kind === 'vmissile' || s.kind === 'split'));
  const kMax = lockers.reduce((m, e) => Math.max(m, e.lockOn.k), 0);
  const state = missiles.length ? 'missile' : kMax >= 1 ? 'locked' : kMax > 0 ? 'locking' : '';
  bar.classList.toggle('hidden', !state);
  bar.className = state ? `lw-${state}` : 'hidden';
  if (state === 'missile') label.textContent = `飛彈接近 ×${missiles.length}`;
  else if (state === 'locked') label.textContent = `已被鎖定${lockers.length > 1 ? ` ×${lockers.filter(e => e.lockOn.k >= 1).length}` : ''}`;
  else if (state === 'locking') label.textContent = '鎖定警告';
  fill.style.width = `${Math.round((state === 'locking' ? kMax : 1) * 100)}%`;
  // 嗶聲：鎖定中越鎖越快；鎖上了 / 飛彈來了固定節奏；剛進入新狀態馬上響一次
  beepT -= dt;
  if (state && (state !== lastState || beepT <= 0)) {
    if (state === 'missile') { sfx.missileWarn(); beepT = 0.32; }
    else if (state === 'locked') { sfx.lockedWarn(); beepT = 0.2; }
    else { sfx.lockWarn(); beepT = 0.65 - 0.5 * kMax; }
  }
  lastState = state;
  // 方向箭頭
  v0.set(player.x, 1, player.z).project(camera);
  const cx = (v0.x + 1) / 2 * innerWidth, cy = (1 - v0.y) / 2 * innerHeight;
  let i = 0;
  const put = (dx, dz, cls, dist) => {
    const a = arrow(i++), ang = screenAngle(player, dx, dz), r = cls === 'm' ? 78 : 92;
    a.style.display = 'block';
    a.className = `lockArrow la-${cls}`;
    a.style.transform = `translate(${cx + Math.cos(ang) * r}px, ${cy + Math.sin(ang) * r}px) rotate(${ang}rad)`;
    a.style.opacity = cls === 'm' ? 1 : Math.max(0.45, 1 - dist / 40);
  };
  for (const e of lockers) { const dx = e.x - player.x, dz = e.z - player.z, d = Math.hypot(dx, dz) || 1; put(dx / d, dz / d, e.lockOn.k >= 1 ? 'l' : 'w', d); }
  for (const s of missiles) { const dx = s.x - player.x, dz = s.z - player.z, d = Math.hypot(dx, dz) || 1; put(dx / d, dz / d, 'm', d); }
  for (; i < arrows.length; i++) arrows[i].style.display = 'none';
}
