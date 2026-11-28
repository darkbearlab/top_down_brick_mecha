// ---------- 據點戰（docs/CONQUEST_PLAN.md）：3 對 3 主力機 + 九座蟲巢 + 野怪營地（全 AI 觀戰） ----------
// 地圖：blockgen.js conquestArena（152 × 112，點對稱，整張圖是一張通道網、沒有死路），大本營在左上（藍）/ 右下（紅），上 / 中 / 下三路 + 叢林小徑
// 據點 = 蟲巢：開場被原生的蟲族守著（隊伍 native，敵視雙方、不會重生）；守衛全滅 → 蟲巢被壓制，可以佔領、收割
// 巢穴種類：
//   母巢（正中央）、增援巢：增援條累積速度；條滿了 → 一波增援：三條線（LANES）各一隊，沿著自己那條線一座一座打過去，整條線拿下就去打對面大本營
//   甲殼巢：全隊承受傷害 ×0.88、酸腺巢：全隊傷害 +12%、神經巢：全隊極速 +8%、發光巢：全隊能量回復 +30%（每多一座再疊一次）
// 野怪營地（CQ_CAMPS，6 個）：叢林小徑中間兩隻蟲，雜魚和營地的蟲互不理會（只有主力機會去清）；整個營地清掉 → 最後一擊那一隊的所有主力機拿 45 秒的效果（狂暴：傷害 +20%；迅捷：極速 +15%、能量回復 +50%），
//   那一隊的增援條 +12%；75 秒後蟲子重新長出來；效果期間營地的圈 = 那一隊的顏色
// 增援據點（OUTPOSTS，左下 / 右上角，2026-11-28）：四隻蟲守著；清掉 → 最後一擊那一隊接下來 60 秒每 14 秒從據點冒出一隊雜魚，據點上立一座增援信標（固定砲塔）；
//   對面打掉信標 = 增援提早停止；停止後（時間到或被打掉）45 秒蟲子重新長回來，要再清一次
// 階段（S.tier，2026-11-28）：開場第 1 階；擊破對方主力機拿「強度權重」（parts.js CQ_ACES pw）當進度，進度條滿（CQ.tierNeed）升一階
//   → 開放下一階的主力機配裝（CQ_ACES tier）、增援的雜魚直接換成那一階的世代（GENS：1 階初期型、2 階現行、3 階次世代）
//   3 階再滿一次 → 叫一波超級小兵（3 台 1 階的主力機配裝、耐久 ×0.75，像雜魚一樣去搶巢），進度歸零重來
//   被擊破的主力機重組時間 ×(0.6 + 0.4 × pw)：強的機體死了要等比較久（平衡）
// 佔領：站在圈裡讀條（主力 1、雜魚 0.5，最快 ×1.5）；兩邊都有人 = 暫停；對方的據點要先讀回中立再讀成自己的
// 勝負：持有的巢穴每秒得分（母巢 ×2），先到 600 分，或 12 分鐘到時分數高的贏；大本營被打爆 = 直接敗北
// 主力機損毀 → 重組（4 秒 + 每多死一次 1 秒，最多 8），從大本營空降；不放擊墜特寫（G.noKillCam）
//   重組時調整陣容（counterPick）：照對面主力機的裝甲挑剋得住的配裝
// 大本營：要塞砲車（parts.js ELITES，遠征停用的據點防守機），耐久 ×2.5、綁在大本營 9 格內不追出去、不會重組
//   大本營 12 格內的己方機體（要塞自己除外）：部位每秒回 8%、壞掉的部位重新長回來（25%）、彈藥每秒回 6%
// 主力機、要塞腳下有派系色的光環，裝甲混一點隊伍色
// 落後方（分數差 60 以上）：重組、增援條 ×0.8 時間
// AI：隊伍指揮每 2 秒替每台主力機挑一個目標（巢穴 / 營地：價值 ÷ 距離、分散、回防）；目標有效就至少守 15 秒、到了就做完（不跳來跳去）；
//   受傷 / 斷武器 / 沒彈藥 → 回大本營整備（needsRepair / repaired）；附近 24 格（雜魚 18 格）沒有看得到的敵人 → 照路線走去目標，有 → 照原本的戰術打
// 主力機（2026-11-28 重做，docs/CONQUEST_MECH_REVIEW.md）：配裝池 = parts.js CQ_ACES（15 套，每套有 role）；開場和重組都用 counterPick（剋對面裝甲 + 擋得住對面火力 + 隊伍缺的角色）
//   指揮照 role 派任務（roleK）：清蟲機先打有守衛的巢、佔點 / 奪點機去讀條、打野機去營地、修理機跟著隊友、攻城機晚場打對面大本營
//   到了可以讀條的巢穴 → 綁在圈裡打；清蟲機 30 格外就把整窩叫醒（先手）；路線繞太遠就打穿建築開捷徑（breach）；主動裝置照情況用（aceDevice）
//   回營：軀幹 < 40%（旁邊有修理機 < 25%）、腳壞了、或剩下的火力 < 40%（主力武器打光、拿武器的手斷了）
// 戰績（S.stats）：每台主力機的擊墜 / 損毀 / 佔領 / 營地；隊伍的雜魚擊破、空投（main.js 的 Tab 總覽）
import * as THREE from 'three';
import { G, addMat, scene } from './core.js';
import { H as MAP_H, W as MAP_W, grid, gridVer, isSolid, rayBlock } from './arena.js';
import { isBuilding } from './buildings.js';
import { updateDeviceCd, useDevice, deviceReady } from './devices.js';
import { hasModule, mechs, syncWear } from './mech.js';
import { DIFFS, breakPow, breakReach, enemies, removeEnemy, spawnEnemy } from './ai.js';
import { CQ_ACES, EFFECT, ELITES, SQUADS, WEAPONS, fireTime, gruntOf } from './parts.js';
import { DEVICES, inSmoke, smokeHides } from './tech.js';
import { burst, repairFx, spawnPuff } from './fx.js';
import { packUnits } from './heavy.js';
import { routeDir, routeDist } from './pathing.js';
import { CQ_CAMPS, CQ_NODES } from './blockgen.js';

export const CQ = {
  winScore: 600, timeLimit: 720, capT: 6, nodeR: 4.5, scoreRate: 0.35, gruntCap: 18,
  reinforceT: 100,   // 增援條：什麼巢都沒有 100 秒滿一次；每座增援巢 +0.6 倍速、母巢 +1.3（2026-11-28 從 +1 / +2 放緩）；滿了 = 一波（每條線一隊）
  reinforceHive: 0.6, reinforceCore: 1.3,
  outpostHpK: 1.25, outpostDmgK: 1.1,   // 增援據點冒出來的小兵：再強一點（疊在世代上面）
  respawn: 4, respawnAdd: 1, respawnMax: 8, behindGap: 60, behindK: 0.8,
  engageAce: 24, engageGrunt: 18, bugWake: 20, bugHold: 8,
  fortHpK: 2.5, fortHold: 9, healR: 12, healK: 0.08, ammoK: 0.06,
  campHold: 5, campWake: 13, campRespawn: 75, campBuffT: 45, campBar: 0.12,
  dropSquads: ['patrol', 'missile', 'breakers', 'gunline', 'hunters'],
  tierNeed: { 1: 3, 2: 5, 3: 6 },   // 每一階的進度條長度（權重）；3 階滿 = 一波超級小兵
  supHpK: 0.75, supW: 0.5,         // 超級小兵：耐久倍率；被擊破時給對面的權重 = 配裝 pw × 0.5
  outpostT: 60, outpostDrop: 14, outpostRegrow: 45, beaconHpK: 3,
};
// 每一階空投的小隊（3 階多了裝甲小隊：戰車 + 機砲兵）
const DROPS = { 1: ['patrol', 'hunters', 'missile'], 2: CQ.dropSquads, 3: ['patrol', 'missile', 'breakers', 'gunline', 'armor'] };
// 雜魚的世代（label = 顯示名稱；name 不能改：有自訂身體的機種照 name 找外型）（照 heavy.js 新數值的機種改）：1 階初期型（低階武器、耐久 ×0.85、傷害 ×0.9）、2 階現行、3 階次世代（多一門武器 / 更好的頭腳、耐久 ×1.3、傷害 ×1.1）
const GENS = {
  1: { hpK: 0.85, dmgK: 0.9, units: {
    scout: { label: '初期巡邏兵', armR: 'mg_l', backL: null },
    trooper: { label: '初期機砲兵', armR: 'autocannon_l', backL: 'missile_l' },
    brawler: { label: '初期突擊兵', armL: 'saber_l', armR: 'shotgun_l' },
    marksman: { label: '初期射手', armR: 'sniper_l' },
    charger: { label: '初期衝鋒機' },
    gun: { label: '初期砲車', backR: 'cannon_l' },
  } },
  3: { hpK: 1.3, dmgK: 1.1, units: {
    scout: { label: '次世代巡邏兵', head: 'hunter', legs: 'reverse', backR: 'missile' },
    trooper: { label: '次世代飛彈兵', head: 'radar', backL: 'vmissile' },
    brawler: { label: '次世代突擊兵', backL: 'rocket' },
    marksman: { label: '次世代射手', backL: 'missile' },
    charger: { label: '次世代衝鋒機' },
    gun: { label: '次世代砲車', armR: 'autocannon' },
    tank: { label: '次世代戰車', armR: 'autocannon' },
  } },
};
const OUTPOSTS = [{ x: -60, z: 40 }, { x: 60, z: -40 }];   // 左下、右上（點對稱）
// 三條線上的巢穴（blockgen.js CQ_NODES 的編號，照從自己大本營出發的順序），走完 → 對面大本營
//   0 母巢 (0,0)；1 / 4 增援巢 (∓30,∓22)；2 / 5 酸腺巢 (∓10,∓46)；3 / 6 甲殼巢 (∓62,0)；7 神經巢 (30,-44)；8 發光巢 (-30,44)
//   藍（左上）：上路 酸腺 → 神經 → 對面甲殼（經過右上增援據點）、中路 增援 → 母巢 → 對面增援、下路 甲殼 → 發光 → 對面酸腺（經過左下增援據點）；紅 = 點對稱
const LANES = { blue: [[2, 7, 6], [1, 0, 4], [3, 8, 5]], red: [[5, 8, 3], [4, 0, 1], [6, 7, 2]] };
// 巢穴種類：value = 隊伍指揮眼中的價值；guards = 守衛小隊
export const HIVES = {
  core: { name: '母巢', short: '母', desc: '增援條 +1.3 倍速・得分 ×2', value: 1.5, guards: ['hive', 'stampede'], sac: 0xff60ff },
  reinforce: { name: '增援巢', short: '援', desc: '增援條 +0.6 倍速', value: 1.15, guards: ['hive'], sac: 0xffd040 },
  armor: { name: '甲殼巢', short: '甲', desc: '全隊承受傷害 ×0.88', value: 1, guards: ['stampede'], sac: 0x60a0ff },
  attack: { name: '酸腺巢', short: '攻', desc: '全隊傷害 +12%', value: 1, guards: ['hive'], sac: 0xb8ff40 },
  speed: { name: '神經巢', short: '速', desc: '全隊極速 +8%', value: 0.9, guards: ['swarm'], sac: 0x40fff0 },
  energy: { name: '發光巢', short: '能', desc: '全隊能量回復 +30%', value: 0.9, guards: ['swarm'], sac: 0xffffff },
};
// 野怪營地：units 兩隻蟲、buff = 最後一擊那台拿到的效果
export const CAMPS = {
  rage: { name: '狂暴', units: ['needler', 'gunner'], buff: { dmg: 0.2 }, hex: 0xff5040, css: '#ff7060' },
  haste: { name: '迅捷', units: ['lancer', 'needler'], buff: { speed: 0.15, regen: 0.5 }, hex: 0x40e0ff, css: '#60e0ff' },
  outpost: { name: '增援據點', units: ['needler', 'gunner', 'lancer', 'needler'], hex: 0xffd040, css: '#ffd060' },
};
const TEAMS = ['blue', 'red'];
const TEAM_NAME = { blue: '藍隊', red: '紅隊' };
const COLORS = {
  blue: { accent: 0x3a8cff, glow: 0x90c0ff, tint: 0.45 },
  red: { accent: 0xff5a30, glow: 0xffa080, tint: 0.45 },
  bluegrunt: { accent: 0x2a5ab8, glow: 0x50a8ff, tint: 0.78 },
  redgrunt: { accent: 0xa8321a, glow: 0xff5a30, tint: 0.78 },
  native: { accent: 0x5a4a2a, glow: 0xb8ff40, tint: 0.6 },
};
const HEX = { blue: 0x4a9aff, red: 0xff6a3a, native: 0xa0d040, none: 0x9aa0aa };
export const CSS = { blue: '#6aaaff', red: '#ff7a40', native: '#a8d040', none: '#9aa0aa' };

