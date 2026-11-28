import * as THREE from 'three';
import { sampleVoxels } from './voxel.js';
import { DEBRIS_GEO, FLASH_GEO, G, GFX, HEADLESS, UNIT_BOX, VOID, WALL_H, addMat, camera, debrisMat, scene } from './core.js';
// 這個檔案全部是畫面：無頭模式（core.js HEADLESS）下每個效果都直接回來、不建任何東西（色帶 RAMP / rampOf 是資料，照常）
import { fogMaterial, fogU } from './fog.js';
import { clearLights, flashLight, updateLights } from './lights.js';

// 粒子撞牆判定由場地模組注入（pitTest：那裡是空洞 → 碎片掉下去）
let wallTest = () => false, pitTest = () => false;
export function setWallTest(fn, pit = null) { wallTest = fn; if (pit) pitTest = pit; }

// ---------- 留在地上的碎片 ----------
// 噴出去的碎片（建築被打掉的方塊、機體炸開的碎塊）落地停住之後，「壓」進一個共用的 InstancedMesh（一整批只畫一次），一直留著
// 每層一個（掛在那層的 group 底下、用那層的迷霧）；最多 RUBBLE_MAX 塊，超過就蓋掉最舊的；換關 / 換模式時清掉
const RUBBLE_MAX = 20000;
const RUBBLE_DIM = 0.55;   // 留在地上的碎片暗多少（1 = 跟飛的時候一樣亮）
const SOOT_MAX = 12000, SOOT_A = 0.38;   // 燻黑薄片最多幾片、每片多黑
const rubblePools = new Map();
let rubble = null;
const rM = new THREE.Matrix4(), rQ = new THREE.Quaternion(), rS = new THREE.Vector3(), rC = new THREE.Color();
// 換到第 k 層的碎片（parent = 那層的 group、U = 那層的迷霧 uniforms）
export function setRubbleLayer(k, parent = scene, U = fogU) {
  if (HEADLESS) return;
  if (!rubblePools.has(k)) {
    const mesh = new THREE.InstancedMesh(DEBRIS_GEO, fogMaterial(new THREE.MeshLambertMaterial({ color: 0xffffff }), U), RUBBLE_MAX);
    mesh.count = 0; mesh.frustumCulled = false; mesh.receiveShadow = true;
    mesh.setColorAt(0, rC.set(0xffffff));
    parent.add(mesh);
    // 燻黑層：半透明的黑色薄片（地面焦痕、牆上彈痕），疊越多片越黑 = 把底下的東西「壓暗」，不管底下原本什麼顏色
    const soot = new THREE.InstancedMesh(DEBRIS_GEO, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: SOOT_A, depthWrite: false }), SOOT_MAX);
    soot.count = 0; soot.frustumCulled = false; soot.renderOrder = 1;
    soot.setColorAt(0, rC.set(0));
    parent.add(soot);
    rubblePools.set(k, { mesh, next: 0, soot, sNext: 0 });
  }
  rubble = rubblePools.get(k);
  // 還在飛的碎片是上一層的：直接收掉
  for (const d of debris) scene.remove(d.m);
  debris.length = 0;
  clearMenders();
}
export function clearRubble() {
  if (HEADLESS) return;
  for (const P of rubblePools.values()) for (const o of [P.mesh, P.soot]) { o.parent?.remove(o); o.dispose(); o.material.dispose(); }
  rubblePools.clear(); rubble = null;
  clearLights();
  for (const d of debris) scene.remove(d.m);
  debris.length = 0;
  clearMenders();
}
function bake(d) {
  if (!rubble) setRubbleLayer(0);
  const R = rubble, i = R.next;
  rQ.setFromEuler(d.m.rotation);
  rM.compose(d.m.position, rQ, rS.setScalar(d.s));
  R.mesh.setMatrixAt(i, rM);
  R.mesh.setColorAt(i, rC.copy(d.m.material.color).multiplyScalar(RUBBLE_DIM));
  R.next = (i + 1) % RUBBLE_MAX;
  R.mesh.count = Math.max(R.mesh.count, i + 1);
  R.mesh.instanceMatrix.needsUpdate = true; R.mesh.instanceColor.needsUpdate = true;
}

// 燻黑一片：(x, y, z) 中心、(sx, sy, sz) 大小、繞 Y 轉 ry、顏色 c（黑 = 單純壓暗；墨綠 = 酸蝕）
function soot(x, y, z, sx, sy, sz, ry, c) {
  if (!rubble) setRubbleLayer(0);
  const P = rubble, i = P.sNext;
  sP.set(x, y, z);
  rQ.setFromEuler(sE.set(0, ry, 0));
  rM.compose(sP, rQ, rS.set(sx / 0.16, sy / 0.16, sz / 0.16));
  P.soot.setMatrixAt(i, rM);
  P.soot.setColorAt(i, rC.setHex(c));
  P.sNext = (i + 1) % SOOT_MAX;
  P.soot.count = Math.max(P.soot.count, i + 1);
}
function sootDone() { const P = rubble; P.soot.instanceMatrix.needsUpdate = true; P.soot.instanceColor.needsUpdate = true; }

// 地面被炸：一堆半透明黑片疊成一塊焦痕（中間疊得多 = 最黑、外圍淡），一直留著；再噴一點土塊
const SCORCH_C = [0x000000, 0x0a0806];
const sE = new THREE.Euler(), sP = new THREE.Vector3();
// cols：換顏色（酸液 = 墨綠）；dirt = false 不噴土（火海、酸池留下的痕跡）
export function scorch(x, z, r, cols = SCORCH_C, dirt = true) {
  if (HEADLESS) return;
  if (pitTest(x, z) || wallTest(x, z)) return;
  const n = Math.round(10 + r * 16);
  for (let k = 0; k < n; k++) {
    const a = Math.random() * Math.PI * 2, t = Math.sqrt(Math.random()), d = t * r * 0.6;
    const px = x + Math.cos(a) * d, pz = z + Math.sin(a) * d;
    if (wallTest(px, pz) || pitTest(px, pz)) continue;
    const w = (0.18 + Math.random() * 0.25) * (1.3 - t * 0.7) * Math.min(1.4, 0.6 + r * 0.4);
    soot(px, 0.006 + Math.random() * 0.01, pz, w, 0.006, w * (0.7 + Math.random() * 0.3), Math.random() * Math.PI, cols[k % cols.length]);
  }
  sootDone();
  // 土塊：往外噴、落地留著
  if (dirt) for (let k = 0; k < 4 + r * 4; k++) chipDebris(x + R(-0.3, 0.3), 0.12, z + R(-0.3, 0.3), [0x4a4238, 0x3a342c, 0x5a5044][k % 3], 0, 0, 2 + r * 1.6);
}

