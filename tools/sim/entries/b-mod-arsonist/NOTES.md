# b-mod-arsonist 模組實驗（beta）

- 配裝：arsonist 的配裝，**左背直射飛彈 → 彈藥架**（噴火器 260 → 390、燒夷彈 10 → 15）；重 35 / 42
- 大腦：arsonist（沒包團隊層）（src/brains/b-mod-arsonist.js 直接轉出，不改大腦，只比配裝）
- 比較對象（同一顆大腦）：原版 arsonist（左背直射飛彈，重 37）；比較用的配裝在 tools/sim/out/beta/mod/
- 結果（gauntlet 種子 1–4 各 10 場；1v1 vs 突擊型 sample 種子 1–3 兩邊各 10 場）：gauntlet 83.5%（42/41/43/41）vs 85.0%（42/41/43/44）；1v1 vs 突擊型 60/60 vs 45/60
- 結論：雜魚關卡差不多，1v1 長時間對戰明顯變強（噴火器 / 燒夷彈不會打光）→ 真的是二選一