let S = null;   // 這一場的狀態
// 每種配裝的戰績（模擬比較配裝用）：上場秒數、擊墜、被擊墜、佔領、營地、打掉的雜魚 / 蟲
const loStat = e => { const n = e.cq.lo.name; let r = S.lo.get(n); if (!r) S.lo.set(n, r = { t: 0, k: 0, d: 0, cap: 0, camp: 0, gk: 0, bk: 0 }); return r; };
export const cqState = () => S;

// 蟲巢的樣子：土丘 + 發光的卵囊（顏色 = 種類）；地上一圈（顏色 = 持有方）+ 讀條的內圈
const MOUND = new THREE.BoxGeometry(1, 1, 1), RING = new THREE.RingGeometry(CQ.nodeR - 0.25, CQ.nodeR, 48), DISC = new THREE.CircleGeometry(CQ.nodeR - 0.3, 48);
const CAMP_RING_BG = new THREE.RingGeometry(2.5, 2.95, 48);
function buildNode(n) {
  const g = new THREE.Group(), big = n.type === 'core' ? 1.4 : 1;
  const dirt = new THREE.MeshLambertMaterial({ color: 0x4a3a2a }), sac = addMat(HIVES[n.type].sac, 0.9);
  const mounds = [], sacs = [];
  for (const [x, z, w, h, d] of [[0, 0, 2.2, 0.9, 2.2], [0.3, -0.2, 1.4, 1.5, 1.3], [-0.5, 0.6, 1, 0.7, 1], [0.9, 0.8, 0.8, 0.5, 0.9], [-0.8, -0.7, 0.9, 0.6, 0.8]]) {
    const m = new THREE.Mesh(MOUND, dirt); m.scale.set(w * big, h * big, d * big); m.position.set(x * big, h * big / 2, z * big); g.add(m); mounds.push(m);
  }
  for (const [x, y, z] of [[0.6, 1.1, 0.3], [-0.3, 1.4, -0.4], [-0.7, 0.75, 0.6], [1.1, 0.55, 1]]) {
    const m = new THREE.Mesh(MOUND, sac); m.scale.setScalar(0.32 * big); m.position.set(x * big, y * big, z * big); g.add(m); sacs.push(m);
  }
  n.sacMat = sac;
  const ring = new THREE.Mesh(RING, addMat(HEX.native, 0.75)); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; g.add(ring);
  const disc = new THREE.Mesh(DISC, addMat(HEX.blue, 0.22)); disc.rotation.x = -Math.PI / 2; disc.position.y = 0.04; disc.scale.setScalar(0.001); g.add(disc);
  g.position.set(n.x, 0, n.z);
  scene.add(g);
  Object.assign(n, { g, ring, disc, big, collapse: null });
  for (const m of [...mounds, ...sacs]) m.userData.h0 = { y: m.position.y, sy: m.scale.y, sx: m.scale.x };
  n.mounds = mounds; n.sacs = sacs;
}
// 第一次被佔領：巢體塌掉（土丘壓扁、卵囊掉到地上），免得看起來像能躲的掩體（本來就不擋子彈）
function startCollapse(n) {
  if (n.collapse) return;
  n.collapse = { t: 0 };
  const b = n.big;
  burst(n.x, 0.8 * b, n.z, [0x4a3a2a, 0x6a5440, 0x2e241a], 26, 5);
  burst(n.x, 1 * b, n.z, [HIVES[n.type].sac, 0x40301a], 10, 4);
  for (let i = 0; i < 10; i++) { const a = Math.random() * Math.PI * 2, r = Math.random() * 1.6 * b;
    spawnPuff({ x: n.x + Math.cos(a) * r, y: 0.3, z: n.z + Math.sin(a) * r, vx: Math.cos(a) * 1.2, vy: 0.6 + Math.random() * 0.6, vz: Math.sin(a) * 1.2, life: 1 + Math.random() * 0.8, s: 0.5 + Math.random() * 0.4, c0: 0x6a5a48, c1: 0x3a3028, drag: 2 }); }
}
function animCollapse(n, dt) {
  const C = n.collapse;
  if (!C || C.t >= 1) return;
  C.t = Math.min(1, C.t + dt / 0.9);
  const k = C.t * C.t;   // 越塌越快
  for (const m of n.mounds) { const h = m.userData.h0, sy = h.sy * (1 - 0.85 * k); m.scale.y = sy; m.scale.x = m.scale.z = h.sx * (1 + 0.25 * k); m.position.y = sy / 2; }
  for (const m of n.sacs) { const h = m.userData.h0; m.position.y = h.y + (0.12 - h.y) * k; m.scale.y = h.sy * (1 - 0.5 * k); }
}
// 營地 / 增援據點：地上一圈（灰底 + 一段彩色的弧，c.ph 決定）
//   live：蟲在 → 整圈是種類的顏色
//   held：被 A 隊拿下 → A 隊的顏色從正上方順時針轉一圈填滿（0.6 秒），接著照效果剩下的時間順時針消退成灰色（全灰 = 效果結束）
//   regrow：蟲族的綠色從正上方順時針慢慢填滿，填滿時蟲子從地下爬出來
const CAMP_R0 = 2.5, CAMP_R1 = 2.95, FILL_T = 0.6, TOP = Math.PI / 2;
function buildCamp(c) {
  const g = new THREE.Group();
  const bg = new THREE.Mesh(CAMP_RING_BG, addMat(0x5a6068, 0.4));
  const arc = new THREE.Mesh(new THREE.RingGeometry(CAMP_R0, CAMP_R1, 48), addMat(CAMPS[c.kind].hex, 0.7));
  for (const m of [bg, arc]) { m.rotation.x = -Math.PI / 2; g.add(m); }
  bg.position.y = 0.04; arc.position.y = 0.05;
  if (c.outpost) g.scale.setScalar(1.6);
  g.position.set(c.x, 0, c.z);
  scene.add(g);
  Object.assign(c, { g, arc, arcKey: null, ph: { kind: 'live' } });
}
// 弧：從角度 a0 開始逆時針 len（three.js 的角度；俯視時逆時針 = 畫面上逆時針）；量化過、變了才重做幾何
// frac：弧佔一圈多少；drain = false：弧從正上方往順時針長出去（填滿）；true：弧的尾端固定在正上方、灰色從正上方順時針吃掉它
//   先把長度量化（1/96 圈）再算起點：以前起點用沒量化的長度算 → 量化後的端點每幀差一點點，正上方那一端來回抽
function setArc(c, frac, hex, drain = false) {
  const q = Math.round(Math.max(0, Math.min(1, frac)) * 96), F = Math.PI * 2, L = q / 96 * F, key = `${q}:${drain}`;
  c.arc.material.color.setHex(hex);
  c.arc.visible = q > 0;
  if (key === c.arcKey || q <= 0) return;
  c.arcKey = key;
  c.arc.geometry.dispose();
  c.arc.geometry = new THREE.RingGeometry(CAMP_R0, CAMP_R1, Math.max(3, q / 2 | 0), 1, drain ? TOP - F : TOP - L, L);
}
function drawCamp(c) {
  const P = c.ph;
  if (P.kind === 'live') return setArc(c, 1, HEX.native);   // 蟲在（還沒被拿下）：綠色
  const el = S.t - P.t0;
  if (P.kind === 'held') {
    if (el < FILL_T) return setArc(c, el / FILL_T, HEX[P.team]);   // 順時針轉一圈填滿
    return setArc(c, (P.until() - S.t) / P.T, HEX[P.team], true);   // 灰色從正上方順時針吃掉
  }
  setArc(c, el / P.T, HEX.native);   // 綠色順時針填滿
}
// 營地 / 據點現在的倒數（Tab 小地圖用）：held = 效果 / 增援還剩幾秒（隊伍色）；regrow = 蟲還要幾秒長回來（綠）
function campCountdown(c) {
  const P = c.ph;
  if (P.kind === 'held') return { t: Math.max(0, P.until() - S.t), css: CSS[P.team] };
  if (P.kind === 'regrow') return { t: Math.max(0, P.t0 + P.T - S.t), css: CSS.native };
  return null;
}
export function clearConquest() {
  G.noCrashDmg = false;
  if (!S) return;
  for (const n of S.nodes) scene.remove(n.g);
  for (const c of S.camps) { scene.remove(c.g); c.arc.geometry.dispose(); }
  S = null;
}

