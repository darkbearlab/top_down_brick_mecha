// ---------- 新數值（重火力，docs/HEAVY_TEST_PLAN.md） ----------
// 叛擊士式的節奏：子彈快到躲不掉、機槍彈量大但燒得快、雜魚攻擊慾和準度高、拿重武器的雜魚比較耐打、交戰距離拉長、迫擊砲
// 套用的地方：遠征（main.js startStage，2026-11-26 起）、觀戰（main.js watchNumbers）
// 不套用：無盡、對戰、試玩場（還是舊數值）；無頭模擬預設也是舊的，加 --patch tools/sim/patches/heavy.mjs 才是新的
// 做法：applyHeavy() 直接改 WEAPONS / HEADS / GRUNTS_LOW / SQUADS / SHOT_TUNE / AI_TUNE 的欄位並記下原值；clearHeavy() 一個一個放回去
//   任何模式重設場地（resetWorld）都先 clearHeavy() → 離開後完全還原
import { BAL, GRUNTS, GRUNTS_LOW, GRUNT_WEIGHT, HEADS, HEAVY_GRUNTS, SQUADS, WEAPONS } from './parts.js';
import { SHOT_TUNE } from './weapons.js';
import { AI_TUNE } from './ai.js';

export const HEAVY = {
  bulletSpeedK: 2,      // 實彈（kind 'bullet'）飛行速度倍率；飛行時間同時減半 → 射程不變
  enemyShotK: 1,        // 敵人子彈速度（舊數值 0.55，狙擊 0.5：刻意放慢讓玩家躲得掉）
  mg: { interval: 0.025, ammo: 1200, dmg: 2.5 },   // 機槍：扣住約 30 秒打光（舊 0.07 秒、720 發 ≈ 50 秒）；每發 4 → 2.5（每秒傷害 57 → 100，不然拿機槍的精英雜魚 / 王牌每秒 160 太兇）
  lockRangeK: 1.5,      // 頭部鎖定距離倍率（16～34 格 → 24～51 格）
  wantK: 1.6,           // 射擊型的理想交戰距離倍率（8～13 格 → 13～20 格）
  indirectWant: 18,     // 迫擊砲站多遠
  // 雜魚：攻擊慾、準度（DIFFS 的 err / rest 倍率）、耐久照底盤
  grunt: { errK: 0.45, restK: 0.55 },   // 耐久照底盤（AI_TUNE.gruntChassis：履帶 ×1.3、懸浮 / 飛行 ×0.8），跟武器無關
  // 低階武器：射速、散布往正規版靠（雜魚不再只是靶子）
  low: {
    mg_l: { interval: 0.075, spread: 0.06 },
    autocannon_l: { interval: 0.18, spread: 0.035 },
    shotgun_l: { interval: 0.85 },
  },
  packSquadMax: 3,      // 每隊最多幾台：遠征的小隊、雜魚包（觀戰、模擬 squad:）；2026-11-26 從 2 拉回 3（散開部署之後一包 9 台）
};

// 雜魚重整（新數值）：照射程分
//   近距突擊：突擊兵 = 霰彈槍 + 光束劍（電擊兵併進來）
//   中距火力：巡邏兵 = 機槍 + 火箭莢艙（火箭兵併進來）；機砲兵 = 機砲 + 直射飛彈（小飛彈兵併進來）
//   遠距：射手 = 狙擊槍
//   特殊兵種維持單一（或原本的）武器：迫擊砲車、噴火兵、燒夷兵、砲塔、盾兵、旋停機、自爆機、衝鋒機、戰車、無人機；蟲不動
//   武器一律換成制式（全威力）版：低階版（_l）只剩迫擊砲 mortar_l（它沒有制式版）
const GRUNT_ROSTER = {
  scout: { armR: 'mg', backL: 'rocket' },
  trooper: { armR: 'autocannon', backL: 'missile' },
  brawler: { armL: 'saber', armR: 'shotgun' },
  marksman: { armR: 'sniper' },
  mortar: { backR: 'mortar_l' },
  pyro: { armR: 'flamer' },
  igniter: { armR: 'mg', backL: 'napalm' },
  turret: { armR: 'autocannon' },
  shielder: { armL: 'shield', armR: 'autocannon' },
  gunship: { armR: 'mg', backL: 'missile' },
};
// 併掉的機種 → 改用哪一種（小隊名單、空投權重跟著換）
const GRUNT_MERGE = { stick: 'brawler', bazooka: 'scout', launcher: 'trooper' };

