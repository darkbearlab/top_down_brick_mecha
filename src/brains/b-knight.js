// ---------- b-knight 騎士・團隊版（beta 2v2） ----------
// 原本的 knight 大腦（騎槍衝刺 + 盾）＋ 團隊層（lib-b-team.js）：
//   - 集火目標（pickFocus：全隊打死牠最快的、隊友在打的、威脅隊友的）→ act.target（背部飛彈鎖牠）＋ 寫進原大腦的 mem.tgt（挑戰分數 +1.5）
//   - （實驗，env BG 含 G）護衛：沒在衝的時候站到隊友跟威脅隊友那台之間 → 第 1 輪測起來變弱，預設關
//   - 沒隊友 → 跟原本的 knight 一模一樣
import base from './knight.js';
import { teamBrain, threatTo, unit, pull, addNote, pickFocus } from './lib-b-team.js';

const IDLE = new Set(['守在掩體', '回馬', '前進']);
export const KT = { GUARD: 10, NEAR: 2.5, FAR: 4.5, K: 0.75 };
const BG = process.env.BG ?? '';

export default teamBrain('b-knight', base, {
  pre(o, mem, api, tm) {
    if (o.me.charge) return;
    const f = pickFocus(o, tm);
    tm.f = f;
    if (f.e) mem.tgt = f.e.id;
  },
  post(o, mem, api, act, tm) {
    const ally = o.allies[0], me = o.me;
    let t = null;
    if (tm.f?.e) act.target = tm.f.e.id;
    const th = threatTo(o, ally);
    if (BG.includes('G') && !me.charge && th && IDLE.has(act.note)) {
      const ready = act.note !== '回馬';
      const u = unit(th.e.x - ally.x, th.e.z - ally.z), k = Math.min(ready ? KT.FAR : KT.NEAR, th.d * 0.5);
      const gx = ally.x + u.x * k, gz = ally.z + u.z * k;
      if (Math.hypot(gx - me.x, gz - me.z) > 1.2) { pull(api, act, me, gx, gz, KT.K); t = '護衛'; }
    }
    if (typeof act.note === 'string' && act.note.includes('點火')) t = tm.f?.e && mem.tgt === tm.f.e.id ? (tm.f.why ?? '集火') : null;
    return addNote(act, t);
  },
});