// 主力機的配裝池：據點戰專用的配裝（parts.js CQ_ACES，每台有 role）
const ACE_POOL = CQ_ACES;
// 武器的每秒傷害（盾、模組 = 0）× 持久度（打得久的 1；8 秒打光的火箭約 0.5）
const wDps = d => !d || d.kind === 'shield' || d.kind === 'module' ? 0 : d.kind === 'lance' ? d.dmgMax / d.interval : d.dmg * (d.pellets || 1) * (d.salvo || 1) * (d.bomblets || 1) / (d.interval || 1);
const wSustain = d => !d.ammo ? 1 : 0.4 + 0.6 * Math.min(1, fireTime(d) / 40);
const weaponsOf = lo => ['armL', 'armR', 'backL', 'backR'].map(sl => WEAPONS[lo[sl]]).filter(d => wDps(d) > 0);
const PART_W = { torso: 0.5, arms: 0.2, legs: 0.2, head: 0.1 };
// 這套配裝的火力打在對面那幾台身上的倍率（照每秒傷害 × 持久度加權，四個部位都算）
function offenseK(lo, foes) {
  const W = weaponsOf(lo), tot = W.reduce((a, d) => a + wDps(d) * wSustain(d), 0) || 1;
  return foes.reduce((a, f) => a + W.reduce((b, d) => b + wDps(d) * wSustain(d) / tot * Object.entries(PART_W).reduce((c, [p, k]) => c + k * (EFFECT[d.type]?.[f.armor?.[p] ?? 'composite'] ?? 1), 0), 0), 0) / foes.length;
}
// 對面的火力打在這套身上的倍率（越低越耐打）
function defenseK(lo, foes) {
  let a = 0, n = 0;
  for (const f of foes) for (const d of weaponsOf(f)) { const w = wDps(d) * wSustain(d); a += w * Object.entries(PART_W).reduce((c, [p, k]) => c + k * (EFFECT[d.type]?.[lo.armor?.[p] ?? 'composite'] ?? 1), 0); n += w; }
  return n ? a / n : 1;
}
// 隊伍現在缺什麼角色（局勢）：沒清的巢 → 清蟲、可以讀的巢 → 佔點、落後 → 搶點、晚場或領先 → 攻城、有營地 → 打野
function roleNeed(team) {
  const guarded = S.nodes.filter(n => n.owner === 'native').length, open = S.nodes.filter(n => n.owner !== team).length;
  const fort = S.forts[foeTeam(team)], fortK = fort?.alive ? fort.parts.torso.hp / fort.parts.torso.max : 1;
  const late = S.t > 300 || S.score[team] > S.score[foeTeam(team)] + 90 || fortK < 0.6;
  return {
    clear: guarded >= 3 ? 0.4 : guarded ? 0.2 : 0,
    hold: 0.25 + (behind(team) ? 0.15 : 0),
    capture: open >= 4 ? 0.25 : 0.1 + (behind(team) ? 0.15 : 0),
    breach: S.t > 45 ? 0.2 : 0.1,
    hunt: S.camps.some(c => c.units.some(u => u.alive)) ? 0.2 : 0.05,
    duel: 0.2,
    support: 0.15,
    siege: late ? 0.45 : 0,
  };
}
// 重新出擊（和開場）時挑配裝：配裝的基礎分（prior）+ 剋對面的裝甲（四個部位、照火力加權）+ 擋得住對面的火力 + 隊伍缺的角色 + 一點隨機；隊友正在用的不重複、同角色不疊
function counterPick(team, k) {
  const foes = S.opening ? [] : S.aces[foeTeam(team)].map(e => e.cq.lo);   // 開場兩隊同時挑（不然後挑的紅隊看得到藍隊、永遠剋得到）
  const mates = S.aces[team].filter((e, j) => j !== k && e).map(e => e.cq.lo);
  const names = new Set(mates.map(l => l.name)), roles = new Set(mates.map(l => l.role));
  const need = roleNeed(team), tier = S.tier[team];
  let best = null, bs = -Infinity;
  for (const lo of ACE_POOL) {
    if ((lo.tier ?? 1) > tier || (names.has(lo.name) && (lo.tier ?? 1) > 1)) continue;   // 還沒開放的階不能挑；1 階可以跟隊友重複
    let sc = (roles.has(lo.role) ? -0.15 : need[lo.role] ?? 0) + (lo.prior ?? 0) + ((lo.tier ?? 1) - 1) * 0.25 + Math.random() * 0.25;   // prior：模擬裡 AI 用得好不好；高階的優先（升階了就換上新開放的）
    if (foes.length) sc += (offenseK(lo, foes) - 1) * 1.2 - (defenseK(lo, foes) - 1) * 0.6;
    if (sc > bs) { bs = sc; best = lo; }
  }
  return best ?? ACE_POOL.find(lo => (lo.tier ?? 1) === 1);
}
const baseOf = team => S.bases[team];
const foeTeam = t => t === 'blue' ? 'red' : 'blue';
const owned = n => n.owner === 'blue' || n.owner === 'red';
const ANCHOR = { x: 0, z: 0, alive: true, team: 'none' };
function spreadAt(x, z, taken, r0 = 1.5, r1 = 3.2) {
  for (let t = 0; t < 40; t++) {
    const a = Math.random() * Math.PI * 2, r = r0 + Math.random() * (r1 - r0), px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
    if (taken.some(p => Math.hypot(p.x - px, p.z - pz) < 1.8)) continue;
    let ok = true;
    for (let dz = -1; dz <= 1 && ok; dz++) for (let dx = -1; dx <= 1; dx++) if (isSolid(px + dx, pz + dz)) { ok = false; break; }
    if (ok) return { x: px, z: pz };
  }
  return { x, z };
}
// 大本營往地圖中央的方向（出生、空投站在大本營前面）
const front = (team, d) => { const B = baseOf(team), l = Math.hypot(B.x, B.z) || 1; return { x: B.x - B.x / l * d, z: B.z - B.z / l * d }; };
const faceCenter = (e, team) => { const B = baseOf(team); e.aimYaw = e.torsoYaw = e.legYaw = Math.atan2(-B.x, -B.z); };

// map：conquestArena 的地圖（bases = [藍, 紅]）；toast：main.js 的提示
export function startConquest(map, toast) {
  clearConquest();
  G.noCrashDmg = true;   // 這個模式：撞地形、撞隊友不扣血（撞敵人照舊，mech.js）
  const stat = () => ({ k: 0, d: 0, cap: 0, camp: 0 });
  S = { t: 0, toast, bases: { blue: map.bases[0], red: map.bases[1] },
    score: { blue: 0, red: 0 }, drops: { blue: 0, red: 0 }, kills: { blue: 0, red: 0 }, bar: { blue: 0, red: 0 }, buffs: { blue: {}, red: {} },
    stats: { blue: [stat(), stat(), stat()], red: [stat(), stat(), stat()] }, team: { blue: { grunts: 0, camps: 0 }, red: { grunts: 0, camps: 0 } },
    sieges: { blue: { siege: true, key: 'cqsb', x: map.bases[1].x, z: map.bases[1].z }, red: { siege: true, key: 'cqsr', x: map.bases[0].x, z: map.bases[0].z } },
    homes: { blue: { base: true, key: 'cqhb', x: map.bases[0].x, z: map.bases[0].z }, red: { base: true, key: 'cqhr', x: map.bases[1].x, z: map.bases[1].z } },
    tier: { blue: 1, red: 1 }, tprog: { blue: 0, red: 0 }, cbuff: { blue: {}, red: {} }, outposts: 0,
    lo: new Map(), breaches: 0, dug: 0, devices: 0, result: null, cmdT: 0, focus: 0, aces: { blue: [], red: [] }, forts: {}, deaths: new Map(), respawns: [], log: [],
    nodes: CQ_NODES.map((p, i) => ({ i, key: `cq${i}`, type: p.type, name: HIVES[p.type].name, x: p.x, z: p.z, owner: 'native', prog: 0, guards: [], contested: false, capturing: null })),
    camps: [...CQ_CAMPS.map((p, i) => ({ i, key: `cqc${i}`, camp: true, kind: p.kind, x: p.x, z: p.z, units: [], respawn: 0 })),
      ...OUTPOSTS.map((p, i) => ({ i: CQ_CAMPS.length + i, key: `cqo${i}`, camp: true, outpost: true, kind: 'outpost', x: p.x, z: p.z, units: [], respawn: 0, owner: null }))] };
  for (const n of S.nodes) buildNode(n);
  for (const c of S.camps) { buildCamp(c); spawnCamp(c); }
  S.opening = true;
  for (const team of TEAMS) {
    const B = baseOf(team), F0 = front(team, 6);
    for (let k = 0; k < 3; k++) S.aces[team].push(spawnAce(team, counterPick(team, k), spreadAt(F0.x, F0.z, S.aces[team], 0, 4), k, true));
    // 大本營：要塞砲車
    const F = spawnEnemy(ANCHOR, { ...ELITES.find(E => E.name === '要塞砲車'), id: 'fortress' }, { x: B.x, z: B.z }, { team, colors: COLORS[team], diff: DIFFS.hard, noDrop: true });
    for (const q of Object.values(F.parts)) { q.max *= CQ.fortHpK; q.hp = q.max; }
    F.hold = { x: B.x, z: B.z, r: CQ.fortHold };
    F.ghost = true;   // 大本營不擋路、也不會被其他機體推走（mech.js collideMechs 跳過）
    faceCenter(F, team);
    tagUnit(F, team, { fort: true });
    addRing(F, team);
    S.forts[team] = F;
  }
  S.opening = false;
  // 蟲巢守衛
  for (const n of S.nodes) {
    const taken = [];
    for (const key of HIVES[n.type].guards) for (const u of packUnits(SQUADS, key)) {
      const at = spreadAt(n.x, n.z, taken, 2, 6); taken.push(at);
      const e = spawnEnemy(ANCHOR, gruntOf(u), at, { team: 'native', colors: COLORS.native, diff: DIFFS.normal, grunt: true, noDrop: true });
      e.hold = { x: n.x, z: n.z, r: CQ.bugHold }; e.dormant = true; e.cq = { node: n };
      n.guards.push(e);
    }
  }
  toast('據點戰・壓制蟲巢、佔領後收割；野怪營地給全隊主力機短時間強化、角落的增援據點給一陣子的增援；擊墜對方主力機升階・Tab 打開地圖與戰績');
}
const EMERGE_T = 1.4, EMERGE_D = 2.4;   // 蟲從地下爬出來：幾秒、從多深
function spawnCamp(c) {
  const taken = [];
  c.units = CAMPS[c.kind].units.map(u => {
    const at = spreadAt(c.x, c.z, taken, 0.8, 2.2); taken.push(at);
    const e = spawnEnemy(ANCHOR, gruntOf(u), at, { team: 'native', colors: COLORS.native, diff: DIFFS.normal, grunt: true, noDrop: true });
    e.hold = { x: c.x, z: c.z, r: CQ.campHold }; e.dormant = true; e.cq = { camp: c };
    e.emergeT = EMERGE_T; e.flyH = -EMERGE_D;   // 從地下爬出來（preUpdate）
    burst(at.x, 0.3, at.z, [0x4a3a2a, 0x6a5440, 0x2e241a], 10, 3);
    return e;
  });
  c.ph = { kind: 'live' };
}
function tagUnit(e, team, extra) {
  e.cq = { team, goal: null, base: { dmg: e.dmgMul ?? 1, vmax: e.spec.vmax, regen: e.spec.regen ?? 1 }, legHex: e.parts.legs?.mat?.color.getHex(), ...extra };
  return e;
}
function spawnAce(team, lo, at, k, noDrop = false) {
  const e = spawnEnemy(ANCHOR, lo, at, { team, colors: COLORS[team], diff: DIFFS.hard, noDrop });
  tagUnit(e, team, { ace: true, lo, k });
  addRing(e, team);
  faceCenter(e, team);
  return e;
}

