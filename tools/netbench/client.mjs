// 測試客戶端：連 /ws，像玩家一樣每秒送 20 份操作、每 250 毫秒 ping 一次量來回延遲；印伺服器每秒的回報（有沒有跟上 60 幀）
// 用法：node client.mjs <網址> [--name x] [--hint apac] [--min 5] [--quiet-input]（--quiet-input：不送操作，只 ping，看 CPU 額度會不會用光被踢）
const args = Object.fromEntries(process.argv.slice(3).reduce((a, v, i, all) => { if (v.startsWith('--')) a.push([v.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] == null ? true : all[i + 1]]); return a; }, []));
const base = process.argv[2].replace(/^http/, 'ws'), min = +(args.min ?? 5);
const url = `${base}/ws?name=${args.name ?? "ws1"}&min=${min}${args.hint ? `&hint=${args.hint}` : ""}${args.mode ? `&mode=${args.mode}` : ""}`;
const ws = new WebSocket(url);
const rtts = [], sent = new Map(), reports = [];
let id = 0, t0 = Date.now(), inputT = null, pingT = null;
ws.onopen = () => {
  console.log('connected', url, 'in', Date.now() - t0, 'ms');
  pingT = setInterval(() => { sent.set(++id, performance.now()); ws.send(JSON.stringify({ t: 'ping', id })); }, args['quiet-input'] ? 20000 : 250);
  if (!args['quiet-input']) inputT = setInterval(() => ws.send(JSON.stringify({ t: 'in', mx: Math.random() - 0.5, mz: Math.random() - 0.5, fire: { L: true, R: false } })), 50);
};
ws.onmessage = ev => {
  const m = JSON.parse(ev.data);
  if (m.t === 'pong') { const s = sent.get(m.id); if (s != null) { rtts.push(performance.now() - s); sent.delete(m.id); } }
  else if (m.t === 'report') { reports.push(m); if (m.sec % 15 === 0) console.log(`${m.sec}s  ticks ${m.ticks}/${m.due}  落後 ${m.behind}（這秒最多 ${m.worstBehind}）  機體 ${m.mechs}  收到訊息 ${m.msgsIn}  DO 在 ${m.colo}  分數 ${m.score.blue | 0}:${m.score.red | 0}`); }
  else if (m.t === 'done') console.log('done', m);
};
const finish = why => {
  clearInterval(pingT); clearInterval(inputT);
  const s = [...rtts].sort((a, b) => a - b), q = p => s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))].toFixed(1) : '-';
  const wb = Math.max(0, ...reports.map(r => r.worstBehind)), last = reports.at(-1);
  console.log(`\n結束（${why}）・${((Date.now() - t0) / 1000).toFixed(0)} 秒・回報 ${reports.length} 次・最後 ticks ${last?.ticks}/${last?.due}`);
  console.log(`來回延遲（ms）：中位 ${q(0.5)}・90% ${q(0.9)}・99% ${q(0.99)}・最大 ${s.length ? s.at(-1).toFixed(1) : '-'}・樣本 ${s.length}`);
  console.log(`伺服器最多落後 ${wb} 幀（${(wb / 60 * 1000).toFixed(0)} ms）・平均落後 ${(reports.reduce((a, r) => a + r.behind, 0) / Math.max(1, reports.length)).toFixed(2)} 幀`);
  process.exit(0);
};
ws.onclose = ev => finish(`close ${ev.code} ${ev.reason}`);
ws.onerror = ev => console.log('error', ev.message ?? ev);
setTimeout(() => finish('client timeout'), (min * 60 + 30) * 1000);
