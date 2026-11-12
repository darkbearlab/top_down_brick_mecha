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
//   E. 事件（階段 3）：都是「推彈簧一下 + 換一個腳的姿勢」，恢復多快跟著重量走。
//      失衡：上半身被打向 stagDir、手臂甩開，靠那邊的腳往那個方向踏出去撐住（跟急停同一套踏步，方向不同）。
//        有腳的不再整台像木板一樣歪（poseMech 的 root 傾斜在這裡歸零）；履帶、懸浮照舊。
//      撞牆卡住：撞上去的瞬間上半身往牆栽、蹲下去，卡住期間一下一下往外掙。
//      推進：噴射中往前壓、兩腳離地收在後面；噴完（或速度掉回來）腳才放下，落地沉一下。被撞飛超速時也是腳離地。
//      空投：下墜中腳微彎懸著、手臂張開；落地深蹲、重的蹲得深、起來得慢。
//   F. 近戰（階段 4）：全身一起動。出招的時間點全照遊戲邏輯（m.swing / m.punch / m.charge），這裡只擺姿勢。
//      共通：上半身扭腰（只轉畫面上的上半身，m.torsoYaw 不動；頭轉回來看前面）、一隻腳踏出去撐住、身體壓低。
//      光束劍：握法 = 劍柄握在拳頭裡，刀身跟前臂不再是一直線（手腕可以轉）。平常是「脇構」：劍收在身體外側後方、刀尖朝後下。
//        揮法 = 由外側下方往內側上方斜斬上去（逆袈裟），同側的腳踏出去；斬完刀停在內側高處定住一拍（殘心），再從頭上繞回架式。
//        手用兩節 IK 追「手的位置」，刀身另外對準「刀的方向」；俯視時刀掃過的角度跟判定的扇形（外 → 內）對得上。
//      打樁拳：蓄力時拳頭收到身後、上半身往後扭、對側的腳在前；出拳瞬間扭腰整隻手臂打直，定住，再慢慢收回。
//      騎槍：點火時槍收在腋下、蹲低往後坐；衝刺時槍往前挺直、肩膀送出去；衝完定住一下再收。
import * as THREE from 'three';
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
const RAD = Math.PI / 180, SLOTS = ['armL', 'armR'];
// 向量計算用的暫存（Vector3 / Matrix4 / Quaternion 的建構不吃亂數；Group / Mesh 才會）
const _h = new THREE.Vector3(), _e = new THREE.Vector3(), _pl = new THREE.Vector3(), _u = new THREE.Vector3(), _f = new THREE.Vector3(), _n = new THREE.Vector3();
const _x = new THREE.Vector3(), _t = new THREE.Vector3(), _b = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), Z1 = new THREE.Vector3(0, 0, 1);

