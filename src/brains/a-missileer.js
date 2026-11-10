// ---------- a-missileer 團隊版飛彈指揮官（alpha 2v2；從 beta 的 missileer 複製來改） ----------
// 團隊（有隊友時才開）：
//   - 跟隊友用同一套評分挑「集火」目標（act.target）→ 鎖定、飛彈都打它；敵人貼近隊友 → 「掩護」打那台
//   - 站位：鎖定距離算到集火目標；跟隊友對目標拉出夾角（交叉火網，牆擋不住兩邊）、彼此隔開（不吃同一發濺射）
//   - 隊友是騎士（騎槍）：當「鐵砧」→ 目標被騎槍撞到失衡就「趁失衡齊射」
// 沒隊友（雜魚關卡）→ 跟原版一樣
// 垂直飛彈 + 直射飛彈（背部，平常一直架著）、手臂只拿來近身防禦：
//   站在「少數敵人看得到我」的掩體邊，跟最近的敵人保持 ~11 格，鎖上就雙發齊射（飽和攻擊）；
//   長距鎖定頭隔著牆也鎖得到 → 躲在柱子後面用垂直飛彈越過牆打；被逼近就往後退、換手臂武器頂住
//   - 鎖定（brainapi）：只鎖最近的那台；鎖定進度不會因為換目標歸零，看不到（沒有隔牆鎖定）會往回掉
//   - 垂直飛彈：先往上飛再追蹤落下（越過掩體）、要鎖定；直射飛彈：鎖上才追蹤，8 格內不用鎖也打
//   - 不用能量開火 → 推進都拿來閃（連雜魚的小飛彈也閃）
// 意圖（note）：鎖定中 / 齊射 / 掩體後垂直發射 / 換位置 / 拉開 / 近身防禦 / 閃
import { ok, slotOf, unit, crowd, bestDir, dodge, seekLos, foeKind, losTo, zoneAt, TAU } from './lib-a-beta.js';
import { focusPick, crossAngle, teamNote } from './lib-a-team.js';

const T0 = {
  KEEP: 11,        // 跟最近敵人想保持的距離
  CLOSE: 6,        // 最近的敵人比這近 → 換手臂武器
  COVER: 1,        // 掩體分數：每台看得到那個點的遠程敵人扣分
  LIGHT: 1,        // 小飛彈也閃
  HOLD: +(globalThis.process?.env?.A_HOLD ?? 0),   // 趁破綻：直射飛彈最多壓幾秒（0 = 關；1.5 秒 28/80、0.8 秒 41/80、關 46/80 → 火力量比等破綻重要）
  VIS: +(globalThis.process?.env?.A_VIS ?? 1),     // 沒集火目標時先鎖看得到的
  PEEK: +(globalThis.process?.env?.A_PEEK ?? 1),   // 探頭鎖定：還沒鎖上時，看不到目標的點扣分
  B2B: 7,          // 背靠背：跟隊友最多隔幾格
  TOALLY: 1.2,     // 被貼身時往隊友那邊退
  PKEEP: +(globalThis.process?.env?.A_PKEEP ?? 7.5),   // 包夾收尾時的距離
  CROSS: +(globalThis.process?.env?.A_CROSS ?? 0.8),// 交叉火網：跟隊友對目標的夾角（弧度，最多算到 1.6）× 這個
};

const MSL = new Set(['missile', 'vmissile', 'split', 'rocket']);
const DIVE = new Set(['saber', 'pile', 'lance', 'flame']);
const isDiver = e => Object.values(e.weapons ?? {}).some(w => w && !w.broken && DIVE.has(w.kind));

