// ---------- 據點戰（docs/CONQUEST_PLAN.md）：3 對 3 主力機 + 九座蟲巢 + 野怪營地（全 AI 觀戰） ----------
// 地圖：blockgen.js conquestArena（152 × 112，點對稱，整張圖是一張通道網、沒有死路），大本營在左上（藍）/ 右下（紅），上 / 中 / 下三路 + 叢林小徑
// 據點 = 蟲巢：開場被原生的蟲族守著（隊伍 native，敵視雙方、不會重生）；守衛全滅 → 蟲巢被壓制，可以佔領、收割
// 巢穴種類：
//   母巢（正中央）、增援巢：增援條累積速度；條滿了 → 從自己的大本營空投一隊隨機雜魚
//   甲殼巢：全隊承受傷害 ×0.88、酸腺巢：全隊傷害 +12%、神經巢：全隊極速 +8%、發光巢：全隊能量回復 +30%（每多一座再疊一次）
// 野怪營地（CQ_CAMPS，6 個）：叢林小徑中間兩隻蟲，雜魚和營地的蟲互不理會（只有主力機會去清）；整個營地清掉 → 最後一擊的機體拿 45 秒的效果（狂暴：傷害 +20%；迅捷：極速 +15%、能量回復 +50%），
//   那一隊的增援條 +12%；75 秒後蟲子重新長出來
// 佔領：站在圈裡讀條（主力 1、雜魚 0.5，最快 ×1.5）；兩邊都有人 = 暫停；對方的據點要先讀回中立再讀成自己的
// 勝負：持有的巢穴每秒得分（母巢 ×2），先到 600 分，或 12 分鐘到時分數高的贏；大本營被打爆 = 直接敗北
// 主力機損毀 → 重組（4 秒 + 每多死一次 1 秒，最多 8），從大本營空降；不放擊墜特寫（G.noKillCam）
//   重組時調整陣容（counterPick）：照對面主力機的裝甲挑剋得住的配裝
// 大本營：要塞砲車（parts.js ELITES，遠征停用的據點防守機），耐久 ×2.5、綁在大本營 9 格內不追出去、不會重組
//   大本營 12 格內的己方機體（要塞自己除外）：部位每秒回 8%、壞掉的部位重新長回來（25%）、彈藥每秒回 6%
// 主力機、要塞腳下有派系色的光環，裝甲混一點隊伍色
// 落後方（分數差 60 以上）：重組、增援條 ×0.8 時間
// AI：隊伍指揮每 2 秒替每台主力機挑一個目標（巢穴 / 營地：價值 ÷ 距離、分散、回防）；附近 24 格（雜魚 18 格）沒有看得到的敵人 → 照路線走去目標，有 → 照原本的戰術打
// 戰績（S.stats）：每台主力機的擊墜 / 損毀 / 佔領 / 營地；隊伍的雜魚擊破、空投（main.js 的 Tab 總覽）
import * as THREE from 'three';
import { G, addMat, scene } from './core.js';
import { H as MAP_H, W as MAP_W, grid, isSolid, rayBlock } from './arena.js';
import { mechs, syncWear } from './mech.js';
import { DIFFS, enemies, spawnEnemy } from './ai.js';
import { EFFECT, ELITES, ENEMY_PRESETS, NEW_ACES, SQUADS, WEAPONS, gruntOf } from './parts.js';
import { repairFx } from './fx.js';
import { packUnits } from './heavy.js';
import { routeDir } from './pathing.js';
import { CQ_CAMPS, CQ_NODES } from './blockgen.js';

