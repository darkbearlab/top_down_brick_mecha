// ---------- 試玩場的敵機 ----------
// 每台隨機挑一套配裝（parts.js ENEMY_PRESETS），用跟玩家同一套物理和武器
// 距離依武器決定：有劍 / 霰彈就貼近、有狙擊就拉遠、其他保持中距離繞圈
// 看到玩家的加農砲 / 飛彈飛過來會往旁邊噴開；狙擊開槍前會先亮紅色雷射預告
// 背部武器跟玩家一樣要先架起來（toggleReady）：用得上才架、架一陣子或換彈就收回；只有架著飛彈才會鎖定
// 避牆：移動前用三條射線探路（越快探越遠）、速度朝牆而且來不及停就先剎車；推進前確認噴出去的方向夠空
// 被打爆後過幾秒，新的一台從天上降落（地上先出現紅圈，站在下面會被砸）
// 分散：3 格內的同伴互相推開；射擊型（偏好距離 6 格以上）看得到玩家、進到射程後各自找射擊位置（看得到玩家、離同伴遠、離自己近；
//   會飛的喜歡停在空洞上），每 2～4 秒或被打到就換一個 → 散開成扇形游擊，不會排成一列
// 特殊雜魚（parts.js GRUNTS_LOW 的 bomber / charger / fly / swarm）：自爆、衝鋒、旋停、蟲群，見下面各自的函式
import * as THREE from 'three';
import { G, HEADLESS, VOID, addMat, addTrauma, angleDiff, scene } from './core.js';
import { isBlock, isSolid, randomOpenSpot, rayBlock, rayWalk, tileAt, tileC, tileR } from './arena.js';
import { headStats } from './sensors.js';
import { BOOST_DV, BOOST_PUSH, BOOST_TIME, ENEMY_COLORS, activeSlot, boostDirOf, boostKOf, legK, damagePart, facing, hitMech, makeMech, muzzleOf, mechs, removeMech, slotBroken, stagger, wantsLock } from './mech.js';
import { LOB_G, NAPALM_T, SHOT_TUNE, makeGuns, shots } from './weapons.js';
import { applyFrame, beginFrame, ctrlOf, qBoost, qGuns, qReady, remoteFrame } from './control.js';
import { BAL, ENEMY_PRESETS, SLOTS, WEAPONS, fcsOn } from './parts.js';
import { burst, explosion, hitSparks, makeLaser, setLaser, shatterSmall, smoke, sparks } from './fx.js';
import { blastBuildings, buildingTop } from './buildings.js';
import { sfx } from './audio.js';
import { flowDir, flyDir, routeDir } from './pathing.js';
import { smokeHides } from './tech.js';
import { UNIT_BOX } from './core.js';
import { applyStatus, burnLockK } from './status.js';
import { bugStrike, setupBug, updateBug } from './bugs.js';
import { att } from './combatlog.js';

export const enemies = [];
// 難度：dmg 敵機傷害倍率、hp 耐久倍率、rest 射擊間隔倍率、err 瞄準晃動（弧度）、dodge 會不會噴開閃避、lock 鎖定時間倍率
export const DIFFS = {
  easy: { name: '新手', dmg: 0.45, hp: 0.7, rest: 2.0, err: 0.16, dodge: false, lock: 1.8 },
  normal: { name: '普通', dmg: 0.7, hp: 0.85, rest: 1.3, err: 0.07, dodge: true, lock: 1.2 },
  hard: { name: '強敵', dmg: 1, hp: 1, rest: 1, err: 0.02, dodge: true, lock: 1 },
};
export const AI = { passive: false, count: 2, diff: DIFFS.normal, sandbox: false };
// 數值覆蓋（heavy.js 的新數值會改；平常是預設值 → 行為跟以前完全一樣）
//   gruntErrK / gruntRestK：雜魚的瞄準誤差、兩陣射擊之間的休息時間倍率（小 = 準、攻擊慾高）
//   gruntChassis：雜魚的耐久照底盤（腳）：履帶 ×1.3、雙足 / 逆關節 ×1、懸浮 / 飛行 ×0.8；跟武器無關（雜魚整台一條血）
//   wantK：射擊型（理想距離 ≥ 6）的交戰距離倍率；indirectWant：有迫擊砲（indirect）的站多遠（0 = 不管）
//   leadReal：預判照實際的子彈速度算（舊的固定當 36 格/秒；子彈加倍後會瞄過頭）
//   ace：王牌（非雜魚、沒有大腦）用新戰術（aceTarget / kiteFrom / pickSpot 的曝光扣分 / 看不到目標時照路走）
//   memory：感知與最後已知位置（REALISM_REPORT A2）：看不到目標時不再全知，去最後看到 / 聽到的地方、預瞄那邊、到了搜索，跟丟才慢慢掃過去
//   spotter：迫擊砲要有觀測者（A1）：有隊友看得到才照實際位置打（第一發偏 3.5 格、同一個觀測者持續看著每發 ×0.55），沒人看到就打記憶裡的位置（偏更多）
export const AI_TUNE = { gruntErrK: 1, gruntRestK: 1, gruntChassis: false, wantK: 1, indirectWant: 0, leadReal: false, ace: false, memory: false, spotter: false, aware: false, discipline: false, gruntTac: false, gruntLanes: false, gruntSpeedK: 1, gruntHpMul: 1 };   // aware：王牌的戰場意識（aceAware）；discipline：武器 / 推進 / 減員紀律（見「紀律」那段）
//   gruntSpeedK：雜魚走路極速倍率（自爆機除外：牠本來就是要衝過來的）；gruntHpMul：雜魚血量整體倍率
const gruntHpK = P => (!AI_TUNE.gruntChassis ? 1 : P.fly || P.legs === 'hover' ? 0.8 : P.legs === 'tread' ? 1.3 : 1) * AI_TUNE.gruntHpMul;
const DROP_TIME = 1.1, DROP_H = 16;
const RING_GEO = HEADLESS ? null : new THREE.RingGeometry(0.8, 0.95, 36);
// 空投落點的紅圈（無頭：VOID，見 core.js）
const dropRing = () => HEADLESS ? VOID : new THREE.Mesh(RING_GEO, addMat(0xff4030, 0.8));

// player = 要打的對象（觀戰模式是另一台電腦機體）；opts.team / opts.colors 換隊伍
export function spawnEnemy(player, preset, at = null, opts = {}) {
  const P = preset ?? ENEMY_PRESETS[Math.floor(Math.random() * ENEMY_PRESETS.length)];
  const p = at ?? randomOpenSpot(player.x, player.z, 10);
  const D = opts.diff ?? AI.diff;   // 每台可以有自己的難度（王牌 vs 雜魚：王牌強敵、雜魚普通）
  const e = makeMech({ team: opts.team ?? 'enemy', colors: opts.colors ?? ENEMY_COLORS, loadout: P, x: p.x, z: p.z, yaw: Math.atan2(player.x - p.x, player.z - p.z), hpMul: D.hp,
    grunt: opts.grunt ? { hp: P.hp * gruntHpK(P) } : null });
  e.diff = opts.grunt && (AI_TUNE.gruntErrK !== 1 || AI_TUNE.gruntRestK !== 1) ? { ...D, err: D.err * AI_TUNE.gruntErrK, rest: D.rest * AI_TUNE.gruntRestK } : D;
  e.dmgMul = D.dmg;
  e.seed = Math.random() * 10;
  e.guns = makeGuns(P);
  e.preset = P;
  const ws = SLOTS.map(s => P[s]).filter(Boolean);
  const has = k => ws.includes(k) || ws.includes(k + '_l');   // 低階版也算
  e.ai = {
    strafe: Math.random() < 0.5 ? -1 : 1, t: 1, burst: 0, rest: 1 + Math.random(), reposition: 3 + Math.random() * 3, lockT: 0, snipeT: 0, hold: { L: Math.random(), R: Math.random() },
    want: has('saber') || has('shotgun') || has('flamer') || has('pile') ? 3 : has('fuel') ? 7.5 : has('lance') ? 7 : has('sniper') ? 13 : has('acid') ? 11 : has('pulse') ? 10 : 8,   // 只會拋酸的投擲蟲站遠一點丟
  };
  e.laser = makeLaser(0xff3020);
  // 特殊雜魚
  if (P.speedMul) e.spec.vmax *= P.speedMul;
  if (opts.grunt && !P.bomber) e.spec.vmax *= AI_TUNE.gruntSpeedK;
  if (P.fly) { e.fly = true; e.flyH = 1.3; }
  if (P.quad) setupQuad(e);
  if (P.bomber) e.bomber = { fuse: -1, beep: 0 };
  if (P.charger) e.charger = { state: 'idle', t: 0, cd: 1.5 + Math.random() * 2 };
  if (P.swarm) setupSwarm(e, P.swarm);
  if (P.bug) setupBug(e, P.bug, P);
  if (P.bomber || P.charger || P.swarm || P.melee) e.ai.want = 0;
  if (P.fly && !P.swarm) e.ai.want = 9;
  if (P.vehicle) { e.vehicle = true; e.trackHp = e.parts.torso.max * 0.35; }   // 載具：履帶耐久（mech.js hitMech）
  // 紀律（新數值王牌）：霰彈槍配背部火箭 / 飛彈 / 加農砲的，主力是背上那把 → 站中距離打，霰彈槍留給貼上來的（以前當近戰型，每 4～8 秒往目標噴）
  if (AI_TUNE.discipline && !opts.grunt && e.ai.want === 3 && has('shotgun') && !has('saber') && !has('pile') && !has('flamer') && ['backL', 'backR'].some(s => ['rocket', 'missile', 'split', 'vmissile', 'cannon'].includes(P[s]))) e.ai.want = 8;
  if (AI_TUNE.wantK !== 1 && e.ai.want >= 6) e.ai.want *= AI_TUNE.wantK;
  if (AI_TUNE.indirectWant && Object.values(e.guns).some(g => g.def.indirect)) e.ai.want = AI_TUNE.indirectWant;
  if (P.want) e.ai.want = P.want;   // 定義裡指定的理想距離（射擊型蟲子）
  if (P.scout) e.ai.want = 16;   // 偵察無人機：站遠看著（迫擊砲的觀測者）
  // noDrop：直接站在地上（遠征模式的遭遇小隊），不然從天上降落
  if (opts.noDrop) { e.drive = { mx: 0, mz: 0 }; e.aimYaw = e.torsoYaw; }
  else {
    const ring = dropRing();
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(p.x, 0.04, p.z);
    scene.add(ring);
    e.drop = { t: 0, ring };
    e.model.root.position.y = DROP_H;
  }
  e.onDeath = () => {
    e.laser.g.visible = false;
    clearTele(e);
    if (e.bomber && !e.bomber.done) { e.bomber.done = true; bomberBlast(e, 0.75); }   // 被打爆也會炸（小一點）
    if (e.swarm) { const S = e.swarm; for (let i = 0; i < S.live; i++) shatterSmall(S.wx[i], 0.1, S.wz[i], BUG_BITS); S.body.visible = S.eye.visible = false; sfx.hit(); }   // 最後幾隻各自碎掉，不爆炸
    if (e.quad) burst(e.x, 2, e.z, [0x3a3d45, 0xa8321a, 0x8a8e98], 14, 6);
    AI.onEnemyDeath?.(e);
    setTimeout(() => removeEnemy(e), 2500);   // 殘骸留一下才補新的
  };
  enemies.push(e);
  return e;
}

export function removeEnemy(e) {
  const i = enemies.indexOf(e);
  if (i < 0) return;
  enemies.splice(i, 1);
  removeMech(e);
  e.laser.g.visible = false;
  clearTele(e);
  if (e.drop) { scene.remove(e.drop.ring); e.drop = null; }
}
export function clearEnemies() { for (const e of enemies.slice()) removeEnemy(e); clearMemory(); }
// 多層地圖：追到別層的敵機先「收起來」（不在場上、不更新），過一陣子再從連接點那邊空降出來（unparkEnemy）
export function parkEnemy(e) {
  const i = enemies.indexOf(e);
  if (i >= 0) enemies.splice(i, 1);
  const j = mechs.indexOf(e);
  if (j >= 0) mechs.splice(j, 1);
  scene.remove(e.model.root);
  e.laser.g.visible = false;
  if (e.drop) { scene.remove(e.drop.ring); e.drop = null; }
}
export function unparkEnemy(e, x, z) {
  e.x = x; e.z = z; e.vx = e.vz = 0;
  scene.add(e.model.root);
  mechs.push(e); enemies.push(e);
  const ring = dropRing();
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.04, z);
  scene.add(ring);
  e.drop = { t: 0, ring };
  e.model.root.position.set(x, DROP_H, z);
}

