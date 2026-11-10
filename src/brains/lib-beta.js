// ---------- beta 個性機體共用工具（knight / arsonist / missileer） ----------
// 都是一對多（打雜魚包）會用到的東西：敵人分類、包圍度、挑方向、閃重彈 / 衝鋒機 / 自爆機、找視線
// 介面見 tools/sim/BRAINS.md
export const MELEE = new Set(['saber', 'pile', 'flame']);
export const HEAVY_KIND = new Set(['missile', 'vmissile', 'rocket', 'split', 'napalm']);
export const TAU = Math.PI * 2;

export const ok = (W, s) => W[s] && !W[s].broken && W[s].ammo > 0 && W[s].kind !== 'shield';
export const slotOf = (me, side) => (me.ready[side] ? 'back' : 'arm') + side;
export const unit = (x, z) => { const l = Math.hypot(x, z) || 1e-6; return { x: x / l, z: z / l, l }; };

// 從自己看不看得到某一點（中心點連線沒被牆擋）
export function losTo(api, me, x, z) {
  const u = unit(x - me.x, z - me.z);
  return api.rayBlock(me.x, me.z, u.x, u.z, u.l) >= u.l - 0.9;
}

// 火箭飛 d 格要幾秒（初速 24、加速 30、最快 38）
export function rocketT(d) {
  const tA = (38 - 24) / 30, dA = 24 * tA + 15 * tA * tA;
  if (d <= dA) return (-24 + Math.sqrt(576 + 60 * d)) / 30;
  return tA + (d - dA) / 38;
}

// 敵人分類（雜魚沒有名字，看武器 / 血量 / 腳猜）
//   bomber 自爆機（沒武器、血很少）、rammer 衝鋒機 / 衝鋒蟲（沒武器、血多）、melee 近戰（劍 / 火焰 / 蟲）、ranged 遠程
export function foeKind(e) {
  const ws = Object.values(e.weapons ?? {}).filter(w => w && !w.broken && w.kind !== 'shield');
  const max = e.hp?.torso?.max ?? 100;
  if (!ws.length) {
    if (max <= 35) return 'bomber';
    if (max >= 130) return 'rammer';
    return 'melee';
  }
  if (ws.every(w => MELEE.has(w.kind))) return 'melee';
  return 'ranged';
}
export const hpOf = e => e.hp?.torso?.hp ?? 100;

// 包圍度：每台敵人往自己的方向加權（近的權重大）
//   x, z = 敵人「在哪一邊」的加權方向（還沒正規化）；n = R 格內幾台；wrap = 0（都在同一邊）..1（四面八方）
export function crowd(o, R = 14) {
  let x = 0, z = 0, n = 0, w = 0;
  for (const e of o.enemies) {
    if (e.dist > R) continue;
    const k = 1 / Math.max(2, e.dist);
    x += (e.x - o.me.x) / Math.max(0.5, e.dist) * k; z += (e.z - o.me.z) / Math.max(0.5, e.dist) * k;
    w += k; n++;
  }
  const l = Math.hypot(x, z);
  return { x, z, n, wrap: w ? 1 - l / w : 0, ux: l ? x / l : 0, uz: l ? z / l : 0 };
}

// 16 個方向挑一個分數最高的（score(ux, uz, clear) ；clear = 那個方向過得去幾格，最多 len）
export function bestDir(api, score, len = 4, minClear = 1.2) {
  let best = null, bs = -1e9;
  for (let i = 0; i < 16; i++) {
    const a = i / 16 * TAU, ux = Math.sin(a), uz = Math.cos(a);
    const c = Math.min(api.clearAhead(ux, uz, len), len);
    if (c < minClear) continue;
    const s = score(ux, uz, c);
    if (s > bs) { bs = s; best = { x: ux, z: uz, c }; }
  }
  return best;
}

// 往 (ux, uz) 的側面推進（兩邊都試，滑得出去的那邊）
export function sideStep(api, ux, uz, prefer = 1) {
  for (const sg of [prefer, -prefer]) {
    const bx = uz * sg, bz = -ux * sg, L = api.boostLen(bx, bz);
    if (api.clearAhead(bx, bz, L) >= L * 0.85) return { x: bx, z: bz };
  }
  return null;
}
export function boostTo(api, ux, uz) {
  const L = api.boostLen(ux, uz);
  return api.clearAhead(ux, uz, L) >= L * 0.8 ? { x: ux, z: uz } : null;
}

