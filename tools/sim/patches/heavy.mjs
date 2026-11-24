// 新數值（重火力，src/heavy.js）：觀戰模式現在用的那套。用法：--patch tools/sim/patches/heavy.mjs
// 不加就是舊數值（遊戲本體：遠征、無盡、對戰、試玩場）
import { applyHeavy } from '../../../src/heavy.js';
export default () => applyHeavy();
