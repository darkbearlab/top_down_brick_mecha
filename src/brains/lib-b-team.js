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

// 集火目標：分數越低越優先
//   血量比例（軀幹）× hpK、距離 × distK；隊友正在打的 −follow；離隊友 guardR 格內（正在威脅隊友）−guard；
//   離自己 selfR 格內 −self；原本的集火目標 −stick；失衡中 −0.6
//   回傳 { e, why }：why = '集火'（跟隊友同一台）/ '掩護'（威脅隊友的那台）/ '求援'（貼上自己的）/ null
export function pickFocus(o, tm, opt = {}) {
  const K = { hpK: 4, distK: 0.08, follow: 2.5, guard: 1.5, guardR: 8, self: 0, selfR: 6, stick: 1.2, ...opt };
  const ally = o.allies[0];
  let best = null, bs = 1e9;
  for (const e of o.enemies) {
    let s = hpFrac(e) * K.hpK + e.dist * K.distK;
    if (ally && ally.foeId === e.id) s -= K.follow;
    if (ally && dist2(ally, e) < K.guardR) s -= K.guard;
    if (e.dist < K.selfR) s -= K.self;
    if (tm.focus === e.id) s -= K.stick;
    if (e.staggered) s -= 0.6;
    if (s < bs) { bs = s; best = e; }
  }
  if (!best) return { e: null, why: null };
  let why = null;
  if (best.dist < K.selfR && K.self > 0 && (!ally || dist2(ally, best) > K.guardR)) why = '求援';
  else if (ally && dist2(ally, best) < K.guardR && best.dist > K.guardR * 0.7) why = '掩護';
  else if (ally && ally.foeId === best.id) why = '集火';
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
  const BT = process.env.BT ?? 'FLR';
  let t = null;
  if (BT.includes('F')) { const f = pickFocus(o, tm, opt.focus); if (f.e) act.target = f.e.id; t = f.why; }
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