function updateDrop(e, dt, player) {
  const D = e.drop;
  D.t += dt;
  const k = Math.min(1, D.t / DROP_TIME), y0 = e.fly ? e.flyH ?? 0 : 0;   // 會飛的降到自己的飛行高度
  e.model.root.position.set(e.x, y0 + (DROP_H - y0) * (1 - k * k), e.z);
  D.ring.material.opacity = 0.4 + 0.5 * Math.abs(Math.sin(D.t * 14));
  D.ring.scale.setScalar(1.6 - 0.6 * k);
  if (k < 1) return true;
  scene.remove(D.ring); D.ring.material.dispose();
  e.drop = null;
  e.model.root.position.y = y0;
  if (e.fly) return false;   // 旋停機：飄下來就停在空中，沒有落地衝擊（不揚塵、不震、不砸人）
  burst(e.x, 0.3, e.z, [0x6a6e78, 0x4a4e58], 10, 5);
  smoke(e.x, 0.3, e.z, 8, 1.5, 0x55585f);
  for (const a of [0, 1.6, 3.2, 4.8]) hitSparks(e.x, 0.2, e.z, Math.sin(a), Math.cos(a), 0.8);
  sfx.land();
  const d = Math.hypot(player.x - e.x, player.z - e.z);
  addTrauma(Math.max(0.1, 0.6 - d * 0.04));
  if (player.alive && d < e.r + player.r + 0.3) {
    const nx = (player.x - e.x) / (d || 1), nz = (player.z - e.z) / (d || 1);
    player.vx += nx * 10; player.vz += nz * 10;
    att(e, 'landing', () => damagePart(player, 'torso', 35, nx, nz));
  }
  return false;
}

// 這把武器打得到多遠
const reachOf = d => d.kind === 'pulse' ? d.range : d.kind === 'pile' ? d.reach + 1.9 : d.kind === 'lance' ? d.speed * d.dashT + 1.6 : d.kind === 'flame' ? d.range + 0.3 : d.kind === 'stream' ? d.range - 0.5 : d.kind === 'napalm' ? d.range : d.kind === 'saber' ? d.reach + 1.2 : d.kind === 'bullet' || d.kind === 'beam' ? d.speed * d.life : d.kind === 'rocket' ? 26 : 18;   // 敵人子彈慢，但飛得一樣久 → 射程一樣

