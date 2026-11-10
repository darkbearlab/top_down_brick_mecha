// ---------- b-artillery 重砲手・團隊版（beta 2v2） ----------
// 原本 alpha 的 artillery 大腦（掩體後垂直飛彈 + 燒夷彈）＋ 團隊層（lib-b-team.js supportPost）：
//   - 鎖定的目標：正在跟縱火犯纏鬥的（離隊友 7 格內）→ 掩護；隊友在打的 → 集火（垂直飛彈 + 燒夷彈砸同一台）
//   - 被追：往縱火犯身後退（誘敵：追兵走進火焰扇形）；離隊友 15 格以上 → 歸隊
//   - 沒隊友 → 跟原本的 artillery 一模一樣
import base from './artillery.js';
import { teamBrain, supportPost } from './lib-b-team.js';

export default teamBrain('b-artillery', base, {
  post: (o, mem, api, act, tm) => supportPost(o, api, act, tm, { regroup: 15, focus: { guard: 2, guardR: 7, self: 2, selfR: 6 } }),
});
