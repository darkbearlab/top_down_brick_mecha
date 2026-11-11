# 機體動作實驗規格（物理化動畫）

寫給接手做「依重量、損傷改變動作」實驗的工作階段。讀完這份再動手；不清楚的地方問使用者，不要猜。

## 目標
把機體的動作從現在的「正弦擺動」換成有重量、有物理感的程序動畫，並且隨狀態改變：
- **重量**：輕機體腳步輕快、落地彈；重機體（超載）步伐沉、下沉多、轉身慢、煞車有慣性。
- **損傷**：腳部受損 → 跛行、步伐不對稱；腳部被打壞 → 拖行；手臂壞了 → 上半身重心偏到另一邊；軀幹重創 → 整台前傾、喘息似的起伏。
- **事件**：失衡（被打歪、搖晃後恢復）、推進衝刺（前傾、腳離地）、揮劍 / 打樁 / 騎槍衝刺的全身動作、急停、撞牆卡住、空投落地。
- **依損傷切換骨架 / 動作組**：例如腳壞到某個程度就換成跛行的步態，而不是同一組動作打折。

## 硬性規則（最重要）
1. **動畫只能是畫面。** 不能改到任何遊戲邏輯：位置 `m.x / m.z`、速度、`m.torsoYaw`、`m.legYaw`、碰撞半徑、命中判定、槍口位置、移動速度、推進、失衡時間。
   - 槍口位置來自 `muzzleOf()` → `toWorld()`，用的是邏輯狀態（`m.x`、`m.torsoYaw`、`m.model.hipY`、`m.model.muzzles`），**不讀模型的矩陣**。所以手臂怎麼擺都不影響射擊，請保持這樣；不要把動畫寫回 `m.model.muzzles` 或 `m.model.hipY`。
   - 動畫要的隨機性用自己的雜湊或 `G.now`，**不要呼叫 `Math.random()`**。AI 研究用的無頭模擬器（`tools/sim/`）用固定種子的 `Math.random` 重播戰鬥，多吃一次亂數就會讓所有對戰結果跑掉。
   - 模擬器不會呼叫 `poseMech`（只有 `src/main.js` 每幀呼叫），所以動畫程式放在 `poseMech` 這條路徑上就天然不影響模擬。完成後還是要跑一次 `node --import ./tools/sim/register.mjs tools/sim/duel.mjs --a 突擊型 --b 狙擊型 --n 10 --seed 1 --quiet --out tools/sim/out/anim-check`，結果要跟 `main` 上跑的一模一樣。
