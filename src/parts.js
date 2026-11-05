// ---------- 零件目錄 ----------
// 機體 = 頭 + 軀幹（含雙臂）+ 腳 + 四個掛載點（左手、右手、左背、右背）+ 各部位的裝甲種類
// 頭：視野（角度、距離）、雷達、鎖定（時間、數量、距離）、敵情顯示
// 軀幹：血量、手臂負重、背部負重、上半身轉速
// 腳：類型（雙足 / 逆關節 / 履帶 / 懸浮）、總負重上限、極速、加速、下半身轉速、衝刺強度
// 武器：屬性（動能 / 化學 / 能量），手臂或背部用
// 裝甲（複合 / 陶瓷 / 鏡面）與武器屬性互相剋制：
//   動能 → 鏡面（碎）   化學 → 複合（聚能穿透）   能量 → 陶瓷（受熱裂）
//   反過來：複合擋動能、陶瓷擋化學、鏡面擋能量

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
  std: { name: '標準感測頭', hp: 60, vision: 150, range: 16, radar: 22, lockTime: 0.9, lockCount: 2, lockRange: 18, intel: true, weight: 2,
    model: [[-3, 0, -2, 6, 4, 6, 'a'], [-2, 2, 4, 4, 1, 1, 'g'], [2, 4, -1, 1, 3, 1, 'f']] },
  dome: { name: '全周雷達頭', hp: 55, vision: 360, range: 13, radar: 26, lockTime: 1.1, lockCount: 2, lockRange: 16, intel: true, weight: 3,
    model: [[-3, 0, -3, 6, 3, 6, 'a'], [-2, 3, -2, 4, 1, 4, 'a'], [-3, 1, 3, 6, 1, 1, 'g'], [-3, 1, -4, 6, 1, 1, 'g'], [3, 1, -2, 1, 1, 4, 'g'], [-4, 1, -2, 1, 1, 4, 'g']] },
  hunter: { name: '狙擊感測頭', hp: 45, vision: 80, range: 24, radar: 16, lockTime: 0.6, lockCount: 1, lockRange: 26, intel: true, weight: 2,
    model: [[-2, 0, -2, 4, 3, 5, 'a'], [-1, 1, 3, 2, 2, 3, 'f'], [-1, 1, 6, 2, 2, 1, 'g']] },
  array: { name: '多重鎖定頭', hp: 60, vision: 120, range: 15, radar: 20, lockTime: 0.55, lockCount: 6, lockRange: 20, intel: false, weight: 4,
    model: [[-4, 0, -2, 8, 3, 5, 'a'], [-3, 1, 3, 1, 1, 1, 'g'], [-1, 1, 3, 1, 1, 1, 'g'], [1, 1, 3, 1, 1, 1, 'g'], [3, 1, 3, 1, 1, 1, 'g'], [-4, 3, -1, 1, 4, 1, 'f'], [3, 3, -1, 1, 4, 1, 'f']] },
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
  biped: { name: '雙足', type: 'biped', hp: 170, maxLoad: 42, vmax: 6.5, acc: 11, legTurn: 8, boost: 1, hipY: 1.0, weight: 10 },
  reverse: { name: '逆關節', type: 'reverse', hp: 140, maxLoad: 34, vmax: 7.4, acc: 13, legTurn: 9, boost: 1.3, hipY: 1.05, weight: 8 },
  tread: { name: '履帶', type: 'tread', hp: 260, maxLoad: 62, vmax: 5.0, acc: 9, legTurn: 2.4, boost: 0.6, hipY: 0.75, weight: 16, grip: 1.6 },
  hover: { name: '懸浮', type: 'hover', hp: 130, maxLoad: 36, vmax: 8.2, acc: 7, legTurn: 6, boost: 1.2, hipY: 0.85, weight: 9, slide: 0.35, noMud: true },
};
// 武器
//   interval 射擊間隔、mag 彈匣（0 = 不用換彈）、reload、dmg、speed 彈速、spread 散布、pellets 一次幾發、kb 擊退、recoil 後座力、life 射程（秒）
//   energy = 每發吃多少能量（光束類）；salvo = 一次射幾發飛彈；kind：bullet / beam / missile / vmissile / split / saber
//   muzzle = 槍口在掛點本地的位置（方塊單位）
export const WEAPONS = {
  mg: { name: '機槍', type: 'kinetic', mount: 'arm', weight: 3, kind: 'bullet', interval: 0.07, mag: 60, reload: 2.2, dmg: 4, speed: 36, spread: 0.06, kb: 0.12, recoil: 0.05, life: 0.6, size: 0.07,
    model: [[-1, -1, 0, 3, 3, 7, 'f'], [0, 0, 7, 1, 1, 7, 'f'], [-1, -2, 2, 3, 1, 3, 'w']], muzzle: [0.5, 0.5, 14] },
  autocannon: { name: '機砲', type: 'kinetic', mount: 'arm', weight: 5, kind: 'bullet', interval: 0.16, mag: 24, reload: 2.4, dmg: 11, speed: 32, spread: 0.035, kb: 0.6, recoil: 0.2, life: 0.75, size: 0.1,
    model: [[-2, -2, 0, 4, 4, 7, 'f'], [-1, -1, 7, 2, 2, 9, 'f'], [-2, -3, 1, 4, 1, 4, 'w']], muzzle: [0, 0, 16] },
  shotgun: { name: '霰彈槍', type: 'kinetic', mount: 'arm', weight: 4, kind: 'bullet', interval: 0.75, mag: 6, reload: 2.0, dmg: 6, pellets: 8, speed: 26, spread: 0.22, kb: 0.35, recoil: 1.2, life: 0.32, size: 0.08,
    model: [[-2, -2, 0, 4, 4, 6, 'f'], [-2, -1, 6, 4, 2, 6, 'f'], [-2, -3, 1, 4, 1, 3, 'w']], muzzle: [0, 0, 12] },
  sniper: { name: '狙擊槍', type: 'kinetic', mount: 'arm', weight: 5, kind: 'bullet', interval: 1.3, mag: 5, reload: 2.6, dmg: 55, speed: 75, spread: 0.004, kb: 2.5, recoil: 1.5, life: 0.5, size: 0.08, trail: true,
    model: [[-1, -2, -1, 3, 4, 8, 'f'], [0, -1, 7, 1, 1, 13, 'f'], [-1, 2, 1, 3, 2, 4, 'w']], muzzle: [0.5, -0.5, 20] },
  beam: { name: '光束步槍', type: 'energy', mount: 'arm', weight: 4, kind: 'beam', interval: 0.45, mag: 0, dmg: 26, speed: 48, spread: 0.01, kb: 0.8, recoil: 0.3, life: 0.5, size: 0.11, energy: 12,
    model: [[-2, -2, 0, 4, 4, 8, 'f'], [-1, -1, 8, 2, 2, 6, 'w'], [-1, -1, 14, 2, 2, 1, 'g']], muzzle: [0, 0, 15] },
  saber: { name: '光束劍', type: 'energy', mount: 'arm', weight: 2, kind: 'saber', interval: 0.55, mag: 0, dmg: 58, kb: 4, energy: 15, reach: 2.4, arc: 2.2, lunge: 7,
    model: [[-1, -2, -1, 2, 4, 3, 'f'], [-1, -1, 2, 2, 2, 1, 'w']], blade: 22, muzzle: [0, 0, 3] },
  cannon: { name: '加農砲', type: 'kinetic', mount: 'back', weight: 8, kind: 'bullet', interval: 1.1, mag: 0, dmg: 45, speed: 26, spread: 0, kb: 4.5, recoil: 2.8, life: 1.2, size: 0.2, heavy: true,
    model: [[-2, -2, -4, 5, 5, 8, 'f'], [-1, -1, 4, 3, 3, 12, 'f'], [-2, -2, 15, 5, 5, 1, 'w']], muzzle: [0.5, 0.5, 17] },
  missile: { name: '直射飛彈', type: 'chemical', mount: 'back', weight: 6, kind: 'missile', interval: 1.2, mag: 8, reload: 3.0, dmg: 30, salvo: 2, speed: 13, accel: 18, maxSpeed: 22, turn: 2.6, life: 2.2, size: 0.12, splash: 1.3,
    model: [[-3, -3, -4, 6, 6, 8, 'f'], [-2, -2, 4, 2, 2, 1, 'w'], [0, -2, 4, 2, 2, 1, 'w'], [-2, 0, 4, 2, 2, 1, 'w'], [0, 0, 4, 2, 2, 1, 'w']], muzzle: [0, 0, 5] },
  vmissile: { name: '垂直飛彈', type: 'chemical', mount: 'back', weight: 7, kind: 'vmissile', interval: 1.6, mag: 8, reload: 3.4, dmg: 22, salvo: 4, speed: 9, life: 4, size: 0.12, splash: 1.5, needLock: true,
    model: [[-3, -3, -4, 6, 5, 8, 'f'], [-2, 2, -3, 2, 1, 2, 'w'], [0, 2, -3, 2, 1, 2, 'w'], [-2, 2, 0, 2, 1, 2, 'w'], [0, 2, 0, 2, 1, 2, 'w']], muzzle: [0, 3, 0] },
  split: { name: '分裂飛彈', type: 'chemical', mount: 'back', weight: 7, kind: 'split', interval: 1.8, mag: 4, reload: 3.4, dmg: 11, salvo: 1, bomblets: 6, speed: 12, accel: 10, maxSpeed: 17, turn: 1.6, life: 2.4, size: 0.18, splash: 1.0,
    model: [[-3, -3, -4, 6, 6, 9, 'f'], [-2, -2, 5, 4, 4, 2, 'w']], muzzle: [0, 0, 7] },
};
export const SLOTS = ['armL', 'armR', 'backL', 'backR'];
export const SLOT_NAMES = { armL: '左手', armR: '右手', backL: '左背', backR: '右背' };
export const SLOT_KEYS = { armL: '左鍵', armR: '右鍵', backL: 'Q', backR: 'E' };
export const ARMOR_PARTS = { head: '頭部', torso: '軀幹', arms: '手臂', legs: '腳部' };

