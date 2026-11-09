// ---------- alpha 大腦 ----------
// 參賽者 alpha：火箭爆發型。核心想法
//   1. 火箭（不追蹤、每發 52 讓雙足失衡）只在「打得到」的時候打：近距離、對方失衡 / 點火 / 推進中（軌跡固定）
//      → 第一發讓對方失衡，同一輪剩下的直接吃滿
//   2. 平常保持在中距離繞圈，用手臂武器磨；子彈慢，橫移就躲得掉
//   3. 看到重彈 / 飛彈 / 火箭 / 騎槍點火 → 往垂直方向推進閃開
//   4. 一直正對敵人（軀幹正面 ×0.6，背面 ×1.35）
// 介面見 tools/sim/BRAINS.md
const MELEE = new Set(['saber', 'pile', 'flame']);

// 火箭飛到 d 格要幾秒（初速 24、加速 30、最快 38；不吃電腦減速）
function rocketT(d) {
  const tA = (38 - 24) / 30, dA = 24 * tA + 15 * tA * tA;
  if (d <= dA) return (-24 + Math.sqrt(576 + 60 * d)) / 30;
  return tA + (d - dA) / 38;
}
// 一般飛行時間：子彈（電腦 ×0.55，狙擊 ×0.5）
function flightT(w, d) {
  if (!w) return 0;
  if (w.kind === 'rocket') return rocketT(d);
  if (w.kind === 'missile') return d / 28;
  if (!w.speed) return 0;
  return d / (w.speed * (w.id === 'sniper' ? 0.5 : 0.55));
}

