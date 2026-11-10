// ---------- alpha 個性大腦共用工具（berserker / sniper / artillery） ----------
// 一對多（雜魚狼群）用：挑目標、算危險、16 方向選路、閃避、對任意目標預判 / 射線檢查
// 介面見 tools/sim/BRAINS.md
export const MELEE = new Set(['saber', 'pile', 'flame']);
export const ok = (W, s) => !!W[s] && !W[s].broken && W[s].ammo > 0 && W[s].kind !== 'shield';
export const activeOf = (me, side) => (me.ready[side] ? 'back' : 'arm') + side;
const SLOTS = ['armL', 'armR', 'backL', 'backR'];

// 自己的子彈實際速度（電腦方 ×0.55、狙擊 ×0.5）
export function shotSpeed(w) {
  if (!w || !w.speed) return Infinity;
  return w.speed * (w.id === 'sniper' ? 0.5 : 0.55);
}
// 對某台敵人的預判點（迭代 3 次）；from = 槍口附近（用機體中心就好）
export function leadPoint(me, t, w, k = 1) {
  const sp = shotSpeed(w);
  if (sp === Infinity) return { x: t.x, z: t.z, tt: 0 };
  let tx = t.x, tz = t.z, tt = 0;
  for (let i = 0; i < 3; i++) { tt = Math.hypot(tx - me.x, tz - me.z) / sp; tx = t.x + t.vx * tt * k; tz = t.z + t.vz * tt * k; }
  return { x: tx, z: tz, tt };
}
// 從 (ax, az) 到 (bx, bz) 中間有沒有牆
export function clearLine(api, ax, az, bx, bz, slack = 0.9) {
  const dx = bx - ax, dz = bz - az, d = Math.hypot(dx, dz) || 1e-6;
  return api.rayBlock(ax, az, dx / d, dz / d, d) >= d - slack;
}
const spd = e => Math.hypot(e.vx, e.vz);
export const armed = e => SLOTS.some(s => e.weapons[s] && !e.weapons[s].broken && e.weapons[s].ammo > 0 && e.weapons[s].kind !== 'shield');
// 雜魚的種類（看不到名字，從武器 / 血量猜）
export function kindOf(e) {
  const W = e.weapons, ks = SLOTS.map(s => W[s]?.id).filter(Boolean);
  if (!ks.length) {
    const max = e.hp.torso?.max ?? 0;
    if (max < 50) return 'bomber';
    if (e.legs === 'biped' || max >= 150) return 'charger';   // 衝鋒機 / 衝鋒蟲（有甲殼）
    return 'bug';                                            // 戰士蟲 / 蟲群（近身咬）
  }
  if (ks.some(k => k.startsWith('saber'))) return 'blade';
  if (ks.some(k => k.startsWith('shotgun') || k.startsWith('flamer'))) return 'brawler';
  if (ks.some(k => k.startsWith('sniper'))) return 'marksman';
  if (ks.some(k => k.startsWith('cannon') || k === 'howitzer' || k.startsWith('acid') || k.startsWith('napalm'))) return 'lobber';
  if (ks.some(k => k.startsWith('rocket') || k.startsWith('missile'))) return 'rocket';
  return 'gunner';
}
// 一台敵人有多危險（大概的每秒輸出）、射程
export function dangerOf(e) {
  let dps = 0, rng = 0;
  for (const s of SLOTS) {
    const w = e.weapons[s];
    if (!w || w.broken || !(w.ammo > 0) || w.kind === 'shield') continue;
    dps += (w.dmg ?? 0) * (w.pellets ?? 1) * (w.salvo ?? 1) / (w.interval || 1);
    rng = Math.max(rng, w.range ?? 0);
  }
  const k = kindOf(e);
  if (k === 'bomber') { dps = 60; rng = 4; }
  else if (k === 'charger') { dps = 45; rng = 17; }
  else if (k === 'bug') { dps = 25; rng = 2; }
  return { dps, rng, kind: k };
}
// 敵人的血量比例（雜魚只有一條軀幹血）
export const hpOf = e => e.hp.torso ? e.hp.torso.hp : 100;
export const hpFracOf = e => e.hp.torso ? e.hp.torso.hp / Math.max(1, e.hp.torso.max) : 1;
// 一台敵人周圍 R 格內有幾台別的敵人（落單 = 0）
export function buddies(o, t, R = 7) {
  let n = 0;
  for (const e of o.enemies) if (e !== t && Math.hypot(e.x - t.x, e.z - t.z) < R) n++;
  return n;
}
// 某個點有多危險：看得到這個點、而且這點在它射程內的敵人的輸出總和（近戰 / 自爆照距離）
export function dangerAt(o, api, x, z, opt = {}) {
  let sum = 0;
  for (const e of o.enemies) {
    const D = e._d ?? (e._d = dangerOf(e));
    const d = Math.hypot(e.x - x, e.z - z);
    if (D.kind === 'bug' || D.kind === 'bomber' || D.kind === 'blade' || D.kind === 'brawler') {
      sum += D.dps * Math.max(0, 1 - d / ((opt.meleeR ?? 9) + D.rng)) * 1.2;
      continue;
    }
    if (d > D.rng + 2) continue;
    const see = D.kind === 'lobber' || clearLine(api, x, z, e.x, e.z);
    if (!see) continue;
    sum += D.dps * (d < D.rng * 0.6 ? 1 : 0.6);
  }
  return sum;
}
// 16 個方向找下一步要往哪走：score(px, pz, ux, uz) 越大越好；有慣性（每 re 秒才重選，維持原方向加分）
export function pickDir(o, api, mem, score, re = 0.25, step = 4) {
  mem._pdT = (mem._pdT ?? 0) - o.dt;
  if (mem._pdT > 0 && mem._pd) return mem._pd;
  const me = o.me;
  let best = null, bestSc = -1e9;
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * Math.PI * 2, ux = Math.sin(a), uz = Math.cos(a);
    const c = Math.min(api.clearAhead(ux, uz, step + 0.6), step + 0.6);
    if (c < 1.0) continue;
    const st = Math.max(0.5, c - 0.6), px = me.x + ux * st, pz = me.z + uz * st;
    let sc = score(px, pz, ux, uz, st);
    if (mem._pd && ux * mem._pd.x + uz * mem._pd.z > 0.8) sc += 0.6;
    if (sc > bestSc) { bestSc = sc; best = { x: ux, z: uz, sc }; }
  }
  mem._pd = best ?? { x: 0, z: 0, sc: 0 }; mem._pdT = re;
  return mem._pd;
}
// 閃避：重彈 / 飛彈 / 火箭 / 拋射物落點 / 衝鋒機直線衝過來 → 推進到旁邊
export function dodge(o, api, mem, opt = {}) {
  const me = o.me;
  if (!(me.canBoost && me.boostCd <= 0 && !me.boosting && !me.staggered && me.energy >= (opt.minE ?? 30))) return null;
  const side = (ux, uz, prefer) => {
    for (const sgn of [prefer, -prefer]) {
      const bx = uz * sgn, bz = -ux * sgn, L = api.boostLen(bx, bz);
      if (api.clearAhead(bx, bz, L) >= L * 0.85) return { x: bx, z: bz };
    }
    return null;
  };
  for (const s of o.incoming) {
    if (s.tti == null) continue;
    if (s.point) {   // 拋射物（迫擊砲 / 燒夷 / 酸液）：落點在身邊、快落地 → 推離落點
      const dx = me.x - s.point.x, dz = me.z - s.point.z, d = Math.hypot(dx, dz);
      if (d < (s.splash ?? 1.5) + 1.6 && s.tti < 0.6) { const L = d || 1; return { x: dx / L, z: dz / L, why: '閃落點' }; }
      continue;
    }
    const big = s.heavy || s.dmg >= (opt.minDmg ?? 30) || s.kind === 'rocket' || (s.kind !== 'bullet' && s.kind !== 'beam');
    if (!big) continue;
    if (s.target && (s.kind === 'missile' || s.kind === 'split')) {
      if (opt.missiles === false) continue;
      if (s.tti < 0.25 && s.miss < 2.5) { const b = side(s.ux, s.uz, 1); if (b) return { ...b, why: '閃飛彈' }; }
      continue;
    }
    if (s.tti < (opt.tti ?? 0.45) && s.miss < 1.6 + (s.splash ?? 0) * 0.4) {
      const sgn = (me.x - s.x) * s.uz - (me.z - s.z) * s.ux > 0 ? 1 : -1;
      const b = side(s.ux, s.uz, sgn); if (b) return { ...b, why: '閃' };
    }
  }
  // 衝鋒機：推進中、朝我衝過來
  for (const e of o.enemies) {
    if (e.dist > 14 || !e.boosting) continue;
    const v = spd(e); if (v < 8) continue;
    const ux = e.vx / v, uz = e.vz / v, rx = me.x - e.x, rz = me.z - e.z;
    const along = rx * ux + rz * uz, miss = Math.abs(rx * uz - rz * ux);
    if (along > 0 && along / v < 0.55 && miss < 2.2) {
      const sgn = (rx * uz - rz * ux) > 0 ? 1 : -1;
      const b = side(ux, uz, sgn); if (b) return { ...b, why: '閃衝鋒' };
    }
  }
  return null;
}
// 看不到某點：16 方向找「走幾步就看得到」的方向
export function navToSee(o, api, mem, tx, tz, prefer = 0) {
  const me = o.me;
  mem._navT = (mem._navT ?? 0) - o.dt;
  if (mem._navT > 0 && mem._nav) return mem._nav;
  const d0 = Math.hypot(tx - me.x, tz - me.z) || 1, dx = (tx - me.x) / d0, dz = (tz - me.z) / d0;
  let best = null, bestSc = -1e9;
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * Math.PI * 2, ux = Math.sin(a), uz = Math.cos(a);
    const c = Math.min(api.clearAhead(ux, uz, 7), 7);
    if (c < 1.2) continue;
    const st = Math.min(c - 0.6, 4.5), px = me.x + ux * st, pz = me.z + uz * st;
    const see = clearLine(api, px, pz, tx, tz);
    const sc = (see ? 10 : 0) + (ux * dx + uz * dz) * (2 + prefer) + st * 0.4 + (mem._nav && ux * mem._nav.x + uz * mem._nav.z > 0.7 ? 1 : 0);
    if (sc > bestSc) { bestSc = sc; best = { x: ux, z: uz }; }
  }
  mem._nav = best ?? { x: dx, z: dz }; mem._navT = 0.4;
  return mem._nav;
}
// 一群敵人的重心
export function centroid(list) {
  let x = 0, z = 0;
  for (const e of list) { x += e.x; z += e.z; }
  return list.length ? { x: x / list.length, z: z / list.length } : null;
}
