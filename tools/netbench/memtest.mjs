// 本機量記憶體：一場無頭據點戰（match.mjs，種子 7）跑滿 --min 分鐘（預設 6 = 21600 步），每 30 秒印一次 heap（DO 上限 128 MB）
//   node --expose-gc --import ../sim/register.mjs memtest.mjs [--seed 7] [--min 6]
//   峰值 = 沒有強制 GC 時看到的最大 heapUsed；有 --expose-gc 時另外印強制 GC 之後的量（= 真的留著的東西）
import { newMatch, DT } from './match.mjs';
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? +process.argv[i + 1] : d; };
const seed = arg('seed', 7), steps = Math.round(arg('min', 6) * 60 / DT), every = Math.round(30 / DT);
const MB = b => (b / 1048576).toFixed(1);
const M = newMatch(seed);
let peak = 0, peakGc = 0;
const t0 = performance.now();
for (let i = 1; i <= steps; i++) {
  M.step();
  const h = process.memoryUsage().heapUsed;
  if (h > peak) peak = h;
  if (i % every === 0 || i === steps) {
    let line = `t ${(i * DT).toFixed(0).padStart(3)} s  heapUsed ${MB(h)} MB`;
    if (globalThis.gc) { gc(); const g = process.memoryUsage().heapUsed; peakGc = Math.max(peakGc, g); line += `  after GC ${MB(g)} MB`; }
    console.log(`${line}  rss ${MB(process.memoryUsage().rss)} MB  mechs ${M.mechCount()}  score ${JSON.stringify(M.S.score ?? '')}${M.S.result ? '  result ' + JSON.stringify(M.S.result) : ''}`);
  }
}
console.log(`peak heapUsed ${MB(peak)} MB${globalThis.gc ? `, peak after GC ${MB(peakGc)} MB` : ''}, ${((performance.now() - t0) / steps).toFixed(2)} ms per step`);