export const CQ = {
  winScore: 600, timeLimit: 720, capT: 6, nodeR: 4.5, scoreRate: 0.35, gruntCap: 12,
  reinforceT: 90,   // 增援條：什麼巢都沒有 90 秒滿一次；每座增援巢 +1 倍速、母巢 +2
  respawn: 4, respawnAdd: 1, respawnMax: 8, behindGap: 60, behindK: 0.8,
  engageAce: 24, engageGrunt: 18, bugWake: 20, bugHold: 8,
  fortHpK: 2.5, fortHold: 9, healR: 12, healK: 0.08, ammoK: 0.06,
  campHold: 5, campWake: 13, campRespawn: 75, campBuffT: 45, campBar: 0.12,
  dropSquads: ['patrol', 'missile', 'breakers', 'gunline', 'hunters'],
};
// 巢穴種類：value = 隊伍指揮眼中的價值；guards = 守衛小隊
export const HIVES = {
  core: { name: '母巢', short: '母', desc: '增援條 +2 倍速・得分 ×2', value: 1.5, guards: ['hive', 'stampede'], sac: 0xff60ff },
  reinforce: { name: '增援巢', short: '援', desc: '增援條 +1 倍速', value: 1.15, guards: ['hive'], sac: 0xffd040 },
  armor: { name: '甲殼巢', short: '甲', desc: '全隊承受傷害 ×0.88', value: 1, guards: ['stampede'], sac: 0x60a0ff },
  attack: { name: '酸腺巢', short: '攻', desc: '全隊傷害 +12%', value: 1, guards: ['hive'], sac: 0xb8ff40 },
  speed: { name: '神經巢', short: '速', desc: '全隊極速 +8%', value: 0.9, guards: ['swarm'], sac: 0x40fff0 },
  energy: { name: '發光巢', short: '能', desc: '全隊能量回復 +30%', value: 0.9, guards: ['swarm'], sac: 0xffffff },
};
// 野怪營地：units 兩隻蟲、buff = 最後一擊那台拿到的效果
export const CAMPS = {
  rage: { name: '狂暴', units: ['needler', 'gunner'], buff: { dmg: 0.2 }, hex: 0xff5040, css: '#ff7060' },
  haste: { name: '迅捷', units: ['lancer', 'needler'], buff: { speed: 0.15, regen: 0.5 }, hex: 0x40e0ff, css: '#60e0ff' },
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
export const cqState = () => S;

// 蟲巢的樣子：土丘 + 發光的卵囊（顏色 = 種類）；地上一圈（顏色 = 持有方）+ 讀條的內圈
const MOUND = new THREE.BoxGeometry(1, 1, 1), RING = new THREE.RingGeometry(CQ.nodeR - 0.25, CQ.nodeR, 48), DISC = new THREE.CircleGeometry(CQ.nodeR - 0.3, 48);
const CAMP_RING = new THREE.RingGeometry(2.6, 2.85, 32);
function buildNode(n) {
  const g = new THREE.Group(), big = n.type === 'core' ? 1.4 : 1;
  const dirt = new THREE.MeshLambertMaterial({ color: 0x4a3a2a }), sac = addMat(HIVES[n.type].sac, 0.9);
  for (const [x, z, w, h, d] of [[0, 0, 2.2, 0.9, 2.2], [0.3, -0.2, 1.4, 1.5, 1.3], [-0.5, 0.6, 1, 0.7, 1], [0.9, 0.8, 0.8, 0.5, 0.9], [-0.8, -0.7, 0.9, 0.6, 0.8]]) {
    const m = new THREE.Mesh(MOUND, dirt); m.scale.set(w * big, h * big, d * big); m.position.set(x * big, h * big / 2, z * big); g.add(m);
  }
  for (const [x, y, z] of [[0.6, 1.1, 0.3], [-0.3, 1.4, -0.4], [-0.7, 0.75, 0.6], [1.1, 0.55, 1]]) {
    const m = new THREE.Mesh(MOUND, sac); m.scale.setScalar(0.32 * big); m.position.set(x * big, y * big, z * big); g.add(m);
  }
  n.sacMat = sac;
  const ring = new THREE.Mesh(RING, addMat(HEX.native, 0.75)); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; g.add(ring);
  const disc = new THREE.Mesh(DISC, addMat(HEX.blue, 0.22)); disc.rotation.x = -Math.PI / 2; disc.position.y = 0.04; disc.scale.setScalar(0.001); g.add(disc);
  g.position.set(n.x, 0, n.z);
  scene.add(g);
  Object.assign(n, { g, ring, disc });
}
// 營地：地上一圈（顏色 = 效果種類；蟲還沒長出來時變暗）
function buildCamp(c) {
  const ring = new THREE.Mesh(CAMP_RING, addMat(CAMPS[c.kind].hex, 0.55));
  ring.rotation.x = -Math.PI / 2; ring.position.set(c.x, 0.05, c.z);
  scene.add(ring);
  c.g = ring;
}
export function clearConquest() {
  if (!S) return;
  for (const n of S.nodes) scene.remove(n.g);
  for (const c of S.camps) scene.remove(c.g);
  S = null;
}

// 主力機的配裝池：一般機體（ENEMY_PRESETS，各種武器類型）+ 新數值王牌（NEW_ACES）→ 打得掉建築的、穿牆的、近戰的都有機會出場
const ACE_POOL = [...new Map([...ENEMY_PRESETS, ...NEW_ACES].map(p => [p.name, p])).values()];
const pickAce = () => ACE_POOL[Math.floor(Math.random() * ACE_POOL.length)];
// 重新出擊時調整陣容：照對面主力機的裝甲挑剋得住的配裝（武器屬性 × 裝甲的倍率平均，加一點隨機），隊友正在用的不重複
function counterPick(team, k) {
  const foes = S.aces[foeTeam(team)].map(e => e.cq.lo.armor?.torso ?? 'composite');
  const mates = new Set(S.aces[team].filter((e, j) => j !== k).map(e => e.cq.lo.name));
  let best = null, bs = -Infinity;
  for (const lo of ACE_POOL) {
    if (mates.has(lo.name)) continue;
    const types = ['armL', 'armR', 'backL', 'backR'].map(sl => WEAPONS[lo[sl]]).filter(d => d && d.kind !== 'shield' && d.kind !== 'module').map(d => d.type);
    if (!types.length) continue;
    const sc = foes.reduce((a, ar) => a + types.reduce((b, t) => b + (EFFECT[t]?.[ar] ?? 1), 0) / types.length, 0) / foes.length + Math.random() * 0.25;
    if (sc > bs) { bs = sc; best = lo; }
  }
  return best ?? pickAce();
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
  const stat = () => ({ k: 0, d: 0, cap: 0, camp: 0 });
  S = { t: 0, toast, bases: { blue: map.bases[0], red: map.bases[1] },
    score: { blue: 0, red: 0 }, drops: { blue: 0, red: 0 }, kills: { blue: 0, red: 0 }, bar: { blue: 0, red: 0 }, buffs: { blue: {}, red: {} },
    stats: { blue: [stat(), stat(), stat()], red: [stat(), stat(), stat()] }, team: { blue: { grunts: 0, camps: 0 }, red: { grunts: 0, camps: 0 } },
    result: null, cmdT: 0, focus: 0, aces: { blue: [], red: [] }, forts: {}, deaths: new Map(), respawns: [], log: [],
    nodes: CQ_NODES.map((p, i) => ({ i, key: `cq${i}`, type: p.type, name: HIVES[p.type].name, x: p.x, z: p.z, owner: 'native', prog: 0, guards: [], contested: false, capturing: null })),
    camps: CQ_CAMPS.map((p, i) => ({ i, key: `cqc${i}`, camp: true, kind: p.kind, x: p.x, z: p.z, units: [], respawn: 0 })) };
  for (const n of S.nodes) buildNode(n);
  for (const c of S.camps) { buildCamp(c); spawnCamp(c); }
  for (const team of TEAMS) {
    const B = baseOf(team), F0 = front(team, 6);
    for (let k = 0; k < 3; k++) S.aces[team].push(spawnAce(team, pickAce(), spreadAt(F0.x, F0.z, S.aces[team], 0, 4), k, true));
    // 大本營：要塞砲車
    const F = spawnEnemy(ANCHOR, { ...ELITES.find(E => E.name === '要塞砲車'), id: 'fortress' }, { x: B.x, z: B.z }, { team, colors: COLORS[team], diff: DIFFS.hard, noDrop: true });
    for (const q of Object.values(F.parts)) { q.max *= CQ.fortHpK; q.hp = q.max; }
    F.hold = { x: B.x, z: B.z, r: CQ.fortHold };
    faceCenter(F, team);
    tagUnit(F, team, { fort: true });
    addRing(F, team);
    S.forts[team] = F;
  }
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
  toast('據點戰・壓制蟲巢、佔領後收割；叢林裡的野怪營地給短時間的強化・Tab 打開地圖與戰績');
}
function spawnCamp(c) {
  const taken = [];
  c.units = CAMPS[c.kind].units.map(u => {
    const at = spreadAt(c.x, c.z, taken, 0.8, 2.2); taken.push(at);
    const e = spawnEnemy(ANCHOR, gruntOf(u), at, { team: 'native', colors: COLORS.native, diff: DIFFS.normal, grunt: true, noDrop: true });
    e.hold = { x: c.x, z: c.z, r: CQ.campHold }; e.dormant = true; e.cq = { camp: c };
    return e;
  });
  c.g.material.opacity = 0.55;
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
    if (!hostile(e, o) || (o.dormant && e.team !== 'native')) continue;
    const d = Math.hypot(o.x - e.x, o.z - e.z);
    if (d < bd) { bd = d; best = o; }
  }
  return best ? { o: best, d: bd } : null;
}
const sees = (e, o, d) => rayBlock(e.x, e.z, (o.x - e.x) / d, (o.z - e.z) / d, d) >= d - o.r - 0.5;
const behind = team => S.score[team] + CQ.behindGap < S.score[foeTeam(team)];

