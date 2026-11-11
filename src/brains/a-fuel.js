// ---------- a-fuel 油龍（alpha，汽油投射器專用） ----------
// 個性：中距離「澆油」。汽油投射器的燃料一顆一顆飛（約 24 格/秒、約 10 格落地），只打中路線上第一台
//   → 不像火焰噴射器一次燒一整片；它的長處是：
//   1. 掃：燃燒每台每層 3.2/秒、最多 5 層、燒 3 秒 → 同時把好幾台點到滿層比一直澆同一台划算
//      記每台敵人「大概燒了幾層」（自己算：瞄著、它是射線上第一台 → 每秒 +0.22×17 層），燒滿就甩到下一台，
//      甩的途中整條火舌掃過中間那幾台
//   2. 油灘：沒打中的燃料在 ~10 格處落地變成火灘 → 射手 / 近戰從那邊過來要踩過去
//   3. 距離：保持在最近的敵人 7–9 格（燃料打得到、大部分雜魚的近戰 / 霰彈打不到）
// 右手機砲：跟著同一個方向打（燃料打不到的 10 格外也有輸出）；右背燒夷彈：遠處敵群 / 衝過來的近戰前面
// 左背直射飛彈：燃料打不到（> 10.5 格）、鎖得到 → 收起油槍改打飛彈
// 火牆（燒夷彈丟在追兵前面）只對雜魚 / 多台 / 劍類：單挑王牌時右邊一直換燒夷彈 = 機砲停火（對火焰型 4/40 → 35/40）
// 同一個大腦也能開火焰噴射器（對照用：距離改成 4.5、射程 5.8）
// 介面見 tools/sim/BRAINS.md；共用工具 lib-alpha.js
import { ok, activeOf, leadPoint, clearLine, dangerOf, dangerAt, dodge, navToSee, pickDir, hpOf } from './lib-alpha.js';

export const P = {
  keep: 8.0,        // 想跟最近的敵人保持的距離
  keepMelee: 8.5,   // 最近的是近戰 / 自爆 / 衝鋒 → 再遠一點
  reach: 10.0,      // 燃料打得到的距離（range 10、拋物線最遠 ~10.5）
  sat: 4.2,         // 估計燃燒層數到這個就換下一台
  stackRate: 3.4,   // 每秒疊幾層（0.22 × 17）
  napT: 0.75,
  mslR: 10.8,       // 最近的敵人比這遠 → 左邊換飛彈
};

const HOSE = new Set(['stream', 'flame']);
const isRusher = k => k === 'bug' || k === 'blade' || k === 'brawler' || k === 'bomber' || k === 'charger';

