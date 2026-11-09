// ---------- beta 大腦 ----------
// 參賽者 beta（第三階段 AI 設計賽）。主打「風箏」：
//   1. 電腦的子彈只有 0.55 倍速，飛彈 / 火箭卻是全速、會追蹤 → 自己帶追蹤飛彈 + 脈衝光束（瞬間命中），
//      站在對方霰彈 / 火箭「好打距離」外面（約 12 格）繞圈，對方的慢子彈靠橫移躲掉
//   2. 腳比對方快（懸浮）→ 對方靠近就往空曠的那一邊退，不被逼到牆角
//   3. 少推進（推進中軌跡固定，聰明的對手會趁這時候打火箭）；只有重彈 / 火箭 / 騎槍真的要打到才閃
//   4. 看不到：找「走幾步就看得到」的方向繞過建築
// 介面見 tools/sim/BRAINS.md
const MELEE = new Set(['saber', 'pile', 'flame']);
const HEAVY_KIND = new Set(['missile', 'vmissile', 'rocket', 'split', 'napalm']);

const ok = (W, s) => W[s] && !W[s].broken && W[s].ammo > 0 && W[s].kind !== 'shield';
const slotOf = (me, side) => (me.ready[side] ? 'back' : 'arm') + side;

// 火箭飛 d 格要幾秒（初速 24、加速 30、最快 38；火箭 / 飛彈不吃電腦減速）
function rocketT(d) {
  const tA = (38 - 24) / 30, dA = 24 * tA + 15 * tA * tA;
  if (d <= dA) return (-24 + Math.sqrt(576 + 60 * d)) / 30;
  return tA + (d - dA) / 38;
}
function flightT(w, d) {
  if (!w) return 0;
  if (w.kind === 'rocket') return rocketT(d);
  if (w.kind === 'missile' || w.kind === 'vmissile' || w.kind === 'split') return 0;   // 追蹤：瞄現在的位置
  if (w.kind === 'pulse' || MELEE.has(w.kind) || w.kind === 'lance' || !w.speed) return 0;
  return d / (w.speed * (w.id === 'sniper' ? 0.5 : 0.55));
}

// 對手的威脅距離：近戰 / 霰彈 / 火箭（有火箭的對手在 8 格內才敢打）
function foeThreatRange(F) {
  let r = 0;
  for (const s in F) {
    const w = F[s]; if (!w || w.broken || !(w.ammo > 0) || w.kind === 'shield') continue;
    if (MELEE.has(w.kind)) r = Math.max(r, w.range + 2);
    else if (w.kind === 'lance') r = Math.max(r, 10.5);
    else if (w.id === 'shotgun') r = Math.max(r, 9.5);
    else if (w.kind === 'rocket') r = Math.max(r, 9);
  }
  return r;
}

// 自己的盾擋不擋得住往 (ux, uz) 飛的東西（跟 mech.js hitMech 的判定一樣，留一點餘裕）
function shieldCovers(me, ux, uz) {
  const S = me.shield;
  if (!S || S.hp <= 40 || me.hp[S.slot]?.broken) return false;
  const fx = Math.sin(me.yaw), fz = Math.cos(me.yaw), sd = S.slot === 'armL' ? 1 : -1;
  let cx = fx + fz * 0.7 * sd, cz = fz - fx * 0.7 * sd;
  const cl = Math.hypot(cx, cz); cx /= cl; cz /= cl;
  return -(ux * cx + uz * cz) > 0.4;
}