// 打不壞的牆（岩壁、外圍圍牆）被打中：牆面貼幾片半透明黑片（燻黑的彈痕，中間疊得多最黑），一直留著；再噴幾顆碎石
// f = arena.js wallFace 的結果（牆面位置 + 朝外法線）；size 照威力
export function wallMark(f, y, size, c = 0x5a5248) {
  if (HEADLESS) return;
  const n = 3 + Math.round(size * 10), tx = -f.nz, tz = f.nx;   // 牆面上的水平方向
  for (let k = 0; k < n; k++) {
    const a = Math.random() * Math.PI * 2, t = Math.sqrt(Math.random()) * size * 0.4;
    const u = Math.cos(a) * t, v = Math.sin(a) * t * 0.8;
    const w = (0.08 + Math.random() * 0.08 + size * 0.14) * (1.3 - 0.8 * t / Math.max(0.01, size * 0.4));
    const off = 0.012 + Math.random() * 0.012;
    soot(f.x + tx * u + f.nx * off, Math.max(0.05, y + v), f.z + tz * u + f.nz * off,
      f.nx ? 0.008 : w, w * (0.7 + Math.random() * 0.5), f.nz ? 0.008 : w, 0, k % 3 ? 0x000000 : 0x0c0906);
  }
  sootDone();
  for (let k = 0; k < 1 + size * 5; k++) chipDebris(f.x + f.nx * 0.08, y, f.z + f.nz * 0.08, k % 2 ? c : 0x3e3830, f.nx * 0.8, f.nz * 0.8, 1.6 + size * 2);
}

// ---------- 雷射（瞄準線） ----------
export function makeLaser(color, coreColor = 0xffffff) {   // coreColor：中間那條芯（預設白；玩家的左右瞄準線用淡紅 / 淡綠，顏色才看得出來）
  if (HEADLESS) return { g: VOID, core: VOID, glow: VOID, dot: VOID };
  const g = new THREE.Group();
  const core = new THREE.Mesh(UNIT_BOX, addMat(coreColor));
  const glow = new THREE.Mesh(UNIT_BOX, addMat(color));
  const dot = new THREE.Mesh(FLASH_GEO, glow.material);
  dot.scale.setScalar(0.35);
  g.add(core, glow, dot);
  g.visible = false;
  scene.add(g);
  return { g, core, glow, dot };
}
export function setLaser(L, ox, oz, dx, dz, len, y, alpha, w) {
  if (HEADLESS) return;
  L.g.visible = true;
  L.g.position.set(ox + dx * len / 2, y, oz + dz * len / 2);
  L.g.rotation.set(0, Math.atan2(dx, dz), 0);
  L.core.scale.set(w * 0.35, w * 0.35, len);
  L.glow.scale.set(w, w, len);
  L.dot.position.set(0, 0, len / 2);
  L.core.material.opacity = alpha;
  L.glow.material.opacity = alpha * 0.6;
}

