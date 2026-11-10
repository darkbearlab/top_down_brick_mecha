// ---------- a-guard 護衛騎士（alpha 2v2；a-knight 的參數版） ----------
// 跟 a-knight 同一顆大腦，但角色是「貼身護衛」：守點緊貼隊友（6 格內）、不主動前進（包夾收尾除外）、
//   挑戰分數偏向貼近隊友的敵人（掩護衝鋒）而不是集火目標
// 沒隊友（雜魚關卡）→ 跟 a-knight / 原版 knight 一樣
import { makeKnight } from './a-knight.js';
export default makeKnight({ name: 'a-guard', LEASH: 6, GUARD: 1.0, FOCUS: 1.0, ADV: 4 });
