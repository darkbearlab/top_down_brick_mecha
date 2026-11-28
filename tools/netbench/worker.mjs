// mecha-bench：在 Cloudflare 上量「伺服器權威」的據點戰跑不跑得動（測完就刪）
//   GET /sim?name=X&hint=apac&sec=60  → Durable Object 裡用真的遊戲邏輯跑 sec 秒遊戲時間（全速），回報每幀花幾毫秒、DO 在哪個機房
//   GET /ws?name=X&hint=apac          → WebSocket：DO 用計時器每秒 60 幀跑一場（像真的比賽），每秒回報有沒有跟上；收到 {t:'ping'} 馬上回 pong（量來回延遲）
// Workers 的時鐘只在 I/O 時前進（防旁路攻擊）→ 量運算時間：跑一批幀、讓出一下（setTimeout 0）、看前後差多少
import { newMatch, DT } from './match.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function coloOf() {
  try { const t = await (await fetch('https://www.cloudflare.com/cdn-cgi/trace')).text(); return /colo=(\w+)/.exec(t)?.[1] ?? '?'; } catch { return '?'; }
}

export class Bench {
  constructor(state, env) { this.state = state; this.env = env; }
  async fetch(req) {
    const url = new URL(req.url), colo = await coloOf();
    if (url.pathname === '/sim') {
      const sec = Math.min(600, +(url.searchParams.get('sec') ?? 60)), M = newMatch(+(url.searchParams.get('seed') ?? 1));
      const total = Math.round(sec / DT), batch = 60;
      let done = 0, busy = 0, worst = 0;
      while (done < total && !M.S.result) {
        const t0 = Date.now();
        for (let i = 0; i < batch && done < total; i++, done++) M.step();
        await sleep(0);   // 讓時鐘前進
        const ms = Date.now() - t0; busy += ms; worst = Math.max(worst, ms / batch);
      }
      return Response.json({ doColo: colo, ticks: done, gameSec: +(done * DT).toFixed(1), msPerTick: +(busy / done).toFixed(3), worstBatchMsPerTick: +worst.toFixed(3), mechs: M.mechCount(), result: M.S.result, score: M.S.score });
    }
    if (url.pathname === '/ws' && req.headers.get('Upgrade') === 'websocket') {
      const [client, server] = Object.values(new WebSocketPair());
      // mode 'hib'：休眠 API（state.acceptWebSocket）：每則訊息是一次獨立的呼叫（各自的 CPU 額度），模擬在 webSocketMessage 裡推進到現在
      if (url.searchParams.get('mode') === 'hib') {
        this.state.acceptWebSocket(server);
        this.H = { M: newMatch(7), start: null, ticks: 0, msgs: 0, lastReport: 0, worstBehind: 0, colo, minutes: +(url.searchParams.get('min') ?? 3) };
        return new Response(null, { status: 101, webSocket: client });
      }
      server.accept();
      this.run(server, colo, +(url.searchParams.get('min') ?? 5), url.searchParams.get('mode') ?? 'timer');
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response('?', { status: 404 });
  }
  // 一場「真的」比賽：每 16 毫秒醒來一次，照經過的時間補幀（最多一次補 6 幀），每秒回報
  // 休眠 API 的訊息：推進模擬到現在（最多一次 30 幀）、回 pong、每秒回報
  webSocketMessage(ws, data) {
    const H = this.H;
    if (!H) return;
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
      ws.send(JSON.stringify({ t: 'report', sec: Math.round((now - H.start) / 1000), ticks: H.ticks, due, behind: due - H.ticks, worstBehind: H.worstBehind, msgsIn: H.msgs, colo: H.colo, mechs: H.M.mechCount(), score: H.M.S.score }));
      H.worstBehind = 0;
    }
    if (now - H.start > H.minutes * 60000) { ws.send(JSON.stringify({ t: 'done', ticks: H.ticks })); ws.close(1000, 'done'); }
  }
  webSocketClose(ws) { this.H = null; }
  // mode 'timer'：計時器裡推進模擬；'msg'：收到客戶端訊息時才推進（每則訊息都是新的 CPU 額度），計時器只負責回報
  run(ws, colo, minutes, mode) {
    const M = newMatch(7), start = Date.now(), FRAME = 1000 / 60;
    let ticks = 0, msgs = 0, lastReport = start, worstBehind = 0, closed = false;
    // mode 'light'：不跑模擬（只算 ticks）；'slow'：模擬每秒 20 次（每次 1/20 秒 → 這裡每 3 個 tick 跑一次 step，看負載低一點撐不撐得住）
    const advance = cap => { const due = Math.floor((Date.now() - start) / FRAME); let n = 0; while (ticks < due && n < cap) { if (mode !== 'light' && (mode !== 'slow' || ticks % 3 === 0)) M.step(); ticks++; n++; } return due; };
    ws.addEventListener('message', ev => {
      msgs++;
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === 'ping') ws.send(JSON.stringify({ t: 'pong', id: m.id, ticks }));
      if (mode === 'msg') advance(12);
    });
    ws.addEventListener('close', () => { closed = true; });
    const timer = setInterval(() => {
      if (closed) { clearInterval(timer); return; }
      const now = Date.now(), due = mode === 'msg' ? Math.floor((now - start) / FRAME) : advance(6);
      worstBehind = Math.max(worstBehind, due - ticks);
      if (now - lastReport >= 1000) {
        lastReport = now;
        try { ws.send(JSON.stringify({ t: 'report', sec: Math.round((now - start) / 1000), ticks, due, behind: due - ticks, worstBehind, msgsIn: msgs, colo, mechs: M.mechCount(), score: M.S.score })); } catch { /* 斷線 */ }
        worstBehind = 0;
      }
      if (now - start > minutes * 60000 || M.S.result) { try { ws.send(JSON.stringify({ t: 'done', ticks, result: M.S.result })); ws.close(1000, 'done'); } catch { /* 斷線 */ } clearInterval(timer); }
    }, 16);
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/edge') return Response.json({ edgeColo: req.cf?.colo, country: req.cf?.country });
    const name = url.searchParams.get('name') ?? 'default', hint = url.searchParams.get('hint');
    const id = env.BENCH.idFromName(name), stub = hint ? env.BENCH.get(id, { locationHint: hint }) : env.BENCH.get(id);
    const res = await stub.fetch(req);
    if (url.pathname === '/sim') { const j = await res.json(); return Response.json({ edgeColo: req.cf?.colo, ...j }); }
    return res;
  },
};