// ---------- 粒子 ----------
export const debris = [], fx = [];
export function burst(x, y, z, colors, n, power, bx = 0, bz = 0) {
  if (HEADLESS) return;
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(DEBRIS_GEO, debrisMat(colors[i % colors.length]));
    const s = 0.7 + Math.random() * 1.3;
    m.scale.setScalar(s);
    m.position.set(x + (Math.random() - 0.5) * 0.4, y + (Math.random() - 0.5) * 0.6, z + (Math.random() - 0.5) * 0.4);
    m.castShadow = true;
    scene.add(m);
    const a = Math.random() * Math.PI * 2, p = power * (0.4 + Math.random() * 0.8);
    debris.push({ m, s, life: 1.6 + Math.random() * 1.2,
      vx: Math.cos(a) * p + bx, vy: 3 + Math.random() * power, vz: Math.sin(a) * p + bz,
      sx: (Math.random() - 0.5) * 20, sz: (Math.random() - 0.5) * 20 });
  }
}
// 小東西碎掉（蟲群的一隻蟲）：幾塊小碎片往外彈 + 一點火花，不爆炸
export function shatterSmall(x, y, z, colors, n = 5, power = 2.2) {
  if (HEADLESS) return;
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(DEBRIS_GEO, debrisMat(colors[i % colors.length]));
    const s = 0.35 + Math.random() * 0.35;
    m.scale.setScalar(s);
    m.position.set(x + (Math.random() - 0.5) * 0.15, y + 0.05, z + (Math.random() - 0.5) * 0.15);
    scene.add(m);
    const a = Math.random() * Math.PI * 2, p = power * (0.4 + Math.random() * 0.8);
    debris.push({ m, s, life: 1 + Math.random() * 0.8,
      vx: Math.cos(a) * p, vy: 2 + Math.random() * power, vz: Math.sin(a) * p,
      sx: (Math.random() - 0.5) * 24, sz: (Math.random() - 0.5) * 24 });
  }
  sparks(x, y + 0.1, z, 0xff5030, 4, 0, 0, 0.5);
}
// 部位被打掉的一顆方塊（mech.js syncChips）：從原位往被打的方向彈開，落地後跟其他碎片一樣留在地上
export function chipDebris(x, y, z, c, dx, dz, power = 2.4) {
  if (HEADLESS) return;
  const m = new THREE.Mesh(DEBRIS_GEO, debrisMat(c));
  const s = 0.38 + Math.random() * 0.22;   // 跟機體上的方塊差不多大（1/16 格 ≈ DEBRIS_GEO × 0.4）
  m.scale.setScalar(s);
  m.position.set(x, y, z);
  scene.add(m);
  const a = Math.random() * Math.PI * 2, p = power * (0.3 + Math.random() * 0.7);
  debris.push({ m, s, life: 1.2 + Math.random() * 0.8,
    vx: dx * p * 1.4 + Math.cos(a) * p * 0.6, vy: 1.5 + Math.random() * power, vz: dz * p * 1.4 + Math.sin(a) * p * 0.6,
    sx: (Math.random() - 0.5) * 26, sz: (Math.random() - 0.5) * 26 });
}
// 零件炸開：直接拿零件身上的方塊往外噴（cx, cz = 爆炸中心）
// opts.char：顏色往焦黑壓多少（0..1）；opts.burn：每塊有多少機率是著火的（飛的時候一路冒火）
const CHAR_C = new THREE.Color(0x16120f), charC = new THREE.Color();
function charred(c, k) {
  charC.set(c).lerp(CHAR_C, k);
  // 量化一下，材質快取不要爆
  const q = v => Math.round(v * 24) / 24;
  return charC.setRGB(q(charC.r), q(charC.g), q(charC.b)).getHex();
}
export function voxelBurst(root, n, power, cx, cz, bx = 0, bz = 0, opts = null) {
  if (HEADLESS) return;
  for (const v of sampleVoxels(root, n)) {
    const burning = opts?.burn && Math.random() < opts.burn;
    const c = opts?.char ? charred(v.c, Math.min(1, opts.char * (0.75 + Math.random() * 0.5) + (burning ? 0.15 : 0))) : v.c;
    const m = new THREE.Mesh(DEBRIS_GEO, debrisMat(c));
    const s = 0.6 + Math.random() * 0.6;
    m.scale.setScalar(s);
    m.position.set(v.x, v.y, v.z);
    m.castShadow = true;
    scene.add(m);
    let ox = v.x - cx, oz = v.z - cz;
    const ol = Math.hypot(ox, oz) || 1;
    ox /= ol; oz /= ol;
    const p = power * (0.4 + Math.random() * 0.8);
    debris.push({ m, s, life: 2 + Math.random() * 1.5 + (burning ? 0.8 : 0),
      vx: ox * p + (Math.random() - 0.5) * 2 + bx, vy: 2 + Math.random() * power * 0.9, vz: oz * p + (Math.random() - 0.5) * 2 + bz,
      sx: (Math.random() - 0.5) * 20, sz: (Math.random() - 0.5) * 20, burn: burning ? 1 : 0, burnAcc: 0 });
  }
}
// ---------- 方塊粒子（全部用方塊：火花、火焰、爆炸、煙） ----------
// 兩個共用的 InstancedMesh：
//   glow：加法混色的發光方塊（火花、火焰、閃光），顏色照「色帶」隨時間變，最後變黑 = 淡出
//   puff：半透明的煙 / 塵方塊，顏色從 c0 漸變到 c1，先變大再縮小
const MAX_GLOW = 5000, MAX_PUFF = 2000;
const glowMesh = HEADLESS ? null : new THREE.InstancedMesh(UNIT_BOX, new THREE.MeshBasicMaterial({
  color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), MAX_GLOW);
const puffMesh = HEADLESS ? null : new THREE.InstancedMesh(UNIT_BOX, new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.72, depthWrite: false }), MAX_PUFF);
if (!HEADLESS) {
  for (const m of [glowMesh, puffMesh]) {
    m.frustumCulled = false; m.count = 0;
    m.setColorAt(0, new THREE.Color());
    scene.add(m);
  }
  puffMesh.renderOrder = 1; glowMesh.renderOrder = 2;
}
const glows = [], puffs = [];

// 色帶：平均分布的顏色，取樣時線性內插
const ramp = hexes => hexes.map(h => new THREE.Color(h));
export const RAMP = {
  spark: ramp([0xffffff, 0xfff0a0, 0xffb030, 0xff5010, 0x000000]),
  armor: ramp([0xffffff, 0xd8e8ff, 0x80a8ff, 0x203060, 0x000000]),
  fire: ramp([0xfff6d0, 0xffd040, 0xff8a20, 0xd83010, 0x501008, 0x000000]),
  ember: ramp([0xffe080, 0xff7020, 0xa02008, 0x000000]),
  flash: ramp([0xffffff, 0xfff0b0, 0xff9030, 0x000000]),
  flashCore: ramp([0xc8bc9c, 0xc8a050, 0xb05818, 0x000000]),   // 爆炸閃光：比白暗一點（疊在火球上才不會整片死白）
  acid: ramp([0xf0ffd0, 0xb8ff58, 0x68c820, 0x205808, 0x000000]),
};
const rampCache = new Map();
export function rampOf(hex) {
  if (!rampCache.has(hex)) {
    const c = new THREE.Color(hex);
    rampCache.set(hex, [new THREE.Color(0xffffff), c, c.clone().multiplyScalar(0.45), new THREE.Color(0)]);
  }
  return rampCache.get(hex);
}
function sampleRamp(r, t, out) {
  const f = Math.min(0.9999, Math.max(0, t)) * (r.length - 1), i = Math.floor(f);
  return out.copy(r[i]).lerp(r[i + 1], f - i);
}
const R = (a, b) => a + Math.random() * (b - a);

// o: x,y,z, vx,vy,vz, life, s0（開始大小）, s1（結束大小）, ramp, g（重力）, drag, bounce, puff（先變大再縮小）, delay
export function spawnGlow(o) {
  if (HEADLESS) return;
  if (glows.length >= MAX_GLOW) return;
  glows.push({ vx: 0, vy: 0, vz: 0, g: 0, drag: 0, s1: 0, delay: 0, ...o, max: o.life, rx: Math.random() * 3, ry: Math.random() * 3, vr: o.vr ?? R(-8, 8) });
}
// o: x,y,z, vx,vy,vz, life, s（最大）, c0, c1, drag, delay, g
export function spawnPuff(o) {
  if (HEADLESS) return;
  if (puffs.length >= MAX_PUFF) return;
  puffs.push({ vx: 0, vy: 0, vz: 0, g: 0, drag: 0.8, delay: 0, ...o, max: o.life,
    col0: new THREE.Color(o.c0 ?? 0x2a2b30), col1: new THREE.Color(o.c1 ?? 0x6a6c72), rx: Math.random() * 3, ry: Math.random() * 3, vr: R(-1.5, 1.5) });
}

