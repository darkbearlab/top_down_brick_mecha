// ---------- 晶片（被動）與主動裝置：資料和被動效果的鉤子 ----------
// 機體配裝多三個欄位：chips = [晶片 1（插在頭部：頭被打爆就失效）, 晶片 2（插在軀幹）]、device = 主動裝置（R / 滑鼠中鍵 / 手把 Y）
// basic = 整備時就能選的基礎款；其他的要在遠征裡撿（補給箱有機率開出來、頭目一定掉一個），關卡之間重組時換上
// 這個檔案只放資料和「查一下有沒有這個效果」的小函式（給 mech / weapons / ai / sensors 用，不 import 那些模組，避免循環）；
// 主動裝置實際的效果在 devices.js
import { G } from './core.js';

export const CHIPS = {
  reactive: { name: '反應裝甲', basic: true, weight: 1, desc: '每個部位每 8 秒，第一次被打中的傷害減半' },
  quickSwap: { name: '快速換裝', basic: true, weight: 1, desc: '手臂 / 背部武器切換幾乎不用展開時間' },
  steady: { name: '穩定架', basic: true, weight: 2, desc: '幾乎沒在動時：散布歸零、傷害 +20%；移動中散布 ×1.5' },
  doubleBoost: { name: '雙段推進', basic: true, weight: 1, desc: '推進幾乎沒有冷卻（可以連噴），但能量回復 −25%' },
  ram: { name: '衝角推進', weight: 2, desc: '推進一律往機體正面噴；主動撞上敵人時自己受傷 −70%、對方 ×2.5 並失衡' },
  lastStand: { name: '背水', weight: 1, desc: '軀幹耐久低於 30%：傷害 +40%、射速 +25%' },
  lowCG: { name: '低重心', weight: 2, desc: '不會失衡；推進距離 −40%' },
  lockPlus: { name: '鎖定擴充', weight: 1, desc: '多鎖一個目標；鎖定扇形角度 ×0.6' },
  salvage: { name: '殘骸回收', weight: 1, desc: '每擊破一台，所有武器回復上限 4% 的彈藥' },
};
// charges = 次數（彈藥補給站補滿）；cd = 冷卻秒數
export const DEVICES = {
  grenade: { name: '手榴彈', basic: true, weight: 2, charges: 3, desc: '往游標丟出去（最遠 14 格），範圍爆炸 75（化學）；剋蟲群、盾兵' },
  mine: { name: '地雷', basic: true, weight: 2, charges: 3, desc: '放在腳邊，0.8 秒後啟動，敵人靠近就炸（110）；場上最多 3 顆' },
  smoke: { name: '煙霧彈', basic: true, weight: 2, charges: 2, desc: '往游標丟出去，一片煙 8 秒：敵人看不穿、鎖定被打斷' },
  mark: { name: '弱點標定', weight: 1, cd: 14, desc: '標記游標附近的敵人 8 秒：打中它時大多會打到軀幹以外的部位（拆頭目的頭、手腳、武器）' },
  emp: { name: '電磁脈衝', weight: 2, cd: 18, desc: '周圍 7 格的敵人失衡、武器停擺 2 秒、鎖定被打斷；自爆機的引信被切斷' },
  shieldGen: { name: '護盾發生器', weight: 3, cd: 16, desc: '正面能量護盾 3 秒：擋下正面的子彈和光束（擋不住爆風）' },
  overload: { name: '超載', weight: 1, cd: 20, desc: '5 秒射速 ×1.5，之後過熱 3 秒射速減半' },
  decoy: { name: '誘餌', weight: 2, cd: 22, desc: '原地放一台半透明的假機體 6 秒，附近的敵人改打它' },
};
export const BASIC_CHIPS = Object.keys(CHIPS).filter(k => CHIPS[k].basic);
export const BASIC_DEVICES = Object.keys(DEVICES).filter(k => DEVICES[k].basic);
export const techName = id => CHIPS[id]?.name ?? DEVICES[id]?.name ?? '';
export const techWeight = lo => (lo.chips ?? []).reduce((a, id) => a + (CHIPS[id]?.weight ?? 0), 0) + (DEVICES[lo.device]?.weight ?? 0);

// 有沒有這個晶片（晶片 1 插在頭部：頭壞了就失效）
export const hasChip = (m, id) => !!m.chips && ((m.chips[0] === id && !m.parts?.head?.broken) || m.chips[1] === id);
const still = m => Math.hypot(m.vx, m.vz) < 0.8;
const desperate = m => m.parts.torso.hp < m.parts.torso.max * 0.3;
// 傷害倍率（穩定架、背水）
export function chipDmgK(m) {
  let k = 1;
  if (hasChip(m, 'steady') && still(m)) k *= 1.2;
  if (hasChip(m, 'lastStand') && desperate(m)) k *= 1.4;
  return k;
}
// 散布倍率（穩定架）
export const chipSpreadK = m => hasChip(m, 'steady') ? (still(m) ? 0 : 1.5) : 1;
// 射擊間隔倍率（背水、超載：5 秒快、之後 3 秒過熱變慢）
export function chipRateK(m) {
  let k = 1;
  if (hasChip(m, 'lastStand') && desperate(m)) k *= 0.8;
  const o = m.overload;
  if (o) { if (G.now < o.until) k /= 1.5; else if (G.now < o.until + 3) k *= 2; }
  return k;
}
export const empOff = m => (m.empT ?? 0) > G.now;   // 被電磁脈衝打到：武器停擺

// ---------- 煙霧（devices.js 放，ai.js 判斷視線時查） ----------
export const smokes = [];
// 線段 (x1,z1)-(x2,z2) 有沒有穿過任何一團煙
export function smokeBlocks(x1, z1, x2, z2) {
  for (const s of smokes) {
    if (G.now > s.until) continue;
    const dx = x2 - x1, dz = z2 - z1, L2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((s.x - x1) * dx + (s.z - z1) * dz) / L2));
    if (Math.hypot(x1 + dx * t - s.x, z1 + dz * t - s.z) < s.r) return true;
  }
  return false;
}
