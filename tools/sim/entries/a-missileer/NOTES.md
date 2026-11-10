# a-missileer 團隊版飛彈指揮官 筆記（alpha 2v2）

從 beta 的 missileer 複製（配裝相同：長距鎖定頭 / 重裝 / 雙足 / 機槍 + 機砲 / 垂直飛彈 + 直射飛彈 / 全陶瓷）。
大腦 `src/brains/a-missileer.js`；共用 `src/brains/lib-a-team.js`（集火評分、交叉夾角）、`lib-a-beta.js`（lib-beta 的複本，不受 beta 之後改動影響）。
沒隊友時（雜魚關卡）團隊邏輯全關 → 行為 = 原版。
隊伍：`tools/sim/teams/a-hammer-anvil.json`（+ a-knight）、`a-crossfire.json`（+ a-artillery）

## 基準（未訓練的原版配對，各邊 20 場，種子 1；X 兩邊加總）
- berserker+sniper vs knight+missileer 10/40；artillery+missileer vs knight+arsonist 40/40
- sniper+missileer vs berserker+knight 20/40；arsonist+berserker vs sniper+artillery 10/40
- → 飛彈（尤其垂直飛彈 + 隔牆鎖定）主宰 2v2；近戰配對很弱

## 第 1 輪：集火 + 交叉火網
- focusPick：兩台用同一套評分（−有效血量 / 120 + 輸出 / 120 − 距離 × 0.06；隊友在打的 +2.5；貼近隊友 8 格內每格 +0.35；咬住 +1.2）→ act.target
- 站位：鎖定距離算到集火目標；跟隊友對目標的夾角 × 0.8（交叉火網）；跟隊友 < 5 格扣分
- 結果 vs 原版 artillery+missileer（各邊 20）：交叉火網 8/40（！）、夾角關掉 13/40、集火也關 16/40
  → 交叉站位反而害死自己（拉開夾角 = 離開掩體、被兩台看到）；頭 / 背部被打壞的次數明顯比對手多
- 鐵鎚與鐵砧（+ a-knight）vs 原版 knight+missileer：21/40（20 場）、夾角關 47/80（40 場）

## 第 2 輪：包夾收尾
- 看紀錄：先殺掉一台後 2v1 打不死躲牆的飛彈機 → 拖到時間到。
- 改：只剩一台敵人、隊友還在 → 距離 11 → 7.5、跟隊友拉夾角（交叉只在這時用）、要看得到 → 意圖「包夾」
- 交叉火網 vs 獵犬與鷹 10/40 → 22/40；鐵鎚與鐵砧 11/40 → 16/40
- 大腦改成 `makeMissileer(參數)` 工廠（a-decoy 共用）

## 第 3 輪：集火有沒有用、等破綻
- 鏡像 a-missileer×2 vs 原版 missileer×2（各邊 40 場，種子 21）：集火 + 包夾 46/80、全關 37/80 → 團隊邏輯 +~11%
- 「等破綻」：對手推進得了（能量 ≥ 30、沒冷卻）就壓著直射飛彈不打 → 壓 1.5 秒 28/80、0.8 秒 41/80 → 關掉（HOLD = 0）
  → 飛彈對轟裡，火力的量比挑時機重要
