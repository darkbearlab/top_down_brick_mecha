// 汽油投射器數值提案（alpha）：總強度不動，把一點「直擊」挪到「油灘」——讓它的特色（鋪火、封路）更明顯
//   直擊 2.4 → 2.2（單體 40.8 → 37.4/秒）、油灘 3.2 → 4.0 秒、最大半徑 1.5 → 1.7
//   測試（a-fuel 大腦，見 tools/sim/entries/a-fuel/NOTES.md）：雜魚 / 硬雜魚包 / 單挑 / 鏡像全部在雜訊內 → 這是「手感」調整，不是強弱修正
export default ({ WEAPONS }) => {
  Object.assign(WEAPONS.fuel, { dmg: 2.2, puddleT: 4.0, puddleMax: 1.7 });
};
