// ---------- 戰鬥紀錄分析 ----------
// summarize(events, meta)：一場戰鬥的事件 → 每台機體的數字（給人看、也給 AI 代理看）
// aggregate(summaries)：很多場 → 勝率、平均擊殺時間、各武器的貢獻
const r1 = v => Math.round(v * 10) / 10;
const add = (o, k, v) => { o[k] = (o[k] ?? 0) + v; };

export function summarize(events, meta) {
  const ids = meta.mechs.map(m => m.id), S = {};
  for (const m of meta.mechs) S[m.id] = {
    id: m.id, side: m.side, name: m.name, brain: m.brain,
    dealt: 0, taken: 0, dealtBy: {}, takenPart: {}, takenFrom: {}, fired: {}, hits: {}, hitParts: {}, effSum: 0, effN: 0,
    broke: [], lost: [], staggersCaused: 0, staggered: 0, boosts: 0, readyToggles: 0, charges: { dash: 0, hit: 0, wall: 0 },
    selfDmg: 0, statusDmg: 0, distBuckets: { '<4': 0, '4-8': 0, '8-14': 0, '14-20': 0, '20+': 0 }, lowEnergyT: 0, samples: 0, killedAt: null, intents: {},
  };
  const by = id => S[id];
  let lastState = {};
  for (const e of events) {
    if (e.type === 'fire') add(by(e.m).fired, e.w, e.n);
    else if (e.type === 'hit') {
      const a = e.src != null && by(e.src);
      if (a && e.src !== e.tgt) { add(a.hits, e.w, 1); add(a.hitParts, e.part, 1); if (e.eff) { a.effSum += e.eff; a.effN++; } }
    } else if (e.type === 'dmg') {
      const t = by(e.tgt); if (!t) continue;
      t.taken += e.amt; add(t.takenPart, e.part, e.amt);
      const key = e.src != null && e.src !== e.tgt ? `#${e.src}:${e.w}` : e.w ?? 'other';
      add(t.takenFrom, key, e.amt);
      if (e.src != null && e.src !== e.tgt && by(e.src)) { by(e.src).dealt += e.amt; add(by(e.src).dealtBy, e.w, e.amt); }
      else if (e.src === e.tgt || e.w === 'crash') t.selfDmg += e.amt;
      else t.statusDmg += e.amt;
    } else if (e.type === 'break') { by(e.tgt).lost.push([e.part, e.t]); if (e.src != null && by(e.src) && e.src !== e.tgt) by(e.src).broke.push([e.part, e.t]); }
    else if (e.type === 'kill') by(e.tgt).killedAt = e.t;
    else if (e.type === 'stagger') { by(e.m).staggered++; }
    else if (e.type === 'boost') by(e.m).boosts++;
    else if (e.type === 'ready') by(e.m).readyToggles++;
    else if (e.type === 'charge') { if (e.phase in by(e.m).charges) by(e.m).charges[e.phase]++; }
    else if (e.type === 'intent') add(by(e.m).intents, e.text, 1);
    else if (e.type === 'state') {
      for (const s of e.mechs) {
        const M = by(s.m); if (!M) continue;
        M.samples++;
        if (s.e < 25) M.lowEnergyT += e.dt;
        const d = s.dist;
        if (d != null) M.distBuckets[d < 4 ? '<4' : d < 8 ? '4-8' : d < 14 ? '8-14' : d < 20 ? '14-20' : '20+'] += e.dt;
        lastState[s.m] = s;
      }
    }
  }
  // 失衡是誰造成的：看失衡前最後一個打中它的
  for (let i = 0; i < events.length; i++) {
    const e = events[i]; if (e.type !== 'stagger') continue;
    for (let j = i - 1; j >= 0 && events[j].t >= e.t - 0.001; j--) if (events[j].type === 'hit' && events[j].tgt === e.m && events[j].src != null) { by(events[j].src) && by(events[j].src).staggersCaused++; break; }
  }
  for (const id of ids) {
    const M = S[id];
    M.dealt = r1(M.dealt); M.taken = r1(M.taken); M.selfDmg = r1(M.selfDmg); M.statusDmg = r1(M.statusDmg);
    for (const o of [M.dealtBy, M.takenPart, M.takenFrom, M.distBuckets]) for (const k in o) o[k] = r1(o[k]);
    M.avgEff = M.effN ? Math.round(M.effSum / M.effN * 100) / 100 : null; delete M.effSum; delete M.effN;
    M.lowEnergyT = r1(M.lowEnergyT);
    M.final = lastState[id] ? { hp: lastState[id].hp, ammo: lastState[id].ammo, e: lastState[id].e } : null;
  }
  return { ...meta, mechs: ids.map(id => S[id]) };
}

// 很多場（同一個對戰組合）→ 每一邊的勝率、平均時間、平均輸出
export function aggregate(list) {
  const sides = {};
  for (const s of list) for (const m of s.mechs) {
    const A = sides[m.side] ??= { side: m.side, name: m.name, brain: m.brain, n: 0, wins: 0, draws: 0, dealt: 0, taken: 0, dealtBy: {}, killT: [], boosts: 0, staggered: 0, lowEnergyT: 0, selfDmg: 0 };
    A.n++;
    if (s.winner === m.side) { A.wins++; A.killT.push(s.time); } else if (!s.winner) A.draws++;
    A.dealt += m.dealt; A.taken += m.taken; A.boosts += m.boosts; A.staggered += m.staggered; A.lowEnergyT += m.lowEnergyT; A.selfDmg += m.selfDmg;
    for (const k in m.dealtBy) add(A.dealtBy, k, m.dealtBy[k]);
  }
  for (const A of Object.values(sides)) {
    const n = A.n;
    A.winRate = Math.round(A.wins / n * 100) / 100;
    A.avgKillT = A.killT.length ? r1(A.killT.reduce((a, b) => a + b, 0) / A.killT.length) : null; delete A.killT;
    for (const k of ['dealt', 'taken', 'boosts', 'staggered', 'lowEnergyT', 'selfDmg']) A[k] = r1(A[k] / n);
    for (const k in A.dealtBy) A.dealtBy[k] = r1(A.dealtBy[k] / n);
  }
  return Object.values(sides);
}
