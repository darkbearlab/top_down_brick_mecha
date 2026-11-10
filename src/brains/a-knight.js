// ---------- a-knight 團隊版騎士（alpha 2v2；從 beta 的 knight 複製來改） ----------
// 團隊（有隊友時才開）：「鐵鎚」
//   - 跟隊友用同一套評分挑集火目標（act.target）；挑戰分數：集火目標 +、貼近隊友的敵人 +（「掩護衝鋒」）
//   - 主動前進時衝集火目標；守點時不離隊友太遠（當隊友的盾）
//   - 騎槍撞到 → 對方失衡 → 隊友的飛彈趁失衡齊射
// 沒隊友（雜魚關卡）→ 跟原版一樣
// 衝擊騎槍 + 盾牌：躲在掩體邊「守關」，誰走進騎槍距離就「挑戰」誰 → 點火、整台衝過去撞；
// 撞完「回馬」：盾朝著敵群退回掩體邊，等能量 / 騎槍冷卻，再挑下一個
//   - 騎槍：點火 0.3 秒（站住）→ 以 21 格/秒彈出最多 0.38 秒（約 8 格）；撞到第一台敵機：傷害 ≈ 相對速度 × 6.5（約 136，最多 230）、擊退 + 失衡
//     撞牆傷害全吃在騎槍手上 → 衝之前檢查路線（目標後面也要留空間，沒撞到人會一路滑下去）
//   - 雜魚的射擊型會自己走到 6–10 格（ai.js want 8）→ 不用追，站在掩體邊等牠們走進槍尖距離；只讓少數幾台看得到我
//   - 盾在左手：左前方 ±78° 擋直擊（不失衡）；左背掛直射飛彈，盾那一側永遠架著背部武器 → 等待時用飛彈點人
//   - 能量：騎槍 45 + 推進 30 → 平常不推進，留著衝鋒；只有快被重彈 / 衝鋒機 / 自爆機打到才推進
// 意圖（note）：挑戰：<對象> / 點火 / 衝鋒！ / 回馬 / 守在掩體 / 前進 / 閃
import { ok, slotOf, unit, crowd, bestDir, dodge, shieldCovers, seekLos, foeKind, hpOf, losTo, zoneAt, TAU } from './lib-a-beta.js';
import { focusPick, teamNote } from './lib-a-team.js';

const T = {
  REACH: 7.2,      // 點火結束時預測的距離 < REACH 才衝（衝刺約 8 格）
  ALIGN: 0.07,     // 上半身對準誤差（弧度）
  EMIN: 45,        // 騎槍能量
  WALL: 2.0,       // 目標後面至少要留幾格空地
  PATH: 8.2,       // 路線最多檢查幾格
  CROWD_PEN: 1.0,  // 目標旁邊每多一台敵人扣分（衝進去之後會被圍）
  MSL: 2,          // 挑戰分數：帶飛彈 / 火箭的
  MEL: 2,          // 挑戰分數：10 格內的近戰（迎面撞更痛）
  COVER: 1,        // 掩體分數：每台看得到那個點的遠程敵人扣分
  STRAFE: 0.6,     // 等待 / 對準時橫移的力道
  FULL: 1,         // 路線一律檢查滿 8 格
  OUT: 5,          // 撞完 OUT 格內還有敵人 → 推進脫離（0 = 不用）
  SHM: 0,          // 盾朝飛彈兵
  ADV: 4,          // 準備好、但 ADV 秒都沒人走進槍尖距離 → 主動前進
  FOCUS: 2.5,      // 團隊：挑戰集火目標 +分
  GUARD: 0.5,      // 團隊：敵人離隊友每近 1 格（8 格內）+分
  LEASH: 11,       // 團隊：守點離隊友超過這個距離扣分
};

const KIND_NAME = { ranged: '射手', melee: '近戰', rammer: '衝鋒機', bomber: '自爆機' };
const hasMissile = e => Object.values(e.weapons ?? {}).some(w => w && !w.broken && (w.kind === 'missile' || w.kind === 'rocket' || w.kind === 'vmissile'));

