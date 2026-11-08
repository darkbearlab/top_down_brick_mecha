// ---------- 零件目錄 ----------
// 機體 = 頭 + 軀幹（含雙臂）+ 腳 + 四個掛載點（左手、右手、左背、右背）+ 各部位的裝甲種類
// 頭：只管鎖定（時間、數量、距離、鎖定角度）和敵情顯示；視野一律 360°、不限距離（被牆擋住也看得到）
// 軀幹：血量、手臂負重、背部負重、上半身轉速
// 腳：類型（雙足 / 逆關節 / 履帶 / 懸浮）、總負重上限、極速、加速、下半身轉速、衝刺強度
// 武器：屬性（動能 / 化學 / 能量），手臂或背部用
// 裝甲（複合 / 陶瓷 / 鏡面）與武器屬性互相剋制：
//   動能 → 鏡面（碎）   化學 → 複合（聚能穿透）   能量 → 陶瓷（受熱裂）
//   反過來：複合擋動能、陶瓷擋化學、鏡面擋能量
import { CHIPS, DEVICES, techWeight } from './tech.js';

export const DMG_TYPES = {
  kinetic: { name: '動能', css: '#e8d070', hex: 0xe8d070 },
  chemical: { name: '化學', css: '#ff8a40', hex: 0xff8a40 },
  energy: { name: '能量', css: '#60e0ff', hex: 0x60e0ff },
};
export const ARMORS = {
  composite: { name: '複合', hex: 0x5a6470, css: '#7a8696' },
  ceramic: { name: '陶瓷', hex: 0xe6e0d2, css: '#e6e0d2' },
  mirror: { name: '鏡面', hex: 0xa8d0f0, css: '#a8d0f0', sheen: true },
};
// 傷害倍率 EFFECT[武器屬性][裝甲]：剋 ×1.4、被擋 ×0.65
export const EFFECT = {
  kinetic: { composite: 0.65, ceramic: 1, mirror: 1.4 },
  chemical: { composite: 1.4, ceramic: 0.65, mirror: 1 },
  energy: { composite: 1, ceramic: 1.4, mirror: 0.65 },
};