export const DEFAULT_LOADOUT = {
  head: 'std', core: 'std', legs: 'biped',
  armL: 'mg', armR: 'beam', backL: 'missile', backR: 'cannon',
  armor: { head: 'composite', torso: 'composite', arms: 'composite', legs: 'composite' },
};

// 敵機的配裝（試玩場隨機挑）
export const ENEMY_PRESETS = [
  { name: '突擊型', head: 'std', core: 'std', legs: 'biped', armL: 'autocannon', armR: 'shotgun', backL: 'missile', backR: null,
    armor: { head: 'composite', torso: 'composite', arms: 'composite', legs: 'composite' } },
  { name: '狙擊型', head: 'hunter', core: 'light', legs: 'reverse', armL: null, armR: 'sniper', backL: 'vmissile', backR: null,
    armor: { head: 'mirror', torso: 'mirror', arms: 'mirror', legs: 'mirror' } },
  { name: '光束型', head: 'std', core: 'light', legs: 'hover', armL: 'beam', armR: 'saber', backL: null, backR: null,
    armor: { head: 'ceramic', torso: 'ceramic', arms: 'ceramic', legs: 'ceramic' } },
  { name: '重砲型', head: 'dome', core: 'heavy', legs: 'tread', armL: 'mg', armR: 'mg', backL: 'cannon', backR: 'split',
    armor: { head: 'ceramic', torso: 'composite', arms: 'composite', legs: 'ceramic' } },
];

