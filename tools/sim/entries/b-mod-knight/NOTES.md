# b-mod-knight 模組實驗（beta）

- 配裝：標準頭 / 重裝 / 雙足 / 左盾 / 右騎槍 / 左背直射飛彈 / **右背供能模組**（原版右背空著：騎槍在右手，右背永遠不會架）；全陶瓷，重 40 / 42
- 大腦：b-knight（單打 = knight）（src/brains/b-mod-knight.js 直接轉出，不改大腦，只比配裝）
- 比較對象（同一顆大腦）：原版 knight（右背空，重 35）；比較用的配裝在 tools/sim/out/beta/mod/
- 結果（gauntlet 種子 1–4 各 10 場；1v1 vs 突擊型 sample 種子 1–3 兩邊各 10 場）：gauntlet 94.5%（47/45/49/48）vs 93.0%（49/44/47/46）；1v1 vs 突擊型 37/60 vs 31/60；2v2（+b-missileer，種子 71）vs a-bait-ambush 15-5（原版 14-6）、vs a-hammer-anvil 14-6（16-4）
- 結論：空著的背部格 → 模組是白賺（騎槍 35 → 24.5 能量，衝得比較勤）；小幅加分，不會太強
