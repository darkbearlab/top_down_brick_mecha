// Pages 的進階模式：所有請求先到這裡（入口在 pages.dev），再轉給 mecha-bench 的 Bench 物件
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === '/edge') return Response.json({ edgeColo: req.cf?.colo, country: req.cf?.country, via: 'pages' });
    if (url.pathname !== '/ws' && url.pathname !== '/sim') return new Response('mecha-bench pages entry');
    const name = url.searchParams.get('name') ?? 'default', hint = url.searchParams.get('hint');
    const id = env.BENCH.idFromName(name), stub = hint ? env.BENCH.get(id, { locationHint: hint }) : env.BENCH.get(id);
    const res = await stub.fetch(req);
    if (url.pathname === '/sim') { const j = await res.json(); return Response.json({ edgeColo: req.cf?.colo, ...j }); }
    return res;
  },
};