// ---------- 效果 ----------
// 一般火花：有重力、會在地上彈
export function sparks(x, y, z, color, n, nx = 0, nz = 0, speed = 1) {
  if (HEADLESS) return;
  const rp = rampOf(color);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, p = R(3, 8) * speed;
    spawnGlow({ x, y, z, vx: Math.cos(a) * p + nx * 5, vy: R(1, 5), vz: Math.sin(a) * p + nz * 5,
      life: R(0.2, 0.45), s0: R(0.06, 0.1), s1: 0.02, ramp: rp, g: 20, drag: 1.5, bounce: true });
  }
}
// 被擊中：一下閃光 + 一束往回彈的火花（nx, nz = 往子彈來的方向）；power 越大越多、越遠；armor = 被裝甲彈開（藍白色）
export function hitSparks(x, y, z, nx, nz, power = 1, armor = false) {
  if (HEADLESS) { G.tap?.('hs', x, y, z, nx, nz, power, armor ? 1 : 0); return; }   // 線上伺服器：記下來送給客戶端畫（online.js）
  const rp = armor ? RAMP.armor : RAMP.spark;
  spawnGlow({ x, y, z, life: 0.07, s0: 0.3 + 0.15 * power, s1: 0.1, ramp: RAMP.flash, vr: 0 });
  const n = Math.round(7 + 6 * power);
  for (let i = 0; i < n; i++) {
    const sp = R(4, 10) * (0.8 + power * 0.3), a = Math.atan2(nx, nz) + R(-1.1, 1.1);
    spawnGlow({ x, y, z, vx: Math.sin(a) * sp, vy: R(0.5, 4.5) * (0.7 + power * 0.3), vz: Math.cos(a) * sp,
      life: R(0.2, 0.5), s0: R(0.06, 0.11), s1: 0.02, ramp: rp, g: 22, drag: 1.8, bounce: true });
  }
  if (power > 0.8) for (let i = 0; i < 2; i++) spawnPuff({ x, y, z, vx: nx * 0.8, vy: R(0.6, 1.2), vz: nz * 0.8, life: R(0.5, 0.8), s: R(0.18, 0.28), c0: 0x4a4c52, c1: 0x7a7c82 });
}
// 火：一顆往上竄的火焰方塊（越往上越小，白黃→橘→紅→暗），偶爾飛出火星、冒一團黑煙；k = 大小
export function fire(x, y, z, k = 1) {
  if (HEADLESS) return;
  spawnGlow({ x: x + R(-0.15, 0.15) * k, y, z: z + R(-0.15, 0.15) * k, vx: R(-0.4, 0.4), vy: R(1.4, 2.6) * (0.6 + 0.4 * k), vz: R(-0.4, 0.4),
    life: R(0.35, 0.6), s0: R(0.16, 0.3) * k, s1: 0, ramp: RAMP.fire, drag: 1 });
  if (Math.random() < 0.15) spawnGlow({ x, y, z, vx: R(-1.5, 1.5), vy: R(2.5, 5), vz: R(-1.5, 1.5), life: R(0.6, 1.1), s0: 0.06, s1: 0.02, ramp: RAMP.ember, g: 4, drag: 0.6 });
  if (Math.random() < 0.25) spawnPuff({ x, y: y + 0.5 * k, z, vx: R(-0.3, 0.3), vy: R(0.9, 1.5), vz: R(-0.3, 0.3), life: R(1.2, 1.9), s: R(0.25, 0.4) * k, c0: 0x18181c, c1: 0x4a4c54 });
}
// 煙
export function smoke(x, y, z, n = 1, size = 1, color) {
  if (HEADLESS) return;
  for (let i = 0; i < n; i++) spawnPuff({ x: x + R(-0.2, 0.2), y, z: z + R(-0.2, 0.2), vx: R(-0.4, 0.4), vy: R(1, 1.8), vz: R(-0.4, 0.4),
    life: R(0.9, 1.5), s: R(0.2, 0.32) * size, c0: color ?? 0x3a3c42, c1: color ?? 0x6a6c72 });
}
// 爆炸：閃光 → 往外炸開的火球方塊（很快被空氣擋下來、慢慢上浮）→ 地面一圈塵 → 火星 → 晚一點冒出的黑煙柱
export function explosion(x, y, z, scale = 1) {
  if (HEADLESS) { G.tap?.('ex', x, y, z, scale); return; }   // 線上伺服器：記下來送給客戶端畫
  flashLight(x, y + 0.4, z, 0xffa050, 70 * scale, 5 + 6 * scale, 0.35 + 0.35 * scale);   // 照亮周圍（src/lights.js）
  // 閃光：不是一顆大白方塊（加法疊上火球會糊成一團白光），而是一顆小一點的核心 + 幾顆往外彈的斜方塊，亮度壓在白以下 → 看得出一顆一顆
  spawnGlow({ x, y, z, life: 0.11, s0: 0.8 * scale, s1: 1.25 * scale, ramp: RAMP.flashCore, vr: 0 });
  for (let i = 0, k = 4 + Math.round(3 * scale); i < k; i++) {
    const a = i / k * Math.PI * 2 + R(-0.4, 0.4), sp = R(5, 9) * scale;
    const r0 = 0.55 * scale;   // 從核心外面一點開始，才不會全部疊在中間
    spawnGlow({ x: x + Math.cos(a) * r0, y: y + R(-0.1, 0.4), z: z + Math.sin(a) * r0, vx: Math.cos(a) * sp, vy: R(0.5, 3), vz: Math.sin(a) * sp, life: R(0.1, 0.17),
      s0: R(0.4, 0.7) * scale, s1: R(0.2, 0.35) * scale, ramp: RAMP.flashCore, drag: 6, vr: R(-6, 6) });
  }
  const n = Math.round(46 * scale);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, el = R(-0.2, 1), sp = R(2.5, 8) * scale;
    spawnGlow({ x: x + R(-0.2, 0.2), y: y + R(-0.2, 0.2), z: z + R(-0.2, 0.2),
      vx: Math.cos(a) * Math.cos(el) * sp, vy: Math.sin(el) * sp * 0.8 + 1, vz: Math.sin(a) * Math.cos(el) * sp,
      life: R(0.45, 0.95), s0: 0, s1: R(0.3, 0.65) * scale, puff: true, ramp: RAMP.fire, drag: 4.5, g: -1.5, delay: R(0.03, 0.07) });   // 閃光先、火球晚一點點才冒（不疊成一團白）
  }
  const ring = Math.round(14 + 12 * scale);
  for (let i = 0; i < ring; i++) {
    const a = i / ring * Math.PI * 2 + R(-0.1, 0.1), sp = R(7, 11) * Math.sqrt(scale);
    spawnPuff({ x, y: 0.15, z, vx: Math.cos(a) * sp, vy: R(0, 0.4), vz: Math.sin(a) * sp, life: R(0.55, 0.85), s: R(0.25, 0.4) * Math.sqrt(scale), c0: 0x8a8478, c1: 0x5a5650, drag: 3.2 });
  }
  for (let i = 0; i < Math.round(22 * scale); i++) {
    const a = Math.random() * Math.PI * 2, sp = R(2, 6) * scale;
    spawnGlow({ x, y, z, vx: Math.cos(a) * sp, vy: R(4, 10), vz: Math.sin(a) * sp, life: R(1, 1.9), s0: R(0.06, 0.1), s1: 0.03, ramp: RAMP.ember, g: 14, drag: 0.4, bounce: true });
  }
  for (let i = 0; i < Math.round(16 * scale); i++) {
    spawnPuff({ x: x + R(-0.4, 0.4) * scale, y: y + R(0, 0.5), z: z + R(-0.4, 0.4) * scale, vx: R(-0.6, 0.6), vy: R(1.4, 2.6), vz: R(-0.6, 0.6),
      life: R(1.8, 2.9), s: R(0.45, 0.85) * scale, c0: 0x141418, c1: 0x55575e, delay: R(0.1, 0.45), drag: 0.6 });
  }
}
// 持續燃燒的點（殘骸）：火勢隨時間變小
const burners = [];
export function burnAt(x, y, z, dur = 4, k = 1) { if (HEADLESS) return; burners.push({ x, y, z, t: 0, dur, k, acc: 0 }); flashLight(x, y + 0.6, z, 0xff7a28, 22 * k, 5, dur, true); }

