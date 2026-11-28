// ---------- brick-mecha-server：線上據點戰的伺服器（Cloudflare Worker + Durable Object）----------
// 入口在 Pages（deploy/functions/_middleware.js：密碼檢查過了才轉進來，/ws?room=…）；workers.dev 網址關掉（wrangler.toml workers_dev = false）
// 一個房間 = 一個 Durable Object：一個真人（藍隊 1 號）+ 5 台 AI；計時器每秒 60 幀、每 3 幀送一份狀態
// 客戶端送：{ t: 'in', f: 操作幀 }、{ t: 'pick', name: 配裝名 }、{ t: 'ping', id }；伺服器送：{ t: 's', … }（room.mjs snapshot）、{ t: 'pong', id }、{ t: 'hello', room }
// 斷線 60 秒沒人回來 → 收掉這場；比賽結束 → 送完最後一份就停，重新連線開新的一場
import { Room } from './room.mjs';
// 遊戲模組是「整個程式只有一個世界」的寫法（mechs、enemies、G、conquest 的 S 都是模組層級）：
//   同一個 isolate 裡兩個房間會推進同一個世界（實測時間跑成 1.7 倍）→ 一個 isolate 同時只跑一場，開新的就把舊的停掉
//   之後要多房間同時跑：遊戲狀態要改成每個房間一份（目前還沒做）
let ACTIVE = null;

export class ConquestRoom {
  constructor(state) { this.state = state; this.room = null; this.ws = null; this.timer = null; this.idleT = null; }
  async fetch(req) {
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('websocket only', { status: 426 });
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    if (this.ws) try { this.ws.close(4000, 'replaced'); } catch { /* 舊的已經斷了 */ }
    this.ws = server;
    clearTimeout(this.idleT);
    if (!this.room || this.room.S?.result) this.start();
    server.addEventListener('message', ev => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (!this.room) return;
      if (m.t === 'in') this.room.input(m.f);
      else if (m.t === 'pick') { const ok = this.room?.pick(String(m.name ?? '')); this.send({ t: 'picked', ok, name: m.name }); }
      else if (m.t === 'ping') this.send({ t: 'pong', id: m.id });
    });
    server.addEventListener('close', () => { if (this.ws === server) { this.ws = null; this.idleT = setTimeout(() => this.stop(), 60000); } });
    this.send({ t: 'hello', fresh: this.room.ticks === 0 });
    return new Response(null, { status: 101, webSocket: client });
  }
  send(o) { try { this.ws?.send(JSON.stringify(o)); } catch { /* 斷線 */ } }
  start() {
    this.stop();
    if (ACTIVE && ACTIVE !== this) ACTIVE.evict();
    ACTIVE = this;
    this.room = new Room();
    const FRAME = 1000 / 60, t0 = Date.now();
    let done = 0;
    this.timer = setInterval(() => {
      const due = Math.floor((Date.now() - t0) / FRAME);
      let n = 0;
      while (done < due && n < 4) {
        const r = this.room.step(); done++; n++;
        if (this.room.ticks % 3 === 0) this.send({ t: 's', ...this.room.snapshot() });
        if (r) { this.send({ t: 's', ...this.room.snapshot() }); clearInterval(this.timer); this.timer = null; return; }
      }
      if (due - done > 120) done = due - 4;   // 落後超過 2 秒（物件被暫停過）：跳過，不要一直追
    }, 16);
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; }
  // 同一個 isolate 開了另一場：這場停掉、通知客戶端
  evict() {
    this.stop(); this.room = null;
    this.send({ t: 'evicted' });
    try { this.ws?.close(4001, 'another match started'); } catch { /* 已經斷了 */ }
    this.ws = null;
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url), room = (url.searchParams.get('room') ?? 'main').slice(0, 40);
    return env.ROOM.get(env.ROOM.idFromName(room)).fetch(req);
  },
};
