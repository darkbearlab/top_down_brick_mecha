import * as THREE from 'three';
import { sfx, unlockAudio } from './audio.js';
import { CAM_PITCH, G, camDist, camTarget, camera, renderer, scene, sun } from './core.js';
import { clearPressed, input, updateInput } from './input.js';
import { arenaMap, loadMap, mapId, randomOpenSpot, rayBlock, tileC, tileR } from './arena.js';
import { THEMES, genWorld } from './mapgen.js';
import { hideMinimap, initMinimap, updateMinimap } from './minimap.js';
import { ENEMY_COLORS, PLAYER_COLORS, activeSlot, collideMechs, driveMech, facing, makeMech, mechs, poseMech, removeMech, toggleReady, tryBoost, wantsLock } from './mech.js';
import { ARENA_LAYOUT, resetBuildings, setLayout, updateBuildings } from './buildings.js';
import { SLOW_K, clearWrecks, killCam, updateWrecks } from './wreck.js';
import { clearShots, makeGuns, updateGuns, updateShots } from './weapons.js';
import { AI, DIFFS, clearEnemies, enemies, keepEnemies, removeEnemy, spawnEnemy, updateEnemy } from './ai.js';
import { makeLaser, setLaser, updateParticles } from './fx.js';
import { ARMORS, DMG_TYPES, ENEMY_PRESETS, GRUNTS, GRUNTS_LOW, LEGS, SLOTS, SLOT_KEYS, SQUADS, WEAPONS, gruntOf, loadLoadout, pickSquad, randomGrunt, randomLoadout } from './parts.js';
import { clearPickups, spawnPickup, updatePickups } from './pickups.js';
import { sensors, setSensorsVisible, updateSensors } from './sensors.js';
import { closeGarage, garage, openGarage } from './garage.js';

const $ = id => document.getElementById(id);

// ---------- 模式 ----------
// menu：主選單（機體站在場中間、鏡頭慢慢繞）
// duel：一對一，打倒對手或被打倒就結束
// sandbox：試玩場，敵機一開始停火（T 切換），被打爆會自動重生
// endless：無盡模式，雜魚越來越多越來越強，打爆會掉彈藥 / 修理 / 強化模組，撐越久越好（被打爆就結束）
// explore：探索，大地圖（mapgen.js）上清掉散在各區域的遭遇小隊
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
  player.dmgMul = 1; player.rateMul = 1; player.lockMul = 1;
  player.onDeath = () => {
    if (MODE.name === 'duel' || MODE.name === 'endless' || MODE.name === 'explore') { MODE.endT = 3.4; MODE.result = 'lose'; }
    else { respawnT = 2.5; toast('機體損毀'); }
  };
  return player;
}
const guide = makeLaser(0x7ff0ff);