// 外掛的 AI 大腦（src/brainapi.js 掛上來）：有 e.brain 的機體，移動 / 瞄準 / 開火都交給大腦，下面這套內建 AI 不跑
export const brainHook = { run: null };
// 給大腦用的內建工具（避牆、推進距離、射線檢查、射程）
export const aiTools = { steer: (e, mx, mz) => steer(e, mx, mz), clearAhead: (e, ux, uz, len) => clearAhead(e, ux, uz, len), boostLen: (e, ux, uz) => boostLen(e, ux, uz), lineClear: (e, slot, d, tgt) => lineClear(e, slot, d, tgt), reachOf: d => reachOf(d) };
export function updateEnemy(e, dt, player) {
  if (e.fall) { updateFall(e, dt); return; }
  if (!e.alive) return;
  if (e.swarm) updateSwarmFx(e, dt);
  if (e.bug) updateBug(e, dt);
  if (e.quad) for (const [i, r] of e.quad.rotors.entries()) r.rotation.y += dt * (i % 2 ? 38 : -38);
  if (e.drop) { if (updateDrop(e, dt, player)) return; }
  // 待命（遠征模式還沒發現玩家的小隊）：站著不動、偶爾轉頭看看
  if (e.dormant) {
    e.drive = { mx: 0, mz: 0 };
    // 巡邏：慢慢走向 e.patrol（遠征模式每幀更新路線點），看著前進方向
    const P = e.patrol, pd = P ? Math.hypot(P.x - e.x, P.z - e.z) : 0;
    if (P && pd > 1 && !e.fixed) { e.drive = steer(e, (P.x - e.x) / pd * 0.4, (P.z - e.z) / pd * 0.4); e.aimYaw = Math.atan2(P.x - e.x, P.z - e.z); }
    else if (Math.random() < dt * 0.25) e.aimYaw = e.torsoYaw + (Math.random() - 0.5) * 2;
    e.laser.g.visible = false;
    return;   // 不開火（幀預設就是不開火；執行器照樣跑 updateGuns 的冷卻）
  }
  if (e.brain && brainHook.run) { brainHook.run(e, dt, player); return; }
  // gruntTac（實驗，預設關）：雜魚也用王牌戰術 + 戰場意識；'full' = 連紀律（掩體、省彈、推進理由）也給
  const tac = (AI_TUNE.ace === true || AI_TUNE.ace === e.team) && (!e.grunt || !!AI_TUNE.gruntTac);   // 新數值的王牌戰術（ace 也可以是隊伍名字：只給那一隊用，模擬比較新舊戰術用）
  if (tac) { if (AI_TUNE.aware) aceAware(e, dt); player = aceTarget(e, player, dt); }   // 戰場意識（已知 / 推估的敵人、威脅、包圍、出現點）
  const A = e.ai, DF = e.diff ?? AI.diff, disc = tac && AI_TUNE.discipline && (!e.grunt || AI_TUNE.gruntTac === 'full');
  if (disc) trackPain(e, dt);
  const dx = player.x - e.x, dz = player.z - e.z, dist = Math.hypot(dx, dz) || 1;
  const nx = dx / dist, nz = dz / dist;
  const rayOk = rayBlock(e.x, e.z, nx, nz, dist) >= dist - 0.9;
  const los = rayOk && !smokeHides(e.x, e.z, player.x, player.z);   // 煙霧彈：看不穿（3.5 格內貼身看得到）
  // 盲射（2026-11-28）：只被煙擋住（沒有牆）、6 秒內看過 → 往最後看到的位置附近打（有範圍的武器優先、精準武器不打）
  if (los) { A.seenT = G.now; A.seenAt = { x: player.x, z: player.z }; }
  const blindAt = !los && rayOk && player.alive && !AI.passive && A.seenAt && G.now - (A.seenT ?? -99) < 6 && dist < 30
    ? { x: A.seenAt.x + Math.sin(G.now * 2.3 + e.seed) * 1.5, z: A.seenAt.z + Math.cos(G.now * 1.9 + e.seed) * 1.5 } : null;
  A.blindAt = blindAt;
  // 感知（AI_TUNE.memory）：K = 看不到時要去 / 要瞄的地方（null = 照舊用真實位置）；長距鎖定頭看得穿牆，不受限制
  let K = null;
  if (AI_TUNE.memory && player.alive) { if (los) remember(e, player); else if (!e.fixed) K = recall(e, player, dist, dt); }   // 砲塔也會回報看到的位置

  // 衝鋒機：預告、衝刺、暈眩的時候不走一般的移動
  if (e.charger && updateCharger(e, dt, player, dist, nx, nz, los)) { e.laser.g.visible = false; return; }
  // 自爆機：貼近後點火，時間到就炸
  if (e.bomber && updateBomber(e, dt, player, dist, los)) return;
  // 蟲群：貼著玩家就一直啃
  // 近戰（戰士蟲）：貼到身邊就劈，咬中有機率腐蝕被咬的那個部位
  const ML = e.preset.melee;
  if (ML && (A.bite = (A.bite ?? 0) - dt) <= 0 && player.alive && e.staggerT <= 0 && dist < e.r + player.r + ML.reach) {
    A.bite = ML.cd * (0.85 + Math.random() * 0.3);
    bugStrike(e);
    const r = att(e, 'bite', () => hitMech(player, ML.dmg * (e.dmgMul ?? 1), nx, nz, ML.kb, 'kinetic', null, ML.dmg));
    sparks(player.x - nx * player.r, 1, player.z - nz * player.r, 0xffc070, 6, -nx, -nz);
    sfx.hit();
    if (r && player.alive && Math.random() < ML.corrode) applyStatus(player, 'corrode', { part: r.part });
  }
  if (e.swarm && player.alive && dist < 2.3 && (A.bite = (A.bite ?? 0) - dt) <= 0) {
    A.bite = 0.3;
    att(e, 'swarm', () => hitMech(player, 6 * (e.dmgMul ?? 1), nx, nz, 0.15, 'kinetic', null, 6));
    sparks(player.x, 1, player.z, 0xff5030, 3, -nx, -nz);
  }

  // 移動：看不到 → 照流場繞過去；射擊型看得到、在射程內 → 去自己的射擊位置；近戰型 → 直衝；近了後退
  A.t -= dt;
  if (A.t <= 0) { A.t = 2 + Math.random() * 2.5; if (Math.random() < 0.5) A.strafe *= -1; }
  let mx, mz;
  const ranged = A.want >= 6;
  let kite = null;
  const indR = AI_TUNE.spotter && !e.fixed ? Object.values(e.guns).reduce((r, g) => g.def.indirect ? Math.max(r, reachOf(g.def)) : r, 0) : 0;   // 有迫擊砲的：射程
  const W = tac && AI_TUNE.aware ? A.tac : null;
  const AM = W && ranged && !e.fixed ? W.mel : null;
  if (disc && ranged && !e.fixed) updateCover(e, dt, player, los);
  if (!player.alive) { mx = 0; mz = 0; }
  else if (AM && AM.d < 9) {
    // 反近戰（遠程王牌）：近戰型衝過來 → 往側後方斜著退（直線後退跑不贏），選比較空、離其他敵人遠的那一側；
    //   貼到 4.5 格內、還在衝 → 往側面推進閃開它的突進（下面的推進段用 A.dodgeDir）
    const px = -AM.uz, pz = AM.ux;
    let side = 1, bestL = -1;
    for (const sg of [1, -1]) { const ux = AM.ux * 0.6 + px * sg * 0.8, uz = AM.uz * 0.6 + pz * sg * 0.8, l = clearAhead(e, ux, uz, 6) - threatAt(W.foes, e.x + ux * 4, e.z + uz * 4, AM.m); if (l > bestL) { bestL = l; side = sg; } }
    mx = AM.ux * 0.6 + px * side * 0.8; mz = AM.uz * 0.6 + pz * side * 0.8; A.spot = null;
    if (AM.d < 4.5 && AM.closing > 1 && (A.dodgeT = (A.dodgeT ?? 0) - dt) <= 0) { A.dodgeT = 1.2; A.dodgeDir = { x: px * side, z: pz * side }; A.reposition = Math.min(A.reposition, 0); }
  }
  else if (W?.retreat && !e.fixed) {
    // 要被包圍了（敵人分布超過 120°）/ 站的地方太危險：在被包死之前往缺口撤，照路線走；三台以上或包得很死就推進拉開
    const R = W.retreat, rx = R.x - e.x, rz = R.z - e.z, rd = Math.hypot(rx, rz) || 1;
    const f = (!e.fly && rd > 1.5 && routeDir(`r${e.id}`, G.now, e.x, e.z, R.x, R.z)) || { x: rx / rd, z: rz / rd };
    mx = f.x; mz = f.z; A.spot = null;
    if (W.n >= 3 || W.spread > 2.7) { A.reposition = Math.min(A.reposition, 0); A.urgent = true; }
  }
  else if (disc && A.cover && !e.fixed) {
    // 減員紀律：這一輪換血虧了 / 血少還在挨打 → 退到看不到目標的掩體喘一下，時間到再探頭（updateCover）
    const C = A.cover, cx = C.x - e.x, cz = C.z - e.z, cd = Math.hypot(cx, cz) || 1;
    const f = cd > 1.2 ? ((!e.fly && cd > 2 && routeDir(`c${e.id}`, G.now, e.x, e.z, C.x, C.z)) || { x: cx / cd, z: cz / cd }) : null;
    if (f) { mx = f.x; mz = f.z; } else { mx = 0; mz = 0; }
    A.spot = null;
  }
  else if (tac && ranged && !e.fixed && (kite = kiteFrom(e))) {
    // 被包夾（近距離有兩台以上、或有近戰型貼上來）：往反方向退，順便左右晃；三台以上直接推進拉開
    mx = kite.x - kite.z * A.strafe * 0.3; mz = kite.z + kite.x * A.strafe * 0.3; A.spot = null;
    if (kite.n >= 3) { A.reposition = Math.min(A.reposition, 0); A.urgent = true; }
  }
  else if (indR && dist > 6 && dist < indR) {
    // 迫擊砲（新數值）：射程內就躲在看不到目標的地方打，靠觀測者；看不到也不往目標走
    A.spotT = (A.spotT ?? 0) - dt;
    if (!A.spot || A.spotT <= 0) { A.spot = pickSpot(e, player, false, indR); A.spotT = 3 + Math.random() * 2; }
    const sx = A.spot.x - e.x, sz = A.spot.z - e.z, sd = Math.hypot(sx, sz);
    if (sd > 1.2) { mx = sx / sd; mz = sz / sd; } else { mx = 0; mz = 0; }
  }
  else if (W && ranged && !e.fixed && W.foes.some(f => f.melee && f.m === player) && dist < 26 && W.foes.filter(f => !f.melee).length === 0) {
    // 遠程王牌對上只有近戰型的敵人：不往它們走，站在原地 / 小幅橫移等它們穿過空地進射程（讓它們多吃幾輪）
    mx = -nz * A.strafe * 0.3; mz = nx * A.strafe * 0.3;
  }
  else if (!los || dist > A.want + (ranged ? 6 : 4)) {
    // 看不到玩家：照流場繞過去（pathing.js；會飛的用飛行流場）；看得到就直線靠近
    //   新戰術：目標不是玩家（觀戰、模擬）也照路走（routeDir），不會一路撞建築
    let f;
    const LG = laneGoal(e, K ?? player, dist, nx, nz);   // 雜魚小隊分路（AI_TUNE.gruntLanes）
    if (LG) {
      const lx = LG.x - e.x, lz = LG.z - e.z, ld = Math.hypot(lx, lz) || 1;
      f = (!e.fly && ld > 1.5 && routeDir(`l${e.id}`, G.now, e.x, e.z, LG.x, LG.z)) || { x: lx / ld, z: lz / ld };
      if (LG.slow) f = { x: f.x * 0.55, z: f.z * 0.55 };
    } else if (K) {
      // 看不到：照路線走去記憶裡的位置（聽到 / 最後看到 / 搜索點），會飛的直線過去
      //   散開部署的雜魚（A.flank）：離目標還遠（> 16 格）時目的地往自己那一側偏，從不同的街道包過來
      if (A.flank && dist > 16 && !isSolid(K.x, K.z + A.flank)) K = { ...K, z: K.z + A.flank };
      const kx = K.x - e.x, kz = K.z - e.z, kd = Math.hypot(kx, kz) || 1;
      f = (!e.fly && kd > 1.5 && routeDir(`k${Math.round(K.x / 3)},${Math.round(K.z / 3)}`, G.now, e.x, e.z, K.x, K.z)) || { x: kx / kd, z: kz / kd };
      if (K.slow) f = { x: f.x * 0.55, z: f.z * 0.55 };   // 搜索 / 跟丟：慢慢走
    } else f = !los && player.isPlayer ? (e.fly ? flyDir(e.x, e.z) : flowDir(e.x, e.z)) : !los && tac && !e.fly ? routeDir(player.id, G.now, e.x, e.z, player.x, player.z) : null;
    if (f) { mx = f.x; mz = f.z; } else { mx = nx; mz = nz; }
    A.spot = null;
  }
  else if (e.swarm || e.preset.melee) { mx = nx; mz = nz; }   // 純近戰（蟲群、戰士蟲）：看得到就一路貼上去，不繞圈
  else if (A.lineBlockedT > 0.4) {
    // 看得到但槍口被轉角擋住（槍口在身體側邊）：往被擋的反方向橫移、同時靠近一點，讓出射線
    // 左邊掛點在機體本地 +x = 世界 (nz, -nx)；往被擋那一邊的反方向移
    const s2 = A.blockSide === 'L' ? -1 : 1;
    const lx = nz, lz = -nx;
    mx = lx * s2 * 0.9 + nx * 0.4; mz = lz * s2 * 0.9 + nz * 0.4;
  }
  else if (dist < A.want - 2 && !ranged) { mx = -nx; mz = -nz; }
  else if (ranged && !e.hold && !e.fixed) {
    // 射擊位置：沒有、時間到、被打到、或那裡看不到玩家了 → 重挑
    A.spotT = (A.spotT ?? 0) - dt;
    const hp = e.parts.torso.hp, hurt = hp < (A.spotHp ?? hp) - 0.5;
    A.spotHp = hp;
    // 新戰術：同時被兩台以上（目標以外）看到 → 馬上換位置（每 0.5 秒最多一次）
    if (tac && A.spot && A.spotT < 1 && (A.exT = (A.exT ?? 0) - dt) <= 0) { A.exT = 0.25; if (exposure(e, player) >= 2) A.spotT = 0; }
    if (!A.spot || A.spotT <= 0 || hurt) { A.spot = pickSpot(e, player, tac); A.spotT = tac ? 1.5 + Math.random() * 1 : 2 + Math.random() * 2; }
    const sx = A.spot.x - e.x, sz = A.spot.z - e.z, sd = Math.hypot(sx, sz);
    if (sd > 1.2) { mx = sx / sd; mz = sz / sd; }
    else { mx = -nz * A.strafe * 0.35; mz = nx * A.strafe * 0.35; }   // 到了：小幅左右晃
  }
  else if (dist < A.want - 2) { mx = -nx; mz = -nz; }
  else { mx = -nz * A.strafe + nx * 0.15; mz = nx * A.strafe + nz * 0.15; }
  // 分散：3 格內的同伴互相推開
  if (player.alive && !e.fixed) {
    for (const o of enemies) {
      if (o === e || !o.alive || o.team !== e.team || o.dormant) continue;
      const ox = e.x - o.x, oz = e.z - o.z, od = Math.hypot(ox, oz);
      if (od < 3 && od > 1e-3) { const k = (3 - od) / 3 * 0.9; mx += ox / od * k; mz += oz / od * k; }
    }
    const ml = Math.hypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; }
  }
  // 守備：離據點 hold.r 格以上就回去；靠近邊緣時不再往外走（只保留沿著邊緣的分量）
  const Hd = e.hold;
  if (Hd) {
    const ax = Hd.x - e.x, az = Hd.z - e.z, ad = Math.hypot(ax, az) || 1;
    if (ad > Hd.r) { mx = ax / ad; mz = az / ad; }
    else if (ad > Hd.r * 0.6) { const out = -(mx * ax + mz * az) / ad; if (out > 0) { mx += ax / ad * out; mz += az / ad * out; } }
  }
  ({ mx, mz } = steer(e, mx, mz));
  if (e.fixed) mx = mz = 0;   // 砲塔

  // 推進：重的子彈 / 飛彈飛過來往旁邊噴；偶爾推進換位置；近戰型推進衝過去
  A.reposition -= dt;
  let boost = false, bx = mx, bz = mz;
  if (DF.dodge) for (const s of shots) {
    if (s.team === e.team || s.kind === 'fuel' || !(s.heavy || s.kind !== 'bullet' || s.dmg > 20)) continue;
    const sdx = s.dx ?? s.vx / s.speed, sdz = s.dz ?? s.vz / s.speed;
    const ox = e.x - s.x, oz = e.z - s.z, t = ox * sdx + oz * sdz;
    if (t < 0 || t > 6) continue;
    const px = ox - sdx * t, pz = oz - sdz * t;
    if (px * px + pz * pz < 1.6 && Math.random() < dt * 6) {
      boost = true; const side = px * -sdz + pz * sdx > 0 ? 1 : -1;
      bx = -sdz * side; bz = sdx * side;
    }
  }
  const PC = player.charge;
  if (DF.dodge && PC && player.alive) {
    const f = PC.phase === 'dash' ? { x: PC.dx, z: PC.dz } : facing(player), ox = e.x - player.x, oz = e.z - player.z, t = ox * f.x + oz * f.z;
    if (t > 0 && t < 10 && Math.abs(ox * f.z - oz * f.x) < 1.6 && Math.random() < dt * 5) { boost = true; const side = ox * f.z - oz * f.x > 0 ? 1 : -1; bx = f.z * side; bz = -f.x * side; }
  }
  if (A.reposition <= 0 && player.alive) {
    A.reposition = e.preset?.elite?.jumpy ? 1.8 + Math.random() * 2 : 4 + Math.random() * 4;
    if (disc && ranged) {
      // 紀律：換位置的推進要有理由（被包圍 / 撤退、正在挨打、站的地方被兩台以上盯著）；
      //   方向去掉往目標的分量（遠程機不往前噴），剩下太小就往橫的噴
      const why = A.urgent || A.painK > 0.04 || (W ? W.here : exposure(e, player)) >= 2;
      if (why) {
        boost = true;
        const fw = bx * nx + bz * nz;
        if (fw > 0) { bx -= nx * fw; bz -= nz * fw; }
        if (Math.hypot(bx, bz) < 0.3) { bx = -nz * A.strafe; bz = nx * A.strafe; }
      }
    } else { boost = true; if (A.want <= 3 && dist > 4) { bx = nx; bz = nz; } }
  }
  A.urgent = false;
  if (A.dodgeDir) { bx = A.dodgeDir.x; bz = A.dodgeDir.z; boost = true; A.dodgeDir = null; }   // 反近戰：往側面閃開突進
  if (boost && !DF.dodge && !(A.reposition > 3.9)) boost = false;
  if (e.fixed || Hd) boost = false;
  if (boost && e.energy > 55) {
    // 噴出去的方向要夠空，不然換反方向 / 斜的，都不行就不噴（推進撞牆是以前的頭號死因）
    const d = Math.hypot(bx, bz) || 1, ux = bx / d, uz = bz / d;
    for (const [cx, cz] of [[ux, uz], [ux * 0.7 - uz * 0.7, uz * 0.7 + ux * 0.7], [ux * 0.7 + uz * 0.7, uz * 0.7 - ux * 0.7], [-ux, -uz]]) {
      const bd = boostDirOf(e, cx, cz), len = boostLen(e, bd.x, bd.z);
      if (disc && ranged && closesOn(e, bd.x, bd.z, W, player)) continue;   // 紀律：遠程機不往任何一台（理想距離 + 4 格內的）敵人噴
      if (clearAhead(e, bd.x, bd.z, len) >= len) { if (qBoost(e, cx, cz)) A.lastBoost = { x: e.x, z: e.z, len, t: G.now }; break; }
    }
  }
  e.drive = { mx, mz };

  // 瞄準：稍微預判
  const lead = AI_TUNE.leadReal ? dist / shotSpeedOf(e) : dist / 18 * 0.5;
  e.aimYaw = !los && W?.emerge ? Math.atan2(W.emerge.x - e.x, W.emerge.z - e.z) : K ? (K.free ? Math.atan2(e.drive?.mx || Math.sin(e.torsoYaw), e.drive?.mz || Math.cos(e.torsoYaw)) : Math.atan2(K.x - e.x, K.z - e.z)) : Math.atan2(player.x + player.vx * lead - e.x, player.z + player.vz * lead - e.z) + Math.sin(G.now * 1.7 + e.seed) * DF.err;   // 看不到：預瞄記憶裡的位置
  if (blindAt) e.aimYaw = Math.atan2(blindAt.x - e.x, blindAt.z - e.z);
  const canShoot = los && player.alive && !AI.passive;
  const onTarget = Math.abs(angleDiff(e.torsoYaw, e.aimYaw)) < 0.14 && (canShoot || !!blindAt);   // 盲射也算瞄準了
  // 鎖定玩家（給飛彈用）：在範圍內、看得到就慢慢鎖上
  const H = headStats(e);   // 頭受損鎖定也會變差（sensors.js）
  if (e.lockBreak) { A.lockT = 0; e.lockBreak = false; }   // 失衡：鎖定被打斷
  updateReadyChoice(e, dt, dist, canShoot, player, disc);
  // 要看得到才鎖得到（2026-11-28 起長距鎖定頭也一樣）；頭被打掉還是能鎖（距離短、慢）
  const lockable = player.alive && !AI.passive && los;   // 2026-11-28：只鎖得到看得見的目標（長距鎖定頭也不能隔牆鎖）
  const lockNeed = H.lockTime * DF.lock * burnLockK(e);
  // 新火控（被動追蹤、鎖定保持、鎖定熱度）：王牌級（不是雜魚）照 BAL.fcsAI 決定用不用（fcsOn）；雜魚照舊
  if (e.lockFire) { e.lockFire = false; if (A.lockT >= lockNeed) A.lockT = lockNeed * (1 - BAL.lockHeat); }   // 鎖定熱度（BAL.relock 'heat'）
  const canLock = lockable && ((fcsOn(e) && BAL.fcsPassive) || wantsLock(e)) && dist < H.lockRange && !(G.now < (e.relockUntil ?? 0));
  if (canLock) A.lockSeenT = G.now;
  const held = fcsOn(e) && !canLock && A.lockT >= lockNeed && BAL.lockHold > 0 && G.now - (A.lockSeenT ?? -99) < BAL.lockHold;   // 鎖定保持（BAL.lockHold）
  A.lockT = canLock ? A.lockT + dt : held ? A.lockT : Math.max(0, A.lockT - dt * 5);   // 目標離開鎖定範圍 / 視線：很快退掉（2026-11-28：×2 → ×5，不然撤退中還一直連發飛彈）
  const locks = A.lockT >= lockNeed ? [player] : [];
  e.lockOn = A.lockT > 0 && player.alive ? { tgt: player, k: Math.min(1, A.lockT / lockNeed) } : null;   // 給玩家的被鎖定警示（lockwarn.js）

  // 手臂：連射武器一陣一陣打；狙擊先亮雷射；劍貼近才揮；飛彈有鎖定才射
  const trig = { L: false, R: false };
  if (A.burst > 0) A.burst -= dt;
  else { A.rest -= dt; if (A.rest <= 0 && onTarget) { A.burst = 0.8; A.rest = (1 + Math.random() * 1.2) * DF.rest; } }
  let laserSlot = null, anyClear = false, blockedSide = null, ind = null;   // ind：迫擊砲這一發的落點
  for (const side of ['L', 'R']) {
    const slot = activeSlot(e, side), g = e.guns[slot];
    if (!g || slotBroken(e, slot) || e.deployT[side] > 0 || g.ammo <= 0 || g.def.kind === 'shield') continue;
    const d = g.def;
    // 這把的射線會不會馬上被擋住（轉角游擊時槍口常常在牆後）
    const clear = !canShoot || lineClear(e, slot, d, player);
    if (canShoot) { if (clear) anyClear = true; else blockedSide = side; }
    const inRange = clear && dist < reachOf(d);
    let t = false;
    if (d.kind === 'saber') t = inRange && canShoot && Math.abs(angleDiff(e.torsoYaw, e.aimYaw)) < 0.4;
    // 打樁拳：貼到拳頭打得到、正對著才打
    else if (d.kind === 'pile') t = canShoot && dist < d.reach + e.r + player.r + 0.15 && Math.abs(angleDiff(e.torsoYaw, e.aimYaw)) < 0.3;
    // 騎槍：中距離、正對著、整條衝刺路線上沒有牆才衝（撞牆是自己吃傷害）
    else if (d.kind === 'lance') {
      const f = facing(e);
      t = canShoot && dist > 3.5 && dist < reachOf(d) && Math.abs(angleDiff(e.torsoYaw, e.aimYaw)) < 0.1 && rayBlock(e.x, e.z, f.x, f.z, dist) >= dist - 0.3 && Math.random() < dt * 1.5 / DF.rest;
    }
    // 脈衝光束：瞄準了就照（照射中上半身轉得慢 → 玩家橫移躲得掉）
    // 汽油投射器：打得到就一直噴（不點放），火舌跟著上半身甩
    else if (d.kind === 'stream') t = canShoot && inRange && Math.abs(angleDiff(e.torsoYaw, e.aimYaw)) < 0.35;
    else if (d.kind === 'pulse') t = onTarget && inRange && Math.random() < dt * 1.4 / DF.rest;
    else if (d.kind === 'missile' || d.kind === 'split') t = canShoot && clear && locks.length > 0 && Math.random() < dt * 1.6 / DF.rest;
    else if (d.kind === 'vmissile') t = clear && locks.length > 0 && dist > 6 && dist < (d.range ?? 99) && Math.random() < dt * 1.2 / DF.rest;
    // 迫擊砲（indirect）：射程內就打，看不到也打（拋過建築；落點照目標現在的位置）
    else if (d.indirect) {
      if (player.alive && !AI.passive && dist > 5 && dist < reachOf(d) && Math.random() < dt * 1.2 / DF.rest) {
        const P = AI_TUNE.spotter ? mortarPoint(e, player) : { x: player.x, z: player.z };
        const pd = P ? Math.hypot(P.x - e.x, P.z - e.z) : 0;
        if (P && pd > 5 && pd < reachOf(d) && lobClear(e, d, P.x, P.z)) { t = true; ind = P; }   // 射程看實際要打的那一點；彈道會撞建築就不打
      }
    }
    // 燒夷 / 酸液 / 榴彈：彈道會撞到建築（BAL.lobHitsBuildings）就不丟，換個位置（REALISM_REPORT H3）
    else if (d.kind === 'napalm' && !lobClear(e, d, player.x, player.z)) { t = false; A.spotT = 0; }
    else if (d.speed / SHOT_TUNE.speedK > 50) {
      // 狙擊：瞄 0.8 秒（紅色雷射）才開槍
      if (onTarget && inRange && g.cd <= 0 && g.ammo > 0) { A.snipeT += dt; laserSlot = slot; if (A.snipeT >= 0.8) { t = true; A.snipeT = 0; } }
      else A.snipeT = Math.max(0, A.snipeT - dt);
    } else if (d.interval >= 1) t = onTarget && inRange && Math.random() < dt * 1.2 / DF.rest;
    else t = A.burst > 0 && onTarget && inRange;
    // 紀律：彈藥少的無導引武器（火箭、加農砲、霰彈）命中機會太低就先不打，留到打得中再打
    if (t && disc && d.ammo && d.ammo <= 60 && !GUIDED.has(d.kind) && !d.indirect && !blindAt && hitEst(e, d, player, dist) < 0.3) t = false;
    if (t && !canShoot && blindAt && (d.kind === 'beam' || d.kind === 'pulse' || d.kind === 'lance' || d.kind === 'saber' || d.kind === 'pile')) t = false;   // 盲射：光束、近戰不打
    trig[side] = t;
  }
  // 連續一陣子所有武器都被擋 → 移動時去讓出射線
  A.lineBlockedT = canShoot && !anyClear && blockedSide ? (A.lineBlockedT ?? 0) + dt : 0;
  if (blockedSide) A.blockSide = blockedSide;
  // 開路（據點戰 conquest.js 設 e.siegeAt）：附近沒有打得到的敵人 → 瞄著那格建築，用打得壞牆的武器打
  if (e.siegeAt && !(canShoot && dist < 22)) { ind = siegeFire(e, trig, dt); laserSlot = null; }
  qGuns(e, trig, locks, ind ?? blindAt ?? { x: player.x, z: player.z });   // 盲射：拋射武器落在最後看到的位置附近
  if (laserSlot) {
    const mz = muzzleOf(e, laserSlot), f = facing(e);
    const len = Math.min(rayBlock(mz.x, mz.z, f.x, f.z, 30), dist);
    setLaser(e.laser, mz.x, mz.z, f.x, f.z, len, mz.y, 0.3 + A.snipeT * 0.8, 0.04 + A.snipeT * 0.05);
  } else e.laser.g.visible = false;
}

