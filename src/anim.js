// ---------- 機體動作：有重量的程序動畫 ----------
// 只有畫面：讀機體的邏輯狀態（速度、步伐相位、武器冷卻、耐久…），只改模型群組的位置 / 旋轉，不寫回任何邏輯欄位。
//   動畫自己的狀態存在 m.model.anim（模型重建就重來）；要隨機的地方用機體 id 的雜湊和 G.now，不呼叫 Math.random()
//   （無頭模擬器 tools/sim 用固定種子的 Math.random 重播戰鬥；它不呼叫 poseMech，所以這個檔案在模擬裡不會跑）
// 入口：animMech(m, dt)，mech.js 的 poseMech 每幀呼叫；只處理有關節的機體（model.js 的 rig：王牌機），其他回傳 false 照舊
//
// 分層（由下往上疊）：
//   A. 身體彈簧：上下（y）和傾斜（lean，世界座標的向量 = 頭頂往哪邊倒）各是一個有阻尼的彈簧。
//      彈簧多硬、阻尼多少由重量決定（heft）：輕 = 硬、回得快；重 / 超載 = 軟、沉得深、停下來會多晃一下。
//      加減速、腳落地、開火的後座力都是「推彈簧一下」，所以會自然疊在一起，恢復的手感跟著重量走。
//   B. 步態：腳掌有目標點（支撐時貼著地往後、擺動時抬起來往前），用兩節 IK 解出髖、膝、踝的角度。相位只讀 m.walk（腳步聲跟它走）。
//   C. 手臂：走路時擺臂、放鬆時前臂垂低一點；一開火（武器冷卻跳起來的那一幀）前臂立刻打直朝前，畫面上的槍口才對得上子彈。
import { G } from './core.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, k) => a + (b - a) * k;
const frac = v => v - Math.floor(v);
const smooth = k => k * k * (3 - 2 * k);
const hash = n => { let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b); h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35); return ((h ^ h >>> 16) >>> 0) / 4294967296; };
// 有阻尼的彈簧：s = { x, v }；w = 自然頻率（rad/s）、z = 阻尼比、f = 額外的加速度
function spring(s, target, w, z, dt, f = 0) {
  s.v += (-w * w * (s.x - target) - 2 * z * w * s.v + f) * dt;
  s.x += s.v * dt;
}
const S0 = () => ({ x: 0, v: 0 });

// 每隻腳的幾何（腳的前後平面 z / y）：a 大腿長、b 小腿長、ang = 靜止時那一節的角度（0 = 朝正下、正 = 往前）、bend = 膝蓋往前（1）還是往後（-1）彎
function legGeo(R, type) {
  const k = R.kneeP, an = R.ankleP, r2z = an.z - k.z, r2y = an.y - k.y;
  const c = k.z * -an.y - -k.y * an.z;   // 膝蓋在「髖 → 踝」這條線的前面還是後面
  return {
    a: Math.hypot(k.y, k.z), b: Math.hypot(r2y, r2z), ang1: Math.atan2(k.z, -k.y), ang2: Math.atan2(r2z, -r2y),
    // 靜止時就是彎的（逆關節：膝蓋在前、小腿往後斜）→ 照外型原本彎的方向；筆直的 → 雙足往前彎、逆關節往後彎
    bend: Math.abs(c) > 1e-4 ? Math.sign(c) : type === 'reverse' ? -1 : 1,
    az: an.z, ay: an.y, len: Math.hypot(k.y, k.z) + Math.hypot(r2y, r2z),
  };
}

function init(m) {
  const S = m.spec, R = m.model.rig;
  // 重量感 0..1：總重和負載比各佔一半；超載另外算（over 0..1）
  const h = clamp(0.5 * (S.total - 20) / 20 + 0.5 * (S.loadK - 0.55) / 0.45, 0, 1), over = clamp((S.loadK - 1) / 0.4, 0, 1);
  const legged = R.legs.length === 2, type = S.legs.type;
  return {
    h, over, legged, type,
    w: lerp(15, 7.5, h) * (1 - 0.2 * over) * (type === 'tread' ? 1.3 : 1),   // 身體彈簧的頻率
    z: lerp(0.8, 0.46, h) - 0.1 * over,                                       // 阻尼比
    y: S0(), lx: S0(), lz: S0(),
    pvx: 0, pvz: 0, ax: 0, az: 0, pwalk: m.walk, rate: 0, gait: 0, step: Math.floor(m.walk / Math.PI),
    last: G.now, seed: hash(m.id ?? 1),
    legs: R.legs.map(L => legGeo(L, type)),
    arms: { armL: { aim: 1, hold: 0, pcd: 0, kick: S0() }, armR: { aim: 1, hold: 0, pcd: 0, kick: S0() } },
  };
}

