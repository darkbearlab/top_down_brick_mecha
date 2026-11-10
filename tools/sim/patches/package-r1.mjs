// 第三輪平衡提案（兩個代理的建議合併）
export default ({ WEAPONS, BAL }) => {
  BAL.enemyMissileK = 0.8;                      // 電腦的飛彈 / 火箭速度 ×0.8
  WEAPONS.missile.turn = 1.6; WEAPONS.vmissile.turn = 1.55;
  WEAPONS.missile.ammo = 48; WEAPONS.vmissile.ammo = 64;
  WEAPONS.rocket.dmg = 48;                      // 單發不再讓雙足失衡（維持單發判定）
  BAL.lanceIgnite = 0.15; WEAPONS.lance.energy = 35;
  BAL.clearAheadK = 1;                          // 路線檢查用全寬
};