// 派系光環（雜魚 makeMech 自己有；主力機、要塞另外加，大一點）；拿到營地效果時光環換成效果的顏色、一閃一閃
const ACE_RING = new THREE.RingGeometry(1.2, 1.5, 32);
function addRing(e, team) {
  const ring = new THREE.Mesh(ACE_RING, addMat(COLORS[team].glow, 0.6));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04;
  e.model.root.add(ring); e.model.teamRing = ring; e.cq.ring = ring;
}
// 雜魚和營地的蟲互不理會（雜魚推進路上經過營地也不會開打；營地只給主力機清）
const campPair = (a, b) => (a.cq?.camp && b.grunt && b.team !== 'native') || (b.cq?.camp && a.grunt && a.team !== 'native');
const hostile = (a, b) => b !== a && b.alive && !b.drop && b.team !== a.team && b.team !== 'none' && !campPair(a, b);
function nearestHostile(e) {
  let best = null, bd = Infinity;
  for (const o of mechs) {
    if (!hostile(e, o) || (o.dormant && e.team !== 'native') || o.emergeT > 0) continue;
    const d = Math.hypot(o.x - e.x, o.z - e.z);
    if (d < bd) { bd = d; best = o; }
  }
  return best ? { o: best, d: bd } : null;
}
const sees = (e, o, d) => rayBlock(e.x, e.z, (o.x - e.x) / d, (o.z - e.z) / d, d) >= d - o.r - 0.5 && !smokeHides(e.x, e.z, o.x, o.z);   // 煙霧擋視線（貼身 3.5 格內看得到）
const behind = team => S.score[team] + CQ.behindGap < S.score[foeTeam(team)];
// 這一隊正在生效的營地效果（種類清單）、合起來的數值
const teamBuffs = team => Object.keys(S.cbuff[team]).filter(k => S.t < S.cbuff[team][k]);
function buffSum(team) {
  const P = {};
  for (const k of teamBuffs(team)) for (const [a, v] of Object.entries(CAMPS[k].buff)) P[a] = (P[a] ?? 0) + v;
  return P;
}

// 隊伍指揮：替每台主力機挑目標（巢穴；附近有長好的營地、身上沒有效果 → 營地也算）
// 回基地修理：軀幹 < 40%（旁邊有修理機的隊友 → < 25% 才回）、腳壞了、或剩下的火力 < 40%（照每秒傷害 × 持久度算：主力的火箭打光了、拿武器的手被打掉都算；
//   以前用全部武器的平均彈藥，機槍把平均撐住，火箭打光了也不回）→ 回大本營（離基地 100 格內才回，太遠就打到底）
//   回去之後修到軀幹 ≥ 95%、沒有壞掉的部位、彈藥 ≥ 80% 才出發（最多待 20 秒）
function firepower(e) {
  let all = 0, live = 0;
  for (const [k, g] of Object.entries(e.guns)) { const w = wDps(g.def) * wSustain(g.def); all += w; if (!e.parts[k]?.broken && g.ammo > 0) live += w; }
  return all ? live / all : 1;
}
const medicNear = e => S.aces[e.cq.team].some(o => o !== e && o.alive && hasModule(o, 'repair') && Math.hypot(o.x - e.x, o.z - e.z) < 12);
function needsRepair(e) {
  const T = e.parts.torso;
  return T.hp / T.max < (medicNear(e) ? 0.25 : 0.4) || e.parts.legs?.broken || firepower(e) < 0.4;
}
function repaired(e) {
  const am = Object.values(e.guns).filter(g => g.max !== Infinity), ammo = am.length ? am.reduce((a, g) => a + g.ammo / g.max, 0) / am.length : 1;
  return e.parts.torso.hp / e.parts.torso.max >= 0.95 && !Object.values(e.parts).some(q => q.broken) && ammo >= 0.8;
}
// 目標還有沒有效：營地還有活的蟲；巢穴還不是自己的、或自己的正被搶
const threatOf = (n, team) => n.capturing === foeTeam(team) || mechs.some(o => o.alive && o.team === foeTeam(team) && !o.grunt && Math.hypot(o.x - n.x, o.z - n.z) < 12);
const goalValid = (g, team) => !!g && !g.base && (g.follow ? g.follow.alive && !g.follow.cq.retreat : g.siege ? !!S.forts[foeTeam(team)]?.alive : g.camp ? g.units.some(u => u.alive) || outpostFoe(g, team) : g.owner !== team || threatOf(g, team));
const outpostFoe = (c, team) => !!c.outpost && !!c.owner && c.owner !== team && !!c.body?.alive;   // 對面正在用的增援據點：打掉信標
// 角色眼中的價值倍率（parts.js CQ_ACES 的 role）
function roleK(role, G, team) {
  const n = G.g, guarded = !G.camp && !G.siege && n.owner === 'native', mine = !G.camp && !G.siege && n.owner === team;
  if (G.siege) return role === 'siege' ? 1 : role === 'breach' ? 0.6 : 0.3;
  if (G.camp) return { hunt: 1.9, duel: 1, clear: 0.9, breach: 0.8, capture: 0.4, hold: 0.4, siege: 0.3, support: 0.6 }[role] ?? 1;
  if (guarded) return { clear: 1.5, breach: 1.1, siege: 1, hold: 0.9, duel: 0.9, capture: 0.6, hunt: 0.7 }[role] ?? 1;
  if (mine) return { hold: 1.5, duel: 1.3, capture: 0.8 }[role] ?? 1;
  return { hold: 1.4, capture: 1.6, duel: 1.1, clear: 0.9 }[role] ?? 1;
}
function command(team) {
  const live = S.aces[team].filter(e => e.alive && !e.drop);
  // 回基地修理
  const B = baseOf(team), home = S.homes[team];
  for (const e of live) {
    const C = e.cq, dB = Math.hypot(e.x - B.x, e.z - B.z);
    if (C.retreat) {
      if (repaired(e) || (dB < CQ.healR && S.t - C.retreatT > 20)) { C.retreat = false; C.goal = null; }
    } else if (needsRepair(e) && dB < 100 && dB > CQ.healR) { C.retreat = true; C.retreatT = S.t; C.goal = home; note(`${TEAM_NAME[team]} ${(team === 'red' ? 4 : 1) + C.k} 號回大本營整備`); }
  }
  const goals = [
    ...S.nodes.map(n => {
      const threat = threatOf(n, team);
      const v = HIVES[n.type].value;
      return { g: n, v: n.owner === team ? (threat ? v * 1.4 : 0.1) : n.owner === foeTeam(team) ? v * 1.15 : v };
    }),
    ...S.camps.filter(c => c.units.some(u => u.alive)).map(c => ({ g: c, v: c.outpost ? 1.15 : 0.95, camp: true })),   // 營地藏在叢林深處：價值要夠高才會專程繞進去
    ...S.camps.filter(c => outpostFoe(c, team)).map(c => ({ g: c, v: 1.1, camp: true })),   // 對面的增援信標
  ];
  // 攻城：對面的大本營（晚場 / 領先 / 要塞已經受傷才值得）
  const fort = S.forts[foeTeam(team)];
  if (fort?.alive) {
    const fk = fort.parts.torso.hp / fort.parts.torso.max, late = S.t > 300 || S.score[team] > S.score[foeTeam(team)] + 90;
    goals.push({ g: S.sieges[team], v: fk < 0.35 ? 1.6 : late || fk < 0.7 ? 1.2 : 0.35, siege: true });
  }
  const count = new Map();
  // 承諾：手上的目標還有效、而且（指派不到 15 秒，或已經到了目標旁邊 12 格內）→ 不換，避免打一兩下就跑去別的地方
  const free = [];
  for (const e of live) {
    const C = e.cq, g = C.goal;
    if (C.retreat) continue;
    if (goalValid(g, team) && (S.t - (C.goalT ?? -99) < 15 || Math.hypot(g.x - e.x, g.z - e.z) < 12)) count.set(g, (count.get(g) ?? 0) + 1);
    else free.push(e);
  }
  // 支援（修理機）：跟著最近的、有任務的隊友走（不跟回營的）
  for (const e of free.filter(e => e.cq.lo.role === 'support')) {
    let best = null, bd = Infinity;
    for (const o of live) if (o !== e && o.cq.lo.role !== 'support' && !o.cq.retreat) { const d = Math.hypot(o.x - e.x, o.z - e.z); if (d < bd) { bd = d; best = o; } }
    if (!best) continue;
    if (e.cq.goal?.follow !== best) { e.cq.goal = followGoal(best); e.cq.goalT = S.t; }
    free.splice(free.indexOf(e), 1);
  }
  const order = free.map(e => ({ e, d: Math.min(...S.nodes.map(n => Math.hypot(n.x - e.x, n.z - e.z))) })).sort((a, b) => a.d - b.d);
  for (const { e } of order) {
    let best = null, bs = -Infinity;
    for (const G of goals) {
      if (G.camp && !G.g.outpost && S.t < (S.cbuff[team][G.g.kind] ?? 0) - 15) continue;   // 這種效果全隊已經有了（還剩 15 秒以上）
      const role = e.cq.lo.role, d = Math.hypot(G.g.x - e.x, G.g.z - e.z);
      const s = G.v * roleK(role, G, team) / (1 + d / (role === 'capture' ? 40 : 20)) - (count.get(G.g) ?? 0) * (G.camp ? 1 : 0.4) + (e.cq.goal === G.g ? 0.08 : 0);   // 快速奪點機不太在意距離
      if (s > bs) { bs = s; best = G.g; }
    }
    if (best !== e.cq.goal) e.cq.goalT = S.t;
    e.cq.goal = best; count.set(best, (count.get(best) ?? 0) + 1);
  }
}
const followGoal = o => ({ follow: o, key: `f${o.id}`, get x() { return o.x; }, get z() { return o.z; } });
// 雜魚：去最近的「不是自己的」巢穴（或自己的、正在被搶的）
// 雜魚的目標：有分線的（定期增援、增援據點）→ 沿著自己那條線，第一座還不是自己的巢（自己的被搶也算）；整條線都是自己的 → 對面大本營
//   laneAt 只往前推（拿下的就不回頭），沒分線的（舊的 / 超級小兵沒分到）→ 最近的不是自己的巢
function gruntGoal(e) {
  const C = e.cq, L = C.lane != null ? LANES[e.team][C.lane] : null;
  if (L) {
    C.laneAt ??= 0;
    while (C.laneAt < L.length && S.nodes[L[C.laneAt]].owner === e.team && S.nodes[L[C.laneAt]].capturing !== foeTeam(e.team)) C.laneAt++;
    if (C.laneAt < L.length) return S.nodes[L[C.laneAt]];
    return S.forts[foeTeam(e.team)]?.alive ? S.sieges[e.team] : S.nodes[L[L.length - 1]];
  }
  let best = null, bd = Infinity;
  for (const n of S.nodes) if (n.owner !== e.team || n.capturing === foeTeam(e.team)) { const d = Math.hypot(n.x - e.x, n.z - e.z); if (d < bd) { bd = d; best = n; } }
  return best ?? S.nodes[0];
}
// keepAim：照路線走，但上半身照原本的（回基地途中邊退邊打）
function driveTo(e, n, keepAim = false) {
  const dx = n.x - e.x, dz = n.z - e.z, d = Math.hypot(dx, dz) || 1;
  const stop = n.camp ? (n.outpost && n.owner ? 7 : 2) : n.base ? CQ.healR - 5 : n.follow ? 4 : n.siege ? Math.max(10, (e.ai?.want ?? 10) + 2)
    : n.owner === 'native' && e.cq.lo?.role === 'clear' ? Math.max(CQ.nodeR, (e.ai?.want ?? 8)) : CQ.nodeR - 1.2;   // 清蟲機：站在射程邊上打守衛
  if (d < stop) { e.drive = { mx: 0, mz: 0 }; return; }
  const f = (!e.fly && routeDir(n.key, G.now, e.x, e.z, n.x, n.z)) || { x: dx / d, z: dz / d };
  e.drive = { mx: f.x, mz: f.z };
  if (!keepAim) e.aimYaw = Math.atan2(f.x, f.z);
}

