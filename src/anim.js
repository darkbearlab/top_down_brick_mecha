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
//   B. 步態：腳掌有目標點（支撐時貼著地往後、擺動時抬起來往前），用兩節 IK 解出髖、膝、踝的角度。
//      不滑步：支撐中的腳掌相對身體往後走的速度 = 機體實際的速度。腿就這麼長，所以跑得快時著地的時間很短、中間是騰空（像短跑）。
//      步頻照實際速度自己算（A.ph），不直接用 m.walk：m.walk 的步頻跟速度對不上（半速時一步要跨 2 格以上），照它走腳一定滑。
//      m.walk 只拿來判斷「有沒有在出力走」。（腳步聲還是跟 m.walk，所以聲音和畫面的腳步不會完全同拍。）
//   C. 手臂：走路時擺臂、放鬆時前臂垂低一點；一開火（武器冷卻跳起來的那一幀）前臂立刻打直朝前，畫面上的槍口才對得上子彈。
//   D. 損傷（階段 2）：照部位耐久換動作，不是同一組動作打折。門檻 50% / 25% / 損毀。
//      腳：遊戲裡腳是一個部位，畫面上挑一隻當「壞的那隻」（機體 id 的雜湊，固定不變）。
//        跛行（limp 0.5 / 1）：壞腳著地的時間短、身體垮向它、抬不高往外甩著走；好腳提早落地、踩得重。
//        拖行（drag，腳損毀）：壞腳不再跨步，伸直拖在後面、腳尖刮地；好腳小步快跳，身體靠向好腳、一頓一頓往前。
//      手臂損毀：少了一邊的重量，上半身歪向還在的那隻。手臂受損：垂得低、發抖。
//      軀幹重創（hunch 0.5 / 1）：整台往前駝、喘息似的起伏；剩不到 25% 會不時抽一下。
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
// 部位剩多少耐久 → 損傷等級：0 正常、0.5 受損（不到 50%）、1 重創（不到 25% 或損毀）。沒有耐久資料的當作正常
const dmgOf = p => !p || p.max == null ? 0 : p.broken || p.hp < 0.25 * p.max ? 1 : p.hp < 0.5 * p.max ? 0.5 : 0;

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

