// ---------- 飛彈指揮官 missileer（beta 個性機體 3） ----------
// 垂直飛彈 + 直射飛彈（背部，平常一直架著）、手臂只拿來近身防禦：
//   站在「少數敵人看得到我」的掩體邊，跟最近的敵人保持 ~11 格，鎖上就雙發齊射（飽和攻擊）；
//   長距鎖定頭隔著牆也鎖得到 → 躲在柱子後面用垂直飛彈越過牆打；被逼近就往後退、換手臂武器頂住
//   - 鎖定（brainapi）：只鎖最近的那台；鎖定進度不會因為換目標歸零，看不到（沒有隔牆鎖定）會往回掉
//   - 垂直飛彈：先往上飛再追蹤落下（越過掩體）、要鎖定；直射飛彈：鎖上才追蹤，8 格內不用鎖也打
//   - 不用能量開火 → 推進都拿來閃（連雜魚的小飛彈也閃）
// 意圖（note）：鎖定中 / 齊射 / 掩體後垂直發射 / 換位置 / 拉開 / 近身防禦 / 閃
import { ok, slotOf, unit, crowd, bestDir, dodge, seekLos, foeKind, losTo, zoneAt, TAU } from './lib-beta.js';

const T = {
  KEEP: 11,        // 跟最近敵人想保持的距離
  CLOSE: 6,        // 最近的敵人比這近 → 換手臂武器
  COVER: 1,        // 掩體分數：每台看得到那個點的遠程敵人扣分
  LIGHT: 1,        // 小飛彈也閃
};

const MSL = new Set(['missile', 'vmissile', 'split', 'rocket']);

