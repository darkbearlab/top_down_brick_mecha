// 打包伺服器 → server/dist/worker.js（'three' 指到 tools/sim 的那份，跟遊戲同版）
//   部署：cd server && node build.mjs && ../tools/netbench/node_modules/.bin/wrangler deploy
import { build } from '../tools/netbench/node_modules/esbuild/lib/main.js';
import { fileURLToPath } from 'node:url';
const THREE = fileURLToPath(new URL('../tools/sim/node_modules/three/build/three.module.js', import.meta.url));
await build({
  entryPoints: ['worker.mjs'], bundle: true, format: 'esm', outfile: 'dist/worker.js', platform: 'neutral', target: 'es2022', minify: true,
  plugins: [{ name: 'three', setup(b) { b.onResolve({ filter: /^three$/ }, () => ({ path: THREE })); } }],
});
console.log('built server/dist/worker.js');
