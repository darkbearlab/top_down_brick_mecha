// ---------- 2v2 組合循環賽 ----------
// node --import ./tools/sim/register.mjs tools/sim/teamrr.mjs [--n 10] [--seed 1]：tools/sim/teams/*.json 兩兩對打、每組兩邊各 n 場，印勝場表
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => { if (v.startsWith('--')) a.push([v.slice(2), all[i + 1]]); return a; }, []));
const N = +(args.n ?? 10), SEED = +(args.seed ?? 1);
const T = readdirSync('tools/sim/teams').filter(f => f.endsWith('.json')).map(f => ({ id: f.slice(0, -5), ...JSON.parse(readFileSync(join('tools/sim/teams', f), 'utf8')) }));
const out = join('tools', 'sim', 'out', `teamrr-${Date.now()}`); mkdirSync(out, { recursive: true });
const wins = Object.fromEntries(T.map(t => [t.id, 0])), games = Object.fromEntries(T.map(t => [t.id, 0])), cell = {};
const run = (a, b, dir) => { execFileSync(process.execPath, ['--import', './tools/sim/register.mjs', 'tools/sim/duel.mjs', '--teamA', a.members.join(','), '--teamB', b.members.join(','), '--n', String(N), '--seed', String(SEED), '--quiet', '--out', dir], { stdio: ['ignore', 'ignore', 'inherit'] }); const S = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8')); return { A: S.battles.filter(x => x.winner === 'A').length, B: S.battles.filter(x => x.winner === 'B').length }; };
for (let i = 0; i < T.length; i++) for (let j = i + 1; j < T.length; j++) {
  const a = T[i], b = T[j], r1 = run(a, b, join(out, `${a.id}_${b.id}`)), r2 = run(b, a, join(out, `${b.id}_${a.id}`));
  const aw = r1.A + r2.B, bw = r1.B + r2.A;
  wins[a.id] += aw; wins[b.id] += bw; games[a.id] += 2 * N; games[b.id] += 2 * N;
  cell[`${a.id}|${b.id}`] = `${aw}-${bw}`;
  console.log(`${a.name} vs ${b.name}：${aw}-${bw}（平手 ${2 * N - aw - bw}）`);
}
console.log('\n排名：');
for (const t of [...T].sort((x, y) => wins[y.id] / games[y.id] - wins[x.id] / games[x.id])) console.log(`  ${t.name}（${t.members.join(' + ')}）：${wins[t.id]}/${games[t.id]} = ${Math.round(wins[t.id] / games[t.id] * 100)}%`);