// 方塊模型：[x, y, z, w, h, d, 顏色鍵]，單位 = 1/16；顏色鍵：a 裝甲、f 骨架、t 隊伍色、g 發光、w 武器屬性色
export const HEADS = {
  std: { name: '標準感測頭', hp: 60, lockArc: 40, lockTime: 0.9, lockCount: 2, lockRange: 18, intel: true, weight: 2,
    model: [[-3, 0, -2, 6, 4, 6, 'a'], [-2, 2, 4, 4, 1, 1, 'g'], [2, 4, -1, 1, 3, 1, 'f']] },
  dome: { name: '廣角鎖定頭', hp: 55, lockArc: 130, lockTime: 1.1, lockCount: 3, lockRange: 16, intel: true, weight: 3,
    model: [[-3, 0, -3, 6, 3, 6, 'a'], [-2, 3, -2, 4, 1, 4, 'a'], [-3, 1, 3, 6, 1, 1, 'g'], [-3, 1, -4, 6, 1, 1, 'g'], [3, 1, -2, 1, 1, 4, 'g'], [-4, 1, -2, 1, 1, 4, 'g']] },
  hunter: { name: '狙擊感測頭', hp: 45, lockArc: 24, lockTime: 0.6, lockCount: 1, lockRange: 26, intel: true, weight: 2,
    model: [[-2, 0, -2, 4, 3, 5, 'a'], [-1, 1, 3, 2, 2, 3, 'f'], [-1, 1, 6, 2, 2, 1, 'g']] },
  array: { name: '多重鎖定頭', hp: 60, lockArc: 50, lockTime: 0.55, lockCount: 6, lockRange: 20, intel: false, weight: 4,
    model: [[-4, 0, -2, 8, 3, 5, 'a'], [-3, 1, 3, 1, 1, 1, 'g'], [-1, 1, 3, 1, 1, 1, 'g'], [1, 1, 3, 1, 1, 1, 'g'], [3, 1, 3, 1, 1, 1, 'g'], [-4, 3, -1, 1, 4, 1, 'f'], [3, 3, -1, 1, 4, 1, 'f']] },
  // 長距鎖定頭：隔著牆也能慢慢鎖上（其他頭要射線沒被擋）→ 配垂直飛彈越過掩體遠距離打
  radar: { name: '長距鎖定頭', hp: 50, lockArc: 36, lockTime: 1.5, lockCount: 2, lockRange: 34, radarLock: true, intel: true, weight: 4,
    model: [[-3, 0, -2, 6, 3, 5, 'a'], [-1, 1, 3, 2, 1, 1, 'g'], [-1, 3, -1, 1, 4, 1, 'f'], [-4, 7, -2, 7, 1, 3, 'a'], [-3, 8, -1, 5, 1, 1, 'g']] },
};
// 軀幹：halfW = 半寬、top = 頂部高度（放頭）；手臂接在 ±(halfW + 3)，背部掛點在 ±(halfW - 2)
export const CORES = {
  std: { name: '標準軀幹', hp: 240, armLoad: 10, backLoad: 14, turn: 5.0, weight: 10, halfW: 6, top: 12,
    model: [[-5, 1, -4, 10, 5, 8, 'f'], [-6, 6, -5, 12, 6, 10, 'a'], [-4, 7, 5, 8, 4, 1, 'a'], [-2, 9, 6, 4, 1, 1, 'g'], [-5, 5, -7, 4, 6, 2, 'f'], [1, 5, -7, 4, 6, 2, 'f'], [-6, 11, -2, 12, 1, 4, 't']] },
  light: { name: '輕量軀幹', hp: 190, armLoad: 8, backLoad: 9, turn: 6.5, weight: 7, halfW: 5, top: 11,
    model: [[-4, 1, -3, 8, 5, 7, 'f'], [-5, 6, -4, 10, 5, 8, 'a'], [-2, 8, 4, 4, 1, 1, 'g'], [-3, 5, -6, 6, 5, 2, 'f'], [-5, 10, -1, 10, 1, 3, 't']] },
  heavy: { name: '重裝軀幹', hp: 320, armLoad: 13, backLoad: 20, turn: 3.6, weight: 15, halfW: 8, top: 13,
    model: [[-7, 1, -5, 14, 5, 10, 'f'], [-8, 6, -6, 16, 7, 12, 'a'], [-6, 7, 6, 12, 5, 1, 'a'], [-3, 10, 7, 6, 1, 1, 'g'], [-7, 5, -8, 5, 7, 2, 'f'], [2, 5, -8, 5, 7, 2, 'f'], [-8, 12, -3, 16, 1, 5, 't']] },
};
// 腳：hipY = 髖部高度（上半身架在這）
export const LEGS = {
  // stagger：單發傷害到這個值就失衡（履帶不會失衡）
  biped: { name: '雙足', type: 'biped', stagger: 50, hp: 170, maxLoad: 42, vmax: 6.5, acc: 11, legTurn: 8, boost: 1, hipY: 1.0, weight: 10 },
  reverse: { name: '逆關節', type: 'reverse', stagger: 30, hp: 140, maxLoad: 34, vmax: 7.4, acc: 13, legTurn: 9, boost: 1.3, hipY: 1.05, weight: 8 },
  tread: { name: '履帶', type: 'tread', stagger: Infinity, hp: 260, maxLoad: 62, vmax: 5.0, acc: 9, legTurn: 2.4, boost: 0.6, hipY: 0.75, weight: 16, grip: 1.6 },
  hover: { name: '懸浮', type: 'hover', stagger: 25, hp: 130, maxLoad: 36, vmax: 8.2, acc: 7, legTurn: 6, boost: 1.2, hipY: 0.85, weight: 9, slide: 0.35, noMud: true },
};
// 武器
//   interval 射擊間隔、ammo 總彈藥（沒有彈匣、不用換彈，打完就沒了；飛彈 / 火箭算發數；能量武器沒有彈藥、吃能量）
//     分兩種用途：持久型（機槍、機砲、直射 / 垂直飛彈：連射 40～50 秒）、決戰型（霰彈、狙擊、加農砲、火箭、分裂飛彈：8～20 秒，威力大但很快打完）
//   dmg、speed 彈速、spread 散布、pellets 一次幾發、kb 擊退、recoil 後座力、life 射程（秒）
//   energy = 每發吃多少能量（光束類）；salvo = 一次射幾發飛彈；kind：bullet / beam / missile / vmissile / split / saber
//   muzzle = 槍口在掛點本地的位置（方塊單位）
export const WEAPONS = {
  mg: { name: '機槍', type: 'kinetic', mount: 'arm', weight: 3, kind: 'bullet', interval: 0.07, ammo: 720, dmg: 4, speed: 36, spread: 0.06, kb: 0.12, recoil: 0.05, life: 0.6, size: 0.07,
    model: [[-1, -1, 0, 3, 3, 7, 'f'], [0, 0, 7, 1, 1, 7, 'f'], [-1, -2, 2, 3, 1, 3, 'w']], muzzle: [0.5, 0.5, 14] },
  autocannon: { name: '機砲', type: 'kinetic', mount: 'arm', weight: 5, kind: 'bullet', interval: 0.16, ammo: 320, dmg: 11, speed: 32, spread: 0.035, kb: 0.6, recoil: 0.2, life: 0.75, size: 0.1,
    model: [[-2, -2, 0, 4, 4, 7, 'f'], [-1, -1, 7, 2, 2, 9, 'f'], [-2, -3, 1, 4, 1, 4, 'w']], muzzle: [0, 0, 16] },
  shotgun: { name: '霰彈槍', type: 'kinetic', mount: 'arm', weight: 4, kind: 'bullet', interval: 0.75, ammo: 20, dmg: 6, pellets: 8, speed: 29, spread: 0.22, kb: 0.35, recoil: 1.2, life: 0.33, size: 0.08,
    model: [[-2, -2, 0, 4, 4, 6, 'f'], [-2, -1, 6, 4, 2, 6, 'f'], [-2, -3, 1, 4, 1, 3, 'w']], muzzle: [0, 0, 12] },
  sniper: { name: '狙擊槍', type: 'kinetic', mount: 'arm', weight: 5, kind: 'bullet', interval: 1.3, ammo: 14, dmg: 55, speed: 75, spread: 0.004, kb: 2.5, recoil: 1.5, life: 0.5, size: 0.08, trail: true,
    model: [[-1, -2, -1, 3, 4, 8, 'f'], [0, -1, 7, 1, 1, 13, 'f'], [-1, 2, 1, 3, 2, 4, 'w']], muzzle: [0.5, -0.5, 20] },
  beam: { name: '光束步槍', type: 'energy', mount: 'arm', weight: 4, kind: 'beam', interval: 0.45, dmg: 26, speed: 48, spread: 0.01, kb: 0.8, recoil: 0.3, life: 0.5, size: 0.11, energy: 12,
    model: [[-2, -2, 0, 4, 4, 8, 'f'], [-1, -1, 8, 2, 2, 6, 'w'], [-1, -1, 14, 2, 2, 1, 'g']], muzzle: [0, 0, 15] },
  saber: { name: '光束劍', type: 'energy', mount: 'arm', weight: 2, kind: 'saber', interval: 0.55, dmg: 58, kb: 4, energy: 15, reach: 2.4, arc: 2.2, lunge: 7,
    model: [[-1, -2, -1, 2, 4, 3, 'f'], [-1, -1, 2, 2, 2, 1, 'w']], blade: 22, muzzle: [0, 0, 3] },
  // 盾牌（手臂）：純被動，不能開火。從那一側前方（正面偏盾牌那邊，左右各約 78°）來的攻擊先打在盾上（guard 點耐久、裝甲照手臂的）；
  //   爆風只擋一半；盾打爆 = 那隻手臂一起壞掉。拿盾的機體上半身轉得慢（turnMul；雜魚另外再慢很多 → 繞背打得到）
  shield: { name: '盾牌', type: 'kinetic', mount: 'arm', weight: 6, kind: 'shield', guard: 340, turnMul: 0.72,
    model: [[-4, -7, 3, 9, 13, 2, 'f'], [-3, -6, 5, 7, 11, 1, 'w']], muzzle: [0, 0, 4] },
  cannon: { name: '加農砲', type: 'kinetic', mount: 'back', weight: 8, kind: 'bullet', interval: 2.4, ammo: 8, dmg: 85, speed: 40, spread: 0, kb: 7, recoil: 4, life: 0.9, size: 0.24, heavy: true, splash: 2.2,
    model: [[-2, -2, -4, 5, 5, 8, 'f'], [-1, -1, 4, 3, 3, 12, 'f'], [-2, -2, 15, 5, 5, 1, 'w']], muzzle: [0.5, 0.5, 17] },
  missile: { name: '直射飛彈', type: 'chemical', mount: 'back', weight: 6, kind: 'missile', interval: 1.2, ammo: 64, dmg: 30, salvo: 2, speed: 18, accel: 26, maxSpeed: 32, turn: 1.9, life: 1.6, size: 0.12, splash: 1.3,
    model: [[-3, -3, -4, 6, 6, 8, 'f'], [-2, -2, 4, 2, 2, 1, 'w'], [0, -2, 4, 2, 2, 1, 'w'], [-2, 0, 4, 2, 2, 1, 'w'], [0, 0, 4, 2, 2, 1, 'w']], muzzle: [0, 0, 5] },
  // 火箭莢艙：不追蹤、不用鎖定的直射火箭，一次 3 發；每發威力剛好讓雙足失衡
  rocket: { name: '火箭莢艙', type: 'chemical', mount: 'back', weight: 6, kind: 'rocket', interval: 1.0, ammo: 24, dmg: 52, salvo: 3, speed: 24, accel: 30, maxSpeed: 38, life: 1.1, size: 0.11, splash: 1.0, spread: 0.05,
    model: [[-3, -3, -4, 6, 6, 9, 'f'], [-2, -2, 5, 1, 1, 1, 'w'], [0, -2, 5, 1, 1, 1, 'w'], [2, -2, 5, 1, 1, 1, 'w'], [-2, 0, 5, 1, 1, 1, 'w'], [0, 0, 5, 1, 1, 1, 'w'], [2, 0, 5, 1, 1, 1, 'w']], muzzle: [0, -1, 6] },
  vmissile: { name: '垂直飛彈', type: 'chemical', mount: 'back', weight: 7, kind: 'vmissile', interval: 1.6, ammo: 96, dmg: 22, salvo: 4, speed: 9, accel: 30, maxSpeed: 26, turn: 1.8, life: 3.2, size: 0.12, splash: 1.5, needLock: true,
    model: [[-3, -3, -4, 6, 5, 8, 'f'], [-2, 2, -3, 2, 1, 2, 'w'], [0, 2, -3, 2, 1, 2, 'w'], [-2, 2, 0, 2, 1, 2, 'w'], [0, 2, 0, 2, 1, 2, 'w']], muzzle: [0, 3, 0] },
  // 火焰噴射器（手臂）：按著一直噴，range 格內、左右 arc 弧度的扇形全部燒到（穿透、被牆擋）；每下 dmg + 打中的部位疊 burn 層燃燒（status.js）
  flamer: { name: '火焰噴射器', type: 'chemical', mount: 'arm', weight: 4, kind: 'flame', interval: 0.1, ammo: 260, dmg: 3, range: 6, arc: 0.4, burn: 0.3, kb: 0.04, recoil: 0, size: 0.1,
    model: [[-2, -2, 0, 4, 4, 5, 'f'], [-1, -1, 5, 2, 2, 7, 'f'], [-2, -2, 12, 4, 4, 1, 'w'], [-1, 2, 0, 3, 2, 4, 'w']], muzzle: [0, 0, 13] },
  // 燒夷彈（背部）：拋到瞄準點（最遠 range 格），落地小爆炸 + 半徑 zone 的火海燒 zoneT 秒，站在裡面每秒疊 burn 層（燒腳 → 變慢）
  napalm: { name: '燒夷彈', type: 'chemical', mount: 'back', weight: 6, kind: 'napalm', interval: 2.2, ammo: 10, dmg: 24, splash: 1.6, range: 16, zone: 2.4, zoneT: 5, burn: 1.4, size: 0.2,
    model: [[-3, -3, -4, 6, 6, 8, 'f'], [-2, -2, 4, 4, 4, 2, 'f'], [-1, -1, 6, 2, 2, 1, 'w'], [-3, 3, -3, 6, 1, 5, 'w']], muzzle: [0, 0, 7] },
  split: { name: '分裂飛彈', type: 'chemical', mount: 'back', weight: 7, kind: 'split', interval: 1.8, ammo: 8, dmg: 11, salvo: 1, bomblets: 6, speed: 16, accel: 16, maxSpeed: 25, turn: 1.2, life: 1.9, size: 0.18, splash: 1.0,
    model: [[-3, -3, -4, 6, 6, 9, 'f'], [-2, -2, 5, 4, 4, 2, 'w']], muzzle: [0, 0, 7] },
};
// 低階武器（只給雜魚用，整備和隨機組裝不會出現）：外型沿用原本那把，威力、射速、彈藥都打折
const low = (base, name, o) => { WEAPONS[base + '_l'] = { ...WEAPONS[base], name, low: true, ...o }; };
low('mg', '輕機槍', { dmg: 3, interval: 0.11, spread: 0.1, speed: 30, ammo: 400 });
low('autocannon', '輕機砲', { dmg: 8, interval: 0.24, spread: 0.05, speed: 28, ammo: 160 });
low('shotgun', '短霰彈槍', { dmg: 5, pellets: 5, interval: 1.1, spread: 0.26, ammo: 16 });
low('sniper', '步槍', { dmg: 30, interval: 2.2, speed: 58, ammo: 10, trail: false });
low('saber', '電擊棒', { dmg: 32, interval: 0.85, reach: 1.9, lunge: 4, blade: 15 });
low('cannon', '迫擊砲', { dmg: 48, interval: 3.4, speed: 30, splash: 1.6, kb: 4, ammo: 10 });
low('missile', '小型飛彈', { dmg: 22, salvo: 1, interval: 1.9, turn: 1.4, maxSpeed: 26, ammo: 20 });
low('rocket', '火箭筒', { dmg: 38, salvo: 1, interval: 2.0, ammo: 10, spread: 0.07 });
low('flamer', '小火焰噴射器', { dmg: 2, range: 4.6, burn: 0.22, ammo: 200 });
low('napalm', '燒夷砲', { dmg: 16, zone: 2, zoneT: 4, burn: 1.1, interval: 3.4, range: 13, ammo: 6 });
export const HP_MUL = 1.35;