export default {
  name: 'beta',
  init(mem) { mem.strafe = Math.random() < 0.5 ? 1 : -1; mem.flip = 1.5; mem.nav = null; mem.navT = 0; },
  think(o, mem, api) {
    const { me, foe, dist, dir } = o;
    const W = me.weapons, F = foe.weapons, dt = o.dt;
    const foeStill = foe.staggered || foe.charge === 'ignite' || foe.punching;

    // ---- 我的武器組成 ----
    const has = k => Object.keys(W).some(s => ok(W, s) && W[s].kind === k);
    const ranged = has('missile') || has('vmissile') || has('pulse');
    // ---- 每一邊用手臂還是背部 ----
    const back = {};
    for (const side of ['L', 'R']) {
      const arm = 'arm' + side, bk = 'back' + side;
      if (!ok(W, bk)) { back[side] = false; continue; }
      if (!ok(W, arm)) { back[side] = true; continue; }
      const wa = W[arm], wb = W[bk];
      if (wb.kind === 'missile' || wb.kind === 'vmissile') {
        // 手臂是脈衝：脈衝優先（瞬間命中，命中率遠高於飛彈），打不到才換飛彈；其他手臂武器 → 飛彈優先（在鎖定距離內）
        if (wa.kind === 'pulse' && +(globalThis.process?.env?.PF ?? 0)) back[side] = me.ready[side] ? dist > wa.range - 1 : dist > wa.range + 0.5;
        else back[side] = dist < Math.min(wb.range, o.lock.range) + 1 && !(wa.kind === 'pulse' && dist < wa.range && me.energy > 60 && !me.ready[side]);
      } else if (wb.kind === 'rocket') back[side] = dist < 16;
      else back[side] = me.ready[side] ? dist > wa.range * 0.85 && dist < wb.range : dist > wa.range && dist < wb.range * 0.95;
    }

    // ---- 想站的距離 ----
    const threat = foeThreatRange(F);
    let want;
    if (ranged) want = Math.max(+(globalThis.process?.env?.MINW ?? 11), threat + (+(globalThis.process?.env?.BW ?? 8)));
    else {
      want = 8;
      for (const s in W) if (ok(W, s)) {
        const w = W[s];
        const r = MELEE.has(w.kind) ? 1.8 : w.kind === 'lance' ? 6 : w.id === 'shotgun' ? 4 : w.kind === 'rocket' ? 6.5 : Math.min(w.range * 0.55, 12);
        want = Math.min(want, r);
      }
    }
    if (ranged && me.shield && (me.shield.hp <= 0 || me.hp[me.shield.slot]?.broken)) want += +(globalThis.process?.env?.SB ?? 0);
    want = Math.min(want, +(globalThis.process?.env?.WMAX ?? 19));
    if (foeStill && !ranged) want = Math.min(want, 5);

    // ---- 移動 ----
    if ((mem.flip -= dt) <= 0) { mem.flip = 0.7 + Math.random() * 1.5; if (Math.random() < 0.5) mem.strafe *= -1; }
    // 橫移方向：撞牆或往牆角 → 換邊
    const tanClear = sg => api.clearAhead(-dir.z * sg, dir.x * sg, 3);
    // 繞側：往對方沒拿盾的那一側繞（它的盾在左手 → 繞到它的右邊），我的子彈 / 光束就不會打在盾上
    //   對方照射脈衝時上半身只剩 0.4 倍轉速：近距離橫移的角速度 > 它的轉速 → 光束追不上
    const E2 = globalThis.process?.env ?? {}, FL = +(E2.FL ?? 1);
    const foeSh = foe.shield && foe.shield.hp > 0 && !foe.hp[foe.shield.slot]?.broken;
    if (FL && o.los && ((FL === 1 && foeSh) || (FL >= 2 && foe.beaming) || (FL === 3 && foeSh))) {
      const fx = Math.sin(foe.yaw), fz = Math.cos(foe.yaw), sd = foeSh && foe.shield.slot === 'armR' ? -1 : 1;
      // 對方的右邊 = (-fz, fx)；盾在右手就反過來
      const rx = -fz * sd, rz = fx * sd;
      mem.strafe = (-dir.z * rx + dir.x * rz) > 0 ? 1 : -1;
      if (foe.beaming) mem.flip = Math.max(mem.flip, 0.3);
    }
    if (tanClear(mem.strafe) < 2.5 && tanClear(-mem.strafe) > tanClear(mem.strafe)) mem.strafe *= -1;
    let radial = dist > want + 1.5 ? 1 : dist < want - 1 ? -1 : 0;
    if (FL && foe.beaming && +(E2.BR ?? 0)) radial = dist > 5 ? 0.35 : 0;
    // 往後退的路被擋住 → 改成大幅橫移（繞出去）
    if (radial < 0 && api.clearAhead(-dir.x, -dir.z, 3) < 2.5) radial = -0.2;
    const sw = radial > 0 ? 0.7 : 1;
    let mx = dir.x * radial - dir.z * mem.strafe * sw, mz = dir.z * radial + dir.x * mem.strafe * sw;
    if (!o.los) {
      if ((mem.navT -= dt) <= 0 || !mem.nav) {
        let best = null, bestSc = -1e9;
        for (let i = 0; i < 16; i++) {
          const a = i / 16 * Math.PI * 2, ux = Math.sin(a), uz = Math.cos(a);
          const c = Math.min(api.clearAhead(ux, uz, 7), 7);
          if (c < 1.2) continue;
          const step = Math.min(c - 0.6, 4.5), px = me.x + ux * step, pz = me.z + uz * step;
          const fx = foe.x - px, fz = foe.z - pz, fd = Math.hypot(fx, fz) || 1;
          const see = api.rayBlock(px, pz, fx / fd, fz / fd, fd) >= fd - 0.9;
          const sc = (see ? 10 : 0) + (ux * dir.x + uz * dir.z) * (ranged ? 0.5 : 2) + step * 0.4 + (mem.nav && ux * mem.nav.x + uz * mem.nav.z > 0.7 ? 1 : 0);
          if (sc > bestSc) { bestSc = sc; best = { x: ux, z: uz }; }
        }
        mem.nav = best ?? { x: -dir.z * mem.strafe, z: dir.x * mem.strafe }; mem.navT = 0.4;
      }
      mx = mem.nav.x; mz = mem.nav.z;
    } else {
      mem.nav = null;
      // 看得到、但主武器（手臂在右邊 / 左邊偏一點）的射線被柱子擋住 → 往射線會通的方向挪一步
      const fs = ['R', 'L'].map(sd => slotOf(me, sd)).find(sl => ok(W, sl) && W[sl].kind !== 'missile' && W[sl].kind !== 'vmissile');
      if (fs && !o.lineClear[fs] && dist < 21 && +(globalThis.process?.env?.LC ?? 1)) {
        if ((mem.lcT = (mem.lcT ?? 0) - dt) <= 0 || !mem.lc) {
          const lx = fs === 'armR' || fs === 'backR' ? -0.7 : 0.7;
          const clearFrom = (px, pz) => {
            const yw = Math.atan2(foe.x - px, foe.z - pz), s = Math.sin(yw), c = Math.cos(yw);
            const qx = px + lx * c + 1.4 * s, qz = pz - lx * s + 1.4 * c;
            const d = Math.hypot(foe.x - qx, foe.z - qz) - foe.r;
            return api.rayBlock(qx, qz, s, c, d) >= d;
          };
          let best = null, bs = -1e9;
          for (let i = 0; i < 12; i++) {
            const a = i / 12 * Math.PI * 2, ux = Math.sin(a), uz = Math.cos(a);
            if (api.clearAhead(ux, uz, 1.8) < 1.8) continue;
            const okc = clearFrom(me.x + ux * 1.6, me.z + uz * 1.6);
            const sc = (okc ? 10 : 0) + (ux * mx + uz * mz) * 1.5;
            if (sc > bs) { bs = sc; best = { x: ux, z: uz }; }
          }
          mem.lc = best; mem.lcT = 0.3;
        }
        if (mem.lc) { mx = mem.lc.x; mz = mem.lc.z; }
      } else mem.lc = null;
    }
    ({ mx, mz } = api.steer(mx, mz));
    // 保持速度：要轉向超過 ~100° 時（例如橫移換邊）先只轉 90°，不要整個倒車停下來
    //   （停下來 = 速度 < 2.5，對手會趁這時候打火箭；轉個彎也讓對手照速度預判的瞄準落空）
    const ENV = globalThis.process?.env ?? {};
    const spd = Math.hypot(me.vx, me.vz);
    if (+(ENV.TL ?? 1) && spd > 2 && o.los) {
      const vx = me.vx / spd, vz = me.vz / spd, ml = Math.hypot(mx, mz) || 1;
      const dot = (mx * vx + mz * vz) / ml;
      if (dot < -0.2) {
        const cr = vx * mz - vz * mx >= 0 ? 1 : -1;   // 往哪邊轉比較近
        let nx = -vz * cr, nz = vx * cr;               // 速度方向轉 90°
        if (api.clearAhead(nx, nz, 2) < 1.5) { nx = -nx; nz = -nz; }
        ({ mx, mz } = api.steer(nx, nz));
      }
    }

    // ---- 閃避 ----
    let boost = null;
    const sideStep = (ux, uz, prefer) => {
      for (const sgn of [prefer, -prefer]) {
        const bx = uz * sgn, bz = -ux * sgn, L = api.boostLen(bx, bz);
        if (api.clearAhead(bx, bz, L) >= L * 0.85) return { x: bx, z: bz };
      }
      return null;
    };
    const canB = me.canBoost && me.boostCd <= 0 && !me.boosting && !me.staggered;
    if (canB && me.energy >= +(globalThis.process?.env?.BMIN ?? 30)) {
      // 騎槍點火 / 衝刺、正對著我
      if (foe.charge && dist < 12) {
        const fx = Math.sin(foe.yaw), fz = Math.cos(foe.yaw);
        const miss = Math.abs((me.x - foe.x) * fz - (me.z - foe.z) * fx);
        if (miss < 2.4) boost = sideStep(fx, fz, mem.strafe);
      }
      if (!boost) {
        const t = o.incoming.find(s => s.tti != null && s.tti < 0.42 && s.miss < 1.4 + s.splash * 0.4 &&
          (s.heavy || HEAVY_KIND.has(s.kind) || s.dmg >= 40) && !(s.kind === 'missile' && s.dmg < me.staggerAt && s.dmg < 35));
        // 盾牌擋得住的方向來的直擊 → 不閃（盾擋下不會失衡；推進反而讓對手趁軌跡固定打火箭、又吃能量）
        if (t && shieldCovers(me, t.ux, t.uz) && !t.point && !(+(globalThis.process?.env?.RDS ?? 1) && t.kind === "rocket" && me.energy >= +(globalThis.process?.env?.RDE ?? 30))) mem.blocked = (mem.blocked ?? 0) + 1;
        else if (t) {
          if (t.point) { const dx = me.x - t.point.x, dz = me.z - t.point.z, d = Math.hypot(dx, dz) || 1; if (d < 3) boost = { x: dx / d, z: dz / d }; }
          else { const sg = (me.x - t.x) * t.uz - (me.z - t.z) * t.ux > 0 ? 1 : -1; boost = sideStep(t.ux, t.uz, -sg); }
        }
      }
      // 對方脈衝在充能 / 照射、正對著我 → 橫推進甩開光束（光束轉不快）
      const foeRkt = Object.entries(F).some(([sl, w]) => w && !w.broken && w.ammo > 0 && (w.kind === "rocket" || w.kind === "cannon") && (sl.startsWith("arm") || foe.ready[sl.slice(-1)]));
      if (!boost && +(E2.BB ?? 1) && foe.beaming && !(+(E2.BBR ?? 0) && foeRkt && dist < 17) && dist < +(E2.BBD ?? 21) && me.energy >= +(E2.BBE ?? 60)) {
        const fx = Math.sin(foe.yaw), fz = Math.cos(foe.yaw);
        const miss = Math.abs((me.x - foe.x) * fz - (me.z - foe.z) * fx);
        if (miss < +(E2.BBM ?? 3) && (+(E2.BBS ?? 1) || !shieldCovers(me, -dir.x, -dir.z))) { const bx = -dir.z * mem.strafe, bz = dir.x * mem.strafe, L = api.boostLen(bx, bz); if (api.clearAhead(bx, bz, L) >= L * 0.85) boost = { x: bx, z: bz }; }
      }
      // 近戰型貼太近：往後推
      if (!boost && threat && foe.weapons && dist < 3.5 && !foe.staggered && ranged) {
        const L = api.boostLen(-dir.x, -dir.z);
        if (api.clearAhead(-dir.x, -dir.z, L) > L * 0.8) boost = { x: -dir.x, z: -dir.z };
      }
      // 近距離型：遠的時候衝過去
      if (!boost && !ranged && want < 6 && dist > want + 6 && o.los && me.energy > 80) boost = { x: mx, z: mz };
    }

    // ---- 瞄準 ----
    const act = ['L', 'R'].map(s => slotOf(me, s)).filter(s => ok(W, s));
    const mainS = act.find(s => W[s].kind === 'pulse') ?? act.find(s => W[s].kind === 'rocket') ?? act.find(s => W[s].kind === 'bullet') ?? act[0] ?? 'armR';
    const tf = Math.min(1.2, flightT(W[mainS], dist));
    const tx = foe.x + (foeStill ? 0 : foe.vx * tf), tz = foe.z + (foeStill ? 0 : foe.vz * tf);
    let aimYaw = Math.atan2(tx - me.x, tz - me.z);
    const aligned = Math.abs(api.angleDiff(me.yaw, aimYaw));
    // 架盾：脈衝還沒好、也沒在照射 → 上半身往沒盾那側偏一點，讓對方落在盾的正中間（盾中心偏 35°）
    const GD = +(globalThis.process?.env?.GD ?? 0);
    if (GD && me.shield && me.shield.hp > 0 && !me.hp[me.shield.slot]?.broken && !me.beaming) {
      const ps = ['armL', 'armR'].find(sl => ok(W, sl) && W[sl].kind === 'pulse' && !me.ready[sl.slice(-1)]);
      const pulseSoon = ps && (W[ps].cd ?? 0) < 0.25 && me.energy >= W[ps].energy + 20 && dist < W[ps].range;
      if (!pulseSoon) aimYaw += me.shield.slot === 'armL' ? -GD : GD;
    }

    // ---- 開火 ----
    const fire = {};
    for (const side of ['L', 'R']) {
      const s = slotOf(me, side), w = W[s];
      if (!ok(W, s) || !w.live || me.deploying[side]) continue;
      if (w.needLock && !o.lock.locked) continue;
      if (w.kind === 'lance') { fire[side] = dist > 3 && dist < w.range && aligned < 0.08 && api.clearAhead(dir.x, dir.z, dist) >= dist - 1; continue; }
      if (!o.lineClear[s]) continue;
      if (w.kind === 'pulse') { fire[side] = dist < w.range - 0.5 && o.los && aligned < 0.07 && me.energy >= w.energy + (+(globalThis.process?.env?.PR ?? -1) >= 0 ? +globalThis.process.env.PR : (me.energy > 70 ? 0 : 20)); continue; }
      if (w.kind === 'missile') { fire[side] = dist < w.range && (o.lock.locked || dist < 9) && aligned < 0.5; continue; }
      if (w.kind === 'rocket') { fire[side] = dist < 18 && aligned < 0.1 && (foeStill || dist < 8 || foe.boosting); continue; }
      const tol = MELEE.has(w.kind) ? 0.35 : w.id === 'shotgun' ? 0.2 : 0.12;
      fire[side] = dist < w.range && aligned < tol;
    }
    return { move: { x: mx, z: mz }, aimYaw, fire, back, boost, note: boost ? '閃' : radial > 0 ? '接近' : radial < 0 ? '拉開' : '繞圈' };
  },
};