// ---------- 打建築（開路 / 攻城） ----------
// breakPow：這把打建築的威力（0 = 打不太動：機槍、光束、要鎖定的飛彈）；breakReach：站多遠打得到
export const breakPow = d => !d ? 0 : d.kind === 'napalm' ? d.dmg * (d.bldK ?? 1) * (d.indirect ? 0.6 : 1) : d.kind === 'rocket' ? d.dmg * (d.salvo || 1) : d.kind === 'pile' ? d.dmg
  : d.kind === 'lance' ? d.dmgMax * 0.5 : d.kind === 'bullet' && (d.heavy || d.dmg >= 8) ? d.dmg * (d.pellets || 1) * (d.heavy ? 1.5 : 1) : 0;
export const breakReach = (e, d) => d.kind === 'pile' ? d.reach + e.r + 0.3 : d.kind === 'lance' ? reachOf(d) : d.kind === 'napalm' ? d.range : d.kind === 'rocket' ? 18 : Math.min(18, reachOf(d));
// 每一邊挑打建築最有效、打得到的那把（背部的要先架起來），瞄準了就開火；回傳拋射彈的落點
function siegeFire(e, trig, dt) {
  const P = e.siegeAt, A = e.ai, sx = P.x - e.x, sz = P.z - e.z, sd = Math.hypot(sx, sz);
  e.aimYaw = Math.atan2(sx, sz);
  const on = Math.abs(angleDiff(e.torsoYaw, e.aimYaw)) < 0.1;
  for (const side of ['L', 'R']) {
    let pick = null, ps = 0;
    for (const sl of ['arm' + side, 'back' + side]) {
      const g = e.guns[sl];
      if (!g || slotBroken(e, sl) || g.ammo <= 0) continue;
      const b = breakPow(g.def);
      if (b > ps && sd < breakReach(e, g.def)) { ps = b; pick = sl; }
    }
    trig[side] = false;
    if (!pick) continue;
    if (activeSlot(e, side) !== pick) {
      if (e.deployT[side] <= 0 && qReady(e, side)) { A.commit ??= { L: 0, R: 0 }; A.commit[side] = 3; A.hold[side] = 3; }
      continue;
    }
    trig[side] = on && e.deployT[side] <= 0;
  }
  return { x: P.x, z: P.z };
}

// ---------- 背部武器要不要架起來 ----------
// 用得上（飛彈：看得到、在鎖定距離內；加農砲：看得到、打得到）才架；架著一陣子後多半收回來用手臂
// 手上是劍而且已經貼近：一定用劍
// 射線檢查：從槍口沿著上半身正前方，到目標的距離內有沒有方塊
//   子彈 / 光束：整段要通；直射 / 分裂飛彈：轉得慢，前面 5 格要空；垂直飛彈越過掩體、劍是近戰，不用管
function lineClear(e, slot, d, tgt) {
  if (d.kind === 'saber' || d.kind === 'vmissile' || d.kind === 'napalm' || d.kind === 'pile' || d.kind === 'lance') return true;
  const mz = muzzleOf(e, slot), f = facing(e);
  const md = Math.hypot(tgt.x - mz.x, tgt.z - mz.z);
  const need = d.kind === 'missile' || d.kind === 'split' ? Math.min(md - 0.5, 5) : md - tgt.r;
  return need <= 0 || rayBlock(mz.x, mz.z, f.x, f.z, need) >= need;
}
function backUseful(e, slot, d, dist, canShoot, head, tgt) {
  // 垂直飛彈 + 長距鎖定頭：射程內就架起來（鎖定還是要看得到）
  if (d.kind === 'vmissile' && head.radarLock && tgt.alive && !AI.passive) return dist > 6 && dist < Math.min(head.lockRange, d.range ?? 99);
  if (!canShoot || !lineClear(e, slot, d, tgt)) return false;
  if (d.kind === 'missile' || d.kind === 'split') return dist < head.lockRange;
  if (d.kind === 'vmissile') return dist > 5 && dist < Math.min(head.lockRange, d.range ?? 99);
  return dist < reachOf(d);
}
function updateReadyChoice(e, dt, dist, canShoot, tgt, disc = false) {
  const A = e.ai;
  for (const side of ['L', 'R']) {
    const back = e.guns['back' + side], arm = e.guns['arm' + side];
    if (!back || back.def.kind === 'module' || slotBroken(e, 'back' + side) || !arm || slotBroken(e, 'arm' + side)) continue;   // 沒得選（沒手臂武器的會自動架著）
    if (e.deployT[side] > 0) continue;
    const melee = (arm.def.kind === 'saber' || arm.def.kind === 'pile') && dist < 5 || arm.def.kind === 'lance' && dist < 9;
    if (e.ready[side] && melee) { qReady(e, side); A.hold[side] = 1.5; continue; }
    if (disc) {
      // 紀律：照「這把現在打出去的期望傷害」選（weaponScore），另一把要明顯比較好（×1.6）才換；
      //   換了至少用 4 秒；正在鎖定的飛彈不收；盾牌那一邊不換（盾牌不能收）
      if (arm.def.kind === 'shield' || melee) continue;
      A.commit ??= { L: 0, R: 0 };
      if ((A.commit[side] -= dt) > 0) continue;
      const on = e.ready[side], cs = on ? 'back' + side : 'arm' + side, as = on ? 'arm' + side : 'back' + side;
      const sc = weaponScore(e, cs, dist, canShoot, tgt), sa = weaponScore(e, as, dist, canShoot, tgt);
      if (sc > 0 && GUIDED.has(e.guns[cs].def.kind) && A.lockT > 0.15) continue;
      if (sa > sc * 1.6 + 1 && qReady(e, side)) A.commit[side] = 4;
      continue;
    }
    if ((A.hold[side] -= dt) > 0) continue;
    const useful = back.ammo > 0 && backUseful(e, 'back' + side, back.def, dist, canShoot, headStats(e), tgt);
    if (!e.ready[side]) {
      if (useful && !melee && Math.random() < 0.6) { qReady(e, side); A.hold[side] = 2.5 + Math.random() * 2; }
      else A.hold[side] = 0.6 + Math.random() * 0.8;
    } else if (!useful || Math.random() < 0.6) { qReady(e, side); A.hold[side] = 1.5 + Math.random() * 1.5; }
    else A.hold[side] = 1 + Math.random();
  }
}

