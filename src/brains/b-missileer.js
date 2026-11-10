// ---------- b-missileer 飛彈指揮官・團隊版（beta 2v2） ----------
// 原本的 missileer 大腦（掩體邊保持距離、鎖上就齊射）＋ 團隊層（lib-b-team.js supportPost）：
//   - 選目標：隊友正在打的 → 集火；威脅隊友（離隊友 8 格內）的 → 掩護；貼到自己 7 格內的 → 求援（叫前排回防）
//   - 被追：往隊友身後退，把追兵帶進騎槍 / 光束劍的距離（誘敵）；離隊友 14 格以上 → 歸隊
//   - 沒隊友（雜魚關卡）→ 跟原本的 missileer 一模一樣
import base from './missileer.js';
import { teamBrain, supportPost } from './lib-b-team.js';

export default teamBrain('b-missileer', base, {
  post: (o, mem, api, act, tm) => supportPost(o, api, act, tm, { focus: { self: 3, selfR: 7 } }),
});