export function muzzleFlash(x, y, z, color, size = 1) {
  if (HEADLESS) return;
  spawnGlow({ x, y, z, life: 0.06, s0: 0.42 * size, s1: 0.2 * size, ramp: rampOf(color), vr: 0 });
  flashLight(x, y, z, color, 9 * size, 3.5, 0.07);
}
// ---------- 槍口火焰（照武器類別，2026-11-27） ----------
// (fx, fz) = 槍口朝向；style 見 MUZZLE；color = 火光顏色（敵人偏紅、玩家偏黃、光束用能量色）
// 形狀：中心一顆 + 往前噴一串越來越小的方塊（火舌）+ 側邊噴口（制退器：狙擊、加農砲）；煙、地面揚塵照類別
//   全部是 0.04～0.1 秒的發光方塊（共用 glow 池），一發大概 4～20 顆
const chain = (x, y, z, dx, dy, dz, n, len, s, rp, life, sp = 0) => {
  for (let i = 1; i <= n; i++) {
    const t = i / n, k = 1 - t * 0.65;
    spawnGlow({ x: x + dx * len * t, y: y + dy * len * t, z: z + dz * len * t, vx: dx * sp, vy: dy * sp, vz: dz * sp, life: life * (1 - t * 0.3), s0: s * k * R(0.8, 1.15), s1: s * k * 0.3, ramp: rp, vr: R(-20, 20), drag: 8 });
  }
};
export const MUZZLE = {
  //        core 大小、fwd 前方火舌 [顆數, 長度, 粗細]、side 十字側焰、brake 制退器側噴、cone 霰彈扇形 [顆數, 半角]、smoke [團數, 大小]、life 壽命、light 燈光倍率、dust 地面揚塵
  mg:      { core: 0.2, fwd: [3, 0.45, 0.13], side: [1, 0.16, 0.07], life: 0.045, light: 0.5 },
  ac:      { core: 0.3, fwd: [4, 0.75, 0.19], side: [2, 0.3, 0.11], smoke: [1, 0.5], life: 0.06, light: 0.8 },
  shot:    { core: 0.3, cone: [6, 0.4], smoke: [2, 0.55], life: 0.07, light: 0.9 },
  sniper:  { core: 0.3, fwd: [6, 1.4, 0.2], brake: [2, 0.55, 0.16], smoke: [2, 0.5], life: 0.07, light: 1.1, dust: 6 },
  cannon:  { core: 0.7, fwd: [6, 1.9, 0.5], brake: [3, 0.95, 0.34], smoke: [8, 1.3], life: 0.1, light: 1.8, dust: 14, fireball: 8 },
  beam:    { core: 0.34, fwd: [3, 0.6, 0.14], ring: 6, life: 0.06, light: 0.9 },
  rocket:  { core: 0.16, back: [4, 1.6], smoke: [3, 0.6], life: 0.06, light: 0.6 },
  missile: { core: 0.13, back: [2, 1], smoke: [1, 0.4], life: 0.05, light: 0.4 },
  vlaunch: { core: 0.14, up: [3, 0.7], smoke: [2, 0.5], life: 0.06, light: 0.4 },
  lob:     { core: 0.32, up: [4, 0.9], smoke: [3, 0.7], life: 0.08, light: 0.9 },
};
export function muzzleFx(x, y, z, fx, fz, style, color, light = true) {
  if (HEADLESS) return;
  const M = MUZZLE[style] ?? MUZZLE.mg, rp = rampOf(color), L = M.life, px = fz, pz = -fx;   // (px, pz) = 槍口右手邊
  spawnGlow({ x, y, z, life: L, s0: M.core * R(0.85, 1.2), s1: M.core * 0.4, ramp: RAMP.flash, vr: R(-10, 10) });
  if (M.fwd) chain(x, y, z, fx, 0, fz, M.fwd[0], M.fwd[1], M.fwd[2], rp, L, 3);
  if (M.side) for (const sg of [1, -1]) chain(x, y, z, px * sg, 0, pz * sg, M.side[0], M.side[1], M.side[2], rp, L * 0.8);
  if (M.brake) for (const sg of [1, -1]) { const bx = x + fx * 0.15, bz = z + fz * 0.15; chain(bx, y, bz, px * sg * 0.9 - fx * 0.25, 0.08, pz * sg * 0.9 - fz * 0.25, M.brake[0], M.brake[1], M.brake[2], rp, L, 4); }
  if (M.cone) for (let i = 0; i < M.cone[0]; i++) {
    const a = Math.atan2(fx, fz) + R(-1, 1) * M.cone[1], sp = R(9, 16);
    spawnGlow({ x, y, z, vx: Math.sin(a) * sp, vy: R(-0.5, 0.8), vz: Math.cos(a) * sp, life: L * R(0.9, 1.4), s0: R(0.1, 0.17), s1: 0.03, ramp: rp, drag: 10, vr: R(-15, 15) });
  }
  if (M.ring) for (let i = 0; i < M.ring; i++) {   // 光束：槍口一圈往外散的小光點
    const a = i / M.ring * Math.PI * 2, u = Math.cos(a), v = Math.sin(a), sp = R(2.5, 4.5);
    spawnGlow({ x, y, z, vx: px * u * sp + fx * 1.5, vy: v * sp, vz: pz * u * sp + fz * 1.5, life: R(0.12, 0.2), s0: 0.06, s1: 0.01, ramp: rp, drag: 4 });
  }
  if (M.back) for (let i = 0; i < M.back[0]; i++) {   // 火箭 / 飛彈：發射管後面噴出來的尾焰
    const sp = R(5, 9) * M.back[1];
    spawnGlow({ x: x - fx * 0.3, y, z: z - fz * 0.3, vx: -fx * sp + R(-1, 1), vy: R(-0.3, 0.8), vz: -fz * sp + R(-1, 1), life: R(0.12, 0.22), s0: R(0.14, 0.22), s1: 0.02, ramp: RAMP.fire, drag: 5 });
  }
  if (M.up) for (let i = 0; i < M.up[0]; i++) spawnGlow({ x, y, z, vx: R(-0.8, 0.8) + fx, vy: R(5, 9) * M.up[1], vz: R(-0.8, 0.8) + fz, life: R(0.08, 0.14), s0: R(0.12, 0.2), s1: 0.02, ramp: RAMP.fire, drag: 7 });
  if (M.fireball) for (let i = 0; i < M.fireball; i++) {   // 加農砲：往前滾出去的火球
    const sp = R(3, 7);
    spawnGlow({ x: x + fx * 0.4, y, z: z + fz * 0.4, vx: fx * sp + R(-1.2, 1.2), vy: R(-0.2, 1.2), vz: fz * sp + R(-1.2, 1.2), life: R(0.18, 0.32), s0: 0, s1: R(0.3, 0.5), puff: true, ramp: RAMP.fire, drag: 5, g: -1 });
  }
  if (M.smoke) for (let i = 0; i < M.smoke[0]; i++) {
    const back = M.back ? -1 : 1, sp = R(0.6, 1.8) * back;
    spawnPuff({ x: x + fx * 0.25 * back, y, z: z + fz * 0.25 * back, vx: fx * sp + R(-0.4, 0.4), vy: R(0.4, 1.1), vz: fz * sp + R(-0.4, 0.4), life: R(0.6, 1.1), s: R(0.7, 1.1) * M.smoke[1] * 0.35, c0: 0x6a6a6e, c1: 0x9a9a9e, drag: 2.2, delay: R(0, 0.04) });
  }
  if (M.dust && y < 1.6) for (let i = 0; i < M.dust; i++) {   // 狙擊 / 加農砲：地面被震起一圈塵
    const a = Math.atan2(fx, fz) + R(-1.4, 1.4), sp = R(3, 6);
    spawnPuff({ x: x + fx * 0.5, y: 0.12, z: z + fz * 0.5, vx: Math.sin(a) * sp, vy: R(0, 0.3), vz: Math.cos(a) * sp, life: R(0.5, 0.8), s: R(0.18, 0.3), c0: 0x8a8478, c1: 0x6a665e, drag: 3.5 });
  }
  if (light) flashLight(x, y, z, color, 9 * M.light * (style === 'cannon' ? 1.4 : 1), 3 + M.light * 1.5, 0.06 + M.light * 0.02);
}

