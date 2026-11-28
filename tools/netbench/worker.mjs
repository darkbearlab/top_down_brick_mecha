// mecha-bench：在 Cloudflare 上量「伺服器權威」的據點戰跑不跑得動（測完就刪）
//   GET /sim?name=X&hint=apac&sec=60  → DO 裡全速跑 sec 秒遊戲時間，回報每幀幾毫秒、DO 在哪個機房
//   GET /ws?name=X&mode=echo|sim&min=3 → WebSocket（外部客戶端 client.mjs）：sim = 計時器每秒 60 幀跑一場；echo = 不跑模擬
//   GET /probe?name=P&target=X&mode=echo|sim&min=3 → 內部客戶端（Prober DO）直接連到 Bench DO（不經過網際網路），結果用 /probe-result?name=P 拿
// 斷線診斷（2026-11-28）：伺服器記錄 ctor（物件被重新建立）、accept、close / error、計時器最長卡了多久（gap），console.log → wrangler tail
// Workers 的時鐘只在 I/O 時前進 → 量運算時間：跑一批幀、讓出一下（setTimeout 0）、看前後差多少
import { newMatch, DT } from './match.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function coloOf() {
  try { const t = await (await fetch('https://www.cloudflare.com/cdn-cgi/trace')).text(); return /colo=(\w+)/.exec(t)?.[1] ?? '?'; } catch { return '?'; }
}
const BOOT = Date.now();
let ctorN = 0;

