// 測試網站的密碼門（Cloudflare Pages Functions）：每個請求先到這裡
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
  const cookies = (request.headers.get('Cookie') ?? '').split(/;\s*/);
  if (cookies.includes(`${COOKIE}=${want}`)) {
    // 線上據點戰：/ws?room=… → 伺服器（brick-mecha-server 的 ConquestRoom 物件）
    if (url.pathname === '/ws' && env.ROOM) { const room = (url.searchParams.get('room') ?? 'main').slice(0, 40); return env.ROOM.get(env.ROOM.idFromName(room)).fetch(request); }
    return next();
  }
  if (url.pathname === '/__login' && request.method === 'POST') {
    const form = await request.formData(), back = String(form.get('next') ?? '/');
    if (String(form.get('pw') ?? '') === pw) {
      const to = back.startsWith('/') && !back.startsWith('//') ? back : '/';   // 只回到自己網站裡的路徑
      return new Response(null, { status: 303, headers: { Location: to, 'Set-Cookie': `${COOKIE}=${want}; Path=/; Max-Age=31536000; HttpOnly; Secure; SameSite=Lax` } });
    }
    return loginPage(true, back);
  }
  return loginPage(false, url.pathname + url.search);
}
