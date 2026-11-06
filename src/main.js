import * as THREE from 'three';
import { sfx, unlockAudio } from './audio.js';
import { CAM_PITCH, G, camDist, camTarget, camera, renderer, scene, sun } from './core.js';
import { clearPressed, input, updateInput } from './input.js';
import { randomOpenSpot, rayBlock } from './arena.js';
import { ENEMY_COLORS, PLAYER_COLORS, activeSlot, collideMechs, driveMech, facing, makeMech, mechs, poseMech, removeMech, toggleReady, tryBoost, wantsLock } from './mech.js';
import { resetBuildings, updateBuildings } from './buildings.js';
import { SLOW_K, clearWrecks, killCam, updateWrecks } from './wreck.js';
import { clearShots, makeGuns, updateGuns, updateShots } from './weapons.js';
import { AI, DIFFS, clearEnemies, enemies, keepEnemies, spawnEnemy, updateEnemy } from './ai.js';
import { makeLaser, setLaser, updateParticles } from './fx.js';
import { ARMORS, DMG_TYPES, ENEMY_PRESETS, LEGS, SLOTS, SLOT_KEYS, WEAPONS, loadLoadout, randomGrunt, randomLoadout } from './parts.js';
import { sensors, setSensorsVisible, updateSensors } from './sensors.js';
import { closeGarage, garage, openGarage } from './garage.js';

const $ = id => document.getElementById(id);