// ---------- 雜魚機 ----------
// 一到兩把武器、整台只有一條血（打哪裡都算軀幹）、不能推進、體型小一號、壞了直接炸散（沒有特寫和殘骸）
// hp = 整台的耐久（不乘 HP_MUL）；armor 每台出場時隨機
export const GRUNTS = {
  rifle: { name: '步兵', head: 'std', core: 'light', legs: 'biped', armL: null, armR: 'mg', backL: null, backR: null, hp: 110 },
  rocket: { name: '飛彈兵', head: 'std', core: 'light', legs: 'reverse', armL: null, armR: 'mg', backL: 'missile', backR: null, hp: 110 },
  heavy: { name: '重步兵', head: 'dome', core: 'std', legs: 'tread', armL: 'shotgun', armR: 'autocannon', backL: null, backR: null, hp: 170 },
  gun: { name: '砲車', head: 'dome', core: 'std', legs: 'tread', armL: null, armR: null, backL: null, backR: 'cannon', hp: 150 },
  sniper: { name: '狙擊兵', head: 'hunter', core: 'light', legs: 'reverse', armL: null, armR: 'sniper', backL: null, backR: null, hp: 80 },
  blade: { name: '劍兵', head: 'std', core: 'light', legs: 'hover', armL: null, armR: 'saber', backL: null, backR: null, hp: 90 },
};
// 低階雜魚（無盡模式前期的主力）：武器都是低階版，血也少一點
export const GRUNTS_LOW = {
  scout: { name: '巡邏兵', head: 'std', core: 'light', legs: 'biped', armL: null, armR: 'mg_l', backL: null, backR: null, hp: 70 },
  trooper: { name: '機砲兵', head: 'std', core: 'light', legs: 'biped', armL: null, armR: 'autocannon_l', backL: null, backR: null, hp: 80 },
  launcher: { name: '小飛彈兵', head: 'std', core: 'light', legs: 'reverse', armL: null, armR: 'mg_l', backL: 'missile_l', backR: null, hp: 75 },
  brawler: { name: '突擊兵', head: 'std', core: 'light', legs: 'reverse', armL: null, armR: 'shotgun_l', backL: null, backR: null, hp: 80 },
  stick: { name: '電擊兵', head: 'std', core: 'light', legs: 'hover', armL: null, armR: 'saber_l', backL: null, backR: null, hp: 65 },
  marksman: { name: '射手', head: 'hunter', core: 'light', legs: 'reverse', armL: null, armR: 'sniper_l', backL: null, backR: null, hp: 60 },
  mortar: { name: '迫擊砲車', head: 'dome', core: 'std', legs: 'tread', armL: null, armR: null, backL: null, backR: 'cannon_l', hp: 110 },
  bazooka: { name: '火箭兵', head: 'std', core: 'light', legs: 'biped', armL: null, armR: 'mg_l', backL: null, backR: 'rocket_l', hp: 85 },
  // 砲塔：固定不動（只轉上半身），耐久高；只出現在陣地型小隊
  turret: { name: '砲塔', head: 'dome', core: 'std', legs: 'tread', armL: null, armR: 'autocannon_l', backL: null, backR: null, hp: 150, fixed: true },
  // 特殊行為（ai.js）：
  //   bomber 自爆機：輕、快，一路衝過來，4 格內閃紅光嗶嗶叫、0.7 秒後自爆（敵我都炸）；被打爆也會炸
  //   charger 衝鋒機：停下來、地上亮出紅色的衝刺線（0.85 秒），然後沿直線高速衝 ~16 格；撞到玩家重傷 + 擊退 + 失衡；撞牆暈 1.6 秒；衝進空洞直接摔死
  //   fly 旋停機：四旋翼無人機（機體模型換掉，武器掛在下面），浮在空中，飛得過空洞（喜歡停在空洞上：地面機體撞不到它）；用飛行流場
  //   swarm 蟲群：一台，但畫成一群在地上爬的小機械蟲；單發攻擊一次最多打掉一隻的血（per），爆風傷害 ×1.8 → 怕範圍武器；貼近持續啃咬；飛彈鎖不到
  //   shield 盾兵：左手盾牌（見 WEAPONS.shield），上半身轉得非常慢 → 要繞背
  bomber: { name: '自爆機', head: 'std', core: 'light', legs: 'reverse', armL: null, armR: null, backL: null, backR: null, hp: 28, bomber: true, speedMul: 1.35 },
  charger: { name: '衝鋒機', head: 'dome', core: 'std', legs: 'biped', armL: null, armR: null, backL: null, backR: null, hp: 170, charger: true },
  gunship: { name: '旋停機', head: 'hunter', core: 'light', legs: 'hover', armL: null, armR: 'mg_l', backL: 'missile_l', backR: null, hp: 60, fly: true, quad: true },
  swarm: { name: '蟲群', head: 'std', core: 'light', legs: 'reverse', armL: null, armR: null, backL: null, backR: null, hp: 60, swarm: 16, speedMul: 1.05, entries: ['stand'] },
  // 噴火兵：貼近用火焰噴射器燒；燒夷兵：遠遠丟燒夷彈封路（縱火隊）
  pyro: { name: '噴火兵', head: 'std', core: 'light', legs: 'biped', armL: null, armR: 'flamer_l', backL: null, backR: null, hp: 90 },
  igniter: { name: '燒夷兵', head: 'dome', core: 'std', legs: 'reverse', armL: null, armR: 'mg_l', backL: 'napalm_l', backR: null, hp: 85 },
  shielder: { name: '盾兵', head: 'dome', core: 'std', legs: 'biped', armL: 'shield', armR: 'autocannon_l', backL: null, backR: null, hp: 120 },
};
// ---------- 登場方式 ----------
// stand = 一開始就站在地上（遠征小隊散開站著）；drop = 從天上空投（空投小隊、增援、追到別層、無盡 / 觀戰模式）
// 雜魚定義裡 entries 列出牠能用哪幾種，沒寫 = ['stand', 'drop']（蟲群只能 stand → 不會出現在空投小隊和增援裡）
// 之後加新的登場方式（例如鑽地而出 burrow）：在 ENTRIES 加一筆、在雜魚的 entries 加上去，
//   增援 / 空投小隊用 pickEntry(key, 允許的方式) 挑；挑不到（null）的就不會進那個池子 → 自然分池
export const ENTRIES = { stand: { name: '站著' }, drop: { name: '空投' } };
export const REINFORCE_ENTRIES = ['drop'];   // 增援能用的登場方式（之後加 burrow 就放這裡）
const DEFAULT_ENTRIES = ['stand', 'drop'];
const gruntDef = k => typeof k === 'string' ? (k.endsWith('*') ? GRUNTS[k.slice(0, -1)] : GRUNTS_LOW[k]) : k;
export const entriesOf = k => gruntDef(k)?.entries ?? DEFAULT_ENTRIES;
export const canEnter = (k, how) => entriesOf(k).includes(how);
// 從 allowed 裡挑一個這台能用的登場方式（照 allowed 的順序；之後有好幾種可以改成隨機）；都不行 = null
export const pickEntry = (k, allowed) => allowed.find(h => canEnter(k, h)) ?? null;
// 出場比例：步兵最多，砲車 / 狙擊兵少
const GRUNT_WEIGHT = { rifle: 5, rocket: 3, heavy: 2, gun: 1.2, sniper: 1.2, blade: 2,
  turret: 0, scout: 5, trooper: 3, launcher: 2.5, brawler: 2, stick: 1.8, marksman: 1.2, mortar: 1, bazooka: 1.5,
  bomber: 0, charger: 0, gunship: 0, swarm: 0, shielder: 0, pyro: 0, igniter: 0 };   // 新的特殊雜魚只在遠征的小隊裡出現
