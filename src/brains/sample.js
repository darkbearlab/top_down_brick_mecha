// ---------- 範例大腦 ----------
// 寫大腦的參考：保持在武器射程裡、繞圈、看到重彈 / 飛彈飛來就往旁邊推進、能打就打
// 介面見 tools/sim/BRAINS.md
const MELEE = new Set(['saber', 'pile', 'flame']);

export default {
  name: 'sample',
  init(mem) { mem.strafe = 1; mem.flip = 2; },
  think(o, mem, api) {
    const { me, foe, dist, dir } = o;
    const W = me.weapons;
    const ok = s => W[s] && !W[s].broken && W[s].ammo > 0 && W[s].kind !== 'shield';
    // 每一邊：手臂武器能用就用手臂；手臂不能用、或敵人在手臂射程外而背部打得到 → 架背部
    const back = {};
    for (const side of ['L', 'R']) {
      const arm = 'arm' + side, bk = 'back' + side;
      if (!ok(bk)) { back[side] = false; continue; }
      back[side] = !ok(arm) || (dist > W[arm].range * 0.9 && dist < W[bk].range);
    }
    // 想站的距離：用得到的武器裡最短的射程 × 0.6（近戰 2 格）
    let want = 9;
    for (const s in W) if (ok(s)) want = Math.min(want, MELEE.has(W[s].kind) ? 2 : W[s].kind === 'lance' ? 7 : W[s].range * 0.6);
    // 移動：太遠靠近、太近後退，再加上繞圈
    if ((mem.flip -= o.dt) <= 0) { mem.flip = 2 + Math.random() * 2; if (Math.random() < 0.4) mem.strafe *= -1; }
    const radial = dist > want + 1.5 ? 1 : dist < want - 1.5 ? -1 : 0;
    let mx = dir.x * radial - dir.z * mem.strafe * 0.8, mz = dir.z * radial + dir.x * mem.strafe * 0.8;
    if (!o.los) { mx = dir.x; mz = dir.z; }   // 看不到：直接過去
    ({ mx, mz } = api.steer(mx, mz));
    // 閃：0.6 秒內會打到（偏差 1.2 格內）的重彈 / 飛彈 / 拋射物 → 往垂直方向推進
    let boost = null;
    const threat = o.incoming.find(s => (s.heavy || s.kind !== 'bullet' || s.dmg > 25) && s.tti != null && s.tti < 0.6 && s.miss < 1.2);
    if (threat && me.canBoost && me.energy > 40) {
      const side = (me.x - threat.x) * threat.uz - (me.z - threat.z) * threat.ux > 0 ? 1 : -1;
      const bx = threat.uz * side, bz = -threat.ux * side;
      if (api.clearAhead(bx, bz, api.boostLen(bx, bz)) >= api.boostLen(bx, bz)) boost = { x: bx, z: bz };
    }
    // 瞄準：照右手（沒有就左手）現在準備的武器預判
    const main = ['R', 'L'].map(s => (me.ready[s] ? 'back' : 'arm') + s).find(ok) ?? 'armR';
    const aimYaw = api.leadYaw(main);
    const aligned = Math.abs(api.angleDiff(me.yaw, aimYaw));
    // 開火：每一邊現在準備的那把，射程內、射線通、對準了才打
    const fire = {};
    for (const side of ['L', 'R']) {
      const s = (me.ready[side] ? 'back' : 'arm') + side, w = W[s];
      if (!ok(s) || !w.live) continue;
      if (w.needLock && !o.lock.locked) continue;
      if (w.kind === 'lance') { fire[side] = dist > 4 && dist < w.range && aligned < 0.08 && api.clearAhead(dir.x, dir.z, dist) >= dist - 1; continue; }
      fire[side] = dist < w.range && o.lineClear[s] && aligned < (MELEE.has(w.kind) ? 0.35 : w.kind === 'missile' || w.kind === 'vmissile' ? 0.6 : 0.12);
    }
    return { move: { x: mx, z: mz }, aimYaw, fire, back, boost, note: radial > 0 ? '接近' : radial < 0 ? '拉開' : '繞圈' };
  },
};