export class Bench {
  constructor(state, env) { this.state = state; this.env = env; this.id = ++ctorN; console.log(`[bench] ctor #${this.id} isolateAge ${Date.now() - BOOT}ms`); }
  async fetch(req) {
    const url = new URL(req.url), colo = await coloOf();
    if (url.pathname === '/sim') {
      const sec = Math.min(600, +(url.searchParams.get('sec') ?? 60)), M = newMatch(+(url.searchParams.get('seed') ?? 1));
      const total = Math.round(sec / DT), batch = 60;
      let done = 0, busy = 0, worst = 0;
      while (done < total && !M.S.result) {
        const t0 = Date.now();
        for (let i = 0; i < batch && done < total; i++, done++) M.step();
        await sleep(0);
        const ms = Date.now() - t0; busy += ms; worst = Math.max(worst, ms / batch);
      }
      return Response.json({ doColo: colo, ticks: done, gameSec: +(done * DT).toFixed(1), msPerTick: +(busy / done).toFixed(3), worstBatchMsPerTick: +worst.toFixed(3), mechs: M.mechCount(), result: M.S.result });
    }
    this.cap = +(url.searchParams.get('cap') ?? 0) || null;
    const mb = +(url.searchParams.get('ballast') ?? 0);   // 記憶體實驗：先佔 mb MB（填值，確保真的配置）
    if (mb && !this.ballast) { this.ballast = new Uint8Array(mb * 1048576); for (let i = 0; i < this.ballast.length; i += 4096) this.ballast[i] = 1; console.log(`[bench#${this.id}] ballast ${mb} MB`); }
    if (url.pathname === '/poke') { this.pokes = (this.pokes ?? 0) + 1; return new Response(`poke ${this.pokes}`); }   // 只是一個 HTTP 請求（看會不會重置 CPU 額度）
    if (req.headers.get('Upgrade') === 'websocket') {
      if (url.searchParams.get('selfpoke')) { const me = this.env.BENCH.get(this.state.id); this.selfPokeT = setInterval(() => me.fetch('https://bench/poke').catch(e => console.log(`[bench#${this.id}] selfpoke fail ${e}`)), 5000); }
      const [client, server] = Object.values(new WebSocketPair());
      const tag = url.searchParams.get('tag') ?? 'ws', mode = url.searchParams.get('mode') ?? 'sim';
      // mode 'hib'：休眠 API（state.acceptWebSocket）：每則訊息是一次獨立的呼叫（各自的 CPU 額度），模擬在 webSocketMessage 裡推進到現在
      if (mode === 'hib') {
        this.state.acceptWebSocket(server);
        this.H = { M: newMatch(7), start: null, ticks: 0, msgs: 0, lastReport: 0, worstBehind: 0, colo, tag, minutes: +(url.searchParams.get('min') ?? 3) };
        console.log(`[bench#${this.id}] accept ${tag} mode hib colo ${colo}`);
        return new Response(null, { status: 101, webSocket: client });
      }
      server.accept();
      console.log(`[bench#${this.id}] accept ${tag} mode ${mode} colo ${colo}`);
      if (mode === 'alarm') { this.startAlarmMatch(server, colo, +(url.searchParams.get('min') ?? 3), tag); return new Response(null, { status: 101, webSocket: client }); }
      this.run(server, colo, +(url.searchParams.get('min') ?? 3), mode, tag);
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response('?', { status: 404 });
  }
  // 休眠 API 的訊息：推進模擬到現在（最多一次 30 幀）、回 pong、每秒回報
  webSocketMessage(ws, data) {
    const H = this.H;
    if (!H) { console.log(`[bench#${this.id}] hib message but no match (object was reset)`); try { ws.close(1011, 'reset'); } catch { /* */ } return; }
    const now = Date.now(), FRAME = 1000 / 60;
    H.start ??= now; H.msgs++;
    let m; try { m = JSON.parse(data); } catch { m = {}; }
    if (m.t === 'ping') ws.send(JSON.stringify({ t: 'pong', id: m.id, ticks: H.ticks }));
    const due = Math.floor((now - H.start) / FRAME);
    let n = 0;
    while (H.ticks < due && n < 30) { H.M.step(); H.ticks++; n++; }
    H.worstBehind = Math.max(H.worstBehind, due - H.ticks);
    if (now - H.lastReport >= 1000) {
      H.lastReport = now;
      ws.send(JSON.stringify({ t: 'report', sec: Math.round((now - H.start) / 1000), ticks: H.ticks, due, behind: due - H.ticks, worstBehind: H.worstBehind, maxGap: 0, msgsIn: H.msgs, colo: H.colo, mechs: H.M.mechCount(), score: H.M.S.score }));
      H.worstBehind = 0;
    }
    if (now - H.start > H.minutes * 60000) { ws.send(JSON.stringify({ t: 'done', ticks: H.ticks })); ws.close(1000, 'done'); }
  }
  webSocketClose(ws, code, reason) { console.log(`[bench#${this.id}] hib close ${this.H?.tag} code ${code} "${reason}" ticks ${this.H?.ticks}`); this.H = null; }
  webSocketError(ws, err) { console.log(`[bench#${this.id}] hib error ${err}`); }
  // mode 'alarm'：模擬放在 alarm 裡跑（每次 alarm = 一次獨立的呼叫，有自己的 CPU 額度）；一次 alarm 跑 15 秒，跑完馬上排下一次
  startAlarmMatch(ws, colo, minutes, tag) {
    const A = this.A = { ws, colo, minutes, tag, M: null, start: Date.now(), ticks: 0, msgs: 0, closed: false, alarms: 0, lastReport: Date.now(), worstBehind: 0, maxGap: 0 };
    ws.addEventListener('message', ev => { A.msgs++; let m; try { m = JSON.parse(ev.data); } catch { return; } if (m.t === 'ping') ws.send(JSON.stringify({ t: 'pong', id: m.id, ticks: A.ticks })); });
    ws.addEventListener('close', ev => { A.closed = true; console.log(`[bench#${this.id}] close ${tag} code ${ev.code} "${ev.reason}" after ${Date.now() - A.start}ms ticks ${A.ticks} alarms ${A.alarms}`); });
    this.state.storage.setAlarm(Date.now() + 5);
  }
  async alarm() {
    const A = this.A;
    if (!A || A.closed) { console.log(`[bench#${this.id}] alarm without match (A ${!!A})`); return; }
    A.alarms++;
    const FRAME = 1000 / 60, t0 = Date.now();
    A.M ??= newMatch(7);
    let last = Date.now();
    while (Date.now() - t0 < 15000 && !A.closed) {
      await sleep(16);
      const now = Date.now(); A.maxGap = Math.max(A.maxGap, now - last); last = now;
      const due = Math.floor((now - A.start) / FRAME);
      let n = 0;
      while (A.ticks < due && n < 6) { A.M.step(); A.ticks++; n++; }
      A.worstBehind = Math.max(A.worstBehind, due - A.ticks);
      if (now - A.lastReport >= 1000) {
        A.lastReport = now;
        try { A.ws.send(JSON.stringify({ t: 'report', sec: Math.round((now - A.start) / 1000), ticks: A.ticks, due, behind: due - A.ticks, worstBehind: A.worstBehind, maxGap: A.maxGap, msgsIn: A.msgs, colo: A.colo, mechs: A.M.mechCount(), score: A.M.S.score, alarms: A.alarms })); } catch { /* 斷線 */ }
        A.worstBehind = 0; A.maxGap = 0;
      }
      if (now - A.start > A.minutes * 60000) { try { A.ws.send(JSON.stringify({ t: 'done', ticks: A.ticks })); A.ws.close(1000, 'done'); } catch { /* 斷線 */ } A.closed = true; return; }
    }
    if (!A.closed) await this.state.storage.setAlarm(Date.now());   // 下一段
  }
  run(ws, colo, minutes, mode, tag) {
    const start = Date.now(), FRAME = 1000 / 60;
    let M = null, ticks = 0, msgs = 0, lastReport = start, worstBehind = 0, closed = false, lastCb = start, maxGap = 0;
    ws.addEventListener('message', ev => {
      msgs++;
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === 'ping') ws.send(JSON.stringify({ t: 'pong', id: m.id, ticks }));
    });
    ws.addEventListener('close', ev => { closed = true; console.log(`[bench#${this.id}] close ${tag} code ${ev.code} reason "${ev.reason}" after ${Date.now() - start}ms ticks ${ticks}`); });
    ws.addEventListener('error', ev => { console.log(`[bench#${this.id}] error ${tag} ${ev.message ?? ev.error ?? ''} after ${Date.now() - start}ms`); });
    const timer = setInterval(() => {
      if (closed) { clearInterval(timer); return; }
      const now = Date.now();
      maxGap = Math.max(maxGap, now - lastCb); lastCb = now;
      if ((mode === 'sim' || mode === 'sim30') && !M) { M = newMatch(7, { gruntCap: this.cap }); return; }   // 第一次醒來才建（不要算進開場的落後）
      const due = Math.floor((now - start) / FRAME);
      let n = 0;
      while (ticks < due && n < 6) { if (M && (mode !== 'sim30' || ticks % 2 === 0)) M.step(); ticks++; n++; }   // sim30：每兩個 tick 跑一次（CPU 減半）
      worstBehind = Math.max(worstBehind, due - ticks);
      if (now - lastReport >= 1000) {
        lastReport = now;
        try { ws.send(JSON.stringify({ t: 'report', sec: Math.round((now - start) / 1000), ticks, due, behind: due - ticks, worstBehind, maxGap, msgsIn: msgs, colo, mechs: M?.mechCount() ?? 0, score: M?.S.score ?? { blue: 0, red: 0 } })); } catch (e) { console.log(`[bench#${this.id}] send fail ${tag} ${e}`); }
        if (maxGap > 500) console.log(`[bench#${this.id}] ${tag} timer gap ${maxGap}ms at ${Math.round((now - start) / 1000)}s`);
        worstBehind = 0; maxGap = 0;
      }
      if (now - start > minutes * 60000) { try { ws.send(JSON.stringify({ t: 'done', ticks })); ws.close(1000, 'done'); } catch { /* 斷線 */ } clearInterval(timer); }
    }, 16);
  }
}

