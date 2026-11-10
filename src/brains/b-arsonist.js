// ---------- b-arsonist 縱火犯・團隊版（beta 2v2：火牆護衛） ----------
// 原本的 arsonist 大腦（燒夷彈 + 雙噴火器）＋ 團隊層：
//   - 護衛砲台：附近（7 格）沒東西可燒時，站到「隊友跟威脅隊友的那台之間」（隊友往威脅方向 4–5 格）→ 追兵得穿過火焰
//   - 掩護：有敵人離隊友 7 格內 → 往那台衝過去燒
//   - act.target（左背飛彈的鎖定）= 威脅隊友的那台
//   - 沒隊友 → 跟原本的 arsonist 一模一樣
import base from './arsonist.js';
import { teamBrain, threatTo, unit, pull, addNote } from './lib-b-team.js';

export const AK = { NEAR: 7, GUARD: 7, POS: 4.5, K: 0.6, HELP: 0.8 };

export default teamBrain('b-arsonist', base, {
  post(o, mem, api, act, tm) {
    const ally = o.allies[0], me = o.me;
    const th = threatTo(o, ally);
    if (!th) return act;
    act.target = th.e.id;
    let t = null;
    const busy = o.enemies[0] && o.enemies[0].dist < AK.NEAR;
    if (th.d < AK.GUARD && th.e.dist > 3) { pull(api, act, me, th.e.x, th.e.z, AK.HELP); t = '掩護'; }
    else if (!busy) {
      const u = unit(th.e.x - ally.x, th.e.z - ally.z), k = Math.min(AK.POS, th.d * 0.5);
      const gx = ally.x + u.x * k, gz = ally.z + u.z * k;
      if (Math.hypot(gx - me.x, gz - me.z) > 1.5) { pull(api, act, me, gx, gz, AK.K); t = '護衛砲台'; }
    }
    return addNote(act, t);
  },
});
