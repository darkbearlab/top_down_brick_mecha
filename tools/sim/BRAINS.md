# 寫 AI 大腦

大腦 = 一個 JS 模組，放在 `src/brains/<名字>.js`（或任何路徑），控制一台機體。範例：`src/brains/sample.js`。

```js
export default {
  name: 'my-brain',
  init(mem, me) { /* 可選：開場時呼叫一次；mem = 這台自己的記憶物件 */ },
  think(obs, mem, api) {           // 每幀（1/60 秒）呼叫一次
    return { move, aimYaw, fire, back, boost, note };
  },
};
```

跑對戰：
```
node --import ./tools/sim/register.mjs tools/sim/duel.mjs --a 突擊型 --b 狙擊型 --brainA my-brain --brainB sample --n 40 --seed 1
node tools/sim/report.mjs <輸出資料夾> [場次]
```
- 沒給 `--brainA/--brainB` = 遊戲內建的 AI（`default`）
- 場地是對戰模式的 64×48 對稱場地，A 從左邊 (-26, 0)、B 從右邊 (26, 0) 出發；兩邊有一點點不對稱（內建 vs 內建同機體 B 大約 6 成勝），比較強弱時兩邊都要跑（交換 `--a/--b` 和 `--brainA/--brainB`）
- `think` 丟出例外：那一幀什麼都不做，console 印前三次

## 座標與角度
- 世界座標 x（右）、z（下 / 南）；1 單位 = 1 格 ≈ 1 公尺
- 角度 yaw：`0` = 朝 +z、`π/2` = 朝 +x；方向向量 = `(sin yaw, cos yaw)`；`Math.atan2(dx, dz)` 得到 yaw
- 上半身（瞄準）和腳（移動）各自轉，上半身轉速有上限（`me.turn` 弧度 / 秒；光束照射中更慢、失衡中很慢）

## obs（看得到的東西）
| 欄位 | 說明 |
|---|---|
| `t`, `dt` | 時間、這一幀幾秒 |
| `me`, `foe` | 雙方機體（見下） |
| `dist`, `dir` | 距離、往敵人的單位向量 `{x, z}` |
| `los` | 中心點之間看不看得到（有沒有牆 / 建築擋） |
| `lineClear[slot]` | 自己那個掛點現在開火，彈道會不會馬上撞牆 |
| `lock` | `{ locked, progress 0..1, range, wants }`：鎖定（飛彈用；有需要鎖定的武器在準備、看得到、在 range 內就會自己慢慢鎖上） |
| `incoming[]` | 15 格內敵人的子彈 / 飛彈 / 拋射物：`kind, w 武器 id, x, z, y, ux, uz 方向, speed, dmg, heavy, splash, tti 幾秒後最接近（null = 在遠離）, miss 最接近時離自己多遠, target 是不是追蹤自己, point 落點（拋射物）`，照 tti 排序 |
| `zones[]` | 附近的火海 / 酸池：`x, z, r, t 剩幾秒, status, mine` |

機體（`me` / `foe`）：
- `x, z, vx, vz, r`（碰撞半徑）, `yaw`（上半身）, `legYaw`, `alive`, `energy`（0–100，推進一次 30、光束 / 騎槍另外吃）
- `staggered, staggerT`（失衡中：不能動、不能開火）, `boosting, boostCd`, `charge`（騎槍：`ignite` / `dash` / null）, `swinging, punching, beaming`
- `legs`（biped / reverse / tread / hover）, `vmax`, `turn`, `canBoost`, `staggerAt`（單發多少威力會失衡）
- `hp[part] = { hp, max, broken, armor }`（部位：head, torso, armL, armR, backL, backR, legs；軀幹歸零 = 擊毀）, `hpFrac`
- `weapons[slot]`（armL, armR, backL, backR）：`id, kind, type（kinetic / chemical / energy）, dmg, pellets, salvo, interval, ammo（Infinity = 能量武器）, energy, range, speed, broken, active（這一邊現在準備的是它）, live（現在能開火）, cd（自己的才有）, needLock, splash`
- `ready = { L, R }`（true = 那一邊架著背部武器）, `deploying`（切換中）, `shield`

## act（這一幀要做的事）
| 欄位 | 說明 |
|---|---|
| `move: { x, z }` | 想移動的世界方向（長度 0–1，超過會正規化）；腳有慣性、抓地力，不是瞬間 |
| `aimYaw` 或 `aimAt: { x, z }` | 上半身要轉到的角度 / 要瞄的點（拋射物會落在 aimAt） |
| `fire: { L, R }` | 按著左 / 右鍵：打那一邊現在準備的武器（冷卻、彈藥、能量不夠就不會發） |
| `back: { L, R }` | true = 那一邊架起背部武器、false = 換回手臂（切換要 0.3 秒，期間不能開火） |
| `boost: { x, z }` 或 `true` | 推進（true = 照 move 的方向）；要 30 能量、有冷卻 |
| `note: '文字'` | 意圖，會記進戰鬥紀錄（`intent` 事件），報告裡看得到；同樣的字連續只記一次 |

## api（工具，都綁好這台機體）
- `angleDiff(a, b)`：b − a 的角度差（−π..π）
- `rayBlock(x, z, dx, dz, max)`：從某點往某方向多遠撞牆
- `clearAhead(ux, uz, len)`：自己整台往那個方向過得去多遠（空洞也算擋）
- `boostLen(ux, uz)`：往那個方向推進大概滑多遠
- `steer(mx, mz)`：內建避牆（前面有牆就轉開），回傳 `{ mx, mz }`
- `lineClear(slot)`、`leadYaw(slot)`（照彈速預判的瞄準角度）、`facing()`、`note(text)`

## 規則重點（摘要，數字見 src/parts.js）
- 部位破壞：子彈依來的方向抽部位（正面多打軀幹，軀幹正面 ×0.6、背面 ×1.35）；手臂 / 背部壞掉那把武器就沒了；腳壞掉變慢
- 剋制：動能打複合 ×0.65、陶瓷 ×1、鏡面 ×1.4；化學打複合 ×1.4、陶瓷 ×0.65；能量打陶瓷 ×1.4、鏡面 ×0.65
- 失衡：單發威力超過腳的門檻（雙足 50、逆關節 30、懸浮 25、履帶不會）→ 0.35–0.6 秒不能動不能打
- 電腦的子彈比玩家慢（×0.55，狙擊 ×0.5）：看得到、橫移躲得掉
- 騎槍撞牆：傷害全吃在拿騎槍的手上
