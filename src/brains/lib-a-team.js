// ---------- alpha 2v2 團隊共用工具（a-* 隊伍大腦） ----------
// 核心：兩台用「同一套」評分挑目標 → 自然收斂到同一台（集火）；
//   隊友已經在打的 +分（跟上）、靠近隊友的敵人 +分（掩護）、血少 / 裝甲吃虧的 +分（先殺得死的）
// 沒有隊友（雜魚關卡、一對一）→ 回傳 null，大腦照原本的單機行為
// 介面見 tools/sim/BRAINS.md（act.target、obs.allies[].foeId）

// 剋制：攻擊類型 → 裝甲倍率（src 規則摘要）
const K = {
  kinetic: { composite: 0.65, ceramic: 1, mirror: 1.4 },
  chemical: { composite: 1.4, ceramic: 0.65, mirror: 1 },
  energy: { composite: 1, ceramic: 1.4, mirror: 0.65 },
};
export const armorK = (type, armor) => K[type]?.[armor] ?? 1;

// 一台敵人「還要打多少」：軀幹血 / 我方主力武器對它軀幹裝甲的倍率
export function ehpOf(e, type) {
  const t = e.hp?.torso;
  if (!t) return 100;
  return t.hp / armorK(type, t.armor);
}
// 一台敵人的大概輸出（每秒）
export function dpsOf(e) {
  let d = 0;
  for (const s of ['armL', 'armR', 'backL', 'backR']) {
    const w = e.weapons?.[s];
    if (!w || w.broken || !(w.ammo > 0) || w.kind === 'shield') continue;
    if (w.kind === 'lance') { d += 40; continue; }
    d += (w.dmg ?? 0) * (w.pellets ?? 1) * (w.salvo ?? 1) / (w.interval || 1);
  }
  return d;
}

// 隊伍的集火目標
//   opt.type   我方主力傷害類型（算 ehp 用）
//   opt.follow 隊友正在打的 +分；opt.guard 敵人貼近隊友的 +分（每格）；opt.guardR 掩護半徑
//   opt.near   距離權重；opt.stick 不亂換
// 回傳 { e, why } 或 null（沒隊友）
export function focusPick(o, mem, opt = {}) {
  const A = o.allies ?? [];
  const E = o.enemies ?? [];
  if (!A.length || !E.length) return null;
  const me = o.me;
  const type = opt.type ?? 'chemical';
  let best = null, bs = -1e9, why = '';
  for (const e of E) {
    if (e.grunt) continue;
    let s = -ehpOf(e, type) / 120 + dpsOf(e) / 120;
    s -= e.dist * (opt.near ?? 0.06);
    let w = '集火';
    for (const a of A) {
      if (a.foeId === e.id) s += opt.follow ?? 2.5;
      const da = Math.hypot(e.x - a.x, e.z - a.z);
      const gr = opt.guardR ?? 8;
      if (da < gr) { const g = (gr - da) * (opt.guard ?? 0.35) * (a.hpFrac < 0.5 ? 1.6 : 1); s += g; if (g > 1.2) w = '掩護'; }
    }
    if (mem.focus === e.id) s += opt.stick ?? 1.2;
    if (s > bs) { bs = s; best = e; why = w; }
  }
  if (!best) return null;
  mem.focus = best.id;
  return { e: best, why };
}

// 交叉火網：站的點 q 跟隊友 a 對目標 t 的夾角（0..π）；越接近 90° 越好（牆擋不住兩邊）
export function crossAngle(qx, qz, a, t) {
  const ux = qx - t.x, uz = qz - t.z, vx = a.x - t.x, vz = a.z - t.z;
  const l = (Math.hypot(ux, uz) * Math.hypot(vx, vz)) || 1e-6;
  return Math.acos(Math.max(-1, Math.min(1, (ux * vx + uz * vz) / l)));
}

// 意圖字串：原本的 + 團隊的（同樣的字連續只記一次 → 團隊字放前面）
export const teamNote = (tag, base) => (tag ? (base ? tag + '・' + base : tag) : base);