export default {
  name: 'missileer',
  init(mem) { mem.spot = null; mem.spotT = 0; mem.strafe = Math.random() < 0.5 ? 1 : -1; mem.flip = 1; },
  think(o, mem, api) {
    const { me } = o, W = me.weapons, dt = o.dt;
    const E = o.enemies, nearest = E[0] ?? o.foe;
    const notes = [];
    if ((mem.flip -= dt) <= 0) { mem.flip = 0.8 + Math.random() * 1.2; if (Math.random() < 0.5) mem.strafe *= -1; }
    const C = crowd(o, 16);
    const nlos = losTo(api, me, nearest.x, nearest.z);

    // ---- 每一邊：背部飛彈還是手臂 ----
    const back = {};
    // 近身（有遲滯：換武器一次 0.3 秒，不要在門檻附近一直換）
    if (mem.close && (nearest.dist > T.CLOSE + 2.5 || !nlos)) mem.close = false;
    else if (!mem.close && nearest.dist < T.CLOSE && nlos) mem.close = true;
    const close = mem.close;
    for (const side of ['L', 'R']) {
      const bk = 'back' + side, arm = 'arm' + side;
      const hasB = ok(W, bk) && MSL.has(W[bk].kind), hasA = ok(W, arm);
      if (!hasB) back[side] = false;
      else if (!hasA) back[side] = true;
      else back[side] = !(close && (W[bk].kind === 'vmissile' || W[bk].kind === 'split' || W[bk].kind === 'missile' && nearest.dist < 4));
    }

    // ---- 瞄準：手臂打最近的（照彈速預判）；飛彈追蹤，瞄現在位置就好 ----
    let aimYaw = Math.atan2(nearest.x - me.x, nearest.z - me.z);
    const armSlot = ['R', 'L'].map(sd => slotOf(me, sd)).find(s => s.startsWith('arm') && ok(W, s));
    if (armSlot && W[armSlot].speed) aimYaw = api.leadYaw(armSlot);
    const aligned = Math.abs(api.angleDiff(me.yaw, aimYaw));

    // ---- 開火 ----
    const fire = {};
    let salvo = 0;
    for (const side of ['L', 'R']) {
      const s = slotOf(me, side), w = W[s];
      if (!ok(W, s) || !w.live || me.deploying[side]) continue;
      if (w.kind === 'vmissile') { if (o.lock.locked && o.dist > 4) { fire[side] = true; salvo++; } continue; }
      if (w.kind === 'missile' || w.kind === 'split') { if ((o.lock.locked || o.dist < 8) && o.lineClear[s] !== false && nlos) { fire[side] = true; salvo++; } continue; }
      if (w.kind === 'rocket') { if (nlos && o.dist < 14 && aligned < 0.1 && (o.foe.staggered || o.dist < 8)) fire[side] = true; continue; }
      const tol = w.id === 'shotgun' ? 0.2 : 0.12;
      if (nlos && o.lineClear[s] && o.dist < w.range && aligned < tol) fire[side] = true;
    }
    if (salvo >= 2) notes.push(nlos ? '齊射' : '掩體後垂直發射');
    else if (salvo === 1 && !nlos) notes.push('掩體後垂直發射');
    else if (!o.lock.locked && o.lock.wants && o.lock.progress > 0.05) notes.push('鎖定中');

    // ---- 移動：找掩體邊的點（少數遠程看得到、跟最近的敵人 KEEP 格、在鎖定距離內） ----
    let mx = 0, mz = 0, state;
    const visCount = (qx, qz) => {
      let n = 0;
      for (const e of E) {
        if (e.dist > 28) break;
        const u = unit(e.x - qx, e.z - qz);
        if (u.l < 24 && api.rayBlock(qx, qz, u.x, u.z, u.l) >= u.l - 0.9) n += foeKind(e) === 'ranged' ? 1 : 0.3;
      }
      return n;
    };
    const lockR = o.lock.range;
    if ((mem.spotT -= dt) <= 0 || !mem.spot) {
      mem.spotT = 0.35;
      let best = null, bs = -1e9;
      for (const r of [0, 2.5, 5]) for (let i = 0; i < (r ? 16 : 1); i++) {
        const a = i / 16 * TAU, ux = Math.sin(a), uz = Math.cos(a);
        if (r && api.clearAhead(ux, uz, r + 0.8) < r + 0.5) continue;
        const qx = me.x + ux * r, qz = me.z + uz * r;
        let nd = 99, ne = null; for (const e of E) { const d = Math.hypot(e.x - qx, e.z - qz); if (d < nd) { nd = d; ne = e; } }
        let s = -visCount(qx, qz) * T.COVER - r * 0.1;
        s -= Math.abs(nd - T.KEEP) * (nd < T.KEEP ? 0.6 : 0.25);
        if (nd > lockR - 1) s -= (nd - lockR + 1) * 0.8;                  // 鎖不到
        if (ne && !me.hp.head?.broken && o.lock.range < 30 && !losTo(api, { x: qx, z: qz }, ne.x, ne.z)) s -= 2;   // 不能隔牆鎖定的頭：要看得到
        if (zoneAt(o, qx, qz)) s -= 3;
        // 牆角 / 退路：周圍空間太小扣分（被逼近會卡住）
        if (api.rayBlock(qx, qz, -C.ux, -C.uz, 4) < 3) s -= 1;
        if (mem.spot && Math.hypot(qx - mem.spot.x, qz - mem.spot.z) < 1.5) s += 0.4;
        if (s > bs) { bs = s; best = { x: qx, z: qz }; }
      }
      mem.spot = best;
    }
    if (close) {
      state = '拉開';
      const b = bestDir(api, (ux, uz, c) => {
        let s = -(ux * C.ux + uz * C.uz) * 2 + c * 0.35;
        for (const e of E) { if (e.dist > 10) break; const al = ((e.x - me.x) * ux + (e.z - me.z) * uz) / e.dist; if (al > 0.4) s -= al * 5 / e.dist; }
        if (zoneAt(o, me.x + ux * 2, me.z + uz * 2)) s -= 3;
        return s;
      }, 4);
      if (b) { mx = b.x; mz = b.z; }
      if (fire.L || fire.R) notes.push('近身防禦');
    } else if (mem.spot) {
      const u = unit(mem.spot.x - me.x, mem.spot.z - me.z);
      if (u.l > 0.6) { const k = Math.min(1, u.l / 1.5); mx = u.x * k; mz = u.z * k; state = '換位置'; }
      else { mx = -C.uz * mem.strafe * 0.6; mz = C.ux * mem.strafe * 0.6; state = nlos ? '轟炸' : '掩體待命'; }
    }
    ({ mx, mz } = api.steer(mx, mz));

    // ---- 閃 ----
    const boost = dodge(o, api, mem, { minE: 30, light: !!T.LIGHT });
    if (boost) notes.push('閃');

    return { move: { x: mx, z: mz }, aimYaw, fire, back, boost, note: notes.length ? notes.join('・') : state };
  },
};