// 手臂的幾何（手臂群組的座標）：S 肩關節（上臂頂端往下一點；手臂群組的原點在前臂的高度，要繞肩膀轉得自己算位移）
//   la / lb 上臂、前臂長；n0 靜止時手肘彎的那個平面的法線、al0 靜止時彎幾度；M0 把靜止的上臂座標轉回標準座標；base 手臂群組原本的位置
function armGeo(Ar, blade) {
  let top = -Infinity;
  for (const c of Ar.shoulder.children) if (c.isMesh) { c.geometry.computeBoundingBox(); top = Math.max(top, c.geometry.boundingBox.max.y + c.position.y); }
  const E = Ar.elbowP, H = Ar.handP;
  if (!(top > E.y + 0.1)) top = E.y + 0.5;
  const S = new THREE.Vector3(E.x, top - 0.2 * (top - E.y), E.z);
  const u0 = E.clone().sub(S), f0 = H.clone().sub(E), la = u0.length(), lb = f0.length();
  if (!(la > 0.05 && lb > 0.05)) return null;
  u0.normalize(); f0.normalize();
  const n0 = u0.clone().cross(f0);
  if (n0.lengthSq() < 1e-6) n0.set(-1, 0, 0);
  n0.normalize();
  const g = { S, la, lb, n0, al0: Math.acos(clamp(u0.dot(f0), -1, 1)), M0: new THREE.Matrix4().makeBasis(u0, n0, u0.clone().cross(n0)).transpose(), base: Ar.shoulder.position.clone(), blade: null };
  // 光束劍的刀身：piv = 劍柄（前臂群組的座標）、len = 刀長
  if (blade) { const len = blade.children[0]?.geometry.parameters?.depth ?? 1; g.blade = { g: blade, len, piv: blade.position.clone().setZ(blade.position.z - len / 2 - 0.06) }; }
  return g;
}
// 兩節 IK：手（相對肩膀、上半身的座標）要到 (hx, hy, hz)，手肘往 (px, py, pz) 那邊凸。設好肩、肘的旋轉，肩膀留在原地
function armIK(Ar, g, hx, hy, hz, px, py, pz) {
  _h.set(hx, hy, hz);
  const d0 = _h.length() || 1e-3, d = clamp(d0, Math.abs(g.la - g.lb) + 0.02, (g.la + g.lb) * 0.995);
  _t.copy(_h).divideScalar(d0); _h.copy(_t).multiplyScalar(d);
  _pl.set(px, py, pz).addScaledVector(_t, -(_t.x * px + _t.y * py + _t.z * pz));
  if (_pl.lengthSq() < 1e-6) _pl.set(0, -1, 0).addScaledVector(_t, _t.y);
  _pl.normalize();
  const x = (g.la * g.la - g.lb * g.lb + d * d) / (2 * d), r = Math.sqrt(Math.max(0, g.la * g.la - x * x));
  _e.copy(_t).multiplyScalar(x).addScaledVector(_pl, r);
  _u.copy(_e).divideScalar(g.la); _f.copy(_h).sub(_e).divideScalar(g.lb);
  _n.copy(_u).cross(_f);
  if (_n.lengthSq() < 1e-6) _n.copy(_pl).cross(_t);
  _n.normalize();
  _x.copy(_u).cross(_n);
  Ar.shoulder.quaternion.setFromRotationMatrix(_m.makeBasis(_u, _n, _x).multiply(g.M0));
  Ar.elbow.quaternion.setFromAxisAngle(g.n0, Math.acos(clamp(_u.dot(_f), -1, 1)) - g.al0);
  Ar.shoulder.position.copy(g.S).applyQuaternion(Ar.shoulder.quaternion).negate().add(g.S).add(g.base);
}

// 光束劍的姿勢 = [刀尖在機體的哪個方位（度；繞機體中心算，跟判定的扇形同一個算法；0 = 正前、正 = 拿劍那一側的外面）、刀尖的仰角（度）、手的位置（往外、往上、往前；相對肩膀，單位 = 手臂全長 0.88 時的格數）、扭腰（正 = 拿劍的肩膀往後收）]
const SK0 = [130, -18, 0.16, -0.50, -0.08, 0.12];   // 脇構：劍在外側後方、刀尖朝後下
const SK1 = [44, -8, 0.42, -0.40, 0.22, 0.42];      // 起刀：刀甩到外側前方的低處（44 度 = 判定的扇形在這個時間點的角度）
const SK2 = [-75, 30, -0.12, -0.04, 0.50, -0.45];   // 斬完：刀在內側前方的高處
const SK3 = [-80, 38, -0.20, 0.06, 0.36, -0.50];   // 殘心：順勢再帶過去一點，定住
const SAB_R = 1.9, SAB_HOLD = 0.1, SAB_RET = 0.22, PILE_HOLD = 0.3, PILE_RET = 0.5, LANCE_HOLD = 0.2, LANCE_RET = 0.45;
const mix = (o, a, b, k) => { for (let i = 0; i < 6; i++) o[i] = a[i] + (b[i] - a[i]) * k; };
function saberPose(a) {
  const o = a.pose;
  if (a.mph === 1) { const p = a.mp; if (p < 0.15) mix(o, a.from, SK1, smooth(p / 0.15)); else mix(o, SK1, SK2, (p - 0.15) / 0.85); }
  else if (a.mph === 2) {
    if (a.mt < SAB_HOLD) mix(o, SK2, SK3, 1 - Math.exp(-a.mt / 0.035));
    else {
      // 收刀：從頭上繞回外側（不能走最短的路，那會穿過自己的身體）
      const u = smooth(Math.min(1, (a.mt - SAB_HOLD) / SAB_RET)), bump = Math.sin(Math.PI * u);
      mix(o, SK3, SK0, u); o[1] += 26 * bump; o[3] += 0.1 * bump; o[4] += 0.08 * bump;
    }
  } else mix(o, SK0, SK0, 0);
}
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
    // 事件：pst / pstk 上一幀的失衡 / 卡住時間（抓「剛發生」）、stg 失衡中、bks 踏步時上半身往哪邊（1 = 往後坐、負 = 倒向踏的方向）
    //   jet 推進中（腳離地）、air 空投下墜中、land 落地後的深蹲（1 → 0）、fl 手臂甩開（1 → 0）
    pst: 0, pstk: 0, stg: 0, bks: 1, jet: 0, pjet: false, air: 0, pair: false, land: 0, fl: 0,
    legs: R.legs.map(L => legGeo(L, type)),
    // 近戰：tw 上半身扭腰（畫面上的，已平滑）、mF 往前壓、mS 蹲低、mk 剛出過招（腳還踏著，不算騰空）、mAct 出招中
    tw: 0, mF: 0, mS: 0, mk: 0, mAct: false,
    arms: Object.fromEntries(SLOTS.map(s => [s, {
      aim: 1, hold: 0, pcd: 0, kick: S0(),
      // geo 手臂的幾何（沒有關節的 = null）；mph 近戰的階段（0 = 沒事）、mt 這個階段過了幾秒、mp 揮劍的進度、th 整隻手臂往後收（正）/ 往前挺（負）
      geo: R.arms[s] ? armGeo(R.arms[s], m.model.weapons?.[s]?.blade) : null, mph: 0, mt: 0, mp: 0, th: 0, pose: SK0.slice(), from: SK0.slice(),
    }])),
  };
}

