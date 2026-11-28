// ---------- 線上據點戰的一個房間（伺服器權威，2026-11-28）----------
// 跑無頭的遊戲規則（src/headless.js）；座位制（2026-11-28）：6 台主力機，真人坐上哪個座位就當場接手那台（遠端控制器，control.js），沒人坐的是內建 AI
// 每 3 幀（每秒 20 次）打包一份狀態給客戶端（src/online.js）：
//   add  ：新出現的機體（生成時用的配裝 + 選項，客戶端用同一個 spawnEnemy 生外觀一樣的）
//   m    ：每台機體 [id, x, z, 腳朝向, 上半身朝向, vx, vz, 旗標, 7 個部位的耐久 %（-1 = 壞掉 / 沒有）, 飛行高度]
//   gone ：消失的 id；sh：飛彈 / 拋射物 [id, 種類, x, y, z]；ev：事件（子彈 sh、爆炸 ex、命中火花 hs、建築傷害 bd / bb、通知 note）
//   cs   ：據點戰的狀態（conquest.js cqNetState，每 2 份送一次）；me：自己的（指令、選機體、彈藥、能量、鎖定）
import '../src/headless.js';
import { G } from '../src/core.js';
import { loadMap } from '../src/arena.js';
import { resetBuildings, setLayout, updateBuildings } from '../src/buildings.js';
import { PLAYER_COLORS, collideMechs, makeMech, mechs, removeMech } from '../src/mech.js';
import { clearShots, makeGuns, shots, updateShots } from '../src/weapons.js';
import { AI, DIFFS, clearMemory, enemies, stepMech } from '../src/ai.js';
import { updateStatus } from '../src/status.js';
import { clearWrecks, updateWrecks } from '../src/wreck.js';
import { updateParticles } from '../src/fx.js';
import { applyHeavy } from '../src/heavy.js';
import { conquestArena } from '../src/blockgen.js';
import { CQ_ACES } from '../src/parts.js';
import { updateDevices, clearDevices } from '../src/devices.js';
import { pushFrame, setCtrl } from '../src/control.js';
import * as C from '../src/conquest.js';

const DT = 1 / 60, SNAP_EVERY = 3, PARTS = ['head', 'torso', 'armL', 'armR', 'legs', 'backL', 'backR'];
const none = { x: 0, z: 0, alive: false, team: 'none' };
const r2 = v => Math.round(v * 100) / 100, r1 = v => Math.round(v * 10) / 10;
let MAP = null;