export function animMech(m, dt) {
  const M = m.model, R = M.rig;
  if (!R || m.grunt || m.fly || !(R.legs.length || R.arms.armL || R.arms.armR)) return false;
  const A = M.anim ??= init(m), k = m.k ?? 1, h = A.h;
  // 暫停 / 主選單（dt = 0）：用 G.now 自己算時間，待機動作才會動；G.now 也停了就整個停住
  const now = G.now, adt = dt > 0 ? Math.min(dt, 1 / 30) : clamp(now - A.last, 0, 1 / 30);
  A.last = now;

  // ---- 讀狀態 ----
  const vx = m.vx / k, vz = m.vz / k, sp = Math.hypot(vx, vz), vmax = Math.max(1, m.spec.vmax);
  const spK = clamp(sp / vmax, 0, 1.5);
  let stepped = false;
  if (adt > 0) {
    let ax = (vx - A.pvx) / adt, az = (vz - A.pvz) / adt;
    const al = Math.hypot(ax, az);
    if (al > 60) { ax *= 60 / al; az *= 60 / al; }   // 瞬間移動 / 被撞飛：不要讓彈簧炸掉
    const f = 1 - Math.exp(-18 * adt);
    A.ax += (ax - A.ax) * f; A.az += (az - A.az) * f;
    A.pvx = vx; A.pvz = vz;
    // 步伐相位每秒走多少（平滑過：幀率不穩時不會忽快忽慢）
    A.rate += ((dt > 0 ? (m.walk - A.pwalk) / dt : 0) - A.rate) * (1 - Math.exp(-14 * adt));
    A.pwalk = m.walk;
    const walking = A.legged && A.rate > 0.5;
    A.gait += ((walking ? 1 : 0) - A.gait) * (1 - Math.exp(-(walking ? 10 : 6) * adt));
    const st = Math.floor(m.walk / Math.PI);
    if (st !== A.step) { A.step = st; stepped = walking; }
  }
  const gait = A.gait, legged = A.legged;
  // 急停 / 滑行：有速度但腳沒在走
  const skid = legged ? clamp(spK * 1.4 - 0.15, 0, 1) * (1 - gait) : 0;

  // ---- A. 身體彈簧 ----
  const dirx = sp > 0.2 ? vx / sp : 0, dirz = sp > 0.2 ? vz / sp : 0;
  if (adt > 0) {
    // 傾斜：移動時往前傾一點（步行、懸浮）；加速度把頭頂往反方向甩（慣性），重的甩得多
    const leanV = (A.type === 'tread' ? 0 : A.type === 'hover' ? 0.09 : lerp(0.11, 0.07, h) * gait) * Math.min(1, spK) - skid * 0.12;
    const gain = lerp(0.008, 0.013, h) * (A.type === 'tread' ? 0.6 : 1), w = A.w, w2 = w * w;
    // 上下：重的坐得低；走路時腿張開髖會降一點；急停蹲下去
    const idle = Math.sin(now * 1.7 + A.seed * 6) * 0.006 * (1 - gait);
    const sag = legged ? 0.01 + 0.03 * h + 0.04 * A.over + skid * 0.09 + gait * (0.02 + 0.02 * h) : 0.01 * h;
    if (stepped) {
      // 腳落地：身體往下沉一下再彈回來；重的沉得深、回得慢。頭也跟著點一下
      const hit = lerp(0.5, 0.75, h) * (0.4 + 0.6 * Math.min(1, spK)) * (1 + 0.4 * A.over);
      A.y.v -= hit;
      A.lx.v += dirx * hit * 0.5; A.lz.v += dirz * hit * 0.5;
    }
    const n = adt > 1 / 55 ? 2 : 1, sdt = adt / n;
    for (let i = 0; i < n; i++) {
      spring(A.y, -sag + idle, w * 1.15, A.z, sdt);
      spring(A.lx, dirx * leanV, w, A.z, sdt, -A.ax * gain * w2);
      spring(A.lz, dirz * leanV, w, A.z, sdt, -A.az * gain * w2);
    }
    const ll = Math.hypot(A.lx.x, A.lz.x);
    if (ll > 0.3) { A.lx.x *= 0.3 / ll; A.lz.x *= 0.3 / ll; }
    A.y.x = clamp(A.y.x, -0.3, 0.12);
  }
  const ty = m.torsoYaw, ly = m.legYaw, sT = Math.sin(ty), cT = Math.cos(ty), sL = Math.sin(ly), cL = Math.cos(ly);
  // 走路時重心左右換腳（俯視時最看得出來）：往支撐腳那邊靠
  const sway = legged ? Math.sin(m.walk - 0.35) * lerp(0.03, 0.075, h) * gait * (1 - 0.4 * Math.min(1, spK)) : 0;
  // 身體的位移（模型根部的座標）：傾斜時整個上半身往那邊挪 + 換腳的左右晃
  const shift = legged ? 0.5 * M.hipY : 0.12 * M.hipY;
  const bx = A.lx.x * shift + cL * sway, bz = A.lz.x * shift - sL * sway, by = A.y.x;
  const pitch = A.lx.x * sT + A.lz.x * cT, roll = -(A.lx.x * cT - A.lz.x * sT);
  M.torsoG.position.set(bx, M.hipY + by, bz);
  M.torsoG.rotation.set(pitch, ty, roll + (legged ? Math.sin(m.walk - 0.35) * 0.035 * gait * (cL * cT + sL * sT) : 0));

  // ---- B. 腳 ----
  if (legged) {
    // 身體位移換到腳部群組的座標（腳掌要留在原地，所以目標點要扣掉）
    const oxL = bx * cL - bz * sL, ozL = bx * sL + bz * cL;
    const pg = M.parts.legs.g;
    pg.position.set(oxL, by, ozL);
    // 前進方向（腳的座標）
    const dLx = vx * cL - vz * sL, dLz = vx * sL + vz * cL, dl = Math.hypot(dLx, dLz);
    const ux = dl > 0.2 ? dLx / dl : 0, uz = dl > 0.2 ? dLz / dl : 1;
    // 支撐期佔一步的多少：走得慢 / 重 → 兩腳都在地上的時間長；跑起來 / 輕 → 有騰空
    const duty = clamp(lerp(0.64, 0.44, Math.min(1, spK)) + 0.08 * h, 0.4, 0.75);
    const cyc = TAU / Math.max(A.rate, 2);
    for (let i = 0; i < 2; i++) {
      const Lg = R.legs[i], g = A.legs[i];
      const p = frac(m.walk / TAU + i * 0.5);
      // 步幅：支撐期腳掌相對身體往後走的距離 = 速度 × 支撐時間（太長腿不夠 → 截掉，會滑一點）
      const stride = Math.min(sp * duty * cyc, g.len * 0.95) * gait;
      let s, lift = 0, fp = 0;
      if (p < duty) {
        const u = p / duty;
        s = 0.5 - u;
        fp = u < 0.2 ? -0.4 * (1 - u / 0.2) : u > 0.7 ? 0.5 * (u - 0.7) / 0.3 : 0;   // 腳跟先著地 → 平 → 腳跟離地
      } else {
        const q = (p - duty) / (1 - duty);
        s = -0.5 + smooth(q);
        lift = Math.sin(Math.PI * Math.pow(q, 0.8)) * lerp(0.2, 0.11, h) * g.len * (0.45 + 0.55 * Math.min(1, spK));
        fp = 0.5 * Math.cos(Math.PI * q);   // 腳尖朝下拖著離地 → 腳尖翹起來準備落地
      }
      const amp = gait * Math.min(1, stride / (0.35 * g.len));
      fp *= amp; lift *= gait;
      // 急停：兩腳往前撐（前後錯開一點）
      const brace = skid * g.len * (0.24 + (i ? 0.08 : -0.02));
      const X = ux * (s * stride + brace) - oxL;
      let Z = g.az + uz * (s * stride + brace) - ozL, Y = g.ay - by + lift;
      // 兩節 IK（前後平面）
      let d = Math.hypot(Z, Y);
      const dMax = (g.a + g.b) * 0.999, dMin = Math.abs(g.a - g.b) + 0.03;
      if (d > dMax) { Z *= dMax / d; Y *= dMax / d; d = dMax; } else if (d < dMin) { const q = dMin / Math.max(d, 1e-4); Z *= q; Y *= q; d = dMin; }
      const angT = Math.atan2(Z, -Y), cA = clamp((g.a * g.a + d * d - g.b * g.b) / (2 * g.a * d), -1, 1);
      const angK = angT + g.bend * Math.acos(cA);
      const kz = g.a * Math.sin(angK), ky = -g.a * Math.cos(angK);
      const angS = Math.atan2(Z - kz, -(Y - ky));
      const hipR = g.ang1 - angK, kneeR = g.ang2 - angS - hipR;
      const side = clamp(Math.asin(clamp(X / Math.max(d, 0.1), -0.6, 0.6)), -0.5, 0.5);
      Lg.hip.rotation.set(hipR, 0, side);
      Lg.knee.rotation.x = kneeR;
      Lg.ankle.rotation.set(-(hipR + kneeR) + fp, 0, -side);
    }
  } else if (A.type === 'hover') M.parts.legs.g.rotation.set(pitch * 0.4 * (cL * cT + sL * sT), 0, 0);   // 懸浮：裙甲跟著前後傾一點

  // ---- C. 手臂 ----
  const cw = Math.cos(m.walk);
  for (const slot of ['armL', 'armR']) {
    const p = m.parts[slot], Ar = R.arms[slot];
    if (!p || !Ar) continue;
    const a = A.arms[slot], side = slot === 'armL' ? 1 : -1, gun = m.guns?.[slot], def = gun?.def;
    const sw = m.swing?.slot === slot ? m.swing : null;
    // 揮劍：那隻手臂由外往內掃過去（照舊）
    if (sw) { const t = 1 - sw.t / sw.dur; p.g.rotation.y = side * (1.1 - t * 2.4); }
    else p.g.rotation.y *= Math.exp(-12 * adt);
    // 開火：冷卻跳起來的那一幀 = 剛射出去 → 前臂馬上打直、後座力推一下
    const cd = gun?.cd ?? 0, fired = adt > 0 && cd > a.pcd + 1e-4 && def?.kind !== 'shield';
    a.pcd = cd;
    if (fired) {
      a.aim = 1; a.hold = 0.9;
      const kick = 0.7 + Math.min(1.8, (def.dmg ?? 6) / 10) + (def.recoil ?? 0) * 0.5;
      a.kick.v -= kick;
      A.lx.v -= sT * kick * 0.06 * (1.3 - h); A.lz.v -= cT * kick * 0.06 * (1.3 - h);
    }
    if (adt > 0) {
      a.hold -= adt;
      const busy = cd > 0 || a.hold > 0 || def?.kind === 'shield' || sw || m.punch?.slot === slot || m.charge?.slot === slot;
      a.aim += ((busy ? 1 : 0) - a.aim) * (1 - Math.exp(-(busy ? 30 : 3.5) * adt));
      spring(a.kick, 0, 24, 0.55, adt);
    }
    // 背部武器準備中：手臂垂下、往外張開一點（拿盾的手臂不放下）
    const e = def?.kind === 'shield' ? 0 : smooth(m.readyK[slot[3]]);
    // 放鬆：上臂微微後收、前臂垂低；走路時前後擺（跟同側的腳相反）
    const relax = (1 - a.aim) * (1 - e), swing = side * cw * lerp(0.16, 0.1, h) * gait;
    p.g.rotation.x = 0.5 * e + relax * (0.06 + swing) + a.kick.x;
    p.g.rotation.z = side * (0.12 * e + 0.04 * relax);
    Ar.elbow.rotation.x = 0.5 * e + relax * (0.3 + Math.max(0, -swing) * 0.8) + e * swing * 0.5;
  }
  return true;
}
