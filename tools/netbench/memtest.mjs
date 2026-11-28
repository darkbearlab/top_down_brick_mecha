// 本機量記憶體：同一場（種子 7）跑 5000 步，每 500 步印一次 heap（DO 上限 128 MB）
import { newMatch } from './match.mjs';
const M = newMatch(7);
for (let i = 1; i <= 5000; i++) {
  M.step();
  if (i % 500 === 0) { const m = process.memoryUsage(); console.log(`step ${i}  heapUsed ${(m.heapUsed / 1048576).toFixed(1)} MB  rss ${(m.rss / 1048576).toFixed(1)} MB  mechs ${M.mechCount()}`); }
}