export default {
  name: 'a-knight',
  init(mem) { mem.tgt = null; mem.spot = null; mem.spotT = 0; mem.idle = 0; mem.strafe = Math.random() < 0.5 ? 1 : -1; },
  think(o, mem, api) {
    const { me } = o, W = me.weapons, dt = o.dt;
    // 騎槍（可以兩把：挑冷卻好的那把）
    const lances = ['armR', 'armL'].filter(s => ok(W, s) && W[s].kind === 'lance');
    const lanceS = lances.find(s => W[s].live && (W[s].cd ?? 0) <= 0) ?? lances.sort((a, b) => (W[a].cd ?? 0) - (W[b].cd ?? 0))[0];
    const lance = lanceS ? W[lanceS] : null;
    const lanceSide = lanceS ? lanceS[3] : null;
    const notes = [];
    const F = focusPick(o, mem, { type: 'kinetic', guard: 0.45 });
    const ally = o.allies?.[0];
    const ftgt = F ? F.e : null;
    let tag = '';

    if ((mem.flip = (mem.flip ?? 1) - dt) <= 0) { mem.flip = 0.6 + Math.random() * 0.8; mem.strafe *= -1; }
    if (api.clearAhead(-(o.dir.z) * mem.strafe, o.dir.x * mem.strafe, 2) < 1.5) mem.strafe *= -1;
    // ---- 衝刺中：方向鎖死 ----
    if (me.charge === 'dash') { mem.dashed = 0.5; return { move: { x: 0, z: 0 }, aimYaw: me.yaw, fire: {}, note: '衝鋒！' }; }
    mem.dashed = Math.max(0, (mem.dashed ?? 0) - dt);

    // 衝刺路線：機體整個寬度（中心 + 兩側各 1.1 倍半徑）沿 (ux, uz) 過得去幾格（api.clearAhead 只看 0.8 倍半徑，會擦到牆角）
    const lane = (ux, uz, len) => {
      const w = me.r * 1.1;
      return Math.min(api.clearAhead(ux, uz, len), api.rayBlock(me.x - uz * w, me.z + ux * w, ux, uz, len), api.rayBlock(me.x + uz * w, me.z - ux * w, ux, uz, len));
    };
    // ---- 每台敵人：點火結束時的預測位置、路線通不通 ----
    const lanceReady = lance && lance.live && !me.deploying[lanceSide] && (lance.cd ?? 0) <= 0 && me.energy >= T.EMIN;
    const igLeft = me.charge === 'ignite' ? 0.3 : 0.35;
    const plan = e => {
      const tf = igLeft + Math.max(0, e.dist - 1.5) / 21;
      const px = e.x + e.vx * tf, pz = e.z + e.vz * tf, pu = unit(px - me.x, pz - me.z);
      const need = T.FULL ? T.PATH : Math.min(T.PATH, Math.max(pu.l + T.WALL + 0.5, 5));
      const clear = lane(pu.x, pu.z, need) >= need - 0.3 && losTo(api, me, e.x, e.z);
      return { e, pu, clear, yaw: Math.atan2(pu.x, pu.z) };
    };
    const scoreOf = (e, p) => {
      let s = -Math.abs(p.pu.l - 5) * 0.4 + (hpOf(e) < 125 ? 2 : 0) - hpOf(e) / 150;
      const k = foeKind(e);
      if (k === 'bomber') s -= 4; else if (k === 'ranged') s += 0.5;
      if (hasMissile(e)) s += T.MSL;
      if ((k === 'melee' || k === 'rammer') && e.dist < 10) s += T.MEL;
      s -= o.enemies.filter(f => f !== e && Math.hypot(f.x - e.x, f.z - e.z) < 4.5).length * T.CROWD_PEN;
      if (mem.tgt === e.id) s += 1.5;
      if (ftgt && e.id === ftgt.id) s += T.FOCUS;
      if (ally) { const da = Math.hypot(e.x - ally.x, e.z - ally.z); if (da < 8) s += (8 - da) * T.GUARD; }
      // 要轉多少才對得準（轉太多要花時間）
      s -= Math.abs(api.angleDiff(me.yaw, p.yaw)) * 1.2;
      return s;
    };

    // ---- 挑戰對手：槍尖距離內、路線通的裡面挑分數最高的 ----
    let pick = null;
    if (me.charge === 'ignite') {
      const e = o.enemies.find(f => f.id === mem.tgt) ?? o.enemies[0];
      if (e) pick = plan(e);
    } else {
      let bs = -1e9;
      for (const e of o.enemies) {
        if (e.dist > T.REACH + 3) break;
        const p = plan(e);
        if (!p.clear || p.pu.l > T.REACH) continue;
        const s = scoreOf(e, p);
        if (s > bs) { bs = s; pick = p; }
      }
      if (pick && ally) { const da = Math.hypot(pick.e.x - ally.x, pick.e.z - ally.z); mem.tagT = da < 6 ? '掩護衝鋒' : ftgt && pick.e.id === ftgt.id ? '集火衝鋒' : ''; }
      if (pick && pick.e.id !== mem.tgt) { mem.tgt = pick.e.id; if (lanceReady) notes.push('挑戰：' + KIND_NAME[foeKind(pick.e)]); }
    }

    // ---- 瞄準 / 開火 ----
    const fire = {};
    let yaw;
    const nearest = o.enemies[0] ?? o.foe;
    if (pick) {
      yaw = pick.yaw;
      // 點火中：衝刺方向 = 點火結束時上半身的方向 → 只轉向路線通的方向（目標跑到牆邊就不跟）
      if (me.charge === 'ignite') {
        const clearYaw = y => lane(Math.sin(y), Math.cos(y), T.PATH) >= T.PATH - 0.3;
        if (!clearYaw(yaw)) {
          let best = clearYaw(me.yaw) ? me.yaw : null;
          for (let k = 1; k <= 8 && best == null; k++) for (const sg of [1, -1]) { const y = me.yaw + sg * k * 0.08; if (clearYaw(y)) { best = y; break; } }
          yaw = best ?? me.yaw;
        }
      }
      const aligned = Math.abs(api.angleDiff(me.yaw, yaw));
      if (lanceReady && me.charge !== 'ignite' && aligned < T.ALIGN && pick.clear && !me.staggered) { fire[lanceSide] = true; notes.push('點火'); if (mem.tagT) tag = mem.tagT; }
    } else {
      // 沒有可以衝的：盾朝最近的敵人（盾在左前方 → 往右偏讓盾正對）
      const sd = me.shield?.slot === 'armL' ? 1 : -1;
      // 盾朝最危險的：看得到我的飛彈兵（20 格內），沒有就最近的
      const th = (T.SHM && o.enemies.find(e => e.dist < 20 && hasMissile(e) && losTo(api, me, e.x, e.z))) || nearest;
      yaw = Math.atan2(th.x - me.x, th.z - me.z) - (me.shield ? 0.55 * sd : 0);
      if (lanceReady && nearest.dist < 12) yaw = Math.atan2(nearest.x - me.x, nearest.z - me.z);   // 準備好了 → 槍尖對著最近的
    }

    // ---- 移動 ----
    let mx = 0, mz = 0, state;
    const C = crowd(o, 16);
    const visCount = (qx, qz) => {
      let n = 0;
      for (const e of o.enemies) {
        if (e.dist > 26) break;
        const u = unit(e.x - qx, e.z - qz);
        if (u.l < 23 && api.rayBlock(qx, qz, u.x, u.z, u.l) >= u.l - 0.9) n += foeKind(e) === 'ranged' ? (hasMissile(e) ? 1.5 : 1) : 0.3;
      }
      return n;
    };
    if (me.charge === 'ignite') state = '點火';
    else if (pick && lanceReady) {
      // 對準：一邊橫移（電腦的子彈慢，站著不動才會被打中）
      state = '對準';
      if (T.STRAFE) { mx = -pick.pu.z * mem.strafe * T.STRAFE; mz = pick.pu.x * mem.strafe * T.STRAFE; }
    }
    else {
      const ready = lance && me.energy >= T.EMIN - 10 && (lance.cd ?? 0) < 0.7;
      mem.idle = ready ? mem.idle + dt : 0;
      if (ready && (mem.idle > T.ADV || C.n === 0)) {
        // 等太久沒人上門 → 主動前進，找最近的
        state = '前進';
        const tg = ftgt ?? nearest, tu = unit(tg.x - me.x, tg.z - me.z);
        if (ftgt) tag = '集火前進';
        if (!losTo(api, me, tg.x, tg.z)) { const n = seekLos(o, api, mem, tg.x, tg.z, 1); mx = n.x; mz = n.z; }
        else { mx = tu.x - tu.z * mem.strafe * 0.3; mz = tu.z + tu.x * mem.strafe * 0.3; }
      } else {
        // 守在掩體：挑一個少數敵人看得到、離最近敵人 5–9 格的點（走得到的）
        state = ready ? '守在掩體' : '回馬';
        if ((mem.spotT -= dt) <= 0 || !mem.spot) {
          mem.spotT = 0.4;
          let best = null, bs = -1e9;
          for (const r of [0, 2.5, 5]) for (let i = 0; i < (r ? 16 : 1); i++) {
            const a = i / 16 * TAU, ux = Math.sin(a), uz = Math.cos(a);
            if (r && api.clearAhead(ux, uz, r + 0.8) < r + 0.5) continue;
            const qx = me.x + ux * r, qz = me.z + uz * r;
            let s = -visCount(qx, qz) * T.COVER - r * 0.12;
            let nd = 99; for (const e of o.enemies) nd = Math.min(nd, Math.hypot(e.x - qx, e.z - qz));
            s -= nd < 4 ? (4 - nd) * 1.2 : 0;                     // 不要貼著敵人
            if (ready) s -= Math.max(0, nd - 9) * 0.25;           // 準備好了：別離太遠
            else s -= Math.max(0, 7 - nd) * 0.4;                  // 還沒好：退遠一點
            if (zoneAt(o, qx, qz)) s -= 3;
            if (ally) { const ad = Math.hypot(ally.x - qx, ally.z - qz); if (ad > T.LEASH) s -= (ad - T.LEASH) * 0.3; }
            if (mem.spot && Math.hypot(qx - mem.spot.x, qz - mem.spot.z) < 1.5) s += 0.4;
            if (s > bs) { bs = s; best = { x: qx, z: qz }; }
          }
          mem.spot = best;
        }
        if (mem.spot) {
          const u = unit(mem.spot.x - me.x, mem.spot.z - me.z);
          if (u.l > 0.6) { const k = Math.min(1, u.l / 1.5); mx = u.x * k; mz = u.z * k; }
          else if (T.STRAFE) { mx = -C.uz * mem.strafe * T.STRAFE; mz = C.ux * mem.strafe * T.STRAFE; }
        }
      }
    }
    if (!lance) state = '斷槍・舉盾';
    if (me.charge !== 'ignite' && (mx || mz)) ({ mx, mz } = api.steer(mx, mz));

    // ---- 閃：重彈 / 衝鋒機 / 自爆機；盾擋得住的直擊不閃；點火中不能動 ----
    let boost = null;
    if (me.charge !== 'ignite') {
      boost = dodge(o, api, mem, { minE: lanceReady ? T.EMIN + 30 : 30, shieldOk: (ux, uz) => shieldCovers(me, ux, uz) });
      if (boost) notes.push('閃');
      // 撞完：落點在敵群裡 → 立刻往外推進脫離（能量 55 → 25，騎槍冷卻 2 秒內就回得來）
      if (!boost && T.OUT && mem.dashed > 0 && me.canBoost && me.boostCd <= 0 && me.energy >= 30) {
        const near = o.enemies.filter(e => e.dist < T.OUT).length;
        if (near >= 1) {
          const C2 = crowd(o, 10);
          const b = bestDir(api, (ux, uz, c) => -(ux * C2.ux + uz * C2.uz) * 2 + c * 0.4, 5, 3);
          if (b) { boost = { x: b.x, z: b.z }; notes.push('脫離'); mem.dashed = 0; }
        }
      }
    }

    // ---- 背部飛彈（盾那一側永遠架著）：鎖上就打 ----
    const back = {};
    for (const side of ['L', 'R']) {
      const bk = 'back' + side;
      if (lances.some(l => l[3] === side)) { back[side] = false; continue; }
      back[side] = ok(W, bk);
      const s = slotOf(me, side);
      if (ok(W, s) && W[s].live && !me.deploying[side] && (W[s].kind === 'missile' || W[s].kind === 'vmissile') && (o.lock.locked || o.dist < 8)) fire[side] = true;
    }

    return { move: { x: mx, z: mz }, aimYaw: yaw, fire, back, boost, target: ftgt ? ftgt.id : null, note: teamNote(tag, notes.length ? notes.join('・') : state) };
  },
};
