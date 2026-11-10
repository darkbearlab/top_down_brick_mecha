// beta 的汽油投射器提案：直傷 2.4 → 2.0（單體火力讓一點出來），油灘燒得更兇、可以長更大（1.1 → 1.4 層/秒、最大半徑 1.5 → 1.8）
//   → 把強度從「黏著一台噴」挪到「地上的火」，跟火焰噴射器（近距離扇形穿透）、機砲（單體直傷）分得更開
export default ({ WEAPONS }) => { Object.assign(WEAPONS.fuel, { dmg: 2.0, puddleBurn: 1.4, puddleMax: 1.8 }); };
