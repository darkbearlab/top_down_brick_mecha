# 無頭戰鬥模擬（tools/sim）

不開瀏覽器、不畫畫面，直接用遊戲本身的戰鬥程式（`src/*.js`）跑對戰，固定 60 幀 / 秒，一場 30 秒的戰鬥大約 0.2 秒跑完。給分析戰鬥、調平衡、讓 AI 代理寫電腦 AI 互打用。

## 準備（第一次）
```
cd tools/sim && npm install && cd ../..
```
（只裝 three@0.160.0，跟遊戲用的同版；`node_modules` 和 `out/` 不進 git）

## 跑對戰
```
node --import ./tools/sim/register.mjs tools/sim/duel.mjs --a 突擊型 --b 狙擊型 --n 20 --seed 1
```
- `--a` / `--b`：機體名字（`parts.js` 的 `ENEMY_PRESETS`、`ELITES`），或配裝 JSON 檔的路徑
- `--n` 幾場、`--seed` 種子（同一個種子結果完全一樣）、`--diff` 電腦難度（easy / normal / hard，預設 hard）、`--max` 每場最長幾秒（預設 120，時間到比剩餘耐久比例）
- `--out` 輸出資料夾（預設 `tools/sim/out/<時間>`）、`--quiet` 不印每場
- `--headless`：無頭模式（`src/headless.js`，跟伺服器同一條路：不建方塊模型、建築網格、粒子…，快大約 5 倍）。規則一樣，但少了只為畫面吃的亂數，所以同一個種子的結果跟一般模式不會一模一樣（統計上相近）；每個腳本都能加
- 場地：對戰模式的 64×48 對稱場地，A 在左、B 在右
- 數值：預設是舊數值（遊戲本體）。觀戰模式現在用的新數值（重火力，`src/heavy.js`）要加 `--patch tools/sim/patches/heavy.mjs`（同時換成新觀戰場地 96×72 街區；`--arena old / big` 可以單獨指定場地）

## 換電腦的大腦
`--brainA` / `--brainB`：`src/brains/` 裡的名字或 .js 路徑（沒給 = 遊戲內建 AI）。怎麼寫大腦見 [BRAINS.md](BRAINS.md)。

## 看結果
```
node tools/sim/report.mjs <輸出資料夾>        # 總結 + 每場一行
node tools/sim/report.mjs <輸出資料夾> 3      # 第 3 場的完整時間線
```
- `summary.json`：每場的整理（`analyze.mjs` 的 `summarize`）+ 總結（`aggregate`）
- `battle-N.jsonl`：一行一個事件；事件種類見 `src/combatlog.js` 開頭的說明
  - 每 0.25 秒一筆 `state`：雙方位置、速度、上半身角度、能量、各部位耐久、各掛點彈藥、距離

## 怎麼運作
- `register.mjs`：先裝 `shim.mjs`（最小的假 document / window / canvas / localStorage），再掛 `hooks.mjs`（`three` 指到這裡的 node_modules；`core.js` 的 WebGLRenderer 換成假的）；有 `--headless` 就先設 `globalThis.__HEADLESS__`
- 無頭模式（`src/core.js` 的 `HEADLESS`）：遊戲規則只有一份，畫面的部分在無頭時直接跳過 —— 機體 = `model.js` 的 `buildMechBody`（只有骨架群組、槍口 / 掛點 / 核心從零件資料算，跟模型一樣）、建築方塊第一次被打到才建（`buildings.js` 的 `ensureVox`）、特效 / 子彈 / 光環換成共用的 `VOID`；不需要假的瀏覽器環境
- 戰鬥紀錄（`src/combatlog.js`）平常關著；`duel.mjs` 開著跑，所有扣血都經過 `damagePart`，攻擊者用 `att(攻擊者, 武器, fn)` 標記
- 每場用自己的種子取代 `Math.random`，所以可重現