// 步頻（每秒幾個循環 = 兩步）：跟著實際速度
const cadence = (A, sp) => (0.5 + 0.17 * sp) * (1 - 0.12 * A.h) * (A.type === 'reverse' ? 1.1 : 1) * (1 + 0.2 * A.limp + 0.15 * A.drag);   // 腳受損：步子小、踩得急

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
    pvx: 0, pvz: 0, ax: 0, az: 0, pwalk: m.walk, rate: 0, gait: 0, step: 0, ph: 0,
    bk: 0, bw: 0, bdx: 0, bdz: 1, lead: 0, wasWalk: false,   // 急停：bk 倒數 1 → 0、bw 姿勢的權重、bdx / bdz 煞車前的前進方向、lead 往前踏住的那隻腳
    last: G.now, seed: hash(m.id ?? 1),
    // 損傷：limp 跛行 0 / 0.5 / 1、drag 拖行 0 / 1、hunch 軀幹重創 0 / 0.5 / 1、tilt 少了哪邊手臂（-1 少左、+1 少右）；都是平滑過的
    limp: 0, drag: 0, hunch: 0, tilt: 0, bad: hash((m.id ?? 1) + 77) < 0.5 ? 0 : 1, jolt: -1,
    lp: [0, 0.5], pp: [0, 0.5], dd: [0.6, 0.6], rr: [1, 1],   // 每隻腳：上一幀的相位、這一幀的相位、支撐期佔多少、一步最多跨多長
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
  let td = -1;   // 這一幀哪隻腳落地（-1 = 沒有）
  if (adt > 0) {
    let ax = (vx - A.pvx) / adt, az = (vz - A.pvz) / adt;
    const al = Math.hypot(ax, az);
    if (al > 60) { ax *= 60 / al; az *= 60 / al; }   // 瞬間移動 / 被撞飛：不要讓彈簧炸掉
    const f = 1 - Math.exp(-18 * adt);
    A.ax += (ax - A.ax) * f; A.az += (az - A.az) * f;
    A.pvx = vx; A.pvz = vz;
    // 步伐相位每秒走多少（平滑過：幀率不穩時不會忽快忽慢）
    const raw = dt > 0 ? (m.walk - A.pwalk) / dt : 0, driving = A.legged && raw > 0.5;   // 這一幀腳有沒有在出力（即時的，急停要馬上知道）
    A.rate += (raw - A.rate) * (1 - Math.exp(-14 * adt));
    A.pwalk = m.walk;
    const walking = A.legged && A.rate > 0.5;
    A.gait += ((walking ? 1 : 0) - A.gait) * (1 - Math.exp(-(walking ? 10 : 6) * adt));
    // 急停：還有速度的時候腳不出力了 → 一隻腳（正要落地的那隻）往前猛踏一步撐住、重心往後坐，穩住之後再收回來；重的撐比較久
    if (sp > 0.2) { A.bdx = vx / sp; A.bdz = vz / sp; }
    // 損傷等級（平滑過：剛跨過門檻時不會瞬間換姿勢）
    const P = m.parts, fd = 1 - Math.exp(-5 * adt);
    A.limp += ((A.legged ? dmgOf(P.legs) : 0) - A.limp) * fd;
    A.drag += ((A.legged && P.legs?.broken ? 1 : 0) - A.drag) * fd;
    A.hunch += (dmgOf(P.torso) - A.hunch) * (1 - Math.exp(-3 * adt));
    A.tilt += (((P.armR?.broken ? 1 : 0) - (P.armL?.broken ? 1 : 0)) - A.tilt) * fd;
    if (A.wasWalk && !driving && sp > 0.3 * vmax) {
      A.bk = 1; A.lead = A.limp > 0.3 ? 1 - A.bad : frac(A.ph / TAU) > frac(A.ph / TAU + 0.5) ? 0 : 1;   // 腳受損：用好的那隻踏
      A.y.v -= lerp(0.45, 0.9, h);   // 踏下去那一下
      const jb = lerp(1.6, 1.1, h); A.lx.v -= A.bdx * jb; A.lz.v -= A.bdz * jb;   // 上半身馬上往後收
    }
    if (driving) A.bk = 0;
    A.wasWalk = driving;
    A.bk = Math.max(0, A.bk - adt / (0.5 + 0.4 * h));
    const bt = smooth(Math.min(1, A.bk / 0.4));
    A.bw += (bt - A.bw) * (1 - Math.exp(-(bt > A.bw ? 28 : 9) * adt));
    // 步頻（每秒幾個循環）：跟著實際速度；重的慢一點、逆關節快一點
    if (A.gait > 0.02) A.ph += TAU * cadence(A, sp) * adt;
    // 每隻腳的相位（0 = 落地的瞬間）；跛行：好腳提早落地（壞腳撐不久）
    for (let i = 0; i < 2; i++) {
      const p = frac(A.ph / TAU + i * 0.5 + (i !== A.bad ? 0.14 * A.limp : 0));
      if (p < A.lp[i] - 0.5 && walking) td = i;
      A.lp[i] = A.pp[i] = p;
    }
  }
  const gait = A.gait, legged = A.legged, limp = A.limp, drag = A.drag, hunch = A.hunch, bad = A.bad;
  // 急停 / 滑行：有速度但腳沒在走
  const skid = legged ? Math.max(clamp(spK * 1.4 - 0.15, 0, 1) * (1 - gait), A.bw) : 0;
  const ty = m.torsoYaw, ly = m.legYaw, sT = Math.sin(ty), cT = Math.cos(ty), sL = Math.sin(ly), cL = Math.cos(ly);

  // ---- A. 身體彈簧 ----
  // 上下：重的坐得低；跑起來要蹲低一點腿才跨得開；急停蹲下去
  const sag0 = (legged ? 0.01 + 0.03 * h + 0.04 * A.over + skid * 0.07 + gait * (0.035 + 0.055 * Math.min(1, spK)) + 0.02 * limp + 0.02 * drag : 0.01 * h) + 0.03 * hunch;
  // 每隻腳的支撐期：讓「步幅 = 速度 × 支撐時間」剛好不超過腿長 → 腳掌貼著地不滑；慢的時候最多 0.64（兩腳都在地上）+ 重的再長一點
  //   快到連 0.16 都不夠（推進、被撞飛）才會滑。跛行：壞腳的支撐期縮短、好腳慢走時多撐一點
  const cyc = 1 / cadence(A, sp);   // 一個循環幾秒
  let dipB = 0;   // 壞腳正撐著身體（0 → 1 → 0）
  if (legged) for (let i = 0; i < 2; i++) {
    const g = A.legs[i], H = -(g.ay + sag0), dR = (g.a + g.b) * 0.985;
    // 腿伸直時腳掌前後最遠到哪（照現在蹲多低算）→ 一步最多跨多長
    const reach = A.rr[i] = 2 * 0.9 * Math.sqrt(Math.max(0.01, dR * dR - H * H));
    const base = clamp(reach / Math.max(sp * cyc, 1e-3), 0.16, 0.64 + 0.06 * h + (i !== bad ? 0.1 * limp : 0));
    A.dd[i] = i === bad ? base * (1 - 0.35 * limp) : base;
    // 從壞腳落地到好腳接住為止，身體一路垮下去
    if (i === bad) { const win = 0.5 - 0.14 * limp; if (A.pp[i] < win) dipB = Math.sin(Math.PI * A.pp[i] / win) * gait; }
  }
  const sag = sag0 + limp * (1 - drag) * 0.075 * dipB;
  // 壞腳在哪一邊（腳的座標 x）；身體左右的偏移：跛行 = 壞腳撐著時垮向它、站著時重心放在好腳；拖行 = 一直靠在好腳上
  const sxB = legged ? Math.sign(R.legs[bad].hipP.x) || 1 : 0;
  const lat = sxB * (limp * (1 - drag) * (0.12 * dipB - 0.03 * (1 - gait)) - 0.06 * drag);
  // 少一隻手臂：歪向還在的那隻（上半身的座標 x）；軀幹重創：往前駝，喘的時候前後晃
  const pant = Math.sin(now * 2.9 + A.seed * 9) + 0.45 * Math.sin(now * 5.8 + 1);
  const tlt = 0.07 * A.tilt, hp = hunch * (0.085 + 0.012 * pant);
  const exx = cL * lat + cT * tlt + sT * hp, exz = -sL * lat - sT * tlt + cT * hp;
  const dirx = sp > 0.2 ? vx / sp : 0, dirz = sp > 0.2 ? vz / sp : 0;
  if (adt > 0) {
    // 傾斜：移動時往前傾一點（步行、懸浮）；加速度把頭頂往反方向甩（慣性），重的甩得多
    const leanV = (A.type === 'tread' ? 0 : A.type === 'hover' ? 0.09 : lerp(0.11, 0.07, h) * gait) * Math.min(1, spK), back = skid * 0.1;
    // 加速度：有腳的會主動用重心去配合（起步往前傾、煞車往後坐、轉彎往內傾）；履帶、懸浮是車，被慣性甩（反方向）
    const gain = legged ? lerp(0.006, 0.009, h) : -lerp(0.008, 0.013, h) * (A.type === 'tread' ? 0.6 : 1), w = A.w, w2 = w * w;
    const idle = Math.sin(now * 1.7 + A.seed * 6) * 0.006 * (1 - gait);
    if (td >= 0) {
      // 腳落地：身體往下沉一下再彈回來；重的沉得深、回得慢。頭也跟著點一下
      // 跛行：好腳接住整台的重量（踩得重）、壞腳只是輕輕點一下；拖行：壞腳根本沒離地
      const hit = lerp(0.5, 0.75, h) * (0.4 + 0.6 * Math.min(1, spK)) * (1 + 0.4 * A.over) * (td !== bad ? 1 + 0.5 * limp + 0.5 * drag : (1 - 0.6 * limp) * (1 - drag));
      A.y.v -= hit;
      A.lx.v += dirx * hit * 0.5; A.lz.v += dirz * hit * 0.5;
    }
    // 軀幹剩不到 25%：不時抽一下（時間和方向由機體 id + 時間決定，不用亂數）
    const jt = Math.floor(now / 2.6 + A.seed * 7);
    if (jt !== A.jolt) {
      if (A.jolt >= 0 && hunch > 0.8) { const a = hash(jt * 31 + (m.id ?? 1)) * TAU; A.y.v -= 0.35; A.lx.v += Math.sin(a) * 0.55; A.lz.v += Math.cos(a) * 0.55; }
      A.jolt = jt;
    }
    const n = adt > 1 / 55 ? 2 : 1, sdt = adt / n;
    for (let i = 0; i < n; i++) {
      spring(A.y, -sag + idle + hunch * 0.014 * pant, w * 1.15, A.z, sdt);
      spring(A.lx, dirx * leanV - A.bdx * back + exx, w, A.z, sdt, A.ax * gain * w2);
      spring(A.lz, dirz * leanV - A.bdz * back + exz, w, A.z, sdt, A.az * gain * w2);
    }
    const ll = Math.hypot(A.lx.x, A.lz.x);
    if (ll > 0.3) { A.lx.x *= 0.3 / ll; A.lz.x *= 0.3 / ll; }
    A.y.x = clamp(A.y.x, -0.3, 0.12);
  }
  // 走路時重心左右換腳（俯視時最看得出來）：往支撐腳那邊靠
  const sway = legged ? Math.sin(A.ph - 0.35) * lerp(0.03, 0.075, h) * gait * (1 - 0.4 * Math.min(1, spK)) : 0;
  // 身體的位移（模型根部的座標）：傾斜時整個上半身往那邊挪 + 換腳的左右晃
  const shift = legged ? 0.5 * M.hipY : 0.12 * M.hipY;
  // 拖行：好腳一撐，身體往前頓一下再被拖著的腳拉住
  const surge = drag * gait * 0.05 * Math.sin(TAU * A.pp[1 - bad] - 1);
  const bx = A.lx.x * shift + cL * sway + A.bdx * surge, bz = A.lz.x * shift - sL * sway + A.bdz * surge, by = A.y.x;
  const pitch = A.lx.x * sT + A.lz.x * cT, roll = -(A.lx.x * cT - A.lz.x * sT);
  M.torsoG.position.set(bx, M.hipY + by, bz);
  M.torsoG.rotation.set(pitch, ty, roll + (legged ? Math.sin(A.ph - 0.35) * 0.035 * gait * (cL * cT + sL * sT) : 0));

  // ---- B. 腳 ----
  if (legged) {
    // 身體位移換到腳部群組的座標（腳掌要留在原地，所以目標點要扣掉）
    const oxL = bx * cL - bz * sL, ozL = bx * sL + bz * cL;
    const pg = M.parts.legs.g;
    pg.position.set(oxL, by, ozL);
    // 前進方向（腳的座標）
    const dLx = vx * cL - vz * sL, dLz = vx * sL + vz * cL, dl = Math.hypot(dLx, dLz);
    const ux = dl > 0.2 ? dLx / dl : 0, uz = dl > 0.2 ? dLz / dl : 1;
    const bLx = A.bdx * cL - A.bdz * sL, bLz = A.bdx * sL + A.bdz * cL;   // 煞車前的前進方向（腳的座標）
    for (let i = 0; i < 2; i++) {
      const Lg = R.legs[i], g = A.legs[i];
      const p = A.pp[i], duty = A.dd[i], reach = A.rr[i], isBad = i === bad;
      const stride = Math.min(sp * duty * cyc, reach) * gait;
      let s, lift = 0, fp = 0, out = 0;
      if (p < duty) {
        const u = p / duty;
        s = 0.5 - u;
        fp = u < 0.2 ? -0.4 * (1 - u / 0.2) : u > 0.7 ? 0.5 * (u - 0.7) / 0.3 : 0;   // 腳跟先著地 → 平 → 腳跟離地
      } else {
        const q = (p - duty) / (1 - duty);
        // 擺動：離地和落地那一瞬間，腳掌的速度要接上支撐期（相對身體往後 = 相對地面不動），不然一著地就滑一下
        //   所以腳會先往後多甩一點、落地前先往回收（跑步的腿就是這樣）；甩的量有上限，太快時不硬接
        const kq = Math.min(2.4, (1 - duty) / duty), q2 = q * q, q3 = q2 * q;
        s = (2 * q3 - 3 * q2 + 1) * -0.5 + (q3 - 2 * q2 + q) * -kq + (-2 * q3 + 3 * q2) * 0.5 + (q3 - q2) * -kq;
        lift = Math.sin(Math.PI * Math.pow(q, 0.8)) * lerp(0.2, 0.11, h) * g.len * (0.45 + 0.55 * Math.min(1, spK));
        fp = 0.5 * Math.cos(Math.PI * q);   // 腳尖朝下拖著離地 → 腳尖翹起來準備落地
        // 跛行：壞腳抬不高，膝蓋彎不太動 → 往外畫半圈甩過去
        if (isBad) { lift *= 1 - 0.6 * limp; out = sxB * limp * 0.1 * g.len * Math.sin(Math.PI * q) * gait; }
      }
      const amp = gait * Math.min(1, stride / (0.35 * g.len));
      fp *= amp * (1 - A.bw); lift *= gait * (1 - A.bw);   // 急停時不再跨步：腳直接踏住
      // 急停：一隻腳往前踏住（腳跟先頂住、腳尖翹起），另一隻留在身體下面偏後
      const lead = i === A.lead, brace = skid * g.len * (lead ? 0.42 : -0.07);
      if (lead) { lift += 0.09 * g.len * 4 * A.bw * (1 - A.bw) * (A.bk > 0.4 ? 1 : 0); fp -= 0.28 * skid; }
      const sd = s * stride * (1 - A.bw);
      let X = ux * sd + bLx * brace + out - oxL;
      let Z = g.az + uz * sd + bLz * brace - ozL, Y = g.ay - by + lift;
      // 拖行：壞腳不跨步了，伸直拖在後面（好腳撐的時候被拉近一點、好腳離地時又落在後面），腳尖朝下刮地
      if (isBad && drag > 0.001) {
        const back = -(0.12 + gait * (0.2 + 0.07 * Math.cos(TAU * A.pp[1 - bad]))) * g.len;
        X = lerp(X, bLx * back + sxB * 0.05 * g.len - oxL, drag);
        Z = lerp(Z, g.az + bLz * back - ozL, drag);
        Y = lerp(Y, g.ay - by, drag);
        fp = lerp(fp, 0.12 + 0.4 * gait, drag);
      }
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
  const cw = Math.cos(A.ph);
  for (const slot of ['armL', 'armR']) {
    const p = m.parts[slot], Ar = R.arms[slot];
    if (!p || !Ar) continue;
    const a = A.arms[slot], side = slot === 'armL' ? 1 : -1, gun = m.guns?.[slot], def = gun?.def;
    // 手臂受損：放鬆時垂得更低、一直發抖
    const dm = p.broken ? 0 : dmgOf(p), shake = dm * 0.014 * Math.sin(now * 31 + A.seed * 40 + side);
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
    // 軀幹駝著的時候，舉槍的手臂往上補回來（槍口還是朝前）
    p.g.rotation.x = 0.5 * e + relax * (0.06 + swing + 0.1 * dm) + a.kick.x - hunch * 0.085 * a.aim * (1 - e);
    p.g.rotation.z = side * (0.12 * e + 0.04 * relax);
    Ar.elbow.rotation.x = 0.5 * e + relax * (0.3 + 0.25 * dm + Math.max(0, -swing) * 0.8) + e * swing * 0.5 + shake;
  }
  return true;
}
