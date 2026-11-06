import * as THREE from 'three';
import { sfx, unlockAudio } from './audio.js';
import { CAM_PITCH, G, camDist, camTarget, camera, renderer, scene, sun } from './core.js';
import { clearPressed, input, updateInput } from './input.js';
import { rayBlock } from './arena.js';
import { ENEMY_COLORS, PLAYER_COLORS, collideMechs, driveMech, facing, makeMech, mechs, poseMech, removeMech, tryBoost } from './mech.js';
import { SLOW_K, clearWrecks, killCam, updateWrecks } from './wreck.js';
import { clearShots, makeGuns, updateGuns, updateShots } from './weapons.js';
import { AI, DIFFS, clearEnemies, enemies, keepEnemies, spawnEnemy, updateEnemy } from './ai.js';
import { makeLaser, setLaser, updateParticles } from './fx.js';
import { ARMORS, DMG_TYPES, ENEMY_PRESETS, LEGS, SLOTS, SLOT_KEYS, WEAPONS, loadLoadout, randomLoadout } from './parts.js';
import { sensors, setSensorsVisible, updateSensors } from './sensors.js';
import { closeGarage, garage, openGarage } from './garage.js';

const $ = id => document.getElementById(id);

// ---------- 模式 ----------
// menu：主選單（機體站在場中間、鏡頭慢慢繞）
// duel：一對一，打倒對手或被打倒就結束
// sandbox：試玩場，敵機一開始停火（T 切換），被打爆會自動重生
// watch：觀戰，兩台電腦機體互打（現成配裝或隨機組裝），打完自動換一組重開
const MODE = { name: 'menu', duel: null, endT: 0, round: 0, score: { blue: 0, red: 0 } };
const BLUE_COLORS = { accent: 0x3a8cff, glow: 0x90c0ff };
const PLAYER_START = { x: -3, z: 9 }, DUEL_ENEMY = { x: 3, z: -9 };

// ---------- 玩家 ----------
let loadout = loadLoadout();
let player = null, respawnT = 0;
function spawnPlayer(x = PLAYER_START.x, z = PLAYER_START.z, yaw = Math.PI) {
  if (player) removeMech(player);
  player = makeMech({ team: 'player', colors: PLAYER_COLORS, loadout, x, z, yaw });
  player.guns = makeGuns(loadout);
  player.onDeath = () => {
    if (MODE.name === 'duel') { MODE.endT = 3.4; MODE.result = 'lose'; }
    else { respawnT = 2.5; toast('機體損毀'); }
  };
  return player;
}
const guide = makeLaser(0x7ff0ff);

