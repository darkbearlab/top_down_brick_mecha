// ---------- beta 團隊共用（2v2 組合用的 b-* 大腦） ----------
// 做法：b-* 大腦 = 原本的個性大腦（單打 / 打雜魚的版本，不改）外面包一層「團隊層」：
//   pre(o, mem, api)：呼叫原大腦之前，可以改原大腦的記憶（例如偏好的目標）
//   post(o, mem, api, act)：原大腦算完之後，加上選目標（act.target）、隊形移動、團隊意圖（集火 / 掩護 / 誘敵 / 護衛 / 歸隊 / 求援）
//   沒有隊友（obs.allies 空的，打雜魚關卡）→ 團隊層完全不動，跟原大腦一模一樣
// 團隊層的記憶放在 mem.tm（不跟原大腦的欄位撞名）
// 介面見 tools/sim/BRAINS.md
export const unit = (x, z) => { const l = Math.hypot(x, z) || 1e-6; return { x: x / l, z: z / l, l }; };
export const hpFrac = e => e.hp?.torso ? e.hp.torso.hp / Math.max(1, e.hp.torso.max) : 1;
export const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export function teamBrain(name, base, hooks) {
  return {
    name,
    init(mem, me) { base.init?.(mem, me); mem.tm = { focus: null, noteT: 0 }; },
    think(o, mem, api) {
      const solo = !o.allies || !o.allies.length;
      if (!solo) hooks.pre?.(o, mem, api, mem.tm);
      let act = base.think(o, mem, api) ?? {};
      if (!solo) act = hooks.post?.(o, mem, api, act, mem.tm) ?? act;
      return act;
    },
  };
}

// ---- 剋制：動能 / 化學 / 能量 打 複合 / 陶瓷 / 鏡面 的倍率（parts.js） ----
export const MULT = {
  kinetic: { composite: 0.65, ceramic: 1, mirror: 1.4 },
  chemical: { composite: 1.4, ceramic: 0.65, mirror: 1 },
  energy: { composite: 1, ceramic: 1.4, mirror: 0.65 },
};
// 一台機體每秒輸出（粗估）照傷害類型分：{ kinetic, chemical, energy }
export function dmgMix(m) {
  const mix = { kinetic: 0, chemical: 0, energy: 0 };
  for (const w of Object.values(m.weapons ?? {})) {
    if (!w || w.broken || w.kind === 'shield' || !(w.ammo > 0)) continue;
    const rate = w.kind === 'lance' ? 60 : (w.dmg ?? 0) * (w.pellets ?? 1) * (w.salvo ?? 1) / Math.max(0.1, w.interval ?? 1);
    if (mix[w.type] != null) mix[w.type] += rate;
  }
  return mix;
}
// 這個傷害組合打 e 的軀幹，平均倍率
export function multVs(mix, e) {
  const ar = e.hp?.torso?.armor ?? 'composite';
  let s = 0, n = 0;
  for (const t in mix) { s += mix[t] * (MULT[t]?.[ar] ?? 1); n += mix[t]; }
  return n ? s / n : 1;
}

// 集火目標（全隊算法一樣 → 兩台自然會挑到同一台）：分數越低越優先
//   「全隊打死牠要多久」= 軀幹血量 ÷ 全隊對牠裝甲的倍率（自己 × 0.6 + 隊友 × 0.4）→ 每 100 點 × ttkK；
//   距離 × distK；隊友正在打的 −follow；離隊友 guardR 格內（正在威脅隊友）−guard；離自己 selfR 格內 −self；
//   原本的集火目標 −stick；失衡中 −0.6；超過 maxD（例如鎖定距離）+ 4
//   回傳 { e, why }：why = '集火'（跟隊友同一台）/ '掩護'（威脅隊友的那台）/ '求援'（貼上自己的）/ null
export function pickFocus(o, tm, opt = {}) {
  const K = { ttkK: +(process.env.TK ?? 2), distK: +(process.env.DK ?? 3), follow: 2, guard: 1, guardR: 7, self: 0, selfR: 6, stick: 1.2, maxD: 99, ...opt };
  const ally = o.allies[0];
  const mine = dmgMix(o.me), theirs = ally ? dmgMix(ally) : null;
  let best = null, bs = 1e9;
  for (const e of o.enemies) {
    const k = multVs(mine, e) * (theirs ? 0.6 : 1) + (theirs ? multVs(theirs, e) * 0.4 : 0);
    let s = (e.hp?.torso?.hp ?? 100) / Math.max(0.3, k) / 100 * K.ttkK + e.dist * K.distK;
    if (ally && ally.foeId === e.id) s -= K.follow;
    if (ally && dist2(ally, e) < K.guardR) s -= K.guard;
    if (e.dist < K.selfR) s -= K.self;
    if (tm.focus === e.id) s -= K.stick;
    if (e.staggered) s -= 0.6;
    if (e.dist > K.maxD) s += 4;
    if (s < bs) { bs = s; best = e; }
  }
  if (!best) return { e: null, why: null };
  let why = null;
  if (best.dist < K.selfR && K.self > 0 && (!ally || dist2(ally, best) > K.guardR)) why = '求援';
  else if (ally && dist2(ally, best) < K.guardR && best.dist > K.guardR * 0.7) why = '掩護';
  else if (ally && ally.foeId === best.id) why = '集火';
  else if (best !== o.enemies[0]) why = '剋制';     // 不是最近的那台：挑裝甲被剋的打
  tm.focus = best.id;
  return { e: best, why };
}

