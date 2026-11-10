// ---------- 雜魚關卡（狼群測試） ----------
// 一台參賽作品（配裝 + 大腦）打 5 組雜魚包（跟遊戲觀戰「AI vs 雜魚」同一組，main.js BRAIN_PACKS），每組 n 場，印勝率
// node --import ./tools/sim/register.mjs tools/sim/gauntlet.mjs --entry <名字> [--n 10] [--seed 1]
//   <名字>：tools/sim/entries/<名字>/loadout.json + src/brains/<名字>.js；也可以 --a <配裝或預設機名字> --brain <大腦>
//   門檻：總勝率 ≥ 80%（第三階段個性機體的規定）
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => { if (v.startsWith('--')) a.push([v.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] == null ? true : all[i + 1]]); return a; }, []));
const N = +(args.n ?? 10), SEED = +(args.seed ?? 1);
const A = args.entry ? join('tools', 'sim', 'entries', args.entry, 'loadout.json') : args.a, BRAIN = args.entry ?? args.brain ?? 'default';
const PACKS = [
  ['突擊 + 伏擊 + 精英', 'rush+ambush+elite'],
  ['狙擊 + 飛彈 + 砲擊', 'snipers+missile+mortar'],
  ['蟲巢 + 衝鋒蟲 + 蟲群', 'hive+stampede+swarm'],
  ['衝鋒 + 自爆 + 縱火', 'breakers+kamikaze+arson'],
  ['精英 ×2 + 重裝（難）', 'elite+elite+heavy'],
];
const out = join('tools', 'sim', 'out', `gauntlet-${args.entry ?? BRAIN}-${Date.now()}`);
mkdirSync(out, { recursive: true });
let wins = 0, total = 0;
for (const [name, sq] of PACKS) {
  const dir = join(out, sq.replace(/\+/g, '_'));
  execFileSync(process.execPath, ['--import', './tools/sim/register.mjs', 'tools/sim/duel.mjs', '--a', A, '--brainA', BRAIN, '--b', `squad:${sq}`, '--n', String(N), '--seed', String(SEED), ...(args.patch ? ['--patch', args.patch] : []), '--quiet', '--out', dir], { stdio: ['ignore', 'ignore', 'inherit'] });
  const S = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8')), me = S.aggregate.find(x => x.side === 'A');
  wins += me.wins; total += me.n;
  console.log(`${name.padEnd(14)} ${me.wins}/${me.n}・場均承受 ${me.taken}・平均擊殺 ${me.avgKillT ?? '-'}s   （${dir}）`);
}
const rate = wins / total;
console.log(`\n總計 ${wins}/${total} = ${Math.round(rate * 100)}% ${rate >= 0.8 ? '✓ 過 80% 門檻' : '✗ 未達 80%'}`);
