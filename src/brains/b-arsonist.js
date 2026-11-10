// ---------- b-arsonist 縱火犯・團隊版（beta 2v2：火牆） ----------
// 原本的 arsonist 大腦（燒夷彈 + 雙噴火器）＋ 團隊層（lib-b-team.js）：
//   - act.target（左背飛彈鎖定）= 集火目標（pickFocus）
//   - （實驗，env BG 含 G）護衛砲台：附近沒東西燒時站到隊友跟威脅之間；第 1 輪測起來變弱，預設關
//   - 沒隊友 → 跟原本的 arsonist 一模一樣
import base from './arsonist.js';
import { teamBrain, threatTo, unit, pull, addNote, pickFocus } from './lib-b-team.js';

export const AK = { NEAR: 7, GUARD: 7, POS: 4.5, K: 0.6, HELP: 0.8 };
const BG = process.env.BG ?? '';

export default teamBrain('b-arsonist', base, {
  post(o, mem, api, act, tm) {
    const ally = o.allies[0], me = o.me;
    const f = pickFocus(o, tm, { maxD: o.lock.range });
    if (f.e) act.target = f.e.id;
    let t = f.why;
    const th = threatTo(o, ally);
    if (BG.includes('G') && th) {
      const busy = o.enemies[0] && o.enemies[0].dist < AK.NEAR;
      if (th.d < AK.GUARD && th.e.dist > 3) { pull(api, act, me, th.e.x, th.e.z, AK.HELP); t = '掩護'; }
      else if (!busy) {
        const u = unit(th.e.x - ally.x, th.e.z - ally.z), k = Math.min(AK.POS, th.d * 0.5);
        const gx = ally.x + u.x * k, gz = ally.z + u.z * k;
        if (Math.hypot(gx - me.x, gz - me.z) > 1.5) { pull(api, act, me, gx, gz, AK.K); t = '護衛砲台'; }
      }
    }
    return addNote(act, t);
  },
});
