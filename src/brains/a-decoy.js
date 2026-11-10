// ---------- a-decoy 誘餌飛彈機（alpha 2v2；a-missileer 的參數版） ----------
// 跟 a-missileer 同一顆大腦，有隊友時當「誘餌」：站得比隊友靠前、不太找掩體（讓對手先看到、先鎖我），
//   靠推進閃飛彈（飛彈機不用能量開火 → 能量全拿來閃）；隊友躲在牆後用垂直飛彈集火同一台
// 沒隊友（雜魚關卡）→ 跟 a-missileer / 原版 missileer 一樣
import { makeMissileer } from './a-missileer.js';
export default makeMissileer({ name: 'a-decoy', TKEEP: 9, TCOVER: 0.3, FRONT: 0.5 });
