// Node 載入鉤子：讓遊戲的 src/*.js 不用瀏覽器也能跑（無頭戰鬥模擬用）
//   'three' → 這個資料夾的 node_modules（跟遊戲用的 0.160.0 同版）
//   core.js：WebGLRenderer 換成假的（沒有 GPU，不畫畫面）
import { pathToFileURL, fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
const THREE_URL = new URL('./node_modules/three/build/three.module.js', import.meta.url).href;
export async function resolve(spec, ctx, next) {
  if (spec === 'three') return { url: THREE_URL, shortCircuit: true };
  return next(spec, ctx);
}
export async function load(url, ctx, next) {
  if (url.endsWith('/src/core.js') || url.includes('/src/core.js?')) {
    let src = await readFile(fileURLToPath(url.split('?')[0]), 'utf8');
    src = src.replace(/new THREE\.WebGLRenderer\([^)]*\)/, 'globalThis.__fakeRenderer()');
    return { format: 'module', source: src, shortCircuit: true };
  }
  return next(url, ctx);
}
