// ---------- a-mod-rack 彈藥架飛彈指揮官（alpha；模組實驗） ----------
// a-missileer 的大腦 + 右背彈藥架（垂直飛彈 64 → 96、機砲 / 噴火器 ×1.5）：放棄直射飛彈，換垂直飛彈打不完（2v2 原本 28 秒就打空）
// 模組那一側永遠不「架起」（架起模組 = 那一邊的手臂不能用）
import base from './a-missileer.js';
const isMod = w => w && w.kind === 'module';
export default {
  name: 'a-mod-rack',
  init: base.init,
  think(o, mem, api) {
    const act = base.think(o, mem, api) ?? {};
    const W = o.me.weapons;
    for (const sd of ['L', 'R']) if (isMod(W['back' + sd])) { act.back = { ...(act.back ?? {}), [sd]: false }; }
    return act;
  },
};
