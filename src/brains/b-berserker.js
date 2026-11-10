// ---------- b-berserker 狂戰士・團隊版（beta 2v2：獵犬） ----------
// 原本 alpha 的 berserker 大腦（挑獵物 → 火箭 → 突進 → 劍 / 樁）＋ 團隊層（lib-b-team.js）：
//   - 集火目標（pickFocus：全隊打死牠最快的 / 隊友在打的 / 威脅隊友的）在 FOC 格內 → 寫進原大腦的 mem.tid（咬住加分）
//   - 回防：有敵人離隊友 GUARD 格內 → 獵物換成牠
//   - act.target = 現在的獵物（隊友的 foeId 看得到我在咬誰）
//   - 包夾：隊友（另一台狂戰士 / 前排）也在咬同一台、兩台從同一邊過去 → 往側面繞到另一邊（意圖「包夾」）
//   - 配裝：軀幹換陶瓷（2v2 主要吃飛彈 / 火箭 = 化學）
//   - 沒隊友 → 跟原本的 berserker 一模一樣
import base from './berserker.js';
import { teamBrain, threatTo, addNote, pickFocus, carryOf, pull, dist2 } from './lib-b-team.js';
const BL = 0;   // 拴繩（離隊友太遠就收回來）：測起來變差，關掉
const BP = 0.7; // 包夾：往側面繞的力道
const BH = 0;   // 斬首（咬敵方遠程輸出最高的）：測起來變差，關掉

export const BK = { GUARD: 5, FOC: 16 };

export default teamBrain('b-berserker', base, {
  pre(o, mem, api, tm) {
    const ally = o.allies[0];
    const th = threatTo(o, ally);
    tm.why = null;
    if (th && th.d < BK.GUARD && th.e.dist < 16) { mem.tid = th.e.id; tm.why = '回防'; return; }
    if (BH) { const c = carryOf(o, BH); if (c) { mem.tid = c.id; tm.why = '斬首'; return; } }
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
    // 包夾：隊友也在打同一台、我們從同一邊過去 → 往側面繞，從另一邊咬（對手沒辦法同時面對兩台）
    if (BP && tg && ally.foeId === tg.id && tg.dist > 3.5 && tg.dist < 13 && !act.boost) {
      const ax = ally.x - tg.x, az = ally.z - tg.z, al = Math.hypot(ax, az) || 1;
      const mx = o.me.x - tg.x, mz = o.me.z - tg.z, ml = Math.hypot(mx, mz) || 1;
      if ((ax * mx + az * mz) / (al * ml) > -0.4 && al < 14) {
        const sd = (ax * mz - az * mx) >= 0 ? 1 : -1;            // 繞到離隊友遠的那一側
        const lx = (-mz / ml) * sd, lz = (mx / ml) * sd;
        const m = act.move ?? { x: 0, z: 0 };
        let nx = m.x + lx * BP, nz = m.z + lz * BP;
        ({ mx: nx, mz: nz } = api.steer(nx, nz));
        act.move = { x: nx, z: nz }; tm.why = '包夾';
      }
    }
    return addNote(act, tm.why);
  },
});