export function makeMissileer(over = {}) {
  const T = { ...T0, ...over };
  return {
  name: over.name ?? 'a-missileer',
  init(mem) { mem.spot = null; mem.spotT = 0; mem.strafe = Math.random() < 0.5 ? 1 : -1; mem.flip = 1; },
  think(o, mem, api) {
    const { me } = o, W = me.weapons, dt = o.dt;
    const E = o.enemies, nearest = E[0] ?? o.foe;
    const notes = [];
    // ---- 團隊：集火目標 ----
    const F = focusPick(o, mem, { type: 'chemical' });
    const ally = o.allies?.[0];
    const tgt = F ? F.e : null;
    let tag = '';
    // 包夾收尾：只剩一台敵人、隊友還活著 → 縮短距離、跟隊友從兩邊夾（對手躲不了兩個方向）
    const pincer = !!(tgt && ally && o.enemies.length === 1);
    // 背靠背：對面有會貼身的（劍 / 樁 / 騎槍 / 噴火）→ 兩台靠在一起（誰被咬，另一台馬上打得到牠）、誘餌不往前站
    const divers = ally ? o.enemies.filter(isDiver) : [];
    const b2b = divers.length > 0 && !pincer;
    const KEEP = pincer ? T.PKEEP : (ally && !b2b && T.TKEEP) || T.KEEP;
    const COVER = (ally && !b2b && T.TCOVER != null) ? T.TCOVER : T.COVER;
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
      if (w.kind === 'missile' || w.kind === 'split') {
        if ((o.lock.locked || o.dist < 8) && o.lineClear[s] !== false && nlos) {
          // 趁破綻：有隊友時，對手推進得了（能量夠、沒冷卻）就先壓著（最多 HOLD 秒），等它閃完 / 沒能量 / 失衡再打
          const f = o.foe, open = f.staggered || !f.canBoost || f.energy < 30 || f.boostCd > 0.3 || o.dist < 6;
          if (tgt && T.HOLD > 0 && !open && (mem.hold = (mem.hold ?? 0) + dt) < T.HOLD) { if (!tag) tag = '等破綻'; continue; }
          mem.hold = 0; fire[side] = true; salvo++;
          if (T.HOLD > 0 && tgt && !f.staggered && (f.energy < 30 || f.boostCd > 0.3)) tag = '趁破綻';
        }
        continue;
      }
      if (w.kind === 'rocket') { if (nlos && o.dist < 14 && aligned < 0.1 && (o.foe.staggered || o.dist < 8)) fire[side] = true; continue; }
      const tol = w.id === 'shotgun' ? 0.2 : 0.12;
      if (nlos && o.lineClear[s] && o.dist < w.range && aligned < tol) fire[side] = true;
    }
    if (tgt && salvo && o.foe.id === tgt.id) tag = o.foe.staggered ? '趁失衡齊射' : pincer ? '包夾' : F.why;
    if (T.FRONT && tgt && !pincer && !b2b && !tag) tag = '誘敵';
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
        let s = -visCount(qx, qz) * COVER - r * 0.1;
        s -= Math.abs(nd - KEEP) * (nd < KEEP ? 0.6 : 0.25);
        if (nd > lockR - 1) s -= (nd - lockR + 1) * 0.8;                  // 鎖不到
        if (ne && !me.hp.head?.broken && o.lock.range < 30 && !losTo(api, { x: qx, z: qz }, ne.x, ne.z)) s -= 2;
        // 探頭鎖定（2026-11：隔牆鎖定要 2 倍時間）：還沒鎖上 → 偏好看得到鎖定目標（o.foe）的點；鎖上了再躲回去
        else if (T.PEEK && !o.lock.locked && !losTo(api, { x: qx, z: qz }, o.foe.x, o.foe.z)) s -= T.PEEK;   // 不能隔牆鎖定的頭：要看得到
        if (zoneAt(o, qx, qz)) s -= 3;
        // 牆角 / 退路：周圍空間太小扣分（被逼近會卡住）
        if (api.rayBlock(qx, qz, -C.ux, -C.uz, 4) < 3) s -= 1;
        if (mem.spot && Math.hypot(qx - mem.spot.x, qz - mem.spot.z) < 1.5) s += 0.4;
        if (tgt && ally) {
          // 鎖定距離算到集火目標；跟隊友拉夾角、別擠在一起
          const td = Math.hypot(tgt.x - qx, tgt.z - qz);
          if (td > lockR - 1) s -= (td - lockR + 1) * 0.8;
          if (pincer) { s += Math.min(crossAngle(qx, qz, ally, tgt), 1.6) * T.CROSS; if (!losTo(api, { x: qx, z: qz }, tgt.x, tgt.z)) s -= 1; }
          const ad = Math.hypot(ally.x - qx, ally.z - qz);
          if (ad < 5) s -= (5 - ad) * 0.4;
          if (b2b && ad > T.B2B) s -= (ad - T.B2B) * 0.5;
          // 誘餌：站得比隊友靠前（離目標比隊友近），讓對手先看到我
          if (T.FRONT && !pincer && !b2b) s += Math.max(-3, Math.min(3, Math.hypot(ally.x - tgt.x, ally.z - tgt.z) - td)) * T.FRONT;
        }
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
        if (ally && ally.dist > 3) s += ((ally.x - me.x) * ux + (ally.z - me.z) * uz) / ally.dist * T.TOALLY;
        return s;
      }, 4);
      if (b) { mx = b.x; mz = b.z; }
      if (ally && ally.dist > 3 && T.TOALLY) state = '退向隊友';
      if (fire.L || fire.R) notes.push('近身防禦');
    } else if (mem.spot) {
      const u = unit(mem.spot.x - me.x, mem.spot.z - me.z);
      if (u.l > 0.6) { const k = Math.min(1, u.l / 1.5); mx = u.x * k; mz = u.z * k; state = '換位置'; }
      else { mx = -C.uz * mem.strafe * 0.6; mz = C.ux * mem.strafe * 0.6; state = nlos ? '轟炸' : '掩體待命'; }
      if (b2b && state !== '換位置') state = '背靠背';
    }
    ({ mx, mz } = api.steer(mx, mz));

    // ---- 閃 ----
    const boost = dodge(o, api, mem, { minE: 30, light: !!T.LIGHT });
    if (boost) notes.push('閃');

    // 先鎖看得到的（2026-11：隔牆鎖定要 2 倍時間）：沒有集火目標、最近的那台在牆後 → 改鎖鎖定距離內看得到的最近一台
    let solo = null;
    if (!tgt && T.VIS && !nlos) {
      const v = E.find(e => e.dist < lockR - 1 && losTo(api, me, e.x, e.z));
      if (v) { solo = v.id; if (!notes.length) notes.push('先鎖看得到的'); }
    }
    return { move: { x: mx, z: mz }, aimYaw, fire, back, boost, target: tgt ? tgt.id : solo, note: teamNote(tag, notes.length ? notes.join('・') : state) };
  },
};
}
export default makeMissileer();