// map：要用的地圖（不給 = 競技場）；換了才重新載入
const ARENA = arenaMap();
function resetWorld(map = null) {
  clearEnemies();
  const want = map ?? ARENA;
  if (mapId !== want.id) { loadMap(want); setLayout(map ? map.buildings : ARENA_LAYOUT); }
  hideMinimap();
  clearShots();
  G.paused = false; G.slowMo = 0; G.hitStop = 0;
  clearWrecks();
  clearPickups();
  resetBuildings();
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
  updatePickups(dt, player, takePickup);
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
function takePickup(kind) {
  const p = player;
  if (kind === 'ammo') {
    let any = false;
    for (const s in p.guns) { const g = p.guns[s]; if (g.max === Infinity || g.ammo >= g.max) continue; g.ammo = Math.min(g.max, g.ammo + Math.ceil(g.max * 0.3)); any = true; }
    if (!any) return false;
    toast('彈藥補給'); sfx.reload();
  } else if (kind === 'repair') {
    let any = false;
    for (const k in p.parts) { const q = p.parts[k]; if (q.broken || q.hp >= q.max) continue; q.hp = Math.min(q.max, q.hp + q.max * 0.25); any = true; }
    if (!any) return false;
    toast('機體修理 +25%'); sfx.lock();
  } else {
    const keys = Object.keys(MODS), k = keys[Math.floor(Math.random() * keys.length)];
    MODS[k].apply(p);
    EN.mods[k] = (EN.mods[k] ?? 0) + 1;
    toast(`強化模組：${MODS[k].name}（${MODS[k].desc}）`); sfx.lock();
  }
}
function updateExploreHud() {
  const zc = Math.floor(tileC(player.x) / 64), zr = Math.floor(tileR(player.z) / 64), Z = EX.map.zones[zr * 4 + zc];
  $('enTime').textContent = mmss(EN.t);
  $('enInfo').textContent = `清除 ${EX.cleared} / ${EX.squads.length} 隊・擊破 ${EN.kills}・${Z ? THEMES[Z.theme] + (Z.depth > 0 ? `（深度 ${Z.depth}）` : '（出發區）') : ''}`;
  const mods = Object.entries(EN.mods).map(([k, n]) => `<span class="wt" style="--c:#c080ff">${MODS[k].name}${n > 1 ? ' ×' + n : ''}</span>`).join('');
  if (EN.modsHtml !== mods) { EN.modsHtml = mods; $('enMods').innerHTML = mods; }
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
// ---------- 探索模式 ----------
// 大地圖（mapgen.js）：岩壁把地圖切成 12 個區域、靠隘口相連；每個區域 2～3 個遭遇點，各駐守一支小隊（parts.js SQUADS）
// 小隊平常待命不動；玩家進到 WAKE_R 格內而且看得到、或有人被打 → 整隊醒來；全部離玩家超過 LOSE_R 格 → 跟丟、回到待命
// 效能：離玩家 SPAWN_R 格內才生出來，待命中離開 DESPAWN_R 格就先收起來（記住剩多少血、死了哪幾台）
// 越深的區域（穿過越多隘口）：多一台、傷害和耐久越高；清掉一隊掉一個模組和一個修理；全部清掉就過關
const SPAWN_R = 58, DESPAWN_R = 72, WAKE_R = 24, LOSE_R = 50, FOUND_R = 34;
let EX = null;
function exDiff(depth) {
  const D = DIFFS.easy, L = depth * 0.6;
  return { ...D, dmg: D.dmg * (1 + 0.2 * L), hp: D.hp * (1 + 0.15 * L), rest: Math.max(1.2, D.rest - 0.12 * L), err: Math.max(0.05, D.err - 0.02 * L) };
}
function startExplore(seed) {
  const map = genWorld(seed);
  resetWorld(map);
  MODE.name = 'explore';
  AI.sandbox = false; AI.passive = false; AI.diff = DIFFS.easy;
  spawnPlayer(map.spawn.x, map.spawn.z, Math.PI / 2);
  EN = { t: 0, kills: 0, mods: {}, best: 0, explore: true };
  EX = {
    map, cleared: 0,
    squads: map.sites.map(S => {
      const key = pickSquad(S.theme, S.depth), D = SQUADS[key];
      const units = [...D.units, ...(S.depth >= 2 ? [D.units[D.units.length - 1]] : [])];
      return { ...S, key, name: D.name, units: units.map(k => ({ key: k, hp: null, dead: false })), members: [], awake: false, found: false, cleared: false };
    }),
  };
  initMinimap(map.buildings);
  showHud();
  $('endless').classList.remove('hidden');
  toast(`探索・${EX.squads.length} 支小隊散在各區域`);
}
function spawnSquad(S) {
  S.members = [];
  S.units.forEach((u, i) => {
    if (u.dead) return;
    const a = i / S.units.length * Math.PI * 2, at = { x: S.x + Math.sin(a) * 1.8, z: S.z + Math.cos(a) * 1.8 };
    const e = spawnEnemy({ x: at.x + Math.sin(a), z: at.z + Math.cos(a) }, gruntOf(u.key), at, { colors: GRUNT_COLORS, diff: exDiff(S.depth), grunt: true, noDrop: true });
    e.dormant = !S.awake; e.squad = S; e.unit = u; e.enElite = u.key.endsWith('*');
    if (u.hp != null) e.parts.torso.hp = Math.min(u.hp, e.parts.torso.max);
    S.members.push(e);
  });
}
function despawnSquad(S) {
  for (const e of S.members) if (e.alive) { e.unit.hp = e.parts.torso.hp; removeEnemy(e); }
  S.members = [];
}
function updateExplore(dt) {
  if (!EX || MODE.result) return;
  EN.t += dt;
  for (const S of EX.squads) {
    if (S.cleared) continue;
    const d = Math.hypot(S.x - player.x, S.z - player.z);
    if (d < FOUND_R) S.found = true;
    if (!S.members.length) { if (d < SPAWN_R) spawnSquad(S); continue; }
    if (!S.awake && d > DESPAWN_R) { despawnSquad(S); continue; }
    if (!player.alive) continue;
    const live = S.members.filter(e => e.alive);
    if (!S.awake) {
      const trig = live.some(e => {
        if (e.parts.torso.hp < e.parts.torso.max - 0.01) return true;
        const dx = player.x - e.x, dz = player.z - e.z, dd = Math.hypot(dx, dz);
        return dd < WAKE_R && rayBlock(e.x, e.z, dx / dd, dz / dd, dd) >= dd - player.r;
      });
      if (trig) { S.awake = S.found = true; for (const e of live) e.dormant = false; toast(`遭遇：${S.name}`); sfx.lock(); }
    } else if (live.length && live.every(e => Math.hypot(e.x - player.x, e.z - player.z) > LOSE_R)) {
      S.awake = false; for (const e of live) e.dormant = true;
    }
  }
  updatePickups(dt, player, takePickup);
}
function exploreKill(e) {
  EN.kills++; enLoot(e);
  const S = e.squad;
  if (!S) return;
  e.unit.dead = true;
  if (!S.units.every(u => u.dead)) return;
  S.cleared = true; S.awake = false; EX.cleared++;
  spawnPickup('mod', e.x, e.z); spawnPickup('repair', e.x, e.z);
  toast(`${S.name} 已清除（${EX.cleared} / ${EX.squads.length}）`);
  if (EX.cleared >= EX.squads.length) { MODE.result = 'win'; MODE.endT = 3; }
}
function showExploreResult(win) {
  G.paused = true;
  sfx.click();
  const mods = Object.entries(EN.mods).map(([k, n]) => `${MODS[k].name}${n > 1 ? ' ×' + n : ''}`).join('、') || '無';
  showPanel(win ? '全區域清除' : '機體損毀', `${mmss(EN.t)}・清除 <b>${EX.cleared} / ${EX.squads.length}</b> 隊・擊破 <b>${EN.kills}</b> 台<br>強化：${mods}`, [
    { label: '同一張地圖再來', primary: true, run: () => startExplore(EX.map.seed) },
    { label: '新地圖', run: () => startExplore() },
    { label: '整備', run: () => { hidePanel(); openGarageFrom('result'); } },
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
AI.onEnemyDeath = (e) => {
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
function restart() { MODE.name === 'explore' ? startExplore(EX.map.seed) : MODE.name === 'endless' ? startEndless() : MODE.name === 'duel' ? startDuel(MODE.duel.preset, MODE.duel.diffKey) : MODE.name === 'watch' ? nextWatch() : startSandbox(); }
const WATCH_LIMIT = 180;   // 觀戰一場最多幾秒（遊戲時間）
const nextWatch = () => MODE.kind === 'horde' ? startHorde() : MODE.kind === 'skirmish' ? startSkirmish() : startWatch();
function pause() {
  G.paused = true;
  showPanel('暫停', MODE.name === 'explore' ? `探索・${mmss(EN.t)}・清除 ${EX.cleared} / ${EX.squads.length} 隊・地圖 #${EX.map.seed}` : MODE.name === 'endless' ? `無盡模式・${mmss(EN.t)}・擊破 ${EN.kills}` : MODE.name === 'duel' ? `對戰・${DIFFS[MODE.duel.diffKey].name}` : MODE.name === 'watch' ? `觀戰${MODE.kind === 'horde' ? '（王牌 vs 雜魚）' : MODE.kind === 'skirmish' ? '（雜魚 vs 雜魚）' : ''}・第 ${MODE.round} 場` : '試玩場', [
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
<b>鎖定</b>敵機永遠看得到。地上淡淡的扇形是頭的鎖定範圍，架起飛彈後扇形裡（或準星附近）的敵機會慢慢鎖上；頭被打掉還能鎖，只是範圍變小</div>`;

// ---------- 主選單與對戰設定 ----------
$('mDuel').onclick = () => { unlockAudio(); sfx.click(); openDuelSetup(); };
$('mExplore').onclick = () => { unlockAudio(); sfx.click(); startExplore(); };
$('mEndless').onclick = () => { unlockAudio(); sfx.click(); startEndless(); };
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
  if (g.ammo <= 0) return '<span class="bad">彈盡</span>';
  if (m.deployT[slot.slice(-1)] > 0 && activeSlot(m, slot.slice(-1)) === slot) return '展開中';
  if (g.def.energy) return m.energy < g.def.energy ? '<span class="bad">能量不足</span>' : g.cd > 0 ? '冷卻' : '就緒';
  if (g.def.needLock && !sensors.locks.length) return '需要鎖定';
  return g.def.ammo ? `${g.ammo}/${g.max}` : g.cd > 0 ? '冷卻' : '就緒';
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
  $('warn').textContent = [p.staggerT > 0 && '失衡！', S.loadK > 1 && '超重', S.armOver && '手臂超重', S.backOver && '背部超重', p.parts.head.broken && '頭部損毀：鎖定距離縮短'].filter(Boolean).join('・');
  // 準星附近、看得到的敵機；對戰中一直顯示對手
  let best = null, bd = MODE.name === 'duel' ? Infinity : 6;
  for (const e of enemies) {
    if (!e.alive || e.drop) continue;
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
let lockZoom = 1, lastCd = 30;
const camLook = new THREE.Vector3(), extRay = new THREE.Raycaster(), groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), extV = new THREE.Vector3();
function viewExtents() {
  const out = {};
  // 上下留比較多：下方有狀態欄、上方有提示
  for (const [k, x, y] of [['r', 0.9, 0], ['l', -0.9, 0], ['t', 0, 0.82], ['b', 0, -0.72]]) {
    extRay.setFromCamera({ x, y }, camera);
    if (!extRay.ray.intersectPlane(groundPlane, extV)) { out[k] = 0.3; continue; }
    out[k] = (k === 'r' || k === 'l' ? Math.abs(extV.x - camLook.x) : Math.abs(extV.z - camLook.z)) / lastCd;
  }
  return out;
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
  if (input.garagePressed && !watching && MODE.name !== 'endless' && MODE.name !== 'explore') { if (garage.open) leaveGarage(); else if (playing && !panelOpen()) openGarageFrom('play'); }
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
    if (MODE.name === 'endless') updateEndless(dt);
    if (MODE.name === 'explore') updateExplore(dt);
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
    if (MODE.endT > 0 && (MODE.endT -= raw) <= 0) watching ? nextWatch() : MODE.name === 'endless' ? showEndlessResult() : MODE.name === 'explore' ? showExploreResult(MODE.result === 'win') : showResult(MODE.result === 'win');
  }
  if (!playing || dt > 0 || garage.open) updateParticles(playing ? dt : raw);
  for (const m of mechs) poseMech(m, dt);
  if (!playing) { player.torsoYaw = player.legYaw = G.now * 0.25; poseMech(player, 0); }
  clearPressed();

  // 瞄準線：從上半身正前方射出
  if (playing && !watching && player.alive && !garage.open) {
    const f = facing(player), ox = player.x + f.x * 0.9, oz = player.z + f.z * 0.9;
    const len = rayBlock(ox, oz, f.x, f.z, 22);
    setLaser(guide, ox, oz, f.x, f.z, len, 1.4, 0.3, 0.03);
  } else guide.g.visible = false;

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
    if (input.source === 'pad') { dx = input.padAim.x; dz = input.padAim.y; }
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
  lastCd = cd; camLook.set(camTarget.x + ox, 0, camTarget.z + oz);
  sun.position.set(camTarget.x - 8, 22, camTarget.z + 6);
  sun.target.position.set(camTarget.x, 0, camTarget.z);

  if (playing && !watching) updateHud();
  if (MODE.name === 'endless') updateEndlessHud();
  if (MODE.name === 'explore' && EX) { updateExploreHud(); updateMinimap(raw, player, enemies, EX.squads); }
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
window.__dbg = { get player() { return player; }, enemies, mechs, AI, G, input, sensors, MODE, startDuel, startSandbox, startWatch, startHorde, startSkirmish, startEndless, startExplore, get EN() { return EN; }, get EX() { return EX; }, showMenu, paused: false };
showMenu();
camTarget.set(player.x, 0, player.z);
nextFrame(frame);
