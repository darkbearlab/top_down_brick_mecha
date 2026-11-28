// 打包 worker.mjs → dist/worker.js：'three' 指到 tools/sim 的那份（跟遊戲同版），core.js 的 WebGLRenderer 換成假的（同 tools/sim/hooks.mjs）
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const THREE = fileURLToPath(new URL('../sim/node_modules/three/build/three.module.js', import.meta.url));
await build({
  entryPoints: ['worker.mjs'], bundle: true, format: 'esm', outfile: 'dist/worker.js', platform: 'neutral', target: 'es2022', minify: true,
  plugins: [{
    name: 'game',
    setup(b) {
      b.onResolve({ filter: /^three$/ }, () => ({ path: THREE }));
      b.onLoad({ filter: /[\\/]src[\\/]core\.js$/ }, async a => ({ contents: (await readFile(a.path, 'utf8')).replace(/new THREE\.WebGLRenderer\([^)]*\)/, 'globalThis.__fakeRenderer()'), loader: 'js' }));
    },
  }],
});
console.log('built dist/worker.js');
