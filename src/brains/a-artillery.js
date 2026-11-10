// ---------- a-artillery 團隊版重砲手（alpha 2v2；從 artillery 複製來改） ----------
// 團隊（有隊友時才開）：
//   - 跟隊友用同一套評分挑集火目標（act.target）→ 垂直飛彈鎖它「集火」
//   - 站位：跟隊友對目標拉夾角（交叉火網）、彼此隔開；鎖定距離算到集火目標
//   - 燒夷彈：貼近隊友的敵人 → 丟在牠腳下「燒夷掩護」（把人從隊友身上燒開）
// 沒隊友（雜魚關卡）→ 跟原版一樣
// 個性：躲在掩體後面打。垂直飛彈（長距鎖定頭隔牆也鎖得到）從牆後面越過去打；燒夷彈丟在敵人堆裡、
//   或丟在衝過來的敵人前面封路；一直跟敵人隔著距離（最好隔著一面牆），被貼近才用手臂自衛
// 介面見 tools/sim/BRAINS.md；共用工具 lib-alpha.js
import { MELEE, ok, activeOf, leadPoint, clearLine, dangerOf, dangerAt, dodge, navToSee, pickDir, centroid } from './lib-alpha.js';
import { focusPick, crossAngle, teamNote } from './lib-a-team.js';

export const P = { keep: 16, close: 8, cover: 1.2, napT: 0.75, pkeep: +(globalThis.process?.env?.A_APKEEP ?? 10), cross: +(globalThis.process?.env?.A_CROSS ?? 0.8) };

