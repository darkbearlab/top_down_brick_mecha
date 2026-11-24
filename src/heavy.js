// ---------- 重火力測試模式的數值覆蓋（docs/HEAVY_TEST_PLAN.md 第 2 階段） ----------
// 只在重火力測試（EN.heavy）裡生效：startStage 蓋好場地後 applyHeavy()；任何模式重設場地（resetWorld）時先 clearHeavy() 還原
// 原本的數值記在 saved 裡，還原時一個一個放回去 → 離開這個模式後遊戲、無頭模擬完全不受影響
import { GRUNTS_LOW, HEADS, SQUADS, WEAPONS } from './parts.js';
import { SHOT_TUNE } from './weapons.js';

export const HEAVY = {
  bulletSpeedK: 2,      // 實彈（kind 'bullet'）飛行速度倍率；飛行時間同時減半 → 射程不變
  enemyShotK: 1,        // 敵人子彈速度（平常 0.55，狙擊 0.5：刻意放慢讓玩家躲得掉）
  mg: { interval: 0.025, ammo: 1200 },   // 玩家機槍：扣住約 30 秒打光（平常 0.07 秒、720 發 ≈ 50 秒）
  enemyHpK: 2.5,        // 敵人耐久倍率
  squadMax: 2,          // 每隊最多幾台（平常 3）
  wantK: 1.6,           // 射擊型敵人的理想交戰距離倍率（8～13 格 → 13～20 格）
  lockRangeK: 1.5,      // 頭部鎖定距離倍率（16～34 格 → 24～51 格）
};

let saved = null;   // [[物件, 欄位, 原值]]
const set = (o, k, v) => { saved.push([o, k, o[k]]); o[k] = v; };

export function applyHeavy() {
  if (saved) return;
  saved = [];
  for (const d of Object.values(WEAPONS)) if (d.kind === 'bullet') { set(d, 'speed', d.speed * HEAVY.bulletSpeedK); set(d, 'life', d.life / HEAVY.bulletSpeedK); }
  set(WEAPONS.mg, 'interval', HEAVY.mg.interval);
  set(WEAPONS.mg, 'ammo', HEAVY.mg.ammo);
  set(SHOT_TUNE, 'enemy', HEAVY.enemyShotK);
  set(SHOT_TUNE, 'sniper', HEAVY.enemyShotK);
  set(SHOT_TUNE, 'carry', true);   // 射速不被幀率卡住
  set(SHOT_TUNE, 'speedK', HEAVY.bulletSpeedK);
  for (const h of Object.values(HEADS)) if (h.lockRange) set(h, 'lockRange', h.lockRange * HEAVY.lockRangeK);
  // 迫擊砲：迫擊砲車換成真的迫擊砲（拋射、落點預告、越過建築），砲擊陣地也會出現在街區
  set(GRUNTS_LOW.mortar, 'backR', 'mortar_l');
  set(SQUADS.mortar, 'themes', { ...SQUADS.mortar.themes, city: 3 });
}
export function clearHeavy() {
  if (!saved) return;
  for (let i = saved.length - 1; i >= 0; i--) { const [o, k, v] = saved[i]; o[k] = v; }
  saved = null;
}
export const heavyOn = () => !!saved;