export default {
  name: 'alpha',
  init(mem) { mem.strafe = Math.random() < 0.5 ? 1 : -1; mem.flip = 1.5; mem.lastFoeBoost = 0; mem.fvx = 0; mem.fvz = 0; },
  think(o, mem, api) {
    const { me, foe, dist, dir } = o;
    const W = me.weapons, F = foe.weapons;
    const ok = s => W[s] && !W[s].broken && W[s].ammo > 0 && W[s].kind !== 'shield';
    const dt = o.dt;

    // ---- 對手狀態 ----
    const foeStill = foe.staggered || foe.charge === 'ignite' || foe.punching;
    const foeSpd = Math.hypot(foe.vx, foe.vz);
    // 對手手上最短的威脅距離（近戰型要保持距離）
    let foeMelee = 0, foeReach = 0;
    for (const s in F) {
      const w = F[s]; if (!w || w.broken || !(w.ammo > 0)) continue;
      if (MELEE.has(w.kind) || w.kind === 'lance') foeMelee = Math.max(foeMelee, w.kind === 'lance' ? 9 : w.range);
      foeReach = Math.max(foeReach, w.range);
    }

    // ---- 每一邊選武器 ----
    const back = {};
    const rocketsLeft = ['backL', 'backR'].some(s => ok(s) && W[s].kind === 'rocket');
    for (const side of ['L', 'R']) {
      const arm = 'arm' + side, bk = 'back' + side;
      if (!ok(bk)) { back[side] = false; continue; }
      if (!ok(arm)) { back[side] = true; continue; }
      const wb = W[bk], wa = W[arm];
      if (wb.kind === 'rocket') back[side] = dist < 18;
      else back[side] = dist > wa.range * 0.9 && dist < wb.range;
    }

    // ---- 想站的距離 ----
    let want;
    const armRanges = ['armL', 'armR'].filter(ok).map(s => MELEE.has(W[s].kind) ? 2 : W[s].range);
    if (rocketsLeft) want = foeStill ? 5 : 7.5;
    else want = armRanges.length ? Math.min(...armRanges) * 0.6 : 8;
    if (foeMelee && !foeStill) want = Math.max(want, foeMelee + 2.5);
    want = Math.min(want, 14);

    // ---- 移動：距離 + 繞圈（隨機換方向，躲子彈） ----
    if ((mem.flip -= dt) <= 0) { mem.flip = 0.8 + Math.random() * 1.6; if (Math.random() < 0.5) mem.strafe *= -1; }
    const radial = dist > want + 1.2 ? 1 : dist < want - 1.2 ? -1 : 0;
    let mx = dir.x * radial - dir.z * mem.strafe, mz = dir.z * radial + dir.x * mem.strafe;
    if (!o.los) {
      // 看不到：找一個走幾步就看得到的方向（繞過建築），選定後維持一下避免來回抖
      if ((mem.navT = (mem.navT ?? 0) - dt) <= 0 || !mem.nav) {
        let best = null, bestSc = -1e9;
        for (let i = 0; i < 16; i++) {
          const a = i / 16 * Math.PI * 2, ux = Math.sin(a), uz = Math.cos(a);
          const c = Math.min(api.clearAhead(ux, uz, 7), 7);
          if (c < 1.2) continue;
          const step = Math.min(c - 0.6, 4.5), px = me.x + ux * step, pz = me.z + uz * step;
          const fx = foe.x - px, fz = foe.z - pz, fd = Math.hypot(fx, fz) || 1;
          const see = api.rayBlock(px, pz, fx / fd, fz / fd, fd) >= fd - 0.9;
          const sc = (see ? 10 : 0) + (ux * dir.x + uz * dir.z) * 2 + step * 0.4 + (mem.nav && ux * mem.nav.x + uz * mem.nav.z > 0.7 ? 1 : 0);
          if (sc > bestSc) { bestSc = sc; best = { x: ux, z: uz }; }
        }
        mem.nav = best ?? { x: -dir.z * mem.strafe, z: dir.x * mem.strafe }; mem.navT = 0.4;
      }
      mx = mem.nav.x; mz = mem.nav.z;
    } else mem.nav = null;
    ({ mx, mz } = api.steer(mx, mz));
    // 撞牆換方向
    if (api.clearAhead(-dir.z * mem.strafe, dir.x * mem.strafe, 2) < 1.5) mem.strafe *= -1;

    // ---- 閃避 ----
    let boost = null;
    const canB = me.canBoost && me.boostCd <= 0 && !me.boosting;
    const sideStep = (ux, uz, prefer) => {
      // 垂直於 (ux, uz)，挑過得去的那一邊
      for (const sgn of [prefer, -prefer]) {
        const bx = uz * sgn, bz = -ux * sgn, L = api.boostLen(bx, bz);
        if (api.clearAhead(bx, bz, L) >= L * 0.9) return { x: bx, z: bz };
      }
      return null;
    };
    if (canB && me.energy >= 30) {
      const threat = o.incoming.find(s => s.tti != null && s.tti < 0.45 && s.miss < 1.6 && (s.heavy || s.kind !== 'bullet' || s.dmg >= 40));
      if (threat) {
        const sgn = (me.x - threat.x) * threat.uz - (me.z - threat.z) * threat.ux > 0 ? 1 : -1;
        boost = sideStep(threat.ux, threat.uz, -sgn);
      }
      // 騎槍點火、正對著我 → 橫移
      if (!boost && foe.charge === 'ignite' && dist < 11) {
        const fx = Math.sin(foe.yaw), fz = Math.cos(foe.yaw);
        if (-(fx * dir.x + fz * dir.z) > 0.9) boost = sideStep(fx, fz, mem.strafe);
      }
      // 近戰型貼太近：往後推
      if (!boost && foeMelee && dist < 3.2 && !foe.staggered) {
        const L = api.boostLen(-dir.x, -dir.z);
        if (api.clearAhead(-dir.x, -dir.z, L) > L * 0.8) boost = { x: -dir.x, z: -dir.z };
      }
    }

    // ---- 瞄準：照主要武器預判 ----
    const activeOf = side => (me.ready[side] ? 'back' : 'arm') + side;
    const act = ['L', 'R'].map(activeOf).filter(s => ok(s));
    const mainS = act.find(s => W[s].kind === 'rocket') ?? act.find(s => !MELEE.has(W[s].kind)) ?? act[0] ?? 'armR';
    const t = Math.min(1.2, flightT(W[mainS], dist));
    const tx = foe.x + (foeStill ? 0 : foe.vx * t), tz = foe.z + (foeStill ? 0 : foe.vz * t);
    const aimYaw = Math.atan2(tx - me.x, tz - me.z);
    const aligned = Math.abs(api.angleDiff(me.yaw, aimYaw));

    // ---- 開火 ----
    const fire = {};
    for (const side of ['L', 'R']) {
      const s = activeOf(side), w = W[s];
      if (!ok(s) || !w.live || me.deploying[side]) continue;
      if (w.needLock && !o.lock.locked) continue;
      if (!o.lineClear[s]) continue;
      if (w.kind === 'rocket') {
        // 火箭：打得到才打
        const tt = rocketT(dist);
        const good = foeStill || dist < 8 || (tt < 0.5 && foeSpd < 3) || foe.boosting;
        fire[side] = good && dist < 20 && aligned < 0.1;
        continue;
      }
      if (w.kind === 'lance') { fire[side] = dist > 4 && dist < w.range && aligned < 0.08 && api.clearAhead(dir.x, dir.z, dist) >= dist - 1; continue; }
      fire[side] = dist < w.range && aligned < (MELEE.has(w.kind) ? 0.35 : w.kind === 'missile' ? 0.6 : 0.12);
    }
    return { move: { x: mx, z: mz }, aimYaw, fire, back, boost, note: foeStill ? '趁失衡' : radial > 0 ? '接近' : radial < 0 ? '拉開' : '繞圈' };
  },
};
