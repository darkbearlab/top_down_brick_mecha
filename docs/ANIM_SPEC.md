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
  - 腳現在是一整隻一塊（沒有膝蓋）。**做膝蓋是這次的正式範圍，使用者已經同意。**
    - 可以在形狀資料加關節點（例如 `knee`、`ankle`，跟現有的 `hand`、`legL` 這類點同一種格式），並且改零件工坊（`src/workshop.js`）讓使用者能放這些點。
    - 必須向下相容：沒有關節點的形狀（包括使用者在 `brickmecha.workshop` 裡自己做的）要有合理的預設（例如照腳的高度比例切）。程式只讀那份資料，不要替使用者改寫或遷移它。
    - 腳的方塊依關節點切成大腿、小腿、腳掌各自的群組（`src/model.js` 的 `buildLegs`），逆關節的膝蓋往後彎。
    - 外型資料在 `src/shapes.js`（`legs:biped`、`leg:biped` 等）。
  - **手肘也在範圍內**（使用者同意）：手臂形狀（`arm`，已經有 `hand` 點，武器接在手上）一樣可以加 `elbow` 點，切成上臂和前臂（含武器）兩個群組，規則同上（零件工坊可以放點、沒有點的形狀用預設比例）。
    - 注意槍口：子彈從邏輯上的槍口（`muzzleOf()`，不看模型）射出。**開火、瞄準時前臂和武器要回到筆直朝前的姿勢**，畫面上的槍口才會對得上子彈出來的位置。手肘彎曲用在待機、走路擺臂、失衡、被打、近戰揮擊、背部武器架起時手臂垂下這些不開火的時候。
    - 右手是左手的鏡像（`buildMechModel` 裡 `R` 的處理），切群組時兩邊一起處理。

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
- 雜魚（`m.grunt`，外型在 `src/gruntbodies.js`）、旋停機（`m.fly`）、菁英機的自訂身體（`ELITES[].body`）：先做王牌機（玩家和 AI 的完整機體）。王牌機做完、使用者看過之後，**可以延伸到這些**（使用者同意由你接手更多部分），一樣先截圖給使用者看再合併。
- 蟲（`src/bugs.js`）另有一套方塊蟲的動作，延伸前先問。
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

## 交接說明（給開發 session，2026-11-12）
分支 `claude/mech-physics-animation-42bf6f`。階段 1–4 都做完了，只剩光束劍的新姿勢等參考圖重做。

### 做了什麼
- **階段 1 重量感**：有關節的腳（膝蓋、腳踝）用 IK 踩地；上半身用彈簧跟著加減速前傾、急停往回晃；重量越重步伐越沉。
- **階段 2 損傷**：腳不到 50% 輕跛、不到 25% 重跛、損毀拖著一隻腳；少一隻手臂上半身歪向另一邊；軀幹重創駝背、喘。
- **階段 3 事件**：失衡踉蹌補一步、撞牆卡住、推進時腳離地、空投下墜和落地蹲。
- **階段 4 近戰**：打樁拳（蓄力 → 直拳）、騎槍（夾槍 → 突刺）有扭腰、踏步、下蹲的全身動作。光束劍維持原本的掃法（`SABER_NEW = false`），試做的 IK 和姿勢表留在 `src/anim.js` 裡關著。

### 動到哪些遊戲檔案
- `src/anim.js`（新）：全部的動畫。入口 `animMech(m, dt, air)`，狀態放在 `m.model.anim`。機體沒有關節（雜魚、菁英、旋停機）就回傳 false，什麼都不做。
- `src/mech.js`：`poseMech` 先呼叫 `animMech`；回傳 true 的機體，舊的擺腳、上半身、手臂那幾行跳過。空投中（`m.drop`）也會呼叫，只擺姿勢。
- `src/model.js`：一般零件組的機體，腳切成大腿 / 小腿 / 腳掌、手臂切成上臂 / 前臂。多了 `model.rig = { legs: [{ hip, knee, ankle, hipP, kneeP, ankleP, sole, side }], arms: { armL: { shoulder, elbow, elbowP, handP }, … } }`。有自訂身體的（`lo.body`）不切，`rig.legs = []`。
- `src/voxbody.js`：方塊身體可以分段畫（`segment`），方塊資料還是同一份，磨損、傳送、爆開不變。`offStream(fn)`：只為畫面多建立的 three.js 物件不吃 `Math.random`。
- `src/shapes.js`：外型多了關節點 `elbow`、`knee`、`ankle`（可以不放，`model.js` 的 `autoJoints` 會照外型算）。
- `src/workshop.js`：零件工坊可以放關節點、顯示切開的高度。
- `src/warp.js`：傳送分解時，分段身體的各段網格不要整個藏掉（一行）。

### 之後改這些檔案要注意
- 動畫只能是畫面。`src/anim.js` 不可以寫 `m.x / m.z`、速度、`m.torsoYaw`、`m.legYaw`、`m.walk`，也不可以呼叫 `Math.random()`。
- `model.js` / `voxbody.js` 裡為了畫面多建立 Group、Mesh、BufferGeometry 時要包在 `offStream` 裡。three.js 建立物件會呼叫 `Math.random()` 產生 uuid，不包的話模擬器重播的結果會變。
- 上半身看起來的朝向 = `m.torsoYaw` + `anim.tw`（近戰扭腰，只有畫面）。槍口、判定一律用 `m.torsoYaw`，不要去讀 `torsoG.rotation.y`。
- 動畫讀的近戰欄位：`m.swing { slot, t, dur }`、`m.punch { slot, t }`、`m.charge { slot, phase, t }`。改這些欄位的名字或時間長度，`src/anim.js` 的近戰段要一起改。
- 新增腳的種類或新的近戰武器：`animMech` 用 `spec.legs.type` 和 `def.kind` 分支，沒列到的會走預設（腳不擺、手臂照一般武器）。

### 怎麼檢查
- 模擬比對（改完一定要跑）：`node --import ./tools/sim/register.mjs tools/sim/duel.mjs --a 突擊型 --b 狙擊型 --n 10 --seed 1 --quiet --out tools/sim/out/anim-check`，結果要跟沒有動畫的版本一樣（只有 `summary.json` 的 `out` 路徑不同）。
- 動作檢視器：`tools/animview/`（`viewer.html` + `viewer.js`，直接讀 `src/` 的模型和動畫，可以切機體、損傷、事件、慢動作）。
- 腳滑檢查：`node --import ./tools/sim/register.mjs tools/animview/slip-check.mjs`。

### 合併前實測（2026-11-12）
- 遊戲內：觀戰 3 場、王牌 vs 雜魚、對戰騎槍型、探索第 1 關、試玩場，共約 4800 幀。每幀檢查每台機體所有節點的矩陣，沒有壞值；主控台沒有錯誤。雙足、逆關節、履帶、懸浮都出現過；失衡、撞牆、推進、空投、揮劍、打樁、騎槍衝刺、腳 / 手臂 / 頭損毀都實際發生過。
- 效能：`animMech` 每台每幀約 1.3–3.2 微秒（Node 量 2 萬幀平均；雙足和逆關節多了腳的 IK 所以較高）。10 台機體約 0.03 毫秒，一幀預算 16.7 毫秒。模型多了關節，每台多 6 個腳的群組、2 個手肘的群組，身體分段後繪圖呼叫每台多幾次，這部分沒有單獨量。
- 模擬比對：一致。
- 沒做的：沒有用真人操作長時間玩；手機沒測；測試用的內建瀏覽器畫面更新被限制在每秒 30 次，所以沒有量到實際 FPS。