// 團隊意圖接在原本的意圖前面（「集火・齊射」）
export function addNote(act, t) {
  if (!t) return act;
  act.note = act.note ? t + '・' + act.note : t;
  return act;
}

// 把移動往 (tx, tz) 拉：k = 0..1 混合比例；經過 api.steer 避牆
export function pull(api, act, me, tx, tz, k) {
  const u = unit(tx - me.x, tz - me.z);
  const m = act.move ?? { x: 0, z: 0 };
  let mx = m.x * (1 - k) + u.x * k * Math.min(1, u.l / 1.5), mz = m.z * (1 - k) + u.z * k * Math.min(1, u.l / 1.5);
  ({ mx, mz } = api.steer(mx, mz));
  act.move = { x: mx, z: mz };
  return act;
}

// 對隊友威脅最大的敵人（離隊友最近的）
export function threatTo(o, ally) {
  let best = null, bd = 1e9;
  for (const e of o.enemies) { const d = dist2(e, ally); if (d < bd) { bd = d; best = e; } }
  return best ? { e: best, d: bd } : null;
}

// 後排（飛彈 / 砲台）共用：選集火目標、被貼近就往隊友身後退（把追兵帶進前排的攻擊範圍＝誘敵）、離太遠歸隊
//   opt：focus = pickFocus 參數；lureR 幾格內有敵人就誘敵；behind 退到隊友身後幾格；regroup 離隊友超過幾格就歸隊
export function supportPost(o, api, act, tm, opt = {}) {
  const K = { lureR: 8, behind: 3, regroup: 14, lureK: 0.6, regK: 0.45, ...opt };
  const { me } = o, ally = o.allies[0];
  const BT = process.env.BT ?? 'F';
  let t = null;
  if (BT.includes('F')) { const f = pickFocus(o, tm, { maxD: o.lock.range, ...opt.focus }); if (f.e) act.target = f.e.id; t = f.why; }
  const near = o.enemies[0];
  if (BT.includes('L') && near && near.dist < K.lureR && ally.dist > 3.5 && dist2(near, ally) > near.dist + 1) {
    // 追兵比較靠近我：往「隊友身後」退（隊友在我跟追兵之間）
    const u = unit(ally.x - near.x, ally.z - near.z);
    pull(api, act, me, ally.x + u.x * K.behind, ally.z + u.z * K.behind, K.lureK);
    t = '誘敵';
  } else if (BT.includes('R') && ally.dist > K.regroup && (!near || near.dist > K.lureR + 2)) {
    pull(api, act, me, ally.x, ally.z, K.regK);
    t = t ?? '歸隊';
  }
  return addNote(act, t);
}

// 敵方的「火力核心」：遠程輸出最高的那台（飛彈 / 垂直飛彈 / 狙擊 / 燒夷彈；近戰武器不算）
const RANGED = new Set(['missile', 'vmissile', 'split', 'napalm', 'bullet']);
export function rangedDps(e) {
  let s = 0;
  for (const w of Object.values(e.weapons ?? {})) {
    if (!w || w.broken || !(w.ammo > 0) || !RANGED.has(w.kind)) continue;
    s += (w.dmg ?? 0) * (w.pellets ?? 1) * (w.salvo ?? 1) / Math.max(0.2, w.interval ?? 1) * (w.kind === 'bullet' ? 0.5 : 1);
  }
  return s;
}
// 斬首目標：火力核心（遠程輸出 − 距離 × 2）；maxD 格外的不算
export function carryOf(o, maxD = 30) {
  let best = null, bs = -1e9;
  for (const e of o.enemies) {
    if (e.dist > maxD) continue;
    const s = rangedDps(e) - e.dist * 2;
    if (s > bs) { bs = s; best = e; }
  }
  return best;
}
