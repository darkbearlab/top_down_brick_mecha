import * as THREE from 'three';
import { sfx, unlockAudio } from './audio.js';
import { CAM_PITCH, G, camDist, camTarget, camera, renderer, scene, sun } from './core.js';
import { clearPressed, input, updateInput } from './input.js';
import { rayBlock } from './arena.js';
import { PART_NAMES, PLAYER_COLORS, collideMechs, driveMech, facing, makeMech, mechs, poseMech, removeMech, tryBoost } from './mech.js';
import { makeGuns, updateGun, updateShots } from './weapons.js';
import { AI, enemies, keepEnemies, updateEnemy } from './ai.js';
import { makeLaser, setLaser, updateParticles } from './fx.js';

const $ = id => document.getElementById(id);

// ---------- 玩家 ----------
let player = null, respawnT = 0;
function spawnPlayer(x = 0, z = 6) {
  if (player) removeMech(player);
  player = makeMech({ team: 'player', colors: PLAYER_COLORS, x, z, yaw: Math.PI });
  player.guns = makeGuns();
  player.onDeath = () => { respawnT = 2.5; toast('機體損毀'); };
  return player;
}
spawnPlayer();
camTarget.set(player.x, 0, player.z);
const guide = makeLaser(0x7ff0ff);

// ---------- 瞄準 ----------
const raycaster = new THREE.Raycaster(), ndc = new THREE.Vector2(), tmpV = new THREE.Vector3();
const aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.4);
let aimYaw = Math.PI, aimPoint = { x: 0, z: 0 };
function updateAim() {
  if (input.source === 'pad') {
    if (input.padAim.active) aimYaw = Math.atan2(input.padAim.x, input.padAim.y);
    aimPoint = { x: player.x + Math.sin(aimYaw) * 8, z: player.z + Math.cos(aimYaw) * 8 };
    return;
  }
  if (!input.mouse.seen) return;
  ndc.set(input.mouse.x / innerWidth * 2 - 1, -(input.mouse.y / innerHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  if (!raycaster.ray.intersectPlane(aimPlane, tmpV)) return;
  aimPoint = { x: tmpV.x, z: tmpV.z };
  if (Math.hypot(tmpV.x - player.x, tmpV.z - player.z) > 0.3) aimYaw = Math.atan2(tmpV.x - player.x, tmpV.z - player.z);
}

// ---------- HUD ----------
function toast(text) {
  const t = $('toast');
  t.textContent = text; t.className = ''; void t.offsetWidth; t.className = 'show';
}
const hpColor = p => p.broken ? null : `hsl(${Math.round(120 * p.hp / p.max)}, 70%, 50%)`;
function paintDoll(el, m) {
  for (const k in PART_NAMES) {
    const d = el.querySelector('.' + k), p = m?.parts[k];
    if (!p) { d.style.background = ''; d.classList.remove('broken'); continue; }
    d.classList.toggle('broken', p.broken);
    d.classList.toggle('hit', p.flash > 0);
    d.style.background = hpColor(p) ?? '';
  }
}
function gunText(g) {
  if (g.reloadT > 0) return '裝填中';
  return g.def.mag ? `${g.ammo}/${g.def.mag}` : g.cd > 0 ? '冷卻' : '就緒';
}
function updateHud() {
  const p = player;
  paintDoll($('dollP'), p.alive ? p : null);
  $('energy').style.width = (p.energy) + '%';
  $('energy').parentElement.classList.toggle('low', p.energy < 30);
  $('gunL').textContent = p.parts.armL.broken ? '左臂損毀' : `${p.guns.L.def.name} ${gunText(p.guns.L)}`;
  $('gunR').textContent = p.parts.armR.broken ? '右臂損毀' : `${p.guns.R.def.name} ${gunText(p.guns.R)}`;
  $('surf').textContent = p.surf?.name ?? '';
  $('speed').textContent = Math.hypot(p.vx, p.vz).toFixed(1);
  // 準星附近最近的敵機：顯示它的部位狀態
  let best = null, bd = 6;
  for (const e of enemies) {
    if (!e.alive || e.drop) continue;
    const d = Math.hypot(e.x - aimPoint.x, e.z - aimPoint.z);
    if (d < bd) { bd = d; best = e; }
  }
  $('dollE').parentElement.classList.toggle('hidden', !best);
  if (best) paintDoll($('dollE'), best);
  $('passive').classList.toggle('hidden', !AI.passive);
}

// ---------- 主迴圈 ----------
const TICK = location.search.includes('tick');
const nextFrame = TICK ? cb => setTimeout(() => cb(performance.now()), 16) : requestAnimationFrame;
let last = performance.now();
function frame(t) {
  nextFrame(frame);
  const raw = Math.min(0.05, (t - last) / 1000);
  last = t;
  G.now += raw;
  updateInput();
  if (input.pausePressed) { G.paused = !G.paused; $('pause').classList.toggle('hidden', !G.paused); }
  if (input.passivePressed) { AI.passive = !AI.passive; toast(AI.passive ? '敵機停火' : '敵機開火'); }
  if (input.resetPressed) { spawnPlayer(player.x, player.z); toast('機體修復'); }

  let dt = G.paused || window.__dbg.paused ? 0 : raw;
  if (dt > 0 && G.hitStop > 0) { G.hitStop -= raw; dt = 0; }
  if (dt > 0 && G.slowMo > 0) { G.slowMo -= raw; dt *= 0.35; }

  updateAim();
  if (dt > 0) {
    if (player.alive) {
      if (input.boostPressed) tryBoost(player, input.move.x, input.move.y);
      driveMech(player, dt, input.move.x, input.move.y, aimYaw);
      updateGun(player, 'L', input.fireL, dt);
      updateGun(player, 'R', input.fireR, dt);
    } else if ((respawnT -= dt) <= 0) { spawnPlayer(); toast('重新出擊'); }
    for (const e of enemies.slice()) {
      updateEnemy(e, dt, player);
      if (e.alive && !e.drop) driveMech(e, dt, e.drive.mx, e.drive.mz, e.aimYaw);
    }
    keepEnemies(player);
    collideMechs();
    updateShots(dt);
    for (const m of mechs) poseMech(m, dt);
    updateParticles(dt);
  }
  clearPressed();

  // 瞄準線：從上半身正前方射出（頭部壞了就沒有）
  if (player.alive && !player.parts.head.broken) {
    const f = facing(player), ox = player.x + f.x * 0.9, oz = player.z + f.z * 0.9;
    const len = rayBlock(ox, oz, f.x, f.z, 22);
    setLaser(guide, ox, oz, f.x, f.z, len, 1.4, 0.35, 0.03);
  } else guide.g.visible = false;

  // 鏡頭：跟著玩家、往瞄準方向偏；扣掉鏡頭目前已經偏掉的量，避免鏡頭推著游標跑
  const REST_Z = -1.2;
  let lx = 0, lz = 0;
  if (player.alive) {
    const ax = aimPoint.x - player.x - (camTarget.x - player.x), az = aimPoint.z - player.z - (camTarget.z - (player.z + REST_Z));
    const d = Math.hypot(ax, az), k = d > 0.01 ? Math.min(d * 0.3, 5) / d : 0;
    lx = ax * k; lz = az * k;
  }
  const ck = 1 - Math.exp(-5 * raw);
  camTarget.x += (player.x + lx - camTarget.x) * ck;
  camTarget.z += (player.z + REST_Z + lz - camTarget.z) * ck;
  G.trauma = Math.max(0, G.trauma - raw * 1.6);
  const sh = G.trauma * G.trauma * 0.7;
  const ox = (Math.random() - 0.5) * sh, oz = (Math.random() - 0.5) * sh;
  camera.position.set(camTarget.x + ox, Math.sin(CAM_PITCH) * camDist, camTarget.z + Math.cos(CAM_PITCH) * camDist + oz);
  camera.lookAt(camTarget.x + ox, 0, camTarget.z + oz);
  sun.position.set(camTarget.x - 8, 22, camTarget.z + 6);
  sun.target.position.set(camTarget.x, 0, camTarget.z);

  updateHud();
  renderer.render(scene, camera);
}
addEventListener('pointerdown', unlockAudio);
addEventListener('keydown', unlockAudio);
window.__dbg = { get player() { return player; }, enemies, mechs, AI, G, input, paused: false };
nextFrame(frame);
sfx.click();
