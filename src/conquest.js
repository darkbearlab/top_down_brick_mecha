// ---------- 據點戰（docs/CONQUEST_PLAN.md）：3 對 3 主力機 + 九座蟲巢（第一版：全 AI 觀戰） ----------
// 地圖：blockgen.js bigArena(…, true)，3 × 3 塊據點空地（x、z = -22 / 0 / 22），兩邊大本營在 x = ±42
// 據點 = 蟲巢：開場被原生的蟲族守著（隊伍 native，敵視雙方、不會重生）；守衛全滅 → 蟲巢被壓制，可以佔領、收割
// 巢穴種類（點對稱：轉 180° 後同一種 → 兩邊公平）：
//   母巢（正中央）、增援巢（兩邊大本營前面）：增援條累積速度；條滿了 → 從自己的大本營空投一隊隨機雜魚
//   甲殼巢：全隊承受傷害 ×0.88、酸腺巢：全隊傷害 +12%、神經巢：全隊極速 +8%、發光巢：全隊能量回復 +30%（每多一座再疊一次）
// 佔領：站在圈裡讀條（主力 1、雜魚 0.5，最快 ×1.5）；兩邊都有人 = 暫停；對方的據點要先讀回中立再讀成自己的
// 勝負：持有的巢穴每秒得分（母巢 ×2），先到 600 分，或 12 分鐘到時分數高的贏
// 主力機損毀 → 重組（4 秒 + 每多死一次 1 秒，最多 8），從大本營空降；不放擊墜特寫（G.noKillCam）
// 落後方（分數差 60 以上）：重組、增援條 ×0.8 時間
// AI：隊伍指揮每 2 秒替每台主力機挑一個巢穴（價值 ÷ 距離、分散、回防）；附近 24 格（雜魚 18 格）沒有看得到的敵人 → 照路線走去目標，有 → 照原本的戰術打
import * as THREE from 'three';
import { G, addMat, scene } from './core.js';
import { rayBlock, isSolid } from './arena.js';
import { mechs } from './mech.js';
import { DIFFS, enemies, spawnEnemy } from './ai.js';
import { NEW_ACES, SQUADS, gruntOf } from './parts.js';
import { packUnits } from './heavy.js';
import { routeDir } from './pathing.js';
import { CQ_NODES } from './blockgen.js';