// 該不該閃（回傳推進方向或 null）
//   重彈 / 火箭 / 飛彈快打到、拋射物落點在腳下、衝鋒機直線衝過來、自爆機貼上來
//   opt.shieldOk(ux, uz)：盾擋得住就不閃（騎士用）；opt.light：連小飛彈也閃
export function dodge(o, api, mem, opt = {}) {
  const { me } = o;
  if (!me.canBoost || me.boostCd > 0 || me.boosting || me.staggered || me.charge || me.energy < (opt.minE ?? 30)) return null;
  // 衝鋒機 / 衝鋒蟲：高速直線過來
  for (const e of o.enemies) {
    if (e.dist > 13) break;
    const sp = Math.hypot(e.vx, e.vz);
    if (sp < 10) continue;
    const ux = e.vx / sp, uz = e.vz / sp, rx = me.x - e.x, rz = me.z - e.z;
    if (rx * ux + rz * uz <= 0) continue;
    const miss = Math.abs(rx * uz - rz * ux);
    if (miss < 2.2 && (rx * ux + rz * uz) / sp < 0.7) return sideStep(api, ux, uz, (rx * uz - rz * ux) > 0 ? -1 : 1) ?? null;
  }
  // 自爆機：貼到 4.5 格內 → 往反方向推
  const bomb = o.enemies.find(e => e.dist < 4.5 && foeKind(e) === 'bomber');
  if (bomb) {
    const u = unit(me.x - bomb.x, me.z - bomb.z);
    const b = boostTo(api, u.x, u.z) ?? sideStep(api, -u.x, -u.z, 1);
    if (b) return b;
  }
  for (const s of o.incoming) {
    if (s.tti == null || s.tti > 0.45) continue;
    if (s.point) {
      const dx = me.x - s.point.x, dz = me.z - s.point.z, d = Math.hypot(dx, dz) || 1;
      if (d < 2.6 + (s.splash ?? 0) * 0.5 && s.tti < 0.4) { const b = boostTo(api, dx / d, dz / d) ?? sideStep(api, dx / d, dz / d, 1); if (b) return b; }
      continue;
    }
    if (s.miss > 1.3 + s.splash * 0.4) continue;
    const heavy = s.heavy || s.kind === 'rocket' || s.dmg >= 40 || (opt.light && HEAVY_KIND.has(s.kind));
    if (!heavy) continue;
    if (opt.shieldOk && opt.shieldOk(s.ux, s.uz)) continue;
    const sg = (me.x - s.x) * s.uz - (me.z - s.z) * s.ux > 0 ? 1 : -1;
    const b = sideStep(api, s.ux, s.uz, -sg);
    if (b) return b;
  }
  return null;
}

// 自己的盾擋不擋得住往 (ux, uz) 飛的東西（mech.js hitMech 的判定，留餘裕）
export function shieldCovers(me, ux, uz) {
  const S = me.shield;
  if (!S || S.hp <= 40 || me.hp[S.slot]?.broken) return false;
  const fx = Math.sin(me.yaw), fz = Math.cos(me.yaw), sd = S.slot === 'armL' ? 1 : -1;
  let cx = fx + fz * 0.7 * sd, cz = fz - fx * 0.7 * sd;
  const cl = Math.hypot(cx, cz); cx /= cl; cz /= cl;
  return -(ux * cx + uz * cz) > 0.4;
}

// 看不到目標：16 方向找「走幾步就看得到」的方向（toward = 越靠近目標越加分的權重）
export function seekLos(o, api, mem, tx, tz, toward = 0.5) {
  if ((mem.navT = (mem.navT ?? 0) - o.dt) > 0 && mem.nav) return mem.nav;
  const me = o.me, d0 = unit(tx - me.x, tz - me.z);
  const b = bestDir(api, (ux, uz, c) => {
    const step = Math.min(c - 0.6, 4.5), px = me.x + ux * step, pz = me.z + uz * step;
    const u = unit(tx - px, tz - pz);
    const see = api.rayBlock(px, pz, u.x, u.z, u.l) >= u.l - 0.9;
    return (see ? 10 : 0) + (ux * d0.x + uz * d0.z) * toward + step * 0.4 + (mem.nav && ux * mem.nav.x + uz * mem.nav.z > 0.7 ? 1 : 0);
  }, 7);
  mem.nav = b ?? { x: d0.x, z: d0.z }; mem.navT = 0.4;
  return mem.nav;
}

// 腳下 / 要去的地方有沒有敵人的火海、酸池（自己的火海也燒自己嗎？status 照區域判定，保守一點都躲）
export function zoneAt(o, x, z, pad = 0.6, mineToo = false) {
  return o.zones.some(zn => (mineToo || !zn.mine) && Math.hypot(zn.x - x, zn.z - z) < zn.r + pad);
}
