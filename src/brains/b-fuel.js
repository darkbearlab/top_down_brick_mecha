// ---------- 油龍 b-fuel（beta：汽油投射器機體） ----------
// 雙汽油投射器 + 左背直射飛彈 + 右背火箭莢艙：射程內沒東西燒的時候兩邊背部一起架起來
//   （火箭打衝過來的近戰：化學 ×1.4 打複合 → 單發超過雙足失衡門檻；彈藥架版本見 NOTES）
// 想法：汽油投射器不是「近距離扇形」而是一條 10 格的火舌，只打第一台 → 不要一直黏同一台，
//   「輪流點火」：射程內的敵人每台燒一下（燃燒層數每部位最多 5 層、持續 3 秒，黏著同一台很快就滿了，多出來的只剩 2.4 直傷）
//   → 甩槍換目標的時候火舌自己甩出一道弧、沒打到的燃料飛到 10 格落地變油灘：剛好鋪在後面衝上來的敵人路上
//   距離：站在 6.5–9 格（雜魚的火焰噴射器 6 格、劍要貼身；射擊型想站 8 格 → 正好在火舌裡）
//   被近戰追：倒退噴（火舌一直對著追兵，牠一路吃燃燒）；自爆機：先燒（血很少）、太近就推進拉開
//   射程外（> 10 格）沒東西可燒：架背部飛彈 / 火箭打外圈的射手、還在路上的追兵
//   手臂換成火焰噴射器 / 機砲也能跑（控制組，比較武器用）
// 意圖（note）：點火 / 掃火（換目標）/ 倒退噴 / 飛彈 / 逼近 / 找路 / 閃 / 拉開
import { ok, slotOf, unit, crowd, bestDir, dodge, seekLos, foeKind, hpOf, losTo, zoneAt } from './lib-beta.js';

const T = {
  WANT: 7.6,       // 想跟目標保持的距離（最多到 火舌射程 − 1.2）
  MELEE_WANT: 6.2, // 近戰 / 衝鋒機：拉開到這個距離（雜魚 / 縱火犯的火焰噴射器 6 格 → 站在外面）
  DWELL: 0.55,     // 每台燒多久就換下一台（秒）
  REBURN: 2.0,     // 燒過的多久之後又值得回來補（燃燒 3 秒）
  SWEEP: 1,        // 1 = 輪流點火、0 = 一直打同一台（比較用）
  FIRE_ERR: 0.22,  // 上半身跟瞄準角度差多少以內才噴
  MSL_HOLD: 0.7,   // 射程內沒東西 → 架飛彈（秒，遲滯）
  MELB: 3.2,       // 近戰貼到幾格內推進拉開
  PRESS: 3,        // 5 格內 ≥ PRESS 台 → 後退
};
try { const env = globalThis.process?.env?.B_FUEL_T; if (env) Object.assign(T, JSON.parse(env)); } catch { /* 瀏覽器沒有 process */ }

const FUEL_SP = 24;
// 燃料飛到 (e) 要多久 → 預判點（射手的速度也會帶 0.4 進去，忽略）
function leadPt(me, e, sp = FUEL_SP) {
  let tx = e.x, tz = e.z;
  for (let i = 0; i < 3; i++) { const t = Math.hypot(tx - me.x, tz - me.z) / sp; tx = e.x + e.vx * t; tz = e.z + e.vz * t; }
  return { x: tx, z: tz };
}

