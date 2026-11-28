// 打包 worker.mjs → dist/worker.js：'three' 指到 tools/sim 的那份（跟遊戲同版）
// 遊戲跑在無頭模式（match.mjs 先 import src/headless.js）：不建渲染器、不碰 DOM，所以不用假的瀏覽器環境、也不用改 core.js
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
const THREE = fileURLToPath(new URL('../sim/node_modules/three/build/three.module.js', import.meta.url));
await build({
  entryPoints: ['worker.mjs'], bundle: true, format: 'esm', outfile: 'dist/worker.js', platform: 'neutral', target: 'es2022', minify: true,
  plugins: [{
    name: 'game',
    setup(b) { b.onResolve({ filter: /^three$/ }, () => ({ path: THREE })); },
  }],
});
console.log('built dist/worker.js');