function resetWorld() {
  clearEnemies();
  clearShots();
  G.paused = false; G.slowMo = 0; G.hitStop = 0;
  clearWrecks();
  sensors.progress.clear(); sensors.locks = [];
  MODE.endT = 0; MODE.result = null;
  hidePanel();
}
function startSandbox() {
  resetWorld();
  MODE.name = 'sandbox';
  AI.sandbox = true; AI.passive = true; AI.count = 2; AI.diff = DIFFS.normal;
  spawnPlayer();
  showHud();
  toast('試玩場・敵機停火中（T 開火）');
}
function startDuel(preset, diffKey) {
  resetWorld();
  MODE.name = 'duel';
  MODE.duel = { preset, diffKey };
  MODE.endT = 0; MODE.result = null;
  AI.sandbox = false; AI.passive = false; AI.diff = DIFFS[diffKey];
  spawnPlayer();
  const P = preset ?? ENEMY_PRESETS[Math.floor(Math.random() * ENEMY_PRESETS.length)];
  spawnEnemy(player, P, DUEL_ENEMY);
  showHud();
  toast(`對戰・${P.name}`);
}
// 觀戰：一半機率用現成配裝、一半隨機組裝
const watchLoadout = () => Math.random() < 0.5 ? ENEMY_PRESETS[Math.floor(Math.random() * ENEMY_PRESETS.length)] : randomLoadout();
function startWatch(fresh = false) {
  resetWorld();
  MODE.name = 'watch';
  if (fresh) { MODE.round = 0; MODE.score = { blue: 0, red: 0 }; }
  MODE.round++;
  AI.sandbox = false; AI.passive = false; AI.diff = DIFFS.hard;
  if (player) { removeMech(player); player.alive = false; }
  const blue = spawnEnemy({ x: 3, z: -9 }, watchLoadout(), { x: -3, z: 9 }, { team: 'blue', colors: BLUE_COLORS });
  const red = spawnEnemy({ x: -3, z: 9 }, watchLoadout(), { x: 3, z: -9 }, { team: 'red', colors: ENEMY_COLORS });
  blue.foe = red; red.foe = blue;
  $('menu').classList.add('hidden'); $('duel').classList.add('hidden'); $('hud').classList.add('hidden');
  $('watch').classList.remove('hidden');
  setSensorsVisible(false);
  for (const [side, m] of [['B', blue], ['R', red]]) {
    $('w' + side + 'Name').textContent = m.preset.name;
    $('w' + side + 'Guns').innerHTML = SLOTS.map(s => m.preset[s]).filter(Boolean).map(id => `<span class="wt" style="--c:${DMG_TYPES[WEAPONS[id].type].css}">${WEAPONS[id].name}</span>`).join('') +
      `<span class="wt" style="--c:#8a96a6">${LEGS[m.preset.legs].name}</span>`;
  }
  toast(`第 ${MODE.round} 場`);
}
AI.onEnemyDeath = () => {
  if (MODE.name === 'duel' && !enemies.some(e => e.alive) && !MODE.result) { MODE.endT = 3.4; MODE.result = 'win'; }
  if (MODE.name === 'watch' && !MODE.result) {
    const alive = enemies.filter(e => e.alive);
    if (alive.length <= 1) {
      MODE.result = alive[0]?.team ?? 'draw';
      if (MODE.result !== 'draw') MODE.score[MODE.result]++;
      MODE.endT = 4.5;
      setTimeout(() => { if (MODE.name === 'watch') toast(MODE.result === 'blue' ? '藍方勝利' : MODE.result === 'red' ? '紅方勝利' : '同歸於盡'); }, 2000);
    }
  }
};
function showHud() {
  $('menu').classList.add('hidden'); $('duel').classList.add('hidden'); $('watch').classList.add('hidden');
  $('hud').classList.remove('hidden');
  setSensorsVisible(true);
  $('help').classList.toggle('hidden', MODE.name !== 'sandbox');
}
function showMenu() {
  resetWorld();
  MODE.name = 'menu';
  AI.sandbox = false;
  spawnPlayer(0, 0, 0);
  $('hud').classList.add('hidden'); $('duel').classList.add('hidden'); $('watch').classList.add('hidden');
  $('menu').classList.remove('hidden');
  setSensorsVisible(false);
}

// ---------- 面板（暫停、結果、說明） ----------
function showPanel(title, html, buttons) {
  $('pTitle').textContent = title;
  $('pBody').innerHTML = html;
  const box = $('pButtons');
  box.innerHTML = '';
  for (const b of buttons) {
    const el = document.createElement('button');
    el.className = 'btn' + (b.primary ? ' primary' : '');
    el.textContent = b.label;
    el.onclick = () => { unlockAudio(); sfx.click(); b.run(); };
    box.appendChild(el);
  }
  $('panel').classList.remove('hidden');
}
function hidePanel() { $('panel').classList.add('hidden'); }
const panelOpen = () => !$('panel').classList.contains('hidden');
function restart() { MODE.name === 'duel' ? startDuel(MODE.duel.preset, MODE.duel.diffKey) : MODE.name === 'watch' ? startWatch() : startSandbox(); }
function pause() {
  G.paused = true;
  showPanel('暫停', MODE.name === 'duel' ? `對戰・${DIFFS[MODE.duel.diffKey].name}` : MODE.name === 'watch' ? `觀戰・第 ${MODE.round} 場` : '試玩場', [
    { label: '繼續', primary: true, run: () => { hidePanel(); G.paused = false; } },
    { label: MODE.name === 'watch' ? '下一場' : '重新開始', run: restart },
    ...(MODE.name === 'duel' ? [{ label: '換對手', run: openDuelSetup }] : []),
    { label: '回主選單', run: showMenu },
  ]);
}
function showResult(win) {
  G.paused = true;
  sfx.click();
  showPanel(win ? '勝利' : '敗北', win ? '對手機體已擊毀' : '機體損毀', [
    { label: '再戰一次', primary: true, run: restart },
    { label: '換對手', run: openDuelSetup },
    { label: '整備', run: () => { hidePanel(); openGarageFrom('result'); } },
    { label: '回主選單', run: showMenu },
  ]);
}
const HELP = `<div class="help">
<b>操作</b>WASD 移動・滑鼠瞄準・左鍵 / 右鍵 左右手・Q / E 左右背・Space / Shift 推進衝刺<br>G 整備・Esc 暫停<br>
手把：左右搖桿、LT / RT 左右手、LB / RB 左右背、A 衝刺、Back 整備、Start 暫停<br>
<b>移動</b>有慣性：放開方向鍵會滑一段。冰面很滑、泥地很慢。衝刺吃能量，不受摩擦限制<br>
<b>屬性</b>動能剋鏡面、化學剋複合、能量剋陶瓷；反過來會被擋下（藍白色火花）<br>
<b>部位</b>打到哪看子彈從哪個方向來：正面是軀幹裝甲、側面是手臂、背面是弱點和背部武器<br>
<b>視野</b>地上淡淡的扇形是頭的視野，視野外的敵機看不到，只有雷達光點。飛彈要先鎖定（準星附近慢慢鎖上）</div>`;

