# b-missileer 團隊版（beta 2v2）

原本的 missileer 大腦外面包團隊層（src/brains/b-missileer.js + lib-b-team.js）。沒隊友時行為跟原版一樣。

## 第 1–2 輪（beta）
- 第 1 輪團隊層（後排：集火 + 誘敵 + 歸隊；騎士 / 縱火犯：站到隊友跟威脅之間護衛）→ 對原版同組合都變差
  - knight+missileer 團隊版 vs 原版：5/20 勝；arsonist+artillery 團隊版 vs 原版：5/20 勝
  - 拆開測（各 40 場）：飛彈指揮官的集火 / 誘敵 / 歸隊各自都在雜訊內；**護衛站位**是變差的主因（騎士 / 縱火犯變被動）→ 護衛預設關（env BG=G 才開）
- 第 2 輪：集火改成「全隊打死牠要多久」（軀幹血量 ÷ 全隊傷害類型對牠裝甲的倍率）+ 距離；距離權重太小（0.08）會去打遠的 → 變差，
  距離權重 3（幾乎 = 最近的，加上跟隊友同一台）→ 雜訊內。結論：飛彈追蹤 + 鎖最近的本來就很好，選目標不是主要槓桿

## 第 3–4 輪（beta）
- 搭檔：b-knight（護衛騎士）、b-berserker（獵犬與鷹）
- 團隊層最後留：集火（pickFocus，距離權重 3 → 幾乎是最近的那台、跟隊友同一台優先、低血 / 被剋裝甲加分）+ 意圖「集火 / 掩護 / 求援 / 剋制」
  誘敵 / 歸隊（supportPost 的 lure / regroupOn）測起來雜訊內，關掉
- gauntlet（--n 10）：種子 1 45/50 = 90%、種子 2 50/50 = 100%

## 最終評估（種子 41，每組兩邊各 10 場，勝-負-平）
| 組合 | a-bait-ambush | a-crossfire | a-hammer-anvil | berserker+missileer | knight+missileer | arsonist+missileer | berserker+sniper |
|---|---|---|---|---|---|---|---|
| 護衛騎士 b-knight+b-missileer | 5-15 | 9-9-2 | 10-10 | 4-13-3 | 13-7 | 10-10 | 15-5 |
| 獵犬與鷹 b-berserker+b-missileer | 16-4 | 16-4 | 15-5 | 12-8 | 17-3 | 17-3 | 20-0 |
| 雙狼鉗形 b-berserker×2 | 20-0 | 15-5 | 18-2 | 14-6 | 18-2 | 20-0 | 17-3 |