export function randomGrunt(pool = GRUNTS) {
  const keys = Object.keys(pool);
  let r = Math.random() * keys.reduce((a, k) => a + GRUNT_WEIGHT[k], 0);
  const k = keys.find(k => (r -= GRUNT_WEIGHT[k]) < 0) ?? keys[0];
  const a = Object.keys(ARMORS)[Math.floor(Math.random() * 3)];
  return { ...pool[k], id: k, armor: { head: a, torso: a, arms: a, legs: a } };
}
// 指定種類的雜魚（key 後面加 * = 精英，從 GRUNTS 拿；不然從 GRUNTS_LOW）；裝甲隨機
export function gruntOf(key) {
  const elite = key.endsWith('*'), k = elite ? key.slice(0, -1) : key, pool = elite ? GRUNTS : GRUNTS_LOW;
  const a = Object.keys(ARMORS)[Math.floor(Math.random() * 3)];
  return { ...pool[k], id: k, elite, armor: { head: a, torso: a, arms: a, legs: a } };
}
// ---------- 遭遇小隊（遠征模式） ----------
// 每隊最多 3 台（main.js 只取前 3 台），組合針對不同的裝備：
//   巡邏隊：基本款；突擊隊 / 火箭伏擊：貼臉衝過來（考驗後退射擊、失衡、霰彈）；
//   砲擊陣地 / 狙擊組：遠距離壓制（考驗掩體和機動、長射程武器）；飛彈小隊：鎖定（考驗打頭、繞掩體）；
//   重裝隊 / 砲車隊：帶一台精英（考驗高單發傷害、屬性剋制）
// 行動方式（不寫 = 一般：待命不動，醒來後追著打）：
//   hold：守備型，醒來也不追，只在據點 hold 格內移動；據點周圍有一圈矮掩體（打得壞），配砲塔 → 要攻堅（繞側、爆破掩體、迫擊砲 / 垂直飛彈）
//   patrol：巡邏型，待命時沿著一條路線走來走去 → 會自己撞上來，或要等它走開再過
// themes：在哪種地形比較常出現（街區轉角多 → 近戰；荒野視線長 → 遠程）；minDepth：離出發區至少幾個隘口才會出現
export const SQUADS = {
  patrol: { name: '巡邏隊', units: ['scout', 'scout', 'trooper'], themes: { city: 2, open: 2, ruins: 2, plaza: 2, chasm: 1 }, patrol: true },
  hunters: { name: '遊獵隊', units: ['brawler', 'stick', 'scout'], themes: { ruins: 2, open: 1, city: 1 }, patrol: true },
  outpost: { name: '前哨陣地', units: ['turret', 'turret', 'trooper', 'marksman'], themes: { open: 2, plaza: 2, ruins: 1 }, hold: 5, minDepth: 1 },
  bunker: { name: '守備據點', units: ['turret', 'mortar', 'trooper', 'trooper'], themes: { city: 2, plaza: 2 }, hold: 6, minDepth: 2 },
  rush: { name: '突擊隊', units: ['brawler', 'brawler', 'stick', 'stick'], themes: { city: 3, ruins: 2, plaza: 1 } },
  ambush: { name: '火箭伏擊', units: ['bazooka', 'bazooka', 'brawler'], themes: { city: 2, ruins: 2 } },
  mortar: { name: '砲擊陣地', units: ['mortar', 'mortar', 'scout'], themes: { open: 3, plaza: 2, ruins: 1 } },
  snipers: { name: '狙擊組', units: ['marksman', 'marksman', 'trooper'], themes: { open: 3, plaza: 1, ruins: 1, chasm: 2 } },
  missile: { name: '飛彈小隊', units: ['launcher', 'launcher', 'marksman'], themes: { open: 2, plaza: 2, city: 1 } },
  heavy: { name: '重裝隊', units: ['heavy*', 'scout', 'scout'], themes: { city: 2, open: 1, plaza: 1 }, minDepth: 1 },
  gunline: { name: '砲車隊', units: ['gun*', 'trooper', 'trooper'], themes: { open: 2, plaza: 2 }, minDepth: 1 },
  kamikaze: { name: '自爆小隊', units: ['bomber', 'scout', 'trooper'], themes: { city: 1, ruins: 1, chasm: 1 }, minDepth: 1 },
  breakers: { name: '衝鋒隊', units: ['charger', 'trooper', 'trooper'], themes: { open: 2, plaza: 2, chasm: 3, ruins: 1 }, minDepth: 1 },
  gunships: { name: '旋停機隊', units: ['gunship', 'gunship', 'marksman'], themes: { chasm: 4, open: 1, plaza: 1 }, minDepth: 1 },
  arson: { name: '縱火隊', units: ['pyro', 'pyro', 'igniter'], themes: { ruins: 2, city: 2, plaza: 1 }, minDepth: 1 },
  swarm: { name: '蟲群', units: ['swarm', 'swarm', 'scout'], themes: { ruins: 2, city: 1, chasm: 2 }, minDepth: 2 },
  elite: { name: '精英小隊', units: ['rocket*', 'blade*', 'rifle*'], themes: { city: 1, open: 1, ruins: 1, plaza: 1 }, minDepth: 3 },
};
export function pickSquad(theme, depth, rand = Math.random) {
  const ok = Object.entries(SQUADS).filter(([, S]) => (S.minDepth ?? 0) <= depth && S.themes[theme]);
  let r = rand() * ok.reduce((a, [, S]) => a + S.themes[theme], 0);
  return (ok.find(([, S]) => (r -= S.themes[theme]) < 0) ?? ok[0])[0];
}
// 連射多久會打光（秒）：總彈藥 ÷ 一次幾發 × 射擊間隔；能量武器 Infinity
export const fireTime = W => W.ammo ? W.ammo / (W.salvo ?? 1) * W.interval : Infinity;
export const SLOTS = ['armL', 'armR', 'backL', 'backR'];
export const SLOT_NAMES = { armL: '左手', armR: '右手', backL: '左背', backR: '右背' };
export const SLOT_KEYS = { armL: '左鍵', armR: '右鍵', backL: 'Q 切換', backR: 'E 切換' };
export const ARMOR_PARTS = { head: '頭部', torso: '軀幹', arms: '手臂', legs: '腳部' };