let saved = null;   // [[物件, 欄位, 原值]]
const set = (o, k, v) => { saved.push([o, k, o[k], k in o]); o[k] = v; };

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
  set(WEAPONS.mg, 'dmg', HEAVY.mg.dmg);
  // 連射武器的後座加大：扛著連射有持續的推力感（REALISM_REPORT M2）
  for (const id of ['mg', 'autocannon', 'mg_l', 'autocannon_l']) set(WEAPONS[id], 'recoil', WEAPONS[id].recoil * 2);
  for (const [id, o] of Object.entries(HEAVY.low)) for (const [k, v] of Object.entries(o)) if (WEAPONS[id]) set(WEAPONS[id], k, v);
  for (const h of Object.values(HEADS)) if (h.lockRange) set(h, 'lockRange', h.lockRange * HEAVY.lockRangeK);
  // 迫擊砲：迫擊砲車換成真的迫擊砲（拋射、落點預告、越過建築），砲擊陣地也會出現在街區
  set(GRUNTS_LOW.mortar, 'backR', 'mortar_l');
  set(SQUADS.mortar, 'themes', { ...SQUADS.mortar.themes, city: 3 });
  // 戰車、偵察無人機（parts.js HEAVY_GRUNTS）：放進雜魚池；砲擊陣地 = 迫擊砲車 + 無人機（觀測者）；新的裝甲小隊 = 戰車 + 機砲兵
  for (const [k, G] of Object.entries(HEAVY_GRUNTS)) { set(GRUNTS_LOW, k, G); set(GRUNTS, k, G); set(GRUNT_WEIGHT, k, k === 'tank' ? 1 : 0.6); }
  set(SQUADS.mortar, 'units', ['mortar', 'spotter', 'mortar']);
  set(SQUADS, 'armor', { name: '裝甲小隊', faction: 'base', units: ['tank', 'trooper', 'tank'], themes: { city: 2, open: 2, plaza: 1 }, minDepth: 1 });
  // 雜魚重整（2026-11-26）：照射程把選項整合在較少的機種上，武器全部換成制式（全威力）版
  for (const [k, lo] of Object.entries(GRUNT_ROSTER)) if (GRUNTS_LOW[k]) for (const s of ['armL', 'armR', 'backL', 'backR']) set(GRUNTS_LOW[k], s, lo[s] ?? null);
  for (const [k, to] of Object.entries(GRUNT_MERGE)) { set(GRUNT_WEIGHT, to, (GRUNT_WEIGHT[to] ?? 0) + (GRUNT_WEIGHT[k] ?? 0)); set(GRUNT_WEIGHT, k, 0); }
  for (const S of Object.values(SQUADS)) if (S.units.some(u => GRUNT_MERGE[u])) set(S, 'units', S.units.map(u => GRUNT_MERGE[u] ?? u));
  // 飛彈小隊（2026-11-25）：機砲兵 ×2 + 射手 單獨對王牌只打得出 76 → 射手換成巡邏兵（火箭莢艙壓制），模擬 222
  set(SQUADS.missile, 'units', ['trooper', 'trooper', 'scout']);
  // 遠征的隊伍池（2026-11-26）：蟲族封存（之後重設計）、縱火隊封存（衝進來只是送分）；
  //   單獨對王牌打不出傷害的（砲擊陣地、狙擊組、突擊隊、旋停機隊）改成支援隊：只跟同區的一隊主力一起出現（main.js startStage）
  for (const k of ['hive', 'stampede', 'swarm', 'arson']) set(SQUADS[k], 'sealed', true);
  for (const k of ['mortar', 'snipers', 'rush', 'gunships']) set(SQUADS[k], 'support', true);
  set(SQUADS.snipers, 'hold', 4);   // 狙擊組：守著自己的位置（掩護主力），不跟著衝
  // 火控（FCS，2026-11-26）：新數值下飛彈一直被斷鎖（轉角多、每射一輪就清掉鎖定）→ 一場射不到上限的六成
  //   玩家的火控改成：頭部隨時在追蹤（不用先架起飛彈）、鎖上的目標躲起來保留 1.5 秒（鎖定框閃爍）、射一輪只扣 40% 鎖定進度、
  //   直射飛彈末段轉向 ×2.5、標準頭扇形 40° → 60°；直射飛彈玩家一次 3 發（彈藥 48 → 72，一樣 24 輪）
  //   2026-11-26 也給王牌級（觀戰王牌、遠征頭目：BAL.fcsAI 'ace'），雜魚照舊；基準測試（一直瞄最近的敵人、有鎖就射）每分鐘傷害 1191 → 約 1880，火箭莢艙 2213
  set(BAL, 'fcsAI', 'ace');
  set(BAL, 'fcsPassive', true);
  set(BAL, 'lockHold', 1.5);
  set(BAL, 'relock', 'heat');
  set(BAL, 'missileTurnK', 2.5);
  set(HEADS.std, 'lockArc', 60);
  set(WEAPONS.missile, 'playerSalvo', 3);
  set(WEAPONS.missile, 'ammo', 72);
  // AI
  set(AI_TUNE, 'gruntErrK', HEAVY.grunt.errK);
  set(AI_TUNE, 'gruntRestK', HEAVY.grunt.restK);
  set(AI_TUNE, 'gruntChassis', true);
  set(AI_TUNE, 'wantK', HEAVY.wantK);
  set(AI_TUNE, 'indirectWant', HEAVY.indirectWant);
  set(AI_TUNE, 'leadReal', true);   // 預判照實際子彈速度
  set(AI_TUNE, 'ace', true);        // 王牌新戰術
  set(AI_TUNE, 'memory', true);     // 感知與最後已知位置（REALISM_REPORT A2）
  set(AI_TUNE, 'spotter', true);    // 迫擊砲要有觀測者（A1）
  set(AI_TUNE, 'aware', true);      // 王牌的戰場意識（威脅、包圍、出現點）
  set(AI_TUNE, 'gruntLanes', true); // 雜魚小隊分三路接近（ai.js laneGoal）
  set(AI_TUNE, 'discipline', true); // 王牌的紀律：武器照期望傷害選、推進要有理由、減員（集火殘血、換血虧了退掩體）
}
export function clearHeavy() {
  if (!saved) return;
  for (let i = saved.length - 1; i >= 0; i--) { const [o, k, v, had] = saved[i]; if (had) o[k] = v; else delete o[k]; }   // 原本沒有的欄位（新加的雜魚、小隊）整個拿掉
  saved = null;
}
export const heavyOn = () => !!saved;
// 雜魚包（觀戰、模擬 squad:）的成員：新數值下每隊最多 packSquadMax 台
export const packUnits = (SQ, k) => saved ? SQ[k].units.slice(0, HEAVY.packSquadMax) : SQ[k].units;
