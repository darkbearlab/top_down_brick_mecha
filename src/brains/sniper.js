// ---------- sniper 狙擊手 ----------
// 個性：遠遠架槍。挑落單 / 一槍打得死 / 會還手的遠程（狙擊、砲車）當目標，預判走位開槍；
//   開完一槍就換位（側滑，必要時推進），永遠跟最近的敵人保持 ~20 格；敵人貼近 → 往後撤（不戀戰），飛彈只拿來自衛
// 介面見 tools/sim/BRAINS.md；共用工具 lib-alpha.js
import { ok, activeOf, leadPoint, clearLine, dangerOf, hpOf, buddies, dangerAt, dodge, navToSee, pickDir, centroid } from './lib-alpha.js';

const EFF = { composite: 0.65, ceramic: 1, mirror: 1.4 };   // 動能打各種裝甲
export const P = { keep: 20, close: 11, align: 0.03, relocT: 0.9, missileR: 13, relocBoost: true };

export default {
  name: 'sniper',
  init(mem) { mem.tid = null; mem.relocT = 0; mem.side = Math.random() < 0.5 ? 1 : -1; mem.shots = 0; },
  think(o, mem, api) {
    const { me } = o;
    const W = me.weapons, dt = o.dt;
    const E = o.enemies.length ? o.enemies : [o.foe];
    for (const e of E) e._D = dangerOf(e);
    const near = E[0], nd = Math.hypot(near.x - me.x, near.z - me.z);
    const rifles = ['armL', 'armR'].filter(s => ok(W, s) && W[s].id === 'sniper');
    const rifleW = rifles.length ? W[rifles[0]] : null;

    // ---- 挑目標：看得到、一槍死、落單、會遠程還手 ----
    let tgt = null, best = -1e9;
    for (const e of E) {
      const d = Math.hypot(e.x - me.x, e.z - me.z);
      if (d > 36) continue;
      if (!clearLine(api, me.x, me.z, e.x, e.z, 0.6)) continue;
      const eff = 55 * (EFF[e.hp.torso?.armor] ?? 1);
      const shotsToKill = Math.ceil(hpOf(e) / eff);
      const v = Math.hypot(e.vx, e.vz);
      let sc = -shotsToKill * 2 - d * 0.08 - v * 0.25;
      if (buddies(o, e, 7) === 0) sc += 2;               // 落單的
      if (['marksman', 'lobber'].includes(e._D.kind)) sc += 2.5;   // 會從遠處打我的先清
      if (e._D.kind === 'bomber' && d < 14) sc += 4;      // 自爆機衝過來：先打掉
      if (e._D.kind === 'charger' && d < 18) sc += 1.5;
      sc += Math.min(e._D.dps, 60) / 30;
      if (d < 9) sc += 2;                                // 貼太近的威脅
      if (e.id === mem.tid) sc += 1.5;
      if (sc > best) { best = sc; tgt = e; }
    }
    if (tgt && tgt.id !== mem.tid) mem.tid = tgt.id;
    const T = tgt ?? near;
    const tdist = Math.hypot(T.x - me.x, T.z - me.z) || 1e-6;
    const tdir = { x: (T.x - me.x) / tdist, z: (T.z - me.z) / tdist };

    // ---- 武器：飛彈只在敵人貼近（自衛）或狙擊彈打光時架起來 ----
    const noRifle = rifles.length === 0;
    const selfDef = nd < P.missileR;
    const back = {};
    for (const side of ['L', 'R']) {
      const arm = 'arm' + side, bk = 'back' + side;
      if (!ok(W, bk)) { back[side] = false; continue; }
      if (!ok(W, arm)) { back[side] = true; continue; }
      back[side] = noRifle || (selfDef && W[arm].id !== 'sniper') || (selfDef && rifles.length === 2 && side === 'L' && nd < 8);
    }

    // ---- 移動：保持距離、換位、躲危險 ----
    let mode, mx = 0, mz = 0;
    mem.relocT -= dt;
    const C = centroid(E);
    const want = noRifle ? 14 : P.keep;
    const score = (px, pz, ux, uz) => {
      let sc = 0;
      let dmin = 99;
      for (const e of E) dmin = Math.min(dmin, Math.hypot(e.x - px, e.z - pz));
      sc -= Math.abs(dmin - want) * (dmin < want ? 0.7 : 0.25);
      sc -= dangerAt(o, api, px, pz, { meleeR: 6 }) / 25;
      if (tgt && !clearLine(api, px, pz, tgt.x, tgt.z, 0.6)) sc -= 2.5;   // 換完位置還要看得到目標
      // 換位：往側邊滑（不要一直退到牆角）
      if (mem.relocT > 0) sc += (ux * -tdir.z + uz * tdir.x) * mem.side * 2;
      // 別被逼到牆角：四面八方空間
      const room = Math.min(api.rayBlock(px, pz, ux, uz, 6), 6);
      sc += room * 0.15;
      return sc;
    };
    if (!tgt && !o.los) {
      const n = navToSee(o, api, mem, near.x, near.z, 0); mx = n.x; mz = n.z; mode = '找射線';
    } else {
      const d = pickDir(o, api, mem, score, 0.25);
      mx = d.x; mz = d.z;
      mode = nd < P.close ? '後撤拉開' : mem.relocT > 0 ? '換位' : '架槍';
      // 架槍：距離剛好又安全 → 慢慢走（看起來在瞄準）
      if (mode === '架槍' && Math.abs(nd - want) < 3) { mx *= 0.35; mz *= 0.35; }
    }
    ({ mx, mz } = api.steer(mx, mz));

    // ---- 推進：閃 / 被貼近就往後推 / 開槍後側滑換位 ----
    let boost = null;
    const dg = dodge(o, api, mem, { minE: 30, minDmg: 25 });
    if (dg) { boost = { x: dg.x, z: dg.z }; mode = dg.why; }
    else if (me.canBoost && me.boostCd <= 0 && me.energy >= 60) {
      const melee = E.find(e => e.dist < 6 && ['bug', 'blade', 'brawler', 'bomber', 'charger'].includes(e._D.kind));
      if (melee || nd < 5) {
        const d = pickDir(o, api, { _pdT: 0 }, (px, pz, ux, uz) => score(px, pz, ux, uz) + api.boostLen(ux, uz) * 0.2 - (ux * (near.x - me.x) + uz * (near.z - me.z)) / nd * 3, 0, 6);
        if (d.sc > -1e8) { boost = { x: d.x, z: d.z }; mode = '推進脫離'; }
      } else if (P.relocBoost && mem.relocT > 0.6 && me.energy >= 80) {
        const bx = -tdir.z * mem.side, bz = tdir.x * mem.side, L = api.boostLen(bx, bz);
        if (api.clearAhead(bx, bz, L) >= L * 0.9) { boost = { x: bx, z: bz }; mode = '側滑換位'; }
      }
    }

    // ---- 瞄準：預判目標走位 ----
    const act = ['L', 'R'].map(sd => activeOf(me, sd)).filter(s => ok(W, s));
    const rS = act.find(s => W[s].id === 'sniper' && (W[s].cd ?? 0) < 0.4) ?? act.find(s => W[s].id === 'sniper');
    const mainW = rS ? W[rS] : W[act[0]];
    // 目標推進中 / 速度變化大：預判打折
    const L = leadPoint(me, T, mainW, 1);
    const aimYaw = Math.atan2(L.x - me.x, L.z - me.z);
    const aligned = Math.abs(api.angleDiff(me.yaw, aimYaw));
    // 打得中嗎：飛行時間 × 對方橫向速度 不能太大
    const lat = Math.abs(T.vx * -tdir.z + T.vz * tdir.x);
    const hitOk = T.staggered || lat * L.tt < 1.6 || tdist < 12;

    // ---- 開火 ----
    const fire = {};
    let shot = null;
    for (const side of ['L', 'R']) {
      const s = activeOf(me, side), w = W[s];
      if (!ok(W, s) || !w.live || me.deploying[side]) continue;
      if (w.id === 'sniper') {
        // 一次只開一槍（兩把輪流），開完換位
        const other = 'arm' + (side === 'L' ? 'R' : 'L');
        const otherJust = W[other]?.id === 'sniper' && (W[other].cd ?? 0) > w.interval - 0.35;
        fire[side] = !!tgt && hitOk && aligned < P.align && tdist < w.range - 1 && !otherJust && !me.boosting;
        if (fire[side]) { shot = '狙擊'; mem.relocT = P.relocT; if (++mem.shots % 2 === 0) mem.side *= Math.random() < 0.5 ? -1 : 1; }
        continue;
      }
      if (w.kind === 'missile' || w.kind === 'vmissile') { fire[side] = o.lock.locked && o.dist < w.range && Math.abs(api.angleDiff(me.yaw, Math.atan2(o.dir.x, o.dir.z))) < 0.8; if (fire[side]) shot = '飛彈自衛'; continue; }
      fire[side] = !!tgt && aligned < 0.12 && tdist < w.range;
    }
    // 飛彈自衛時上半身要轉向最近的敵人（鎖定只鎖最近那台）
    let yaw = aimYaw;
    if (!rS && (back.L || back.R) && o.foe) yaw = Math.atan2(o.foe.x - me.x, o.foe.z - me.z);
    return { move: { x: mx, z: mz }, aimYaw: yaw, fire, back, boost, note: shot && !boost ? shot : mode };
  },
};