export const DEFAULT_LOADOUT = {
  head: 'std', core: 'std', legs: 'biped',
  armL: 'mg', armR: 'beam', backL: 'missile', backR: 'cannon',
  armor: { head: 'composite', torso: 'composite', arms: 'composite', legs: 'composite' },
};

// 敵機的配裝（試玩場隨機挑）
export const ENEMY_PRESETS = [
  { name: '突擊型', head: 'std', core: 'std', legs: 'biped', armL: 'autocannon', armR: 'shotgun', backL: 'missile', backR: 'rocket',
    armor: { head: 'composite', torso: 'composite', arms: 'composite', legs: 'composite' } },
  { name: '狙擊型', head: 'hunter', core: 'light', legs: 'reverse', armL: null, armR: 'sniper', backL: 'vmissile', backR: null,
    armor: { head: 'mirror', torso: 'mirror', arms: 'mirror', legs: 'mirror' } },
  { name: '光束型', head: 'std', core: 'std', legs: 'hover', armL: 'beam', armR: 'saber', backL: 'missile', backR: 'split',
    armor: { head: 'ceramic', torso: 'ceramic', arms: 'ceramic', legs: 'ceramic' } },
  { name: '支援型', head: 'radar', core: 'std', legs: 'biped', armL: 'mg', armR: 'autocannon', backL: 'vmissile', backR: 'missile',
    armor: { head: 'composite', torso: 'composite', arms: 'ceramic', legs: 'composite' } },
  { name: '重砲型', head: 'dome', core: 'heavy', legs: 'tread', armL: 'mg', armR: 'mg', backL: 'cannon', backR: 'split',
    armor: { head: 'ceramic', torso: 'composite', arms: 'composite', legs: 'ceramic' } },
];