export class Room {
  constructor() {
    if (!MAP) { MAP = conquestArena(); loadMap(MAP); setLayout(MAP.buildings); applyHeavy(); }
    AI.onEnemyDeath = e => C.conquestDeath(e);
    for (const m of mechs.slice()) removeMech(m);
    enemies.length = 0; clearDevices(); clearShots(); clearWrecks(); resetBuildings(); clearMemory();
    G.now = 0; G.paused = false; G.slowMo = 0; G.hitStop = 0;
    AI.passive = false; AI.sandbox = false; AI.diff = DIFFS.hard;
    this.ev = []; this.notes = []; this.ticks = 0; this.hs = 0; this.seatOf = new Map(); this.addCache = new Map();
    G.tap = (type, ...a) => {
      if (type === 'hs' && ++this.hs > 40) return;   // 命中火花：一份最多 40 個
      this.ev.push([type, ...a.map(v => typeof v === 'number' ? r2(v) : v)]);
    };
    C.startConquest(MAP, msg => this.notes.push(msg));
  }
  get S() { return C.cqState(); }
  // 座位：cid = 客戶端（一條連線一個）；坐下 = 當場接手那台
  sit(cid, team, k, name) {
    if (this.seatOf.has(cid)) this.leave(cid);
    const q = C.cqSit(team, k, name);
    if (!q) return false;
    this.seatOf.set(cid, { team, k });
    return true;
  }
  leave(cid) { const s = this.seatOf.get(cid); if (!s) return; this.seatOf.delete(cid); C.cqLeave(s.team, s.k); }
  mechOf(cid) { const s = this.seatOf.get(cid), e = s && this.S.aces[s.team][s.k]; return e?.alive && e.cq?.seat ? e : null; }
  pick(cid, name) { const s = this.seatOf.get(cid); return !!(s && C.cqSeatPick(s.team, s.k, name)); }
  // 客戶端的操作幀：只留最新的（不要累積成延遲）
  input(cid, f) {
    const m = this.mechOf(cid);
    if (!m || !f || m.ctrl?.kind !== 'remote') return;
    const n = v => Number.isFinite(+v) ? +v : 0, b = v => !!v, ml = Math.hypot(n(f.mx), n(f.mz)) || 1;
    const frame = { mx: n(f.mx) / Math.max(1, ml), mz: n(f.mz) / Math.max(1, ml), aimYaw: f.aimYaw == null ? null : n(f.aimYaw), aim: f.aim ? { x: n(f.aim.x), z: n(f.aim.z) } : null,
      fire: { L: b(f.fire?.L), R: b(f.fire?.R) }, ready: { L: b(f.ready?.L), R: b(f.ready?.R) }, boost: f.boost ? { x: n(f.boost.x), z: n(f.boost.z) } : null, device: f.device ? { x: n(f.device.x), z: n(f.device.z) } : null };
    if (m.ctrl.queue.length > 2) m.ctrl.queue.splice(0, m.ctrl.queue.length - 2);
    pushFrame(m, frame);
  }
  step() {
    G.now += DT;
    C.preUpdate(DT);
    for (const e of enemies) { if (!e.alive && !e.fall) continue; stepMech(e, DT, e.foe ?? none, C.postUpdate); }
    collideMechs(); updateShots(DT);
    for (const m of mechs.slice()) updateStatus(m, DT);
    updateWrecks(DT, DT); updateBuildings(DT); updateDevices(DT); updateParticles(DT);
    const r = C.updateConquest(DT);
    for (let k = enemies.length - 1; k >= 0; k--) if (!enemies[k].alive && !enemies[k].fall && enemies[k].deadT == null) enemies[k].deadT = G.now; else if (enemies[k].deadT != null && G.now - enemies[k].deadT > 3) { removeMech(enemies[k]); enemies.splice(k, 1); }
    this.ticks++;
    return r;
  }
  // 新出現的機體要給客戶端的資料（生成時用的配裝 + 選項）
  addInfo(e) {
    let a = this.addCache.get(e.id);
    if (a) return a;
    const colorKey = c => !c ? 'player' : Object.entries(C.COLORS).find(([, v]) => v === c)?.[0] ?? 'player';
    const o = e.spawnOpts ?? {}, cq = e.cq ?? {};
    a = { id: e.id, lo: e.preset, team: e.team, grunt: !!o.grunt, colors: colorKey(o.colors), max: PARTS.map(p => e.parts[p] ? r1(e.parts[p].max) : 0),
      cq: { ace: !!cq.ace, fort: !!cq.fort, k: cq.k ?? null, sup: !!cq.sup, beacon: !!cq.obody, native: e.team === 'native' } };
    this.addCache.set(e.id, a);
    return a;
  }
  // 這一幀大家共用的狀態（每 SNAP_EVERY 幀叫一次）；每個客戶端再加自己的（view）
  common() {
    const m = [], ids = new Set();
    for (const e of mechs) {
      ids.add(e.id);
      const fl = (e.alive ? 1 : 0) | (e.ready?.L ? 2 : 0) | (e.ready?.R ? 4 : 0) | (e.staggerT > 0 ? 8 : 0) | (e.dormant ? 16 : 0) | (e.emergeT > 0 ? 32 : 0) | (e.drop ? 64 : 0);
      m.push([e.id, r2(e.x), r2(e.z), r2(e.legYaw), r2(e.torsoYaw), r1(e.vx), r1(e.vz), fl, ...PARTS.map(p => { const q = e.parts[p]; return !q ? -1 : q.broken ? -1 : Math.round(q.hp / q.max * 100); }), r2(e.flyH ?? 0)]);
    }
    for (const id of this.addCache.keys()) if (!ids.has(id)) this.addCache.delete(id);
    const sh = [];
    for (const s of shots) if (s.kind !== 'bullet') { s.nid ??= ++SHOT_ID; sh.push([s.nid, s.kind, r2(s.x), r2(s.y ?? 1), r2(s.z), s.team]); }
    for (const n of this.notes) this.ev.push(['note', n]);
    const out = { tk: this.ticks, m, ids, sh, ev: this.ev, cs: (this.ticks / SNAP_EVERY) % 2 === 0 ? C.cqNetState() : null };
    this.ev = []; this.notes = []; this.hs = 0;
    return out;
  }
  // 給一個客戶端：known = 它已經有的機體 id（第一次送完整的生成資料，消失的告訴它）
  view(cid, c, known, full) {
    const add = [], gone = [];
    for (const e of mechs) if (!known.has(e.id)) { known.add(e.id); add.push(this.addInfo(e)); }
    for (const id of known) if (!c.ids.has(id)) { known.delete(id); gone.push(id); }
    const s = this.seatOf.get(cid), me = s ? C.cqNetSeat(s.team, s.k) : null, h = this.mechOf(cid);
    if (me && h) {
      me.guns = Object.fromEntries(Object.entries(h.guns).map(([k, g]) => [k, g.max === Infinity ? -1 : Math.round(g.ammo)]));
      me.energy = r1(h.energy); me.boostCd = r2(h.boostCd); me.device = h.device ? [h.device.charges, r2(h.device.cd)] : null;
      me.locks = [...(h.lockS?.progress ?? [])].map(([t, p]) => [t.id, r2(p)]);
    }
    return { t: 's', tk: c.tk, add, m: c.m, gone, sh: c.sh, ev: c.ev, cs: full ? C.cqNetState() : c.cs, me, seats: C.cqSeats() };
  }
}
let SHOT_ID = 0;
