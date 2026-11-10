// ---------- 大腦錦標賽 ----------
// 兩個大腦在一組機體配對上對打，每組兩邊都跑（交換左右，抵消場地的不對稱），印勝率表
// node --import ./tools/sim/register.mjs tools/sim/tourney.mjs --x alpha --y beta [--pairs mirror|cross|all|"突擊型:狙擊型,騎槍型:打樁型"] [--n 10] [--seed 1] [--out 資料夾]
//   mirror：每台預設機體打自己（只比大腦）；cross：預設機體兩兩配對（含不同機體）；all：兩種都跑
//   結果：每組的資料夾（duel.mjs 的輸出）+ tourney.json（表）
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => { if (v.startsWith('--')) a.push([v.slice(2), all[i + 1]?.startsWith('--') || all[i + 1] == null ? true : all[i + 1]]); return a; }, []));
const X = args.x ?? 'default', Y = args.y ?? 'default', N = +(args.n ?? 10), SEED = +(args.seed ?? 1);
const PRESETS = ['突擊型', '狙擊型', '光束型', '支援型', '重砲型', '打樁型', '脈衝型', '騎槍型', '汽油型'];
let pairs;
const mode = args.pairs ?? 'mirror';
if (mode === 'mirror') pairs = PRESETS.map(p => [p, p]);
else if (mode === 'cross' || mode === 'all') {
  pairs = [];
  for (let i = 0; i < PRESETS.length; i++) for (let j = i + 1; j < PRESETS.length; j++) pairs.push([PRESETS[i], PRESETS[j]]);
  if (mode === 'all') pairs = [...PRESETS.map(p => [p, p]), ...pairs];
} else pairs = mode.split(',').map(s => s.split(':'));
const out = args.out ?? join('tools', 'sim', 'out', `tourney-${X}-vs-${Y}-${Date.now()}`);
mkdirSync(out, { recursive: true });

const run = (a, b, ba, bb, dir) => {
  execFileSync(process.execPath, ['--import', './tools/sim/register.mjs', 'tools/sim/duel.mjs', '--a', a, '--b', b, '--brainA', ba, '--brainB', bb, '--n', String(N), '--seed', String(SEED), ...(args.patch ? ['--patch', args.patch] : []), '--quiet', '--out', dir], { stdio: ['ignore', 'ignore', 'inherit'] });
  return JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8')).aggregate;
};
const rows = [];
let wx = 0, wy = 0, total = 0;
for (const [a, b] of pairs) {
  // 第一輪：X 開 a（左）、Y 開 b（右）；第二輪交換左右（X 開 b 在右… 不，X 還是開 a，但站右邊）
  const d1 = join(out, `${a}-${b}-x-left`), d2 = join(out, `${a}-${b}-x-right`);
  const g1 = run(a, b, X, Y, d1), g2 = run(b, a, Y, X, d2);
  const xw = g1[0].wins + g2[1].wins, yw = g1[1].wins + g2[0].wins, n = g1[0].n + g2[0].n;
  const xDealt = (g1[0].dealt + g2[1].dealt) / 2, yDealt = (g1[1].dealt + g2[0].dealt) / 2;
  rows.push({ x: a, y: b, xWins: xw, yWins: yw, draws: n - xw - yw, n, xDealt: Math.round(xDealt), yDealt: Math.round(yDealt) });
  wx += xw; wy += yw; total += n;
  console.log(`${X}「${a}」vs ${Y}「${b}」：${xw}–${yw}（平手 ${n - xw - yw}）・場均輸出 ${Math.round(xDealt)} / ${Math.round(yDealt)}`);
}
console.log(`\n總計 ${X} ${wx} 勝・${Y} ${wy} 勝・平手 ${total - wx - wy}（${total} 場）→ ${out}`);
writeFileSync(join(out, 'tourney.json'), JSON.stringify({ x: X, y: Y, n: N, seed: SEED, mode, rows, totals: { x: wx, y: wy, draws: total - wx - wy, n: total } }, null, 1));