// 隨機組一台（觀戰用）：至少兩把武器，總重盡量不超過腳的負重
const pickOf = obj => { const k = Object.keys(obj); return k[Math.floor(Math.random() * k.length)]; };
// 隨機組裝：先抽 12 套合法的（至少兩把武器、不超重），照「相性」打分、加一點隨機，挑最高的
//   飛彈類：頭要能多鎖、鎖得遠；垂直飛彈 + 長距鎖定頭最搭（越過掩體遠距離打）
//   沒有飛彈卻帶多重鎖定頭 / 長距鎖定頭：浪費
//   狙擊：配狙擊頭 / 長距鎖定頭；近戰（劍、霰彈）：不要窄角度的狙擊頭、不要履帶，快的腳加分；狙擊和近戰混搭扣分
export function synergy(lo) {
  const ws = SLOTS.map(s => lo[s]).filter(Boolean), H = HEADS[lo.head];
  const has = k => ws.some(w => WEAPONS[w].kind === k || w === k);
  const lockers = ws.filter(w => ['missile', 'split', 'vmissile'].includes(WEAPONS[w].kind)).length;
  const melee = has('saber') || has('shotgun'), sniper = has('sniper');
  // 只獎勵「搭」、懲罰「不搭」，帶不帶飛彈本身不加分（不然全部都會變飛彈機）
  let sc = 0;
  if (lockers) {
    if (has('vmissile') && H.radarLock) sc += 0.8;
    if (lo.head === 'array' && (lockers >= 2 || has('split'))) sc += 0.6;
    if (lo.head === 'hunter' && lockers >= 2) sc -= 0.4;
  } else if (lo.head === 'array' || lo.head === 'radar') sc -= 1.5;
  if (sniper) sc += lo.head === 'hunter' ? 1 : lo.head === 'radar' ? 0.5 : 0;
  if (melee) {
    if (lo.head === 'hunter') sc -= 1.5;
    sc += lo.legs === 'tread' ? -1 : lo.legs === 'reverse' || lo.legs === 'hover' ? 0.3 : 0;
  }
  if (sniper && melee) sc -= 0.7;
  return sc;
}
export function randomLoadout() {
  const armW = Object.keys(WEAPONS).filter(k => WEAPONS[k].mount === 'arm' && !WEAPONS[k].low), backW = Object.keys(WEAPONS).filter(k => WEAPONS[k].mount === 'back' && !WEAPONS[k].low);
  const r = a => a[Math.floor(Math.random() * a.length)];
  let best = null, bestSc = -Infinity;
  for (let tries = 0, found = 0; tries < 200 && found < 12; tries++) {
    const lo = {
      head: pickOf(HEADS), core: pickOf(CORES), legs: pickOf(LEGS),
      armL: Math.random() < 0.9 ? r(armW) : null, armR: Math.random() < 0.9 ? r(armW) : null,
      backL: Math.random() < 0.6 ? r(backW) : null, backR: Math.random() < 0.5 ? r(backW) : null,
      armor: { head: pickOf(ARMORS), torso: pickOf(ARMORS), arms: pickOf(ARMORS), legs: pickOf(ARMORS) },
    };
    const n = SLOTS.filter(s => lo[s]).length;
    if (n < 2 || computeSpec(lo).loadK > 1.05) continue;
    found++;
    const sc = synergy(lo) + Math.random() * 1.2;
    if (sc > bestSc) { bestSc = sc; best = lo; }
  }
  if (!best) return structuredClone(ENEMY_PRESETS[0]);
  const main = WEAPONS[best.armR ?? best.armL ?? best.backL ?? best.backR].name;
  best.name = `${LEGS[best.legs].name}・${main}`;
  return best;
}