// 隨機組一台（觀戰用）：至少兩把武器，總重盡量不超過腳的負重
const pickOf = obj => { const k = Object.keys(obj); return k[Math.floor(Math.random() * k.length)]; };
export function randomLoadout() {
  const armW = Object.keys(WEAPONS).filter(k => WEAPONS[k].mount === 'arm'), backW = Object.keys(WEAPONS).filter(k => WEAPONS[k].mount === 'back');
  const r = a => a[Math.floor(Math.random() * a.length)];
  for (let tries = 0; tries < 30; tries++) {
    const lo = {
      head: pickOf(HEADS), core: pickOf(CORES), legs: pickOf(LEGS),
      armL: Math.random() < 0.9 ? r(armW) : null, armR: Math.random() < 0.9 ? r(armW) : null,
      backL: Math.random() < 0.6 ? r(backW) : null, backR: Math.random() < 0.5 ? r(backW) : null,
      armor: { head: pickOf(ARMORS), torso: pickOf(ARMORS), arms: pickOf(ARMORS), legs: pickOf(ARMORS) },
    };
    const n = SLOTS.filter(s => lo[s]).length;
    if (n < 2 || computeSpec(lo).loadK > 1.05) continue;
    const main = WEAPONS[lo.armR ?? lo.armL ?? lo.backL ?? lo.backR].name;
    lo.name = `${LEGS[lo.legs].name}・${main}`;
    return lo;
  }
  return structuredClone(ENEMY_PRESETS[0]);
}

// ---------- 由零件算出整台機體的數值 ----------
// 超重不禁止，只是變慢：總重超過腳的負重 → 極速、加速下降；手臂超重 → 上半身轉速、命中下降；背部超重 → 能量回復變慢
export function computeSpec(lo) {
  const head = HEADS[lo.head], core = CORES[lo.core], legs = LEGS[lo.legs];
  const w = id => id ? WEAPONS[id].weight : 0;
  const armW = w(lo.armL) + w(lo.armR), backW = w(lo.backL) + w(lo.backR);
  const total = head.weight + core.weight + armW + backW;
  const loadK = total / legs.maxLoad;
  const moveK = loadK > 1 ? Math.max(0.5, 1 - (loadK - 1) * 1.6) : 1;
  const armOver = armW > core.armLoad, backOver = backW > core.backLoad;
  return {
    head, core, legs, armW, backW, total, loadK, moveK, armOver, backOver,
    vmax: legs.vmax * moveK, acc: legs.acc * moveK, legTurn: legs.legTurn * (loadK > 1 ? 0.8 : 1),
    turn: core.turn * (armOver ? 0.7 : 1), spreadMul: armOver ? 1.6 : 1,
    regen: backOver ? 0.6 : 1, boost: legs.boost * (loadK > 1 ? 0.8 : 1),
    hp: { head: head.hp, torso: core.hp, armL: Math.round(core.hp * 0.38), armR: Math.round(core.hp * 0.38), legs: legs.hp },
  };
}

// 存取玩家配裝
const KEY = 'brickmecha.loadout';
export function loadLoadout() {
  try {
    const lo = JSON.parse(localStorage.getItem(KEY));
    if (lo && HEADS[lo.head] && CORES[lo.core] && LEGS[lo.legs] && lo.armor) {
      for (const s of SLOTS) if (lo[s] && !WEAPONS[lo[s]]) lo[s] = null;
      return lo;
    }
  } catch { /* 用預設 */ }
  return structuredClone(DEFAULT_LOADOUT);
}
export function saveLoadout(lo) { try { localStorage.setItem(KEY, JSON.stringify(lo)); } catch { /* 存不了就算了 */ } }