// ---------- 彈殼 ----------
// 實彈武器（機槍、機砲、霰彈、狙擊、加農砲、打樁拳）每發從機匣往旁邊彈出一顆：拋物線、旋轉、在地上彈兩下，1.2～1.6 秒後縮掉
// 一個共用的 InstancedMesh（最多 CASE_MAX 顆，滿了就不再加）；顏色照種類（黃銅、霰彈的紅殼、打樁拳的鋼殼）
const CASE_MAX = 900;
export const CASINGS = {
  mg:     { w: 0.045, l: 0.11, c: 0xd4a640 },
  ac:     { w: 0.065, l: 0.17, c: 0xc89a38 },
  shot:   { w: 0.075, l: 0.15, c: 0xb8281c },
  sniper: { w: 0.06, l: 0.22, c: 0xd8b050 },
  cannon: { w: 0.15, l: 0.4, c: 0xb8902e },
  pile:   { w: 0.11, l: 0.28, c: 0x9a9ca2 },
};
const caseMesh = HEADLESS ? null : new THREE.InstancedMesh(UNIT_BOX, new THREE.MeshLambertMaterial({ color: 0xffffff }), CASE_MAX);
if (caseMesh) { caseMesh.frustumCulled = false; caseMesh.count = 0; caseMesh.setColorAt(0, new THREE.Color()); scene.add(caseMesh); }
const cases = [], caseE = new THREE.Euler(), caseQ = new THREE.Quaternion(), caseS = new THREE.Vector3(), caseP = new THREE.Vector3(), caseM = new THREE.Matrix4();
// side：+1 往槍口右手邊彈、-1 左手邊；(bvx, bvz)：機體的速度（彈殼跟著機體一起走）
export function casing(x, y, z, fx, fz, type, side = 1, bvx = 0, bvz = 0) {
  if (HEADLESS) return;
  if (cases.length >= CASE_MAX) return;
  const T = CASINGS[type] ?? CASINGS.mg, px = fz * side, pz = -fx * side, big = T.w > 0.1;
  const sp = big ? R(1.6, 2.6) : R(2.6, 4.2);
  cases.push({ x, y, z, vx: px * sp - fx * R(0.3, 1.2) + bvx * 0.8, vy: big ? R(2, 3.5) : R(3, 5), vz: pz * sp - fz * R(0.3, 1.2) + bvz * 0.8,
    rx: R(0, 6), ry: Math.atan2(fx, fz) + Math.PI / 2, vrx: R(14, 26) * (Math.random() < 0.5 ? -1 : 1), vry: R(-8, 8), life: R(1.2, 1.6), T, c: new THREE.Color(T.c).multiplyScalar(R(0.85, 1.1)) });
}
export function clearCasings() { cases.length = 0; if (caseMesh) caseMesh.count = 0; }
function updateCasings(dt) {
  let n = 0;
  for (let i = cases.length - 1; i >= 0; i--) {
    const k = cases[i];
    k.life -= dt;
    if (k.life <= 0 || k.y < -6) { cases[i] = cases[cases.length - 1]; cases.pop(); continue; }   // 時間到 / 掉進坑
    k.vy -= 22 * dt;
    k.x += k.vx * dt; k.y += k.vy * dt; k.z += k.vz * dt;
    k.rx += k.vrx * dt; k.ry += k.vry * dt;
    const h = k.T.w / 2;
    if (k.y < h && !pitTest(k.x, k.z)) {
      k.y = h;
      if (k.vy < -1.2) { k.vy *= -0.38; k.vx *= 0.55; k.vz *= 0.55; k.vrx *= 0.5; }   // 彈一下
      else { k.vy = 0; k.vx *= 0.82; k.vz *= 0.82; k.vrx *= 0.8; k.rx += (Math.round(k.rx / (Math.PI / 2)) * (Math.PI / 2) - k.rx) * Math.min(1, dt * 10); }   // 停下來躺平
    }
    if (wallTest(k.x, k.z) && k.y < WALL_H) { k.vx *= -0.4; k.vz *= -0.4; k.x += k.vx * dt * 2; k.z += k.vz * dt * 2; }
    const sc = Math.min(1, k.life / 0.3);
    caseE.set(k.rx, k.ry, 0); caseQ.setFromEuler(caseE);
    caseM.compose(caseP.set(k.x, k.y, k.z), caseQ, caseS.set(k.T.w * sc, k.T.w * sc, k.T.l * sc));
    caseMesh.setMatrixAt(n, caseM); caseMesh.setColorAt(n, k.c);
    n++;
  }
  caseMesh.count = n;
  caseMesh.instanceMatrix.needsUpdate = true;
  if (caseMesh.instanceColor) caseMesh.instanceColor.needsUpdate = true;
}