// 隊伍指揮：替每台主力機挑目標（巢穴；附近有長好的營地、身上沒有效果 → 營地也算）
function command(team) {
  const live = S.aces[team].filter(e => e.alive && !e.drop);
  const goals = [
    ...S.nodes.map(n => {
      const threat = n.capturing === foeTeam(team) || mechs.some(o => o.alive && o.team === foeTeam(team) && !o.grunt && Math.hypot(o.x - n.x, o.z - n.z) < 12);
      const v = HIVES[n.type].value;
      return { g: n, v: n.owner === team ? (threat ? v * 1.4 : 0.1) : n.owner === foeTeam(team) ? v * 1.15 : v };
    }),
    ...S.camps.filter(c => c.units.some(u => u.alive)).map(c => ({ g: c, v: 0.55, camp: true })),
  ];
  const count = new Map();
  const order = live.map(e => ({ e, d: Math.min(...S.nodes.map(n => Math.hypot(n.x - e.x, n.z - e.z))) })).sort((a, b) => a.d - b.d);
  for (const { e } of order) {
    let best = null, bs = -Infinity;
    for (const G of goals) {
      if (G.camp && e.cq.buff && S.t < e.cq.buff.until) continue;
      const d = Math.hypot(G.g.x - e.x, G.g.z - e.z), s = G.v / (1 + d / (G.camp ? 12 : 20)) - (count.get(G.g) ?? 0) * (G.camp ? 1 : 0.4) + (e.cq.goal === G.g ? 0.08 : 0);
      if (s > bs) { bs = s; best = G.g; }
    }
    e.cq.goal = best; count.set(best, (count.get(best) ?? 0) + 1);
  }
}
// 雜魚：去最近的「不是自己的」巢穴（或自己的、正在被搶的）
function gruntGoal(e) {
  let best = null, bd = Infinity;
  for (const n of S.nodes) if (n.owner !== e.team || n.capturing === foeTeam(e.team)) { const d = Math.hypot(n.x - e.x, n.z - e.z); if (d < bd) { bd = d; best = n; } }
  return best ?? S.nodes[0];
}
function driveTo(e, n) {
  const dx = n.x - e.x, dz = n.z - e.z, d = Math.hypot(dx, dz) || 1;
  if (d < (n.camp ? 2 : CQ.nodeR - 1.2)) { e.drive = { mx: 0, mz: 0 }; return; }
  const f = (!e.fly && routeDir(n.key, G.now, e.x, e.z, n.x, n.z)) || { x: dx / d, z: dz / d };
  e.drive = { mx: f.x, mz: f.z };
  e.aimYaw = Math.atan2(f.x, f.z);
}