export const CQ = {
  winScore: 600, timeLimit: 720, capT: 6, nodeR: 4.5, scoreRate: 0.35, gruntCap: 12,
  reinforceT: 90,   // 增援條：什麼巢都沒有 90 秒滿一次；每座增援巢 +1 倍速、母巢 +2
  respawn: 4, respawnAdd: 1, respawnMax: 8, behindGap: 60, behindK: 0.8,
  engageAce: 24, engageGrunt: 18, bugWake: 20, bugHold: 8,
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
// CQ_NODES 的順序：z = -22 那排（x -22, 0, 22）、z = 0、z = 22
const LAYOUT = ['attack', 'speed', 'armor', 'reinforce', 'core', 'reinforce', 'armor', 'energy', 'attack'];
const TEAMS = ['blue', 'red'];
const COLORS = {
  blue: { accent: 0x3a8cff, glow: 0x90c0ff },
  red: { accent: 0xff5a30, glow: 0xffa080 },
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
function buildNode(n) {
  const g = new THREE.Group(), big = n.type === 'core' ? 1.4 : 1;
  const dirt = new THREE.MeshLambertMaterial({ color: 0x4a3a2a }), sac = addMat(HIVES[n.type].sac, 0.9);
  for (const [x, z, w, h, d] of [[0, 0, 2.2, 0.9, 2.2], [0.3, -0.2, 1.4, 1.5, 1.3], [-0.5, 0.6, 1, 0.7, 1], [0.9, 0.8, 0.8, 0.5, 0.9], [-0.8, -0.7, 0.9, 0.6, 0.8]]) {
    const m = new THREE.Mesh(MOUND, dirt); m.scale.set(w * big, h * big, d * big); m.position.set(x * big, h * big / 2, z * big); g.add(m);
  }
  n.sacs = [];
  for (const [x, y, z] of [[0.6, 1.1, 0.3], [-0.3, 1.4, -0.4], [-0.7, 0.75, 0.6], [1.1, 0.55, 1]]) {
    const m = new THREE.Mesh(MOUND, sac); m.scale.setScalar(0.32 * big); m.position.set(x * big, y * big, z * big); g.add(m); n.sacs.push(m);
  }
  n.sacMat = sac;
  const ring = new THREE.Mesh(RING, addMat(HEX.native, 0.75)); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.05; g.add(ring);
  const disc = new THREE.Mesh(DISC, addMat(HEX.blue, 0.22)); disc.rotation.x = -Math.PI / 2; disc.position.y = 0.04; disc.scale.setScalar(0.001); g.add(disc);
  g.position.set(n.x, 0, n.z);
  scene.add(g);
  Object.assign(n, { g, ring, disc });
}
export function clearConquest() {
  if (!S) return;
  for (const n of S.nodes) scene.remove(n.g);
  S = null;
}

const pickAce = () => NEW_ACES[Math.floor(Math.random() * NEW_ACES.length)];
const baseOf = team => ({ x: team === 'blue' ? -S.side : S.side, z: 0 });
const foeTeam = t => t === 'blue' ? 'red' : 'blue';
const owned = n => n.owner === 'blue' || n.owner === 'red';
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

// side：大本營的 x（resetWorld 之後的 SIDE_B.x）；toast：main.js 的提示
export function startConquest(side, toast) {
  clearConquest();
  S = { t: 0, side, toast, score: { blue: 0, red: 0 }, drops: { blue: 0, red: 0 }, kills: { blue: 0, red: 0 }, bar: { blue: 0, red: 0 }, buffs: { blue: {}, red: {} },
    result: null, cmdT: 0, focus: 0, aces: { blue: [], red: [] }, deaths: new Map(), respawns: [],
    nodes: CQ_NODES.map((p, i) => ({ i, type: LAYOUT[i], name: HIVES[LAYOUT[i]].name, x: p.x, z: p.z, owner: 'native', prog: 0, guards: [], contested: false, capturing: null })) };
  for (const n of S.nodes) buildNode(n);
  const anchor = { x: 0, z: 0, alive: true, team: 'none' };
  for (const team of TEAMS) {
    const B = baseOf(team);
    for (let k = 0; k < 3; k++) S.aces[team].push(spawnAce(team, pickAce(), { x: B.x, z: B.z + (k - 1) * 6 }, true));
  }
  // 蟲巢守衛
  for (const n of S.nodes) {
    const taken = [];
    for (const key of HIVES[n.type].guards) for (const u of packUnits(SQUADS, key)) {
      const at = spreadAt(n.x, n.z, taken, 2, 6); taken.push(at);
      const e = spawnEnemy(anchor, gruntOf(u), at, { team: 'native', colors: COLORS.native, diff: DIFFS.normal, grunt: true, noDrop: true });
      e.hold = { x: n.x, z: n.z, r: CQ.bugHold }; e.dormant = true; e.cq = { node: n };
      n.guards.push(e);
    }
  }
  toast('據點戰・壓制蟲巢、佔領後收割：每座巢穴有不同的全隊效果，持有越多得分越快・先到 600 分');
}
function tagUnit(e, team, extra) {
  e.cq = { team, goal: null, base: { dmg: e.dmgMul ?? 1, vmax: e.spec.vmax, regen: e.spec.regen ?? 1 }, ...extra };
  return e;
}
function spawnAce(team, lo, at, noDrop = false) {
  const e = spawnEnemy({ x: 0, z: 0, alive: true, team: 'none' }, lo, at, { team, colors: COLORS[team], diff: DIFFS.hard, noDrop });
  tagUnit(e, team, { ace: true, lo });
  e.aimYaw = e.torsoYaw = e.legYaw = team === 'blue' ? Math.PI / 2 : -Math.PI / 2;
  return e;
}

const hostile = (a, b) => b !== a && b.alive && !b.drop && b.team !== a.team && b.team !== 'none';
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

// 隊伍指揮：替每台主力機挑巢穴
function command(team) {
  const live = S.aces[team].filter(e => e.alive && !e.drop);
  const want = S.nodes.map(n => {
    const threat = n.capturing === foeTeam(team) || mechs.some(o => o.alive && o.team === foeTeam(team) && !o.grunt && Math.hypot(o.x - n.x, o.z - n.z) < 12);
    const v = HIVES[n.type].value;
    return n.owner === team ? (threat ? v * 1.4 : 0.1) : n.owner === foeTeam(team) ? v * 1.15 : v;
  });
  const count = S.nodes.map(() => 0);
  const order = live.map(e => ({ e, d: Math.min(...S.nodes.map(n => Math.hypot(n.x - e.x, n.z - e.z))) })).sort((a, b) => a.d - b.d);
  for (const { e } of order) {
    let best = null, bs = -Infinity;
    for (const n of S.nodes) {
      const d = Math.hypot(n.x - e.x, n.z - e.z), s = want[n.i] / (1 + d / 20) - count[n.i] * 0.4 + (e.cq.goal === n ? 0.08 : 0);
      if (s > bs) { bs = s; best = n; }
    }
    e.cq.goal = best; count[best.i]++;
  }
}
// 雜魚：去最近的「不是自己的」巢穴（或自己的、正在被搶的）
function gruntGoal(e) {
  let best = null, bd = Infinity;
  for (const n of S.nodes) if (n.owner !== e.team || n.capturing === foeTeam(e.team)) { const d = Math.hypot(n.x - e.x, n.z - e.z); if (d < bd) { bd = d; best = n; } }
  return best ?? S.nodes[4];
}
function driveTo(e, n) {
  const dx = n.x - e.x, dz = n.z - e.z, d = Math.hypot(dx, dz) || 1;
  if (d < CQ.nodeR - 1.2) { e.drive = { mx: 0, mz: 0 }; return; }
  const f = (!e.fly && routeDir(`cq${n.i}`, G.now, e.x, e.z, n.x, n.z)) || { x: dx / d, z: dz / d };
  e.drive = { mx: f.x, mz: f.z };
  e.aimYaw = Math.atan2(f.x, f.z);
}

// 每幀，updateEnemy 之前：挑對手、蟲醒不醒、全隊效果
export function preUpdate(dt) {
  if (!S) return;
  for (const e of enemies) {
    if (!e.alive || !e.cq) continue;
    const H = nearestHostile(e);
    if (e.team === 'native') { e.dormant = !(H && H.d < CQ.bugWake); if (H) e.foe = H.o; continue; }
    e.foe = H?.o ?? null;
    e.cq.near = H;
    const B = S.buffs[e.team], b = e.cq.base;
    e.dmgMul = b.dmg * (1 + 0.12 * (B.attack ?? 0));
    e.spec.vmax = b.vmax * (1 + 0.08 * (B.speed ?? 0));
    e.spec.regen = b.regen * (1 + 0.3 * (B.energy ?? 0));
    e.takeK = 0.88 ** (B.armor ?? 0);
  }
}
// 每幀，updateEnemy 之後（driveMech 之前）：附近沒有看得到的敵人 → 照路線走去目標
export function postUpdate(e) {
  if (!S || !e.alive || !e.cq || e.team === 'native' || e.drop) return;
  const H = e.cq.near, R = e.grunt ? CQ.engageGrunt : CQ.engageAce;
  if (H && (H.d < 12 || (H.d < R && sees(e, H.o, H.d)))) return;
  const n = e.grunt ? (e.cq.goal ??= gruntGoal(e)) : e.cq.goal;
  if (n) driveTo(e, n);
}

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
    if (!guards && n.owner === 'native') { n.owner = 'none'; S.toast(`${n.name}被壓制了・可以佔領`); }
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
        if (n.owner === foeTeam(T)) { if (sg * n.prog >= 0) { n.owner = 'none'; S.toast(`${n.name}被中立化`); } }   // 對方的：先讀回中立
        else if (sg * n.prog >= 1) { n.owner = T; S.toast(`${T === 'blue' ? '藍隊' : '紅隊'}佔領${n.name}・${HIVES[n.type].desc}`); }
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
  // 增援條：滿了 → 從大本營空投一隊（場上雜魚滿了就等）
  for (const t of TEAMS) {
    S.bar[t] = Math.min(1, S.bar[t] + dt * (1 + (S.buffs[t].reinforce ?? 0)) / (CQ.reinforceT * (behind(t) ? CQ.behindK : 1)));
    if (S.bar[t] >= 1 && dropSquad(t)) S.bar[t] = 0;
  }
  // 重組
  for (let i = S.respawns.length - 1; i >= 0; i--) {
    const R = S.respawns[i];
    if ((R.t -= dt) > 0) continue;
    S.respawns.splice(i, 1);
    const B = baseOf(R.team);
    S.aces[R.team][R.k] = spawnAce(R.team, R.lo, spreadAt(B.x, B.z, [], 0, 5));
  }
  for (const t of TEAMS) if (S.score[t] >= CQ.winScore) S.result = t;
  if (!S.result && S.t >= CQ.timeLimit) S.result = Math.abs(S.score.blue - S.score.red) < 1 ? 'draw' : S.score.blue > S.score.red ? 'blue' : 'red';
  return S.result;
}
function dropSquad(team) {
  const live = enemies.filter(e => e.alive && e.grunt && e.team === team).length;
  const key = CQ.dropSquads[Math.floor(Math.random() * CQ.dropSquads.length)], units = packUnits(SQUADS, key);
  if (live + units.length > CQ.gruntCap) return false;
  S.drops[team]++;
  const B = baseOf(team), taken = [];
  for (const u of units) {
    const at = spreadAt(B.x + (team === 'blue' ? 3 : -3), B.z, taken, 1, 5); taken.push(at);
    tagUnit(spawnEnemy({ x: 0, z: 0, alive: true, team: 'none' }, gruntOf(u), at, { team, colors: COLORS[team + 'grunt'], diff: DIFFS.hard, grunt: true }), team);
  }
  return true;
}
// 主力機損毀（main.js AI.onEnemyDeath）
export function conquestDeath(e) {
  if (!S || !e.cq?.ace) return;
  const team = e.cq.team, k = S.aces[team].indexOf(e);
  S.kills[foeTeam(team)]++;
  if (k < 0) return;
  const n = (S.deaths.get(`${team}${k}`) ?? 0) + 1;
  S.deaths.set(`${team}${k}`, n);
  const t = Math.min(CQ.respawnMax, CQ.respawn + CQ.respawnAdd * (n - 1)) * (behind(team) ? CQ.behindK : 1);
  S.respawns.push({ team, k, lo: e.cq.lo, t });
}
// 觀戰鏡頭跟哪一台：0～2 藍、3～5 紅（數字鍵 1～6 切換）
export function focusMech() {
  if (!S) return null;
  const list = [...S.aces.blue, ...S.aces.red];
  for (let i = 0; i < 6; i++) { const e = list[(S.focus + i) % 6]; if (e?.alive) return e; }
  return null;
}
export const setFocus = i => { if (S) S.focus = i; };
// 上方的狀態列：九座巢穴照地圖排成三排（main.js 塞進觀戰的 wNext）
export function conquestHud() {
  if (!S) return '';
  const chip = n => { const c = CSS[n.owner]; return `<span title="${n.name}：${HIVES[n.type].desc}" style="display:inline-block;width:30px;margin:1px;border-radius:4px;border:1px solid ${c};color:${c};font-size:12px${n.contested ? ';opacity:.5' : ''}">${HIVES[n.type].short}${n.capturing ? `<small>${Math.round(Math.abs(n.prog) * 100)}</small>` : ''}</span>`; };
  return [0, 1, 2].map(r => S.nodes.slice(r * 3, r * 3 + 3).map(chip).join('')).join('<br>');
}
export function teamList(team) {
  if (!S) return '';
  const B = S.buffs[team], buff = ['armor', 'attack', 'speed', 'energy'].filter(k => B[k]).map(k => `${HIVES[k].short}×${B[k]}`).join(' ');
  return S.aces[team].map((e, k) => {
    const R = S.respawns.find(r => r.team === team && r.k === k);
    return `<span class="wt" style="--c:${CSS[team]}${e.alive ? '' : ';opacity:.45'}">${e.cq.lo.name}${R ? ` 重組 ${Math.ceil(R.t)}s` : ''}</span>`;
  }).join('') + `<span class="wt" style="--c:#8a96a6">增援 ${Math.round(S.bar[team] * 100)}%・雜魚 ${enemies.filter(e => e.alive && e.grunt && e.team === team).length}</span>` + (buff ? `<span class="wt" style="--c:#c8d070">${buff}</span>` : '');
}
