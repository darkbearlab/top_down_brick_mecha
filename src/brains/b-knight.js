// ---------- b-knight 騎士・團隊版（beta 2v2） ----------
// 原本的 knight 大腦（騎槍衝刺 + 盾）＋ 團隊層（lib-b-team.js）：
//   - 集火目標（pickFocus：全隊打死牠最快的、隊友在打的、威脅隊友的）→ act.target（背部飛彈鎖牠）＋ 寫進原大腦的 mem.tgt（挑戰分數 +1.5）
//   - 突擊：對手兩台都沒有近戰武器（飛彈 / 砲台隊）→ 騎槍準備好就不在掩體等，直接往集火目標壓（盾擋直射飛彈），意圖「突擊」
//     對手有近戰（狂戰士 / 騎士）→ 照原本守在掩體等牠上門（主動壓上去反而輸）
//   - （實驗，KT.GUARD_ON）護衛：沒在衝的時候站到隊友跟威脅隊友那台之間 → 第 1 輪測起來變弱，關掉
//   - 沒隊友 → 跟原本的 knight 一模一樣
import base from './knight.js';
import { teamBrain, threatTo, unit, pull, addNote, pickFocus } from './lib-b-team.js';

const IDLE = new Set(['守在掩體', '回馬', '前進']);
export const KT = { GUARD: 10, NEAR: 2.5, FAR: 4.5, K: 0.75, GUARD_ON: false, ASSAULT: 1 };
const MELEE_W = new Set(['saber', 'pile', 'lance', 'flame']);
const hasMelee = e => Object.values(e.weapons ?? {}).some(w => w && !w.broken && MELEE_W.has(w.kind));

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
    if (KT.GUARD_ON && !me.charge && th && IDLE.has(act.note)) {
      const ready = act.note !== '回馬';
      const u = unit(th.e.x - ally.x, th.e.z - ally.z), k = Math.min(ready ? KT.FAR : KT.NEAR, th.d * 0.5);
      const gx = ally.x + u.x * k, gz = ally.z + u.z * k;
      if (Math.hypot(gx - me.x, gz - me.z) > 1.2) { pull(api, act, me, gx, gz, KT.K); t = '護衛'; }
    }
    // 突擊：騎槍準備好了還在「守在掩體」等人上門 → 直接往集火目標壓上去（盾在前面擋直射飛彈）
    if (KT.ASSAULT && !me.charge && act.note === '守在掩體' && tm.f?.e && !o.enemies.some(hasMelee)) {
      const e = tm.f.e;
      if (e.dist > 6) { pull(api, act, me, e.x, e.z, KT.ASSAULT); t = '突擊'; }
    }
    if (typeof act.note === 'string' && act.note.includes('點火')) t = tm.f?.e && mem.tgt === tm.f.e.id ? (tm.f.why ?? '集火') : null;
    return addNote(act, t);
  },
});
