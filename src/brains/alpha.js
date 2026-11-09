// ---------- alpha 大腦 ----------
// 參賽者 alpha：雙火箭爆發 + 脈衝光束。核心想法
//   1. 火箭（不追蹤、每發 52 讓雙足失衡）近距離幾乎躲不掉；誰先在近距離打出一輪，對方就失衡、剩下的全吃
//   2. 看對方的彈藥數變化 → 知道對方的重武器什麼時候打完、還要幾秒才能再打（冷卻窗口）
//      對方重武器在冷卻 / 沒架起來 → 衝進去近距離整輪打；對方重武器準備好 → 在中距離繞圈、等它先打再閃
//   3. 看到重彈 / 飛彈 / 火箭 / 騎槍點火 → 往垂直方向推進閃開
//   4. 一直正對敵人（軀幹正面 ×0.6，背面 ×1.35）；脈衝光束是瞬間命中的，對方失衡時整道照滿
// 介面見 tools/sim/BRAINS.md
const MELEE = new Set(['saber', 'pile', 'flame']);
const BURST = new Set(['rocket', 'cannon', 'split', 'missile', 'vmissile', 'napalm', 'pulse', 'lance', 'pile', 'beam']);

// 火箭飛到 d 格要幾秒（初速 24、加速 30、最快 38；不吃電腦減速）
function rocketT(d) {
  const tA = (38 - 24) / 30, dA = 24 * tA + 15 * tA * tA;
  if (d <= dA) return (-24 + Math.sqrt(576 + 60 * d)) / 30;
  return tA + (d - dA) / 38;
}
// 飛行時間：子彈（電腦 ×0.55，狙擊 ×0.5）
function flightT(w, d) {
  if (!w) return 0;
  if (w.kind === 'rocket') return rocketT(d);
  if (w.kind === 'missile') return d / 28;
  if (w.kind === 'pulse') return 0;
  if (!w.speed) return 0;
  return d / (w.speed * (w.id === 'sniper' ? 0.5 : 0.55));
}
const P = { hold: 9.5, rush: 4.8, fireNear: 6.5, kite: 19.1, mTti: 0.22, kiteOn: false, pAlign: 0.07, pReserve: 20, shieldAware: false, flank: true, guard: 0.45, kiteR: 15 };
// 自己的盾擋不擋得到從 (ux, uz) 方向飛來的東西（盾在那一側前方，偏 35°、左右約 78°）
function shieldCovers(me, ux, uz) {
  const S = me.shield;
  if (!S || S.hp <= 30 || me.hp[S.slot]?.broken) return false;
  const fx = Math.sin(me.yaw), fz = Math.cos(me.yaw), sd = S.slot === 'armL' ? 1 : -1;
  let cx = fx + fz * 0.7 * sd, cz = fz - fx * 0.7 * sd;
  const cl = Math.hypot(cx, cz); cx /= cl; cz /= cl;
  return -(ux * cx + uz * cz) > 0.35;
}