// ---------- 避牆 ----------
// 三條射線（中間 + 左右肩寬）裡最短的那條：機體整台過不過得去
function clearAhead(e, ux, uz, len) {
  const o = e.r * BAL.clearAheadK, ray = e.fly ? rayBlock : rayWalk;   // 走路的空洞也算擋住；會飛的只看岩壁和建築
  return Math.min(ray(e.x, e.z, ux, uz, len), ray(e.x - uz * o, e.z + ux * o, ux, uz, len), ray(e.x + uz * o, e.z - ux * o, ux, uz, len));
}
const hoverOf = e => e.spec.legs.type === 'hover';
// 往 (ux, uz) 推進會滑多遠：噴射段 + 從噴射速度剎回極速的距離 + 餘裕（原本就往那邊跑的速度會疊上去）
// 剎車：一般腳超速時用整個抓地力（約 26），懸浮只有約 7；腳受傷都更差
function boostLen(e, ux, uz) {
  const k = boostKOf(e), along = Math.max(0, e.vx * ux + e.vz * uz);
  const v0 = along + BOOST_DV * k + BOOST_PUSH * k * BOOST_TIME, vmax = e.spec.vmax;
  const decel = (hoverOf(e) ? 7 : 26) * legK(e);
  return v0 * BOOST_TIME + Math.max(0, v0 * v0 - vmax * vmax) / (2 * decel) + 1.5;
}
// 雜魚小隊分路：同一小隊（同一個集結點 flank / 同一個 e.squad）照 id 排成左、中、右三路，
//   沿著「目標 → 小隊重心」那條中線，每台追自己那一路上離目標近 14 格的點（往旁邊偏 8 格，離目標越近越收攏）
//   → 一出發就走平行的不同街道、最後從不同方向包過來，不會排成一列被連發火箭 / 爆風一次帶走；中路（或只剩一台）照舊直接過去
function laneGoal(e, T, dist, nx, nz) {
  const A = e.ai;
  if (!AI_TUNE.gruntLanes || !e.grunt || e.fixed || dist < 12) return null;
  // 同伴每次重新數（遠征的空投小隊一台一台降、有人陣亡 → 分路跟著重排）：遠征照 e.squad.members，觀戰 / 模擬照集結點 flank
  const live = (e.squad?.members ?? enemies.filter(o => o.grunt && o.team === e.team && A.flank != null && o.ai?.flank === A.flank)).filter(o => o.alive && !o.drop && !o.dormant).sort((a, b) => a.id - b.id);
  if (live.length < 2) return null;
  A.lane = live.indexOf(e) - (live.length - 1) / 2;
  if (!A.lane) return null;
  let cx = 0, cz = 0;
  for (const o of live) { cx += o.x / live.length; cz += o.z / live.length; }
  const dC = Math.hypot(cx - T.x, cz - T.z);
  if (dC < 12) return null;
  const ux = (cx - T.x) / dC, uz = (cz - T.z) / dC, s = Math.max(10, dC - 14), k = Math.min(1, (dC - 12) / 10) * A.lane * 8;
  for (const f of [1, 0.7, 0.4]) { const x = T.x + ux * s - uz * k * f, z = T.z + uz * s + ux * k * f; if (!isSolid(x, z)) return { x, z, slow: T.slow }; }
  return null;
}

// 想往 (mx, mz) 走：前面有牆就轉開（越快看越遠）；速度朝著牆、照現在的剎車來不及停就先往反方向踩
function steer(e, mx, mz) {
  const ml = Math.hypot(mx, mz), v = Math.hypot(e.vx, e.vz), A = e.ai;
  const decel = (hoverOf(e) ? 6 : 13) * legK(e);
  if (v > 2) {
    const ux = e.vx / v, uz = e.vz / v, stop = v * v / (2 * decel) + 0.6;
    if (clearAhead(e, ux, uz, stop + 0.5) < stop) return { mx: -ux, mz: -uz };
  }
  if (ml < 0.1) return { mx, mz };
  const look = 1.4 + v * (hoverOf(e) ? 0.75 : 0.45);
  const base = Math.atan2(mx, mz);
  let best = null, bestLen = -1;
  for (const turn of [0, 0.45, -0.45, 0.9, -0.9, 1.4, -1.4, 2, -2, 2.6, -2.6]) {
    const a = base + turn * A.strafe, ux = Math.sin(a), uz = Math.cos(a);
    const len = clearAhead(e, ux, uz, look);
    if (len >= look) {
      if (Math.abs(turn) > 1.2) A.strafe *= -1;   // 繞圈繞到牆邊：換個方向繞
      return { mx: ux * ml, mz: uz * ml };
    }
    if (len > bestLen) { bestLen = len; best = [ux, uz]; }
  }
  return { mx: best[0] * ml * 0.5, mz: best[1] * ml * 0.5 };
}

// ---------- 卡點偵測與迴避（2026-11-28）----------
// 每幀在 updateEnemy 之後、driveMech 之前呼叫：想走（drive ≥ 0.3）但 1.2 秒內幾乎沒移動（< 0.5 格）→ 卡住了
//   → 往側面（左右輪流、越卡越偏，第 3 次起往後）脫困 0.7～1.3 秒；連續卡兩次以上、能推進的就推進一下
//   脫困期間照脫困方向走；真的動起來了就把次數歸零
//   機體之間的卡點（2026-11-28）：脫困方向也避開其他機體（mechAhead）；只有拿近戰武器、正在推自己目標的才不算卡住
export const stuckStats = { n: 0 };   // 脫困次數（模擬統計用）
const MELEE_KINDS = new Set(['saber', 'pile', 'lance', 'flame', 'stream']);
const meleeOf = e => e.bug || Object.entries(e.guns ?? {}).some(([sl, g]) => MELEE_KINDS.has(g.def.kind) && !slotBroken(e, sl));
// 沿 (ux, uz) 走 len 格會不會撞上別台機體：回傳撞上前能走的距離
function mechAhead(e, ux, uz, len) {
  let best = len;
  for (const m of mechs) {
    if (m === e || !m.alive || m.drop || m.ghost || m.swarm) continue;
    const dx = m.x - e.x, dz = m.z - e.z, along = dx * ux + dz * uz;
    if (along <= 0 || along > len + m.r) continue;
    if (Math.abs(dx * uz - dz * ux) < e.r + m.r) best = Math.min(best, Math.max(0, along - e.r - m.r));
  }
  return best;
}
// ---------- 閃避垂直飛彈（2026-11-28）----------
// 有敵方垂直飛彈追著自己（或落點在自己身上）、水平 20 格內 → 往跟飛彈來向垂直的方向一直橫移（同一枚飛彈固定同一邊，挑比較空的那邊）
//   俯衝只會慢慢修正落點，一直橫移就閃得掉；王牌在俯衝開始、8 格內還會推進一下；雜魚 45% 會閃；外掛大腦（e.brain）自己管
const VM = { t: -1, list: [] };
function vmDodge(e, dt) {
  if (e.brain || e.fixed || e.cq?.fort || e.swarm || e.bug) return false;
  let th = null, td = 20;
  if (VM.t !== G.now) { VM.t = G.now; VM.list.length = 0; for (const s of shots) if (s.kind === 'vmissile' && !s.spent) VM.list.push(s); }   // 每幀只掃一次子彈
  for (const s of VM.list) {
    if (s.kind !== 'vmissile' || s.spent || s.team === e.team || s.age < 0.3) continue;
    const mine = s.target ? s.target === e : s.point && Math.hypot(s.point.x - e.x, s.point.z - e.z) < 3;
    if (!mine) continue;
    const h = Math.hypot(s.x - e.x, s.z - e.z);
    if (h < td) { td = h; th = s; }
  }
  const D = e.vmd;
  if (!th) { if (D) e.vmd = null; return false; }
  if (!D || D.s !== th) {
    const go = !e.grunt || Math.random() < 0.45;
    const hx = e.x - th.x, hz = e.z - th.z, hl = Math.hypot(hx, hz) || 1, px = -hz / hl, pz = hx / hl;
    const l1 = Math.min(clearAhead(e, px, pz, 5), mechAhead(e, px, pz, 5)), l2 = Math.min(clearAhead(e, -px, -pz, 5), mechAhead(e, -px, -pz, 5));
    e.vmd = { s: th, go, side: l1 >= l2 ? 1 : -1, boosted: false };
  }
  const V = e.vmd;
  if (!V.go) return false;
  const hx = e.x - th.x, hz = e.z - th.z, hl = Math.hypot(hx, hz) || 1;
  let ux = -hz / hl * V.side, uz = hx / hl * V.side;
  if (Math.min(clearAhead(e, ux, uz, 2), mechAhead(e, ux, uz, 2)) < 0.8) { V.side = -V.side; ux = -ux; uz = -uz; }   // 那邊被擋住：換邊
  e.drive = { mx: ux, mz: uz };
  if (!e.grunt && !V.boosted && th.dive && td < 8) { V.boosted = true; qBoost(e, ux, uz); }
  return true;
}
export function antiStuck(e, dt) {
  if (!e.alive || e.drop || e.fixed || !e.drive) return;
  const F = e.foe;
  const S = e.stk ??= { x: e.x, z: e.z, t: 0, n: 0, esc: 0, dx: 0, dz: 0 };
  if (vmDodge(e, dt)) { S.esc = 0; S.x = e.x; S.z = e.z; S.t = 0; return; }
  if (S.esc > 0) {
    S.esc -= dt;
    e.drive = { mx: S.dx, mz: S.dz };
    if (S.esc <= 0) { S.x = e.x; S.z = e.z; S.t = 0; }
    return;
  }
  const want = Math.hypot(e.drive.mx, e.drive.mz);
  if (want < 0.3 || F?.alive && Math.hypot(F.x - e.x, F.z - e.z) < 3.5 && meleeOf(e)) { S.x = e.x; S.z = e.z; S.t = 0; return; }   // 拿近戰武器貼身推不動目標不算卡住
  if ((S.t += dt) < 1.2) return;
  const moved = Math.hypot(e.x - S.x, e.z - S.z);
  S.x = e.x; S.z = e.z; S.t = 0;
  if (moved >= 0.5) { S.n = 0; return; }
  S.n++; stuckStats.n++;
  const a0 = Math.atan2(e.drive.mx, e.drive.mz), side = S.n % 2 ? 1 : -1;
  let best = null, bl = -1;
  for (const off of S.n >= 3 ? [Math.PI, Math.PI * 0.75 * side, -Math.PI * 0.75 * side] : [Math.PI / 2 * side, Math.PI * 0.7 * side, -Math.PI / 2 * side]) {
    const ux = Math.sin(a0 + off), uz = Math.cos(a0 + off), l = Math.min(clearAhead(e, ux, uz, 4), mechAhead(e, ux, uz, 4));   // 牆和其他機體都算擋住
    if (l > bl) { bl = l; best = [ux, uz]; }
  }
  S.dx = best[0]; S.dz = best[1]; S.esc = 0.7 + 0.2 * Math.min(S.n, 3);
  if (S.n >= 2) qBoost(e, S.dx, S.dz);
}

// ---------- 一台（非本地玩家的）機體這一幀：控制器出幀 → 執行器照做（control.js） ----------
// foe：AI 的目標；post：模式的 postUpdate（據點戰 conquest.js：照路線走去目標、開路…，只給 AI）；stuck：要不要卡點迴避
export function stepMech(e, dt, foe, post = null, stuck = true) {
  if (ctrlOf(e) === 'remote') { if (e.fall) { updateFall(e, dt); return; } applyFrame(e, remoteFrame(e, dt), dt); return; }
  const f = beginFrame(e);
  updateEnemy(e, dt, foe);
  post?.(e);
  if (stuck) antiStuck(e, dt);
  f.mx = e.drive?.mx ?? 0; f.mz = e.drive?.mz ?? 0; f.aimYaw = e.aimYaw;
  applyFrame(e, f, dt);
}

export function keepEnemies(player) {
  if (!AI.sandbox) return;
  while (enemies.length < AI.count) spawnEnemy(player);
}