2. **如果某個效果需要改玩法**（例如「單腳受損」：目前腳是一個部位 `legs`，沒有左右腳分開的耐久），先停下來問使用者，不要自己加。畫面上可以自己挑一邊當「壞的那隻」（用機體 id 雜湊決定，固定不變）。
3. **不要寫 localStorage。** 裡面是使用者的真實資料（`brickmecha.loadout`、`brickmecha.gfx`、`brickmecha.workshop` 等）。
4. **不要重做一個現有遊戲**；這是原創的方塊機甲。
5. 依照 `C:\Users\user\.claude\projects\C--claude-project-top-down-brick-mecha\memory\` 的使用者偏好（回覆用繁體中文）。

## 現在的動畫在哪
- **唯一的入口：`poseMech(m, dt)`（`src/mech.js` 約 741 行）**，每幀對每台機體呼叫一次。現在做的事：
  - 懸浮腳上下浮動、旋停機上下飄。
  - 失衡：整台往被打的方向歪（`m.staggerT / m.staggerMax / m.stagDir`）。
  - 卡牆：往撞到的方向陷進去、顫動（`m.stuckT / m.stuckN / m.stuckHit`）。
  - 腳：兩隻腳 `M.legs[0/1].rotation.x = ±sin(m.walk) * 0.45`；上半身隨步伐上下、腳壞了下沉 + 左右晃。
  - 上半身前後左右傾（`m.lean`，由加速度算）。
  - 揮劍時手臂掃過去（`m.swing`）；背部武器架上肩膀時手臂垂下（`m.readyK`）。
  - 受損部位冒火、冒煙（這部分保留）。
- **步伐相位 `m.walk`** 在 `driveMech`（`src/mech.js` 約 292 行）裡累加；履帶、懸浮不累加。這是邏輯程式裡唯一跟動畫有關的值，可以讀，不要改它的累加方式（腳步聲跟它走）。
- **模型結構：`buildMechModel(lo, team)`（`src/model.js` 約 143 行）**
  - `root`（放在 `m.x, m.z`）
    - `legsG`（轉向 = `m.legYaw`）→ 腳部 `parts.legs.g` → 骨盆方塊 + 兩隻腳 `legs[0/1]`（只有雙足、逆關節有；掛在骨盆的 `legL/legR` 點上）
    - `torsoG`（高度 = `hipY`、轉向 = `m.torsoYaw`、`rotation.order = 'YXZ'`）→ 軀幹、頭、`armL/armR`、`backL/backR` 各自一個群組 `parts[slot].g`
  - 每個部位的方塊是 `voxbody.js` 的 `VoxBody`（只畫外露面、被打會掉方塊）。**不要重建網格來做動畫**，動 `Group` 的變換就好。
  - 腳現在是一整隻一塊（沒有膝蓋）。要做膝蓋 / 腳踝，需要把腳的方塊依高度切成大腿、小腿、腳掌好幾個群組。外型資料在 `src/shapes.js`（`legs:biped`、`leg:biped` 等）和 `localStorage` 的 `brickmecha.workshop`（零件工坊，使用者自己做的形狀，只讀不寫）。切法要對任何形狀都成立（用高度比例或在形狀上加關節點；加關節點要先問使用者，因為會動到零件工坊的格式）。

## 可以讀的狀態
| 想要的 | 從哪裡讀 |
|---|---|
| 重量、超載 | `m.spec.total`（總重）、`m.spec.loadK`（總重 ÷ 腳的載重，> 1 = 超載）、`m.spec.moveK`；`computeSpec()` 在 `src/parts.js` |
| 腳型 | `m.spec.legs.type`：`biped` 雙足、`reverse` 逆關節、`tread` 履帶、`hover` 懸浮；`hipY` 髖高 |
| 部位耐久 | `m.parts[name].hp / .max / .broken`，name = `head torso armL armR backL backR legs`；`legK(m)` = 腳的出力係數 |
| 速度、加速度 | `m.vx / m.vz`、`m.lastV`、`m.lean`（已經濾過的加速度傾斜） |
| 推進 | 推進中的狀態在 `driveMech` / `tryBoost`（`src/mech.js` 152–175 行），能量 `m.energy` |
| 近戰 | `m.swing`（光束劍）、`m.punch`（打樁拳）、`m.charge`（衝擊騎槍：點火 → 衝刺） |
| 失衡、卡住 | `m.staggerT / staggerMax / stagDir`、`m.stuckT / stuckMax / stuckN / stuckHit` |
| 空投中 | `m.drop`（`poseMech` 目前直接跳過） |

## 不在範圍內（先不要動）
- 雜魚（`m.grunt`，外型在 `src/gruntbodies.js`）、蟲（`src/bugs.js`）、旋停機（`m.fly`）、菁英機的自訂身體（`ELITES[].body`）：它們的身體結構不同。先做王牌機（玩家和 AI 的完整機體），有餘力再問使用者要不要延伸。
- 殘骸和爆炸（`src/wreck.js`）。
- 數值平衡、AI。

## 怎麼測試
- 開發伺服器：`python tools/serve.py <port>`（不快取的靜態伺服器）。**主要工作階段用 8090，你用別的 port（例如 8091）**，在自己的 `.claude/launch.json` 改。
- 開瀏覽器測試時開新分頁（tabs_create），不要用使用者的預覽分頁，測完關掉。
- 網址加 `?tick`；除錯介面 `window.__dbg`：`startDuel(preset, 'hard')`、`startRun()`、`mechs`、`player`、`paused`（設 true 凍結畫面但繼續畫）。預設機體在 `src/parts.js` 的 `ENEMY_PRESETS`。
- 要看特定狀況：直接改測試分頁裡的狀態，例如 `m.parts.legs.hp = m.parts.legs.max * 0.2`、`m.parts.legs.broken = true`、換不同重量的配裝。
- 主選單的展示空間（`src/showroom.js`）會把玩家機體放在中間慢慢轉，很適合拿來看待機動作。
- 鏡頭是高角度俯視（看得到上半身和腳的側面），動作設計要在這個角度看得出來；特寫鏡頭時會比較近。

## 交付
- 在自己的 worktree 分支上做，分成幾個可以單獨看的提交（例如：1. 重量感步態 2. 跛行 / 拖行 3. 失衡和推進 4. 近戰全身動作）。
- 每一步截圖或錄影給使用者看，問過再往下做。
- 合併回 `main` 前：跑上面那行模擬確認結果一致；遊戲裡實際走、打、被打一輪，主控台沒有錯誤；說明對效能的影響（每台機體每幀多做了什麼）。
- 提交訊息結尾加 `Co-Authored-By: Claude <noreply@anthropic.com>` 一類的署名（照當下系統的提示）。是否推送、怎麼合併，問使用者。