// 推進器火焰
export function flame(x, y, z, dx, dz) {
  if (HEADLESS) return;
  const p = R(5, 9);
  spawnGlow({ x, y, z, vx: dx * p + R(-1, 1), vy: R(-0.5, 1), vz: dz * p + R(-1, 1), life: R(0.15, 0.28), s0: R(0.14, 0.22), s1: 0,
    ramp: Math.random() < 0.5 ? RAMP.fire : rampOf(0x60c8ff), drag: 2 });
}

const dummy = new THREE.Object3D(), tmpC = new THREE.Color();
function stepList(list, dt, mesh, write) {
  let n = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i];
    if (p.delay > 0) { p.delay -= dt; continue; }
    p.life -= dt;
    if (p.life <= 0) { list[i] = list[list.length - 1]; list.pop(); continue; }
    const d = Math.exp(-p.drag * dt);
    p.vx *= d; p.vy *= d; p.vz *= d;
    p.vy -= p.g * dt;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    p.rx += p.vr * dt; p.ry += p.vr * 0.7 * dt;
    const s = write(p, 1 - p.life / p.max);
    if (p.y < s / 2) {
      p.y = s / 2;
      if (p.bounce && p.vy < -1) { p.vy *= -0.4; p.vx *= 0.6; p.vz *= 0.6; } else { p.vy = 0; p.vx *= 0.9; p.vz *= 0.9; }
    }
    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.set(p.rx, p.ry, 0);
    dummy.scale.setScalar(Math.max(0.001, s));
    dummy.updateMatrix();
    mesh.setMatrixAt(n, dummy.matrix);
    mesh.setColorAt(n, tmpC);
    n++;
  }
  mesh.count = n;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

// ---------- 修理：方塊從道具 / 修復站飛到機身上，再飄出綠色十字 ----------
// m = 被修的機體；(sx, sy, sz) = 方塊從哪裡飛出來；n = 幾塊；spread = 出發點散多開（修復站比較大）
// 每塊飛向機身上隨機一顆方塊的位置（跟著機體移動），拋物線、越飛越快，貼上去時閃一下綠光
const MEND_C = [0x60ff90, 0x9aa4b0, 0x60ff90, 0x6c747e];
const menders = [], crosses = [];
const CROSS_MAT = new THREE.MeshBasicMaterial({ color: 0x60ff90, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending, toneMapped: false });
const CROSS_H = new THREE.BoxGeometry(0.45, 0.15, 0.15), CROSS_V = new THREE.BoxGeometry(0.15, 0.45, 0.15);
export function repairFx(m, sx, sy, sz, n = 16, spread = 0.25, crossN = 4) {
  if (HEADLESS) return;
  const pts = sampleVoxels(m.model.root, n);
  pts.forEach((v, i) => {
    const mesh = new THREE.Mesh(DEBRIS_GEO, debrisMat(MEND_C[i % MEND_C.length]));
    const s = R(0.6, 1.0);
    mesh.scale.setScalar(s); mesh.visible = false;
    scene.add(mesh);
    menders.push({ mesh, m, s, ox: v.x - m.x, oy: v.y, oz: v.z - m.z,
      x0: sx + R(-spread, spread), y0: sy + R(-0.15, 0.3), z0: sz + R(-spread, spread),
      t: -i * R(0.02, 0.05), dur: R(0.4, 0.65), arc: R(0.5, 1.3), spin: R(8, 16) });
  });
  for (let k = 0; k < crossN; k++) {
    const g = new THREE.Group(), mat = CROSS_MAT.clone();
    g.add(new THREE.Mesh(CROSS_H, mat), new THREE.Mesh(CROSS_V, mat));
    g.visible = false; g.renderOrder = 6;
    scene.add(g);
    crosses.push({ g, mat, m, ox: R(-0.45, 0.45), oz: R(-0.45, 0.45), y: R(0.9, 1.6) * (m.k ?? 1), t: -(0.35 + k * 0.17 + R(0, 0.08)), life: 1.1, sc: R(0.9, 1.3) });
  }
}
function clearMenders() {
  for (const d of menders) scene.remove(d.mesh);
  for (const c of crosses) { scene.remove(c.g); c.mat.dispose(); }
  menders.length = crosses.length = 0;
}
function updateMenders(dt) {
  for (let i = menders.length - 1; i >= 0; i--) {
    const d = menders[i];
    d.t += dt;
    if (d.t < 0) continue;
    const f = Math.min(1, d.t / d.dur), e = f * f * (3 - 2 * f) * 0.4 + f * f * 0.6;
    const tx = d.m.x + d.ox, ty = d.oy, tz = d.m.z + d.oz;
    d.mesh.visible = true;
    d.mesh.position.set(d.x0 + (tx - d.x0) * e, d.y0 + (ty - d.y0) * e + Math.sin(Math.PI * f) * d.arc, d.z0 + (tz - d.z0) * e);
    d.mesh.rotation.x += d.spin * dt; d.mesh.rotation.y += d.spin * 0.7 * dt;
    d.mesh.scale.setScalar(d.s * (1 - f * 0.4));
    if (f >= 1) {
      spawnGlow({ x: tx, y: ty, z: tz, life: 0.25, s0: 0.16, s1: 0, ramp: rampOf(0x60ff90), vr: 0 });
      scene.remove(d.mesh); menders.splice(i, 1);
    }
  }
  for (let i = crosses.length - 1; i >= 0; i--) {
    const c = crosses[i];
    c.t += dt;
    if (c.t < 0) continue;
    const f = c.t / c.life;
    if (f >= 1) { scene.remove(c.g); c.mat.dispose(); crosses.splice(i, 1); continue; }
    c.g.visible = true;
    c.g.position.set(c.m.x + c.ox, c.y + f * 0.9, c.m.z + c.oz);
    c.g.quaternion.copy(camera.quaternion);   // 永遠正對鏡頭
    c.g.scale.setScalar(c.sc * (f < 0.15 ? 0.4 + f / 0.15 * 0.6 : 1));
    c.mat.opacity = f < 0.6 ? 1 : 1 - (f - 0.6) / 0.4;
  }
}

