# b-berserker 狂戰士・團隊版（beta 2v2）

原本 alpha 的 berserker 大腦外面包團隊層（src/brains/b-berserker.js + lib-b-team.js）。沒隊友時行為跟原版一樣。

## 第 1–2 輪（beta）
- 勝負計算：`勝-負-平`，兩邊各 20 場（雙方各當 A / B）。注意：鏡像對戰平手很多，而且場地兩邊差很大
  （berserker+missileer 鏡像：A 邊 3-17、B 邊 17-3）→ 一定要兩邊都跑、看勝負不是看勝場 / 總場
- 團隊層試過（vs berserker+missileer 原版、各 40 場）：
  - 集火（照全隊打死牠要多久 + 隊友在打的 + 威脅隊友的）：雜訊內（19-20、18-19）
  - 斬首（咬敵方遠程輸出最高的那台）：16-24 / 17-23 → 變差
  - 拴繩（離飛彈指揮官太遠就收回來等敵人衝進兩台火力）：12-25 / 15-23 → 變差（2v2 是搶第一殺，早衝早贏）
- **裝甲：軀幹陶瓷**（其他複合）：2v2 主要傷害是飛彈 / 火箭（化學，複合 ×1.4、陶瓷 ×0.65）
  - vs berserker+missileer 28-10、vs knight+missileer 38-2、vs arsonist+missileer 34-3（原版複合：約 19-20 / 28-10 / 26-10）
  - gauntlet：種子 1 47/50 = 94%、種子 2 48/50 = 96%（全陶瓷 90% / 88%，2v2 差不多 → 選軀幹陶瓷）

## 第 3–4 輪（beta）
- 搭檔：b-missileer（獵犬與鷹）、另一台 b-berserker（雙狼鉗形）
- 雙狼（b-berserker ×2）vs alpha：a-knight+a-missileer 19-1、a-decoy+a-missileer 16-4、a-artillery+a-missileer 14-6；vs berserker+missileer 13-7
  → 光束劍是能量（陶瓷 ×1.4），alpha 全陶瓷的飛彈隊被剋
- 包夾（同一個目標、兩台從同一邊過去 → 往側面繞；BP 0.7）：vs berserker+missileer 17-3（不包夾 14-5）、vs a-decoy 19-1 / 19-1、vs 原版雙狂戰士 12-8（14-6）→ 雜訊內，
  留著（看得到的團隊行為「包夾」，不傷勝率）
- 環境變數拿掉（參數在檔案開頭）；gauntlet（--n 10）：種子 1 47/50 = 94%、種子 2 48/50 = 96%

## 最終評估（種子 41，每組兩邊各 10 場，勝-負-平）
| 組合 | a-bait-ambush | a-crossfire | a-hammer-anvil | berserker+missileer | knight+missileer | arsonist+missileer | berserker+sniper |
|---|---|---|---|---|---|---|---|
| 護衛騎士 b-knight+b-missileer | 5-15 | 9-9-2 | 10-10 | 4-13-3 | 13-7 | 10-10 | 15-5 |
| 獵犬與鷹 b-berserker+b-missileer | 16-4 | 16-4 | 15-5 | 12-8 | 17-3 | 17-3 | 20-0 |
| 雙狼鉗形 b-berserker×2 | 20-0 | 15-5 | 18-2 | 14-6 | 18-2 | 20-0 | 17-3 |