// ---------- 模式 ----------
// menu：主選單（機體站在場中間、鏡頭慢慢繞）
// duel：一對一，打倒對手或被打倒就結束
// sandbox：試玩場，敵機一開始停火（T 切換），被打爆會自動重生
// watch：觀戰，兩台電腦機體互打（現成配裝或隨機組裝），打完自動換一組重開
// watch 有三種（MODE.kind）：'duel' 一對一、'horde' 王牌 vs 雜魚、'skirmish' 雜魚 vs 雜魚
const MODE = { name: 'menu', kind: 'duel', duel: null, endT: 0, round: 0, score: { blue: 0, red: 0 }, horde: null, sk: null };
const BLUE_COLORS = { accent: 0x3a8cff, glow: 0x90c0ff };
// 試玩場從中間偏下出發；對戰 / 觀戰兩邊從競技場左右兩側出發、面對面
const PLAYER_START = { x: 0, z: 6 }, SIDE_A = { x: -26, z: 0 }, SIDE_B = { x: 26, z: 0 };

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
  resetBuildings();
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
  spawnPlayer(SIDE_A.x, SIDE_A.z, Math.PI / 2);
  const P = preset ?? ENEMY_PRESETS[Math.floor(Math.random() * ENEMY_PRESETS.length)];
  spawnEnemy(player, P, SIDE_B);
  showHud();
  toast(`對戰・${P.name}`);
}
// 觀戰：一半機率用現成配裝、一半隨機組裝
const watchLoadout = () => Math.random() < 0.5 ? ENEMY_PRESETS[Math.floor(Math.random() * ENEMY_PRESETS.length)] : randomLoadout();
function startWatch(fresh = false) {
  resetWorld();
  MODE.name = 'watch';
  if (fresh || MODE.kind !== 'duel') { MODE.round = 0; MODE.score = { blue: 0, red: 0 }; }
  MODE.kind = 'duel';
  MODE.round++;
  AI.sandbox = false; AI.passive = false; AI.diff = DIFFS.hard;
  if (player) { removeMech(player); player.alive = false; }
  const blue = spawnEnemy(SIDE_B, watchLoadout(), SIDE_A, { team: 'blue', colors: BLUE_COLORS });
  const red = spawnEnemy(SIDE_A, watchLoadout(), SIDE_B, { team: 'red', colors: ENEMY_COLORS });
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
// ---------- 觀戰：王牌 vs 雜魚 ----------
// 一台王牌機（強敵難度）從中間降落；雜魚機（新手難度：傷害低、瞄不準、打得慢）一批批從天上隨機撒下來，場上最多 HORDE_MAX 台、總共 HORDE_TOTAL 台
// 雜魚全滅 → 王牌勝；王牌被打爆 → 雜魚勝
const HORDE_TOTAL = 18, HORDE_MAX = 5, HORDE_FIRST = 3, HORDE_GAP = 2.2;
// 雜魚的派系色：裝甲混 78% 隊伍色、腳下一圈光環
const GRUNT_COLORS = { accent: 0xa8321a, glow: 0xff5a30, tint: 0.78 };
function startHorde(fresh = false) {
  resetWorld();
  MODE.name = 'watch';
  if (fresh || MODE.kind !== 'horde') { MODE.round = 0; MODE.score = { blue: 0, red: 0 }; }
  MODE.kind = 'horde';
  MODE.round++;
  AI.sandbox = false; AI.passive = false; AI.diff = DIFFS.hard;
  if (player) { removeMech(player); player.alive = false; }
  const ace = spawnEnemy({ x: 0, z: -10 }, watchLoadout(), { x: 0, z: 6 }, { team: 'blue', colors: BLUE_COLORS, diff: DIFFS.hard });
  MODE.horde = { ace, spawned: 0, killed: 0, t: 1.5 };
  for (let i = 0; i < HORDE_FIRST; i++) dropGrunt();
  $('menu').classList.add('hidden'); $('duel').classList.add('hidden'); $('hud').classList.add('hidden');
  $('watch').classList.remove('hidden');
  setSensorsVisible(false);
  $('wBName').textContent = ace.preset.name;
  $('wBGuns').innerHTML = SLOTS.map(s => ace.preset[s]).filter(Boolean).map(id => `<span class="wt" style="--c:${DMG_TYPES[WEAPONS[id].type].css}">${WEAPONS[id].name}</span>`).join('') +
    `<span class="wt" style="--c:#8a96a6">${LEGS[ace.preset.legs].name}</span>`;
  $('wRName').textContent = '雜魚部隊';
  toast(`第 ${MODE.round} 場・王牌 vs 雜魚`);
}
function dropGrunt() {
  const H = MODE.horde;
  if (H.spawned >= HORDE_TOTAL) return;
  H.spawned++;
  const at = randomOpenSpot(H.ace.x, H.ace.z, 9);
  const g = spawnEnemy(H.ace, randomGrunt(), at, { team: 'red', colors: GRUNT_COLORS, diff: DIFFS.easy, grunt: true });
  g.foe = H.ace;
}
// 每幀：補雜魚、王牌挑最近的雜魚當目標（現在的目標有 3 格的優勢，不會一直換）
function updateHorde(dt) {
  const H = MODE.horde;
  if (!H || MODE.result) return;
  const grunts = enemies.filter(e => e.grunt && e.alive);
  if (grunts.length < HORDE_MAX && (H.t -= dt) <= 0) { H.t = HORDE_GAP * (0.6 + Math.random() * 0.8); dropGrunt(); }
  let best = null, bd = Infinity;
  for (const g of grunts) {
    if (g.drop) continue;
    const d = Math.hypot(g.x - H.ace.x, g.z - H.ace.z) - (g === H.ace.foe ? 3 : 0);
    if (d < bd) { bd = d; best = g; }
  }
  H.ace.foe = best;
}
// ---------- 觀戰：雜魚 vs 雜魚 ----------
// 藍、紅兩隊雜魚（普通難度）各 SK_TOTAL 台，從自己那半邊一批批空投，場上每隊最多 SK_MAX 台；先全滅的輸
// 每台自動挑最近的敵方雜魚打；鏡頭看所有還活著的雜魚的中間，散得越開拉得越遠
const SK_TOTAL = 12, SK_MAX = 5, SK_FIRST = 3, SK_GAP = 2.4;
const GRUNT_BLUE = { accent: 0x2a62c0, glow: 0x70b0ff, tint: 0.78 };
function spotOnSide(side) {
  for (let i = 0; i < 40; i++) { const p = randomOpenSpot(0, 0, 0); if (side < 0 ? p.x < -8 : p.x > 8) return p; }
  return { x: side * 26, z: 0 };
}
function startSkirmish(fresh = false) {
  resetWorld();
  MODE.name = 'watch';
  if (fresh || MODE.kind !== 'skirmish') { MODE.round = 0; MODE.score = { blue: 0, red: 0 }; }
  MODE.kind = 'skirmish';
  MODE.round++;
  AI.sandbox = false; AI.passive = false; AI.diff = DIFFS.normal;
  if (player) { removeMech(player); player.alive = false; }
  MODE.sk = { blue: { side: -1, spawned: 0, killed: 0, t: 1 }, red: { side: 1, spawned: 0, killed: 0, t: 1 } };
  for (let i = 0; i < SK_FIRST; i++) { skDrop('blue'); skDrop('red'); }
  $('menu').classList.add('hidden'); $('duel').classList.add('hidden'); $('hud').classList.add('hidden');
  $('watch').classList.remove('hidden');
  setSensorsVisible(false);
  $('wBName').textContent = '藍軍雜魚'; $('wRName').textContent = '紅軍雜魚';
  toast(`第 ${MODE.round} 場・雜魚 vs 雜魚`);
}
function skDrop(team) {
  const T = MODE.sk[team];
  if (T.spawned >= SK_TOTAL) return;
  T.spawned++;
  const at = spotOnSide(T.side);
  const dummy = { x: -T.side * 26, z: 0, alive: false, r: 0 };   // 只拿來決定降落時面向哪邊
  spawnEnemy(dummy, randomGrunt(), at, { team, colors: team === 'blue' ? GRUNT_BLUE : GRUNT_COLORS, diff: DIFFS.normal, grunt: true });
}
function updateSkirmish(dt) {
  const K = MODE.sk;
  if (!K || MODE.result) return;
  for (const team of ['blue', 'red']) {
    const T = K[team];
    if (enemies.filter(e => e.team === team && e.alive).length < SK_MAX && (T.t -= dt) <= 0) { T.t = SK_GAP * (0.6 + Math.random() * 0.8); skDrop(team); }
  }
  // 每台挑最近的敵方雜魚（現在的目標有 3 格的優勢）
  const live = enemies.filter(e => e.alive && !e.drop);
  for (const e of live) {
    let best = null, bd = Infinity;
    for (const o of live) {
      if (o.team === e.team) continue;
      const d = Math.hypot(o.x - e.x, o.z - e.z) - (o === e.foe ? 3 : 0);
      if (d < bd) { bd = d; best = o; }
    }
    e.foe = best;
  }
}
function endWatch(result) {
  MODE.result = result;
  if (result !== 'draw') MODE.score[result]++;
  MODE.endT = 4.5;
  const text = MODE.kind === 'skirmish' ? (result === 'blue' ? '藍軍勝利' : '紅軍勝利') : MODE.kind === 'horde' ? (result === 'blue' ? '王牌勝利：雜魚全滅' : '王牌被擊墜') : result === 'blue' ? '藍方勝利' : result === 'red' ? '紅方勝利' : '同歸於盡';
  setTimeout(() => { if (MODE.name === 'watch') toast(text); }, 2000);
}
AI.onEnemyDeath = (e) => {
  if (MODE.name === 'watch' && MODE.kind === 'skirmish') {
    if (MODE.result) return;
    const T = MODE.sk[e.team];
    T.killed++;
    if (T.killed >= SK_TOTAL) endWatch(e.team === 'blue' ? 'red' : 'blue');
    return;
  }
  if (MODE.name === 'watch' && MODE.kind === 'horde') {
    const H = MODE.horde;
    if (MODE.result) return;
    if (e === H.ace) endWatch('red');
    else { H.killed++; if (H.killed >= HORDE_TOTAL) endWatch('blue'); }
    return;
  }
  if (MODE.name === 'duel' && !enemies.some(e => e.alive) && !MODE.result) { MODE.endT = 3.4; MODE.result = 'win'; }
  if (MODE.name === 'watch' && !MODE.result) {
    const alive = enemies.filter(e => e.alive);
    if (alive.length <= 1) endWatch(alive[0]?.team ?? 'draw');
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
function restart() { MODE.name === 'duel' ? startDuel(MODE.duel.preset, MODE.duel.diffKey) : MODE.name === 'watch' ? nextWatch() : startSandbox(); }
const nextWatch = () => MODE.kind === 'horde' ? startHorde() : MODE.kind === 'skirmish' ? startSkirmish() : startWatch();
function pause() {
  G.paused = true;
  showPanel('暫停', MODE.name === 'duel' ? `對戰・${DIFFS[MODE.duel.diffKey].name}` : MODE.name === 'watch' ? `觀戰${MODE.kind === 'horde' ? '（王牌 vs 雜魚）' : MODE.kind === 'skirmish' ? '（雜魚 vs 雜魚）' : ''}・第 ${MODE.round} 場` : '試玩場', [
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
$('mHorde').onclick = () => { unlockAudio(); sfx.click(); startHorde(true); };
$('mSkirmish').onclick = () => { unlockAudio(); sfx.click(); startSkirmish(true); };
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
  if (m.deployT[slot.slice(-1)] > 0 && activeSlot(m, slot.slice(-1)) === slot) return '展開中';
  if (g.def.energy) return m.energy < g.def.energy ? '<span class="bad">能量不足</span>' : g.cd > 0 ? '冷卻' : '就緒';
  if (g.def.needLock && !sensors.locks.length) return '需要鎖定';
  return g.def.mag ? `${g.ammo}/${g.def.mag}` : g.cd > 0 ? '冷卻' : '就緒';
}
let gunsKey = '';
function updateHud() {
  const p = player;
  paintDoll($('dollP'), p.alive ? p : null);
  // 每一邊：目前準備好的那把亮著（kbd 顯示左鍵 / 右鍵），另一把暗著（背部顯示切換鍵）
  const rows = SLOTS.map(s => {
    const g = p.guns[s], side = s.slice(-1), act = activeSlot(p, side) === s;
    const key = act ? (side === 'L' ? '左鍵' : '右鍵') : s.startsWith('back') ? (side === 'L' ? 'Q' : 'E') : '—';
    return `<div class="gun${act ? ' act' : ' idle'}"><kbd>${key}</kbd>${g ? `<i style="background:${DMG_TYPES[g.def.type].css}"></i>${g.def.name}` : '<span class="dim">（空）</span>'}<em>${gunState(p, s)}</em></div>`;
  }).join('');
  if (rows !== gunsKey) { gunsKey = rows; $('guns').innerHTML = rows; }
  $('energy').style.width = p.energy + '%';
  $('energy').parentElement.classList.toggle('low', p.energy < 30);
  $('surf').textContent = p.surf?.name ?? '';
  $('speed').textContent = Math.hypot(p.vx, p.vz).toFixed(1);
  const H = sensors.head;
  $('lockInfo').textContent = (!H?.lockCount ? '無法鎖定' : wantsLock(p) ? `鎖定 ${sensors.locks.length}/${H.lockCount}` : '鎖定待命（未備飛彈）') + (H?.health != null && H.lockCount ? `・感測受損 ${Math.round((1 - H.health) * 100)}%` : '');
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
      if (input.readyL && !toggleReady(player, 'L')) sfx.click();
      if (input.readyR && !toggleReady(player, 'R')) sfx.click();
      updateGuns(player, { L: input.fireL, R: input.fireR }, dt, sensors.locks, aimPoint);
    } else if (MODE.name === 'sandbox' && (respawnT -= dt) <= 0) { spawnPlayer(); toast('重新出擊'); }
    if (watching && MODE.kind === 'horde') updateHorde(dt);
    if (watching && MODE.kind === 'skirmish') updateSkirmish(dt);
    for (const e of enemies.slice()) {
      updateEnemy(e, dt, e.foe ?? player);
      if (e.alive && !e.drop) driveMech(e, dt, e.drive.mx, e.drive.mz, e.aimYaw);
    }
    keepEnemies(player);
    collideMechs();
    updateShots(dt);
    updateWrecks(dt, raw);
    updateBuildings(dt);
    if (!watching) {
      updateSensors(player, enemies, aimPoint, dt);
      if (sensors.locks.length > lastLocks) sfx.lock();
      lastLocks = sensors.locks.length;
    }
    // 對戰結束：倒下的動畫播一下再出結果；觀戰：自動下一場
    if (MODE.endT > 0 && (MODE.endT -= raw) <= 0) watching ? nextWatch() : showResult(MODE.result === 'win');
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
    // 王牌 vs 雜魚：看王牌和它現在的目標
    const pool = MODE.kind === 'horde' && MODE.horde ? [MODE.horde.ace, MODE.horde.ace.foe].filter(Boolean) : enemies;
    const live = pool.filter(e => e.alive && !e.drop), all = live.length ? live : pool;
    if (all.length) {
      fx = all.reduce((a, e) => a + e.x, 0) / all.length; fz = all.reduce((a, e) => a + e.z, 0) / all.length - 0.8;
      let sep = all.length > 1 ? Math.hypot(all[0].x - all[1].x, all[0].z - all[1].z) : 0;
      if (MODE.kind === 'skirmish') for (const e of all) sep = Math.max(sep, 2 * Math.hypot(e.x - fx, e.z - fz - 0.8) * 0.8);
      distK = Math.max(0.75, Math.min(1.6, 0.6 + sep / 22));
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
    const one = MODE.kind === 'duel', blue = MODE.kind !== 'skirmish' ? enemies.find(e => e.team === 'blue') : null, red = one ? enemies.find(e => e.team === 'red') : null;
    paintDoll($('dollB'), blue?.alive ? blue : null); paintDoll($('dollR'), red?.alive ? red : null);
    if (MODE.kind === 'skirmish' && MODE.sk) {
      for (const [side, team] of [['B', 'blue'], ['R', 'red']]) {
        const T = MODE.sk[team], onField = enemies.filter(e => e.team === team && e.alive).length;
        $('w' + side + 'Guns').innerHTML = `<span class="wt" style="--c:${team === 'blue' ? '#6aa8ff' : '#e08a50'}">剩 ${SK_TOTAL - T.killed} / ${SK_TOTAL}</span><span class="wt" style="--c:#8a96a6">場上 ${onField}</span>`;
      }
    }
    if (MODE.kind === 'horde' && MODE.horde) {
      const H = MODE.horde, onField = enemies.filter(e => e.grunt && e.alive).length;
      $('wRGuns').innerHTML = `<span class="wt" style="--c:#e08a50">擊破 ${H.killed} / ${HORDE_TOTAL}</span><span class="wt" style="--c:#8a96a6">場上 ${onField}</span>`;
    }
    $('wScore').innerHTML = `<b class="blue">${MODE.score.blue}</b> : <b class="red">${MODE.score.red}</b>`;
    $('wRound').textContent = `第 ${MODE.round} 場`;
    $('wNext').textContent = MODE.result && MODE.endT > 0 ? `${Math.ceil(MODE.endT)} 秒後下一場` : '';
  }
  renderer.render(scene, camera);
}
addEventListener('pointerdown', unlockAudio);
addEventListener('keydown', unlockAudio);
window.__dbg = { get player() { return player; }, enemies, mechs, AI, G, input, sensors, MODE, startDuel, startSandbox, startWatch, startHorde, startSkirmish, showMenu, paused: false };
showMenu();
camTarget.set(player.x, 0, player.z);
nextFrame(frame);