export default {
  name: 'a-artillery',
  init(mem) { mem.napCd = 0; },
  think(o, mem, api) {
    const { me } = o;
    const W = me.weapons, dt = o.dt;
    const E = o.enemies.length ? o.enemies : [o.foe];
    for (const e of E) e._D = dangerOf(e);
    const near = E[0], nd = Math.hypot(near.x - me.x, near.z - me.z) || 1e-6;
    const ndir = { x: (near.x - me.x) / nd, z: (near.z - me.z) / nd };
    const nearSee = clearLine(api, me.x, me.z, near.x, near.z);
    const F = focusPick(o, mem, { type: 'chemical' });
    const tgt = F ? F.e : null, ally = o.allies?.[0];
    let tag = '';
    // 包夾收尾：只剩一台敵人、隊友還活著 → 出掩體、縮到機砲距離、跟隊友從兩邊夾
    const pincer = !!(tgt && ally && E.length === 1);
    const keep = pincer ? P.pkeep : P.keep;
    const rushers = E.filter(e => ['bug', 'blade', 'brawler', 'bomber', 'charger'].includes(e._D.kind) && e.dist < 12);

    // ---- 燒夷彈的落點：敵人最多的地方（照 0.75 秒後的位置）；衝過來的近戰 → 丟在牠前面封路 ----
    const napS = ['backL', 'backR'].find(s => ok(W, s) && W[s].kind === 'napalm');
    let napPt = null, napWhy = null;
    if (napS) {
      let bestN = 0;
      for (const c of E) {
        if (c._D.kind === 'bomber') continue;
        const px = c.x + c.vx * P.napT, pz = c.z + c.vz * P.napT, d = Math.hypot(px - me.x, pz - me.z);
        if (d > 16 || d < 4) continue;
        let n = 0;
        for (const e of E) if (Math.hypot(e.x + e.vx * P.napT - px, e.z + e.vz * P.napT - pz) < 2.6) n += e._D.kind === 'bug' ? 1.5 : 1;
        if (o.zones.some(z => z.mine && Math.hypot(z.x - px, z.z - pz) < z.r && z.t > 1.5)) n -= 1.5;   // 那裡已經在燒了
        if (n > bestN) { bestN = n; napPt = { x: px, z: pz }; napWhy = n >= 2 ? '燒夷彈轟敵群' : '燒夷彈'; }
      }
      // 近戰衝過來：落在我跟牠中間偏牠那邊（封路）
      const r = rushers.find(e => e.dist > 5 && e.dist < 13 && e._D.kind !== 'bomber');
      if (r && bestN < 2) {
        const k = Math.max(3.5, r.dist * 0.55);
        const ux = (r.x - me.x) / r.dist, uz = (r.z - me.z) / r.dist;
        napPt = { x: me.x + ux * k + r.vx * 0.3, z: me.z + uz * k + r.vz * 0.3 }; napWhy = '燒夷封路';
      }
    }

    // 隊友被貼：丟在貼上來那台腳下（離隊友 > 2.5 格才丟，別擋到隊友的路）
    if (napS && ally) {
      for (const e of E) {
        const px = e.x + e.vx * P.napT, pz = e.z + e.vz * P.napT;
        const da = Math.hypot(e.x - ally.x, e.z - ally.z), dm = Math.hypot(px - me.x, pz - me.z);
        if (da < 6 && dm > 4 && dm < 16 && Math.hypot(px - ally.x, pz - ally.z) > 2.5) { napPt = { x: px, z: pz }; napWhy = '燒夷掩護'; break; }
      }
    }

    // ---- 武器切換：平常兩邊都架背部；最近的敵人貼到 close 格內 → 燒夷那一側換手臂自衛 ----
    const back = {};
    for (const side of ['L', 'R']) {
      const arm = 'arm' + side, bk = 'back' + side;
      if (!ok(W, bk)) { back[side] = false; continue; }
      if (!ok(W, arm)) { back[side] = true; continue; }
      const kind = W[bk].kind;
      if (kind === 'napalm') back[side] = !(nd < P.close && nearSee) || !!(napPt && napWhy !== '燒夷彈');
      else back[side] = !(nd < 5 && nearSee);
    }

    // ---- 移動：保持距離；最好跟敵人中間隔著牆（垂直飛彈越過去打），但又在鎖定距離內 ----
    const lockR = o.lock.range ?? 34;
    const score = (px, pz, ux, uz) => {
      let sc = 0, dmin = 99;
      for (const e of E) dmin = Math.min(dmin, Math.hypot(e.x - px, e.z - pz));
      sc -= Math.abs(dmin - keep) * (dmin < keep ? 0.8 : 0.2);
      if (Math.hypot(near.x - px, near.z - pz) > lockR - 3) sc -= 3;
      sc -= dangerAt(o, api, px, pz, { meleeR: 7 }) / 18;
      // 掩體：看不到我的敵人越多越好（隔著牆）
      let hid = 0;
      for (const e of E) if (e.dist < 30 && !clearLine(api, px, pz, e.x, e.z)) hid++;
      sc += hid / Math.max(1, E.length) * (pincer ? -1 : P.cover);
      sc += Math.min(api.rayBlock(px, pz, ux, uz, 6), 6) * 0.15;
      if (tgt && ally) {
        if (Math.hypot(tgt.x - px, tgt.z - pz) > lockR - 3) sc -= 3;
        if (pincer) sc += Math.min(crossAngle(px, pz, ally, tgt), 1.6) * P.cross;
        const ad = Math.hypot(ally.x - px, ally.z - pz);
        if (ad < 5) sc -= (5 - ad) * 0.4;
      }
      return sc;
    };
    const d = pickDir(o, api, mem, score, 0.3);
    let mx = d.x, mz = d.z, mode;
    const hidden = !nearSee;
    if (nd < P.close) mode = '後撤';
    else if (hidden) mode = '隔牆砲擊';
    else mode = '砲擊陣地';
    if (nd > lockR - 2) { const n = navToSee(o, api, mem, near.x, near.z, 0); mx = n.x; mz = n.z; mode = '推進到射程'; }
    ({ mx, mz } = api.steer(mx, mz));

    // ---- 推進：閃 / 被近戰貼上就推開 ----
    let boost = null;
    const dg = dodge(o, api, mem, { minE: 30, minDmg: 30 });
    if (dg) { boost = { x: dg.x, z: dg.z }; mode = dg.why; }
    else if (me.canBoost && me.boostCd <= 0 && me.energy >= 40 && rushers.some(e => e.dist < 5)) {
      const bd = pickDir(o, api, { _pdT: 0 }, (px, pz, ux, uz) => score(px, pz, ux, uz) - (ux * ndir.x + uz * ndir.z) * 3 + api.boostLen(ux, uz) * 0.2, 0, 6);
      boost = { x: bd.x, z: bd.z }; mode = '推進脫離';
    }

    // ---- 瞄準 / 開火 ----
    const act = ['L', 'R'].map(sd => activeOf(me, sd)).filter(s => ok(W, s));
    const napReady = napS && act.includes(napS) && napPt && (W[napS].cd ?? 0) <= 0.05;
    // 手臂自衛的目標：最近那台
    const armS = act.find(s => s.startsWith('arm'));
    let aimAt;
    if (napReady) aimAt = napPt;
    else if (armS) { const L = leadPoint(me, near, W[armS]); aimAt = { x: L.x, z: L.z }; }
    else aimAt = { x: near.x, z: near.z };
    const aimYaw = Math.atan2(aimAt.x - me.x, aimAt.z - me.z);
    const aligned = Math.abs(api.angleDiff(me.yaw, aimYaw));
    const fire = {};
    let shot = null;
    for (const side of ['L', 'R']) {
      const s = activeOf(me, side), w = W[s];
      if (!ok(W, s) || !w.live || me.deploying[side]) continue;
      if (w.kind === 'vmissile' || w.kind === 'missile') {
        const fd = tgt ? o.dist : nd;
        fire[side] = o.lock.locked && fd < w.range + (w.kind === 'vmissile' ? 16 : 0);
        if (fire[side] && (w.cd ?? 0) <= 0.05) { shot = hidden ? '隔牆飛彈' : '垂直飛彈齊射'; if (tgt && o.foe.id === tgt.id) tag = pincer ? '包夾' : F.why; }
        continue;
      }
      if (w.kind === 'napalm') {
        fire[side] = !!napPt && aligned < 0.25;
        if (fire[side] && (w.cd ?? 0) <= 0.05) shot = napWhy;
        continue;
      }
      if (w.kind === 'bullet' && w.splash) { fire[side] = nearSee && aligned < 0.08 && nd < w.range; if (fire[side]) shot = '加農砲'; continue; }
      fire[side] = nearSee && nd < w.range && aligned < (MELEE.has(w.kind) ? 0.35 : 0.15);
      if (fire[side]) shot = '近身自衛';
    }
    return { move: { x: mx, z: mz }, aimAt, aimYaw, fire, back, boost, target: tgt ? tgt.id : null, note: teamNote(tag, shot && !boost ? shot : mode) };
  },
};