// 拋射彈從自己丟到 (tx, tz) 的弧線會不會撞到建築（照 weapons.js lobNapalm 的彈道，取 12 個點）；BAL.lobHitsBuildings 關著就一律可以
function lobClear(e, d, tx, tz) {
  if (!BAL.lobHitsBuildings) return true;
  const T = d.lobT ?? NAPALM_T, y0 = e.model?.hipY != null ? e.model.hipY + 0.5 : 1.4, vy = (0.2 - y0 + 0.5 * LOB_G * T * T) / T;
  for (let k = 1; k < 12; k++) {
    const f = k / 12, t = T * f, y = y0 + vy * t - 0.5 * LOB_G * t * t;
    if (y < buildingTop(e.x + (tx - e.x) * f, e.z + (tz - e.z) * f)) return false;
  }
  return true;
}
// ---------- 新數值的王牌戰術（AI_TUNE.ace） ----------
// 敵對、活著、在場上的
const hostilesOf = e => mechs.filter(o => o !== e && o.alive && !o.drop && o.team !== e.team && o.team !== 'none' && !o.dormant);
const sees = (e, o) => { const dx = o.x - e.x, dz = o.z - e.z, d = Math.hypot(dx, dz) || 1; return rayBlock(e.x, e.z, dx / d, dz / d, d) >= d - o.r - 0.5 && !smokeHides(e.x, e.z, o.x, o.z); };
// 挑目標（每 0.35 秒）：近的、看得到的、快死的優先；近戰型避開擠在一起的（不衝進一群裡）；現在的目標有 3 格優勢
function aceTarget(e, cur, dt) {
  const A = e.ai;
  if (e.boss) return cur;   // 遠征頭目：只打玩家（pickFoes 決定）
  if ((A.tgtT = (A.tgtT ?? 0) - dt) > 0 && A.tgt?.alive && !A.tgt.drop) return A.tgt;
  A.tgtT = 0.35;
  const H = hostilesOf(e);
  if (!H.length) return cur;
  const melee = A.want < 6;
  let best = cur, bs = Infinity;
  for (const o of H) {
    const d = Math.hypot(o.x - e.x, o.z - e.z), hpK = o.parts.torso.hp / o.parts.torso.max;
    let s = d - (sees(e, o) ? 8 : 0) - (1 - hpK) * 6 - (o === A.tgt ? 3 : 0);
    // 減員紀律：殘血的權重加倍、現在的目標更黏（快打死的那台不換）→ 一台一台收掉，不要每台都打一半
    if (AI_TUNE.discipline) s -= (1 - hpK) * 8 + (o === A.tgt ? 3 + (hpK < 0.45 ? 8 : 0) : 0);
    if (!melee && d < 9 && foeInfo(o).melee) s -= 6;   // 貼上來的近戰型先處理
    if (melee) for (const q of H) if (q !== o && Math.hypot(q.x - o.x, q.z - o.z) < 6) s += 4;
    if (s < bs) { bs = s; best = o; }
  }
  return A.tgt = best;
}
// ---------- 紀律（AI_TUNE.discipline，新數值的王牌）----------
// 武器：hitEst 估這一發打不打得中（散布 × 距離、目標橫移 × 飛行時間；導引武器當 0.8）；
//   weaponScore = 每秒傷害 × 命中 × 彈藥餘量（剩越少越省著用）；打不到 / 射線被擋 = 0
// 減員：trackPain 記最近 2.5 秒吃了多少傷害（painK = 佔全身耐久的比例）；updateCover 換血虧了就退去掩體
const GUIDED = new Set(['missile', 'split', 'vmissile']);
const MELEE_K = new Set(['saber', 'pile', 'lance', 'stream', 'flame', 'pulse']);
function hitEst(e, d, tgt, dist) {
  if (GUIDED.has(d.kind) || MELEE_K.has(d.kind) || d.indirect) return 0.8;
  const spd = d.maxSpeed ? (d.speed + d.maxSpeed) / 2 : (d.speed ?? 30) * SHOT_TUNE.enemy;
  const ux = (tgt.x - e.x) / dist, uz = (tgt.z - e.z) / dist, lat = Math.abs((tgt.vx ?? 0) * uz - (tgt.vz ?? 0) * ux);
  const miss = (d.spread ?? 0) * dist + lat * dist / spd * 0.35 + 0.05;
  return Math.min(1, ((tgt.r ?? 1) + 0.3 + (d.splash ?? 0) * 0.6) / miss);
}
function weaponScore(e, slot, dist, canShoot, tgt) {
  const g = e.guns[slot];
  if (!g || slotBroken(e, slot) || g.ammo <= 0) return 0;
  const d = g.def, H = headStats(e);
  if (d.kind === 'shield' || d.kind === 'module') return 0;
  const reach = GUIDED.has(d.kind) ? Math.min(H.lockRange, d.range ?? 99) : reachOf(d);   // 垂直飛彈：燃料只飛得到 d.range 格
  if (dist > reach || d.kind === 'vmissile' && dist < 6) return 0;
  if (!(d.kind === 'vmissile' && H.radarLock) && !d.indirect && (!canShoot || !lineClear(e, slot, d, tgt))) return 0;
  const dmg = d.kind === 'lance' ? d.dmgMax : d.dmg * (d.pellets || 1) * (d.salvo || 1) * (d.bomblets || 1);
  const ammoK = g.max === Infinity ? 1 : 0.55 + 0.45 * Math.min(1, g.ammo / g.max);
  return dmg / (d.interval || 1) * hitEst(e, d, tgt, dist) * ammoK;
}
// 往 (ux, uz) 噴會不會衝向敵人：已知看得到的敵人（沒有戰場意識就只看目標）在理想距離 + 4 格內、方向夾角 60° 內
function closesOn(e, ux, uz, W, tgt) {
  const L = W ? W.foes.filter(f => f.vis).map(f => f.m) : [tgt], lim = e.ai.want + 4;
  for (const o of L) { const dx = o.x - e.x, dz = o.z - e.z, d = Math.hypot(dx, dz) || 1; if (d < lim && (dx * ux + dz * uz) / d > 0.5) return true; }
  return false;
}
function trackPain(e, dt) {
  const A = e.ai;
  let hp = 0, max = 0;
  for (const p of Object.values(e.parts)) { hp += Math.max(0, p.hp); max += p.max; }
  A.pain = (A.pain ?? 0) * Math.exp(-dt / 2.5) + Math.max(0, (A.hpPrev ?? hp) - hp);
  A.hpPrev = hp; A.painK = A.pain / (max || 1);
}
// 換血虧了（最近 2.5 秒吃掉全身 10% 以上、軀幹不到 75%）/ 軀幹不到 40% 還在挨打 → 找 9 格內看不到目標、威脅低的點躲 2～3.5 秒，
//   之後冷卻 3 秒才會再躲（不會一直縮著）
function updateCover(e, dt, tgt, los) {
  const A = e.ai, T = e.parts.torso, hpK = T.hp / T.max;
  A.coverCd = (A.coverCd ?? 0) - dt;
  if (A.cover) { if ((A.cover.t -= dt) <= 0 || !tgt.alive) { A.cover = null; A.coverCd = 3; } return; }
  if (!tgt.alive || !los || A.coverCd > 0) return;
  if (!(A.painK > 0.1 && hpK < 0.75 || hpK < 0.4 && A.painK > 0.03)) return;
  const s = pickSpot(e, tgt, true, A.want + 8), sx = s.x - e.x, sz = s.z - e.z, sd = Math.hypot(sx, sz);
  const dx = tgt.x - s.x, dz = tgt.z - s.z, d = Math.hypot(dx, dz) || 1;
  if (sd > 9 || sd < 1 || rayBlock(s.x, s.z, dx / d, dz / d, d) >= d - 1) { A.coverCd = 1; return; }   // 附近沒掩體：照打
  A.cover = { x: s.x, z: s.z, t: hpK < 0.4 ? 3.5 : 2.2 };
  if (sd > 4) { A.urgent = true; A.reposition = 0; }   // 掩體有點遠：推進過去
}

