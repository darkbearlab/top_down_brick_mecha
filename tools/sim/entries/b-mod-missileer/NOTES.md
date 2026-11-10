# b-mod-missileer 模組實驗（beta）

- 配裝：missileer 的配裝，**右背直射飛彈 → 彈藥架**（垂直飛彈 64 → 96、手臂彈藥 ×1.5）；重 38 / 42
- 大腦：b-missileer（src/brains/b-mod-missileer.js 直接轉出，不改大腦，只比配裝）
- 比較對象（同一顆大腦）：b-missileer（垂直 + 直射飛彈，重 40）；比較用的配裝在 tools/sim/out/beta/mod/
- 結果（gauntlet 種子 1–4 各 10 場；1v1 vs 突擊型 sample 種子 1–3 兩邊各 10 場）：gauntlet 87.5%（42/43/46/44）vs 90.0%（44/47/45/44）；1v1 vs 突擊型 27/60 vs 53/60
- 結論：少一具發射器 = 齊射少一半，彈藥多也補不回來 → 對飛彈機太弱（彈藥架要配發射器還有空位的配裝）
