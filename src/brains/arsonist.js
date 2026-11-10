// ---------- 縱火犯 arsonist（beta 個性機體 2） ----------
// 雙火焰噴射器 + 燒夷彈（右背）+ 直射飛彈（左背，輔助）：遠的時候先拋燒夷彈把地面點著（落在敵群 / 牠們走過來的路上），
// 近了換回噴火器，繞著敵群外圈「掃」——一次噴到越多台越好；被圍就往後退，讓追過來的踩進火海
//   - 火焰噴射器：6 格扇形（左右約 ±23°）、穿透、每下 3 + 疊燃燒；燃燒每層每秒 3.2、最多 5 層；燒到腳變慢（每層 −7%）
//   - 燒夷彈：拋到 aimAt（最遠 16 格、飛 0.75 秒），落地小爆炸 + 半徑 2.4 的火海 5 秒（自己的火海不燒自己）
//   - 雜魚的射擊型會自己走到 6–10 格 → 牠們走進火焰距離前先拋燒夷彈，走近了就噴
//   - 射擊型一被燒就換射擊位置（往外跑）→ 噴火器沒東西燒的時候架左背飛彈補刀；被逼近時右背燒夷彈丟火牆
//   - 不用能量開火 → 推進都拿來閃：連雜魚的小飛彈也在最後一刻橫推進甩掉；劍兵貼身就往後推進拉開
// 意圖（note）：縱火（往敵群拋燒夷彈）/ 火牆（往追兵前面拋）/ 噴火 / 噴火（一排）/ 繞圈噴火 / 後退引火 / 拉開 / 閃
import { ok, slotOf, unit, crowd, bestDir, dodge, seekLos, foeKind, hpOf, losTo, zoneAt, TAU } from './lib-beta.js';

const T = {
  FLAME_R: 5.6,    // 噴火要的距離（射程 6）
  WANT: 4.2,       // 想跟噴火目標保持的距離
  NAP_MIN: 7.5,    // 最近的敵人比這遠才拋燒夷彈（近了就噴火）
  NAP_N: 2,        // 火海範圍內至少幾台才拋（或是近戰追兵的路上）
  PRESS: 3,        // 5 格內敵人 ≥ PRESS → 後退引火
  WRAP: 0.55,      // 包圍度超過 → 後退
  SIDE: 2,         // 近戰時右背燒夷彈：1 = 火牆 + 旁邊的敵群、2 = 只丟火牆、3 = 只丟敵群
  IDLE: 1,         // 右背燒夷彈只在噴火器沒東西燒的時候換（換武器要 0.3 秒）
  LIGHTE: 0,       // 小飛彈：能量 ≥ 這個才閃（留能量閃重彈）
  HYST: 1,         // 遠近切換的遲滯
  MELB: 3,         // 近戰貼到幾格內就往後推進（0 = 不用）
  LIGHT: 1,        // 小飛彈也閃
};