// 每幀，updateEnemy 之前：挑對手、蟲醒不醒、全隊 / 個人效果
export function preUpdate(dt) {
  if (!S) return;
  for (const e of enemies) {
    if (!e.alive || !e.cq) continue;
    const H = nearestHostile(e);
    if (e.team === 'native') {
      if (e.emergeT > 0) {   // 正在從地下爬出來：還不會動、不會被盯上
        e.emergeT -= dt;
        const k = Math.max(0, e.emergeT / EMERGE_T);
        e.flyH = -EMERGE_D * k * k;
        if (Math.random() < dt * 10) spawnPuff({ x: e.x + (Math.random() - 0.5) * 1.6, y: 0.2, z: e.z + (Math.random() - 0.5) * 1.6, vx: (Math.random() - 0.5) * 1.5, vy: 0.8 + Math.random(), vz: (Math.random() - 0.5) * 1.5, life: 0.8, s: 0.45, c0: 0x6a5a48, c1: 0x3a3028, drag: 2 });
        if (e.emergeT <= 0) { e.emergeT = 0; e.flyH = 0; }
        e.dormant = true;
        continue;
      }
      // 清蟲機（role clear）30 格內看得到這窩 → 整窩醒來（遠距先手；醒了 8 秒內不會再睡）
      if (e.dormant && e.cq.node && (e.cq.peekT = (e.cq.peekT ?? 0) - dt) <= 0) {
        e.cq.peekT = 0.5;
        for (const t of TEAMS) for (const a of S.aces[t]) { const d = Math.hypot(a.x - e.x, a.z - e.z); if (a.alive && a.cq.lo.role === 'clear' && d < 30 && sees(a, e, d)) for (const u of e.cq.node.guards) if (u.cq) u.cq.wakeUntil = S.t + 8; }
      }
      e.dormant = !(H && H.d < (e.cq.camp ? CQ.campWake : CQ.bugWake)) && !(S.t < (e.cq.wakeUntil ?? 0));
      if (H) e.foe = H.o;
      continue;
    }
    if (e.cq.ace) aceDevice(e, dt);
    e.foe = H?.o ?? null;
    e.cq.near = H;
    const B = S.buffs[e.team], b = e.cq.base, P = e.cq.ace ? buffSum(e.team) : {};   // 營地效果：全隊主力機都有
    e.dmgMul = b.dmg * (1 + 0.12 * (B.attack ?? 0)) * (1 + (P.dmg ?? 0));
    e.spec.vmax = b.vmax * (1 + 0.08 * (B.speed ?? 0)) * (1 + (P.speed ?? 0));
    e.spec.regen = b.regen * (1 + 0.3 * (B.energy ?? 0)) * (1 + (P.regen ?? 0));
    e.takeK = 0.88 ** (B.armor ?? 0);
    if (e.cq.ring) {
      const bk = e.cq.ace ? teamBuffs(e.team) : [], on = bk.length > 0;
      e.cq.ring.material.color.setHex(on ? CAMPS[bk[Math.floor(G.now) % bk.length]].hex : COLORS[e.team].glow);
      e.cq.ring.material.opacity = on ? 0.55 + 0.35 * Math.abs(Math.sin(G.now * 5)) : 0.6;
    }
  }
}
// 每幀，updateEnemy 之後（driveMech 之前）：附近沒有看得到的敵人 → 照路線走去目標
export function postUpdate(e) {
  if (!S || !e.alive || !e.cq || e.team === 'native' || e.drop || e.cq.fort || e.cq.obody) return;
  const C = e.cq, H = C.near, R = e.grunt ? CQ.engageGrunt : CQ.engageAce;
  if (C.retreat) { if (C.held) { e.hold = null; C.held = false; } e.siegeAt = null; C.breach = null; driveTo(e, C.goal, !!(H && H.d < R && sees(e, H.o, H.d))); return; }   // 回基地：一定走，看得到敵人就邊退邊打
  // 搶點反制（2026-11-28）：35 格內有巢穴正被對面讀條、圈裡有煙 → 直接走進圈裡（兩邊都有人站 = 讀條暫停），邊走邊盲射（ai.js）
  if (!e.grunt) {
    const foe = foeTeam(e.team);
    const n = S.nodes.find(q => q.capturing === foe && Math.hypot(q.x - e.x, q.z - e.z) < 35 && inSmoke(q.x, q.z));
    if (n) {
      e.hold = { x: n.x, z: n.z, r: CQ.nodeR - 1.2 }; C.held = true; e.siegeAt = null; C.breach = null;
      if (Math.hypot(n.x - e.x, n.z - e.z) > CQ.nodeR - 1.5) driveTo(e, n, true);
      C.contestN = (C.contestN ?? 0) + 1;
      return;
    }
  }
  // 佔點：目標是可以讀條的巢穴（守衛死光、不是自己的或正被搶）、走到旁邊 → 綁在圈裡打（戰術 AI 的射擊位置不會把它拉出去）
  const g = C.goal;
  if (!e.grunt) {
    const ring = g && g.guards && !g.camp && !g.guards.some(u => u.alive) && (g.owner !== e.team || g.capturing === foeTeam(e.team)) && Math.hypot(g.x - e.x, g.z - e.z) < CQ.nodeR + 6;
    if (ring) { e.hold = { x: g.x, z: g.z, r: CQ.nodeR - 1.2 }; C.held = true; }
    else if (C.held) { e.hold = null; C.held = false; }
  }
  if (H && (H.d < 12 || (H.d < R && sees(e, H.o, H.d)))) return;
  if (!e.grunt && C.ace && breach(e, g)) return;
  e.siegeAt = null;
  const n = e.grunt ? (C.goal ??= gruntGoal(e)) : g;
  if (n) driveTo(e, n);
}
// 開路：每個目標一張「打穿建築也算路」的距離場（空地 1 步、建築 BCOST（5）步、岩石 / 深淵走不到；整張地圖、8 方向、最多每 4 秒重算）
//   照一般路線（routeDist）比照這張場遠 minGain 格以上（破牆 / 攻城角色 8 格、其他 20 格）→ 照這張場往下走，路上第一格建築就是要打穿的牆
//   → 站在路上離那格 stand 格的地方，用打得壞牆的武器（ai.js breakPow：爆破炸藥、火箭、加農砲、打樁、騎槍…）打；打掉再找下一格，20 秒打不穿就放棄
const BCOST = 5, DIR8 = [[1, 0, 10], [-1, 0, 10], [0, 1, 10], [0, -1, 10], [1, 1, 14], [1, -1, 14], [-1, 1, 14], [-1, -1, 14]];
const BF = new Map();
const breakers = e => ['armL', 'armR', 'backL', 'backR'].map(sl => e.guns[sl] && !e.parts[sl]?.broken && e.guns[sl].ammo > 0 && breakPow(e.guns[sl].def) >= 40 ? e.guns[sl].def : null).filter(Boolean);
function breachField(g) {
  let F = BF.get(g.key);
  const c0 = Math.floor(g.x + MAP_W / 2), r0 = Math.floor(g.z + MAP_H / 2);
  if (F && F.W === MAP_W && (F.ver === gridVer || S.t - F.t < 4) && F.c0 === c0 && F.r0 === r0) return F;
  const W = MAP_W, H = MAP_H, N = W * H, dist = new Float32Array(N).fill(Infinity);
  const cost = new Uint8Array(N);   // 0 = 走不到
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const ch = grid[r][c];
    cost[r * W + c] = ch === 'v' ? 0 : ch === '#' ? (isBuilding(c - W / 2 + 0.5, r - H / 2 + 0.5) ? BCOST : 0) : 1;
  }
  // 小整數權重的 Dijkstra（8 方向；距離 ×10：直走 10、斜走 14，建築 ×BCOST；斜走不切牆角）：桶子佇列
  const buckets = [[r0 * W + c0]];
  dist[r0 * W + c0] = 0;
  for (let d = 0; d < buckets.length; d++) {
    const B = buckets[d];
    if (!B) continue;
    for (const i of B) {
      if (dist[i] !== d) continue;
      const c = i % W, r = (i / W) | 0;
      for (const [dc, dr, step] of DIR8) {
        const cc = c + dc, rr = r + dr;
        if (cc < 0 || rr < 0 || cc >= W || rr >= H) continue;
        const j = rr * W + cc, k = cost[j] * step;
        if (!k || d + k >= dist[j] || (dc && dr && (!cost[r * W + cc] || !cost[rr * W + c]))) continue;
        dist[j] = d + k;
        (buckets[d + k] ??= []).push(j);
      }
    }
    buckets[d] = null;
  }
  F = { W, ver: gridVer, t: S.t, c0, r0, dist, cost };
  BF.set(g.key, F);
  return F;
}
function planBreach(e, g, minGain) {
  if (!g || g.follow || g.base) return null;
  const sd = Math.hypot(g.x - e.x, g.z - e.z);
  if (sd < 10 || sd > 110) return null;
  const rd = routeDist(g.key, e.x, e.z), F = breachField(g), W = F.W;
  let c = Math.floor(e.x + MAP_W / 2), r = Math.floor(e.z + MAP_H / 2), i = r * W + c;
  const bd = F.dist[i] / 10;
  if (!(bd < Infinity) || rd === Infinity || !(rd - bd > minGain)) return null;
  // 照場往下走（最多 30 步）：記下走過的空地，碰到第一格建築就停
  const path = [];
  for (let s = 0; s < 30; s++) {
    let best = -1, bv = F.dist[i];
    for (const [dc, dr] of DIR8) {
      const cc = c + dc, rr = r + dr;
      if (cc < 0 || rr < 0 || cc >= W || rr >= MAP_H) continue;
      const j = rr * W + cc;
      if (F.dist[j] < bv) { bv = F.dist[j]; best = j; }
    }
    if (best < 0) return null;
    i = best; c = i % W; r = (i / W) | 0;
    const x = c - MAP_W / 2 + 0.5, z = r - MAP_H / 2 + 0.5;
    if (F.cost[i] === BCOST && isBuilding(x, z)) return { x, z, path, gain: rd - bd };
    path.push({ x, z });
  }
  return null;
}
function breach(e, g) {
  const C = e.cq, W = breakers(e);
  if (!W.length) { C.breach = null; return false; }
  if (!C.breach && S.t > (C.brNext ?? 0)) {
    C.brNext = S.t + 1.5;
    const role = C.lo.role, P = planBreach(e, g, role === 'breach' || role === 'siege' ? 8 : 20);
    if (P) { C.breach = { ...P, until: S.t + 20 }; S.breaches++; }
  }
  const B = C.breach;
  if (!B) return false;
  if (!isBuilding(B.x, B.z)) { C.breach = null; C.brNext = 0; S.dug++; e.siegeAt = null; return false; }   // 打穿這格：馬上找下一格
  if (S.t > B.until || g !== C.goal) { C.breach = null; C.brNext = S.t + 10; e.siegeAt = null; return false; }
  // 站多遠：最有效的那把打得到的距離（打樁要貼上去）；沿著場的路走到離那格 stand 格內
  const best = W.reduce((a, d) => breakPow(d) > breakPow(a) ? d : a);
  const stand = Math.max(1.6, Math.min(6, breakReach(e, best) - 1.5)), d = Math.hypot(B.x - e.x, B.z - e.z);
  e.siegeAt = B;
  if (d > stand) {
    const P = B.path.find(p => Math.hypot(p.x - e.x, p.z - e.z) > 0.7 && Math.hypot(B.x - p.x, B.z - p.z) < d) ?? B;
    const px = P.x - e.x, pz = P.z - e.z, pl = Math.hypot(px, pz) || 1;
    e.drive = { mx: px / pl, mz: pz / pl };
  } else e.drive = { mx: 0, mz: 0 };
  return true;
}
// 主動裝置（AI）：手榴彈丟擠在一起的敵人、煙霧掩護讀條 / 撤退、地雷埋在守的巢穴、護盾 / 誘餌被主力機盯上時用、電磁脈衝打貼身的、超載對主力機開火時
function aceDevice(e, dt) {
  updateDeviceCd(e, dt);
  if (!e.device || (e.cq.devT = (e.cq.devT ?? 0) - dt) > 0 || !deviceReady(e)) return;
  e.cq.devT = 0.4;
  const C = e.cq, team = e.team, hp = e.parts.torso.hp / e.parts.torso.max;
  const foes = [];
  for (const o of mechs) if (hostile(e, o) && !o.dormant) { const d = Math.hypot(o.x - e.x, o.z - e.z); if (d < 26 && sees(e, o, d)) foes.push({ o, d }); }
  if (!foes.length) {
    // 敵人躲進煙裡（ai.js 盲射中）：手榴彈丟最後看到的位置
    const B = e.ai?.blindAt, bd = B ? Math.hypot(B.x - e.x, B.z - e.z) : 0;
    if (B && e.device.id === 'grenade' && bd > 4 && bd < 13.5 && useDevice(e, B)) { C.devN = (C.devN ?? 0) + 1; S.devices++; }
    return;
  }
  const aceNear = r => foes.some(f => f.d < r && f.o.cq?.ace);
  const use = (x, z) => { if (useDevice(e, { x, z })) { C.devN = (C.devN ?? 0) + 1; S.devices++; } };
  switch (e.device.id) {
    case 'grenade': {
      const t = foes.find(f => f.d > 5 && f.d < 13.5 && foes.filter(q => Math.hypot(q.o.x - f.o.x, q.o.z - f.o.z) < 3).length >= 2)
        ?? foes.find(f => f.d > 5 && f.d < 13 && f.o.cq?.ace && f.o.parts.torso.hp / f.o.parts.torso.max < 0.35);
      if (t) use(t.o.x, t.o.z);
      break;
    }
    case 'smoke': if ((C.held && C.goal?.capturing === team && aceNear(25)) || (C.retreat && hp < 0.4 && aceNear(20))) use(e.x, e.z); break;
    case 'mine': if (C.held && aceNear(22)) use(e.x, e.z); break;
    case 'shieldGen': if (aceNear(18) && hp < 0.85) { const f = foes.find(q => q.o.cq?.ace); use(f.o.x, f.o.z); } break;
    case 'emp': if (foes.some(f => f.d < 6.5 && (f.o.cq?.ace || foes.filter(q => q.d < 6.5).length >= 2))) use(e.x, e.z); break;
    case 'overload': if (e.foe?.cq?.ace && foes.some(f => f.o === e.foe && f.d < 20)) use(e.foe.x, e.foe.z); break;
    case 'decoy': if (hp < 0.55 && aceNear(18)) use(e.x, e.z); break;
  }
}
const note = msg => { S.toast(msg); S.log.push({ t: S.t, msg }); if (S.log.length > 40) S.log.shift(); };

