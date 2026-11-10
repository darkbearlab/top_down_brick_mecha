// ---------- b-knight 騎士・團隊版（beta 2v2：護衛騎士） ----------
// 原本的 knight 大腦（騎槍衝刺 + 盾）＋ 團隊層：
//   - 護衛：沒在對準 / 點火 / 衝刺的時候（守在掩體 / 回馬 / 前進），站到「隊友跟威脅隊友的那台之間」
//     （隊友往威脅方向 2.5–4.5 格），追兵要碰到後排得先經過槍尖
//   - 挑戰對象偏好：威脅隊友（離隊友 10 格內）的那台 → 寫進原大腦的 mem.tgt（挑戰分數 +1.5）
//   - 背部飛彈的鎖定目標（act.target）：隊友在打的那台（集火）
//   - 沒隊友 → 跟原本的 knight 一模一樣
import base from './knight.js';
import { teamBrain, threatTo, unit, pull, addNote } from './lib-b-team.js';

const IDLE = new Set(['守在掩體', '回馬', '前進']);
export const KT = { GUARD: 10, NEAR: 2.5, FAR: 4.5, K: 0.75 };

export default teamBrain('b-knight', base, {
  pre(o, mem, api, tm) {
    if (o.me.charge) return;
    const th = threatTo(o, o.allies[0]);
    tm.th = th;
    if (th && th.d < KT.GUARD) mem.tgt = th.e.id;
  },
  post(o, mem, api, act, tm) {
    const ally = o.allies[0], th = tm.th, me = o.me;
    let t = null;
    if (ally.foeId != null && o.enemies.some(e => e.id === ally.foeId)) act.target = ally.foeId;
    if (!me.charge && th && IDLE.has(act.note)) {
      const ready = act.note !== '回馬';
      const u = unit(th.e.x - ally.x, th.e.z - ally.z), k = Math.min(ready ? KT.FAR : KT.NEAR, th.d * 0.5);
      const gx = ally.x + u.x * k, gz = ally.z + u.z * k;
      if (Math.hypot(gx - me.x, gz - me.z) > 1.2) { pull(api, act, me, gx, gz, KT.K); t = '護衛'; }
    }
    if (typeof act.note === 'string' && act.note.includes('點火') && th && th.d < KT.GUARD && mem.tgt === th.e.id) t = '掩護';
    return addNote(act, t);
  },
});
