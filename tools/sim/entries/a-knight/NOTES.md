# a-knight 團隊版騎士 筆記（alpha 2v2）

從 beta 的 knight 複製（配裝相同：標準頭 / 重裝 / 雙足 / 左盾 / 右騎槍 / 左背直射飛彈 / 全陶瓷）。
大腦 `src/brains/a-knight.js`（`makeKnight(參數)` 工廠；a-guard 共用）；`lib-a-team.js`、`lib-a-beta.js`。
沒隊友時團隊邏輯全關 → 行為 = 原版。隊伍：`tools/sim/teams/a-hammer-anvil.json`（鐵鎚與鐵砧，+ a-missileer）

## 第 1 輪：鐵鎚
- 集火目標（focusPick，同 a-missileer 的評分）→ act.target（左背飛彈打它）
- 挑戰分數：集火目標 +2.5；離隊友 8 格內的敵人每近 1 格 +0.5 →「掩護衝鋒」/「集火衝鋒」
- 主動前進時衝集火目標（「集火前進」）；守點離隊友 > 11 格扣分（當隊友的盾）
- vs 原版 knight+missileer：47/80（40 場一邊）

## 第 2 輪：包夾收尾
- 只剩一台敵人 → 不等，直接前進（隊友 a-missileer 同時縮距離、拉夾角）
- vs beta 獵犬與鷹（b-berserker+b-missileer）：11/40 → 16/40（種子不同，雜訊大）

## 第 4 輪
- 鐵鎚與鐵砧 vs beta 狂戰士隊幾乎全輸（雙狼 1/40）：騎士被火箭（52 > 失衡門檻 50）一直打到失衡，騎槍出不去
  → 這組是「打遠程隊」的組合，被衝臉隊剋（剋制關係，沒再調）
- gauntlet：種子 1 45/50 = 90%、種子 2 43/50 = 86%（a-guard 同）
