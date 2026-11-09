import * as THREE from 'three';
import { sfx, unlockAudio } from './audio.js';
import { CAM_PITCH, G, addMat, angleDiff, camDist, camTarget, camera, hemi, renderer, scene, sun } from './core.js';
import { clearPressed, input, updateInput } from './input.js';
import { arenaMap, isSolid, layerCount, layerGrid, layerGroup, layerU, loadLayers, loadMap, mapId, randomOpenSpot, rayBlock, setLayer, tileC, tileR } from './arena.js';
import { THEMES, rng } from './mapgen.js';
import { TERRAINS, genStage, terrainOf } from './stagegen.js';
import { flowDist, flyDist, updateFlow } from './pathing.js';
import { addProp, clearProps, nearProp, props, removeProp, setPortal, setPropLayer, spendProp, updateProps } from './props.js';
import { RADIUS, exploredAt, fogActive, fogOff, initFogLayers, setFogLayer, setHeightFog, updateFog, visibleAt } from './fog.js';
import { hideMinimap, initMinimap, setMinimapLayer, updateMinimap } from './minimap.js';
import { renderFrame } from './post.js';
import { setHaze, updateHaze } from './haze.js';
import { closeSettings, openSettings, settingsOpen } from './settings.js';
import { perfBegin, perfEnd } from './perf.js';
import { hideMech, showCam, showMech, showScene, updateShowroom } from './showroom.js';
import { openWorkshop, updateWorkshop, workshopOpen, wsCam, wsScene } from './workshop.js';
import { ENEMY_COLORS, PLAYER_COLORS, activeSlot, collideMechs, driveMech, facing, makeMech, mechs, poseMech, muzzleOf, removeMech, syncWear, toggleReady, tryBoost, wantsLock } from './mech.js';
import { ARENA_LAYOUT, buildLayerBuildings, resetBuildings, setBuildingLayer, setLayout, updateBuildings } from './buildings.js';
import { SLOW_K, clearHusks, clearWrecks, killCam, setHuskLayer, updateWrecks } from './wreck.js';
import { clearShots, makeGuns, updateGuns, updateShots } from './weapons.js';
import { AI, DIFFS, clearEnemies, enemies, keepEnemies, parkEnemy, removeEnemy, spawnEnemy, unparkEnemy, updateEnemy } from './ai.js';
import { burst, clearRubble, makeLaser, repairFx, setLaser, setRubbleLayer, smoke, updateParticles } from './fx.js';
import { clearWarp, startWarp, updateWarp } from './warp.js';
import { CHIPS, DEVICES, hasChip, techName } from './tech.js';
import { clearDevices, deviceReady, updateDeviceCd, updateDevices, useDevice } from './devices.js';
import { updateStatus } from './status.js';
import { closeReasm, openReasm, reasmActive, renderReasm, updateReasm } from './reasm.js';
import { ARMORS, DMG_TYPES, ELITES, ENEMY_PRESETS, GRUNTS, GRUNTS_LOW, LEGS, SLOTS, SLOT_KEYS, SLOT_NAMES, SQUADS, WEAPONS, gruntOf, loadLoadout, pickSquad, randomGrunt, randomLoadout, canEnter, pickEntry, REINFORCE_ENTRIES } from './parts.js';
import { clearPickups, pickups, restorePickups, spawnPickup, stashPickups, updatePickups } from './pickups.js';
import { sensors, setSensorsVisible, updateSensors } from './sensors.js';
import { closeGarage, garage, openGarage } from './garage.js';
import { forward, s2w, turning, view, w2s } from './camview.js';

const $ = id => document.getElementById(id);

// ---------- 模式 ----------
// menu：主選單（機體站在場中間、鏡頭慢慢繞）
// duel：一對一，打倒對手或被打倒就結束
// sandbox：試玩場，敵機一開始停火（T 切換），被打爆會自動重生
// endless：無盡模式，雜魚越來越多越來越強，打爆會掉彈藥 / 修理 / 強化模組，撐越久越好（被打爆就結束）
// explore：遠征，一關一張大地圖：撿武器、開補給箱、清小隊、啟動傳送門打頭目、進下一關（見下面「遠征模式」）
// watch：觀戰，兩台電腦機體互打（現成配裝或隨機組裝），打完自動換一組重開
// watch 有三種（MODE.kind）：'duel' 一對一、'horde' 王牌 vs 雜魚、'skirmish' 雜魚 vs 雜魚
const MODE = { name: 'menu', kind: 'duel', duel: null, endT: 0, round: 0, score: { blue: 0, red: 0 }, horde: null, sk: null };
const BLUE_COLORS = { accent: 0x3a8cff, glow: 0x90c0ff };
// 試玩場從中間偏下出發；對戰 / 觀戰兩邊從競技場左右兩側出發、面對面
const PLAYER_START = { x: 0, z: 6 }, SIDE_A = { x: -26, z: 0 }, SIDE_B = { x: 26, z: 0 };

// ---------- 玩家 ----------
let loadout = loadLoadout();
let player = null, respawnT = 0;
function spawnPlayer(x = PLAYER_START.x, z = PLAYER_START.z, yaw = Math.PI, lo = loadout) {
  if (player) removeMech(player);
  player = makeMech({ team: 'player', colors: PLAYER_COLORS, loadout: lo, x, z, yaw });
  player.guns = makeGuns(lo);
  player.dmgMul = 1; player.rateMul = 1; player.lockMul = 1;
  player.onDeath = () => {
    if (MODE.name === 'duel' || MODE.name === 'endless' || MODE.name === 'explore') { MODE.endT = 3.4; MODE.result = 'lose'; }
    else { respawnT = 2.5; toast('機體損毀'); }
  };
  return player;
}
const guides = { L: makeLaser(0x7ff0ff), R: makeLaser(0x7ff0ff) };
// 演出用的覆蓋層：出現時 CSS 動畫淡入；收起來先淡出（.fadeout）再藏（now = 直接藏）
function fxShow(id) { const el = $(id); clearTimeout(el.fadeT); el.classList.remove('hidden', 'fadeout'); }
function fxHide(id, now = false) {
  const el = $(id);
  clearTimeout(el.fadeT);
  if (now || el.classList.contains('hidden')) { el.classList.add('hidden'); el.classList.remove('fadeout'); return; }
  el.classList.add('fadeout');
  el.fadeT = setTimeout(() => { el.classList.add('hidden'); el.classList.remove('fadeout'); }, 700);
}