// ---------- 由零件算出整台機體的數值 ----------
// 超重不禁止，只是變慢：總重超過腳的負重 → 極速、加速下降；手臂超重 → 上半身轉速、命中下降；背部超重 → 能量回復變慢
export function computeSpec(lo) {
  const head = HEADS[lo.head], core = CORES[lo.core], legs = LEGS[lo.legs];
  const w = id => id ? WEAPONS[id].weight : 0;
  const armW = w(lo.armL) + w(lo.armR), backW = w(lo.backL) + w(lo.backR);
  const total = head.weight + core.weight + armW + backW + techWeight(lo);
  const loadK = total / legs.maxLoad;
  const moveK = loadK > 1 ? Math.max(0.5, 1 - (loadK - 1) * 1.6) : 1;
  const armOver = armW > core.armLoad, backOver = backW > core.backLoad;
  return {
    head, core, legs, armW, backW, total, loadK, moveK, armOver, backOver,
    vmax: legs.vmax * moveK, acc: legs.acc * moveK, legTurn: legs.legTurn * (loadK > 1 ? 0.8 : 1),
    turn: core.turn * (armOver ? 0.7 : 1) * [lo.armL, lo.armR].reduce((k, id) => k * (id ? WEAPONS[id].turnMul ?? 1 : 1), 1), spreadMul: armOver ? 1.6 : 1,
    regen: backOver ? 0.6 : 1, boost: legs.boost * (loadK > 1 ? 0.8 : 1),
    // 整體耐久 ×HP_MUL（節奏放慢、多打幾輪）；背部武器的掛架也有自己的耐久
    hp: { head: head.hp * HP_MUL, torso: core.hp * HP_MUL, armL: Math.round(core.hp * 0.38 * HP_MUL), armR: Math.round(core.hp * 0.38 * HP_MUL), backL: 70 * HP_MUL, backR: 70 * HP_MUL, legs: legs.hp * HP_MUL },
  };
}

// 存取玩家配裝
const KEY = 'brickmecha.loadout';
export function loadLoadout() {
  try {
    const lo = JSON.parse(localStorage.getItem(KEY));
    if (lo && HEADS[lo.head] && CORES[lo.core] && LEGS[lo.legs] && lo.armor) {
      for (const s of SLOTS) if (lo[s] && (!WEAPONS[lo[s]] || WEAPONS[lo[s]].low)) lo[s] = null;
      lo.chips = [0, 1].map(i => CHIPS[lo.chips?.[i]] ? lo.chips[i] : null);
      if (!DEVICES[lo.device]) lo.device = null;
      return lo;
    }
  } catch { /* 用預設 */ }
  return structuredClone(DEFAULT_LOADOUT);
}
export function saveLoadout(lo) { try { localStorage.setItem(KEY, JSON.stringify(lo)); } catch { /* 存不了就算了 */ } }