export default {
  name: 'alpha',
  init(mem) { mem.strafe = Math.random() < 0.5 ? 1 : -1; mem.flip = 1.5; mem.foeAmmo = {}; mem.foeReady = {}; },
  think(o, mem, api) {
    const { me, foe, dist, dir } = o;
    const W = me.weapons, F = foe.weapons;
    const ok = s => W[s] && !W[s].broken && W[s].ammo > 0 && W[s].kind !== 'shield';
    const dt = o.dt, now = o.t;

    // ---- 對手：彈藥 / 能量變化 → 重武器的冷卻 ----
    let foeMelee = 0, foeBurstReady = false, foeBurstAny = false;
    for (const s in F) {
      const w = F[s]; if (!w || w.broken || !(w.ammo > 0)) continue;
      if (MELEE.has(w.kind) || w.kind === 'lance') foeMelee = Math.max(foeMelee, w.kind === 'lance' ? 9 : w.range);
      if (w.ammo !== Infinity) {
        if (mem.foeAmmo[s] != null && w.ammo < mem.foeAmmo[s]) mem.foeReady[s] = now + w.interval;
        mem.foeAmmo[s] = w.ammo;
      }
      if (['rocket', 'cannon', 'split'].includes(w.kind)) {
        foeBurstAny = true;
        const side = s.slice(-1), raised = s.startsWith('back') ? foe.ready[side] : true;
        // 架起來（或 0.3 秒內架得起來）而且冷卻快好了 → 危險
        if ((mem.foeReady[s] ?? 0) < now + 0.35 && (raised || dist < 14)) foeBurstReady = true;
      }
    }
    const foeStill = foe.staggered || foe.charge === 'ignite' || foe.punching;
    const foeSpd = Math.hypot(foe.vx, foe.vz);
    const foeNoDodge = !foe.canBoost || foe.energy < 30 || foe.boostCd > 0.15 || foe.staggered;

    // 對方的盾：還在、而且擋得到我打過去的方向
    const foeShieldUp = !!foe.shield && foe.shield.hp > 0 && !foe.hp[foe.shield.slot]?.broken;
    const foeShieldBlocks = P.shieldAware && foeShieldUp && shieldCovers(foe, dir.x, dir.z);
    // ---- 每一邊選武器（火箭兩邊一起架：一輪 6 發才打得出失衡連段） ----
    const back = {};
    const rkt = s => ok(s) && W[s].kind === 'rocket';
    const myRockets = rkt('backL') || rkt('backR');
    for (const side of ['L', 'R']) {
      const arm = 'arm' + side, bk = 'back' + side;
      if (!ok(bk)) { back[side] = false; continue; }
      if (!ok(arm)) { back[side] = true; continue; }
      const wb = W[bk], wa = W[arm];
      // 對方的盾擋著我這條線 → 火箭打在盾上（化學 ×0.65、不會失衡）很浪費：先收起來用手臂（脈衝 / 機砲）把盾打爆
      if (wb.kind === 'rocket') back[side] = dist < 18 && (!foeShieldBlocks || foeStill || !ok(arm));
      else back[side] = dist > wa.range * 0.9 && dist < wb.range;
    }
    const activeOf = side => (me.ready[side] ? 'back' : 'arm') + side;
    const myRktReady = ['L', 'R'].some(sd => me.ready[sd] && rkt('back' + sd) && (W['back' + sd].cd ?? 0) < 0.25);

    // ---- 想站的距離 ----
    let want, mode;
    const armRanges = ['armL', 'armR'].filter(ok).map(s => MELEE.has(W[s].kind) ? 2 : W[s].kind === 'pulse' ? 20 : W[s].range);   // 脈衝 20 格 → 站 12 格（慢子彈有時間躲）
    // 對方靠追蹤飛彈（射程 / 鎖定 18 格）、我有脈衝（20 格）→ 站在 19 格外只用脈衝打，飛彈根本不會發射
    const myPulse = ['armL', 'armR'].some(s => ok(s) && W[s].kind === 'pulse');
    const foeHoming = Object.values(F).some(w => w && !w.broken && w.ammo > 0 && (w.kind === 'missile' || w.kind === 'vmissile' || w.kind === 'split'));
    let tol = 1.0;
    if (P.kiteOn && myPulse && foeHoming && !foeStill) { want = P.kite; mode = '遠距'; tol = 0.45; }
    else if (foeStill && myRockets) { want = 4; mode = '趁失衡'; }
    else if (myRockets && myRktReady && (!foeBurstReady || !foeBurstAny)) { want = P.rush; mode = '衝'; }
    // 我沒火箭、對方有火箭 / 加農砲：站遠一點（火箭飛久了就躲得掉），用脈衝 / 飛彈打
    else if (!myRockets && foeBurstAny && P.kiteR) { want = P.kiteR; mode = '遠'; }
    else if (myRockets || foeBurstReady) { want = P.hold; mode = '等'; }
    else { want = armRanges.length ? Math.min(...armRanges) * 0.6 : 8; mode = '磨'; }
    if (foeMelee && !foeStill) want = Math.max(want, foeMelee + 2.5);
    if (mode !== '遠距') want = Math.min(want, 14);

    // ---- 移動：距離 + 繞圈（隨機換方向，躲子彈） ----
    if ((mem.flip -= dt) <= 0) { mem.flip = 0.8 + Math.random() * 1.6; if (Math.random() < 0.5) mem.strafe *= -1; }
    // 對方有盾：往它沒盾的那一側繞（它上半身轉得慢，照射脈衝時更慢）
    if (P.flank && foeShieldUp) {
      const fx = Math.sin(foe.yaw), fz = Math.cos(foe.yaw), sd = foe.shield.slot === 'armL' ? 1 : -1;
      const cx = fx + fz * 0.7 * sd, cz = fz - fx * 0.7 * sd;
      mem.strafe = (-dir.z * cx + dir.x * cz) > 0 ? -1 : 1;
    }
    let radial = dist > want + tol ? 1 : dist < want - tol ? -1 : 0;
    // 退路被牆擋住：改成大幅橫移（繞著對方轉）
    if (radial < 0 && api.clearAhead(-dir.x, -dir.z, 3) < 2.5) radial = -0.2;
    const sw = radial > 0 && mode === '衝' ? 0.5 : 1;
    let mx = dir.x * radial - dir.z * mem.strafe * sw, mz = dir.z * radial + dir.x * mem.strafe * sw;
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
    if (api.clearAhead(-dir.z * mem.strafe, dir.x * mem.strafe, 2) < 1.5) mem.strafe *= -1;   // 撞牆換方向

    // ---- 閃避 ----
    let boost = null;
    const canB = me.canBoost && me.boostCd <= 0 && !me.boosting && !me.staggered;
    const sideStep = (ux, uz, prefer) => {
      for (const sgn of [prefer, -prefer]) {
        const bx = uz * sgn, bz = -ux * sgn, L = api.boostLen(bx, bz);
        if (api.clearAhead(bx, bz, L) >= L * 0.9) return { x: bx, z: bz };
      }
      return null;
    };
    if (canB && me.energy >= 30) {
      // 追蹤飛彈：太早閃它會轉回來 → 等到很近（tti 小）才閃；盾擋得到的不閃（省能量）
      const threat = o.incoming.find(s => {
        if (s.tti == null || !(s.heavy || s.kind !== 'bullet' || s.dmg >= 40)) return false;
        if (shieldCovers(me, s.ux, s.uz) && !s.point) return false;
        // 有脈衝：能量 = 傷害，一般飛彈（陶瓷只吃 ~20）不值得花 30 能量去閃
        if ((s.kind === 'missile' || s.kind === 'split') && s.target) return (!myPulse || me.energy > 85) && s.tti < P.mTti && s.miss < 2.5;
        return s.tti < 0.45 && s.miss < 1.6 + (s.splash ?? 0) * 0.4;
      });
      if (threat) {
        if (threat.point) { const dx = me.x - threat.point.x, dz = me.z - threat.point.z, d = Math.hypot(dx, dz) || 1; boost = { x: dx / d, z: dz / d }; }
        else {
          const sgn = (me.x - threat.x) * threat.uz - (me.z - threat.z) * threat.ux > 0 ? 1 : -1;
          boost = sideStep(threat.ux, threat.uz, sgn);
        }
      }
      // 騎槍點火 / 衝刺、正對著我 → 橫移
      if (!boost && foe.charge && dist < 12) {
        const fx = Math.sin(foe.yaw), fz = Math.cos(foe.yaw);
        const miss = Math.abs((me.x - foe.x) * fz - (me.z - foe.z) * fx);
        if (miss < 2.4 && -(fx * dir.x + fz * dir.z) > 0.5) boost = sideStep(fx, fz, mem.strafe);
      }
      // 近戰型貼太近：往後推
      if (!boost && foeMelee && dist < 3.2 && !foe.staggered) {
        const L = api.boostLen(-dir.x, -dir.z);
        if (api.clearAhead(-dir.x, -dir.z, L) > L * 0.8) boost = { x: -dir.x, z: -dir.z };
      }
    }

    // ---- 瞄準：照現在要打的武器預判 ----
    const act = ['L', 'R'].map(activeOf).filter(s => ok(s));
    const cdOf = s => W[s].cd ?? 0;
    const pulseS = act.find(s => W[s].kind === 'pulse');
    const mainS = (me.beaming && pulseS) ? pulseS
      : act.find(s => W[s].kind === 'rocket' && cdOf(s) < 0.3) ?? act.find(s => !MELEE.has(W[s].kind)) ?? act[0] ?? 'armR';
    const t = Math.min(1.2, flightT(W[mainS], dist));
    const tx = foe.x + (foeStill ? 0 : foe.vx * t), tz = foe.z + (foeStill ? 0 : foe.vz * t);
    let aimYaw = Math.atan2(tx - me.x, tz - me.z);
    let aligned = Math.abs(api.angleDiff(me.yaw, aimYaw));
    // 架盾：脈衝還沒好（冷卻 / 沒能量）、也沒在照射 → 上半身偏一點，讓對方落在盾的正中間（盾中心偏 35°）
    const myShieldUp = !!me.shield && me.shield.hp > 30 && !me.hp[me.shield.slot]?.broken;
    if (P.guard && myShieldUp && !me.beaming && !foeStill) {
      const pw = pulseS && W[pulseS];
      const pulseSoon = pw && cdOf(pulseS) < 0.25 && me.energy >= pw.energy + 5;
      if (!pulseSoon) { aimYaw -= P.guard * (me.shield.slot === 'armL' ? 1 : -1); mem.guarding = true; } else mem.guarding = false;
    } else mem.guarding = false;

    // ---- 開火 ----
    const fire = {};
    for (const side of ['L', 'R']) {
      const s = activeOf(side), w = W[s];
      if (!ok(s) || !w.live || me.deploying[side]) continue;
      if (w.needLock && !o.lock.locked) continue;
      if (!o.lineClear[s]) continue;
      if (w.kind === 'rocket') {
        // 火箭：打得到才打（近、對方失衡 / 不能閃、或推進中軌跡固定）
        const tt = rocketT(dist);
        const good = foeStill || dist < P.fireNear || (foeNoDodge && tt < 0.55) || (tt < 0.45 && foeSpd < 2.5);
        fire[side] = good && dist < 20 && aligned < 0.1;
        continue;
      }
      if (w.kind === 'missile') { fire[side] = dist < w.range && (o.lock.locked || dist < 9) && aligned < 0.6; continue; }
      if (w.kind === 'pulse') { fire[side] = o.los && dist < w.range - 0.5 && aligned < P.pAlign && (me.energy >= w.energy + (me.energy > 70 ? 0 : P.pReserve) || foeStill); continue; }
      if (w.kind === 'lance') { fire[side] = dist > 4 && dist < w.range && aligned < 0.08 && api.clearAhead(dir.x, dir.z, dist) >= dist - 1; continue; }
      fire[side] = dist < w.range && aligned < (MELEE.has(w.kind) ? 0.35 : w.kind === 'missile' ? 0.6 : 0.12);
    }
    return { move: { x: mx, z: mz }, aimYaw, fire, back, boost, note: boost ? '閃' : mode };
  },
};