export default {
  name: 'a-fuel',
  init(mem) { mem.heat = {}; mem.tid = null; mem.strafe = Math.random() < 0.5 ? 1 : -1; mem.flip = 2; },
  think(o, mem, api) {
    const { me } = o, W = me.weapons, dt = o.dt;
    const E = o.enemies.length ? o.enemies : [o.foe];
    for (const e of E) e._D = dangerOf(e);
    const near = E[0];
    if ((mem.flip -= dt) <= 0) { mem.flip = 1.5 + Math.random() * 2; if (Math.random() < 0.35) mem.strafe *= -1; }

    // ---- 燃燒估計：衰減（燃燒 3 秒，層數在最後一下之後 3 秒消失；簡化成每秒掉 1.2 層） ----
    for (const id in mem.heat) { mem.heat[id] -= dt * 1.2; if (mem.heat[id] <= 0) delete mem.heat[id]; }
    const heat = e => mem.heat[e.id] ?? 0;

    const fuelS = ['armL', 'armR'].filter(s => ok(W, s) && HOSE.has(W[s].kind));
    // 對照用：同一個大腦拿火焰噴射器（6 格扇形）→ 距離改短
    const flameMode = !fuelS.some(s => W[s].kind === 'stream') && fuelS.length > 0;
    const fr = flameMode ? W[fuelS[0]].range ?? 6 : 6;   // 火焰噴射器的射程（數值會調）
    const REACH = flameMode ? fr - 0.2 : P.reach, KEEP = flameMode ? fr - 1.5 : fuelS.length ? P.keep : 8, KEEPM = flameMode ? fr - 1.5 : fuelS.length ? P.keepMelee : 8.5;
    const see = e => e._see ?? (e._see = clearLine(api, me.x, me.z, e.x, e.z, 0.6));

    // ---- 油槍的目標：射程內看得到的敵人；優先：沒燒滿、威脅大、血少、在甩得過去的角度 ----
    const curYaw = me.yaw;
    let tgt = null, best = -1e9;
    const cur = E.find(e => e.id === mem.tid);
    for (const e of E) {
      if (e.dist > REACH + 0.6) break;
      if (!see(e)) continue;
      const y = Math.atan2(e.x - me.x, e.z - me.z), ad = Math.abs(api.angleDiff(curYaw, y));
      const D = e._D;
      let sc = 0;
      sc += Math.min(60, D.dps) / 20;                             // 威脅
      if (D.kind === 'bomber') sc += 6 - e.dist * 0.4;            // 自爆機：先燒掉
      if (isRusher(D.kind)) sc += Math.max(0, 7 - e.dist) * 0.5;  // 貼過來的近戰
      sc += (1 - Math.min(1, heat(e) / P.sat)) * 3;               // 還沒燒滿
      if (heat(e) >= P.sat && D.kind !== 'bomber') sc -= 2.5;
      sc -= ad * 1.2;                                             // 甩過去要時間
      sc -= e.dist * 0.12;
      if (hpOf(e) < 40) sc += 1;
      if (e === cur) sc += heat(e) < P.sat ? 1.5 : 0;             // 黏著直到燒滿
      if (sc > best) { best = sc; tgt = e; }
    }
    if (tgt) mem.tid = tgt.id;

    // ---- 燒夷彈落點（右背）：遠處 2 台以上擠在一起 / 衝過來的近戰前面 ----
    const napS = ['backL', 'backR'].find(s => ok(W, s) && W[s].kind === 'napalm');
    let napPt = null, napWhy = null;
    if (napS) {
      let bn = 1.6;
      for (const c of E) {
        if (c._D.kind === 'bomber') continue;
        const px = c.x + c.vx * P.napT, pz = c.z + c.vz * P.napT, d = Math.hypot(px - me.x, pz - me.z);
        if (d > 15.5 || d < 6) continue;
        let n = 0;
        for (const e of E) if (Math.hypot(e.x + e.vx * P.napT - px, e.z + e.vz * P.napT - pz) < 2.6) n += e._D.kind === 'bug' ? 1.4 : 1;
        if (o.zones.some(z => z.mine && Math.hypot(z.x - px, z.z - pz) < z.r + 0.5 && z.t > 1.5)) n -= 1.5;
        if (n > bn) { bn = n; napPt = { x: px, z: pz }; napWhy = '燒夷彈'; }
      }
      const r = E.find(e => (e.grunt || E.length > 1 || e._D.kind === 'blade') && isRusher(e._D.kind) && e._D.kind !== 'bomber' && e.dist > 4.5 && e.dist < 11 && ((me.x - e.x) * e.vx + (me.z - e.z) * e.vz) > 1.5 * e.dist);
      if (!napPt && r) {
        const k = Math.max(3.5, r.dist * 0.6), ux = (r.x - me.x) / r.dist, uz = (r.z - me.z) / r.dist;
        const px = me.x + ux * k, pz = me.z + uz * k;
        if (!o.zones.some(z => z.mine && Math.hypot(z.x - px, z.z - pz) < z.r && z.t > 1.2)) { napPt = { x: px, z: pz }; napWhy = '火牆'; }
      }
    }

    // ---- 武器切換 ----
    //   油槍那一邊：射程內有東西就用油槍；最近的都 > mslR → 換飛彈
    //   另一邊（機砲）：有好的燒夷彈落點、而且燃料目標不在（或自己是遠距離）→ 架燒夷彈丟一顆
    const back = {};
    const nd = near.dist;
    for (const side of ['L', 'R']) {
      const arm = 'arm' + side, bk = 'back' + side;
      if (!ok(W, bk)) { back[side] = false; continue; }
      if (!ok(W, arm)) { back[side] = true; continue; }
      const k = W[bk].kind, ak = W[arm].kind;
      if (k === 'napalm') {
        mem.napHold = (mem.napHold ?? 0) - dt;
        if (napPt && (W[bk].cd ?? 0) <= 0.4 && !(HOSE.has(ak) && tgt)) mem.napHold = 0.9;
        back[side] = mem.napHold > 0;
      } else if (k === 'missile' || k === 'vmissile' || k === 'rocket') {
        if (HOSE.has(ak)) back[side] = !tgt && nd > P.mslR;
        else back[side] = nd > 13;
      } else back[side] = false;
    }

    // ---- 瞄準 ----
    let aimAt, aimYaw, why = null;
    const actS = ['L', 'R'].map(sd => activeOf(me, sd));
    const fuelActive = actS.some(s => ok(W, s) && HOSE.has(W[s].kind));
    const napReady = napS && actS.includes(napS) && napPt && (W[napS].cd ?? 0) <= 0.05 && !me.deploying[napS.slice(-1)];
    if (tgt && fuelActive) {
      // 燃料飛行時間：距離 / 24（加上自己速度的 0.4 → 差不多）
      const tt = tgt.dist / 24;   // （試過往機砲的預判靠：沒有比較好）
      aimAt = { x: tgt.x + tgt.vx * tt, z: tgt.z + tgt.vz * tt };
      why = heat(tgt) >= P.sat ? '澆油（滿）' : '澆油';
    } else {
      const armS = actS.find(s => ok(W, s) && W[s].kind === 'bullet');
      const t = near;
      if (armS) { const L = leadPoint(me, t, W[armS]); aimAt = { x: L.x, z: L.z }; }
      else aimAt = { x: t.x, z: t.z };
    }
    aimYaw = Math.atan2(aimAt.x - me.x, aimAt.z - me.z);
    const al = Math.abs(api.angleDiff(me.yaw, aimYaw));

    // 燃料這一幀打到誰：上半身方向射線上第一台（2D）→ 那台的燃燒估計 +
    const fy = me.yaw, fx = Math.sin(fy), fz = Math.cos(fy);
    let firstHit = null, fh = 99;
    for (const e of E) {
      if (e.dist > REACH + 0.5) break;
      const t = (e.x - me.x) * fx + (e.z - me.z) * fz; if (t < 0) continue;
      const px = Math.abs((e.x - me.x) * fz - (e.z - me.z) * fx);
      if (px < e.r + 0.15 && t < fh) { fh = t; firstHit = e; }
    }

    const fire = {};
    let shot = null;
    for (const side of ['L', 'R']) {
      const s = activeOf(me, side), w = W[s];
      if (!ok(W, s) || !w.live || me.deploying[side]) continue;
      if (HOSE.has(w.kind)) {
        // 有目標、差不多對準就噴（甩過去的途中也噴：一路掃過去）；沒目標但最近的在 11 格內也噴（鋪油灘）
        fire[side] = !!tgt && al < 0.9 || (!tgt && nd < 11.5 && see(near) && al < 0.4);
        if (fire[side]) { shot = why ?? '鋪油'; if (firstHit) mem.heat[firstHit.id] = Math.min(5.5, heat(firstHit) + P.stackRate * dt * (fuelS.length)); }
      } else if (w.kind === 'napalm') {
        fire[side] = !!napReady && !!napPt;
        if (fire[side]) { aimAt = napPt; shot = napWhy; }
      } else if (w.kind === 'missile' || w.kind === 'vmissile') {
        fire[side] = o.lock.locked;
        if (fire[side]) shot = '飛彈';
      } else if (w.kind === 'rocket') {
        fire[side] = see(near) && al < 0.12 && nd < 20;
      } else {
        const t = tgt ?? near;
        fire[side] = see(t) && t.dist < (w.range ?? 15) && al < 0.2;
        if (fire[side] && !shot) shot = '機砲';
      }
    }
    // 燒夷彈是拋到 aimAt：用 aimAt 決定落點、但上半身照 aimYaw（燃料的方向）
    const lobAt = fire.R && activeOf(me, 'R') === napS || fire.L && activeOf(me, 'L') === napS ? napPt : null;

    // ---- 移動：保持 keep 格、少被看到、不要背靠牆；被近戰追就往後退（追兵走過油灘） ----
    const rushers = E.filter(e => isRusher(e._D.kind) && e.dist < 9);
    const want = rushers.length ? KEEPM : KEEP;
    const score = (px, pz, ux, uz) => {
      let sc = 0, dmin = 99;
      for (const e of E) dmin = Math.min(dmin, Math.hypot(e.x - px, e.z - pz) - (isRusher(e._D.kind) ? 1.5 : 0));
      sc -= Math.abs(dmin - want) * (dmin < want ? 1.0 : 0.35);
      sc -= dangerAt(o, api, px, pz, { meleeR: 6 }) / 20;
      // 目標要還在射程、看得到
      if (tgt) { const d = Math.hypot(tgt.x - px, tgt.z - pz); if (d > REACH) sc -= (d - REACH) * 0.8; if (!clearLine(api, px, pz, tgt.x, tgt.z)) sc -= 1.5; }
      // 敵人的火海 / 酸池
      for (const z of o.zones) if (!z.mine && Math.hypot(z.x - px, z.z - pz) < z.r + 0.8) sc -= 4;
      // 有空間（不要被逼到角落）
      sc += Math.min(api.rayBlock(px, pz, ux, uz, 6), 6) * 0.18;
      // 橫移加分（燃料拖出一條弧、躲子彈）
      if (tgt) { const tx = tgt.x - me.x, tz = tgt.z - me.z, L = Math.hypot(tx, tz) || 1; sc += Math.abs((ux * tz - uz * tx) / L) * 0.4 + ((ux * tz - uz * tx) / L * mem.strafe > 0 ? 0.3 : 0); }
      return sc;
    };
    let mode;
    const d = pickDir(o, api, mem, score, 0.25);
    let mx = d.x, mz = d.z;
    if (!tgt && !see(near) && nd > 6) { const n = navToSee(o, api, mem, near.x, near.z, 0.5); mx = n.x; mz = n.z; mode = '找射線'; }
    else mode = rushers.length ? '後退引火' : '繞圈澆油';
    ({ mx, mz } = api.steer(mx, mz));

    // ---- 推進：閃重彈 / 近戰、自爆貼上來就推開 ----
    let boost = null;
    const dg = dodge(o, api, mem, { minE: 30, minDmg: 25 });
    if (dg) { boost = { x: dg.x, z: dg.z }; mode = dg.why; }
    else if (me.canBoost && me.boostCd <= 0 && me.energy >= 40) {
      const r = E.find(e => (e._D.kind === 'bomber' && e.dist < 4.5) || (isRusher(e._D.kind) && e._D.kind !== 'bomber' && e.dist < 3.2));
      if (r) {
        const ux0 = (r.x - me.x) / (r.dist || 1), uz0 = (r.z - me.z) / (r.dist || 1);
        const bd = pickDir(o, api, { _pdT: 0 }, (px, pz, ux, uz) => score(px, pz, ux, uz) - (ux * ux0 + uz * uz0) * 3 + api.boostLen(ux, uz) * 0.2, 0, 6);
        boost = { x: bd.x, z: bd.z }; mode = '推進拉開';
      }
    }

    const act = { move: { x: mx, z: mz }, aimYaw, fire, back, boost, note: shot && !boost ? shot : mode };
    if (lobAt) act.aimAt = lobAt;
    act.target = tgt ? tgt.id : null;
    return act;
  },
};
