// ---------- b-berserker 狂戰士・團隊版（beta 2v2：獵犬） ----------
// 原本 alpha 的 berserker 大腦（挑獵物 → 火箭 → 突進 → 劍 / 樁）＋ 團隊層（lib-b-team.js）：
//   - 集火目標（pickFocus：全隊打死牠最快的 / 隊友在打的 / 威脅隊友的）在 FOC 格內 → 寫進原大腦的 mem.tid（咬住加分）
//   - 回防：有敵人離隊友 GUARD 格內 → 獵物換成牠
//   - act.target = 現在的獵物（隊友的 foeId 看得到我在咬誰）
//   - 沒隊友 → 跟原本的 berserker 一模一樣
import base from './berserker.js';
import { teamBrain, threatTo, addNote, pickFocus, carryOf, pull, dist2 } from './lib-b-team.js';
const BL = +(process.env.BL ?? 0);
const BH = process.env.BH ?? '';

export const BK = { GUARD: 5, FOC: 16 };

export default teamBrain('b-berserker', base, {
  pre(o, mem, api, tm) {
    const ally = o.allies[0];
    const th = threatTo(o, ally);
    tm.why = null;
    if (th && th.d < BK.GUARD && th.e.dist < 16) { mem.tid = th.e.id; tm.why = '回防'; return; }
    if (BH) { const c = carryOf(o, +BH); if (c) { mem.tid = c.id; tm.why = '斬首'; return; } }
    const f = pickFocus(o, tm);
    if (f.e && f.e.dist < BK.FOC) { mem.tid = f.e.id; tm.why = f.why; }
  },
  post(o, mem, api, act, tm) {
    if (mem.tid != null) act.target = mem.tid;
    // 拴繩：離隊友超過 BL 格、而且獵物還沒進到 BL 格內 → 往隊友那邊收（等敵人自己衝進兩台的火力裡）
    const ally = o.allies[0], tg = o.enemies.find(e => e.id === mem.tid) ?? o.enemies[0];
    if (BL && tg && ally.dist > BL * 0.6 && tg.dist > 7.5 && dist2(tg, ally) > 9 && !tg.staggered) {
      const k = Math.min(1, (ally.dist - BL * 0.6) / (BL * 0.4));
      pull(api, act, o.me, ally.x, ally.z, k * 0.9); act.boost = null; tm.why = '等隊友';
    }
    return addNote(act, tm.why);
  },
});