// ---------- 主選單與對戰設定 ----------
$('mDuel').onclick = () => { unlockAudio(); sfx.click(); openDuelSetup(); };
$('mSandbox').onclick = () => { unlockAudio(); sfx.click(); startSandbox(); };
$('mWatch').onclick = () => { unlockAudio(); sfx.click(); startWatch(true); };
$('mGarage').onclick = () => { unlockAudio(); sfx.click(); openGarageFrom('menu'); };
$('mHelp').onclick = () => { unlockAudio(); sfx.click(); showPanel('操作說明', HELP, [{ label: '返回', primary: true, run: hidePanel }]); };

let duelPick = 0, duelDiff = 'normal';
const wTag = id => id ? `<span class="wt" style="--c:${DMG_TYPES[WEAPONS[id].type].css}">${WEAPONS[id].name}</span>` : '';
function presetCard(P, i) {
  const armors = [...new Set(Object.values(P.armor))].map(a => `<span class="wt" style="--c:${ARMORS[a].css}">${ARMORS[a].name}</span>`).join('');
  return `<button class="card ${i === duelPick ? 'on' : ''}" data-i="${i}"><b>${P.name}</b>
    <small>${LEGS[P.legs].name}・${SLOTS.map(s => P[s]).filter(Boolean).length} 把武器</small>
    <div>${SLOTS.map(s => wTag(P[s])).join('')}</div><div>裝甲 ${armors}</div></button>`;
}
function renderDuel() {
  $('dCards').innerHTML = ENEMY_PRESETS.map(presetCard).join('') +
    `<button class="card ${duelPick === -1 ? 'on' : ''}" data-i="-1"><b>隨機</b><small>四種裡隨便挑一台</small></button>`;
  $('dDiff').innerHTML = Object.entries(DIFFS).map(([k, D]) => `<button class="${k === duelDiff ? 'on' : ''}" data-k="${k}">${D.name}</button>`).join('');
  $('dCards').querySelectorAll('.card').forEach(b => b.onclick = () => { duelPick = +b.dataset.i; sfx.click(); renderDuel(); });
  $('dDiff').querySelectorAll('button').forEach(b => b.onclick = () => { duelDiff = b.dataset.k; sfx.click(); renderDuel(); });
}
function openDuelSetup() {
  hidePanel();
  if (MODE.name !== 'menu') showMenu();
  $('menu').classList.add('hidden');
  $('duel').classList.remove('hidden');
  renderDuel();
}
$('dStart').onclick = () => { unlockAudio(); sfx.click(); startDuel(duelPick < 0 ? null : ENEMY_PRESETS[duelPick], duelDiff); };
$('dBack').onclick = () => { sfx.click(); $('duel').classList.add('hidden'); $('menu').classList.remove('hidden'); };

// ---------- 整備 ----------
let garageFrom = null;
function openGarageFrom(from) {
  garageFrom = from;
  $('menu').classList.add('hidden');
  openGarage(loadout, lo => {
    loadout = lo;
    const keep = player.alive ? [player.x, player.z, player.torsoYaw] : [PLAYER_START.x, PLAYER_START.z, Math.PI];
    spawnPlayer(...keep);
  });
}
function leaveGarage() {
  closeGarage();
  if (garageFrom === 'menu') $('menu').classList.remove('hidden');
  else if (garageFrom === 'result') restart();
}
$('gClose').addEventListener('click', () => { sfx.click(); leaveGarage(); });

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
  // 準星附近、看得到的敵機；對戰中一直顯示對手
  let best = null, bd = MODE.name === 'duel' ? Infinity : 6;
  for (const e of enemies) {
    if (!e.alive || e.drop || (!e.seen && MODE.name !== 'duel')) continue;
    const d = Math.hypot(e.x - aimPoint.x, e.z - aimPoint.z);
    if (d < bd) { bd = d; best = e; }
  }
  const intel = !!H?.intel;
  $('target').classList.toggle('hidden', !best);
  if (best) {
    paintDoll($('dollE'), best, intel);
    $('tName').textContent = intel ? best.preset.name : '目標';
  }
  $('passive').classList.toggle('hidden', !(AI.passive && MODE.name === 'sandbox'));
}

