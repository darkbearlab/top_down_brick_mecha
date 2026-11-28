// 打包測試網站：遊戲執行要的檔案（index.html、style.css、src/）複製到 deploy/dist
//   部署：cd deploy && node build.mjs && npx wrangler pages deploy --branch main --commit-dirty=true
//   密碼：npx wrangler pages secret put SITE_PASSWORD --project-name brick-mecha（值在 ../.secrets/site-password.txt，不進 git）
import { cp, rm, mkdir } from 'node:fs/promises';
const root = new URL('../', import.meta.url), out = new URL('./dist/', import.meta.url);
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const f of ['index.html', 'style.css', 'src']) await cp(new URL(f, root), new URL(f, out), { recursive: true });
console.log('built deploy/dist');