// 每幀，updateEnemy 之前：挑對手、蟲醒不醒、全隊 / 個人效果
export function preUpdate(dt) {
  if (!S) return;
  for (const e of enemies) {
    if (!e.alive || !e.cq) continue;
    const H = nearestHostile(e);
    if (e.team === 'native') { e.dormant = !(H && H.d < (e.cq.camp ? CQ.campWake : CQ.bugWake)); if (H) e.foe = H.o; continue; }
    e.foe = H?.o ?? null;
    e.cq.near = H;
    const B = S.buffs[e.team], b = e.cq.base, P = e.cq.buff && S.t < e.cq.buff.until ? CAMPS[e.cq.buff.kind].buff : {};
    e.dmgMul = b.dmg * (1 + 0.12 * (B.attack ?? 0)) * (1 + (P.dmg ?? 0));
    e.spec.vmax = b.vmax * (1 + 0.08 * (B.speed ?? 0)) * (1 + (P.speed ?? 0));
    e.spec.regen = b.regen * (1 + 0.3 * (B.energy ?? 0)) * (1 + (P.regen ?? 0));
    e.takeK = 0.88 ** (B.armor ?? 0);
    if (e.cq.ring) {
      const on = e.cq.buff && S.t < e.cq.buff.until;
      e.cq.ring.material.color.setHex(on ? CAMPS[e.cq.buff.kind].hex : COLORS[e.team].glow);
      e.cq.ring.material.opacity = on ? 0.55 + 0.35 * Math.abs(Math.sin(G.now * 5)) : 0.6;
    }
  }
}
// 每幀，updateEnemy 之後（driveMech 之前）：附近沒有看得到的敵人 → 照路線走去目標
export function postUpdate(e) {
  if (!S || !e.alive || !e.cq || e.team === 'native' || e.drop || e.cq.fort) return;
  const H = e.cq.near, R = e.grunt ? CQ.engageGrunt : CQ.engageAce;
  if (H && (H.d < 12 || (H.d < R && sees(e, H.o, H.d)))) return;
  const n = e.grunt ? (e.cq.goal ??= gruntGoal(e)) : e.cq.goal;
  if (n) driveTo(e, n);
}
const note = msg => { S.toast(msg); S.log.push({ t: S.t, msg }); if (S.log.length > 40) S.log.shift(); };