export default {
  name: 'arsonist',
  init(mem) { mem.strafe = Math.random() < 0.5 ? 1 : -1; mem.flip = 1.5; mem.napT = 0; },
  think(o, mem, api) {
    const { me } = o, W = me.weapons, dt = o.dt;
    const notes = [];
    const E = o.enemies, nearest = E[0] ?? o.foe;
    const flamers = ['armL', 'armR'].filter(s => ok(W, s) && W[s].kind === 'flame');
    const naps = ['backL', 'backR'].filter(s => ok(W, s) && W[s].kind === 'napalm');
    const C = crowd(o, 14);
    if ((mem.flip -= dt) <= 0) { mem.flip = 1 + Math.random() * 1.5; if (Math.random() < 0.4) mem.strafe *= -1; }

    // ---- 噴火方向：哪個角度一次燒到最多台（6 格內、±0.4 弧度） ----
    let flameYaw = null, flameN = 0, flameTgt = null;
    for (const e of E) {
      if (e.dist > T.FLAME_R + 2.5) break;
      const y0 = Math.atan2(e.x - me.x, e.z - me.z);
      let n = 0;
      for (const f of E) {
        if (f.dist > T.FLAME_R + 0.6) break;
        if (Math.abs(api.angleDiff(y0, Math.atan2(f.x - me.x, f.z - me.z))) < 0.38 + Math.atan2(f.r, f.dist)) n += 1 + (hpOf(f) < 60 ? 0.3 : 0);
      }
      // 近戰（劍 / 霰彈）優先燒：牠們貼上來才會打
      const sc = n + (foeKind(e) === 'melee' ? 0.5 : 0) - e.dist * 0.05;
      if (sc > flameN) { flameN = sc; flameYaw = y0; flameTgt = e; }
    }
    const inFlame = E.filter(f => f.dist < T.FLAME_R + 0.4 && flameYaw != null && Math.abs(api.angleDiff(flameYaw, Math.atan2(f.x - me.x, f.z - me.z))) < 0.4).length;

    // ---- 燒夷彈落點：0.75 秒後敵人在哪；火海（半徑 2.4）蓋到最多台的點 ----
    let napPt = null, napN = 0;
    if (naps.length) {
      for (const e of E) {
        if (e.dist > 17) break;
        if (e.dist < 4) continue;
        const px = e.x + e.vx * 0.75, pz = e.z + e.vz * 0.75;
        let n = 0;
        for (const f of E) { const fx = f.x + f.vx * 0.75, fz = f.z + f.vz * 0.75; if (Math.hypot(fx - px, fz - pz) < 2.6) n++; }
        // 已經在燒的地方不用再丟
        if (o.zones.some(z => z.mine && z.t > 1.5 && Math.hypot(z.x - px, z.z - pz) < 1.8)) n -= 1.5;
        // 衝過來的近戰：丟在牠前面（火牆）
        if (foeKind(e) === 'melee' || foeKind(e) === 'rammer') n += 0.8;
        const d = Math.hypot(px - me.x, pz - me.z);
        if (d > 15.5 || d < 3.2) continue;
        if (n > napN) { napN = n; napPt = { x: px, z: pz, e }; }
      }
    }

    // ---- 火牆落點：被逼近時，丟在自己和追兵之間（3.5–5 格），追過來的一定踩到 ----
    const chasers = E.filter(e => e.dist < 7 && (foeKind(e) === 'melee' || foeKind(e) === 'rammer' || foeKind(e) === 'bomber' || ((e.x - me.x) * e.vx + (e.z - me.z) * e.vz) < -1.5 * e.dist));
    let wallPt = null;
    if (chasers.length && C.n) {
      const d = Math.min(5, Math.max(3.6, chasers[0].dist * 0.8));
      const wx = me.x + C.ux * d, wz = me.z + C.uz * d;
      if (!o.zones.some(z => z.mine && z.t > 1.2 && Math.hypot(z.x - wx, z.z - wz) < 2)) wallPt = { x: wx, z: wz };
    }

    // ---- 這一幀用噴火器還是燒夷彈 ----
    //   遠（最近的 > NAP_MIN）：兩邊都架燒夷彈往敵群丟
    //   近：左手一直噴火；右邊有好的落點（火牆 / 蓋到 2 台以上、在噴火距離外）就架起右背丟一顆再換回來
    //   燒夷彈落點 = aimAt，跟上半身方向無關 → 可以一邊往前噴、一邊往旁邊丟
    // 遠 / 近 有遲滯（不要在門檻附近一直換武器，換一次 0.3 秒）
    if (mem.far == null) mem.far = true;
    if (mem.far && nearest.dist < T.NAP_MIN - 1) mem.far = false; else if (!mem.far && nearest.dist > T.NAP_MIN + 1.5) mem.far = true;
    const far = T.HYST ? mem.far : nearest.dist > T.NAP_MIN;
    const useNap = naps.length > 0 && napPt && napN >= T.NAP_N - 0.2 && far && losTo(api, me, napPt.x, napPt.z) || (naps.length && !flamers.length);
    let sideNap = null;
    if (!useNap && T.SIDE && (!T.IDLE || inFlame === 0 || me.ready.R) && ok(W, 'backR') && W.backR.kind === 'napalm') {
      if (wallPt && T.SIDE !== 3) sideNap = { ...wallPt, wall: true };
      else if (T.SIDE !== 2 && napPt && napN >= T.NAP_N - 0.2 && Math.hypot(napPt.x - me.x, napPt.z - me.z) > T.FLAME_R) sideNap = napPt;
      if (sideNap) mem.sideT = 0.9;
      else if ((mem.sideT = (mem.sideT ?? 0) - dt) > 0 && mem.sidePt) sideNap = mem.sidePt;
      if (sideNap) mem.sidePt = sideNap;
    }
    const back = {};
    for (const side of ['L', 'R']) {
      const bk = 'back' + side;
      back[side] = !!(useNap && naps.includes(bk)) || (side === 'R' && !!sideNap);
      // 背部是飛彈（輔助）：噴火器沒東西燒、鎖得到 → 架起來打站在噴火距離外的射手
      if (ok(W, bk) && W[bk].kind === 'missile') {
        if (mem.mslHold == null) mem.mslHold = 0;
        const idle = inFlame === 0 && nearest.dist > T.FLAME_R + 0.8;
        if (idle) mem.mslHold = 0.6; else mem.mslHold -= dt / 2;
        back[side] = mem.mslHold > 0 || !ok(W, 'arm' + side);
      }
    }

    // ---- 瞄準 / 開火 ----
    const fire = {};
    let aimYaw, aimAt = null;
    if (useNap && napPt) {
      aimAt = { x: napPt.x, z: napPt.z };
      aimYaw = Math.atan2(napPt.x - me.x, napPt.z - me.z);
      for (const side of ['L', 'R']) {
        const s = slotOf(me, side);
        if (ok(W, s) && W[s].kind === 'napalm' && W[s].live && !me.deploying[side]) fire[side] = true;
        if (ok(W, s) && W[s].kind === 'missile' && W[s].live && !me.deploying[side] && o.lock.locked) fire[side] = true;
      }
      if (fire.L || fire.R) notes.push(foeKind(napPt.e) === 'melee' ? '火牆' : '縱火');
    } else {
      if (flameYaw != null) {
        aimYaw = flameYaw;
        const al = Math.abs(api.angleDiff(me.yaw, flameYaw));
        for (const side of ['L', 'R']) {
          const s = slotOf(me, side);
          if (ok(W, s) && W[s].kind === 'flame' && W[s].live && !me.deploying[side] && inFlame > 0 && al < 0.45) fire[side] = true;
        }
        if (fire.L || fire.R) notes.push(inFlame >= 3 ? '噴火（一排）' : '噴火');
      } else aimYaw = Math.atan2(nearest.x - me.x, nearest.z - me.z);
      for (const side of ['L', 'R']) {
        const s = slotOf(me, side);
        if (ok(W, s) && W[s].kind === 'missile' && W[s].live && !me.deploying[side] && (o.lock.locked || o.dist < 8)) { fire[side] = true; }
      }
      if (sideNap) {
        aimAt = { x: sideNap.x, z: sideNap.z };
        const s = slotOf(me, 'R');
        if (ok(W, s) && W[s].kind === 'napalm' && W[s].live && !me.deploying.R) { fire.R = true; notes.push(sideNap.wall ? '火牆' : '縱火'); mem.sideT = 0; }
      }
    }

    // ---- 移動 ----
    let mx = 0, mz = 0, state;
    const close = E.filter(e => e.dist < 5).length;
    const tg = flameTgt ?? nearest;
    const tu = unit(tg.x - me.x, tg.z - me.z);
    const avoid = (ux, uz) => {
      let s = 0;
      for (const e of E) { if (e.dist > 9) break; const al = ((e.x - me.x) * ux + (e.z - me.z) * uz) / e.dist; if (al > 0.3) s -= al * 4 / e.dist; }
      if (zoneAt(o, me.x + ux * 2, me.z + uz * 2)) s -= 3;
      return s;
    };
    if (close >= T.PRESS || C.wrap > T.WRAP && close >= 2) {
      // 被圍：往外退，追過來的會踩進火海 / 正好在火焰扇形裡
      state = '後退引火';
      const b = bestDir(api, (ux, uz, c) => -(ux * C.ux + uz * C.uz) * 2 + c * 0.35 + avoid(ux, uz), 4);
      if (b) { mx = b.x; mz = b.z; }
    } else if (!losTo(api, me, tg.x, tg.z)) {
      state = '找路';
      const n = seekLos(o, api, mem, tg.x, tg.z, 1); mx = n.x; mz = n.z;
    } else if (useNap) {
      // 拋燒夷彈：保持距離，小幅橫移
      state = '點火';
      const radial = nearest.dist < T.NAP_MIN + 1.5 ? -0.5 : nearest.dist > 13 ? 0.6 : 0;
      mx = tu.x * radial - tu.z * mem.strafe * 0.7; mz = tu.z * radial + tu.x * mem.strafe * 0.7;
    } else {
      // 噴火：繞著目標外圈（WANT 格），橫移讓扇形掃過一排
      state = '繞圈噴火';
      const radial = tg.dist > T.WANT + 1 ? 1 : tg.dist < T.WANT - 1.2 ? -0.7 : 0;
      mx = tu.x * radial - tu.z * mem.strafe * 0.8; mz = tu.z * radial + tu.x * mem.strafe * 0.8;
      if (api.clearAhead(-tu.z * mem.strafe, tu.x * mem.strafe, 2.5) < 2) mem.strafe *= -1;
    }
    // 不要自己走進敵人的火海 / 酸池
    if (zoneAt(o, me.x + mx * 1.5, me.z + mz * 1.5)) { const b = bestDir(api, (ux, uz, c) => (ux * mx + uz * mz) + c * 0.2 - (zoneAt(o, me.x + ux * 2, me.z + uz * 2) ? 5 : 0), 3); if (b) { mx = b.x; mz = b.z; } }
    ({ mx, mz } = api.steer(mx, mz));

    // ---- 閃 ----
    let boost = dodge(o, api, mem, { minE: 30, light: !!T.LIGHT, lightE: T.LIGHTE });
    // 劍兵 / 近戰貼到 MELB 格內 → 往後推進拉開（一邊退一邊噴，追過來的一直在扇形裡）
    if (!boost && T.MELB && me.canBoost && me.boostCd <= 0 && !me.boosting && me.energy >= 30) {
      const m = E.find(e => e.dist < T.MELB && foeKind(e) === 'melee' && !e.staggered);
      if (m) {
        const u = unit(me.x - m.x, me.z - m.z);
        const b = bestDir(api, (ux, uz, c) => (ux * u.x + uz * u.z) * 2 - (ux * C.ux + uz * C.uz) + c * 0.3 + (zoneAt(o, me.x + ux * 3, me.z + uz * 3) ? -3 : 0), 5, 3);
        if (b) { boost = { x: b.x, z: b.z }; notes.push('拉開'); mem.pulled = true; }
      }
    }
    if (boost && !mem.pulled) notes.push('閃');
    mem.pulled = false;

    const act = { move: { x: mx, z: mz }, aimYaw, fire, back, boost, note: notes.length ? notes.join('・') : state };
    if (aimAt) act.aimAt = aimAt;   // 燒夷彈落點（aimYaw 有給的話上半身照 aimYaw 轉）
    if (useNap && aimAt) delete act.aimYaw;
    return act;
  },
};