// ---------- 感知（AI_TUNE.memory）、迫擊砲觀測（AI_TUNE.spotter） ----------
// 記憶：小隊共享（遠征的 e.squad），沒有小隊的照隊伍共享；{ 目標 id: { x, z, t } }
const TEAM_MEM = {};
const memOf = e => e.squad ? (e.squad.mem ??= {}) : (TEAM_MEM[e.team] ??= {});
const fresh = (r, T = 8) => r && r.t <= G.now && G.now - r.t < T;   // T 秒內的記憶才算（t > now：上一場模擬留下的）
// 記位置：src 'sight' 親眼看到（精確）/ 'sound' 聽到開火（大概：偏 2 + 距離 × 0.1 格）
function remember(e, tgt, src = 'sight', dist = 0) {
  let x = tgt.x, z = tgt.z;
  if (src === 'sound') { const a = Math.random() * 6.283, d = (2 + dist * 0.1) * Math.sqrt(Math.random()); x += Math.cos(a) * d; z += Math.sin(a) * d; }
  const M = memOf(e), old = M[tgt.id];
  if (src === 'sound' && old?.src === 'sight' && fresh(old, 1)) return old;   // 剛親眼看過就不用聽的蓋掉
  if (src === 'sound' && old?.src === 'sound' && fresh(old, 0.5)) return old;   // 聲音 0.5 秒內只更新一次（不然連射時每幀重抽位置，路線每幀重算、移動會抖）
  M[tgt.id] = { x, z, t: G.now, src };
  e.ai.search = null;
  return M[tgt.id];
}
// 看不到時要去哪（K）：24 格內剛開火（聽得到）→ 大概的位置；記憶 → 最後的位置，到了在附近 6 格搜索 5 秒
//   搜索完 / 記憶過期：有小隊據點（遠征）→ 回據點（之後交給 main.js 的跟丟判定）；沒有（觀戰 / 模擬）→ 慢慢往真實位置掃，上半身朝移動方向（不隔牆盯著目標轉）
//   free：上半身朝移動方向，不預瞄
function recall(e, tgt, dist, dt) {
  if (tgt.firedT != null && G.now - tgt.firedT < 0.25 && G.now >= tgt.firedT && dist < 24) { const r = remember(e, tgt, 'sound', dist); return { x: r.x, z: r.z }; }
  const A = e.ai, r = memOf(e)[tgt.id];
  if (fresh(r) && !(A.search?.r === r && A.search.t <= 0)) {
    if (!A.search && Math.hypot(r.x - e.x, r.z - e.z) > 2.5) return { x: r.x, z: r.z };
    if (!A.search || A.search.r !== r) A.search = { r, t: 5, nt: 0, x: r.x, z: r.z };
    const S = A.search;
    if ((S.t -= dt) > 0) {
      if ((S.nt -= dt) <= 0 || Math.hypot(S.x - e.x, S.z - e.z) < 1.5) { S.nt = 1.2; const a = Math.random() * 6.283, d = 2 + Math.random() * 4; S.x = r.x + Math.cos(a) * d; S.z = r.z + Math.sin(a) * d; }
      return { x: S.x, z: S.z, slow: true };
    }
  }
  const Q = e.squad;
  if (Q?.hunt && tgt.isPlayer) return { x: tgt.x, z: tgt.z };   // 遠征的增援：被叫來的，知道大概在哪 → 直接找過去
  if (Q && Q.x != null && tgt.isPlayer) return { x: Q.x, z: Q.z, slow: true, free: true };
  return { x: tgt.x, z: tgt.z, slow: true, free: true };
}
// 迫擊砲這一發打哪：
//   觀測者 = 同小隊（沒有小隊：同隊伍）或離迫擊砲 18 格內的友軍，親眼看得到目標 → 照實際位置；第一發偏 3.5 格，同一個觀測者、目標沒跑出上一發基準點 4 格 → 每發 ×0.55
//   沒有觀測者 → 4 秒內「親眼看到」的記憶（偏 4.5 格）；聽到的不算；都沒有就不打
function mortarPoint(e, tgt) {
  let sp = null;
  for (const o of mechs) {
    if (!o.alive || o.drop || o.dormant || o.team !== e.team) continue;
    const mate = e.squad ? o.squad === e.squad : true;
    if (!mate && Math.hypot(o.x - e.x, o.z - e.z) > 18) continue;
    if (Math.hypot(o.x - tgt.x, o.z - tgt.z) < 30 && sees(o, tgt)) { sp = o; break; }
  }
  let bx = tgt.x, bz = tgt.z, err = 3.5;
  const A = e.ai, J = A.adj;
  if (!sp) { const r = memOf(e)[tgt.id]; if (!AI_TUNE.memory || !fresh(r, 4) || r.src !== 'sight') return null; bx = r.x; bz = r.z; err = 4.5; }
  else if (J && J.tid === tgt.id && J.sp === sp && Math.hypot(J.x - bx, J.z - bz) < 4) err = Math.max(0.4, J.err * 0.55);
  A.adj = { tid: tgt.id, sp, err, x: bx, z: bz };
  const a = Math.random() * 6.283, d = err * Math.sqrt(Math.random());
  return { x: bx + Math.cos(a) * d, z: bz + Math.sin(a) * d };
}
export function clearMemory() { for (const k in TEAM_MEM) delete TEAM_MEM[k]; }
// ---------- 戰場意識（新數值的王牌，AI_TUNE.ace）----------
// 每 0.25 秒更新 e.ai.tac：
//   foes：已知的敵人（看得到 = 實際位置；看不到 = 記憶裡的位置往自己這邊推估：敵人會照路線靠過來，推估 4 格/秒、最多 10 格），
//         每台的射程（reach）、權重（王牌 2.5、雜魚 1）、近戰與否、可信度（看得到 1，記憶越久越低）
//   spread：已知敵人（24 格內）圍在自己周圍的角度（最大空隙以外的部分）；超過 120° = 要被包圍了
//   retreat：要撤去哪（往空隙的方向 10 格、走得通、威脅最低的那點）；被包圍或站的地方被三台以上看到才有
//   emerge：看不到敵人時，推估離自己最近的那台會從哪裡冒出來（照路線從它往自己走，第一個看得到自己的點）→ 預瞄那裡
// 畫面上的戰場意識圖（tacview.js）讀這些
const TAC_DT = 0.25;
function foeInfo(o) {
  let reach = 0;
  for (const g of Object.values(o.guns ?? {})) if (g.def.kind !== 'shield' && g.def.kind !== 'module') reach = Math.max(reach, Math.min(30, reachOf(g.def)));
  const melee = (o.ai?.want ?? 8) < 6 || o.swarm || o.charger || o.bomber || !!o.preset?.melee;
  return { reach: melee ? Math.max(reach, 3) : reach || 10, w: o.grunt ? 1 : 2.5, melee };
}
function aceAware(e, dt) {
  const A = e.ai;
  if ((A.tacT = (A.tacT ?? 0) - dt) > 0 && A.tac) return;
  A.tacT = TAC_DT;
  const mem = AI_TUNE.memory ? memOf(e) : null, foes = [];
  for (const o of hostilesOf(e)) {
    const d = Math.hypot(o.x - e.x, o.z - e.z);
    if (d > 45) continue;
    const vis = sees(e, o) || !mem;
    let x = o.x, z = o.z, conf = 1;
    if (!vis) {
      const r = mem[o.id];
      if (!r || r.t > G.now || G.now - r.t > 10) continue;   // 不知道在哪：不算
      const age = G.now - r.t, rx = e.x - r.x, rz = e.z - r.z, rl = Math.hypot(rx, rz) || 1, step = Math.min(10, age * 4, Math.max(0, rl - 3));
      x = r.x + rx / rl * step; z = r.z + rz / rl * step; conf = Math.max(0.3, 1 - age / 10);
    }
    foes.push({ m: o, x, z, vis, conf, ...foeInfo(o) });
  }
  // 包圍：24 格內已知敵人的角度，最大空隙以外就是被圍住的角度
  const near = foes.filter(f => Math.hypot(f.x - e.x, f.z - e.z) < 24);
  let spread = 0, gapDir = null;
  if (near.length >= 2) {
    const ang = near.map(f => Math.atan2(f.x - e.x, f.z - e.z)).sort((a, b) => a - b);
    let gap = -1, at = 0;
    for (let i = 0; i < ang.length; i++) { const a0 = ang[i], a1 = i + 1 < ang.length ? ang[i + 1] : ang[0] + Math.PI * 2, g = a1 - a0; if (g > gap) { gap = g; at = a0 + g / 2; } }
    spread = Math.PI * 2 - gap; gapDir = at;
  }
  const hereT = threatAt(foes, e.x, e.z, null);
  let retreat = null;
  if (gapDir != null && spread > 2.1 || hereT >= 3) {
    // 往空隙（沒有空隙就往威脅最低的方向）找 10 格外走得通、威脅最低的點
    let cx = 0, cz = 0;
    for (const f of foes) { cx += f.x - e.x; cz += f.z - e.z; }
    const base = gapDir ?? Math.atan2(-cx, -cz);   // 沒有空隙可算（只有一台）：背對敵人的重心
    let best = null, bs = Infinity;
    for (const da of [0, 0.4, -0.4, 0.8, -0.8, 1.2, -1.2, 1.6, -1.6, 2.0, -2.0, 2.6, -2.6]) {   // 空隙那邊走不通就往旁邊找（路口、巷子）
      const a = base + da, ux = Math.sin(a), uz = Math.cos(a), len = Math.min(10, clearAhead(e, ux, uz, 10));
      if (len < 3) continue;
      const x = e.x + ux * len, z = e.z + uz * len, s = threatAt(foes, x, z, null) * 3 + Math.abs(da) * 2 - len * 0.2;
      if (s < bs) { bs = s; best = { x, z }; }
    }
    retreat = best;
  }
  // 出現點：看不到任何敵人時，最近那台（推估位置）照路線往自己走，第一個看得到自己的點
  let emerge = null;
  if (foes.length && !foes.some(f => f.vis && !f.m.dormant)) {
    const f = foes.reduce((a, b) => Math.hypot(a.x - e.x, a.z - e.z) < Math.hypot(b.x - e.x, b.z - e.z) ? a : b);
    let x = f.x, z = f.z;
    for (let k = 0; k < 30; k++) {
      const dx = e.x - x, dz = e.z - z, dd = Math.hypot(dx, dz);
      if (dd < 2) break;
      if (rayBlock(e.x, e.z, -dx / dd, -dz / dd, dd) >= dd - 0.5) { emerge = { x, z }; break; }
      const dir = routeDir(`a${e.id}`, G.now, x, z, e.x, e.z);
      if (!dir) break;
      x += dir.x; z += dir.z;
    }
  }
  // 近戰威脅：看得到、12 格內最近的近戰型（衝過來的速度）→ 反近戰打法用
  let mel = null;
  for (const f of foes) {
    if (!f.melee || !f.vis) continue;
    const dx = e.x - f.m.x, dz = e.z - f.m.z, d = Math.hypot(dx, dz) || 1, closing = (f.m.vx * dx + f.m.vz * dz) / d;
    if (d < 12 && (!mel || d < mel.d)) mel = { m: f.m, d, closing, ux: dx / d, uz: dz / d };
  }
  A.tac = { foes, spread, gapDir, n: near.length, retreat, emerge, here: hereT, mel };
}
// 某一點的威脅：已知敵人射程內（+1）而且看得到那點 → 權重 × 可信度；近戰型 7 格內再加（貼上來就危險）；except = 不算這台（現在的目標另外處理）
export function threatAt(foes, x, z, except) {
  let t = 0;
  for (const f of foes) {
    if (f.m === except) continue;
    const dx = x - f.x, dz = z - f.z, d = Math.hypot(dx, dz) || 1;
    if (f.melee && d < 7) t += f.w * f.conf * (7 - d) / 3;
    if (d < f.reach + 1 && rayBlock(f.x, f.z, dx / d, dz / d, d) >= d - 1) t += f.w * f.conf;
  }
  return t;
}
// 目標以外、26 格內看得到自己的敵人數
function exposure(e, tgt) { let n = 0; for (const o of hostilesOf(e)) if (o !== tgt && Math.hypot(o.x - e.x, o.z - e.z) < 26 && sees(o, e)) n++; return n; }
// 被包夾：7.5 格內的敵人（近戰型算兩台）≥ 2 → 回傳往外退的方向（離他們的重心）和台數
function kiteFrom(e) {
  let n = 0, cx = 0, cz = 0;
  for (const o of hostilesOf(e)) {
    const d = Math.hypot(o.x - e.x, o.z - e.z);
    if (d > 7.5) continue;
    const w = (o.ai?.want ?? 8) < 6 || o.swarm || o.charger || o.bomber || o.preset?.melee ? 2 : 1;
    n += w; cx += o.x * w; cz += o.z * w;
  }
  if (n < 2) return null;
  const ax = e.x - cx / n, az = e.z - cz / n, l = Math.hypot(ax, az) || 1;
  return { x: ax / l, z: az / l, n };
}
// 主要武器的實際子彈速度（預判用）：架著的那把實彈 / 光束；沒有就當 36
function shotSpeedOf(e) {
  for (const side of ['R', 'L']) {
    const g = e.guns[activeSlot(e, side)];
    if (g && (g.def.kind === 'bullet' || g.def.kind === 'beam')) return g.def.speed * (e.isPlayer ? 1 : g.def === WEAPONS.sniper ? SHOT_TUNE.sniper : SHOT_TUNE.enemy);
  }
  return 36;
}

// ---------- 射擊位置 ----------
// 在玩家周圍偏好距離附近抽 12 個點打分：從那裡看得到玩家（最重要）、離其他同伴（和它們的射擊位置）遠、離自己現在的位置近、
//   會飛的停在空洞上加分（地面機體過不去）；站不住的點不要
function pickSpot(e, tgt, tac = false, indReach = 0) {   // indReach：間接射擊（迫擊砲）的射程 → 反過來找看不到目標的點
  const base = Math.atan2(e.x - tgt.x, e.z - tgt.z), want = e.ai.want;
  const foes = tac ? hostilesOf(e).filter(o => o !== tgt && Math.hypot(o.x - e.x, o.z - e.z) < 32) : null;
  let best = null, bs = -1e9;
  for (let i = 0; i < (tac ? 22 : 12); i++) {
    // 新戰術：前 12 個照舊（目標周圍、理想距離的圈上），後 10 個在自己附近 6 格內找掩體
    let x, z;
    if (i < 12) { const a = base + (Math.random() - 0.5) * 2.4, r = want * (0.75 + Math.random() * 0.45); x = tgt.x + Math.sin(a) * r; z = tgt.z + Math.cos(a) * r; }
    else { const a = Math.random() * Math.PI * 2, r = 1.5 + Math.random() * 4.5; x = e.x + Math.sin(a) * r; z = e.z + Math.cos(a) * r; }
    if (e.fly ? isBlock(x, z) : (isSolid(x, z) || isSolid(x + 0.9, z) || isSolid(x - 0.9, z) || isSolid(x, z + 0.9) || isSolid(x, z - 0.9))) continue;
    const dx = tgt.x - x, dz = tgt.z - z, d = Math.hypot(dx, dz) || 1;
    const see = rayBlock(x, z, dx / d, dz / d, d) >= d - 1;
    let sep = 8;
    for (const o of enemies) {
      if (o === e || !o.alive || o.dormant) continue;
      sep = Math.min(sep, Math.hypot(o.x - x, o.z - z));
      if (o.ai?.spot) sep = Math.min(sep, Math.hypot(o.ai.spot.x - x, o.ai.spot.z - z));
    }
    let score = (indReach ? (see ? -6 : 8) - (d < 6 || d > indReach - 1 ? 30 : 0) : see ? 10 : -20) + sep * 1.3 - Math.hypot(x - e.x, z - e.z) * 0.3 + (e.fly && tileAt(tileC(x), tileR(z)) === 'v' ? 6 : 0);
    // 新戰術：別的敵人看得到這個點就扣分（一次只跟一台交火）、離任何敵人太近扣更多
    if (foes) {
      // 新戰術：照威脅（已知 / 推估的敵人射程內、看得到這點）扣分，離任何敵人太近扣更多；四周開口越少（轉角、背後有牆）越好
      const kf = AI_TUNE.aware ? e.ai.tac?.foes : null;
      if (kf) score -= threatAt(kf, x, z, tgt) * 7;
      else for (const o of foes) {
        const ox = x - o.x, oz = z - o.z, od = Math.hypot(ox, oz) || 1;
        if (od < 26 && rayBlock(o.x, o.z, ox / od, oz / od, od) >= od - 1) score -= 7;
      }
      for (const o of foes) if (Math.hypot(x - o.x, z - o.z) < 6) score -= 12;
      let open = 0;
      for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; if (rayBlock(x, z, Math.sin(a), Math.cos(a), 6) >= 6) open++; }
      score -= open * 0.8;
    }
    if (foes) { const td = Math.hypot(tgt.x - x, tgt.z - z); if (td > want + 4) score -= (td - want - 4) * 1.5; }   // 離目標太遠（打不到）扣分
    if (score > bs) { bs = score; best = { x, z }; }
  }
  return best ?? { x: e.x, z: e.z };
}

// ---------- 自爆機 ----------
// 4 格內看得到玩家 → 點火：0.7 秒閃紅光、嗶嗶叫（越來越快），然後自爆（敵我都炸，連鎖引爆其他自爆機）
function updateBomber(e, dt, player, dist, los) {
  const B = e.bomber;
  if (B.fuse < 0) {
    if (player.alive && los && dist < 4) { B.fuse = 0.7; B.beep = 0; sfx.lock(); }
    return false;
  }
  B.fuse -= dt;
  e.drive = { mx: 0, mz: 0 };
  if ((B.beep -= dt) <= 0) { B.beep = 0.12; sfx.lock(); sparks(e.x, 1.2, e.z, 0xff3020, 4, 0, 0, 0.6); }
  e.parts.torso.flash = 0.06;
  e.model.root.scale.setScalar(e.k * (1 + 0.12 * Math.sin(G.now * 40)));
  if (B.fuse <= 0) { B.done = true; bomberBlast(e, 1); damagePart(e, 'torso', 1e6); }
  e.laser.g.visible = false;
  return true;
}
function bomberBlast(e, k) {
  const R = 4.5 * (0.7 + 0.3 * k), x = e.x, z = e.z;
  explosion(x, 1, z, 1.3 * k);
  sfx.explode(); addTrauma(0.5 * k);
  blastBuildings(x, 0.6, z, 90 * k, 2.4);
  for (const m of mechs.slice()) {
    if (m === e || !m.alive) continue;
    const dx = m.x - x, dz = m.z - z, d = Math.hypot(dx, dz);
    if (d > R + m.r) continue;
    const dmg = 95 * k * (1 - 0.6 * Math.max(0, d - m.r) / R) * (m.team === e.team ? 1 : e.dmgMul ?? 1);
    att(e, 'bomb', () => hitMech(m, dmg, dx / (d || 1), dz / (d || 1), 7, 'chemical', 'torso', dmg, true));
  }
}