// 內部客戶端：在 Cloudflare 裡面連到 Bench（不經過網際網路），每 250ms ping、每 50ms 送操作；結果存在自己的 storage
export class Prober {
  constructor(state, env) { this.state = state; this.env = env; }
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/probe-result') return Response.json((await this.state.storage.get('r')) ?? { none: true });
    const target = url.searchParams.get('target'), mode = url.searchParams.get('mode') ?? 'sim', min = +(url.searchParams.get('min') ?? 3), tag = url.searchParams.get('tag') ?? 'probe';
    const stub = this.env.BENCH.get(this.env.BENCH.idFromName(target));
    const res = await stub.fetch(`https://bench/ws?mode=${mode}&min=${min}&tag=${tag}`, { headers: { Upgrade: 'websocket' } });
    const ws = res.webSocket;
    if (!ws) return new Response('no ws', { status: 500 });
    ws.accept();
    const R = { tag, start: Date.now(), rtts: [], reports: 0, last: null, closed: null, maxBehind: 0, maxGap: 0 };
    const sent = new Map();
    let id = 0;
    ws.addEventListener('message', ev => {
      const m = JSON.parse(ev.data);
      if (m.t === 'pong') { const s = sent.get(m.id); if (s) { R.rtts.push(Date.now() - s); sent.delete(m.id); } }
      if (m.t === 'report') { R.reports++; R.last = m; R.maxBehind = Math.max(R.maxBehind, m.worstBehind); R.maxGap = Math.max(R.maxGap, m.maxGap); }
    });
    const save = () => this.state.storage.put('r', { ...R, rtts: undefined, rttMed: R.rtts.sort((a, b) => a - b)[R.rtts.length >> 1], rttMax: Math.max(0, ...R.rtts), secs: Math.round((Date.now() - R.start) / 1000) });
    ws.addEventListener('close', ev => { R.closed = { code: ev.code, reason: ev.reason, at: Date.now() - R.start }; console.log(`[probe] ${tag} closed ${ev.code} ${ev.reason} after ${R.closed.at}ms`); save(); });
    const pingT = setInterval(() => { try { sent.set(++id, Date.now()); ws.send(JSON.stringify({ t: 'ping', id })); } catch { clearInterval(pingT); } }, 250);
    const inT = setInterval(() => { try { ws.send(JSON.stringify({ t: 'in' })); } catch { clearInterval(inT); } }, 50);
    const saveT = setInterval(() => { save(); if (R.closed) { clearInterval(pingT); clearInterval(inT); clearInterval(saveT); } }, 2000);
    return Response.json({ started: tag });
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/edge') return Response.json({ edgeColo: req.cf?.colo, country: req.cf?.country });
    const name = url.searchParams.get('name') ?? 'default', hint = url.searchParams.get('hint');
    if (url.pathname === '/probe' || url.pathname === '/probe-result') return env.PROBER.get(env.PROBER.idFromName(name)).fetch(req);
    const id = env.BENCH.idFromName(name), stub = hint ? env.BENCH.get(id, { locationHint: hint }) : env.BENCH.get(id);
    const res = await stub.fetch(req);
    if (url.pathname === '/sim') { const j = await res.json(); return Response.json({ edgeColo: req.cf?.colo, ...j }); }
    return res;
  },
};
