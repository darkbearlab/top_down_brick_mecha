// ---------- 線上據點戰的客戶端（伺服器權威，2026-11-28）----------
// 遊戲規則全部在伺服器（server/room.mjs）跑；這裡只照伺服器每秒 20 份的狀態「畫出來」：
//   機體：伺服器說新出現的 → 用同一個 spawnEnemy 生一台外觀一樣的（鏡像，不跑 AI），之後每份狀態把位置 / 朝向 / 部位耐久 / 存活對上；
//         位置用平滑追（約 70 ms），死掉 → 在本地觸發一次死亡（殘骸、爆炸照單機的演出）
//   自己的機體：本地先照操作預測移動（driveMech，按下去馬上動），再慢慢拉回伺服器的位置（差太多直接對齊）；開火、鎖定、彈藥都是伺服器的
//   子彈：伺服器發射時送一筆 → 本地生一顆純外觀的（weapons.js ghostShot）；飛彈 / 拋射物：照位置畫一顆發光的方塊
//   爆炸、命中火花、建築傷害：伺服器把呼叫的參數送過來，本地照做一次（建築會照樣倒）
//   據點戰的狀態 → conquest.js cqApplyNet（HUD、Tab 地圖、圈圈、指令光柱、選機體畫面照用）
// 送給伺服器：每秒 30 份操作幀（control.js 的格式）、選機體、ping
import * as THREE from 'three';
import { G, addMat, scene } from './core.js';
import { PLAYER_COLORS, damagePart, driveMech, syncWear, tryBoost, updateReady } from './mech.js';
import { ghostShot } from './weapons.js';
import { explosion, hitSparks } from './fx.js';
import { blastBuildings, damageBuilding } from './buildings.js';
import { enemies, removeEnemy, spawnEnemy } from './ai.js';
import { sensors } from './sensors.js';
import { COLORS, cqApplyNet, cqTagMirror } from './conquest.js';

const PARTS = ['head', 'torso', 'armL', 'armR', 'legs', 'backL', 'backR'];
const ANCHOR = { x: 0, z: 0, alive: true, team: 'none' };
const N = { cid: Math.random().toString(36).slice(2, 12), name: `玩家${10 + Math.floor(Math.random() * 90)}`, seat: null, seats: [], ws: null, byId: new Map(), meId: 0, status: 'off', rtt: 0, lastSnapT: 0, sendT: 0, pingT: 0, pings: new Map(), shotsM: new Map(), toast: null, me: null, onResult: null, room: '' };
export const online = N;
const SHOT_GEO = new THREE.BoxGeometry(0.22, 0.22, 0.22);

export function connectOnline(toast) {
  disconnectOnline();
  N.toast = toast;
  N.room = 'main';   // 座位制：大家進同一場
  N.status = 'connecting';
  const base = new URLSearchParams(location.search).get('ws') ?? location.origin.replace(/^http/, 'ws');   // ?ws=ws://127.0.0.1:8787：本機開發時連 wrangler dev 的伺服器
  const ws = N.ws = new WebSocket(`${base}/ws?room=${N.room}`);
  ws.onopen = () => { N.status = 'open'; send({ t: 'hello', cid: N.cid, name: N.name }); if (N.pendingSit) { send({ t: 'sit', ...N.pendingSit }); N.pendingSit = null; } };
  ws.onmessage = ev => { let m; try { m = JSON.parse(ev.data); } catch { return; } onMessage(m); };
  ws.onclose = ev => { if (N.ws === ws) { N.status = 'closed'; toast?.(`與伺服器的連線中斷（${ev.code}）`); } };
  ws.onerror = () => { N.status = 'error'; };
}
export function disconnectOnline() {
  if (N.ws) { const w = N.ws; N.ws = null; try { w.close(1000, 'leave'); } catch { /* 已經斷了 */ } }
  for (const g of N.shotsM.values()) scene.remove(g);
  N.byId.clear(); N.shotsM.clear(); N.meId = 0; N.me = null; N.status = 'off'; N.lastTk = null; N.seat = null; N.seats = [];
}
const send = o => { if (N.ws?.readyState === 1) N.ws.send(JSON.stringify(o)); };
export const sendPick = name => send({ t: 'pick', name });
// 座位：坐下（當場接手那台）/ 離開（還給 AI，自己變觀戰）
export const sitOnline = (team, k, name) => { if (name) N.name = name; send({ t: 'hello', cid: N.cid, name: N.name }); send({ t: 'sit', team, k }); };
export const standOnline = () => send({ t: 'stand' });
// 坐座位要密碼：在遊戲裡登入（網站發 cookie）→ 重新連線（新連線才帶得到登入狀態）→ 再坐一次
export async function loginOnline(pw) {
  const r = await fetch('/__login', { method: 'POST', body: new URLSearchParams({ pw, ajax: '1' }), credentials: 'same-origin' }).catch(() => null);
  return !!r?.ok;
}
export function reconnectOnline(sitAfter = null) { const t = N.toast, cb = N.onNewMatch; disconnectOnline(); cb?.(); N.pendingSit = sitAfter; connectOnline(t); }
// 觀戰時鏡頭跟的：自己沒坐的話，跟一台活著的主力機（藍隊優先）
export function onlineSpecTarget() {
  for (const e of N.byId.values()) if (e.alive && e.cq?.ace && e.team === 'blue') return e;
  for (const e of N.byId.values()) if (e.alive && e.cq?.ace) return e;
  return null;
}
export const onlineMe = () => N.meId ? N.byId.get(N.meId) ?? null : null;

