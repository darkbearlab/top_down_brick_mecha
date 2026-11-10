// ---------- a-mod-saber 供能狂戰士（alpha；模組實驗） ----------
// berserker 的大腦 + 右背供能模組（能量武器耗能 ×0.7、光束劍傷害 ×1.15）：少一具火箭莢艙，換光束劍更常揮、更痛
// 模組那一側永遠不「架起」（架起模組 = 那一邊的手臂不能用）
import base from './berserker.js';
const isMod = w => w && w.kind === 'module';
export default {
  name: 'a-mod-saber',
  init: base.init,
  think(o, mem, api) {
    const act = base.think(o, mem, api) ?? {};
    const W = o.me.weapons;
    for (const sd of ['L', 'R']) if (isMod(W['back' + sd])) { act.back = { ...(act.back ?? {}), [sd]: false }; }
    return act;
  },
};