export function updateConquest(dt) {
  if (!S || S.result) return S?.result;
  S.t += dt;
  if ((S.cmdT -= dt) <= 0) {
    S.cmdT = 2;
    for (const t of TEAMS) command(t);
    for (const e of enemies) if (e.alive && (e.grunt || e.cq?.sup) && e.cq && e.team !== 'native') e.cq.goal = gruntGoal(e);
  }
  for (const t of TEAMS) S.buffs[t] = {};
  for (const t of TEAMS) for (const e of S.aces[t]) if (e.alive) loStat(e).t += dt;
  for (const n of S.nodes) {
    const guards = n.guards.some(e => e.alive);
    if (!guards && n.owner === 'native') { n.owner = 'none'; note(`${n.name}被壓制了・可以佔領`); }
    const w = { blue: 0, red: 0 };
    let bugs = false;
    for (const o of mechs) {
      if (!o.alive || o.drop || Math.hypot(o.x - n.x, o.z - n.z) > CQ.nodeR) continue;
      if (o.team === 'native') bugs = true;
      else if (w[o.team] != null) w[o.team] += o.grunt ? 0.5 : 1;
    }
    n.contested = w.blue > 0 && w.red > 0;
    n.capturing = null;
    if (!guards && !bugs && !n.contested && (w.blue > 0 || w.red > 0)) {
      const T = w.blue > 0 ? 'blue' : 'red', sg = T === 'blue' ? 1 : -1, k = Math.min(1.5, 0.5 + 0.5 * w[T]);
      if (n.owner !== T) {
        n.capturing = T;
        n.prog = Math.max(-1, Math.min(1, n.prog + sg * k * dt / CQ.capT));
        if (n.owner === foeTeam(T)) { if (sg * n.prog >= 0) { n.owner = 'none'; note(`${n.name}被中立化`); } }   // 對方的：先讀回中立
        else if (sg * n.prog >= 1) {
          n.owner = T; startCollapse(n); note(`${TEAM_NAME[T]}佔領${n.name}・${HIVES[n.type].desc}`);
          for (const e of S.aces[T]) if (e.alive && Math.hypot(e.x - n.x, e.z - n.z) <= CQ.nodeR + 1) { S.stats[T][e.cq.k].cap++; loStat(e).cap++; }
        }
      }
    } else if (!n.contested && w.blue === 0 && w.red === 0) {
      if (n.owner === 'none') n.prog *= Math.exp(-dt * 0.08);   // 沒人站：讀條慢慢退
      else if (owned(n)) n.prog += ((n.owner === 'blue' ? 1 : -1) - n.prog) * Math.min(1, dt * 0.3);
    }
    // 持有：得分、效果
    if (owned(n)) {
      S.score[n.owner] += dt * CQ.scoreRate * (n.type === 'core' ? 2 : 1);
      const B = S.buffs[n.owner];
      if (n.type === 'core') B.reinforce = (B.reinforce ?? 0) + CQ.reinforceCore;
      else if (n.type === 'reinforce') B.reinforce = (B.reinforce ?? 0) + CQ.reinforceHive;
      else B[n.type] = (B[n.type] ?? 0) + 1;
    }
    // 樣子
    n.ring.material.color.setHex(HEX[n.owner]);
    n.ring.material.opacity = n.contested ? 0.4 + 0.4 * Math.abs(Math.sin(G.now * 8)) : 0.75;
    n.disc.scale.setScalar(Math.max(0.001, Math.abs(n.prog)));
    n.disc.material.color.setHex(n.prog >= 0 ? HEX.blue : HEX.red);
    animCollapse(n, dt);
    n.sacMat.opacity = n.owner === 'native' ? 0.6 + 0.3 * Math.sin(G.now * 3 + n.i) : owned(n) ? 0.95 : 0.35;
  }
  // 營地重生
  for (const c of S.camps) {
    if (c.respawn > 0 && (c.respawn -= dt) <= 0) { c.respawn = 0; spawnCamp(c); }
    if (c.outpost && c.owner) {
      // 固定時刻表：拿下後 1.5 秒第一隊，之後每 14 秒一隊，60 秒內一共 waves 隊；不受場上雜魚上限影響
      //   （以前跟定期增援共用上限：滿了這一隊就一直延後，最後一兩隊常常在時間到之前沒出來）
      while (c.owner && c.waves < c.wavesMax && S.t >= c.t0 + 1.5 + c.waves * CQ.outpostDrop && c.body?.alive) { c.waves++; dropSquad(c.owner, c, { force: true, lane: c.lane, laneAt: c.laneAt, hpK: CQ.outpostHpK, dmgK: CQ.outpostDmgK }); }
      if (S.t > c.until || !c.body?.alive) stopOutpost(c);
    }
    // 營地的效果時間到了（全灰）→ 接著綠色長回來，填滿時重生
    if (c.ph.kind === 'held' && !c.outpost && S.t >= c.ph.t0 + c.ph.T) c.ph = { kind: 'regrow', t0: S.t, T: Math.max(1, c.respawn) };
    drawCamp(c);
  }
  // 增援條：滿了 → 從大本營空投一隊（場上雜魚滿了就等）
  for (const t of TEAMS) {
    S.bar[t] = Math.min(1, S.bar[t] + dt * (1 + (S.buffs[t].reinforce ?? 0)) / (CQ.reinforceT * (behind(t) ? CQ.behindK : 1)));
    if (S.bar[t] >= 1 && dropWave(t)) S.bar[t] = 0;
  }
  // 大本營旁：修理、長回壞掉的部位、補彈藥
  for (const e of enemies) {
    if (!e.alive || !e.cq || e.cq.fort || e.team === 'native' || e.drop) continue;
    const B = baseOf(e.team);
    if (Math.hypot(e.x - B.x, e.z - B.z) > CQ.healR) continue;
    let fixed = false, mending = false;
    for (const [k, q] of Object.entries(e.parts)) {
      if (q.broken) {
        q.broken = false; q.hp = q.max * 0.25; fixed = true;
        if (k === 'legs') { if (e.cq.legHex != null) q.mat.color.setHex(e.cq.legHex); } else if (!e.bug) q.g.visible = true;
        syncWear(e, k, 0, 0, true);
      } else if (q.hp < q.max) { mending = true; q.hp = Math.min(q.max, q.hp + q.max * CQ.healK * dt); if (Math.random() < dt * 2) syncWear(e, k, 0, 0, true); }
    }
    for (const g of Object.values(e.guns)) if (g.max !== Infinity && g.ammo < g.max) { mending = true; g.ammo = Math.min(g.max, g.ammo + g.max * CQ.ammoK * dt); }
    if (e.device && DEVICES[e.device.id].charges) e.device.charges = DEVICES[e.device.id].charges;   // 裝置次數補滿
    if (fixed) repairFx(e, e.x, 0.9, e.z, 20, 0.4, 4);
    else if (mending && (e.cq.mendT = (e.cq.mendT ?? 0) - dt) <= 0) { e.cq.mendT = 0.35; repairFx(e, e.x, 0.9, e.z, 5, 0.3, 1); }   // 還在回血 / 補彈：綠色特效一直放
  }
  // 重組
  for (let i = S.respawns.length - 1; i >= 0; i--) {
    const R = S.respawns[i];
    if ((R.t -= dt) > 0) continue;
    S.respawns.splice(i, 1);
    const F = front(R.team, 5);
    S.aces[R.team][R.k] = spawnAce(R.team, R.lo, spreadAt(F.x, F.z, [], 0, 4), R.k);
  }
  if (S.result) return S.result;   // 大本營被打爆（conquestDeath）
  for (const t of TEAMS) if (S.score[t] >= CQ.winScore) S.result = t;
  if (!S.result && S.t >= CQ.timeLimit) S.result = Math.abs(S.score.blue - S.score.red) < 1 ? 'draw' : S.score.blue > S.score.red ? 'blue' : 'red';
  return S.result;
}
// 空投一隊雜魚（at：從增援據點冒出來；不然從大本營前面）；機種照隊伍的階段換世代（GENS）
// opt：force = 不管場上雜魚上限；lane / laneAt = 走哪條線、從線上第幾座開始；hpK / dmgK = 額外的耐久 / 傷害倍率
function dropSquad(team, at = null, opt = {}) {
  const live = enemies.filter(e => e.alive && e.grunt && e.team === team).length;
  const pool = DROPS[S.tier[team]].filter(k => SQUADS[k]), key = pool[Math.floor(Math.random() * pool.length)], units = packUnits(SQUADS, key);
  if (!opt.force && live + units.length > CQ.gruntCap) return false;
  S.drops[team]++;
  const F = at ?? front(team, 4), taken = [], gen = GENS[S.tier[team]];
  const hpK = (gen?.hpK ?? 1) * (opt.hpK ?? 1), dmgK = (gen?.dmgK ?? 1) * (opt.dmgK ?? 1);
  for (const u of units) {
    const p = spreadAt(F.x, F.z, taken, 1, 5); taken.push(p);
    const d = gruntOf(u), o = gen?.units[d.id];
    const e = spawnEnemy(ANCHOR, o ? { ...d, ...o } : d, p, { team, colors: COLORS[team + 'grunt'], diff: DIFFS.hard, grunt: true });
    if (hpK !== 1) for (const q of Object.values(e.parts)) { q.max *= hpK; q.hp = q.max; }
    e.dmgMul = (e.dmgMul ?? 1) * dmgK;
    e.gen = S.tier[team];
    tagUnit(e, team, opt.lane != null ? { lane: opt.lane, laneAt: opt.laneAt ?? 0 } : {});
    e.cq.goal = gruntGoal(e);
  }
  return true;
}
// 定期增援一波：三條線各一隊，從大本營往那條線第一座巢的方向出發（場上雜魚放不下一整波就等）
function dropWave(team) {
  const live = enemies.filter(e => e.alive && e.grunt && e.team === team).length;
  if (live + 9 > CQ.gruntCap) return false;
  const B = baseOf(team);
  LANES[team].forEach((L, i) => {
    const n = S.nodes[L[0]], dx = n.x - B.x, dz = n.z - B.z, d = Math.hypot(dx, dz) || 1;
    dropSquad(team, spreadAt(B.x + dx / d * 8, B.z + dz / d * 8, [], 0, 2), { force: true, lane: i });
  });
  return true;
}
// 增援據點：清掉守衛 → 那一隊立信標、開始增援
function startOutpost(c, team) {
  c.owner = team; c.until = S.t + CQ.outpostT; c.t0 = S.t; c.waves = 0;
  c.wavesMax = Math.floor((CQ.outpostT - 1.5) / CQ.outpostDrop) + 1;   // 60 秒：1.5、15.5、29.5、43.5、57.5 → 5 隊
  // 走哪條線：這一隊的線裡離據點最近的那座巢開始往前推（右上據點 = 藍的上路 / 紅的下路）
  let best = Infinity;
  LANES[team].forEach((L, i) => L.forEach((ni, j) => { const n = S.nodes[ni], d = Math.hypot(n.x - c.x, n.z - c.z); if (d < best) { best = d; c.lane = i; c.laneAt = j; } }));
  c.ph = { kind: 'held', team, t0: S.t, T: CQ.outpostT, until: () => c.until };
  const B = spawnEnemy(ANCHOR, { ...gruntOf('turret'), label: '增援信標', fixed: true }, { x: c.x, z: c.z }, { team, colors: COLORS[team], diff: DIFFS.hard, noDrop: true });
  B.fixed = true;
  for (const q of Object.values(B.parts)) { q.max *= CQ.beaconHpK; q.hp = q.max; }
  tagUnit(B, team, { obody: c });
  c.body = B;
  S.outposts++;
}
// 增援停止（時間到 / 信標被打掉）：信標收掉，一段時間後蟲子長回來
function stopOutpost(c, by = null) {
  const T = c.owner;
  c.owner = null; c.respawn = CQ.outpostRegrow; c.ph = { kind: 'regrow', t0: S.t, T: CQ.outpostRegrow };
  if (c.body?.alive) { burst(c.x, 1, c.z, [0x8a96a6, 0x5a6470], 14, 4); removeEnemy(c.body); }
  c.body = null;
  note((by ? `${TEAM_NAME[by]}打掉${TEAM_NAME[T]}的增援信標・增援停止` : `${TEAM_NAME[T]}的增援據點時間到・增援停止`) + `（出了 ${c.waves}/${c.wavesMax} 隊）`);
}
// 階段進度（權重）：滿了升階；3 階再滿 → 超級小兵、歸零
function addProg(team, w) {
  S.tprog[team] += w;
  for (let need = CQ.tierNeed[S.tier[team]]; S.tprog[team] >= need; need = CQ.tierNeed[S.tier[team]]) {
    S.tprog[team] -= need;
    if (S.tier[team] < 3) {
      S.tier[team]++;
      note(`${TEAM_NAME[team]}升到第 ${S.tier[team]} 階・開放${ACE_POOL.filter(lo => lo.tier === S.tier[team]).map(lo => lo.name).join('、')}・增援換成${S.tier[team] === 3 ? '次世代' : '現行'}機種`);
    } else superWave(team);
  }
}
// 超級小兵：3 台 1 階的主力機配裝（可重複）、耐久 ×0.75，從大本營出發去搶巢（跟雜魚一樣的目標）
function superWave(team) {
  const T1 = ACE_POOL.filter(lo => (lo.tier ?? 1) === 1), F = front(team, 5), taken = [];
  for (let i = 0; i < 3; i++) {
    const lo = T1[Math.floor(Math.random() * T1.length)], at = spreadAt(F.x, F.z, taken, 1, 5); taken.push(at);
    const e = spawnEnemy(ANCHOR, lo, at, { team, colors: COLORS[team + 'grunt'], diff: DIFFS.normal });
    for (const q of Object.values(e.parts)) { q.max *= CQ.supHpK; q.hp = q.max; }
    tagUnit(e, team, { sup: true, lo, lane: i });   // 三台各走一條線
    addRing(e, team);
    faceCenter(e, team);
    e.cq.goal = gruntGoal(e);
  }
  S.supers = (S.supers ?? 0) + 1;
  note(`${TEAM_NAME[team]}的階段進度又滿了・出動一波超級小兵`);
}
// 機體損毀（main.js AI.onEnemyDeath）：大本營 → 敗北；營地清空 → 獎勵；主力機 → 戰績、排重組
export function conquestDeath(e) {
  if (!S) return;
  const by = e.lastHitBy?.cq?.team && e.lastHitBy.cq.team !== 'native' ? e.lastHitBy : null;
  if (e.cq?.fort && !S.result) { S.result = foeTeam(e.cq.team); S.baseKill = true; note(`${TEAM_NAME[e.cq.team]}的大本營被摧毀`); return; }
  if (e.cq?.obody) { if (e.cq.obody.body === e && e.cq.obody.owner) stopOutpost(e.cq.obody, by?.cq.team); return; }   // 增援信標被打掉
  const C = e.cq?.camp;
  if (C) {
    if (C.units.some(u => u.alive) || C.respawn > 0 || C.owner) return;
    const T = by?.cq.team, K = CAMPS[C.kind];
    if (C.outpost) {
      if (!T) { C.respawn = CQ.outpostRegrow; C.ph = { kind: 'regrow', t0: S.t, T: CQ.outpostRegrow }; return; }
      startOutpost(C, T);
      if (by.cq.ace) { S.stats[T][by.cq.k].camp++; loStat(by).camp++; }
      note(`${TEAM_NAME[T]}拿下增援據點・${CQ.outpostT} 秒內每 ${CQ.outpostDrop} 秒一隊增援（打掉信標就停）`);
      return;
    }
    C.respawn = CQ.campRespawn;
    if (!T) { C.ph = { kind: 'regrow', t0: S.t, T: CQ.campRespawn }; return; }
    C.ph = { kind: 'held', team: T, t0: S.t, T: CQ.campBuffT, until: () => C.ph.t0 + CQ.campBuffT };   // 這個營地自己的 45 秒（同種效果被別的營地續上，這圈照樣照自己的時間退）
    S.bar[T] = Math.min(1, S.bar[T] + CQ.campBar);
    S.cbuff[T][C.kind] = S.t + CQ.campBuffT; C.holder = T; C.until = S.t + CQ.campBuffT;
    S.team[T].camps++;
    if (by.cq.ace) { S.stats[T][by.cq.k].camp++; loStat(by).camp++; }
    note(`${TEAM_NAME[T]}${by.cq.ace ? `的 ${by.cq.lo.name}` : '的雜魚'}清掉營地・全隊主力機${K.name} ${CQ.campBuffT} 秒・增援 +${Math.round(CQ.campBar * 100)}%`);
    return;
  }
  if (by?.cq.ace && (e.grunt || e.team === 'native')) loStat(by)[e.grunt && e.team !== 'native' ? 'gk' : 'bk']++;
  if (e.grunt && e.cq?.team && by) { S.team[by.cq.team].grunts++; return; }
  if (e.cq?.sup) { addProg(foeTeam(e.cq.team), (e.cq.lo.pw ?? 1) * CQ.supW); return; }   // 超級小兵：給對面一點權重
  if (!e.cq?.ace) return;
  const team = e.cq.team, k = e.cq.k;
  S.kills[foeTeam(team)]++;
  S.stats[team][k].d++; loStat(e).d++;
  if (by?.cq.ace) { S.stats[by.cq.team][by.cq.k].k++; loStat(by).k++; }
  // 階段：對面累積擊墜 → 升階（開放下一階主力機、增援換世代）
  const FT = foeTeam(team);
  addProg(FT, e.cq.lo.pw ?? 1);
  if (S.aces[team][k] !== e) return;
  const n = (S.deaths.get(`${team}${k}`) ?? 0) + 1;
  S.deaths.set(`${team}${k}`, n);
  const t = Math.min(CQ.respawnMax, CQ.respawn + CQ.respawnAdd * (n - 1)) * (behind(team) ? CQ.behindK : 1) * (0.6 + 0.4 * (e.cq.lo.pw ?? 1));   // 強的機體重組比較久
  const lo = counterPick(team, k);
  if (lo.name !== e.cq.lo.name) note(`${TEAM_NAME[team]} ${(team === 'red' ? 4 : 1) + k} 號改裝成${lo.name}`);
  S.respawns.push({ team, k, lo, t });
}
// 觀戰鏡頭跟哪一台：0～2 藍、3～5 紅（數字鍵 1～6 切換）
export function focusMech() {
  if (!S) return null;
  const list = [...S.aces.blue, ...S.aces.red];
  for (let i = 0; i < 6; i++) { const e = list[(S.focus + i) % 6]; if (e?.alive) return e; }
  return null;
}
export const setFocus = i => { if (S) S.focus = i; };
// 上方的狀態列：九座巢穴
export function conquestHud() {
  if (!S) return '';
  const chip = n => { const c = CSS[n.owner]; return `<span title="${n.name}：${HIVES[n.type].desc}" style="display:inline-block;width:30px;margin:1px;border-radius:4px;border:1px solid ${c};color:${c};font-size:12px${n.contested ? ';opacity:.5' : ''}">${HIVES[n.type].short}${n.capturing ? `<small>${Math.round(Math.abs(n.prog) * 100)}</small>` : ''}</span>`; };
  return S.nodes.map(chip).join('');
}
const tierChip = team => `<span class="wt" style="--c:#e0c070">第 ${S.tier[team]} 階・${S.tprog[team].toFixed(1)}/${CQ.tierNeed[S.tier[team]]}</span>`;
// 螢幕上緣的兩條階段進度條（像血條）：藍的往左長、紅的往右長；3 階的條滿 = 超級小兵
export function tierBars() {
  if (!S) return '';
  const bar = t => {
    const need = CQ.tierNeed[S.tier[t]], k = Math.min(1, S.tprog[t] / need);
    return `<div class="tb ${t}"><div class="lab">${TEAM_NAME[t]}・第 ${S.tier[t]} 階${S.tier[t] === 3 ? '・滿了出動超級小兵' : ''}</div><div class="bar"><div class="fill" style="width:${(k * 100).toFixed(1)}%"></div></div></div>`;
  };
  return bar('blue') + bar('red');
}
export function teamList(team) {
  if (!S) return '';
  const B = S.buffs[team], buff = ['armor', 'attack', 'speed', 'energy'].filter(k => B[k]).map(k => `${HIVES[k].short}×${B[k]}`).join(' ');
  return S.aces[team].map((e, k) => {
    const R = S.respawns.find(r => r.team === team && r.k === k);
    return `<span class="wt" style="--c:${CSS[team]}${e.alive ? '' : ';opacity:.45'}">${e.cq.lo.name}${R ? ` 重組 ${Math.ceil(R.t)}s` : ''}</span>`;
  }).join('') + tierChip(team) + teamBuffs(team).map(kd => `<span class="wt" style="--c:${CAMPS[kd].css}">${CAMPS[kd].name} ${Math.ceil(S.cbuff[team][kd] - S.t)}s</span>`).join('') +
    S.camps.filter(c => c.outpost && c.owner === team).map(c => `<span class="wt" style="--c:${CAMPS.outpost.css}">增援據點 ${Math.ceil(c.until - S.t)}s</span>`).join('') + (S.forts[team] ? `<span class="wt" style="--c:${CSS[team]}">大本營 ${S.forts[team].alive ? Math.round(S.forts[team].parts.torso.hp / S.forts[team].parts.torso.max * 100) : 0}%</span>` : '') + `<span class="wt" style="--c:#8a96a6">增援 ${Math.round(S.bar[team] * 100)}%・雜魚 ${enemies.filter(e => e.alive && e.grunt && e.team === team).length}</span>` + (buff ? `<span class="wt" style="--c:#c8d070">${buff}</span>` : '');
}

