# b-mod-berserker 模組實驗（beta）

- 配裝：b-berserker 的配裝，**右背火箭 → 供能模組**（劍 15 → 10.5 能量、傷害 ×1.15）；重 35 / 42
- 大腦：b-berserker（src/brains/b-mod-berserker.js 直接轉出，不改大腦，只比配裝）
- 比較對象（同一顆大腦）：b-berserker（雙火箭，重 36）；比較用的配裝在 tools/sim/out/beta/mod/
- 結果（gauntlet 種子 1–4 各 10 場；1v1 vs 突擊型 sample 種子 1–3 兩邊各 10 場）：gauntlet 96.0%（48/50/47/47）vs 95.5%（48/48/47/48）；1v1 vs 突擊型 55/60 vs 58/60；2v2（+b-missileer）vs a-bait-ambush 19-1（15-5）、vs a-hammer-anvil 16-4（18-2）
- 結論：跟一具火箭打平 → 真的是二選一
