// 測試網站的密碼門（Cloudflare Pages Functions）：每個請求先到這裡（2026-11-28 起只有坐上線上座位要密碼，其他公開）
//   瀏覽器帶著正確的 bm_auth cookie → 放行；沒有 → 登入頁；POST /__login 密碼對 → 發 cookie（一年）、回到原本要去的頁面
//   密碼存在 Cloudflare 的機密設定 SITE_PASSWORD（npx wrangler pages secret put SITE_PASSWORD）；本機明碼在 .secrets/site-password.txt（不進 git）
//   cookie 的值 = 密碼的雜湊（換密碼 → 舊的登入自動失效）；之後多人連線的 WebSocket 也走這裡，一樣要登入
const COOKIE = 'bm_auth';
async function tokenOf(pw) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`brick-mecha:${pw}`));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function loginPage(wrong, next) {
  return new Response(`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Brick Mecha・登入</title>
<style>
:root{--bg:#0b0d12;--fg:#e8ecf2;--dim:#8a96a6;--acc:#7ff0ff;--bad:#ff7a60}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);color:var(--fg);font:16px system-ui,sans-serif}
form{width:min(340px,calc(100vw - 32px));display:flex;flex-direction:column;gap:12px;padding:28px;border:1px solid rgba(255,255,255,.12);border-radius:12px;background:rgba(255,255,255,.03)}
h1{margin:0;font-size:26px;letter-spacing:4px;font-weight:900}h1 span{color:var(--acc)}
p{margin:0;color:var(--dim);font-size:13px}
input{padding:11px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.18);background:rgba(0,0,0,.35);color:var(--fg);font:inherit}
button{padding:11px;border-radius:8px;border:1px solid var(--acc);background:rgba(127,240,255,.14);color:var(--fg);font:800 15px system-ui;cursor:pointer}
.bad{color:var(--bad)}
</style></head><body>
<form method="post" action="/__login"><h1>BRICK<span>MECHA</span></h1><p>測試版・請輸入密碼</p>
<input type="password" name="pw" autocomplete="current-password" autofocus required placeholder="密碼">
<input type="hidden" name="next" value="${esc(next || '/')}">
${wrong ? '<p class="bad">密碼不對</p>' : ''}<button>進入</button></form></body></html>`, { status: wrong ? 401 : 200, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
}
export async function onRequest({ request, env, next }) {
  const pw = env.SITE_PASSWORD;
  if (!pw) return new Response('網站密碼還沒設定（SITE_PASSWORD）', { status: 503 });
  const url = new URL(request.url), want = await tokenOf(pw);
  const authed = (request.headers.get('Cookie') ?? '').split(/;\s*/).includes(`${COOKIE}=${want}`);
  // 2026-11-28 起觀戰不用密碼：遊戲檔案、線上據點戰的連線都公開；坐上座位（操作機體）才要密碼
  //   /ws → 伺服器的房間；替這條連線蓋上 X-BM-Auth（有沒有登入），瀏覽器自己帶的一律蓋掉（伺服器的 workers.dev 網址關掉了，只能從這裡進）
  if (url.pathname === '/ws' && env.ROOM) {
    const h = new Headers(request.headers);
    h.set('X-BM-Auth', authed ? '1' : '0');
    return env.ROOM.get(env.ROOM.idFromName('main')).fetch(new Request(request, { headers: h }));   // 座位制：大家進同一場
  }
  // 遊戲問「我登入了沒」（沒登入：主選單只放線上觀戰和輸入密碼）
  if (url.pathname === '/__auth') return Response.json({ authed }, { headers: { 'Cache-Control': 'no-store' } });
  if (url.pathname === '/__login' && request.method === 'POST') {
    const form = await request.formData(), back = String(form.get('next') ?? '/');
    const ok = String(form.get('pw') ?? '') === pw, ajax = form.get('ajax') === '1';
    const cookie = `${COOKIE}=${want}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax`;
    if (ajax) return Response.json({ ok }, { status: ok ? 200 : 401, headers: ok ? { 'Set-Cookie': cookie } : {} });   // 遊戲裡的密碼欄
    if (ok) {
      const to = back.startsWith('/') && !back.startsWith('//') ? back : '/';   // 只回到自己網站裡的路徑
      return new Response(null, { status: 303, headers: { Location: to, 'Set-Cookie': cookie } });
    }
    return loginPage(true, back);
  }
  if (url.pathname === '/__login') return loginPage(false, '/');
  return next();
}