export default {
  name: 'b-fuel',
  init(mem) { mem.strafe = Math.random() < 0.5 ? 1 : -1; mem.flip = 1.5; mem.burnt = {}; mem.cur = null; mem.dwell = 0; mem.mslHold = 0; },
  think(o, mem, api) {
    const { me } = o, W = me.weapons, dt = o.dt;
    const notes = [];
    const E = o.enemies, nearest = E[0] ?? o.foe;
    // 比較用（控制組）：手臂換成火焰噴射器 / 機砲之類，同一個大腦照樣開火
    const fuels = ['armL', 'armR'].filter(s => ok(W, s) && (W[s].kind === 'stream' || W[s].kind === 'flame' || W[s].kind === 'bullet'));
    // 比較用：換成火焰噴射器（6 格扇形）時距離整個縮短
    const fl = fuels.length && W[fuels[0]].kind === 'flame';
    const wr = fuels.length ? Math.min(W[fuels[0]].range + 0.3, 12) : 9.8;   // 火舌射程（obs 的 range = 武器 range − 0.5）
    const RANGE = fl ? 5.8 : wr, WANT = fl ? 4.3 : Math.min(T.WANT, wr - 1.2), MELEE_WANT = fl ? 3.8 : Math.min(T.MELEE_WANT, wr - 1.6);
    const C = crowd(o, 14);
    if ((mem.flip -= dt) <= 0) { mem.flip = 1 + Math.random() * 1.5; if (Math.random() < 0.4) mem.strafe *= -1; }

    // ---- 火舌目標：射程內、看得到的敵人；輪流點火 ----
    const inR = E.filter(e => e.dist < RANGE && losTo(api, me, e.x, e.z));
    const now = o.t;
    const score = e => {
      const k = foeKind(e);
      let s = 10 - e.dist;                                         // 近的先
      if (k === 'bomber') s += e.dist < 7 ? 8 : 3;                 // 自爆機：一燒就死，先處理
      if (k === 'melee' || k === 'rammer') s += 2;
      if (hpOf(e) < 40) s += 1.5;                                  // 快死的補掉
      const last = mem.burnt[e.id];
      if (T.SWEEP && last != null && now - last < T.REBURN) s -= 4; // 剛燒過（還在燒）→ 先燒別台
      // 甩槍成本：角度差大的扣一點
      s -= Math.abs(api.angleDiff(me.yaw, Math.atan2(e.x - me.x, e.z - me.z))) * 1.2;
      return s;
    };
    let cur = inR.find(e => e.id === mem.cur);
    mem.dwell -= dt;
    if (!cur || (T.SWEEP && mem.dwell <= 0 && inR.length > 1) || (cur && foeKind(cur) !== 'bomber' && inR.some(e => foeKind(e) === 'bomber' && e.dist < 6))) {
      let best = null, bs = -1e9;
      for (const e of inR) { const s = score(e) + (e.id === mem.cur && !(mem.dwell <= 0) ? 1 : 0); if (s > bs) { bs = s; best = e; } }
      if (best && best.id !== mem.cur) { mem.cur = best.id; mem.dwell = T.DWELL * (foeKind(best) === 'bomber' ? 2 : 1); if (cur) notes.push('掃火'); }
      cur = best;
    }
    if (cur) mem.burnt[cur.id] = now;

    // ---- 背部：射程內沒東西燒 → 架左背飛彈 ----
    const back = { L: false, R: false };
    const msls = ['backL', 'backR'].filter(s => ok(W, s) && (W[s].kind === 'missile' || W[s].kind === 'vmissile' || W[s].kind === 'rocket'));
    if (msls.length) {
      if (!cur && nearest.dist > RANGE + 0.5 || !fuels.length) mem.mslHold = T.MSL_HOLD; else mem.mslHold -= dt;
      for (const msl of msls) back[msl.slice(-1)] = mem.mslHold > 0 || !ok(W, 'arm' + msl.slice(-1));
    }

    // ---- 瞄準 / 開火 ----
    const fire = {};
    const tg = cur ?? nearest;
    const lp = cur ? leadPt(me, cur, fuels.length && W[fuels[0]].kind === 'bullet' ? W[fuels[0]].speed * 0.55 : FUEL_SP) : { x: tg.x, z: tg.z };
    const aimYaw = Math.atan2(lp.x - me.x, lp.z - me.z);
    const err = Math.abs(api.angleDiff(me.yaw, aimYaw));
    for (const side of ['L', 'R']) {
      const s = slotOf(me, side);
      if (!ok(W, s) || !W[s].live || me.deploying[side]) continue;
      if (fuels.includes(s) && cur && err < T.FIRE_ERR + Math.atan2(cur.r, cur.dist)) fire[side] = true;
      if (!fuels.includes(s) && (o.lock.locked || W[s].kind === 'rocket') && o.los) fire[side] = true;
    }
    const isF = side => fuels.includes(slotOf(me, side));
    if (fire.L && !isF('L') || fire.R && !isF('R')) notes.push('飛彈');
    else if (fire.L || fire.R) notes.push('點火');
    // 換目標的時候：火舌還在噴（甩出弧線），上半身轉過去途中照樣噴 —— 只要新目標也在射程內
    if (!fire.L && !fire.R && cur && err < 0.9 && T.SWEEP) for (const side of ['L', 'R']) { const s = slotOf(me, side); if (fuels.includes(s) && W[s].live && !me.deploying[side]) fire[side] = true; }

    // ---- 移動 ----
    let mx = 0, mz = 0, state;
    const tu = unit(tg.x - me.x, tg.z - me.z);
    const close = E.filter(e => e.dist < 5).length;
    const chaser = E.find(e => e.dist < WANT + 0.5 && (foeKind(e) === 'melee' || foeKind(e) === 'rammer' || foeKind(e) === 'bomber'));
    const avoid = (ux, uz) => (zoneAt(o, me.x + ux * 2, me.z + uz * 2) ? -3 : 0);
    if (close >= T.PRESS || C.wrap > 0.55 && close >= 2) {
      state = '後退';
      const b = bestDir(api, (ux, uz, c) => -(ux * C.ux + uz * C.uz) * 2 + c * 0.35 + avoid(ux, uz), 4);
      if (b) { mx = b.x; mz = b.z; }
    } else if (!losTo(api, me, tg.x, tg.z)) {
      state = '找路';
      const n = seekLos(o, api, mem, tg.x, tg.z, 1); mx = n.x; mz = n.z;
    } else {
      const want = chaser ? MELEE_WANT : WANT;
      const ref = chaser ?? tg;
      const ru = unit(ref.x - me.x, ref.z - me.z);
      const radial = ref === tg && !cur && tg.dist > RANGE ? 1 : ru.l > want + 1 ? 0.7 : ru.l < want - 1 ? -1 : 0;
      state = radial < 0 && chaser ? '倒退噴' : radial > 0 ? '逼近' : '繞圈';
      mx = ru.x * radial - ru.z * mem.strafe * 0.75; mz = ru.z * radial + ru.x * mem.strafe * 0.75;
      if (api.clearAhead(-ru.z * mem.strafe, ru.x * mem.strafe, 2.5) < 2) mem.strafe *= -1;
    }
    if (zoneAt(o, me.x + mx * 1.5, me.z + mz * 1.5)) { const b = bestDir(api, (ux, uz, c) => (ux * mx + uz * mz) + c * 0.2 - (zoneAt(o, me.x + ux * 2, me.z + uz * 2) ? 5 : 0), 3); if (b) { mx = b.x; mz = b.z; } }
    ({ mx, mz } = api.steer(mx, mz));

    // ---- 閃 / 拉開 ----
    let boost = dodge(o, api, mem, { minE: 30, light: true, lightE: 0 });
    if (!boost && T.MELB && me.canBoost && me.boostCd <= 0 && !me.boosting && me.energy >= 30) {
      const m = E.find(e => e.dist < T.MELB && (foeKind(e) === 'melee') && !e.staggered);
      if (m) {
        const u = unit(me.x - m.x, me.z - m.z);
        const b = bestDir(api, (ux, uz, c) => (ux * u.x + uz * u.z) * 2 - (ux * C.ux + uz * C.uz) + c * 0.3 + (zoneAt(o, me.x + ux * 3, me.z + uz * 3) ? -3 : 0), 5, 3);
        if (b) { boost = { x: b.x, z: b.z }; notes.push('拉開'); mem.pulled = true; }
      }
    }
    if (boost && !mem.pulled) notes.push('閃');
    mem.pulled = false;

    return { move: { x: mx, z: mz }, aimYaw, fire, back, boost, target: cur ? cur.id : null, note: notes.length ? notes.join('・') : state };
  },
};
