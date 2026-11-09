// ---------- 戰鬥報告（給人 / AI 代理讀的文字版） ----------
// node tools/sim/report.mjs <輸出資料夾> [場次]：沒給場次 = 總結 + 每場一行；給了 = 那一場的完整時間線
//   時間線：開火（同一把連續的合併成一行）、命中摘要、部位壞掉、失衡、推進、騎槍、AI 意圖，每 5 秒插一行雙方狀態
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const [dir, which] = process.argv.slice(2);
const S = JSON.parse(readFileSync(join(dir, 'summary.json'), 'utf8'));
const nameOf = {};
for (const b of S.battles) for (const m of b.mechs) nameOf[`${b.battle}:${m.id}`] = `${m.side}`;

if (which == null) {
  console.log(`對戰：${S.args.a} vs ${S.args.b}・${S.battles.length} 場・難度 ${S.args.diff ?? 'hard'}`);
  for (const A of S.aggregate) console.log(`  ${A.side} ${A.name}：勝率 ${A.winRate}・平均擊殺 ${A.avgKillT ?? '-'}s・場均輸出 ${A.dealt} / 承受 ${A.taken}・推進 ${A.boosts} 次・失衡 ${A.staggered} 次・能量見底 ${A.lowEnergyT}s・自傷 ${A.selfDmg}`);
  for (const b of S.battles) console.log(`  #${b.battle} ${b.winner ?? '平手'} ${b.time}s${b.timeout ? '（時間到）' : ''}・` + b.mechs.map(m => `${m.side} 輸出 ${m.dealt}（${Object.entries(m.dealtBy).map(([k, v]) => `${k} ${v}`).join(', ')}）壞 ${m.lost.map(l => l[0]).join(',') || '-'}`).join('・'));
  process.exit(0);
}

const B = S.battles.find(b => b.battle === +which);
const ev = readFileSync(join(dir, `battle-${which}.jsonl`), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const side = id => B.mechs.find(m => m.id === id)?.side ?? `#${id}`;
console.log(`#${which}：${B.mechs.map(m => `${m.side} = ${m.name}`).join('、')}・${B.winner ?? '平手'} ${B.time}s${B.timeout ? '（時間到）' : ''}`);
let run = null, lastState = -5;
const flush = () => { if (run) { console.log(`${run.t0.toFixed(2).padStart(6)}–${run.t1.toFixed(2)} ${side(run.m)} 開火 ${run.w} ×${run.n}`); run = null; } };
const hitsBy = {};
for (const e of ev) {
  if (e.type === 'fire') { if (run && run.m === e.m && run.w === e.w && e.t - run.t1 < 0.6) { run.n += e.n; run.t1 = e.t; } else { flush(); run = { m: e.m, w: e.w, n: e.n, t0: e.t, t1: e.t }; } continue; }
  if (e.type === 'hit' || e.type === 'dmg') { if (e.type === 'dmg' && e.src != null) { const k = `${side(e.src)}→${side(e.tgt)} ${e.w}`; hitsBy[k] = (hitsBy[k] ?? 0) + e.amt; } if (e.type === 'hit' && (e.core || e.raw >= 60)) { flush(); console.log(`${e.t.toFixed(2).padStart(6)} ${side(e.src)} 重擊 ${side(e.tgt)} ${e.part}（${e.w}，原始 ${e.raw}，倍率 ${e.eff}${e.core ? '，核心' : ''}）`); } continue; }
  if (e.type === 'state') {
    if (e.t - lastState >= 5) { flush(); lastState = e.t; console.log(`${e.t.toFixed(2).padStart(6)} ── 距離 ${e.mechs[0].dist}・` + e.mechs.map(s => `${side(s.m)} 能量 ${s.e} 軀幹 ${s.hp.torso} 腳 ${s.hp.legs}${s.hp.armL != null ? ` 左手 ${s.hp.armL}` : ''}${s.hp.armR != null ? ` 右手 ${s.hp.armR}` : ''}`).join('・')); }
    continue;
  }
  flush();
  const who = side(e.m ?? e.tgt);
  const txt = e.type === 'break' ? `${who} 的 ${e.part} 被打掉（${side(e.src)} ${e.w}）` : e.type === 'kill' ? `${who} 被擊毀（${side(e.src)} ${e.w}）`
    : e.type === 'stagger' ? `${who} 失衡（威力 ${e.power}）` : e.type === 'boost' ? `${who} 推進` : e.type === 'ready' ? `${who} ${e.side} 邊${e.back ? '架起背部武器' : '換回手臂'}`
    : e.type === 'charge' ? `${who} 騎槍 ${e.phase}${e.speed ? ` 速度 ${e.speed}` : ''}${e.dmg ? ` 自傷 ${e.dmg}` : ''}` : e.type === 'intent' ? `${who} 意圖：${e.text}` : JSON.stringify(e);
  console.log(`${e.t.toFixed(2).padStart(6)} ${txt}`);
}
flush();
console.log('\n傷害來源：');
for (const [k, v] of Object.entries(hitsBy).sort((a, b) => b[1] - a[1])) console.log(`  ${k}：${Math.round(v)}`);