export function updateParticles(dt) {
  if (HEADLESS) return;
  updateLights(dt);
  updateCasings(dt);
  updateMenders(dt);
  for (let i = debris.length - 1; i >= 0; i--) {
    const d = debris[i];
    if (!d) continue;   // 這一幀中途換層 / 清場把清單清掉了
    const p = d.m.position;
    d.vy -= 24 * dt;
    p.x += d.vx * dt; p.y += d.vy * dt; p.z += d.vz * dt;
    d.m.rotation.x += d.sx * dt; d.m.rotation.z += d.sz * dt;
    const pit = pitTest(p.x, p.z);
    if (p.y < 0.08 && !pit) { p.y = 0.08; d.vy *= -0.35; d.vx *= 0.55; d.vz *= 0.55; d.sx *= 0.5; d.sz *= 0.5; }
    if (wallTest(p.x, p.z) && p.y < WALL_H) { d.vx *= -0.4; d.vz *= -0.4; p.x += d.vx * dt * 2; p.z += d.vz * dt * 2; }
    d.life -= dt;
    // 掉進空洞：一路掉下去，看不到了就收掉
    if (pit && p.y < -8) { scene.remove(d.m); debris.splice(i, 1); continue; }
    // 落地停住（或時間到、已經在地上）：壓進留在地上的碎片
    const rest = p.y <= 0.09 && !pit && Math.abs(d.vy) < 0.8 && Math.hypot(d.vx, d.vz) < 0.25;
    if (!pit && p.y <= 0.09 && (rest && !(d.burn && d.life > 0.3) || d.life <= 0)) { p.y = 0.08 * d.s; bake(d); scene.remove(d.m); debris.splice(i, 1); continue; }
    if (d.life <= 0 && !pit) { d.life = 0.1; continue; }   // 還在空中：等落地
    // 著火的碎塊：一路冒火、拖黑煙，火慢慢變小
    if (d.burn && d.life > 0.3) {
      d.burnAcc += dt * 28;
      while (d.burnAcc >= 1) {
        d.burnAcc--;
        spawnGlow({ x: p.x + R(-0.06, 0.06), y: p.y + 0.05, z: p.z + R(-0.06, 0.06), vx: R(-0.3, 0.3), vy: R(1, 2.2), vz: R(-0.3, 0.3),
          life: R(0.25, 0.45), s0: R(0.12, 0.22) * Math.min(1, d.life / 1.5 + 0.3), s1: 0, ramp: RAMP.fire, drag: 1 });
      }
      if (Math.random() < dt * 6) spawnPuff({ x: p.x, y: p.y + 0.15, z: p.z, vx: 0, vy: R(0.6, 1.1), vz: 0, life: R(0.8, 1.3), s: R(0.12, 0.2), c0: 0x16161a, c1: 0x3a3c42, drag: 0.6 });
    }
    if (d.life <= 0) { scene.remove(d.m); debris.splice(i, 1); }
  }
  for (let i = burners.length - 1; i >= 0; i--) {
    const b = burners[i];
    b.t += dt;
    if (b.t >= b.dur) { burners.splice(i, 1); continue; }
    const k = b.k * (1 - b.t / b.dur);
    b.acc += dt * 40 * k;
    while (b.acc >= 1) { b.acc--; fire(b.x + R(-0.5, 0.5), b.y, b.z + R(-0.5, 0.5), 0.5 + k * 0.6); }
  }
  stepList(glows, dt, glowMesh, (p, t) => {
    sampleRamp(p.ramp, t, tmpC);
    // 剛冒出來最亮（超過白），越燒越暗；爆炸的閃光大方塊、火團不加（方塊的形狀是設計圖騰，不能被光暈吃掉）
    if (GFX.hdr !== 1 && !p.puff && p.ramp !== RAMP.flash && p.ramp !== RAMP.flashCore) tmpC.multiplyScalar(1 + (GFX.hdr - 1) * (1 - t) * (1 - t));
    return p.puff ? p.s1 * Math.sin(Math.PI * Math.min(1, Math.pow(t, 0.55))) + 0.02 : p.s0 + (p.s1 - p.s0) * t;
  });
  stepList(puffs, dt, puffMesh, (p, t) => {
    tmpC.copy(p.col0).lerp(p.col1, t);
    return p.s * (t < 0.25 ? 0.4 + 2.4 * t : 1 - Math.max(0, (t - 0.6) / 0.4) * 0.9);
  });
}