// map：要用的地圖（不給 = 競技場）；換了才重新載入
const ARENA = arenaMap();
function resetWorld(map = null) {
  clearEnemies();
  const want = map ?? ARENA;
  if (want.layers) {
    // 多層地圖：每層的地板、岩壁、建築都蓋好（蓋建築要先切到那層），再回到第 0 層
    loadLayers(want);
    want.layers.forEach((L, k) => { setLayer(k); buildLayerBuildings(k, L.buildings, layerGroup(k), layerU(k)); });
    setLayer(0); setBuildingLayer(0);
  } else {
    if (mapId !== want.id || layerCount() !== 1) { loadMap(want); setLayout(map ? map.buildings : ARENA_LAYOUT); }
    resetBuildings();
  }
  setPropLayer(0);
  applyLight(false, want.terrain);
  scene.background.setHex(want.layers ? 0x000000 : 0x0b0d12);   // 遠征：地圖外面跟沒去過的地方一樣全黑
  hideMinimap();
  fogOff();
  for (const b of blips) b.visible = false;
  clearShots();
  G.paused = false; G.slowMo = 0; G.hitStop = 0;
  clearWrecks(); clearHusks(); setHuskLayer(0);
  clearPickups();
  clearProps();
  $('boss').classList.add('hidden'); $('prompt').classList.add('hidden'); fxHide('warning', true); fxHide('bossIntro', true);
  fxHide('warpFade');   // 傳送進下一關：白畫面在新地圖上淡掉
  clearWarp();
  clearDevices();
  clearRubble();   // 留在地上的碎片：換關 / 換模式清掉
  if (bossIntro.t > 0) { bossIntro.t = 0; document.body.classList.remove('killcam'); }
  $('endless').classList.add('hidden');
  sensors.progress.clear(); sensors.locks = [];
  MODE.endT = 0; MODE.result = null; MODE.clock = 0;
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
// ---------- 無盡模式 ----------
// 雜魚從天上一直空投，時間越久：場上上限越高（4 台起，每 12 秒 +1，最多 40）、空投越快、傷害和耐久越高
//   前期全是低階雜魚（GRUNTS_LOW），1 分半後開始混進精英雜魚（觀戰用的那批，最多一半）；每 150 秒來一台王牌機
// 掉落：雜魚 彈藥 14%、修理 8%、模組 5%（精英 18 / 12 / 22%）；王牌掉彈藥、修理各一、模組兩個
// 強化模組會疊加，被打爆就結束（記錄最久撐了多久）
const EN_MAX = 40, EN_ACE = 150;
const MODS = {
  armor: { name: '追加裝甲', desc: '全部位耐久 +10%', apply: p => { for (const k in p.parts) { const q = p.parts[k]; const add = q.max * 0.1; q.max += add; if (!q.broken) q.hp += add; } } },
  rate: { name: '射控晶片', desc: '射速 +8%', apply: p => { p.rateMul /= 1.08; } },
  dmg: { name: '高爆彈頭', desc: '傷害 +10%', apply: p => { p.dmgMul *= 1.1; } },
  lock: { name: '鎖定演算', desc: '鎖定時間 -12%', apply: p => { p.lockMul *= 0.88; } },
  speed: { name: '強化致動器', desc: '移動速度 +6%', apply: p => { p.spec.vmax *= 1.06; p.spec.acc *= 1.06; } },
  mag: { name: '擴充彈倉', desc: '彈藥上限 +25%', apply: p => { for (const s in p.guns) { const g = p.guns[s]; if (g.max === Infinity) continue; const add = Math.round(g.def.ammo * 0.25); g.max += add; g.ammo += add; } } },
  cap: { name: '高效電容', desc: '能量回復 +15%', apply: p => { p.spec.regen *= 1.15; } },
};
let EN = null;
const enLevel = () => 1 + EN.t / 60;
// 雜魚的難度：從新手開始，每分鐘傷害 +15%、耐久 +12%、打得更勤、瞄得更準
function enDiff() {
  const L = enLevel() - 1, D = DIFFS.easy;
  return { ...D, dmg: D.dmg * (1 + 0.15 * L), hp: D.hp * (1 + 0.12 * L), rest: Math.max(1.2, D.rest - 0.1 * L), err: Math.max(0.05, D.err - 0.015 * L) };
}
function startEndless() {
  resetWorld();
  MODE.name = 'endless';
  AI.sandbox = false; AI.passive = false; AI.diff = DIFFS.easy;
  spawnPlayer(0, 0, Math.PI);
  let best = 0;
  try { best = +(localStorage.getItem('brickmecha.endlessBest') ?? 0) || 0; } catch { /* 沒有就 0 */ }
  EN = { t: 0, kills: 0, spawnT: 2, aceT: EN_ACE, mods: {}, best };
  for (let i = 0; i < 3; i++) enDrop();
  showHud();
  $('endless').classList.remove('hidden');
  toast('無盡模式・撐越久越好');
}
function enDrop(ace = false) {
  const at = randomOpenSpot(player.x, player.z, ace ? 16 : 11);
  if (ace) {
    const P = randomLoadout();
    const e = spawnEnemy(player, P, at, { diff: EN.t > 400 ? DIFFS.hard : DIFFS.normal });
    e.enAce = true;
    toast(`王牌機接近！・${P.name}`);
    return;
  }
  const elite = Math.random() < Math.min(0.5, Math.max(0, (EN.t - 90) / 300));
  const e = spawnEnemy(player, randomGrunt(elite ? GRUNTS : GRUNTS_LOW), at, { colors: GRUNT_COLORS, diff: enDiff(), grunt: true });
  e.enElite = elite;
}
function updateEndless(dt) {
  if (!EN || MODE.result) return;
  EN.t += dt;
  const cap = Math.min(EN_MAX, 4 + Math.floor(EN.t / 12));
  const onField = enemies.filter(e => e.alive).length;
  if (onField < cap && (EN.spawnT -= dt) <= 0) {
    EN.spawnT = Math.max(0.35, 2.2 - EN.t / 100) * (0.6 + Math.random() * 0.8);
    enDrop(); if (cap - onField > 6) enDrop();   // 少很多的時候一次補兩台
  }
  if ((EN.aceT -= dt) <= 0) { EN.aceT = EN_ACE; enDrop(true); }
  updatePickups(dt, player, takePickup, canTake);
}
function enLoot(e) {
  const x = e.x, z = e.z;
  if (e.enAce) { for (const k of ['ammo', 'repair', 'mod', 'mod']) spawnPickup(k, x, z); return; }
  const [a, r, m] = e.enElite ? [0.18, 0.12, 0.22] : [0.14, 0.08, 0.05];
  if (Math.random() < a) spawnPickup('ammo', x, z);
  if (Math.random() < r) spawnPickup('repair', x, z);
  if (Math.random() < m) spawnPickup('mod', x, z);
}
// 撿到：彈藥每把補 30%（全滿就不撿）、修理沒壞的部位各 +25%（全滿就不撿）、模組隨機一種
// 撿得起來嗎（彈藥 / 修理全滿就不撿，也不會被吸過來）
function canTake(kind) {
  const p = player;
  if (kind === 'ammo') return Object.values(p.guns).some(g => g.max !== Infinity && g.ammo < g.max);
  if (kind === 'repair') return Object.values(p.parts).some(q => !q.broken && q.hp < q.max);
  return true;
}
function takePickup(kind, val, src) {
  const p = player;
  if (kind === 'scrap') { EN.scrap += val; return; }
  if (kind === 'tech') {
    if (!EN.inv.includes(val)) EN.inv.push(val);
    toast(`取得${CHIPS[val] ? '晶片' : '裝置'}：${techName(val)}（下次傳送重組時可以換上）`); sfx.lock();
    return;
  }
  if (kind === 'ammo') {
    let any = false;
    for (const s in p.guns) { const g = p.guns[s]; if (g.max === Infinity || g.ammo >= g.max) continue; g.ammo = Math.min(g.max, g.ammo + Math.ceil(g.max * 0.3)); any = true; }
    if (!any) return false;
    toast('彈藥補給'); sfx.reload();
  } else if (kind === 'repair') {
    let any = false;
    for (const k in p.parts) { const q = p.parts[k]; if (q.broken || q.hp >= q.max) continue; q.hp = Math.min(q.max, q.hp + q.max * 0.25); syncWear(p, k); any = true; }
    if (!any) return false;
    repairFx(p, src?.x ?? p.x, 0.6, src?.z ?? p.z, 12, 0.15, 3); sfx.lock();
  } else {
    const keys = Object.keys(MODS), k = keys[Math.floor(Math.random() * keys.length)];
    MODS[k].apply(p);
    EN.mods[k] = (EN.mods[k] ?? 0) + 1;
    toast(`強化模組：${MODS[k].name}（${MODS[k].desc}）`); sfx.lock();
  }
}
function updateExploreHud() {
  const Z = zoneAt(player.x, player.z);
  $('enTime').textContent = mmss(EN.t);
  const LN = EX.map.layers.length > 1 ? `・${EX.map.layers[EX.layer].name}` : '';
  $('enInfo').textContent = `第 ${EN.stage} 關${LN}・零件 ${EN.scrap}・小隊 ${Math.min(EX.cleared, EX.need)} / ${EX.need}・擊破 ${EN.kills}` +
    (Z ? `・${THEMES[Z.theme]}${Z.depth > 0 ? `（深度 ${Z.depth}）` : '（出發區）'}${Z.reinforce ? '・增援據點' : ''}` : '');
  const mods = Object.entries(EN.mods).map(([k, n]) => `<span class="wt" style="--c:#c080ff">${MODS[k].name}${n > 1 ? ' ×' + n : ''}</span>`).join('');
  if (EN.modsHtml !== mods) { EN.modsHtml = mods; $('enMods').innerHTML = mods; }
  const pt = promptText(EX.near);
  if (pt !== EX.prompt) { EX.prompt = pt; $('prompt').textContent = pt; $('prompt').classList.toggle('hidden', !pt); }
  if (EX.boss) $('bossHp').style.width = (100 * Math.max(0, EX.boss.parts.torso.hp) / EX.boss.parts.torso.max) + '%';
}
const mmss = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
function updateEndlessHud() {
  if (!EN) return;
  const onField = enemies.filter(e => e.alive).length;
  $('enTime').textContent = mmss(EN.t);
  $('enInfo').textContent = `威脅 ${enLevel().toFixed(1)}・擊破 ${EN.kills}・場上 ${onField}・王牌 ${Math.ceil(EN.aceT)} 秒`;
  const mods = Object.entries(EN.mods).map(([k, n]) => `<span class="wt" style="--c:#c080ff">${MODS[k].name}${n > 1 ? ' ×' + n : ''}</span>`).join('');
  if (EN.modsHtml !== mods) { EN.modsHtml = mods; $('enMods').innerHTML = mods; }
}
function showEndlessResult() {
  G.paused = true;
  sfx.click();
  const best = Math.max(EN.best, EN.t), rec = EN.t > EN.best;
  try { localStorage.setItem('brickmecha.endlessBest', String(best)); } catch { /* 存不了就算了 */ }
  const mods = Object.entries(EN.mods).map(([k, n]) => `${MODS[k].name}${n > 1 ? ' ×' + n : ''}`).join('、') || '無';
  showPanel(rec ? '新紀錄' : '機體損毀', `撐了 <b>${mmss(EN.t)}</b>（最佳 ${mmss(best)}）・擊破 <b>${EN.kills}</b> 台・威脅 ${enLevel().toFixed(1)}<br>強化：${mods}`, [
    { label: '再來一次', primary: true, run: startEndless },
    { label: '整備', run: () => { hidePanel(); openGarageFrom('result'); } },
    { label: '回主選單', run: showMenu },
  ]);
}
// ---------- 遠征模式 ----------
// 一關一張大地圖（mapgen.js）：大小不一的區域、岩壁隔開、靠隘口相連；每個區域有自己的主題和駐軍（兩種小隊輪流），有的是「增援據點」
// 機體：骨架（頭、軀幹、腳、裝甲）用整備裡的；武器從一把機槍開始，其他的要撿
// 小隊平常待命不動；玩家進到 WAKE_R 格內而且看得到、或有人被打 → 整隊醒來（增援據點：幾秒後從兩三個方向空降增援）
//   全部離玩家的路程超過 LOSE_R 格 → 跟丟、回到待命；看不到玩家時照流場繞路追（pathing.js）
// 效能：離玩家 SPAWN_R 格內才生出來，待命中離開 DESPAWN_R 格就先收起來（記住剩多少血、死了哪幾台）
// 零件：打爆敵機一定掉（精英多、越深越多），拿來開補給箱（強化模組）和武器箱；每張圖的箱子有限 → 強化的數量也有限
// 清掉 need 隊 → 傳送門可以啟動（標在小地圖上）→ 啟動後頭目從天而降、每隔一陣子來一波增援 → 打倒頭目 → 傳送到下一關（整台修好、彈藥補滿）
// 越後面的關卡 / 越深的區域：敵人傷害和耐久越高；箱子也越貴
const SPAWN_R = 58, DESPAWN_R = 72, WAKE_R = 24, LOSE_R = 85;
const START_WEAPONS = { armL: null, armR: 'mg', backL: 'missile', backR: null };   // 右手機槍、左背飛彈
const COST = { cache: 25, weapon: 35, supply: 15 };
let EX = null;
const costOf = base => Math.round(base * (1 + 0.35 * (EN.stage - 1)));
function exDiff(depth) {
  const D = DIFFS.easy, L = depth * 0.6 + (EN.stage - 1) * 1.2;
  return { ...D, dmg: D.dmg * (1 + 0.2 * L), hp: D.hp * (1 + 0.15 * L), rest: Math.max(1.2, D.rest - 0.12 * L), err: Math.max(0.05, D.err - 0.02 * L) };
}
const PLAYER_WEAPONS = Object.keys(WEAPONS).filter(k => !WEAPONS[k].low);
// stage > 1：直接從那關開始（測試 / 選關用）：空的掛點補隨機武器（最多 2 把）、每跳過一關 2 個隨機強化模組和 30 零件
function startRun(seed, stage = 1) {
  EN = { t: 0, kills: 0, mods: {}, scrap: (stage - 1) * 30, stage, explore: true, loadout: { ...structuredClone(loadout), ...START_WEAPONS }, inv: [] };   // inv：撿到的晶片 / 裝置（關卡之間重組時可以換上）
  if (stage > 1) {
    const keys = Object.keys(MODS);
    for (let i = 0; i < (stage - 1) * 2; i++) { const k = keys[Math.floor(Math.random() * keys.length)]; EN.mods[k] = (EN.mods[k] ?? 0) + 1; }
    let n = Math.min(2, stage - 1);
    for (const s of SLOTS) {
      if (n <= 0 || EN.loadout[s]) continue;
      const pool = PLAYER_WEAPONS.filter(id => s.startsWith(WEAPONS[id].mount));
      EN.loadout[s] = pool[Math.floor(Math.random() * pool.length)]; n--;
    }
  }
  startStage(seed);
}
function spawnRunPlayer(x, z, yaw) {
  spawnPlayer(x, z, yaw, EN.loadout);
  for (const [k, n] of Object.entries(EN.mods)) for (let i = 0; i < n; i++) MODS[k].apply(player);
}
function startStage(seed) {
  const map = genStage(seed, EN.stage, window.__dbg?.terrain);
  // 每個區域：兩種駐軍輪流排、三成五是增援據點（出發區、第一圈除外）；用地圖的種子決定 → 同一張圖一樣
  const R = rng(map.seed * 7 + 13);
  const zones = map.zones.map((Z, k) => ({ ...Z, squads: [pickSquad(Z.squadTheme ?? Z.theme, Z.depth, R, map.terrain), pickSquad(Z.squadTheme ?? Z.theme, Z.depth, R, map.terrain)], reinforce: k !== map.startZ && Z.depth >= 2 && R() < 0.35, n: 0 }));
  const squads = map.sites.map(S => {
    const Z = zones[S.zone], key = Z.squads[Z.n++ % 2], D = SQUADS[key];
    const units = D.units.slice(0, 3);   // 每隊最多 3 台（深處也不加人）
    return { ...S, layer: S.layer ?? 0, key, name: D.name, units: units.map(k => ({ key: k, hp: null, dead: false })), members: [], awake: false, found: false, cleared: false, hold: D.hold ?? 0, patrol: !!D.patrol, wp: 0, legT: 0,
      entry: !D.hold && !D.patrol && R() < DROP_CHANCE && units.every(k => canEnter(k, 'drop')) ? 'drop' : 'spread' };   // 登場方式：散開站著 / 玩家靠近才整隊空投
  });
  for (const S of squads) if (S.hold) fortify(map.layers[S.layer], map.W, map.H, S, R);
  resetWorld(map);
  MODE.name = 'explore';
  AI.sandbox = false; AI.passive = false; AI.diff = DIFFS.easy;
  spawnRunPlayer(map.spawn.x, map.spawn.z, Math.PI / 2);
  map.layers.forEach((L, k) => { setLayer(k); for (const S of squads) if (S.patrol && S.layer === k) S.route = patrolRoute(S); });   // 巡邏路線照那層的地形算
  EX = { map, zones, squads, waves: [], pending: [], chasers: [], stash: [], layer: map.spawn.layer ?? 0, hop: null, cleared: 0, need: Math.min(squads.length, 5 + EN.stage), boss: null, waveT: 0, portalKnown: false, prompt: '' };
  EX.portal = addProp('portal', map.portal.x, map.portal.z, { layer: map.portal.layer ?? 0 });
  for (const c of map.caches) {
    const layer = c.layer ?? 0;
    if (c.kind === 'mod') addProp('cache', c.x, c.z, { cost: costOf(COST.cache), layer });
    else if (c.kind === 'station') addProp('station', c.x, c.z, { cost: costOf(COST.cache), layer });
    else if (c.kind === 'supply') addProp('supply', c.x, c.z, { cost: costOf(COST.supply), layer });
    else addProp('weapon', c.x, c.z, { cost: costOf(COST.weapon), weapon: PLAYER_WEAPONS[Math.floor(R() * PLAYER_WEAPONS.length)], layer });
  }
  // 連接點：能從這頭走的那頭才放（彈射台的落點、跳下點的下面不放）
  for (const L of map.links ?? []) {
    const two = L.kind === 'lift' || L.kind === 'stairs';
    for (const end of two ? ['a', 'b'] : ['a']) {
      const here = L[end], there = L[end === 'a' ? 'b' : 'a'], up = there.layer > here.layer;
      const style = L.kind === 'stairs' ? (up ? 'shaft' : 'hole') : L.kind === 'drop' ? 'edge' : 'pad';
      addProp('link', here.x, here.z, { layer: here.layer, link: L, end, up, style });
    }
  }
  // 迷霧：每層一份；1 層樓的建築不擋視線
  initFogLayers(map.layers.map((L, k) => {
    const low = new Set();
    for (const [c, r, w, h, f] of L.buildings) if (f === 1) for (let y = r; y < r + h; y++) for (let x = c; x < c + w; x++) low.add(y * map.W + x);
    return { low, edge: L.edge, deep: L.deep, sight: L.sight ?? RADIUS, g: layerGrid(k), U: layerU(k) };
  }));
  initMinimap(map.layers.map((L, k) => ({ grid: layerGrid(k), buildings: L.buildings, under: L.under })));
  enterLayer(map.spawn.layer ?? 0);
  showHud();
  $('endless').classList.remove('hidden');
  toast(`第 ${EN.stage} 關・${TERRAINS[map.terrain]}・清除 ${EX.need} 支小隊後就能啟動傳送門`);
}
// 守備據點的工事：據點周圍半徑 5 格一圈 6 段矮掩體（1 層樓的建築，打得壞），中間留缺口
function fortify(L, W, H, S, R) {
  const used = new Set();
  for (const [c, r, w, h] of L.buildings) for (let y = r - 1; y <= r + h; y++) for (let x = c - 1; x <= c + w; x++) used.add(y * W + x);
  const free = (c, r) => c > 1 && r > 1 && c < W - 2 && r < H - 2 && L.grid[r][c] !== '#' && L.grid[r][c] !== 'v' && !used.has(r * W + c);
  const a0 = R() * Math.PI * 2;
  for (let i = 0; i < 6; i++) {
    const a = a0 + i * Math.PI / 3 + (R() - 0.5) * 0.3, ns = Math.abs(Math.sin(a)) > 0.7, w = ns ? 2 : 1, h = ns ? 1 : 2;
    const c0 = Math.round(S.c + Math.cos(a) * 5 - w / 2), r0 = Math.round(S.r + Math.sin(a) * 5 - h / 2);
    let ok = true;
    for (let y = r0; y < r0 + h; y++) for (let x = c0; x < c0 + w; x++) if (!free(x, y)) ok = false;
    if (!ok) continue;
    L.buildings.push([c0, r0, w, h, 1, Math.floor(R() * 3)]);
    for (let y = r0; y < r0 + h; y++) for (let x = c0; x < c0 + w; x++) used.add(y * W + x);
  }
}
// 巡邏路線：據點 → 兩個 10～18 格外、從據點看得到的空地，來回走
function patrolRoute(S) {
  const pts = [{ x: S.x, z: S.z }];
  for (let t = 0; t < 60 && pts.length < 3; t++) {
    const a = Math.random() * Math.PI * 2, d = 10 + Math.random() * 8, x = S.x + Math.cos(a) * d, z = S.z + Math.sin(a) * d;
    if (openAround(x, z) && rayBlock(S.x, S.z, Math.cos(a), Math.sin(a), d) >= d) pts.push({ x, z });
  }
  return pts;
}
// ---------- 小隊登場 ----------
// spread：散開站在據點周圍（一般 3～7 格、守備據點 2～4 格），不會擠成一團
// drop：一開始不在場上；玩家走到據點 DROP_R 格內時，先在據點周圍 4～9 格挑好每台的空降點（包圍點，看不到）；
//   玩家再走到任一個空降點 DROP_TRIG 格內（或據點 DROP_TRIG 格內）才開始空投：一台一台降，每台間隔 DROP_GAP 秒（紅圈不會同時出現），落地就醒著
const DROP_CHANCE = 0.4, DROP_R = 18, DROP_TRIG = 7, DROP_GAP = [1.15, 1.5];   // 間隔比降落動畫（ai.js DROP_TIME 1.1 秒）長 → 一次只有一個紅圈
function spreadSpot(cx, cz, r0, r1, taken) {
  for (let t = 0; t < 40; t++) {
    const a = Math.random() * Math.PI * 2, r = r0 + Math.random() * (r1 - r0), x = cx + Math.cos(a) * r, z = cz + Math.sin(a) * r;
    if (openAround(x, z) && !taken.some(p => Math.hypot(p.x - x, p.z - z) < 2.5)) return { x, z };
  }
  return null;
}
function spawnSquad(S) {
  S.members = [];
  const taken = [];
  S.units.forEach((u, i) => {
    if (u.dead || u.away) return;   // away：追到別層去了
    const a = i / S.units.length * Math.PI * 2;
    let at = S.hold ? spreadSpot(S.x, S.z, 2, 4, taken) : spreadSpot(S.x, S.z, 3, 7, taken);
    at ??= { x: S.x + Math.sin(a) * 1.8, z: S.z + Math.cos(a) * 1.8 };
    taken.push(at);
    spawnUnit(S, u, i, at, false);
  });
}
function spawnUnit(S, u, i, at, drop) {
  const a = i / S.units.length * Math.PI * 2;
  const P = gruntOf(u.key), look = drop ? player : { x: at.x + Math.sin(a), z: at.z + Math.cos(a) };
  const e = spawnEnemy(look, P, at, { colors: GRUNT_COLORS, diff: exDiff(S.depth), grunt: true, noDrop: !drop });
  e.dormant = !S.awake; e.squad = S; e.unit = u; e.enElite = u.key.endsWith('*'); e.lvl = S.depth; e.fixed = !!P.fixed;
  e.chase = chaseOf(e);
  if (S.hold) e.hold = { x: S.x, z: S.z, r: S.hold };
  e.slot = i;
  if (u.hp != null) { e.parts.torso.hp = Math.min(u.hp, e.parts.torso.max); syncWear(e, 'torso', 0, 0, true); }
  e.seenHp = e.parts.torso.hp;
  S.members.push(e);
  return e;
}
// 空投小隊的包圍點：據點周圍 4～9 格、走得到的空地，每台一個
function dropPoints(S) {
  const pts = [];
  S.units.forEach((u, i) => {
    if (u.dead || u.away) return;
    let at = null;
    for (let t = 0; t < 40 && !at; t++) {
      const b = Math.random() * Math.PI * 2, r = 4 + Math.random() * 5, x = S.x + Math.cos(b) * r, z = S.z + Math.sin(b) * r;
      if (openAround(x, z) && !pts.some(p => Math.hypot(p.x - x, p.z - z) < 3)) at = { x, z };
    }
    at ??= spreadSpot(S.x, S.z, 2, 6, pts) ?? { x: S.x + Math.sin(i * 2.1) * 1.8, z: S.z + Math.cos(i * 2.1) * 1.8 };
    pts.push({ x: at.x, z: at.z, u, i });
  });
  return pts;
}
function despawnSquad(S) {
  for (const e of S.members) if (e.alive) { e.unit.hp = e.parts.torso.hp; removeEnemy(e); }
  S.members = [];
}
// ---------- 增援 ----------
// groups 批、每批 n 台，從玩家周圍平均分開的方向空降（離玩家 22～32 格、走得到的空地）；一落地就醒著、照流場包圍過來
const DIR_NAMES = ['東', '東南', '南', '西南', '西', '西北', '北', '東北'];
const dirName = a => DIR_NAMES[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
function openAround(x, z) {
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (isSolid(x + dx * 1.2, z + dz * 1.2)) return false;
  return true;
}
function callReinforcements(groups, n, depth, pool) {
  const base = Math.random() * Math.PI * 2, names = [];
  for (let g = 0; g < groups; g++) {
    let spot = null, ang = 0;
    for (let t = 0; t < 60 && !spot; t++) {
      // 先在這一批的方向附近找，找不到（那邊是岩壁 / 地圖邊緣）再隨便找個方向
      ang = t < 30 ? base + g * Math.PI * 2 / groups + (Math.random() - 0.5) * 0.9 : Math.random() * Math.PI * 2;
      const rad = 22 + Math.random() * 10, x = player.x + Math.cos(ang) * rad, z = player.z + Math.sin(ang) * rad;
      if (openAround(x, z) && flowDist(x, z) < rad * 2) spot = { x, z };
    }
    if (!spot) continue;
    const W = { wave: true, members: [], awake: true, x: spot.x, z: spot.z, depth, layer: EX.layer };
    for (let i = 0; i < n; i++) {
      const key = pool[Math.floor(Math.random() * pool.length)], a = i / n * Math.PI * 2;
      const e = spawnEnemy(player, gruntOf(key), { x: spot.x + Math.sin(a) * 1.6, z: spot.z + Math.cos(a) * 1.6 }, { colors: GRUNT_COLORS, diff: exDiff(depth), grunt: true });
      e.squad = W; e.unit = { key, dead: false }; e.enElite = key.endsWith('*'); e.lvl = depth; e.chase = chaseOf(e);
      W.members.push(e);
    }
    EX.waves.push(W);
    names.push(dirName(ang));
  }
}
const zoneAt = (x, z) => EX.zones[EX.map.layers[EX.layer].zoneOf[tileR(z) * EX.map.W + tileC(x)]];
function updateExplore(dt) {
  if (!EX || MODE.result) return;
  EN.t += dt;
  for (const S of EX.squads) {
    if (S.cleared || S.layer !== EX.layer) continue;   // 別層的小隊不動（換層時已經收起來）
    const d = Math.hypot(S.x - player.x, S.z - player.z);
    if (S.members.some(e => e.alive && e.fogVis)) S.found = true;   // 親眼看到才算發現
    // 空投進行中：時間到就降下一台
    if (S.dropQ?.length) {
      S.dropT = (S.dropT ?? 0) + dt;
      while (S.dropQ.length && S.dropQ[0].t <= S.dropT) {
        const q = S.dropQ.shift();
        if (!q.u.dead && !q.u.away) spawnUnit(S, q.u, q.i, q, true).dormant = false;
      }
      if (S.dropQ.length) continue;
    }
    if (!S.members.length) {
      if (S.entry === 'drop' && !S.dropped) {
        // 空投小隊：玩家走近據點時先挑好包圍點；再走到任一包圍點附近才開始一台一台空降
        //   （之後被甩掉收起來，再出現就照一般方式散開站著）
        if (d < DROP_R && player.alive) {
          S.dropPts ??= dropPoints(S);
          if (d < DROP_TRIG || S.dropPts.some(p => Math.hypot(p.x - player.x, p.z - player.z) < DROP_TRIG)) {
            S.dropped = S.awake = S.found = true;
            let t = 0;
            S.dropQ = S.dropPts.map(p => { const q = { ...p, t }; t += DROP_GAP[0] + Math.random() * (DROP_GAP[1] - DROP_GAP[0]); return q; });
          }
        }
        continue;
      }
      if (d < SPAWN_R) spawnSquad(S);
      continue;
    }
    if (!S.awake && d > DESPAWN_R) { despawnSquad(S); continue; }
    const live = S.members.filter(e => e.alive);
    // 巡邏：待命中沿著路線走；大家都到了（或走了 25 秒還沒到）就換下一個點
    if (S.route && !S.awake && live.length) {
      const T = S.route[S.wp % S.route.length];
      let all = true;
      for (const e of live) {
        const a = e.slot / S.units.length * Math.PI * 2, tx = T.x + Math.sin(a) * 1.6, tz = T.z + Math.cos(a) * 1.6;
        e.patrol = { x: tx, z: tz };
        if (Math.hypot(tx - e.x, tz - e.z) > 2.2) all = false;
      }
      if (all || (S.legT += dt) > 25) { S.wp++; S.legT = 0; }
    }
    if (!player.alive) continue;
    if (!S.awake) {
      // 醒來：剛被打（跟上次看的時候比少了血；不然被打過又跟丟的小隊會一直醒來又跟丟）、或玩家在 WAKE_R 格內而且看得到
      let hit = false;
      for (const e of live) { if (e.parts.torso.hp < (e.seenHp ?? e.parts.torso.max) - 0.01) hit = true; e.seenHp = e.parts.torso.hp; }
      const trig = hit || live.some(e => {
        const dx = player.x - e.x, dz = player.z - e.z, dd = Math.hypot(dx, dz);
        return dd < WAKE_R && rayBlock(e.x, e.z, dx / dd, dz / dd, dd) >= dd - player.r;
      });
      if (trig) {
        S.awake = S.found = true; for (const e of live) e.dormant = false;
        const Z = EX.zones[S.zone], call = Z.reinforce && !S.called && EN.t - (Z.lastCall ?? -99) > 45 && (EX.portal.state === 'idle' || EX.portal.state === 'ready');   // 傳送門啟動後不再叫增援
        // 增援據點：小隊第一次被驚動，5 秒後從兩三個方向來增援（用這個區域的駐軍兵種）；同一個區域 45 秒內只叫一次
        if (call) { S.called = true; Z.lastCall = EN.t; EX.pending.push({ t: 5, groups: 1 + (S.depth >= 3 ? 1 : 0), n: 2, depth: S.depth, pool: Z.squads.flatMap(k => SQUADS[k].units).filter(k => pickEntry(k, REINFORCE_ENTRIES)) }); }
      }
    } else if (live.length && live.every(e => (e.fly ? flyDist(e.x, e.z) : flowDist(e.x, e.z)) > LOSE_R)) {   // 用實際要走的路程算（繞岩壁追過來的不算跟丟）
      S.awake = false; for (const e of live) { e.dormant = true; e.seenHp = e.parts.torso.hp; }
    }
  }
  updateChasers(dt);
  for (let i = EX.pending.length - 1; i >= 0; i--) { const P = EX.pending[i]; if ((P.t -= dt) <= 0) { EX.pending.splice(i, 1); if (player.alive) callReinforcements(P.groups, P.n, P.depth, P.pool); } }
  // 增援部隊：全滅就收掉；全部離玩家很遠（被甩掉）也收掉
  for (let i = EX.waves.length - 1; i >= 0; i--) {
    const W = EX.waves[i], live = W.members.filter(e => e.alive);
    if (!live.length) { EX.waves.splice(i, 1); continue; }
    if (live.every(e => Math.hypot(e.x - player.x, e.z - player.z) > DESPAWN_R)) { for (const e of live) removeEnemy(e); EX.waves.splice(i, 1); }
  }
  // 傳送門
  const P = EX.portal;
  if (P.layer === EX.layer && visibleAt(P.x, P.z)) EX.portalKnown = true;
  if (P.state === 'idle' && EX.cleared >= EX.need) { setPortal(P, 'ready'); EX.portalKnown = true; toast('傳送門可以啟動了（已標在小地圖上）'); sfx.lock(); }
  updateBossIntro(dt);
  // 互動
  const near = player.alive ? nearProp(player.x, player.z, EX.layer) : null;
  EX.near = near;
  if (near && input.interactPressed) interact(near);
  updateProps(dt);
  for (const q of props) q.g.visible = q.layer === EX.layer && exploredAt(q.x, q.z);   // 箱子、傳送門：這層、看過的地方才畫
  updatePickups(dt, player, takePickup, canTake);
}
// ---------- 互動：箱子、武器、傳送門 ----------
const weaponLine = id => { const W = WEAPONS[id]; const tg = `<span class="wt" style="--c:${DMG_TYPES[W.type].css}">${DMG_TYPES[W.type].name}</span>`;
  if (W.desc) return `${tg} 手臂・${W.name}：${W.desc}・${W.info}・重量 ${W.weight}`;
  if (W.kind === 'flame') return `${tg} 手臂・火焰噴射：${W.range} 格內扇形、穿透、疊燃燒・燃料 ${W.ammo}・重量 ${W.weight}`;
  if (W.kind === 'napalm') return `${tg} 背部・燒夷彈：拋到游標、留下 ${W.zoneT} 秒火海・彈藥 ${W.ammo}・重量 ${W.weight}`;
  if (W.kind === 'shield') return `<span class="wt" style="--c:${DMG_TYPES[W.type].css}">盾牌</span> 手臂・耐久 ${W.guard}・純被動：盾那一側前方的攻擊先打在盾上（爆風擋一半）・上半身轉速 ×${W.turnMul}・重量 ${W.weight}`; return `<span class="wt" style="--c:${DMG_TYPES[W.type].css}">${DMG_TYPES[W.type].name}</span> ${W.mount === 'arm' ? '手臂' : '背部'}・傷害 ${W.dmg}${W.pellets ? ' ×' + W.pellets : ''}${W.salvo > 1 ? ' ×' + W.salvo : ''}${W.splash ? '・爆風' : ''}・${W.ammo ? '彈藥 ' + W.ammo : '吃能量'}・重量 ${W.weight}`; };
function promptText(p) {
  if (!p || EX.warpT != null) return '';
  if (p.kind === 'cache') return `F・打開補給箱（${p.cost} 零件）${EN.scrap < p.cost ? '・零件不足' : ''}`;
  if (p.kind === 'weapon') return `F・打開武器箱：${WEAPONS[p.weapon].name}（${p.cost} 零件）${EN.scrap < p.cost ? '・零件不足' : ''}`;
  if (p.kind === 'gun') return `F・拿起 ${WEAPONS[p.weapon].name}`;
  if (p.kind === 'station') return !damaged() ? '修復站・機體沒有損傷' : `F・全機修復（${p.cost} 零件）${EN.scrap < p.cost ? '・零件不足' : ''}`;
  if (p.kind === 'supply') return !lowAmmo() ? '彈藥補給站・彈藥是滿的' : `F・彈藥全部補滿（${p.cost} 零件）${EN.scrap < p.cost ? '・零件不足' : ''}`;
  if (p.kind === 'link') {
    const to = p.link[p.end === 'a' ? 'b' : 'a'], name = EX.map.layers[to.layer].name;
    return p.style === 'hole' ? `F・下到${name}` : p.style === 'shaft' ? `F・回到${name}` : p.style === 'edge' ? `F・跳下去（${name}）` : p.up ? `F・${p.link.kind === 'pad' ? '彈射' : '升'}到${name}` : `F・降到${name}`;
  }
  if (p.kind === 'portal') return p.state === 'idle' ? `傳送門・還要清除 ${EX.need - EX.cleared} 支小隊` : p.state === 'ready' ? 'F・啟動傳送門（頭目會出現）' : p.state === 'boss' ? '先打倒頭目' : `F・傳送到第 ${EN.stage + 1} 關`;
  return '';
}
function interact(p) {
  if (p.kind === 'cache' || p.kind === 'weapon') {
    if (EN.scrap < p.cost) { toast(`零件不足（需要 ${p.cost}，現在 ${EN.scrap}）`); sfx.click(); return; }
    EN.scrap -= p.cost; spendProp(p); sfx.reload();
    if (p.kind === 'cache') { const t = Math.random() < 0.3 ? randomTech() : null; t ? spawnPickup('tech', p.x, p.z, t) : spawnPickup('mod', p.x, p.z); }   // 三成機率開出晶片 / 裝置
    else offerGun(addProp('gun', p.x, p.z + 1.2, { weapon: p.weapon }));
  } else if (p.kind === 'supply') {
    if (!lowAmmo()) { toast('彈藥是滿的'); sfx.click(); return; }
    if (EN.scrap < p.cost) { toast(`零件不足（需要 ${p.cost}，現在 ${EN.scrap}）`); sfx.click(); return; }
    EN.scrap -= p.cost; spendProp(p);
    for (const g of Object.values(player.guns)) if (g.max !== Infinity) g.ammo = g.max;
    if (player.device && DEVICES[player.device.id].charges) player.device.charges = DEVICES[player.device.id].charges;
    toast('彈藥補滿'); sfx.reloadDone();
  } else if (p.kind === 'station') {
    if (!damaged()) { toast('機體沒有損傷'); sfx.click(); return; }
    if (EN.scrap < p.cost) { toast(`零件不足（需要 ${p.cost}，現在 ${EN.scrap}）`); sfx.click(); return; }
    EN.scrap -= p.cost; spendProp(p);
    rebuild(EN.loadout, null, true);
    repairFx(player, p.x, 0.9, p.z, 34, 0.5, 6); sfx.lock();
  } else if (p.kind === 'gun') offerGun(p);
  else if (p.kind === 'link') useLink(p);
  else if (p.kind === 'portal') {
    if (p.state === 'ready') startBoss(p);
    else if (p.state === 'open') warpOut();
    else { toast(promptText(p)); sfx.click(); }
  }
}
// 武器：有空的同類掛點就直接裝；不然問要換掉哪一邊（1 / 2 選、或點按鈕），換下來的丟在地上
function offerGun(p) {
  const W = WEAPONS[p.weapon], slots = SLOTS.filter(s => s.startsWith(W.mount));
  const empty = slots.find(s => !EN.loadout[s]);
  if (empty) { equip(p, empty); return; }
  G.paused = true;
  showPanel(`拿起 ${W.name}`, weaponLine(p.weapon), [
    ...slots.map((s, i) => ({ label: `${i + 1}・換掉${SLOT_NAMES[s]}的${WEAPONS[EN.loadout[s]].name}`, primary: i === 0, run: () => { hidePanel(); G.paused = false; equip(p, s); } })),
    { label: '3・先不要', run: () => { hidePanel(); G.paused = false; } },
  ]);
}
function equip(p, slot) {
  removeProp(p);
  const prev = refit(slot, p.weapon);
  if (prev) { const a = player.torsoYaw + Math.PI; addProp('gun', player.x + Math.sin(a) * 1.6, player.z + Math.cos(a) * 1.6, { weapon: prev }); }
  toast(`${SLOT_NAMES[slot]}：${WEAPONS[p.weapon].name}`); sfx.reload();
}
// 換武器 = 照新的配裝重組一台，再把原本的狀態搬過去（各部位耐久比例、壞掉的部位、其他武器的彈藥比例、速度、能量）
const lowAmmo = () => Object.values(player.guns).some(g => g.max !== Infinity && g.ammo < g.max) || (player.device && DEVICES[player.device.id].charges && player.device.charges < DEVICES[player.device.id].charges);
const damaged = () => Object.values(player.parts).some(q => q.broken || q.hp < q.max - 0.5);
function refit(slot, id) {
  const prev = EN.loadout[slot];
  rebuild({ ...EN.loadout, [slot]: id }, slot, false);
  return prev;
}
// 照 lo 重組玩家機體；fresh = 換上的那個掛點（彈藥全滿）；repair = 全部修好（修復站），不然搬原本的耐久
function rebuild(lo, fresh, repair) {
  const old = player, keep = {}, ammo = {};
  for (const k in old.parts) keep[k] = { r: old.parts[k].hp / old.parts[k].max, broken: old.parts[k].broken };
  for (const s in old.guns) { const g = old.guns[s]; ammo[s] = g.max === Infinity ? 1 : g.ammo / g.max; }
  EN.loadout = lo;
  const st = { vx: old.vx, vz: old.vz, energy: old.energy, legYaw: old.legYaw, ...(old.device?.id === lo.device ? { device: old.device } : {}) };
  spawnRunPlayer(old.x, old.z, old.torsoYaw);
  Object.assign(player, st);
  for (const k in player.parts) {
    const q = player.parts[k], o = keep[k];
    if (!o || repair) continue;
    if (o.broken && k !== 'torso') { q.hp = 0; q.broken = true; if (k === 'legs') q.mat.color.setHex(0x5a5048); else q.g.visible = false; }
    else { q.hp = Math.max(1, q.max * o.r); syncWear(player, k, 0, 0, true); }
  }
  for (const s in player.guns) { const g = player.guns[s]; if (s !== fresh && ammo[s] != null && g.max !== Infinity) g.ammo = Math.round(g.max * ammo[s]); }
}
// ---------- 頭目 ----------
// 完整的機體（隨機組裝），耐久好幾倍；在傳送門附近空降。打倒 → 傳送門打開、掉一個強化模組和一把武器
// 登場演出：全畫面警告（上下兩條跑馬燈、中間大字、紅色閃爍、警報聲）WARN_T 秒 → 頭目從天而降 → 著陸瞬間定格特寫 INTRO_T 秒（時間停住、鏡頭拉近、黑邊、名牌）
const WARN_T = 3.2, INTRO_T = 1.8;
const bossIntro = { t: 0, x: 0, z: 0 };
function startBoss(p) {
  setPortal(p, 'boss');
  EX.pending = [];   // 頭目是完整機體、不比玩家差：啟動後所有增援都關掉（已經在場上的留著，不再新增）
  EX.warnT = WARN_T; EX.beepT = 0;
  fxShow('warning');
}
function spawnBoss(p) {
  fxHide('warning');
  let at = null;
  // 落點：傳送門周圍 8～14 格的空地，而且走得到玩家（路程不超過直線的 2.5 倍）→ 不會掉進被建築圍住的角落出不來
  for (let t = 0; t < 120 && !at; t++) {
    const a = Math.random() * Math.PI * 2, r = 8 + Math.random() * 6, x = p.x + Math.cos(a) * r, z = p.z + Math.sin(a) * r;
    if (openAround(x, z) && flowDist(x, z) < Math.hypot(x - player.x, z - player.z) * 2.5 + 6) at = { x, z };
  }
  if (!at && openAround(player.x + 6, player.z)) at = { x: player.x + 6, z: player.z };
  const P = randomLoadout(), D = EN.stage >= 3 ? DIFFS.hard : DIFFS.normal;
  const e = spawnEnemy(player, P, at ?? { x: p.x, z: p.z + 6 }, { diff: { ...D, hp: D.hp * (2.2 + 0.4 * EN.stage), dmg: D.dmg * (0.75 + 0.15 * EN.stage) } });
  e.boss = true;
  EX.boss = e; EX.bossLanding = true;
  $('bossName').textContent = `頭目・${P.name}`;
  $('biName').textContent = P.name;
  $('biGuns').innerHTML = SLOTS.map(s => P[s]).filter(Boolean).map(id => `<span class="wt" style="--c:${DMG_TYPES[WEAPONS[id].type].css}">${WEAPONS[id].name}</span>`).join('') + `<span class="wt" style="--c:#8a96a6">${LEGS[P.legs].name}</span>`;
}
// 每幀：警告倒數、警報聲；頭目一著陸就定格
function updateBossIntro(dt) {
  if (EX.warnT > 0) {
    if ((EX.beepT -= dt) <= 0) { EX.beepT = 0.8; sfx.alarm(); }
    if ((EX.warnT -= dt) <= 0) spawnBoss(EX.portal);
  }
  const b = EX.boss;
  if (EX.bossLanding && b && !b.drop) {
    EX.bossLanding = false;
    bossIntro.t = INTRO_T; bossIntro.x = b.x; bossIntro.z = b.z;
    document.body.classList.add('killcam');
    fxShow('bossIntro');
    $('boss').classList.remove('hidden');
    sfx.land(); G.trauma = Math.min(1, G.trauma + 0.6);
  }
}
// ---------- 傳送到下一關 ----------
// 機體從頭頂往下分解成小方塊往上飛走（warp.js），這段時間世界停住；最後畫面白掉 → 換新地圖 → 白畫面淡掉
const WARP_FADE = 1.3, WARP_T = 1.65;
function warpOut() {
  EX.warpT = 0;
  startWarp(player.model.root);
  sfx.warp();
}
function updateWarpOut(raw) {
  if (EX.warpT < WARP_FADE && EX.warpT + raw >= WARP_FADE) fxShow('warpFade');
  if ((EX.warpT += raw) >= WARP_T) { EX.warpT = null; enterReasm(); }
}
// 傳送途中：重組畫面（reasm.js）。白畫面淡掉露出傳送隧道；按出發 → 換上選的晶片 / 裝置 → 白掉 → 下一關
function enterReasm() {
  $('hud').classList.add('hidden'); $('minimap').classList.add('hidden'); $('prompt').classList.add('hidden'); $('boss').classList.add('hidden');
  openReasm(EN.loadout, EN.inv, EN.stage + 1, sel => {
    EN.loadout = { ...EN.loadout, chips: sel.chips, device: sel.device };
    fxShow('warpFade');
    setTimeout(() => { closeReasm(); EN.stage++; startStage(); }, 380);
  });
  fxHide('warpFade');
}
// ---------- 換層（多層地圖） ----------
// 用連接點：機體跳起來（往上）或沉下去（往下）→ 換到目的地那層、落地；這段時間世界停住
// 換層時：會追的敵機（頭目、精英、深處的敵人，每台追的次數有限：chase）照離連接點的路程晚幾秒從那頭空降過來；
//   其他的收起來（小隊回到待命、記住血量；增援部隊直接散掉）；地上的掉落物收起來，回到那層再擺回去
const HOP_T = 0.6, HOP_SWAP = 0.28;
const chaseOf = e => e.boss ? 99 : e.fixed || e.hold ? 0 : e.enElite || (e.lvl ?? 0) >= 3 ? 1 : 0;
// 燈光 + 空氣（地面的風沙 src/haze.js、坑和下層的高度霧 src/fog.js）：地下暗、霧濃、灰塵少；地表照地形換風沙的顏色
const HAZE = { ruins: [0xc2a87e, 0.17], hive: [0x9c9a82, 0.13] };
function applyLight(dark, terrain = null) {
  hemi.intensity = dark ? 0.55 : 1.3; sun.intensity = dark ? 0.75 : 2.4;
  const [hc, ha] = dark ? [0x6c6a60, 0.09] : HAZE[terrain] ?? [0xa8a69c, 0.08];
  setHaze(hc, ha);
  setHeightFog(dark ? 0x0b0d11 : 0x2a2f37, dark ? 0.2 : 0.12);
}
function useLink(p) {
  const to = p.link[p.end === 'a' ? 'b' : 'a'];
  EX.hop = { t: 0, to, up: to.layer > EX.layer, swapped: false, y: 0, dark: p.style === 'hole' || p.style === 'shaft' };
  if (EX.hop.dark) fxShow('hopFade');
  sfx.boost();
}
function updateHop(raw) {
  const h = EX.hop;
  h.t += raw;
  if (!h.swapped) {
    const k = Math.min(1, h.t / HOP_SWAP);
    h.y = h.up ? k * k * 5 : -k * k * 3;
    if (h.t >= HOP_SWAP) { h.swapped = true; switchLayer(h.to); if (h.dark) fxHide('hopFade'); }
  } else {
    const k = Math.min(1, (h.t - HOP_SWAP) / (HOP_T - HOP_SWAP));
    h.y = (1 - k * k) * 4;
    if (h.t >= HOP_T) {
      EX.hop = null;
      sfx.land(); G.trauma = Math.min(1, G.trauma + 0.35);
      burst(player.x, 0.3, player.z, [0x6a6e78, 0x4a4e58], 10, 4);
      smoke(player.x, 0.3, player.z, 6, 1.3, 0x55585f);
    }
  }
}
function switchLayer(to) {
  const from = EX.layer, chasers = [];
  const goHome = e => { if (e.unit && e.squad && !e.squad.wave) { e.unit.away = false; e.unit.hp = e.parts.torso.hp; } };
  // 追過來的：路程 70 格內、醒著、還有追的次數
  for (const e of enemies.slice()) {
    if (!e.alive) { removeEnemy(e); continue; }
    const d = e.fly ? flyDist(e.x, e.z) : flowDist(e.x, e.z), q = e.boss ? 99 : e.chase ?? 0;
    if (!e.dormant && !e.drop && q > 0 && d < 70 && canEnter(e.preset, 'drop')) {   // 追到別層是空投下來的 → 不能空投的（蟲群）不追
      e.chase = q - 1;
      if (e.unit && e.squad && !e.squad.wave) { e.unit.away = true; e.unit.hp = e.parts.torso.hp; const i = e.squad.members.indexOf(e); if (i >= 0) e.squad.members.splice(i, 1); }
      parkEnemy(e);
      chasers.push({ e, t: 1.2 + d / 7 + Math.random() * 1.2 });
    }
  }
  // 還在路上、要追到上一層的：還能追就改追到這層，不然回家
  for (const c of EX.chasers) {
    if (c.e.boss || (c.e.chase ?? 0) > 0) { if (!c.e.boss) c.e.chase--; c.t = 2.5 + Math.random() * 2; chasers.push(c); }
    else { goHome(c.e); }
  }
  for (const S of EX.squads) if (S.members.length) { despawnSquad(S); S.awake = false; }
  for (const e of enemies.slice()) { goHome(e); removeEnemy(e); }
  EX.waves = EX.waves.filter(W => W.members.some(e => chasers.some(c => c.e === e)));
  for (const W of EX.waves) W.layer = to.layer;
  EX.pending = [];
  EX.stash[from] = stashPickups();
  clearShots(); clearWrecks(); clearDevices();
  sensors.progress.clear(); sensors.locks = [];
  player.x = to.x; player.z = to.z; player.vx = player.vz = 0;
  enterLayer(to.layer);
  for (const c of chasers) { c.x = to.x; c.z = to.z; }
  EX.chasers = chasers;
}
// 換到第 k 層（地圖、建築、迷霧、小地圖、之後新增的物件、燈光、那層地上的掉落物）
function enterLayer(k) {
  EX.layer = k;
  setLayer(k); setBuildingLayer(k); setFogLayer(k); setMinimapLayer(k); setPropLayer(k); setRubbleLayer(k, layerGroup(k), layerU(k)); setHuskLayer(k);
  applyLight(!!EX.map.layers[k].under, EX.map.terrain);
  restorePickups(EX.stash[k]); EX.stash[k] = null;
  updateFog(1, player.x, player.z);
}
// 追過來的敵機：時間到就在連接點附近空降
function updateChasers(dt) {
  for (let i = EX.chasers.length - 1; i >= 0; i--) {
    const c = EX.chasers[i];
    if ((c.t -= dt) > 0) continue;
    EX.chasers.splice(i, 1);
    let at = null;
    for (let t = 0; t < 30 && !at; t++) { const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 3, x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r; if (openAround(x, z)) at = { x, z }; }
    at ??= { x: c.x, z: c.z };
    unparkEnemy(c.e, at.x, at.z);
    c.e.dormant = false;
  }
}
function exLoot(e) {
  const x = e.x, z = e.z;
  spawnPickup('scrap', x, z, (e.enElite ? 9 : 3) + (e.lvl ?? 0) + (EN.stage - 1) * 2);
  const [a, r] = e.enElite ? [0.08, 0.05] : [0.05, 0.03];   // 彈藥 / 修理掉落率（零件一定掉）
  if (Math.random() < a) spawnPickup('ammo', x, z);
  if (Math.random() < r) spawnPickup('repair', x, z);
}
function exploreKill(e) {
  EN.kills++;
  if (e.boss) {
    EX.boss = null;
    $('boss').classList.add('hidden');
    setPortal(EX.portal, 'open');
    spawnPickup('mod', e.x, e.z); spawnPickup('repair', e.x, e.z); spawnPickup('ammo', e.x, e.z);
    const t = randomTech(); if (t) spawnPickup('tech', e.x, e.z, t);   // 頭目一定掉一個晶片 / 裝置
    addProp('gun', e.x, e.z, { weapon: PLAYER_WEAPONS[Math.floor(Math.random() * PLAYER_WEAPONS.length)] });
    toast('頭目擊破！傳送門開啟'); sfx.lock();
    return;
  }
  exLoot(e);
  const S = e.squad;
  if (!S) return;
  e.unit.dead = true;
  if (S.wave || !S.units.every(u => u.dead)) return;
  S.cleared = true; S.awake = false; EX.cleared++;
  if (Math.random() < 0.35) spawnPickup('repair', e.x, e.z);
  if (Math.random() < 0.35) spawnPickup('ammo', e.x, e.z);
  spawnPickup('scrap', e.x, e.z, 8 + S.depth * 2);
  if (EX.cleared <= EX.need) toast(`小隊清除 ${EX.cleared} / ${EX.need}`);   // 只報傳送門進度，不報是哪一隊
}
// ---------- 迷霧裡的東西 ----------
// 敵機：看得到的格子上才畫；開火會暴露位置 1 秒（看不見的狙擊手打你時至少知道在哪）
// 長距鎖定頭：鎖定距離內看不到的敵機顯示成紅色訊號點；其他頭：正在鎖 / 已鎖上的也顯示
// 掉落物：看得到才畫
const BLIP_GEO = new THREE.RingGeometry(0.45, 0.7, 4), blips = [];
function fogVisibility(dt) {
  const on = fogActive(), Hd = sensors.head;
  let n = 0;
  for (const e of enemies) {
    if (!e.alive) continue;
    for (const s in e.guns) { const g = e.guns[s]; if (g.cd > (g.pcd ?? 0) + 0.01) e.revealT = 1; g.pcd = g.cd; }
    e.revealT = Math.max(0, (e.revealT ?? 0) - dt);
    const vis = !on || visibleAt(e.x, e.z) || e.revealT > 0;
    e.fogVis = vis;
    e.model.root.visible = vis;
    if (on && !vis && player.alive && ((Hd?.radarLock && Math.hypot(e.x - player.x, e.z - player.z) < Hd.lockRange) || sensors.progress.has(e))) {
      let b = blips[n];
      if (!b) { b = blips[n] = new THREE.Mesh(BLIP_GEO, addMat(0xff5040, 0.85)); b.rotation.x = -Math.PI / 2; scene.add(b); }
      b.visible = true; b.position.set(e.x, 0.1, e.z); b.rotation.z = G.now * 2;
      n++;
    }
  }
  for (let i = n; i < blips.length; i++) blips[i].visible = false;
  for (const p of pickups) if (on && !visibleAt(p.x, p.z)) p.g.visible = false;
}
const runSummary = () => {
  const mods = Object.entries(EN.mods).map(([k, n]) => `${MODS[k].name}${n > 1 ? ' ×' + n : ''}`).join('、') || '無';
  const guns = SLOTS.map(s => EN.loadout[s]).filter(Boolean).map(id => WEAPONS[id].name).join('、') || '無';
  return `第 <b>${EN.stage}</b> 關・${mmss(EN.t)}・擊破 <b>${EN.kills}</b> 台<br>武器：${guns}<br>強化：${mods}`;
};
function showExploreResult() {
  G.paused = true;
  sfx.click();
  showPanel('機體損毀', runSummary(), [
    { label: '再出發', primary: true, run: () => startRun() },
    { label: '整備（換骨架）', run: () => { hidePanel(); openGarageFrom('result'); } },
    { label: '回主選單', run: showMenu },
  ]);
}
function endWatch(result) {
  MODE.result = result;
  if (result !== 'draw') MODE.score[result]++;
  MODE.endT = 4.5;
  const text = result === 'draw' ? '平手' : MODE.kind === 'skirmish' ? (result === 'blue' ? '藍軍勝利' : '紅軍勝利') : MODE.kind === 'horde' ? (result === 'blue' ? '王牌勝利：雜魚全滅' : '王牌被擊墜') : result === 'blue' ? '藍方勝利' : result === 'red' ? '紅方勝利' : '同歸於盡';
  setTimeout(() => { if (MODE.name === 'watch') toast(text); }, 2000);
}
// 殘骸回收：擊破一台，所有武器回復上限 4% 的彈藥
function salvage() { if (player?.alive && hasChip(player, 'salvage')) for (const g of Object.values(player.guns)) if (g.max !== Infinity) g.ammo = Math.min(g.max, g.ammo + Math.ceil(g.max * 0.04)); }
// 遠征裡撿得到的晶片 / 裝置：不是基礎款、還沒拿過的
function randomTech() {
  const pool = [...Object.keys(CHIPS), ...Object.keys(DEVICES)].filter(id => !(CHIPS[id] ?? DEVICES[id]).basic && !EN.inv.includes(id));
  return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
}
AI.onEnemyDeath = (e) => {
  if (e.team !== 'player') salvage();
  if (MODE.name === 'endless') { if (!MODE.result) { EN.kills++; enLoot(e); } return; }
  if (MODE.name === 'explore') { if (!MODE.result) exploreKill(e); return; }
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
  $('menu').classList.remove('hidden'); hideSub();
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
function restart() { MODE.name === 'explore' ? startRun() : MODE.name === 'endless' ? startEndless() : MODE.name === 'duel' ? startDuel(MODE.duel.preset, MODE.duel.diffKey) : MODE.name === 'watch' ? nextWatch() : startSandbox(); }
const WATCH_LIMIT = 180;   // 觀戰一場最多幾秒（遊戲時間）
const nextWatch = () => MODE.kind === 'horde' ? startHorde() : MODE.kind === 'skirmish' ? startSkirmish() : startWatch();
function pause() {
  G.paused = true;
  showPanel('暫停', MODE.name === 'explore' ? `遠征・地圖 #${EX.map.seed}<br>${runSummary()}` : MODE.name === 'endless' ? `無盡模式・${mmss(EN.t)}・擊破 ${EN.kills}` : MODE.name === 'duel' ? `對戰・${DIFFS[MODE.duel.diffKey].name}` : MODE.name === 'watch' ? `觀戰${MODE.kind === 'horde' ? '（王牌 vs 雜魚）' : MODE.kind === 'skirmish' ? '（雜魚 vs 雜魚）' : ''}・第 ${MODE.round} 場` : '試玩場', [
    { label: '繼續', primary: true, run: () => { hidePanel(); G.paused = false; } },
    { label: MODE.name === 'watch' ? '下一場' : '重新開始', run: restart },
    ...(MODE.name === 'duel' ? [{ label: '換對手', run: openDuelSetup }] : []),
    { label: '設定', run: () => openSettings() },
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
<b>操作</b>WASD 移動・滑鼠瞄準・左鍵 / 右鍵 左右手・Q / E 左右背・Space / Shift 推進衝刺<br>G 整備・F 互動（遠征：開箱、撿武器、傳送門）・Esc 暫停<br>
手把：左右搖桿、LT / RT 左右手、LB / RB 左右背、A 衝刺、X 互動、Back 整備、Start 暫停<br>
<b>移動</b>有慣性：放開方向鍵會滑一段。冰面很滑、泥地很慢。衝刺吃能量，不受摩擦限制<br>
<b>屬性</b>動能剋鏡面、化學剋複合、能量剋陶瓷；反過來會被擋下（藍白色火花）<br>
<b>部位</b>打到哪看子彈從哪個方向來：正面是軀幹裝甲、側面是手臂、背面是弱點和背部武器<br>
<b>鎖定</b>敵機永遠看得到。地上淡淡的扇形是頭的鎖定範圍，架起飛彈後扇形裡（或準星附近）的敵機會慢慢鎖上；頭被打掉還能鎖，只是範圍變小</div>`;

// ---------- 主選單與對戰設定 ----------
$('mDuel').onclick = () => { unlockAudio(); sfx.click(); openDuelSetup(); };
// 子選單：主選單的按鈕換成一串選項（試玩場、無盡模式先收起來，程式還在）
function showSub(title, items) {
  $('mSubTitle').textContent = title;
  const list = $('mSubList');
  list.innerHTML = '';
  for (const it of items) {
    const el = document.createElement('button');
    el.className = 'btn' + (it.primary ? ' primary' : '');
    el.innerHTML = `${it.label}<small>${it.desc}</small>`;
    el.onclick = () => { unlockAudio(); sfx.click(); hideSub(); it.run(); };
    list.appendChild(el);
  }
  $('mMain').classList.add('hidden'); $('mSub').classList.remove('hidden');
}
function hideSub() { $('mSub').classList.add('hidden'); $('mMain').classList.remove('hidden'); }
$('mSubBack').onclick = () => { sfx.click(); hideSub(); };
$('mExplore').onclick = () => {
  unlockAudio(); sfx.click();
  showSub('遠征・選關', [
    { label: '第 1 關', desc: `${TERRAINS[terrainOf(1)]}・從機槍和飛彈出發`, primary: true, run: () => startRun() },
    ...[2, 3, 4, 5, 6].map(n => ({ label: `第 ${n} 關`, desc: `${TERRAINS[terrainOf(n)]}・直接從這關開始：補 ${Math.min(2, n - 1)} 把隨機武器、${(n - 1) * 2} 個強化模組、${(n - 1) * 30} 零件`, run: () => startRun(undefined, n) })),
  ]);
};
$('mWatchMenu').onclick = () => {
  unlockAudio(); sfx.click();
  showSub('觀戰', [
    { label: '電腦對電腦', desc: '隨機配裝・打完自動換下一場', primary: true, run: () => startWatch(true) },
    { label: '王牌 vs 雜魚', desc: '一台王牌機對上一批批空投的雜魚機（共 18 台）', run: () => startHorde(true) },
    { label: '雜魚 vs 雜魚', desc: '藍紅兩隊雜魚各 12 台，從兩側空投，先全滅的輸', run: () => startSkirmish(true) },
  ]);
};
$('mGarage').onclick = () => { unlockAudio(); sfx.click(); openGarageFrom('menu'); };
$('mSettings').onclick = () => { unlockAudio(); sfx.click(); openSettings(); };
// 零件工坊：關掉時重蓋玩家機體（試穿的外型套上 / 拿掉）
$('mWorkshop').onclick = () => { unlockAudio(); sfx.click(); $('menu').classList.add('hidden'); openWorkshop(() => { spawnPlayer(0, 0, 0); $('menu').classList.remove('hidden'); }); };
$('mHelp').onclick = () => { unlockAudio(); sfx.click(); showPanel('操作說明', HELP, [{ label: '返回', primary: true, run: hidePanel }]); };

let duelPick = 0, duelDiff = 'normal';
const DUEL_LIST = [...ENEMY_PRESETS, ...ELITES];   // 對戰可以選的：一般機體 + 菁英（實驗）
const wTag = id => id ? `<span class="wt" style="--c:${DMG_TYPES[WEAPONS[id].type].css}">${WEAPONS[id].name}</span>` : '';
function presetCard(P, i) {
  const armors = [...new Set(Object.values(P.armor))].map(a => `<span class="wt" style="--c:${ARMORS[a].css}">${ARMORS[a].name}</span>`).join('');
  return `<button class="card ${i === duelPick ? 'on' : ''}" data-i="${i}"><b>${P.name}</b>
    <small>${P.elite ? '<span class="wt" style="--c:#ffb040">菁英</span> ' : ''}${LEGS[P.legs].name}・${SLOTS.map(s => P[s]).filter(Boolean).length} 把武器</small>${P.note ? `<small>${P.note}</small>` : ''}
    <div>${SLOTS.map(s => wTag(P[s])).join('')}</div><div>裝甲 ${armors}</div></button>`;
}
function renderDuel() {
  $('dCards').innerHTML = DUEL_LIST.map(presetCard).join('') +
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
$('dStart').onclick = () => { unlockAudio(); sfx.click(); startDuel(duelPick < 0 ? null : DUEL_LIST[duelPick], duelDiff); };
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
const LOOK_SENS = 0.0032, LOOK_LEAD = 1.1;   // 滑鼠轉向：每像素轉幾弧度（× 設定的靈敏度）、瞄準最多領先上半身幾弧度
function updateAim(raw) {
  // 滑鼠轉向：左右 = 轉鏡頭（上半身跟著轉到鏡頭正前方）、上下 = 瞄準點遠近；手把右搖桿左右轉
  // 滑鼠動的是「想轉到的方向」（aimYaw），上半身照機體的轉向速度追過去、鏡頭跟著上半身；最多領先上半身 LOOK_LEAD（再甩也不會更前面）
  if (turning()) {
    if (input.source === 'pad') { if (input.padAim.active) aimYaw -= input.padAim.x * 2.6 * raw; }
    else if (input.locked) {
      aimYaw -= input.look.dx * LOOK_SENS * view.sens;
      view.aimDist = Math.max(3, Math.min(26, view.aimDist - input.look.dy * 0.035 * view.sens));
    }
    const lead = angleDiff(player.torsoYaw, aimYaw);
    if (Math.abs(lead) > LOOK_LEAD) aimYaw = player.torsoYaw + Math.sign(lead) * LOOK_LEAD;
    const fx = Math.sin(aimYaw), fz = Math.cos(aimYaw);
    aimPoint = { x: player.x + fx * view.aimDist, z: player.z + fz * view.aimDist };
    // 準星（游標旁的彈藥）畫在瞄準點上
    tmpV.set(aimPoint.x, 1.4, aimPoint.z).project(camera);
    input.mouse.x = (tmpV.x + 1) / 2 * innerWidth; input.mouse.y = (1 - tmpV.y) / 2 * innerHeight;
    return;
  }
  if (input.source === 'pad') {
    if (input.padAim.active) { const [ax, az] = s2w(input.padAim.x, input.padAim.y); aimYaw = Math.atan2(ax, az); }
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
  if (g.def.kind === 'shield') return m.shield ? `${Math.ceil(m.shield.hp)}/${Math.round(m.shield.max)}` : '—';
  if (g.ammo <= 0) return '<span class="bad">彈盡</span>';
  if (m.deployT[slot.slice(-1)] > 0 && activeSlot(m, slot.slice(-1)) === slot) return '展開中';
  if (g.def.energy) return m.energy < g.def.energy ? '<span class="bad">能量不足</span>' : g.cd > 0 ? '冷卻' : '就緒';
  if (g.def.needLock && !sensors.locks.length) return '需要鎖定';
  return g.def.ammo ? `${g.ammo}/${g.max}` : g.cd > 0 ? '冷卻' : '就緒';
}
let gunsKey = '';
// 游標旁的彈藥（只有用滑鼠時）：每個掛點一個數字，正在用的（左右鍵現在打的那把）白色、其他灰色；
//   能量武器 / 劍 ∞、盾牌顯示盾的耐久、壞掉 ×、打光 0（紅）、沒裝東西 NaN；開火時那個數字閃一下（放大、變亮）
const retKey = {}, retCd = {};
const RET_BASE = 'scale(1.18, 0.78)', RET_FLASH = [{ transform: 'scale(1.5, 1)', filter: 'brightness(2.2)' }, { transform: RET_BASE, filter: 'brightness(1)' }];
function updateReticle(show) {
  const el = $('reticle');
  el.classList.toggle('hidden', !show);
  if (!show) return;
  el.style.transform = `translate(${input.mouse.x}px, ${input.mouse.y}px)`;
  const p = player;
  for (const s of SLOTS) {
    const g = p.guns[s], side = s.slice(-1);
    let txt = 'NaN', bad = false;
    if (g) {
      if (p.parts[s]?.broken) { txt = '×'; bad = true; }
      else if (g.def.kind === 'shield') txt = p.shield ? `盾${Math.ceil(p.shield.hp)}` : '';
      else if (g.max === Infinity) txt = '∞';
      else { txt = String(g.ammo); bad = g.ammo <= 0; }
    }
    const cls = `${s.startsWith('arm') ? 'top' : 'bot'} ${side === 'L' ? 'L' : 'R'} ${activeSlot(p, side) === s ? 'act' : ''} ${bad ? 'bad' : ''} ${g ? '' : 'none'}`;
    const sp = $('r' + s);
    // 開火：冷卻剛被重新設定（比上一幀大）
    if (g && g.cd > (retCd[s] ?? 0) + 0.005) sp.animate(RET_FLASH, { duration: 110, easing: 'ease-out' });
    retCd[s] = g?.cd ?? 0;
    const k = txt + '|' + cls;
    if (retKey[s] === k) continue;
    retKey[s] = k;
    sp.textContent = txt; sp.className = cls;
  }
}
function updateHud() {
  const p = player;
  paintDoll($('dollP'), p.alive ? p : null);
  // 每一邊：目前準備好的那把亮著（kbd 顯示左鍵 / 右鍵），另一把暗著（背部顯示切換鍵）
  const rows = SLOTS.map(s => {
    const g = p.guns[s], side = s.slice(-1), act = activeSlot(p, side) === s;
    const key = act ? (side === 'L' ? '左鍵' : '右鍵') : s.startsWith('back') ? (side === 'L' ? 'Q' : 'E') : '—';
    return `<div class="gun${act ? ' act' : ' idle'}"><kbd>${key}</kbd>${g ? `<i style="background:${DMG_TYPES[g.def.type].css}"></i>${g.def.name}` : '<span class="dim">（空）</span>'}<em>${gunState(p, s)}</em></div>`;
  }).join('');
  const D = p.device && DEVICES[p.device.id];
  const devRow = D ? `<div class="gun ${deviceReady(p) ? 'act' : 'idle'}"><kbd>R</kbd><i style="background:#60d0ff"></i>${D.name}<em>${D.charges ? `${p.device.charges}/${D.charges}` : p.device.cd > 0 ? `${Math.ceil(p.device.cd)} 秒` : '就緒'}</em></div>` : '';
  if (rows + devRow !== gunsKey) { gunsKey = rows + devRow; $('guns').innerHTML = rows + devRow; }
  $('energy').style.width = p.energy + '%';
  $('energy').parentElement.classList.toggle('low', p.energy < 30);
  $('surf').textContent = p.surf?.name ?? '';
  $('speed').textContent = Math.hypot(p.vx, p.vz).toFixed(1);
  const H = sensors.head;
  $('lockInfo').textContent = (!H?.lockCount ? '無法鎖定' : wantsLock(p) ? `鎖定 ${sensors.locks.length}/${H.lockCount}` : '鎖定待命（未備飛彈）') + (H?.health != null && H.lockCount ? `・感測受損 ${Math.round((1 - H.health) * 100)}%` : '');
  const S = p.spec;
  $('warn').textContent = [p.staggerT > 0 && '失衡！', S.loadK > 1 && '超重', S.armOver && '手臂超重', S.backOver && '背部超重', p.parts.head.broken && '頭部損毀：鎖定距離縮短'].filter(Boolean).join('・');
  // 準星附近、看得到的敵機；對戰中一直顯示對手
  let best = null, bd = MODE.name === 'duel' ? Infinity : 6;
  for (const e of enemies) {
    if (!e.alive || e.drop || e.fogVis === false) continue;
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

// ---------- 鏡頭看得到的範圍 ----------
// 從上一幀的鏡頭打四條射線到地面（畫面左右邊緣、上下邊緣往內一點），量出從畫面中心往四個方向看得到多遠；除以鏡頭距離 = 每單位距離的範圍
let lockZoom = 1, lastCd = 30, minimapYaw = '';
// 滑鼠轉向的鏡頭彈簧（ω，每秒）：0 = 低緩衝（跟得緊）、1 = 中、2 = 高（最慢最重）
const CAM_SPRING = [10, 6.5, 4.2];
let camYawV = 0;
// 滑鼠轉向模式：遊戲中游標鎖住（點一下畫面才鎖得住，瀏覽器規定要有使用者動作）；離開遊戲畫面就放開
// 鎖住時按 Esc 瀏覽器會直接放開、不送按鍵給網頁 → 被放開又還在玩 = 當作按了暫停
let wantLock = false;
function updatePointerLock(want) {
  wantLock = turning() && want;
  if (!wantLock && input.locked) document.exitPointerLock?.();
  lockHint.classList.toggle('hidden', !wantLock || input.locked);
}
// 小地圖的指北針（N）
const northMark = document.createElement('div');
northMark.id = 'northMark'; northMark.className = 'hidden'; northMark.textContent = 'N';
document.body.appendChild(northMark);
const lockHint = document.createElement('div');
lockHint.id = 'lockHint'; lockHint.className = 'hidden'; lockHint.textContent = '點一下畫面鎖定滑鼠（滑鼠轉向模式）';
document.body.appendChild(lockHint);
addEventListener('mousedown', e => {
  if (!wantLock || input.locked || e.target !== renderer.domElement) return;
  renderer.domElement.requestPointerLock?.();
  e.stopImmediatePropagation();   // 這一下只是拿來鎖游標，不開火
}, true);
document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement && wantLock && !G.paused) pause(); });
const camLook = new THREE.Vector3(), extRay = new THREE.Raycaster(), groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), extV = new THREE.Vector3();
function viewExtents() {
  const out = {};
  // 上下留比較多：下方有狀態欄、上方有提示
  for (const [k, x, y] of [['r', 0.9, 0], ['l', -0.9, 0], ['t', 0, 0.82], ['b', 0, -0.72]]) {
    extRay.setFromCamera({ x, y }, camera);
    if (!extRay.ray.intersectPlane(groundPlane, extV)) { out[k] = 0.3; continue; }
    const [sx, sy] = w2s(extV.x - camLook.x, extV.z - camLook.z);   // 換成畫面方向量（鏡頭可能轉了）
    out[k] = (k === 'r' || k === 'l' ? Math.abs(sx) : Math.abs(sy)) / lastCd;
  }
  return out;
}

// ---------- 主迴圈 ----------
const TICK = location.search.includes('tick');
const nextFrame = TICK ? cb => setTimeout(() => cb(performance.now()), 16) : requestAnimationFrame;
let last = performance.now(), lastLocks = 0, garageK = 0, watchK = 1, killK = 0;
function frame(t) {
  nextFrame(frame);
  const ms = t - last;
  perfBegin(); step(t); perfEnd(ms);
}
function step(t) {
  const raw = Math.min(0.05, (t - last) / 1000);
  last = t;
  G.now += raw;
  updateInput();
  // 重組畫面：世界停住，只畫傳送隧道
  if (reasmActive()) { updateReasm(raw); renderReasm(renderer); updateReticle(false); clearPressed(); return; }
  const playing = MODE.name !== 'menu', watching = MODE.name === 'watch';
  if (input.garagePressed && !watching && MODE.name !== 'endless' && MODE.name !== 'explore') { if (garage.open) leaveGarage(); else if (playing && !panelOpen()) openGarageFrom('play'); }
  if (input.pausePressed && settingsOpen()) { closeSettings(); input.pausePressed = false; }
  if (input.pausePressed) {
    if (garage.open) leaveGarage();
    else if (playing && (!MODE.result || watching)) { if (G.paused) { hidePanel(); G.paused = false; } else pause(); }
  }
  if (playing && MODE.name === 'sandbox' && input.passivePressed) { AI.passive = !AI.passive; toast(AI.passive ? '敵機停火' : '敵機開火'); }
  if (playing && MODE.name === 'sandbox' && input.resetPressed && !garage.open) { spawnPlayer(player.x, player.z, player.torsoYaw); toast('機體修復'); }

  let dt = !playing || G.paused || garage.open || window.__dbg.paused ? 0 : raw;
  // 頭目著陸定格：時間停住（鏡頭照樣動）
  if (bossIntro.t > 0 && !G.paused) { if ((bossIntro.t -= raw) <= 0) { document.body.classList.remove('killcam'); fxHide('bossIntro'); } dt = 0; }
  // 傳送中：世界停住，只播分解演出（粒子照樣飛）
  const warping = MODE.name === 'explore' && EX?.warpT != null;
  if (warping && !G.paused) { dt = 0; updateWarpOut(raw); }
  // 換層：世界停住一下（跳起來 → 換層 → 落地）
  const hopping = MODE.name === 'explore' && !!EX?.hop;
  if (hopping && !G.paused) { dt = 0; updateHop(raw); }
  updateWarp(G.paused ? 0 : raw);
  if (dt > 0 && G.hitStop > 0) { G.hitStop -= raw; dt = 0; }
  // 慢動作：被擊墜時很慢（SLOW_K），最後 0.4 秒慢慢回到正常速度
  if (dt > 0 && G.slowMo > 0) { G.slowMo -= raw; const k = killCam.t > 0 ? SLOW_K : 0.35; dt *= G.slowMo < 0.4 ? k + (1 - k) * (1 - G.slowMo / 0.4) : k; }

  if (!turning()) view.yaw = 0;
  updatePointerLock(playing && !watching && !garage.open && !G.paused && !panelOpen() && !settingsOpen() && player.alive && !MODE.result && input.source === 'mouse');
  if (playing && !watching && !garage.open) updateAim(raw);
  if (dt > 0) {
    if (watching) { /* 沒有玩家 */ }
    else if (player.alive) {
      const [mx, mz] = s2w(input.move.x, input.move.y);   // WASD / 左搖桿是畫面方向
      if (input.boostPressed) tryBoost(player, mx, mz);
      driveMech(player, dt, mx, mz, aimYaw);
      if (input.readyL && !toggleReady(player, 'L')) sfx.click();
      if (input.readyR && !toggleReady(player, 'R')) sfx.click();
      if (input.techPressed && player.device) useDevice(player, aimPoint);
      updateDeviceCd(player, dt);
      updateGuns(player, { L: input.fireL, R: input.fireR }, dt, sensors.locks, aimPoint);
    } else if (MODE.name === 'sandbox' && (respawnT -= dt) <= 0) { spawnPlayer(); toast('重新出擊'); }
    if (MODE.name === 'endless') updateEndless(dt);
    if (MODE.name === 'explore') updateExplore(dt);
    if (!watching && player.alive) updateFlow(dt, player.x, player.z);
    if (watching && MODE.kind === 'horde') updateHorde(dt);
    if (watching && MODE.kind === 'skirmish') updateSkirmish(dt);
    for (const e of enemies.slice()) {
      updateEnemy(e, dt, e.foe ?? player);
      if (e.alive && !e.drop) driveMech(e, dt, e.drive.mx, e.drive.mz, e.aimYaw);
    }
    keepEnemies(player);
    collideMechs();
    updateShots(dt);
    for (const m of mechs.slice()) updateStatus(m, dt);   // 持續效果（燃燒之類，status.js）
    updateWrecks(dt, raw);
    updateBuildings(dt);
    updateDevices(dt);
    if (!watching) {
      updateSensors(player, enemies, aimPoint, dt);
      if (player.lockBreak) { sensors.progress.clear(); sensors.locks = []; player.lockBreak = false; }   // 失衡：鎖定被打斷
      if (sensors.locks.length > lastLocks) sfx.lock();
      lastLocks = sensors.locks.length;
    }
    // 觀戰時間上限（彈藥打光可能僵住）：一對一比剩餘耐久、雜魚戰比剩幾台、王牌 vs 雜魚算王牌沒清完
    if (watching && !MODE.result && (MODE.clock += dt) > WATCH_LIMIT) {
      if (MODE.kind === 'horde') endWatch('red');
      else if (MODE.kind === 'skirmish') { const b = MODE.sk.blue.killed, r = MODE.sk.red.killed; endWatch(b < r ? 'blue' : r < b ? 'red' : 'draw'); }
      else {
        const hpK = t => enemies.filter(e => e.team === t && e.alive).reduce((a, e) => a + Object.values(e.parts).reduce((s, p) => s + p.hp / p.max, 0), 0);
        const b = hpK('blue'), r = hpK('red');
        endWatch(Math.abs(b - r) < 0.05 ? 'draw' : b > r ? 'blue' : 'red');
      }
      toast('時間到');
    }
    // 對戰結束：倒下的動畫播一下再出結果；觀戰：自動下一場
    if (MODE.endT > 0 && (MODE.endT -= raw) <= 0) watching ? nextWatch() : MODE.name === 'endless' ? showEndlessResult() : MODE.name === 'explore' ? showExploreResult() : showResult(MODE.result === 'win');
  }
  if (!playing || dt > 0 || garage.open) updateParticles(playing ? dt : raw);
  else if ((warping || hopping) && !G.paused) updateParticles(raw);
  for (const m of mechs) poseMech(m, dt);
  if (hopping && EX?.hop) player.model.root.position.y += EX.hop.y;
  if (!playing) { player.torsoYaw = player.legYaw = G.now * 0.25; poseMech(player, 0); }
  clearPressed();

  // 瞄準線：左右各一條，從那一邊目前準備好的武器的槍口、沿上半身正前方射出（子彈就是這樣飛的）；空手、壞掉、劍不畫
  for (const side of ['L', 'R']) {
    const slot = activeSlot(player, side), g = player.guns?.[slot];
    if (playing && !watching && player.alive && !garage.open && !warping && !hopping && g && !player.parts[slot]?.broken && g.def.kind !== 'saber' && g.def.kind !== 'shield') {
      const f = facing(player), mz = muzzleOf(player, slot);
      setLaser(guides[side], mz.x, mz.z, f.x, f.z, rayBlock(mz.x, mz.z, f.x, f.z, 22), mz.y, 0.3, 0.03);
    } else guides[side].g.visible = false;
  }

  // 鏡頭：跟著玩家、往瞄準方向偏；整備時拉近、讓機體在畫面左邊；主選單拉近看機體
  // 偏多少：瞄準方向上「整個鎖定距離」都要在畫面裡（鎖定得到的敵人一定看得到）；滑鼠拉遠時至少照原本的手感偏（最多 5 格）
  // 偏到玩家快出畫面還裝不下（長距鎖定頭 34 格）就把鏡頭拉遠
  garageK += ((garage.open || !playing ? 1 : 0) - garageK) * (1 - Math.exp(-6 * raw));
  const REST_Z = -1.2 * (1 - garageK);
  let lx = 0, lz = 0, zoomWant = 1;
  if (playing && !watching && player.alive && !garage.open) {
    const H = sensors.head, R = Math.max(8, H?.lockRange ?? 18), M = 2.5;
    // 偏移方向看「游標在畫面上相對畫面中心」（手把看右搖桿），不看瞄準角度：
    // 瞄準角度又跟玩家在畫面上的位置有關，用它會跟鏡頭偏移互相拉扯、卡在錯的方向
    let dx, dz, gate = 1;
    if (turning()) { dx = 0; dz = -1; }   // 滑鼠轉向：一直往正前方（畫面上方）偏
    else if (input.source === 'pad') { dx = input.padAim.x; dz = input.padAim.y; }
    else {
      const nx = input.mouse.x / innerWidth * 2 - 1, ny = input.mouse.y / innerHeight * 2 - 1, nl = Math.hypot(nx, ny) || 1;
      dx = nx / nl; dz = ny / nl;
      gate = Math.min(1, Math.max(0, (nl - 0.02) / 0.05));  // 游標幾乎在正中間：方向不穩，不偏（稍微離開一點就全偏）
    }
    const E = viewExtents();
    // 從畫面中心往 (ux, uz) 方向，地上看得到多遠（鏡頭距離 s 時）
    const reach = (ux, uz, s) => Math.min(ux > 1e-3 ? E.r * s / ux : ux < -1e-3 ? E.l * s / -ux : 1e9, uz < -1e-3 ? E.t * s / -uz : uz > 1e-3 ? E.b * s / uz : 1e9);
    zoomWant = Math.max(1, (R + 2 * M) / (reach(dx, dz, camDist) + reach(-dx, -dz, camDist)));
    const s0 = camDist * lockZoom, fwd = reach(dx, dz, s0), back = reach(-dx, -dz, s0);
    const need = Math.max(0, R + M - fwd), room = Math.max(0, back - M);
    const mouse = Math.min(Math.hypot(aimPoint.x - player.x, aimPoint.z - player.z) * 0.3, 5);
    const off = Math.min(Math.max(need, mouse), room) * gate;
    lx = dx * off; lz = dz * off;
  }
  lockZoom += (zoomWant - lockZoom) * (1 - Math.exp(-2.5 * raw));
  const dist = camDist * (1 - garageK * 0.45) * lockZoom;
  if (garageK > 0.001) {
    // 整備 / 選單面板在右邊：鏡頭往右移，讓機體落在左邊空出來的那塊中間
    const visW = 2 * dist * Math.tan(camera.fov * Math.PI / 360) * camera.aspect;
    const panel = (garage.open ? Math.min(820, innerWidth * 0.66) : Math.min(560, innerWidth * 0.5)) / innerWidth;
    lx += garageK * visW * panel / 2;
  }
  // 觀戰：鏡頭看兩台的中間，離得越遠拉得越遠
  let fx = player.x, fz = player.z, restZ = REST_Z, distK = 1;   // restZ：畫面方向（往上）的偏移，觀戰 / 特寫不用
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
    lx = lz = 0; restZ = 0;
  }
  // 擊墜特寫：鏡頭飛到被打爆的那台、拉近
  const kc = (killCam.t > 0 || bossIntro.t > 0) && playing;
  if (kc) { const K = bossIntro.t > 0 ? bossIntro : killCam; fx = K.x; fz = K.z - 0.4; lx = lz = 0; restZ = 0; }
  killK += ((kc ? 1 : 0) - killK) * (1 - Math.exp(-(kc ? 7 : 2.5) * raw));
  const ck = 1 - Math.exp(-(kc ? 8 : watching ? 2.5 : 5) * raw);
  const [wlx, wlz] = s2w(lx, lz + restZ);   // 偏移都是畫面方向，換成世界方向
  camTarget.x += (fx + wlx - camTarget.x) * ck;
  camTarget.z += (fz + wlz - camTarget.z) * ck;
  watchK += (distK - watchK) * (1 - Math.exp(-1.5 * raw));
  G.trauma = Math.max(0, G.trauma - raw * 1.6);
  const sh = G.trauma * G.trauma * 0.7;
  const ox = (Math.random() - 0.5) * sh, oz = (Math.random() - 0.5) * sh;
  const cd = dist * (watching ? watchK : 1) * (1 - 0.42 * killK);
  // 滑鼠轉向：鏡頭跟著上半身轉（上半身照機體的轉向速度追滑鼠，重的機體鏡頭就轉得慢）
  //   用臨界阻尼的彈簧追（不是直接貼上）：起步慢慢加速、快到的時候慢慢減速停下，不會一下甩到底 → 比較不暈、有重量感
  //   ω 越小越慢越「重」（設定的鏡頭緩衝）；上半身照樣用機體的轉向速度轉，鏡頭在後面追
  if (turning() && playing && !watching && player.alive && !garage.open) {
    const w = CAM_SPRING[view.smooth] ?? CAM_SPRING[1], d = angleDiff(view.yaw, player.torsoYaw + Math.PI);
    camYawV += (w * w * d - 2 * w * camYawV) * raw;
    view.yaw += camYawV * raw;
  } else camYawV = 0;
  // 特寫（擊墜、頭目登場）和觀戰：暫時回到固定朝北的鏡頭，結束後轉回來
  const camYaw = watching ? 0 : view.yaw + angleDiff(view.yaw, 0) * killK;
  const back = Math.cos(CAM_PITCH) * cd;   // 鏡頭在正前方的反方向（固定模式 = 南邊）
  camera.position.set(camTarget.x + ox + Math.sin(camYaw) * back, Math.sin(CAM_PITCH) * cd, camTarget.z + Math.cos(camYaw) * back + oz);
  const mm = $('minimap'), mmKey = mm.classList.contains('hidden') ? 'off' : `${view.yaw}|${mm.offsetWidth}|${innerWidth}`;
  if (minimapYaw !== mmKey) {   // 小地圖跟著轉（上方 = 鏡頭正前方）；指北針貼在小地圖的框上、指著北邊
    minimapYaw = mmKey;
    mm.style.transform = view.yaw ? `rotate(${view.yaw}rad)` : '';
    const r = mm.offsetWidth / 2, [nx, ny] = w2s(0, -1);
    northMark.style.left = `${mm.offsetLeft + r + nx * (r - 2) - 7}px`; northMark.style.top = `${mm.offsetTop + r + ny * (r - 2) - 8}px`;
    northMark.classList.toggle('hidden', mmKey === 'off');
  }
  camera.lookAt(camTarget.x + ox, 0, camTarget.z + oz);
  lastCd = cd; camLook.set(camTarget.x + ox, 0, camTarget.z + oz);
  sun.position.set(camTarget.x - 8, 22, camTarget.z + 6);
  sun.target.position.set(camTarget.x, 0, camTarget.z);

  if (playing && !watching) updateHud();
  updateReticle(playing && !watching && player.alive && !garage.open && !G.paused && !panelOpen() && input.source === 'mouse' && MODE.name !== 'menu');
  if (MODE.name === 'endless') updateEndlessHud();
  if (MODE.name === 'explore' && EX) { updateFog(raw, player.x, player.z); fogVisibility(dt); updateExploreHud(); updateMinimap(raw, player, enemies, EX.squads.filter(S => S.layer === EX.layer), EX); }
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
  updateHaze(raw, camTarget.x, camTarget.z);
  // 零件工坊（src/workshop.js）：自己的場景和鏡頭
  if (workshopOpen()) { hideMech(scene, player?.model.root); updateWorkshop(raw); renderFrame(wsScene, wsCam); return; }
  // 主選單、整備：畫展示空間（src/showroom.js），機體搬過去
  const showOn = (MODE.name === 'menu' || garage.open) && !!player;
  if (showOn) {
    const panelPx = garage.open ? Math.min(820, innerWidth * 0.66) : $('menu').classList.contains('hidden') && $('duel').classList.contains('hidden') ? 0 : Math.min(560, innerWidth * 0.5);
    showMech(player.model.root); updateShowroom(raw, player.x, player.z, panelPx);
  } else hideMech(scene, player?.model.root);
  renderFrame(showOn ? showScene : scene, showOn ? showCam : camera);   // 模型桌後製（src/post.js），O 鍵開關
}
addEventListener('pointerdown', unlockAudio);
// 面板上的按鈕可以用數字鍵選（1 = 第一個）
addEventListener('keydown', e => { if (panelOpen() && !settingsOpen() && /^Digit[1-9]$/.test(e.code)) $('pButtons').children[+e.code.slice(5) - 1]?.click(); });
addEventListener('keydown', unlockAudio);
window.__dbg = { get player() { return player; }, enemies, mechs, AI, G, input, sensors, MODE, startDuel, startSandbox, startWatch, startHorde, startSkirmish, startEndless, startRun, startStage, callReinforcements, warpOut, startBoss, useLink, switchLayer, props, get EN() { return EN; }, get EX() { return EX; }, showMenu, paused: false };
showMenu();
camTarget.set(player.x, 0, player.z);
nextFrame(frame);
