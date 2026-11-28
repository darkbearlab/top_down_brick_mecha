// ---------- 控制器插槽（2026-11-28） ----------
// 每台機體每幀收到一份「操作幀」（frame），由執行器 applyFrame 照著做：架 / 收背部武器 → 推進 → 移動 → 主動裝置 → 開火
//   誰在操作 = 機體掛的控制器（m.ctrl.kind，沒掛 = 'ai'）：
//     ai     ：內建 AI（ai.js stepMech：updateEnemy + 模式的 postUpdate + 卡點迴避），把決定寫進幀；外掛大腦（brainapi.js）在 updateEnemy 裡接手，一樣寫進幀
//     local  ：本地玩家（main.js localFrame：鍵盤 / 手把 → 幀）
//     remote ：遠端（以後的多人連線，伺服器權威）：從佇列拿幀（pushFrame）；沒有新的就沿用上一幀的移動、瞄準、按住的扳機，一次性的（推進、切換、裝置）不重複
//              鎖定由伺服器照這台的頭算（sensors.js computeLocks，每台一份 m.lockS），客戶端只送瞄準點
//   AI / 大腦不直接動機體：qBoost / qReady / qGuns / qDevice 只把要做的事記進這一幀，回傳「做不做得到」的預判（AI 原本的邏輯照舊）
//
// 操作幀的格式（遠端送來的也是這個；aim = 地上的瞄準點，aimYaw = 上半身要轉到的方向，沒給就照 aim 算）：
//   { mx, mz,                 移動方向（世界座標，長度 0～1）
//     aimYaw, aim: { x, z },  上半身方向、瞄準點（拋射武器的落點、裝置丟的位置）
//     fire: { L, R },         左右扳機（按住）
//     ready: { L, R },        這一幀要不要切換左 / 右的背部武器（按一下）
//     boost: { x, z } | null, 推進方向（按一下）
//     device: { x, z } | null 主動裝置用在哪（按一下）
//     locks                   鎖定中的目標（伺服器算，客戶端不用給） }
import { canBoost, canToggle, driveMech, mechs, toggleReady, tryBoost } from './mech.js';
import { updateGuns } from './weapons.js';
import { deviceReady, updateDeviceCd, useDevice } from './devices.js';
import { computeLocks, makeLockState } from './sensors.js';
import { sfx } from './audio.js';

export const blankFrame = () => ({ mx: 0, mz: 0, aimYaw: null, aim: null, fire: { L: false, R: false }, ready: { L: false, R: false }, boost: null, device: null, locks: null });
const frameOf = m => m.frame ??= blankFrame();
// 這一幀開始：清空（AI 控制器在 updateEnemy 之前叫）
export const beginFrame = m => (m.frame = blankFrame());

// ---- AI / 大腦用：把要做的事記進這一幀 ----
export function qGuns(m, trig, locks, aim) { const f = frameOf(m); f.fire = { L: !!trig.L, R: !!trig.R }; f.locks = locks; f.aim = aim; }
export function qBoost(m, x, z) { if (!canBoost(m)) return false; frameOf(m).boost = { x, z }; return true; }
export function qReady(m, side) { const f = frameOf(m); if (f.ready[side] || !canToggle(m, side)) return false; f.ready[side] = true; return true; }
export function qDevice(m, at) { if (!m.device || !deviceReady(m)) return false; frameOf(m).device = { x: at.x, z: at.z }; return true; }

// ---- 執行器：任何控制器的幀都走這裡 ----
export function applyFrame(m, f, dt) {
  if (!m.alive || m.drop) return;
  for (const side of ['L', 'R']) if (f.ready?.[side] && !toggleReady(m, side) && m.isPlayer) sfx.click();
  if (f.boost) tryBoost(m, f.boost.x, f.boost.z);
  const aimYaw = f.aimYaw ?? (f.aim ? Math.atan2(f.aim.x - m.x, f.aim.z - m.z) : m.torsoYaw);
  driveMech(m, dt, f.mx ?? 0, f.mz ?? 0, aimYaw);
  if (f.device && m.device) useDevice(m, f.device);
  updateDeviceCd(m, dt);
  updateGuns(m, f.fire ?? { L: false, R: false }, dt, f.locks ?? [], f.aim);
}

// ---- 控制器 ----
// kind：'ai'（預設）/ 'local' / 'remote'；remote 帶一個幀佇列和自己的鎖定狀態
export function setCtrl(m, kind) {
  m.ctrl = { kind };
  if (kind === 'remote') { m.ctrl.queue = []; m.ctrl.last = null; m.lockS = makeLockState(); }
  return m.ctrl;
}
export const ctrlOf = m => m.ctrl?.kind ?? 'ai';
// 遠端送來一幀（之後網路層呼叫；現在模擬 / 除錯用）
export function pushFrame(m, f) { if (ctrlOf(m) !== 'remote') setCtrl(m, 'remote'); m.ctrl.queue.push(f); }
// 遠端控制器出這一幀：佇列最舊的；沒有 → 沿用上一幀的持續部分；鎖定照這台的頭算
export function remoteFrame(m, dt) {
  const C = m.ctrl;
  const f = C.queue.length ? C.queue.shift() : C.last ? { ...C.last, ready: { L: false, R: false }, boost: null, device: null } : blankFrame();
  C.last = f;
  f.locks = computeLocks(m, mechs, f.aim, dt, m.lockS);
  return f;
}