// ---------- 主迴圈 ----------
const TICK = location.search.includes('tick');
const nextFrame = TICK ? cb => setTimeout(() => cb(performance.now()), 16) : requestAnimationFrame;
let last = performance.now(), lastLocks = 0, garageK = 0, watchK = 1, killK = 0;
function frame(t) {
  nextFrame(frame);
  const raw = Math.min(0.05, (t - last) / 1000);
  last = t;
  G.now += raw;
  updateInput();
  const playing = MODE.name !== 'menu', watching = MODE.name === 'watch';
  if (input.garagePressed && !watching) { if (garage.open) leaveGarage(); else if (playing && !panelOpen()) openGarageFrom('play'); }
  if (input.pausePressed) {
    if (garage.open) leaveGarage();
    else if (playing && (!MODE.result || watching)) { if (G.paused) { hidePanel(); G.paused = false; } else pause(); }
  }
  if (playing && MODE.name === 'sandbox' && input.passivePressed) { AI.passive = !AI.passive; toast(AI.passive ? '敵機停火' : '敵機開火'); }
  if (playing && MODE.name === 'sandbox' && input.resetPressed && !garage.open) { spawnPlayer(player.x, player.z, player.torsoYaw); toast('機體修復'); }

  let dt = !playing || G.paused || garage.open || window.__dbg.paused ? 0 : raw;
  if (dt > 0 && G.hitStop > 0) { G.hitStop -= raw; dt = 0; }
  // 慢動作：被擊墜時很慢（SLOW_K），最後 0.4 秒慢慢回到正常速度
  if (dt > 0 && G.slowMo > 0) { G.slowMo -= raw; const k = killCam.t > 0 ? SLOW_K : 0.35; dt *= G.slowMo < 0.4 ? k + (1 - k) * (1 - G.slowMo / 0.4) : k; }

  if (playing && !watching && !garage.open) updateAim();
  if (dt > 0) {
    if (watching) { /* 沒有玩家 */ }
    else if (player.alive) {
      if (input.boostPressed) tryBoost(player, input.move.x, input.move.y);
      driveMech(player, dt, input.move.x, input.move.y, aimYaw);
      updateGuns(player, { armL: input.fireL, armR: input.fireR, backL: input.fireQ, backR: input.fireE }, dt, sensors.locks, aimPoint);
    } else if (MODE.name === 'sandbox' && (respawnT -= dt) <= 0) { spawnPlayer(); toast('重新出擊'); }
    for (const e of enemies.slice()) {
      updateEnemy(e, dt, e.foe ?? player);
      if (e.alive && !e.drop) driveMech(e, dt, e.drive.mx, e.drive.mz, e.aimYaw);
    }
    keepEnemies(player);
    collideMechs();
    updateShots(dt);
    updateWrecks(dt, raw);
    if (!watching) {
      updateSensors(player, enemies, aimPoint, dt);
      if (sensors.locks.length > lastLocks) sfx.lock();
      lastLocks = sensors.locks.length;
    }
    // 對戰結束：倒下的動畫播一下再出結果；觀戰：自動下一場
    if (MODE.endT > 0 && (MODE.endT -= raw) <= 0) watching ? startWatch() : showResult(MODE.result === 'win');
  }
  if (!playing || dt > 0 || garage.open) updateParticles(playing ? dt : raw);
  for (const m of mechs) poseMech(m, dt);
  if (!playing) { player.torsoYaw = player.legYaw = G.now * 0.25; poseMech(player, 0); }
  clearPressed();

  // 瞄準線：從上半身正前方射出（頭部壞了就沒有）
  if (playing && !watching && player.alive && !player.parts.head.broken && !garage.open) {
    const f = facing(player), ox = player.x + f.x * 0.9, oz = player.z + f.z * 0.9;
    const len = rayBlock(ox, oz, f.x, f.z, 22);
    setLaser(guide, ox, oz, f.x, f.z, len, 1.4, 0.3, 0.03);
  } else guide.g.visible = false;

  // 鏡頭：跟著玩家、往瞄準方向偏（扣掉鏡頭已經偏掉的量）；整備時拉近、讓機體在畫面左邊；主選單拉近看機體
  garageK += ((garage.open || !playing ? 1 : 0) - garageK) * (1 - Math.exp(-6 * raw));
  const REST_Z = -1.2 * (1 - garageK);
  let lx = 0, lz = 0;
  if (playing && player.alive && !garage.open) {
    const ax = aimPoint.x - player.x - (camTarget.x - player.x), az = aimPoint.z - player.z - (camTarget.z - (player.z + REST_Z));
    const d = Math.hypot(ax, az), k = d > 0.01 ? Math.min(d * 0.3, 5) / d : 0;
    lx = ax * k; lz = az * k;
  }
  const dist = camDist * (1 - garageK * 0.45);
  if (garageK > 0.001) {
    // 整備 / 選單面板在右邊：鏡頭往右移，讓機體落在左邊空出來的那塊中間
    const visW = 2 * dist * Math.tan(camera.fov * Math.PI / 360) * camera.aspect;
    const panel = (garage.open ? Math.min(820, innerWidth * 0.66) : Math.min(560, innerWidth * 0.5)) / innerWidth;
    lx += garageK * visW * panel / 2;
  }
  // 觀戰：鏡頭看兩台的中間，離得越遠拉得越遠
  let fx = player.x, fz = player.z + REST_Z, distK = 1;
  if (watching) {
    const live = enemies.filter(e => e.alive && !e.drop), all = live.length ? live : enemies;
    if (all.length) {
      fx = all.reduce((a, e) => a + e.x, 0) / all.length; fz = all.reduce((a, e) => a + e.z, 0) / all.length - 0.8;
      const sep = all.length > 1 ? Math.hypot(all[0].x - all[1].x, all[0].z - all[1].z) : 0;
      distK = Math.max(0.75, Math.min(1.35, 0.6 + sep / 22));
    }
    lx = lz = 0;
  }
  // 擊墜特寫：鏡頭飛到被打爆的那台、拉近
  const kc = killCam.t > 0 && playing;
  if (kc) { fx = killCam.x; fz = killCam.z - 0.4; lx = lz = 0; }
  killK += ((kc ? 1 : 0) - killK) * (1 - Math.exp(-(kc ? 7 : 2.5) * raw));
  const ck = 1 - Math.exp(-(kc ? 8 : watching ? 2.5 : 5) * raw);
  camTarget.x += (fx + lx - camTarget.x) * ck;
  camTarget.z += (fz + lz - camTarget.z) * ck;
  watchK += (distK - watchK) * (1 - Math.exp(-1.5 * raw));
  G.trauma = Math.max(0, G.trauma - raw * 1.6);
  const sh = G.trauma * G.trauma * 0.7;
  const ox = (Math.random() - 0.5) * sh, oz = (Math.random() - 0.5) * sh;
  const cd = dist * (watching ? watchK : 1) * (1 - 0.42 * killK);
  camera.position.set(camTarget.x + ox, Math.sin(CAM_PITCH) * cd, camTarget.z + Math.cos(CAM_PITCH) * cd + oz);
  camera.lookAt(camTarget.x + ox, 0, camTarget.z + oz);
  sun.position.set(camTarget.x - 8, 22, camTarget.z + 6);
  sun.target.position.set(camTarget.x, 0, camTarget.z);

  if (playing && !watching) updateHud();
  if (watching) {
    const blue = enemies.find(e => e.team === 'blue'), red = enemies.find(e => e.team === 'red');
    paintDoll($('dollB'), blue?.alive ? blue : null); paintDoll($('dollR'), red?.alive ? red : null);
    $('wScore').innerHTML = `<b class="blue">${MODE.score.blue}</b> : <b class="red">${MODE.score.red}</b>`;
    $('wRound').textContent = `第 ${MODE.round} 場`;
    $('wNext').textContent = MODE.result && MODE.endT > 0 ? `${Math.ceil(MODE.endT)} 秒後下一場` : '';
  }
  renderer.render(scene, camera);
}
addEventListener('pointerdown', unlockAudio);
addEventListener('keydown', unlockAudio);
window.__dbg = { get player() { return player; }, enemies, mechs, AI, G, input, sensors, MODE, startDuel, startSandbox, startWatch, showMenu, paused: false };
showMenu();
camTarget.set(player.x, 0, player.z);
nextFrame(frame);
