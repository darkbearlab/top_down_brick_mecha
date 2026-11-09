// ---------- 鏡頭模式 ----------
// fixed 固定：鏡頭一直在南邊往北看（原本的玩法），滑鼠游標指哪打哪
// turn  滑鼠轉向：鏡頭角度、高度不變，但會轉；游標鎖住（看不到滑鼠），左右移 = 轉鏡頭（上半身跟著轉）、上下移 = 瞄準點遠近
//       WASD 照鏡頭方向走（W = 畫面上方 = 機體正前方）；手把：右搖桿左右轉鏡頭
// yaw：鏡頭繞 Y 轉多少（0 = 固定模式的方向）。畫面方向（x 往右、y 往下）↔ 世界方向用 s2w / w2s 換
const KEY = 'brickmecha.view';
export const view = { mode: 'fixed', yaw: 0, aimDist: 9, sens: 1 };
try { Object.assign(view, JSON.parse(localStorage.getItem(KEY)) ?? {}); view.yaw = 0; } catch { /* 用預設 */ }
const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ mode: view.mode, sens: view.sens })); } catch { /* 存不了就算了 */ } };
export function setViewMode(mode) { view.mode = mode; if (mode === 'fixed') view.yaw = 0; save(); }
export function setViewSens(v) { view.sens = v; save(); }
export const turning = () => view.mode === 'turn';
// 畫面方向 → 世界方向
export function s2w(sx, sy) { const c = Math.cos(view.yaw), s = Math.sin(view.yaw); return [sx * c + sy * s, -sx * s + sy * c]; }
// 世界方向 → 畫面方向
export function w2s(wx, wz) { const c = Math.cos(view.yaw), s = Math.sin(view.yaw); return [wx * c - wz * s, wx * s + wz * c]; }
// 鏡頭正前方（畫面上方）的世界方向
export const forward = () => s2w(0, -1);
