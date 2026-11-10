// ---------- b-berserker 狂戰士・團隊版（beta 2v2：獵犬） ----------
// 原本 alpha 的 berserker 大腦（挑獵物 → 火箭 → 突進 → 劍 / 樁）＋ 團隊層：
//   - 回防：有敵人離隊友 7 格內（在咬後排）→ 獵物換成牠（寫進原大腦的 mem.tid：咬住加分）
//   - 集火：隊友在打的那台血 ≤ 55% → 一起咬牠
//   - act.target = 現在的獵物（隊友的 foeId 看得到我在咬誰 → 後排跟著集火）
//   - 沒隊友 → 跟原本的 berserker 一模一樣
import base from './berserker.js';
import { teamBrain, threatTo, hpFrac, addNote } from './lib-b-team.js';

export const BK = { GUARD: 7, FOLLOW: 0.55 };

export default teamBrain('b-berserker', base, {
  pre(o, mem, api, tm) {
    const ally = o.allies[0];
    const th = threatTo(o, ally);
    tm.why = null;
    if (th && th.d < BK.GUARD && th.e.dist < 16) { mem.tid = th.e.id; tm.why = '回防'; return; }
    const af = o.enemies.find(e => e.id === ally.foeId);
    if (af && hpFrac(af) <= BK.FOLLOW && af.dist < 16) { mem.tid = af.id; tm.why = '集火'; }
  },
  post(o, mem, api, act, tm) {
    if (mem.tid != null) act.target = mem.tid;
    return addNote(act, tm.why);
  },
});
