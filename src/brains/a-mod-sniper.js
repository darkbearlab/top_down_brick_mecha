// ---------- a-mod-sniper 彈藥架狙擊手（alpha；模組實驗） ----------
// sniper 的大腦 + 右背彈藥架（彈藥 ×1.5：兩把狙擊槍 14 → 21 發、飛彈 48 → 72）：少一具自衛飛彈，換子彈打得完一整包雜魚
// 模組那一側永遠不「架起」（架起模組 = 那一邊的手臂不能用）
import base from './sniper.js';
const isMod = w => w && w.kind === 'module';
export default {
  name: 'a-mod-sniper',
  init: base.init,
  think(o, mem, api) {
    const act = base.think(o, mem, api) ?? {};
    const W = o.me.weapons;
    for (const sd of ['L', 'R']) if (isMod(W['back' + sd])) { act.back = { ...(act.back ?? {}), [sd]: false }; }
    return act;
  },
};
