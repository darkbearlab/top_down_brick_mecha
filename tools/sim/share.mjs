import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
for (const dir of process.argv.slice(2)) {
  const tot = {}; let all = 0, stag = 0, mechN = 0;
  for (const d of readdirSync(dir)) {
    const f = join(dir, d, 'summary.json'); if (!existsSync(f)) continue;
    for (const b of JSON.parse(readFileSync(f, 'utf8')).battles) for (const m of b.mechs) { mechN++; stag += m.staggered; for (const [w, v] of Object.entries(m.dealtBy)) { tot[w] = (tot[w] ?? 0) + v; all += v; } }
  }
  const pct = w => Math.round((tot[w] ?? 0) / all * 100);
  console.log(`${dir}: 直射飛彈 ${pct('missile')}%・垂直飛彈 ${pct('vmissile')}%・火箭 ${pct('rocket')}%・騎槍 ${pct('lance')}%・光束劍 ${pct('saber')}%・打樁 ${pct('pile')}%・每台每場失衡 ${(stag / mechN).toFixed(2)} 次`);
}
