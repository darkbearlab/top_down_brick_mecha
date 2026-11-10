# a-decoy 誘餌飛彈機 筆記（alpha 2v2）

配裝 = a-missileer（missileer 原版）；大腦 `src/brains/a-decoy.js` = `makeMissileer({ TKEEP: 9, TCOVER: 0.3, FRONT: 0.5 })`。
有隊友時：想站的距離 11 → 9、掩體權重 1 → 0.3（讓對手看到）、站得比隊友離目標近（FRONT）→ 意圖「誘敵」；
集火、包夾收尾跟 a-missileer 一樣。沒隊友 = 原版 missileer。
隊伍：`tools/sim/teams/a-bait-ambush.json`（誘餌與伏擊，+ a-missileer）

## 第 3 輪：初版
- vs 原版 knight+missileer 33/40；vs 獵犬與鷹 12/40（種子 11）
- 對照：a-missileer×2 vs 獵犬與鷹 15/40、原版 missileer×2 21/40（雜訊 ±8）

## 第 6 輪：隔牆鎖定 2 倍時間後
- 跟 a-missileer 同一顆大腦（加了「先鎖看得到的」+「探頭鎖定」）：gauntlet 種子 1–4 = 81% → 93%（48 / 45 / 46 / 47）
