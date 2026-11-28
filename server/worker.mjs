// ---------- brick-mecha-server：線上據點戰的伺服器（Cloudflare Worker + Durable Object）----------
// 入口在 Pages（deploy/functions/_middleware.js：密碼檢查過了才轉進來）；workers.dev 網址關掉（wrangler.toml workers_dev = false）
// 座位制（2026-11-28）：全部的人進同一場（房間 'main'），6 個主力機座位，沒人坐的是 AI；坐下 = 當場接手那台
//   遊戲模組是「整個程式只有一個世界」的寫法（mechs、enemies、G、conquest 的 S 都是模組層級）→ 一個 isolate 同時只跑一場（ACTIVE）
// 客戶端送：{ t: 'hello', cid, name }、{ t: 'sit', team, k }、{ t: 'stand' }、{ t: 'in', f: 操作幀 }、{ t: 'pick', name }、{ t: 'ping', id }
// 伺服器送：{ t: 's', … }（room.mjs view：共用的狀態 + 你沒看過的機體 + 你座位的資料 + 座位表）、{ t: 'sat' / 'pong' / 'evicted' }
// 斷線 30 秒沒回來 → 座位還給 AI；沒有任何人連著 60 秒 → 這場收掉；比賽結束 → 15 秒後自動開下一場，座位保留
import { Room } from './room.mjs';
let ACTIVE = null;

export class ConquestRoom {
  constructor(state) { this.state = state; this.room = null; this.timer = null; this.clients = new Map(); this.away = new Map(); this.idleT = null; this.restartT = null; }
  async fetch(req) {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('websocket only', { status: 426 });
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    const C = { ws: server, cid: null, name: '玩家', known: new Set(), full: true, auth: req.headers.get('X-BM-Auth') === '1' };   // auth：網站入口檢查過密碼（沒有 = 只能觀戰）
    this.clients.set(server, C);
    clearTimeout(this.idleT);
    if (!this.room) this.start();
    server.addEventListener('message', ev => this.onMessage(C, ev.data));
    server.addEventListener('close', () => this.onClose(C));
    return new Response(null, { status: 101, webSocket: client });
  }
  onMessage(C, data) {
    let m; try { m = JSON.parse(data); } catch { return; }
    if (m.t === 'ping') return this.send(C, { t: 'pong', id: m.id });
    if (m.t === 'hello') {
      C.cid = String(m.cid ?? '').slice(0, 40) || Math.random().toString(36).slice(2);
      C.name = String(m.name ?? '玩家').slice(0, 16) || '玩家';
      // 斷線後回來（同一個 cid）：座位還在 → 接回去
      const back = this.away.get(C.cid);
      if (back) { clearTimeout(back.t); this.away.delete(C.cid); }
      for (const [ws, o] of this.clients) if (o !== C && o.cid === C.cid) { try { ws.close(4000, 'replaced'); } catch { /* */ } this.clients.delete(ws); }
      return;
    }
    if (!this.room || !C.cid) return;
    if (m.t === 'in') this.room.input(C.cid, m.f);
    else if (m.t === 'sit' && !C.auth) this.send(C, { t: 'sat', ok: false, need: 'password' });   // 觀戰不用密碼；坐上座位要
    else if (m.t === 'sit') this.send(C, { t: 'sat', ok: this.room.sit(C.cid, m.team === 'red' ? 'red' : 'blue', Math.max(0, Math.min(2, m.k | 0)), C.name), team: m.team, k: m.k });
    else if (m.t === 'stand') { this.room.leave(C.cid); this.send(C, { t: 'sat', ok: true, team: null }); }
    else if (m.t === 'pick') this.send(C, { t: 'picked', ok: this.room.pick(C.cid, String(m.name ?? '')), name: m.name });
  }
  onClose(C) {
    this.clients.delete(C.ws);
    if (C.cid && this.room?.seatOf.has(C.cid)) {
      // 30 秒內同一個 cid 回來 → 座位還在；不然還給 AI
      const t = setTimeout(() => { this.away.delete(C.cid); if ([...this.clients.values()].every(o => o.cid !== C.cid)) this.room?.leave(C.cid); }, 30000);
      this.away.set(C.cid, { t });
    }
    if (!this.clients.size) this.idleT = setTimeout(() => this.stop(true), 60000);
  }
  send(C, o) { try { C.ws.send(JSON.stringify(o)); } catch { /* 斷線 */ } }
  broadcast() {
    const c = this.room.common();
    for (const C of this.clients.values()) { if (!C.cid) continue; this.send(C, this.room.view(C.cid, c, C.known, C.full)); C.full = false; }
  }
  start() {
    this.stop();
    if (ACTIVE && ACTIVE !== this) ACTIVE.evict();
    ACTIVE = this;
    const seated = this.room ? [...this.room.seatOf].map(([cid, s]) => ({ cid, ...s })) : [];
    this.room = new Room();
    // 上一場坐著的人：新的一場直接坐回原本的座位
    for (const s of seated) { const C = [...this.clients.values()].find(o => o.cid === s.cid); if (C) this.room.sit(s.cid, s.team, s.k, C.name); }
    for (const C of this.clients.values()) { C.known = new Set(); C.full = true; }
    const FRAME = 1000 / 60, t0 = Date.now();
    let done = 0;
    this.timer = setInterval(() => {
      const due = Math.floor((Date.now() - t0) / FRAME);
      let n = 0;
      while (done < due && n < 4) {
        const r = this.room.step(); done++; n++;
        if (this.room.ticks % 3 === 0) this.broadcast();
        if (r) { this.broadcast(); clearInterval(this.timer); this.timer = null; this.restartT = setTimeout(() => this.start(), 15000); return; }
      }
      if (due - done > 120) done = due - 4;   // 落後超過 2 秒（物件被暫停過）：跳過，不要一直追
    }, 16);
  }
  stop(drop = false) { if (this.timer) clearInterval(this.timer); this.timer = null; clearTimeout(this.restartT); if (drop) this.room = null; }
  // 同一個 isolate 開了另一場：這場停掉、通知大家
  evict() {
    this.stop(true);
    for (const C of this.clients.values()) { this.send(C, { t: 'evicted' }); try { C.ws.close(4001, 'another match started'); } catch { /* */ } }
    this.clients.clear();
  }
}

export default {
  async fetch(req, env) { return env.ROOM.get(env.ROOM.idFromName('main')).fetch(req); },
};