export function updateConquest(dt) {
  if (!S || S.result) return S?.result;
  S.t += dt;
  if ((S.cmdT -= dt) <= 0) {
    S.cmdT = 2;
    for (const t of TEAMS) command(t);
    for (const e of enemies) if (e.alive && e.grunt && e.cq && e.team !== 'native') e.cq.goal = gruntGoal(e);
  }
  for (const t of TEAMS) S.buffs[t] = {};
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
          n.owner = T; note(`${TEAM_NAME[T]}佔領${n.name}・${HIVES[n.type].desc}`);
          for (const e of S.aces[T]) if (e.alive && Math.hypot(e.x - n.x, e.z - n.z) <= CQ.nodeR + 1) S.stats[T][e.cq.k].cap++;
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
      if (n.type === 'core') B.reinforce = (B.reinforce ?? 0) + 2;
      else B[n.type] = (B[n.type] ?? 0) + 1;
    }
    // 樣子
    n.ring.material.color.setHex(HEX[n.owner]);
    n.ring.material.opacity = n.contested ? 0.4 + 0.4 * Math.abs(Math.sin(G.now * 8)) : 0.75;
    n.disc.scale.setScalar(Math.max(0.001, Math.abs(n.prog)));
    n.disc.material.color.setHex(n.prog >= 0 ? HEX.blue : HEX.red);
    n.sacMat.opacity = n.owner === 'native' ? 0.6 + 0.3 * Math.sin(G.now * 3 + n.i) : owned(n) ? 0.95 : 0.35;
  }
  // 營地重生
  for (const c of S.camps) if (c.respawn > 0 && (c.respawn -= dt) <= 0) { c.respawn = 0; spawnCamp(c); }
  // 增援條：滿了 → 從大本營空投一隊（場上雜魚滿了就等）
  for (const t of TEAMS) {
    S.bar[t] = Math.min(1, S.bar[t] + dt * (1 + (S.buffs[t].reinforce ?? 0)) / (CQ.reinforceT * (behind(t) ? CQ.behindK : 1)));
    if (S.bar[t] >= 1 && dropSquad(t)) S.bar[t] = 0;
  }
  // 大本營旁：修理、長回壞掉的部位、補彈藥
  for (const e of enemies) {
    if (!e.alive || !e.cq || e.cq.fort || e.team === 'native' || e.drop) continue;
    const B = baseOf(e.team);
    if (Math.hypot(e.x - B.x, e.z - B.z) > CQ.healR) continue;
    let fixed = false;
    for (const [k, q] of Object.entries(e.parts)) {
      if (q.broken) {
        q.broken = false; q.hp = q.max * 0.25; fixed = true;
        if (k === 'legs') { if (e.cq.legHex != null) q.mat.color.setHex(e.cq.legHex); } else if (!e.bug) q.g.visible = true;
        syncWear(e, k, 0, 0, true);
      } else if (q.hp < q.max) { q.hp = Math.min(q.max, q.hp + q.max * CQ.healK * dt); if (Math.random() < dt * 2) syncWear(e, k, 0, 0, true); }
    }
    for (const g of Object.values(e.guns)) if (g.max !== Infinity && g.ammo < g.max) g.ammo = Math.min(g.max, g.ammo + g.max * CQ.ammoK * dt);
    if (fixed) repairFx(e, e.x, 0.9, e.z, 20, 0.4, 4);
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
function dropSquad(team) {
  const live = enemies.filter(e => e.alive && e.grunt && e.team === team).length;
  const key = CQ.dropSquads[Math.floor(Math.random() * CQ.dropSquads.length)], units = packUnits(SQUADS, key);
  if (live + units.length > CQ.gruntCap) return false;
  S.drops[team]++;
  const F = front(team, 4), taken = [];
  for (const u of units) {
    const at = spreadAt(F.x, F.z, taken, 1, 5); taken.push(at);
    tagUnit(spawnEnemy(ANCHOR, gruntOf(u), at, { team, colors: COLORS[team + 'grunt'], diff: DIFFS.hard, grunt: true }), team);
  }
  return true;
}
// 機體損毀（main.js AI.onEnemyDeath）：大本營 → 敗北；營地清空 → 獎勵；主力機 → 戰績、排重組
export function conquestDeath(e) {
  if (!S) return;
  const by = e.lastHitBy?.cq?.team && e.lastHitBy.cq.team !== 'native' ? e.lastHitBy : null;
  if (e.cq?.fort && !S.result) { S.result = foeTeam(e.cq.team); S.baseKill = true; note(`${TEAM_NAME[e.cq.team]}的大本營被摧毀`); return; }
  const C = e.cq?.camp;
  if (C) {
    if (C.units.some(u => u.alive) || C.respawn > 0) return;
    C.respawn = CQ.campRespawn; C.g.material.opacity = 0.15;
    if (!by) return;
    const T = by.cq.team, K = CAMPS[C.kind];
    S.bar[T] = Math.min(1, S.bar[T] + CQ.campBar);
    by.cq.buff = { kind: C.kind, until: S.t + CQ.campBuffT };
    S.team[T].camps++;
    if (by.cq.ace) S.stats[T][by.cq.k].camp++;
    note(`${TEAM_NAME[T]}${by.cq.ace ? `的 ${by.cq.lo.name}` : '的雜魚'}清掉營地・${K.name} ${CQ.campBuffT} 秒・增援 +${Math.round(CQ.campBar * 100)}%`);
    return;
  }
  if (e.grunt && e.cq?.team && by) { S.team[by.cq.team].grunts++; return; }
  if (!e.cq?.ace) return;
  const team = e.cq.team, k = e.cq.k;
  S.kills[foeTeam(team)]++;
  S.stats[team][k].d++;
  if (by?.cq.ace) S.stats[by.cq.team][by.cq.k].k++;
  if (S.aces[team][k] !== e) return;
  const n = (S.deaths.get(`${team}${k}`) ?? 0) + 1;
  S.deaths.set(`${team}${k}`, n);
  const t = Math.min(CQ.respawnMax, CQ.respawn + CQ.respawnAdd * (n - 1)) * (behind(team) ? CQ.behindK : 1);
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
export function teamList(team) {
  if (!S) return '';
  const B = S.buffs[team], buff = ['armor', 'attack', 'speed', 'energy'].filter(k => B[k]).map(k => `${HIVES[k].short}×${B[k]}`).join(' ');
  return S.aces[team].map((e, k) => {
    const R = S.respawns.find(r => r.team === team && r.k === k), P = e.cq.buff && S.t < e.cq.buff.until ? CAMPS[e.cq.buff.kind] : null;
    return `<span class="wt" style="--c:${P ? P.css : CSS[team]}${e.alive ? '' : ';opacity:.45'}">${e.cq.lo.name}${R ? ` 重組 ${Math.ceil(R.t)}s` : ''}${P && e.alive ? `・${P.name}` : ''}</span>`;
  }).join('') + (S.forts[team] ? `<span class="wt" style="--c:${CSS[team]}">大本營 ${S.forts[team].alive ? Math.round(S.forts[team].parts.torso.hp / S.forts[team].parts.torso.max * 100) : 0}%</span>` : '') + `<span class="wt" style="--c:#8a96a6">增援 ${Math.round(S.bar[team] * 100)}%・雜魚 ${enemies.filter(e => e.alive && e.grunt && e.team === team).length}</span>` + (buff ? `<span class="wt" style="--c:#c8d070">${buff}</span>` : '');
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
    ctx.strokeStyle = c.respawn > 0 ? '#555' : CAMPS[c.kind].css; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(X(c.x), Z(c.z), 9, 0, 7); ctx.stroke();
    if (c.respawn > 0) { ctx.fillStyle = '#888'; ctx.font = '10px sans-serif'; ctx.textAlign = 'center'; ctx.fillText(Math.ceil(c.respawn), X(c.x), Z(c.z) + 4); }
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
    const e = S.aces[t][k], s = S.stats[t][k], R = S.respawns.find(r => r.team === t && r.k === k), P = e.cq.buff && S.t < e.cq.buff.until ? CAMPS[e.cq.buff.kind] : null;
    return `<tr><td style="color:${CSS[t]}">${(t === 'red' ? 4 : 1) + k}</td><td>${e.cq.lo.name}</td><td>${s.k}</td><td>${s.d}</td><td>${s.cap}</td><td>${s.camp}</td><td>${R ? `重組 ${Math.ceil(R.t)}s` : e.alive ? `${Math.round(e.parts.torso.hp / e.parts.torso.max * 100)}%${P ? `・<span style="color:${P.css}">${P.name}</span>` : ''}` : '—'}</td></tr>`;
  };
  const team = t => `<tr class="th"><td colspan="7" style="color:${CSS[t]}"><b>${TEAM_NAME[t]}</b>　${Math.floor(S.score[t])} 分・巢穴 ${held(t)}・大本營 ${S.forts[t]?.alive ? Math.round(S.forts[t].parts.torso.hp / S.forts[t].parts.torso.max * 100) : 0}%・增援 ${Math.round(S.bar[t] * 100)}%・空投 ${S.drops[t]}・雜魚擊破 ${S.team[t].grunts}・營地 ${S.team[t].camps}</td></tr>` + [0, 1, 2].map(k => row(t, k)).join('');
  const log = S.log.slice(-8).reverse().map(l => `<div>${Math.floor(l.t / 60)}:${String(Math.floor(l.t % 60)).padStart(2, '0')}　${l.msg}</div>`).join('');
  return `<table><tr class="hd"><td></td><td>機體</td><td>擊墜</td><td>損毀</td><td>佔領</td><td>營地</td><td>狀態</td></tr>${team('blue')}${team('red')}</table><div class="cqlog">${log}</div>`;
}
