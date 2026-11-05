import * as THREE from 'three';
import { sfx, unlockAudio } from './audio.js';
import { CAM_PITCH, G, camDist, camTarget, camera, renderer, scene, sun } from './core.js';
import { clearPressed, input, updateInput } from './input.js';
import { rayBlock } from './arena.js';
import { PLAYER_COLORS, collideMechs, driveMech, facing, makeMech, mechs, poseMech, removeMech, tryBoost } from './mech.js';
import { makeGuns, updateGuns, updateShots } from './weapons.js';
import { AI, enemies, keepEnemies, updateEnemy } from './ai.js';
import { makeLaser, setLaser, updateParticles } from './fx.js';
import { ARMORS, DMG_TYPES, SLOTS, SLOT_KEYS, loadLoadout } from './parts.js';
import { sensors, updateSensors } from './sensors.js';
import { closeGarage, garage, openGarage } from './garage.js';

const $ = id => document.getElementById(id);

// ---------- 玩家 ----------
let loadout = loadLoadout();
let player = null, respawnT = 0;
function spawnPlayer(x = 0, z = 6, yaw = Math.PI) {
  if (player) removeMech(player);
  player = makeMech({ team: 'player', colors: PLAYER_COLORS, loadout, x, z, yaw });
  player.guns = makeGuns(loadout);
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

// ---------- 整備 ----------
function toggleGarage() {
  if (garage.open) { closeGarage(); return; }
  openGarage(loadout, lo => {
    loadout = lo;
    const keep = player.alive ? [player.x, player.z, player.torsoYaw] : [0, 6, Math.PI];
    spawnPlayer(...keep);
  });
}
$('gClose').addEventListener('click', () => { sfx.click(); closeGarage(); });

// ---------- HUD ----------
function toast(text) {
  const t = $('toast');
  t.textContent = text; t.className = ''; void t.offsetWidth; t.className = 'show';
}
const hpColor = p => p.broken ? null : `hsl(${Math.round(120 * p.hp / p.max)}, 70%, 50%)`;
// 部位示意：底色 = 血量、外框 = 裝甲種類（intel = false 就只顯示血量）
function paintDoll(el, m, intel = true) {
  for (const d of el.querySelectorAll('[data-p]')) {
    const p = m?.parts[d.dataset.p];
    d.classList.toggle('none', !p);
    if (!p) continue;
    d.classList.toggle('broken', p.broken);
    d.classList.toggle('hit', p.flash > 0);
    d.style.background = hpColor(p) ?? '';
    d.style.outlineColor = intel ? ARMORS[p.armor].css : 'transparent';
  }
}
function gunState(m, slot) {
  const g = m.guns[slot];
  if (!g) return '—';
  if (m.parts[slot]?.broken) return '<span class="bad">損毀</span>';
  if (g.reloadT > 0) return '裝填中';
  if (g.def.energy) return m.energy < g.def.energy ? '<span class="bad">能量不足</span>' : g.cd > 0 ? '冷卻' : '就緒';
  if (g.def.needLock && !sensors.locks.length) return '需要鎖定';
  return g.def.mag ? `${g.ammo}/${g.def.mag}` : g.cd > 0 ? '冷卻' : '就緒';
}
let gunsKey = '';
function updateHud() {
  const p = player;
  paintDoll($('dollP'), p.alive ? p : null);
  const rows = SLOTS.map(s => {
    const g = p.guns[s];
    return `<div class="gun"><kbd>${SLOT_KEYS[s]}</kbd>${g ? `<i style="background:${DMG_TYPES[g.def.type].css}"></i>${g.def.name}` : '<span class="dim">（空）</span>'}<em>${gunState(p, s)}</em></div>`;
  }).join('');
  if (rows !== gunsKey) { gunsKey = rows; $('guns').innerHTML = rows; }
  $('energy').style.width = p.energy + '%';
  $('energy').parentElement.classList.toggle('low', p.energy < 30);
  $('surf').textContent = p.surf?.name ?? '';
  $('speed').textContent = Math.hypot(p.vx, p.vz).toFixed(1);
  const H = sensors.head;
  $('lockInfo').textContent = H?.lockCount ? `鎖定 ${sensors.locks.length}/${H.lockCount}` : '無法鎖定';
  const S = p.spec;
  $('warn').textContent = [S.loadK > 1 && '超重', S.armOver && '手臂超重', S.backOver && '背部超重', p.parts.head.broken && '頭部損毀：視野縮小'].filter(Boolean).join('・');
  // 準星附近、看得到的敵機
  let best = null, bd = 6;
  for (const e of enemies) {
    if (!e.alive || e.drop || !e.seen) continue;
    const d = Math.hypot(e.x - aimPoint.x, e.z - aimPoint.z);
    if (d < bd) { bd = d; best = e; }
  }
  const intel = !!H?.intel;
  $('target').classList.toggle('hidden', !best);
  if (best) {
    paintDoll($('dollE'), best, intel);
    $('tName').textContent = intel ? best.preset.name : '目標';
  }
  $('passive').classList.toggle('hidden', !AI.passive);
}

// ---------- 主迴圈 ----------
const TICK = location.search.includes('tick');
const nextFrame = TICK ? cb => setTimeout(() => cb(performance.now()), 16) : requestAnimationFrame;
let last = performance.now(), lastLocks = 0, garageK = 0;
function frame(t) {
  nextFrame(frame);
  const raw = Math.min(0.05, (t - last) / 1000);
  last = t;
  G.now += raw;
  updateInput();
  if (input.garagePressed) toggleGarage();
  if (input.pausePressed) {
    if (garage.open) closeGarage();
    else { G.paused = !G.paused; $('pause').classList.toggle('hidden', !G.paused); }
  }
  if (input.passivePressed) { AI.passive = !AI.passive; toast(AI.passive ? '敵機停火' : '敵機開火'); }
  if (input.resetPressed && !garage.open) { spawnPlayer(player.x, player.z, player.torsoYaw); toast('機體修復'); }

  let dt = G.paused || garage.open || window.__dbg.paused ? 0 : raw;
  if (dt > 0 && G.hitStop > 0) { G.hitStop -= raw; dt = 0; }
  if (dt > 0 && G.slowMo > 0) { G.slowMo -= raw; dt *= 0.35; }

  if (!garage.open) updateAim();
  if (dt > 0) {
    if (player.alive) {
      if (input.boostPressed) tryBoost(player, input.move.x, input.move.y);
      driveMech(player, dt, input.move.x, input.move.y, aimYaw);
      updateGuns(player, { armL: input.fireL, armR: input.fireR, backL: input.fireQ, backR: input.fireE }, dt, sensors.locks, aimPoint);
    } else if ((respawnT -= dt) <= 0) { spawnPlayer(); toast('重新出擊'); }
    for (const e of enemies.slice()) {
      updateEnemy(e, dt, player);
      if (e.alive && !e.drop) driveMech(e, dt, e.drive.mx, e.drive.mz, e.aimYaw);
    }
    keepEnemies(player);
    collideMechs();
    updateShots(dt);
    updateSensors(player, enemies, aimPoint, dt);
    if (sensors.locks.length > lastLocks) sfx.lock();
    lastLocks = sensors.locks.length;
    updateParticles(dt);
  }
  for (const m of mechs) poseMech(m, dt);
  clearPressed();

  // 瞄準線：從上半身正前方射出（頭部壞了就沒有）
  if (player.alive && !player.parts.head.broken && !garage.open) {
    const f = facing(player), ox = player.x + f.x * 0.9, oz = player.z + f.z * 0.9;
    const len = rayBlock(ox, oz, f.x, f.z, 22);
    setLaser(guide, ox, oz, f.x, f.z, len, 1.4, 0.3, 0.03);
  } else guide.g.visible = false;

  // 鏡頭：跟著玩家、往瞄準方向偏（扣掉鏡頭已經偏掉的量）；整備時拉近、讓機體在畫面左邊
  garageK += ((garage.open ? 1 : 0) - garageK) * (1 - Math.exp(-6 * raw));
  const REST_Z = -1.2 * (1 - garageK);
  let lx = 0, lz = 0;
  if (player.alive && !garage.open) {
    const ax = aimPoint.x - player.x - (camTarget.x - player.x), az = aimPoint.z - player.z - (camTarget.z - (player.z + REST_Z));
    const d = Math.hypot(ax, az), k = d > 0.01 ? Math.min(d * 0.3, 5) / d : 0;
    lx = ax * k; lz = az * k;
  }
  const dist = camDist * (1 - garageK * 0.45);
  if (garageK > 0.001) {
    // 整備面板蓋住右邊：鏡頭往右移，讓機體落在左邊空出來的那塊中間
    const visW = 2 * dist * Math.tan(camera.fov * Math.PI / 360) * camera.aspect;
    const panel = Math.min(820, innerWidth * 0.66) / innerWidth;
    lx += garageK * visW * panel / 2;
  }
  const ck = 1 - Math.exp(-5 * raw);
  camTarget.x += (player.x + lx - camTarget.x) * ck;
  camTarget.z += (player.z + REST_Z + lz - camTarget.z) * ck;
  G.trauma = Math.max(0, G.trauma - raw * 1.6);
  const sh = G.trauma * G.trauma * 0.7;
  const ox = (Math.random() - 0.5) * sh, oz = (Math.random() - 0.5) * sh;
  camera.position.set(camTarget.x + ox, Math.sin(CAM_PITCH) * dist, camTarget.z + Math.cos(CAM_PITCH) * dist + oz);
  camera.lookAt(camTarget.x + ox, 0, camTarget.z + oz);
  sun.position.set(camTarget.x - 8, 22, camTarget.z + 6);
  sun.target.position.set(camTarget.x, 0, camTarget.z);

  updateHud();
  renderer.render(scene, camera);
}
addEventListener('pointerdown', unlockAudio);
addEventListener('keydown', unlockAudio);
window.__dbg = { get player() { return player; }, enemies, mechs, AI, G, input, sensors, paused: false };
nextFrame(frame);