// ---------- 衝鋒機 ----------
// idle：照一般方式靠近；冷卻好了、看得到、4～17 格 → wind：停下來對準、地上亮紅色衝刺線 0.85 秒 →
// go：沿直線用 24 的速度衝（最多 18 格）。撞到玩家：重傷 + 擊退 + 失衡；被牆擋下：暈 1.6 秒；前面是空洞：直接摔下去死掉
const CHARGE_V = 24;
function updateCharger(e, dt, player, dist, nx, nz, los) {
  const C = e.charger;
  C.cd -= dt;
  if (C.state === 'idle') {
    if (C.cd <= 0 && e.staggerT <= 0 && los && dist > 4 && dist < 17 && player.alive && !AI.passive) {
      C.state = 'wind'; C.t = 0.85; C.dx = nx; C.dz = nz; C.len = Math.min(18, dist + 5);
      showTele(e, C);
      sfx.deploy();
    }
    return false;
  }
  if (C.state === 'wind') {
    C.t -= dt;
    e.drive = { mx: 0, mz: 0 };
    e.aimYaw = Math.atan2(C.dx, C.dz);
    e.legYaw = e.aimYaw;
    if (e.tele) e.tele.material.opacity = 0.35 + 0.35 * Math.abs(Math.sin(G.now * 18));
    if (C.t <= 0) {
      C.state = 'go'; C.t = C.len / CHARGE_V;
      e.vx = C.dx * CHARGE_V; e.vz = C.dz * CHARGE_V;
      e.boostT = C.t; e.boostDir = { x: C.dx, z: C.dz }; e.boostK = 0.3;
      clearTele(e); sfx.boost();
    }
    return true;
  }
  // go
  C.t -= dt;
  e.drive = { mx: C.dx, mz: C.dz };
  e.aimYaw = Math.atan2(C.dx, C.dz);
  const end = cd => { C.state = 'idle'; C.cd = cd; e.boostT = 0; };
  // 前面是空洞：摔下去
  const ax = e.x + C.dx * (e.r + 0.5), az = e.z + C.dz * (e.r + 0.5);
  if (tileAt(tileC(ax), tileR(az)) === 'v') { startFall(e, C.dx, C.dz); return true; }
  if (player.alive && Math.hypot(player.x - e.x, player.z - e.z) < e.r + player.r + 0.4) {
    const dmg = 70 * (e.dmgMul ?? 1);
    att(e, 'ram', () => hitMech(player, dmg, C.dx, C.dz, 14, 'kinetic', 'torso', 70));
    stagger(player, 999, C.dx, C.dz);
    sfx.crash(); addTrauma(0.6);
    e.vx *= 0.2; e.vz *= 0.2;
    end(4);
    return true;
  }
  if (e.boostT <= 0 || C.t <= 0 || Math.hypot(e.vx, e.vz) < CHARGE_V * 0.4) {
    if (C.t > 0.08) { e.staggerT = e.staggerMax = 1.6; e.stagDir = { x: -C.dx, z: -C.dz }; sfx.crash(); }   // 撞牆：暈
    end(3.5);
  }
  return true;
}
function showTele(e, C) {
  clearTele(e);
  if (HEADLESS) { e.tele = VOID; return; }
  const m = new THREE.Mesh(UNIT_BOX, addMat(0xff3020, 0.5));
  m.scale.set(1.3, 0.04, C.len);
  m.position.set(e.x + C.dx * C.len / 2, 0.05, e.z + C.dz * C.len / 2);
  m.rotation.y = Math.atan2(C.dx, C.dz);
  scene.add(m);
  e.tele = m;
}
function clearTele(e) { if (e.tele) { scene.remove(e.tele); e.tele.material.dispose(); e.tele = null; } }
// 摔進空洞：算擊破（掉落物、小隊進度照算），模型往前翻滾掉下去，1.2 秒後收掉
function startFall(e, dx, dz) {
  e.alive = false;
  e.fall = { t: 0, vx: dx * 10, vz: dz * 10 };
  e.laser.g.visible = false;
  clearTele(e);
  sfx.crash();
  AI.onEnemyDeath?.(e);
}
function updateFall(e, dt) {
  const F = e.fall;
  F.t += dt;
  e.x += F.vx * dt; e.z += F.vz * dt;
  F.vx *= Math.exp(-2 * dt); F.vz *= Math.exp(-2 * dt);
  e.model.root.position.set(e.x, -F.t * F.t * 14, e.z);
  e.model.root.rotation.x += dt * 4;
  if (F.t > 1.2) { e.fall = null; removeEnemy(e); }
}

// ---------- 蟲群 ----------
// 機體模型藏起來，改畫 n 隻在地上爬的小機械蟲（扁平深色方塊 + 紅眼），在中心附近亂竄；剩幾隻照剩多少血
const DRONE_GEO = HEADLESS ? null : new THREE.BoxGeometry(0.24, 0.09, 0.32), EYE_GEO = HEADLESS ? null : new THREE.BoxGeometry(0.12, 0.05, 0.05);
const DRONE_MAT = HEADLESS ? null : new THREE.MeshLambertMaterial({ color: 0x2c2d34 }), EYE_MAT = HEADLESS ? null : addMat(0xff3020, 0.95);
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(), tmpP = new THREE.Vector3(), ONE = new THREE.Vector3(1, 1, 1), ZERO = new THREE.Vector3(0, 0, 0);
const EYE_OFF = new THREE.Matrix4().makeTranslation(0, 0.03, 0.16);   // 紅眼：蟲的頭
function setupSwarm(e, n) {
  for (const k in e.parts) e.parts[k].g.visible = false;
  e.spec.legs = { ...e.spec.legs, stagger: Infinity };
  e.r = 1.15;
  // 無頭：沒有蟲的網格（body / eye = VOID），每隻的位置照算（最後碎掉的地方）
  const body = HEADLESS ? VOID : new THREE.InstancedMesh(DRONE_GEO, DRONE_MAT, n), eye = HEADLESS ? VOID : new THREE.InstancedMesh(EYE_GEO, EYE_MAT, n);
  if (!HEADLESS) {
    body.frustumCulled = eye.frustumCulled = false;
    body.castShadow = true;
    e.model.root.add(body, eye);
  }
  e.swarm = { n, per: e.parts.torso.max / n, body, eye, ph: Array.from({ length: n }, () => [Math.random() * 6.28, 0.35 + Math.random() * 1.1, 0, 1 + Math.random() * 1.5]),
    live: n, wx: new Float32Array(n).fill(e.x), wz: new Float32Array(n).fill(e.z), yaw: new Float32Array(n), init: false };
}
const BUG_BITS = [0x2c2d34, 0x1c1d22, 0xff3020];
// 頭朝實際跑的方向：整群在移動時，整群的速度佔比較重 → 大家頭朝同一邊；停下來時才各自亂竄
const SWARM_VW = 1.6, BUG_TURN = 10;
function updateSwarmFx(e, dt) {
  if (HEADLESS) return;
  const S = e.swarm, t = G.now, live = Math.max(1, Math.ceil(e.parts.torso.hp / e.parts.torso.max * S.n));
  // 被打掉的那幾隻：在牠最後的位置各自碎掉
  for (let i = live; i < S.live; i++) shatterSmall(S.wx[i], 0.1, S.wz[i], BUG_BITS);
  S.live = Math.min(S.live, live);
  const ev = Math.hypot(e.vx, e.vz);
  for (let i = 0; i < S.n; i++) {
    // 在地上亂竄：各自在中心附近繞來繞去，身體貼地微微顛
    const [ph, rad, , sp] = S.ph[i], a = ph + Math.sin(t * 0.9 * sp + ph * 3) * 1.3, r = rad * (0.75 + 0.35 * Math.sin(t * 1.4 * sp + ph));
    const lx = Math.cos(a) * r, lz = Math.sin(a) * r, wx = e.x + lx, wz = e.z + lz;
    if (S.init && dt > 0) {
      // 實際移動的速度（自己亂竄 + 整群的移動，整群在走時加重）→ 頭轉過去
      const vx = (wx - S.wx[i]) / dt + e.vx * (SWARM_VW - 1), vz = (wz - S.wz[i]) / dt + e.vz * (SWARM_VW - 1);
      if (Math.hypot(vx, vz) > 0.3 + (ev > 1 ? 0 : 0.5)) S.yaw[i] = approachYaw(S.yaw[i], Math.atan2(vx, vz), BUG_TURN * dt);
    } else S.yaw[i] = Math.atan2(lx, lz);
    S.wx[i] = wx; S.wz[i] = wz;
    tmpP.set(lx, 0.05 + Math.abs(Math.sin(t * 22 + ph * 5)) * 0.025, lz);
    tmpQ.setFromEuler(tmpE.set(0, S.yaw[i], 0));
    tmpM.compose(tmpP, tmpQ, i < live ? ONE : ZERO);   // 打掉的那幾隻縮成 0
    S.body.setMatrixAt(i, tmpM);
    S.eye.setMatrixAt(i, tmpM.multiply(EYE_OFF));
  }
  S.init = true;
  S.body.instanceMatrix.needsUpdate = true; S.eye.instanceMatrix.needsUpdate = true;
}
function approachYaw(a, b, step) {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + Math.sign(d) * Math.min(Math.abs(d), step);
}

// ---------- 旋停機：四旋翼無人機 ----------
// 機體模型藏起來，在上半身那裡換成：扁平機身 + 四支斜臂 + 四個旋翼（半透明圓盤，一直轉）；武器掛在機身下面（槍口也移到那裡）
const QUAD_BODY = HEADLESS ? null : new THREE.BoxGeometry(0.72, 0.2, 0.8), QUAD_ARM = HEADLESS ? null : new THREE.BoxGeometry(0.1, 0.08, 0.95), QUAD_HUB = HEADLESS ? null : new THREE.BoxGeometry(0.16, 0.14, 0.16);
const QUAD_ROTOR = HEADLESS ? null : new THREE.CylinderGeometry(0.36, 0.36, 0.02, 18), QUAD_GUN = HEADLESS ? null : new THREE.BoxGeometry(0.1, 0.1, 0.55), QUAD_POD = HEADLESS ? null : new THREE.BoxGeometry(0.22, 0.16, 0.36);
// 槍口換到機身下面（遊戲規則：無頭也要）
const quadMuzzles = () => ({ armR: [-0.17, -0.03, 0.5], backL: [0.17, -0.02, 0.27] });
function setupQuad(e) {
  const M = e.model;
  for (const k in e.parts) e.parts[k].g.visible = false;
  if (HEADLESS) { Object.assign(M.muzzles, quadMuzzles()); e.quad = { g: VOID, rotors: [] }; return; }
  const dark = new THREE.MeshLambertMaterial({ color: 0x3a3d45 }), acc = new THREE.MeshLambertMaterial({ color: e.colors.accent }), metal = new THREE.MeshLambertMaterial({ color: 0x8a8e98 });
  const q = new THREE.Group();
  const body = new THREE.Mesh(QUAD_BODY, dark); q.add(body);
  const stripe = new THREE.Mesh(QUAD_BODY, acc); stripe.scale.set(0.5, 0.3, 1.02); stripe.position.y = 0.09; q.add(stripe);
  const eye = new THREE.Mesh(EYE_GEO, EYE_MAT); eye.scale.set(1.6, 1.4, 1); eye.position.set(0, 0.02, 0.42); q.add(eye);
  const rotors = [];
  for (const [sx, sz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
    const arm = new THREE.Mesh(QUAD_ARM, dark); arm.position.set(sx * 0.33, 0.04, sz * 0.33); arm.rotation.y = Math.atan2(sx, sz); q.add(arm);
    const hub = new THREE.Mesh(QUAD_HUB, metal); hub.position.set(sx * 0.62, 0.1, sz * 0.62); q.add(hub);
    const rot = new THREE.Mesh(QUAD_ROTOR, addMat(0xd0d6e0, 0.28)); rot.position.set(sx * 0.62, 0.19, sz * 0.62); q.add(rot);
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.015, 0.06), metal); rot.add(blade);
    rotors.push(rot);
  }
  // 武器掛在下面：右手機槍（右邊 = 本地 -x）、左背飛彈莢艙
  const gun = new THREE.Mesh(QUAD_GUN, metal); gun.position.set(-0.17, -0.18, 0.22); q.add(gun);
  const pod = new THREE.Mesh(QUAD_POD, dark); pod.position.set(0.17, -0.17, 0.08); q.add(pod);
  q.traverse(o => { if (o.isMesh && o.material.type === 'MeshLambertMaterial') o.castShadow = true; });
  q.position.y = 0.15;
  M.torsoG.add(q);
  Object.assign(M.muzzles, quadMuzzles());
  e.quad = { g: q, rotors };
}