function onMessage(m) {
  if (m.t === 'pong') { const s = N.pings.get(m.id); if (s != null) { N.rtt = performance.now() - s; N.pings.delete(m.id); } return; }
  if (m.t === 'sat') { N.seat = m.ok && m.team ? { team: m.team, k: m.k } : m.ok ? null : N.seat; if (!m.ok) { if (m.need === 'password') N.onNeedPassword?.(m.team, m.k); else N.toast?.('那個座位已經有人了'); } return; }
  if (m.t === 'evicted') { N.toast?.('伺服器開了另一場，這場結束了（重新進入線上據點戰）'); return; }
  if (m.t === 'picked' && !m.ok) { N.toast?.('還不能出擊（重組中或這台不能選）'); return; }
  if (m.t !== 's') return;
  N.lastSnapT = performance.now();
  // 伺服器開了下一場（幀數從頭算）：舊的鏡像全部丟掉，main.js 重蓋場地
  if (N.lastTk != null && m.tk < N.lastTk) { for (const g of N.shotsM.values()) scene.remove(g); N.shotsM.clear(); N.byId.clear(); N.meId = 0; N.onNewMatch?.(); }
  N.lastTk = m.tk;
  for (const a of m.add) spawnMirror(a);
  for (const r of m.m) updateMirror(r);
  for (const id of m.gone) { const e = N.byId.get(id); if (e) { N.byId.delete(id); if (enemies.includes(e)) removeEnemy(e); } }
  syncShots(m.sh);
  for (const e of m.ev) playEvent(e);
  if (m.seats) N.seats = m.seats;
  const me = m.me ?? { id: 0, prespawn: null, order: null, team: null, k: null };   // 沒坐座位 = 觀戰
  N.me = me;
  if (me.id !== N.meId) {
    const old = N.byId.get(N.meId);
    if (old) old.isPlayer = false;
    N.meId = me.id;
    const e = N.byId.get(N.meId);
    if (e) { e.isPlayer = true; e.net.snap = true; }
  }
  if (me.id) applyMe(me); else { sensors.progress.clear(); sensors.locks = []; }
  cqApplyNet(m.cs, me, id => N.byId.get(id));
}
// 伺服器新出現的機體 → 本地生一台外觀一樣的（不跑 AI：線上模式不會呼叫 updateEnemy）
function spawnMirror(a) {
  if (N.byId.has(a.id)) return;
  const colors = a.colors === 'player' ? PLAYER_COLORS : COLORS[a.colors] ?? PLAYER_COLORS;
  const e = spawnEnemy(ANCHOR, a.lo, { x: 0, z: 0 }, { team: a.team, colors, grunt: a.grunt, noDrop: true });
  PARTS.forEach((p, i) => { const q = e.parts[p]; if (q && a.max[i]) { q.max = a.max[i]; q.hp = q.max; } });
  e.mirror = true; e.net = { x: 0, z: 0, ly: 0, ty: 0, snap: true };
  cqTagMirror(e, { ace: a.cq.ace, fort: a.cq.fort, k: a.cq.k, sup: a.cq.sup, obody: a.cq.beacon ? {} : undefined, player: a.cq.player, lo: a.cq.ace ? a.lo : undefined });
  if (a.cq.native) e.dormant = true;
  N.byId.set(a.id, e);
}
function updateMirror(r) {
  const [id, x, z, ly, ty, vx, vz, fl, ...rest] = r, e = N.byId.get(id);
  if (!e) return;
  const hp = rest.slice(0, 7), flyH = rest[7];
  const N2 = e.net;
  N2.x = x; N2.z = z; N2.ly = ly; N2.ty = ty; N2.vx = vx; N2.vz = vz;
  if (N2.snap) { e.x = x; e.z = z; e.legYaw = ly; e.torsoYaw = ty; N2.snap = false; }
  e.ready.L = !!(fl & 2); e.ready.R = !!(fl & 4);
  e.dormant = !!(fl & 16);
  if (!e.fly) e.flyH = flyH || 0;
  if (e.alive && !(fl & 1)) { damagePart(e, 'torso', 1e9, 0, 1); return; }   // 伺服器說它死了 → 本地照單機的死亡演出
  if (!e.alive) return;
  PARTS.forEach((p, i) => {
    const q = e.parts[p];
    if (!q || q.broken) return;
    if (hp[i] < 0 && p !== 'torso') { damagePart(e, p, q.hp + q.max, 0, 1); return; }   // 部位被打掉
    const v = Math.max(1, hp[i]) / 100 * q.max;
    if (Math.abs(v - q.hp) > q.max * 0.04) { q.hp = v; syncWear(e, p, 0, 0, true); } else q.hp = v;
  });
}
function applyMe(me) {
  const e = onlineMe();
  if (!e?.alive || !me.guns) return;
  for (const [k, a] of Object.entries(me.guns)) if (e.guns[k] && a >= 0) e.guns[k].ammo = a;
  e.energy = me.energy; e.boostCd = me.boostCd;
  if (me.device && e.device) { e.device.charges = me.device[0]; e.device.cd = me.device[1]; }
  sensors.progress.clear();
  for (const [id, p] of me.locks ?? []) { const t = N.byId.get(id); if (t) sensors.progress.set(t, p); }
  sensors.locks = [...sensors.progress].filter(([, p]) => p >= 1).map(([t]) => t);
}
// 飛彈 / 拋射物：照位置畫（多的刪、少的補）
function syncShots(list) {
  const seen = new Set();
  for (const [id, kind, x, y, z, team] of list) {
    seen.add(id);
    let g = N.shotsM.get(id);
    if (!g) { g = new THREE.Mesh(SHOT_GEO, addMat(team === 'blue' ? 0x7fd8ff : kind === 'napalm' ? 0xff8a30 : 0xff5030, 0.9)); g.position.set(x, y, z); scene.add(g); N.shotsM.set(id, g); }
    g.userData.to = { x, y, z };
  }
  for (const [id, g] of N.shotsM) if (!seen.has(id)) { scene.remove(g); g.material.dispose(); N.shotsM.delete(id); }
}
function playEvent(ev) {
  const [type, ...a] = ev;
  if (type === 'sh') ghostShot(a[0], a[1], a[2], a[3], a[4], a[5], a[6], a[7], a[8], a[1] === 'blue' && a[9] === 1);
  else if (type === 'ex') explosion(a[0], a[1], a[2], a[3]);
  else if (type === 'hs') hitSparks(a[0], a[1], a[2], a[3], a[4], a[5], !!a[6]);
  else if (type === 'bd') damageBuilding(a[0], a[1], a[2], a[3], a[4], a[5], a[6]);
  else if (type === 'bb') blastBuildings(a[0], a[1], a[2], a[3], a[4]);
  else if (type === 'note') N.toast?.(a[0]);
}
// 每幀：送操作（每秒 30 份）、自己的機體本地預測 + 拉回伺服器位置、其他機體平滑追、飛彈方塊
export function onlineStep(dt, frame) {
  const now = performance.now();
  if (N.ws?.readyState === 1) {
    if (now - N.sendT >= 33 || frame.boost || frame.ready.L || frame.ready.R || frame.device) { N.sendT = now; send({ t: 'in', f: { mx: frame.mx, mz: frame.mz, aimYaw: frame.aimYaw, aim: frame.aim ? { x: frame.aim.x, z: frame.aim.z } : null, fire: frame.fire, ready: frame.ready, boost: frame.boost, device: frame.device } }); }
    if (now - N.pingT > 1000) { N.pingT = now; const id = Math.random(); N.pings.set(id, now); send({ t: 'ping', id }); }
  }
  const me = onlineMe(), k = 1 - Math.exp(-14 * dt);
  for (const e of N.byId.values()) {
    if (!e.alive) continue;
    const n = e.net;
    if (e === me) {
      // 本地預測：照自己的操作走（按下去馬上動），推進也先在本地噴；伺服器的位置每份拉回一點，差 3 格以上直接對齊
      if (frame.boost) tryBoost(e, frame.boost.x, frame.boost.z);
      driveMech(e, dt, frame.mx, frame.mz, frame.aimYaw ?? e.torsoYaw);
      const ex = n.x - e.x, ez = n.z - e.z, err = Math.hypot(ex, ez);
      if (err > 3) { e.x = n.x; e.z = n.z; } else { const c = 1 - Math.exp(-4 * dt); e.x += ex * c; e.z += ez * c; }
    } else {
      e.x += (n.x - e.x) * k; e.z += (n.z - e.z) * k;
      e.legYaw += angleD(e.legYaw, n.ly) * k; e.torsoYaw += angleD(e.torsoYaw, n.ty) * k;
      e.vx = n.vx; e.vz = n.vz;
      e.walk = (e.walk ?? 0) + Math.hypot(n.vx, n.vz) * dt * 1.4;   // 走路的腳步動畫
    }
    updateReady(e, dt);
    e.parts.torso.flash = Math.max(0, (e.parts.torso.flash ?? 0) - dt);
  }
  for (const g of N.shotsM.values()) { const t = g.userData.to; if (t) { g.position.x += (t.x - g.position.x) * k; g.position.y += (t.y - g.position.y) * k; g.position.z += (t.z - g.position.z) * k; g.rotation.y += dt * 8; } }
  return me;
}
const angleD = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
export const onlineInfo = () => ({ status: N.status, rtt: Math.round(N.rtt), stale: N.lastSnapT ? Math.round(performance.now() - N.lastSnapT) : null });
