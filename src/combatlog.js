// ---------- 戰鬥紀錄 ----------
// 給分析戰鬥用（無頭模擬 tools/sim、之後的 AI 對打）：平常關著，完全不花效能
// 事件（CL.events）：{ t 秒, type, ... }，機體用 id（makeMech 給的流水號）
//   fire     開火：m, slot, w 武器 id, n 發數（飛彈齊射）
//   hit      命中（hitMech 的結果）：tgt, src 攻擊者 id, w 武器 id, part 打到的部位, raw 原始傷害, eff 剋制倍率, dir 方向 front/side/rear,
//            flags：shield 被盾擋 / eshield 護盾 / core 打爆核心
//   dmg      實際扣血（damagePart，所有扣血都會經過這裡：子彈、爆風、燃燒、撞牆…）：tgt, part, amt 實際扣掉的, src, w（沒有攻擊者 = 狀態 / 撞牆）
//   break    部位壞掉：tgt, part, src, w
//   kill     整台被擊毀：tgt, src, w
//   boost    推進：m, dx, dz；stagger 失衡：m, power；ready 切換背部武器：m, side, back（true = 架起背部武器）
//   charge   騎槍：m, phase（ignite / dash / hit / wall）
//   intent   AI 自己寫的意圖（brain 用 note(m, text)）：m, text
// 攻擊者：打傷害之前用 att(攻擊者, 武器 id, () => …) 包起來，裡面的 hitMech / damagePart 都記到它頭上
export const CL = { on: false, t: 0, events: [], src: null };
export function logStart() { CL.on = true; CL.t = 0; CL.events = []; CL.src = null; }
export function logStop() { CL.on = false; return CL.events; }
export function log(type, o) { if (CL.on) CL.events.push({ t: Math.round(CL.t * 1000) / 1000, type, ...o }); }
export function att(owner, w, fn) {
  if (!CL.on) return fn();
  const prev = CL.src;
  CL.src = { id: owner?.id ?? null, w };
  try { return fn(); } finally { CL.src = prev; }
}
export const srcOf = () => CL.src ? { src: CL.src.id, w: CL.src.w } : {};
export function note(m, text) { if (CL.on && m.lastNote !== text) { m.lastNote = text; log('intent', { m: m.id, text }); } }
