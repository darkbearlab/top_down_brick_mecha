// ---------- 編輯過的零件外型（正式版） ----------
// 零件工坊（src/workshop.js）匯出的 JSON 合併進來；model.js 的 getShape 先查這裡，沒有才用零件原本的方塊（parts.js / model.js）
// key：head:<id>、core:<id>、arm、weapon:<id>、legs:<腳型>（骨盆 / 履帶 / 懸浮那塊，不擺動）、leg:<腳型>（一隻腳，原點 = 髖關節）、elite:<名字>:<部位>
// 值：{ boxes: [[x, y, z, w, h, d, 顏色 key], …]（細格單位 1/32）, points: { 名字: [x, y, z]（設計單位 1/16） } }
//   顏色 key：a 裝甲、f 骨架、t 隊伍色、g 隊伍發光、w 武器屬性色
//   points：core → head（頭的位置）、armL、backL（右邊自動鏡像）；arm → hand；weapon → muzzle；legs → legL（左腳髖關節）
export const SHAPES = {};
