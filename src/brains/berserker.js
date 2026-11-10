// ---------- berserker 狂戰士 ----------
// 個性：衝進去、臉貼臉打。挑「砍得死」的獵物（近、血少、落單），火箭開路 → 推進突進 → 光束劍掃 / 打樁拳一拳打爆
//   砍完一台馬上咬下一台（連殺）；被包圍不退，往包圍圈最薄的那一邊殺出去
// 介面見 tools/sim/BRAINS.md；共用工具 lib-alpha.js
import { MELEE, ok, activeOf, leadPoint, clearLine, dangerOf, hpOf, buddies, dangerAt, dodge, navToSee, pickDir } from './lib-alpha.js';

// 火箭飛到 d 格要幾秒（初速 24、加速 30、最快 38；電腦方子彈減速不吃在火箭上）
function rocketT(d) {
  const tA = (38 - 24) / 30, dA = 24 * tA + 15 * tA * tA;
  if (d <= dA) return (-24 + Math.sqrt(576 + 60 * d)) / 30;
  return tA + (d - dA) / 38;
}
export const P = { melee: 5.5, gap: 12, rocketMax: 9, keep: 3.0, bud: 1.6, dpsK: 15 };

export default {
  name: 'berserker',
  init(mem) { mem.tid = null; mem.zig = 1; mem.zigT = 0.6; mem.kills = 0; mem.lastN = null; },
  think(o, mem, api) {
    const { me } = o;
    const W = me.weapons, dt = o.dt;
    const E = o.enemies.length ? o.enemies : [o.foe];
    if (mem.lastN != null && E.length < mem.lastN) mem.kills += mem.lastN - E.length;
    mem.lastN = E.length;
    for (const e of E) e._D = dangerOf(e);

    // ---- 挑獵物：近、血少、落單、會打遠的優先；自爆機別用劍砍 ----
    let tgt = null, best = 1e9;
    for (const e of E) {
      const d = e.dist ?? Math.hypot(e.x - me.x, e.z - me.z);
      let sc = d + hpOf(e) / 35 + buddies(o, e, 6) * P.bud - Math.min(e._D.dps, 80) / P.dpsK;
      if (['marksman', 'lobber', 'rocket'].includes(e._D.kind)) sc -= 2;
      if (e._D.kind === 'bomber') sc += 6;
      if (!clearLine(api, me.x, me.z, e.x, e.z)) sc += 5;
      if (e.id === mem.tid) sc -= 3;   // 咬住了就不放
      if (sc < best) { best = sc; tgt = e; }
    }
    if (tgt.id !== mem.tid) { mem.tid = tgt.id; mem.newT = o.t; }
    const tx = tgt.x, tz = tgt.z, dist = Math.hypot(tx - me.x, tz - me.z) || 1e-6;
    const dir = { x: (tx - me.x) / dist, z: (tz - me.z) / dist };
    const see = clearLine(api, me.x, me.z, tx, tz);

    // ---- 武器：遠 → 火箭開路；近 → 劍 / 樁 ----
    const rkt = s => ok(W, s) && W[s].kind === 'rocket';
    const back = {};
    for (const side of ['L', 'R']) {
      const arm = 'arm' + side, bk = 'back' + side;
      if (!ok(W, bk)) { back[side] = false; continue; }
      if (!ok(W, arm)) { back[side] = true; continue; }
      // 火箭：距離夠遠才架（近身換回手臂）；對方是自爆機 → 架火箭在外面打
      back[side] = (dist > P.melee && dist < P.rocketMax + 4) || (tgt._D.kind === 'bomber' && dist > 3);
    }

    // ---- 移動：直直衝向獵物（遠的時候小幅之字閃子彈），看不到就繞 ----
    if ((mem.zigT -= dt) <= 0) { mem.zigT = 0.5 + Math.random() * 0.6; mem.zig *= -1; }
    let mx, mz, mode;
    const crowd = E.filter(e => e.dist < 6).length;
    if (tgt._D.kind === 'bomber' && dist < 5) {
      // 自爆機貼上來：往外拉開，用火箭打
      mx = -dir.x; mz = -dir.z; mode = '躲自爆機';
    } else if (!see) {
      const n = navToSee(o, api, mem, tx, tz, 2); mx = n.x; mz = n.z; mode = '繞過去找獵物';
    } else if (dist > P.keep) {
      const zz = dist > 7 ? 0.45 * mem.zig : 0;
      mx = dir.x - dir.z * zz; mz = dir.z + dir.x * zz; mode = dist > 8 ? '衝鋒' : '逼近';
    } else {
      // 貼臉：繞著獵物轉（往包圍薄的那一邊），一直打
      const s = mem.zig;
      mx = -dir.z * s * 0.7 + dir.x * 0.3; mz = dir.x * s * 0.7 + dir.z * 0.3; mode = '貼臉纏鬥';
    }
    // 被包圍（6 格內 4 台以上）而且血不多：往包圍最薄、又靠近獵物的方向殺出去
    if (crowd >= 4 && me.hpFrac < 0.6) {
      const d = pickDir(o, api, mem, (px, pz, ux, uz) => -dangerAt(o, api, px, pz) / 20 + (ux * dir.x + uz * dir.z) * 1.2, 0.3);
      mx = d.x; mz = d.z; mode = '殺出重圍';
    }
    ({ mx, mz } = api.steer(mx, mz));

    // ---- 推進：閃重彈優先，再來是突進（拉近距離） ----
    let boost = null;
    const dg = dodge(o, api, mem, { minE: 30, missiles: me.hpFrac < 0.5 });
    if (dg) { boost = { x: dg.x, z: dg.z }; mode = dg.why; }
    else if (see && dist > 4.5 && dist < 11 && me.canBoost && me.boostCd <= 0 && me.energy >= 45 && tgt._D.kind !== 'bomber') {
      const L = api.boostLen(dir.x, dir.z);
      if (api.clearAhead(dir.x, dir.z, Math.min(L, dist)) >= Math.min(L, dist - 1.5)) { boost = { x: dir.x, z: dir.z }; mode = '突進！'; }
    }

    // ---- 瞄準 ----
    const act = ['L', 'R'].map(sd => activeOf(me, sd)).filter(s => ok(W, s));
    const rS = act.find(s => W[s].kind === 'rocket');
    let aim;
    if (rS) { const t = Math.min(1.0, rocketT(dist)); aim = { x: tx + tgt.vx * t, z: tz + tgt.vz * t }; }
    else aim = { x: tx + tgt.vx * 0.12, z: tz + tgt.vz * 0.12 };
    const aimYaw = Math.atan2(aim.x - me.x, aim.z - me.z);
    const aligned = Math.abs(api.angleDiff(me.yaw, aimYaw));

    // ---- 開火 ----
    const fire = {};
    let hit = null;
    for (const side of ['L', 'R']) {
      const s = activeOf(me, side), w = W[s];
      if (!ok(W, s) || !w.live || me.deploying[side]) continue;
      if (w.kind === 'rocket') {
        
        const good = dist < 7 || tgt.staggered;   // 火箭只在快貼上 / 對方失衡時打（主力是劍和樁）
        fire[side] = see && good && dist < P.rocketMax + 3 && aligned < 0.1;
        if (fire[side]) hit = '火箭開路';
        continue;
      }
      if (w.kind === 'pile') {
        fire[side] = dist < w.range && aligned < 0.28;
        if (fire[side]) hit = '打樁！';
        continue;
      }
      if (w.kind === 'saber') {
        fire[side] = dist < w.range + 0.8 && aligned < 0.45 && me.energy >= 15;
        if (fire[side]) hit = '光束劍劈砍';
        continue;
      }
      fire[side] = see && dist < w.range && aligned < (MELEE.has(w.kind) ? 0.35 : 0.12);
    }
    const note = hit && !boost ? hit : mode;
    return { move: { x: mx, z: mz }, aimYaw, fire, back, boost, note };
  },
};
