// ---------- 新數值（重火力，docs/HEAVY_TEST_PLAN.md） ----------
// 叛擊士式的節奏：子彈快到躲不掉、機槍彈量大但燒得快、雜魚攻擊慾和準度高、拿重武器的雜魚比較耐打、交戰距離拉長、迫擊砲
// 套用的地方：重火力測試模式（startStage 時 EN.heavy）、所有觀戰模式（main.js watchNumbers；觀戰選單可以切回舊數值）
// 不套用：遠征、無盡、對戰、試玩場（遊戲本體還是舊數值）；無頭模擬預設也是舊的，加 --patch tools/sim/patches/heavy.mjs 才是新的
// 做法：applyHeavy() 直接改 WEAPONS / HEADS / GRUNTS_LOW / SQUADS / SHOT_TUNE / AI_TUNE 的欄位並記下原值；clearHeavy() 一個一個放回去
//   任何模式重設場地（resetWorld）都先 clearHeavy() → 離開後完全還原
// 只有重火力測試模式才用的（敵人總耐久、每隊台數）在 HEAVY 裡，由 main.js 自己讀
import { GRUNTS_LOW, HEADS, SQUADS, WEAPONS } from './parts.js';
import { SHOT_TUNE } from './weapons.js';
import { AI_TUNE } from './ai.js';

export const HEAVY = {
  bulletSpeedK: 2,      // 實彈（kind 'bullet'）飛行速度倍率；飛行時間同時減半 → 射程不變
  enemyShotK: 1,        // 敵人子彈速度（舊數值 0.55，狙擊 0.5：刻意放慢讓玩家躲得掉）
  mg: { interval: 0.025, ammo: 1200 },   // 機槍：扣住約 30 秒打光（舊 0.07 秒、720 發 ≈ 50 秒）
  lockRangeK: 1.5,      // 頭部鎖定距離倍率（16～34 格 → 24～51 格）
  wantK: 1.6,           // 射擊型的理想交戰距離倍率（8～13 格 → 13～20 格）
  indirectWant: 18,     // 迫擊砲站多遠
  // 雜魚：攻擊慾、準度（DIFFS 的 err / rest 倍率）、依武器總重加耐久
  grunt: { errK: 0.45, restK: 0.55, hpW: 0.07 },
  // 低階武器：射速、散布往正規版靠（雜魚不再只是靶子）
  low: {
    mg_l: { interval: 0.075, spread: 0.06 },
    autocannon_l: { interval: 0.18, spread: 0.035 },
    shotgun_l: { interval: 0.85 },
  },
  // 只在重火力測試模式（遠征流程）用
  enemyHpK: 2.5,        // 敵人耐久倍率
  squadMax: 2,          // 每隊最多幾台（平常 3）
};

let saved = null;   // [[物件, 欄位, 原值]]
const set = (o, k, v) => { saved.push([o, k, o[k]]); o[k] = v; };

export function applyHeavy() {
  if (saved) return;
  saved = [];
  // 子彈
  for (const d of Object.values(WEAPONS)) if (d.kind === 'bullet') { set(d, 'speed', d.speed * HEAVY.bulletSpeedK); set(d, 'life', d.life / HEAVY.bulletSpeedK); }
  set(SHOT_TUNE, 'enemy', HEAVY.enemyShotK);
  set(SHOT_TUNE, 'sniper', HEAVY.enemyShotK);
  set(SHOT_TUNE, 'carry', true);   // 射速不被幀率卡住
  set(SHOT_TUNE, 'speedK', HEAVY.bulletSpeedK);
  // 武器
  set(WEAPONS.mg, 'interval', HEAVY.mg.interval);
  set(WEAPONS.mg, 'ammo', HEAVY.mg.ammo);
  for (const [id, o] of Object.entries(HEAVY.low)) for (const [k, v] of Object.entries(o)) if (WEAPONS[id]) set(WEAPONS[id], k, v);
  for (const h of Object.values(HEADS)) if (h.lockRange) set(h, 'lockRange', h.lockRange * HEAVY.lockRangeK);
  // 迫擊砲：迫擊砲車換成真的迫擊砲（拋射、落點預告、越過建築），砲擊陣地也會出現在街區
  set(GRUNTS_LOW.mortar, 'backR', 'mortar_l');
  set(SQUADS.mortar, 'themes', { ...SQUADS.mortar.themes, city: 3 });
  // AI
  set(AI_TUNE, 'gruntErrK', HEAVY.grunt.errK);
  set(AI_TUNE, 'gruntRestK', HEAVY.grunt.restK);
  set(AI_TUNE, 'gruntHpW', HEAVY.grunt.hpW);
  set(AI_TUNE, 'wantK', HEAVY.wantK);
  set(AI_TUNE, 'indirectWant', HEAVY.indirectWant);
}
export function clearHeavy() {
  if (!saved) return;
  for (let i = saved.length - 1; i >= 0; i--) { const [o, k, v] = saved[i]; o[k] = v; }
  saved = null;
}
export const heavyOn = () => !!saved;