// ---------- Tab 總覽：地圖 + 戰績 ----------
// 地圖：地形底圖（換場才重畫）+ 巢穴（持有方顏色、種類字）、營地、大本營、所有機體的點、鏡頭位置
let terrainImg = null, terrainId = null;
const PX = 4;   // 一格畫幾個像素
export function drawOverview(cv, cam) {
  if (!S) return;
  const W = MAP_W, H = MAP_H;
  if (cv.width !== W * PX) { cv.width = W * PX; cv.height = H * PX; }
  const ctx = cv.getContext('2d');
  if (terrainId !== grid) {
    terrainId = grid;
    const o = document.createElement('canvas'); o.width = W * PX; o.height = H * PX;
    const c = o.getContext('2d');
    c.fillStyle = '#2a2e36'; c.fillRect(0, 0, o.width, o.height);
    for (let r = 0; r < H; r++) for (let q = 0; q < W; q++) {
      const t = grid[r][q];
      if (t === '.') continue;
      c.fillStyle = t === '#' ? '#6a6458' : t === 'v' ? '#0a0b0e' : '#4a4e58';
      c.fillRect(q * PX, r * PX, PX, PX);
    }
    terrainImg = o;
  }
  ctx.drawImage(terrainImg, 0, 0);
  const X = x => (x + W / 2) * PX, Z = z => (z + H / 2) * PX;
  // 大本營
  for (const t of TEAMS) {
    const B = S.bases[t], F = S.forts[t];
    ctx.strokeStyle = CSS[t]; ctx.lineWidth = 2; ctx.strokeRect(X(B.x) - 26, Z(B.z) - 26, 52, 52);
    ctx.globalAlpha = 0.15; ctx.fillStyle = CSS[t]; ctx.beginPath(); ctx.arc(X(B.x), Z(B.z), CQ.healR * PX, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
    const k = F?.alive ? F.parts.torso.hp / F.parts.torso.max : 0;
    ctx.fillStyle = '#000'; ctx.fillRect(X(B.x) - 24, Z(B.z) + 30, 48, 6); ctx.fillStyle = CSS[t]; ctx.fillRect(X(B.x) - 24, Z(B.z) + 30, 48 * k, 6);
  }
  // 營地
  for (const c of S.camps) {
    const cd = campCountdown(c), r = c.outpost ? 12 : 9;
    ctx.strokeStyle = c.ph.kind === 'held' ? CSS[c.ph.team] : CSS.native; ctx.lineWidth = c.outpost ? 3 : 2;
    ctx.beginPath(); ctx.arc(X(c.x), Z(c.z), r, 0, 7); ctx.stroke();
    if (cd) {   // 倒數：圈上照比例畫一段 + 秒數
      const P = c.ph, frac = P.kind === 'held' ? cd.t / P.T : 1 - cd.t / P.T;
      ctx.strokeStyle = cd.css; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(X(c.x), Z(c.z), r + 3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, Math.min(1, frac))); ctx.stroke();
      ctx.fillStyle = cd.css; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(Math.ceil(cd.t), X(c.x), Z(c.z) + 4);
    }
    if (c.outpost) { ctx.fillStyle = '#ffd060'; ctx.font = '9px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('增援', X(c.x), Z(c.z) - r - 6); }
  }
  // 巢穴
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const n of S.nodes) {
    const c = CSS[n.owner];
    ctx.fillStyle = '#111a'; ctx.beginPath(); ctx.arc(X(n.x), Z(n.z), CQ.nodeR * PX, 0, 7); ctx.fill();
    ctx.strokeStyle = c; ctx.lineWidth = n.contested ? 4 : 2; ctx.stroke();
    if (n.capturing || Math.abs(n.prog) > 0.02 && !owned(n)) { ctx.strokeStyle = n.prog >= 0 ? CSS.blue : CSS.red; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(X(n.x), Z(n.z), CQ.nodeR * PX + 4, -Math.PI / 2, -Math.PI / 2 + Math.abs(n.prog) * Math.PI * 2); ctx.stroke(); }
    ctx.fillStyle = c; ctx.font = 'bold 14px sans-serif'; ctx.fillText(HIVES[n.type].short, X(n.x), Z(n.z));
  }
  // 機體
  for (const m of mechs) {
    if (!m.alive) continue;
    const ace = m.cq?.ace || m.cq?.fort, c = m.team === 'native' ? CSS.native : CSS[m.team] ?? '#fff';
    ctx.fillStyle = c;
    ctx.beginPath(); ctx.arc(X(m.x), Z(m.z), ace ? 5 : m.team === 'native' ? 2 : 3, 0, 7); ctx.fill();
    if (m.cq?.ace) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke(); ctx.fillStyle = '#fff'; ctx.font = 'bold 10px sans-serif'; ctx.fillText(String((m.team === 'red' ? 4 : 1) + m.cq.k), X(m.x), Z(m.z) - 11); }
  }
  // 鏡頭位置
  if (cam) { ctx.strokeStyle = '#fff8'; ctx.lineWidth = 1; ctx.strokeRect(X(cam.x) - 60, Z(cam.z) - 36, 120, 72); }
}
export function overviewStats() {
  if (!S) return '';
  const held = t => S.nodes.filter(n => n.owner === t).map(n => HIVES[n.type].short).join('') || '—';
  const row = (t, k) => {
    const e = S.aces[t][k], s = S.stats[t][k], R = S.respawns.find(r => r.team === t && r.k === k), bk = teamBuffs(t), P = bk.length ? CAMPS[bk[0]] : null;
    return `<tr><td style="color:${CSS[t]}">${(t === 'red' ? 4 : 1) + k}</td><td>${e.cq.lo.name}</td><td>${s.k}</td><td>${s.d}</td><td>${s.cap}</td><td>${s.camp}</td><td>${R ? `重組 ${Math.ceil(R.t)}s` : e.alive ? `${Math.round(e.parts.torso.hp / e.parts.torso.max * 100)}%${e.cq.retreat ? '・回營整備' : ''}${P ? `・<span style="color:${P.css}">${P.name}</span>` : ''}` : '—'}</td></tr>`;
  };
  const team = t => `<tr class="th"><td colspan="7" style="color:${CSS[t]}"><b>${TEAM_NAME[t]}</b>　${Math.floor(S.score[t])} 分・第 ${S.tier[t]} 階・巢穴 ${held(t)}・大本營 ${S.forts[t]?.alive ? Math.round(S.forts[t].parts.torso.hp / S.forts[t].parts.torso.max * 100) : 0}%・增援 ${Math.round(S.bar[t] * 100)}%・空投 ${S.drops[t]}・雜魚擊破 ${S.team[t].grunts}・營地 ${S.team[t].camps}</td></tr>` + [0, 1, 2].map(k => row(t, k)).join('');
  const log = S.log.slice(-8).reverse().map(l => `<div>${Math.floor(l.t / 60)}:${String(Math.floor(l.t % 60)).padStart(2, '0')}　${l.msg}</div>`).join('');
  return `<table><tr class="hd"><td></td><td>機體</td><td>擊墜</td><td>損毀</td><td>佔領</td><td>營地</td><td>狀態</td></tr>${team('blue')}${team('red')}</table><div class="cqlog">${log}</div>`;
}