export function animMech(m, dt, air = false) {
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
  const ty = m.torsoYaw, ly = m.legYaw, sT = Math.sin(ty), cT = Math.cos(ty), sL = Math.sin(ly), cL = Math.cos(ly);
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
    const stT = m.staggerT > 0 ? m.staggerT : 0;
    if (sp > 0.2 && !stT && !A.mAct) { A.bdx = vx / sp; A.bdz = vz / sp; }
    // 損傷等級（平滑過：剛跨過門檻時不會瞬間換姿勢）
    const P = m.parts, fd = 1 - Math.exp(-5 * adt);
    A.limp += ((A.legged ? dmgOf(P.legs) : 0) - A.limp) * fd;
    A.drag += ((A.legged && P.legs?.broken ? 1 : 0) - A.drag) * fd;
    A.hunch += (dmgOf(P.torso) - A.hunch) * (1 - Math.exp(-3 * adt));
    A.tilt += (((P.armR?.broken ? 1 : 0) - (P.armL?.broken ? 1 : 0)) - A.tilt) * fd;
    if (A.wasWalk && !driving && sp > 0.3 * vmax) {
      A.bk = 1; A.bks = 1; A.lead = A.limp > 0.3 ? 1 - A.bad : frac(A.ph / TAU) > frac(A.ph / TAU + 0.5) ? 0 : 1;   // 腳受損：用好的那隻踏
      A.y.v -= lerp(0.45, 0.9, h);   // 踏下去那一下
      const jb = lerp(1.6, 1.1, h); A.lx.v -= A.bdx * jb; A.lz.v -= A.bdz * jb;   // 上半身馬上往後收
    }
    if (driving) A.bk = 0;
    // 失衡：剛被打歪的那一幀 → 上半身被打過去、靠那邊的腳往那個方向踏出去撐住
    if (stT > A.pst + 1e-3) {
      const d = m.stagDir ?? { x: 0, z: 1 }, j = lerp(3.2, 2.2, h);
      A.lx.v += d.x * j; A.lz.v += d.z * j; A.y.v -= 0.5; A.fl = 1;
      if (A.legged) {
        const dLx = d.x * Math.cos(m.legYaw) - d.z * Math.sin(m.legYaw);
        A.bk = 1; A.bks = -2; A.bdx = d.x; A.bdz = d.z;
        A.lead = A.limp > 0.3 ? 1 - A.bad : Math.abs(dLx) > 0.3 ? (Math.sign(dLx) === Math.sign(R.legs[0].hipP.x) ? 0 : 1) : A.lead;
      }
    }
    A.pst = stT;
    if (stT && A.legged) A.bk = Math.max(A.bk, 0.6);
    A.stg += ((stT ? 1 : 0) - A.stg) * (1 - Math.exp(-(stT ? 25 : 5) * adt));
    // 撞牆卡住：撞上去的瞬間往牆栽（stuckN 是牆面朝外的方向）
    const sk = m.stuckT > 0 ? m.stuckT : 0;
    if (sk > A.pstk + 1e-3) {
      const hit = m.stuckHit ?? 0.5, N = m.stuckN ?? { x: 0, z: 0 };
      A.lx.v -= N.x * 4.5 * hit; A.lz.v -= N.z * 4.5 * hit; A.y.v -= 0.7 * hit; A.fl = Math.max(A.fl, 0.6 * hit);
    }
    A.pstk = sk;
    // 近戰：每隻手臂照武器走自己的階段；加總出扭腰、前壓、蹲低，還有腳要不要踏住
    let twT = 0, mF = 0, mS = 0, mAct = false, snap = false;
    for (const slot of SLOTS) {
      const a = A.arms[slot], kind = m.guns?.[slot]?.def?.kind, side = slot === 'armL' ? 1 : -1;
      if (!a.geo || !m.parts[slot] || m.parts[slot].broken || stT) { a.mph = 0; a.th *= Math.exp(-10 * adt); continue; }
      const sameLeg = A.legged && Math.sign(R.legs[0].hipP.x) === side ? 0 : 1;
      // 踏一步撐住：lead = 哪隻腳在前、bks = 上半身往後坐（正）還是壓上去（負）；方向 = 上半身朝的方向
      const stepIn = (lead, bks) => { A.bdx = sT; A.bdz = cT; if (A.legged) { A.bk = 1; A.bks = bks; A.lead = A.limp > 0.3 ? 1 - A.bad : lead; } };
      let tw = 0;
      if (kind === 'saber') {
        const sw = m.swing?.slot === slot ? m.swing : null;
        if (sw) {
          if (a.mph !== 1) { a.mph = 1; a.from = a.pose.slice(); stepIn(sameLeg, -1); A.y.v -= lerp(0.7, 0.5, h); }
          a.mp = clamp(1 - sw.t / sw.dur, 0, 1); snap = true;
        } else if (a.mph === 1) { a.mph = 2; a.mt = 0; A.y.v += 0.45; }   // 斬上去的那一下，身體跟著起來
        else if (a.mph === 2 && (a.mt += adt) > SAB_HOLD + SAB_RET) a.mph = 0;
        saberPose(a);
        tw = a.pose[5];
        if (a.mph === 1) { mF += 0.1; mS += 0.09 * (1 - 0.7 * a.mp); mAct = true; }
        else if (a.mph === 2) { const r = a.mt < SAB_HOLD ? 1 : 1 - smooth(Math.min(1, (a.mt - SAB_HOLD) / SAB_RET)); mF += 0.08 * r; mS += 0.03 * r; mAct ||= a.mt < SAB_HOLD; }
      } else if (kind === 'pile') {
        const P = m.punch?.slot === slot ? m.punch : null;
        if (P) { if (a.mph !== 1) { a.mph = 1; a.mt = 0; stepIn(1 - sameLeg, 1); A.y.v -= 0.4; } a.mt += adt; }
        else if (a.mph === 1) {
          // 出拳：整台壓上去；樁打出去的後座力回在手臂上
          a.mph = 2; a.mt = 0; A.bks = -1.5;
          const j = lerp(2.2, 1.5, h); A.lx.v += sT * j; A.lz.v += cT * j; A.y.v -= 0.5; a.kick.v += 5;
        } else if (a.mph === 2 && (a.mt += adt) > PILE_HOLD + PILE_RET) a.mph = 0;
        if (a.mph === 1) { const u = smooth(Math.min(1, a.mt / 0.1)); a.th = 0.75 * u; tw = 0.45 * u; mS += 0.06 * u; mF -= 0.03 * u; mAct = true; }
        else if (a.mph === 2) {
          const ext = 1 - Math.exp(-a.mt / 0.02), r = a.mt < PILE_HOLD ? 1 : 1 - smooth(Math.min(1, (a.mt - PILE_HOLD) / PILE_RET));
          a.th = lerp(0.75, -1, ext) * r; tw = lerp(0.45, -0.45, ext) * r; mF += 0.1 * r; mS += 0.04 * r;
          if (a.mt < PILE_HOLD) mAct = true;
          snap ||= a.mt < 0.1;
        } else a.th = 0;
      } else if (kind === 'lance') {
        const cp = m.charge?.slot === slot ? m.charge.phase : null;
        if (cp === 'ignite') { if (a.mph !== 1) { a.mph = 1; a.mt = 0; stepIn(1 - sameLeg, 1); A.y.v -= 0.5; } a.mt += adt; }
        else if (cp) { if (a.mph !== 2) { a.mph = 2; a.mt = 0; } a.mt += adt; }
        else if (a.mph === 1 || a.mph === 2) { a.mph = 3; a.mt = 0; }
        else if (a.mph === 3 && (a.mt += adt) > LANCE_HOLD + LANCE_RET) a.mph = 0;
        if (a.mph === 1) { const u = smooth(Math.min(1, a.mt / 0.1)); a.th = 0.55 * u; tw = 0.35 * u; mS += 0.08 * u; mF -= 0.05 * u; mAct = true; }
        else if (a.mph === 2) { const ext = 1 - Math.exp(-a.mt / 0.03); a.th = lerp(0.55, -0.8, ext); tw = lerp(0.35, -0.35, ext); mF += 0.08; snap ||= a.mt < 0.12; }
        else if (a.mph === 3) { const r = a.mt < LANCE_HOLD ? 1 : 1 - smooth(Math.min(1, (a.mt - LANCE_HOLD) / LANCE_RET)); a.th = -0.8 * r; tw = -0.35 * r; mF += 0.05 * r; }
        else a.th = 0;
      } else { a.mph = 0; a.th = 0; }
      // 另一隻手剛開過火：少扭一點（槍口的位置是照沒扭的上半身算的）
      twT += side * tw * (A.arms[slot === 'armL' ? 'armR' : 'armL'].hold > 0 ? 0.4 : 1);
    }
    A.mAct = mAct;
    if (mAct && A.legged) A.bk = Math.max(A.bk, 0.6);
    A.mk = mAct ? 1 : Math.max(0, A.mk - adt / 0.5);
    A.tw += (twT - A.tw) * (1 - Math.exp(-(snap ? 60 : 11) * adt));
    A.mF += (mF - A.mF) * (1 - Math.exp(-22 * adt));
    A.mS += (mS - A.mS) * (1 - Math.exp(-22 * adt));
    // 推進 / 騎槍衝刺：腳離地；噴完之後還超速（或被撞飛）的時候腳也還沒踩回去
    const jetOn = m.boostT > 0 || m.charge?.phase === 'dash';
    const jetT = jetOn ? 1 : A.legged ? clamp((sp / vmax - 1.15) / 0.4, 0, 1) * (1 - A.mk) : 0;   // 近戰的突進：腳是踏著滑出去的，不算騰空
    A.jet += (jetT - A.jet) * (1 - Math.exp(-(jetT > A.jet ? 30 : 9) * adt));
    if (jetOn && !A.pjet) A.y.v += 0.6;                             // 點火：整台往上浮一下
    if (!jetOn && A.pjet) A.y.v -= lerp(0.7, 1.2, h);               // 噴完落地
    A.pjet = jetOn;
    // 空投：下墜中 → 落地
    if (!air && A.pair) { A.land = 1; A.y.v -= lerp(2.0, 2.8, h); A.fl = Math.max(A.fl, 0.5); }
    A.pair = air;
    A.air += ((air ? 1 : 0) - A.air) * (1 - Math.exp(-(air ? 20 : 14) * adt));
    A.land = Math.max(0, A.land - adt / (0.45 + 0.5 * h));
    A.fl *= Math.exp(-(4.5 - 1.5 * h) * adt);
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

  // ---- A. 身體彈簧 ----
  // 上下：重的坐得低；跑起來要蹲低一點腿才跨得開；急停蹲下去
  // 卡住的程度（剛撞上最大、慢慢拔出來）
  const stk = m.stuckT > 0 ? clamp(m.stuckT / (m.stuckMax || 1), 0, 1) * (m.stuckHit ?? 0.5) : 0;
  const landK = smooth(A.land), offG = Math.max(A.jet, A.air);
  const sag0 = 0.05 * stk + 0.13 * landK - 0.05 * A.jet + A.mS + (legged ? 0.01 + 0.03 * h + 0.04 * A.over + skid * 0.07 + gait * (0.035 + 0.055 * Math.min(1, spK)) + 0.02 * limp + 0.02 * drag : 0.01 * h) + 0.03 * hunch;
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
  const tlt = 0.07 * A.tilt;
  // 事件加在傾斜上的：失衡時發抖、卡住時往外掙、推進時往前壓、落地時往前栽一點
  const sd = m.stagDir, sN = m.stuckN, shk = A.stg * 0.03 * Math.sin(now * 38), pull = stk * 0.06 * (0.5 + 0.5 * Math.sin(now * 10));
  const fwd = hunch * (0.085 + 0.012 * pant) + 0.08 * landK + A.mF;
  const exx = cL * lat + cT * tlt + sT * fwd + (sd ? sd.x * shk : 0) + (sN ? sN.x * pull : 0) + A.bdx * 0.2 * A.jet;
  const exz = -sL * lat - sT * tlt + cT * fwd + (sd ? sd.z * shk : 0) + (sN ? sN.z * pull : 0) + A.bdz * 0.2 * A.jet;
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
      spring(A.lx, dirx * leanV - A.bdx * back * A.bks + exx, w, A.z, sdt, A.ax * gain * w2);
      spring(A.lz, dirz * leanV - A.bdz * back * A.bks + exz, w, A.z, sdt, A.az * gain * w2);
    }
    const ll = Math.hypot(A.lx.x, A.lz.x), lMax = 0.3 + 0.12 * Math.max(A.stg, A.jet);
    if (ll > lMax) { A.lx.x *= lMax / ll; A.lz.x *= lMax / ll; }
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
  M.torsoG.rotation.set(pitch, ty + A.tw, roll + (legged ? Math.sin(A.ph - 0.35) * 0.035 * gait * (cL * cT + sL * sT) : 0));
  if (M.parts.head) M.parts.head.g.rotation.y = -0.85 * A.tw;   // 扭腰時頭還是看著前面

  // ---- B. 腳 ----
  if (legged) {
    if (M.root.rotation.x || M.root.rotation.z) M.root.rotation.set(0, 0, 0);   // 失衡：不整台歪，改由上半身和腳去表現
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
      const lead = i === A.lead, brace = skid * g.len * (lead ? 0.42 : -0.07 - 0.22 * A.mk);   // 近戰：後腳留在更後面（弓步）
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
      // 腳離地：推進 = 兩腳收在後面（一前一後）；空投下墜 = 微彎懸著
      if (offG > 0.001) {
        const jb = -(i ? 0.3 : 0.12) * g.len * A.jet, hang = (i ? -0.1 : 0.08) * g.len * A.air;
        X = lerp(X, bLx * jb - oxL, offG);
        Z = lerp(Z, g.az + bLz * jb + hang - ozL, offG);
        Y = lerp(Y, g.ay - by + (A.jet > A.air ? 0.17 : 0.13) * g.len, offG);
        fp = lerp(fp, 0.45, offG);
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
    const g = a.geo;
    // 光束劍：手追著姿勢表走（IK），刀身對準刀的方向
    if (g?.blade && def?.kind === 'saber' && !p.broken) {
      const o = a.pose, K = (g.la + g.lb) / 0.88, idle = a.mph ? 0 : 1;
      // 架式中：跑步時劍跟著步伐晃、手再往後收一點；手臂受損刀尖垂下去
      const th = (o[0] + idle * 5 * Math.sin(A.ph) * gait) * RAD + idle * 0.03 * Math.sin(now * 1.3 + A.seed * 5);
      const ph = (o[1] - 8 * dm) * RAD + idle * 0.03 * Math.sin(now * 1.7 + A.seed * 3) + shake * 3;
      const out = o[2] + 0.14 * A.fl + 0.1 * A.air, hy = o[3] + 0.1 * A.air - 0.04 * dm + idle * 0.012 * Math.sin(now * 1.7 + A.seed * 3), hz = o[4] - idle * 0.05 * gait - 0.08 * A.jet;
      // 姿勢表是照「沒扭腰的正面」寫的，轉進扭過的上半身座標
      const c = Math.cos(A.tw), s = Math.sin(A.tw), hx = side * out * K, cp = Math.cos(ph);
      // 刀的方向：從手指向「機體中心往 th 方位、SAB_R 格遠」的那一點（判定的扇形是繞機體中心掃的，手在肩膀外面，直接用 th 當刀的方向會偏外）
      const sx0 = g.base.x + g.S.x, sz0 = g.base.z + g.S.z, tx = side * Math.sin(th) * SAB_R - (sx0 * c + sz0 * s + hx), tz = Math.cos(th) * SAB_R - (-sx0 * s + sz0 * c + hz * K), tl = Math.hypot(tx, tz) || 1;
      const dx = tx / tl * cp, dz = tz / tl * cp;
      armIK(Ar, g, hx * c - hz * K * s, hy * K, hx * s + hz * K * c, side * 0.7, -0.5, -0.5);
      const B = g.blade;
      _q.copy(Ar.shoulder.quaternion).multiply(Ar.elbow.quaternion).invert();
      _b.set(dx * c - dz * s, Math.sin(ph), dx * s + dz * c).applyQuaternion(_q);
      B.g.quaternion.setFromUnitVectors(Z1, _b);
      B.g.position.copy(B.piv).addScaledVector(_b, B.len / 2 + 0.05);
      a.pcd = gun?.cd ?? 0; a.aim = 1;
      continue;
    }
    p.g.rotation.y *= Math.exp(-12 * adt);
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
      const busy = cd > 0 || a.hold > 0 || def?.kind === 'shield' || a.mph > 0 || m.punch?.slot === slot || m.charge?.slot === slot;
      a.aim += ((busy ? 1 : 0) - a.aim) * (1 - Math.exp(-(busy ? 30 : 3.5) * adt));
      spring(a.kick, 0, 24, 0.55, adt);
    }
    // 背部武器準備中：手臂垂下、往外張開一點（拿盾的手臂不放下）
    const e = def?.kind === 'shield' ? 0 : smooth(m.readyK[slot[3]]);
    // 放鬆：上臂微微後收、前臂垂低；走路時前後擺（跟同側的腳相反）
    const relax = (1 - a.aim) * (1 - e), swing = side * cw * lerp(0.16, 0.1, h) * gait;
    // 軀幹駝著的時候，舉槍的手臂往上補回來（槍口還是朝前）
    // 事件：失衡 / 撞牆 / 落地 → 手臂甩開；推進 → 往後收；下墜 → 張開（開火中的手臂照樣朝前）
    const loose = 1 - 0.75 * a.aim, fl = A.fl * loose;
    // 打樁拳 / 騎槍：th = 整隻手臂繞肩膀往後收（正）或往前挺（負），前臂反過來轉同樣的角度 → 武器一直朝正前
    const th = a.th;
    p.g.rotation.x = 0.5 * e + relax * (0.06 + swing + 0.1 * dm) + a.kick.x - hunch * 0.085 * a.aim * (1 - e) - 0.2 * fl + 0.25 * A.jet * loose + th;
    p.g.rotation.z = side * (0.12 * e + 0.04 * relax + 0.4 * fl + 0.28 * A.air * loose + 0.14 * Math.max(0, th));
    Ar.elbow.rotation.x = 0.5 * e + relax * (0.3 + 0.25 * dm + Math.max(0, -swing) * 0.8) + e * swing * 0.5 + shake + 0.5 * fl + 0.35 * A.air * loose - th;
    // 這兩種武器的手臂改成繞肩膀轉（原本是繞手臂群組的原點 = 前臂的高度，拳頭伸不出去）
    if (g && (def?.kind === 'pile' || def?.kind === 'lance')) p.g.position.copy(g.S).applyEuler(p.g.rotation).negate().add(g.S).add(g.base);
  }
  return true;
}
