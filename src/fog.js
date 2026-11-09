// ---------- 戰爭迷霧（遠征模式） ----------
// 視線：從玩家所在位置往四周打 720 條射線（每 0.5 格一步），最遠 sight 格（每層可以不一樣：地下短一點）
//   碰到擋視線的格子：繼續穿過「這個障礙物本身」（最多 THROUGH 格，整棟建築 / 整段岩壁都算看得到），一出到後面的空地就停 → 只有後面被蓋住
//   地下的岩層、上一層的崖壁不穿（edge：只看得到表面）；地圖邊緣那圈山（deep）看得進去 DEEP 格，再裡面是黑的 → 看起來是一大片山，不是一道牆
//   擋視線：'#'（岩壁、高的建築）；1 層樓的矮建築（掩體、廢墟的小屋）不擋視線、只擋子彈 —— 機體比它高；'v'（懸空，往下看得到下一層）不擋
// 三種狀態：沒去過（全黑）、去過但現在看不到（變暗）、看得到（正常）；判定（vis / seen，一格一格）一秒算 10 次
// 多層地圖：每層一份迷霧（看過哪裡各自記）；從懸空的地方往下看 = 下一層那一格也算看過
// 畫法（和判定分開，見最下面）：地板、岩壁、建築、箱子的材質掛上 fogMaterial(mat, U)，片段著色器依世界座標查遮罩（fogSample），乘上 fogDim
//   U 不給 = 共用的 fogU（永遠指向「目前這一層」：箱子、傳送門這些只在目前這層畫的東西用）
// 其他模式 fogOn = 0，不受影響
import * as THREE from 'three';
import { H, W, grid } from './arena.js';
import { renderer } from './core.js';

export const RADIUS = 32;
const THROUGH = 12, DEEP = 8;   // 穿過障礙物最多幾格；地圖邊緣那圈山最多看進去幾格
const DIM = 80, BELOW = 200;   // 去過 / 看得到 / 從上一層往下看得到 的亮度（0～255）
// 現在看得到的遮罩：所有層共用同一張（只有目前這層 fogVisK = 1），只蓋玩家周圍一塊（fogVisR = 左下角 x, z、1 / 邊長）
const VIS_T = { value: null }, VIS_R = { value: new THREE.Vector4(0, 0, 0, 0) };
export const makeFogU = () => ({ fogTex: { value: null }, fogVis: VIS_T, fogVisR: VIS_R, fogVisK: { value: 0 }, fogOn: { value: 0 }, fogSize: { value: new THREE.Vector2(64, 48) }, fogDim: { value: 1 } });
export const fogU = makeFogU();
let on = false, L = null, layers = [], acc = 1, pc = 0, pr = 0;

// 高度霧：比目前這層的地面低的東西（坑、下面那層、崖壁）越深越往霧色混 → 看下去有深度、深處模糊成一片
// 1 − exp(−深度 × 密度)：沉 5 格（下一層）大約混一半、9 格深的崖壁底幾乎全是霧；所有吃迷霧的材質共用（其他模式也有）
export const heightFog = { hfColor: { value: new THREE.Color(0x232831) }, hfDensity: { value: 0.16 } };
export function setHeightFog(hex, density) { heightFog.hfColor.value.setHex(hex); heightFog.hfDensity.value = density; }

// 迷霧取樣（著色器共用）：判定（上面那套一格一格的 vis / seen）和畫面分開
//   畫面用遮罩：fogVis = 現在看得到（玩家周圍一塊、每格約 30 像素、反鋸齒；每幀從玩家位置算精確的視線多邊形畫進去）
//              fogTex = 看過的（整張地圖、每格最多 24 像素；視線多邊形一直疊上去）
//   所以視野邊緣是俐落的直線（障礙物的邊、從角落拉出去的影子線），不是一格一格的鋸齒
export const FOG_GLSL = `uniform sampler2D fogTex, fogVis; uniform vec2 fogSize; uniform float fogVisK; uniform vec4 fogVisR;
  float fogSample(vec2 xz) {
    vec2 uv = (xz + fogSize * 0.5) / fogSize, lv = (xz - fogVisR.xy) * fogVisR.z;
    float v = lv.x > 0.0 && lv.y > 0.0 && lv.x < 1.0 && lv.y < 1.0 ? texture2D(fogVis, lv).r : 0.0;
    return max(texture2D(fogTex, uv).r, v * fogVisK);
  }
`;

// 讓材質吃迷霧（InstancedMesh 也可以）
export function fogMaterial(mat, U = fogU) {
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U, heightFog);
    sh.vertexShader = 'varying vec2 vFogXZ;\nvarying float vFogY;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      vec4 fogP = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        fogP = instanceMatrix * fogP;
      #endif
      vec4 fogW = modelMatrix * fogP;
      vFogXZ = fogW.xz; vFogY = fogW.y;`);
    sh.fragmentShader = 'uniform float fogOn;\nuniform float fogDim;\nuniform vec3 hfColor;\nuniform float hfDensity;\nvarying vec2 vFogXZ;\nvarying float vFogY;\n' + FOG_GLSL + sh.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>
      float fogV = fogOn > 0.5 ? fogSample(vFogXZ) * fogDim : 1.0;
      gl_FragColor.rgb *= fogV;
      // 高度霧：比地面低越多越往霧色混（霧色也照那層的迷霧亮度，沒去過的地方還是黑的）
      float hfK = 1.0 - exp(-max(0.0, -vFogY - 0.15) * hfDensity);
      gl_FragColor.rgb = mix(gl_FragColor.rgb, hfColor * fogV, hfK);`);
  };
  mat.customProgramCacheKey = () => 'fog';
  return mat;
}

// 一層的迷霧：low = 1 層樓建築佔的格子（不擋視線）、edge = 不穿的格子、sight = 視線距離、g = 這層的格子
function makeLayer({ low = new Set(), edge = null, deep = null, sight = RADIUS, g = grid, U = null } = {}) {
  const rt = maskRT();
  clearRT(rt);
  U ??= makeFogU();
  U.fogTex.value = rt.texture; U.fogVisK.value = 0; U.fogOn.value = 1; U.fogSize.value.set(W, H);
  return { low, edge, deep, sight, g, vis: new Uint8Array(W * H), seen: new Uint8Array(W * H), below: new Uint8Array(W * H), rt, U };
}
function disposeAll() { for (const l of layers) l.rt.dispose(); layers = []; }
// 單層（舊的用法）
export function initFog(lowTiles, edgeBand = null) { initFogLayers([{ low: lowTiles, edge: edgeBand }]); }
// 多層：list[k] = { low, edge, sight, g, U }（U = 那層地板、岩壁、建築材質用的 uniforms，arena.js 建的，這裡填進貼圖）
export function initFogLayers(list) {
  disposeAll(); fitMask();
  layers = list.map(makeLayer);
  on = true; acc = 1;
  setFogLayer(0);
  return layers.map(l => l.U);
}
// 換到第 k 層：離開的那層「看得到」全部變成「去過」；共用的 fogU 指到新的這層
export function setFogLayer(k) {
  if (L && L !== layers[k]) L.vis.fill(0);
  L = layers[k]; acc = 1;
  for (const l of layers) l.U.fogVisK.value = l === L ? 1 : 0;
  for (const v of visRT) clearRT(v);
  VIS_R.value.set(0, 0, 0, 0);
  fogU.fogTex.value = L.rt.texture; fogU.fogVisK.value = 1; fogU.fogOn.value = 1; fogU.fogSize.value.set(W, H);
}
export const fogLayerU = k => layers[k]?.U;
export function fogOff() { on = false; L = null; fogU.fogOn.value = 0; for (const l of layers) l.U.fogOn.value = 0; }
export const fogActive = () => on;

const blocksSight = i => L.g[(i / W) | 0][i % W] === '#' && !L.low.has(i);
function compute(x, z) {
  const vis = L.vis, seen = L.seen, edge = L.edge, deep = L.deep, R = L.sight;
  vis.fill(0);
  const ox = x + W / 2, oz = z + H / 2;
  pc = Math.floor(ox); pr = Math.floor(oz);
  const N = 720;
  for (let k = 0; k < N; k++) {
    const a = k / N * Math.PI * 2, dx = Math.cos(a) * 0.5, dz = Math.sin(a) * 0.5;
    let px = ox, pz = oz, wall = -1, lim = THROUGH * 2;
    for (let s = 0; s <= R * 2; s++) {
      const c = Math.floor(px), r = Math.floor(pz);
      if (c < 0 || r < 0 || c >= W || r >= H) break;
      const i = r * W + c, b = s > 1 && blocksSight(i);
      if (wall >= 0 && (!b || edge?.[i] || s - wall > lim)) break;   // 穿出障礙物（或太厚、碰到邊緣那圈）：後面看不到
      vis[i] = 1; seen[i] = 1;
      if (b && wall < 0) { if (edge?.[i]) break; wall = s; lim = deep?.[i] ? DEEP * 2 : THROUGH * 2; }
      px += dx; pz += dz;
    }
  }
  // 往下看：這層懸空、看得到的格子 → 下面那層（一路往下到不是懸空的那層）那一格算看過
  const k = layers.indexOf(L);
  if (k > 0) {
    const R2 = R + 1; let n = 0;
    for (let r = Math.max(0, pr - R2); r < Math.min(H, pr + R2); r++) for (let c = Math.max(0, pc - R2); c < Math.min(W, pc + R2); c++) {
      const i = r * W + c;
      if (!vis[i] || L.g[r][c] !== 'v') continue;
      for (let j = k - 1; j >= 0; j--) {
        const D = layers[j];
        if (!D.below[i]) { D.seen[i] = 1; D.below[i] = 1; (D.sq ??= []).push(c, r); n++; }   // 從上面看下去：比「去過」亮一點（那一格的方塊畫進那層的遮罩）
        if (D.g[r][c] !== 'v') break;
      }
    }
    if (n) for (const D of layers) if (D.sq?.length) { drawSquares(D.rt, D.sq); D.sq = null; }
  }
}
export function updateFog(dt, x, z) {
  if (!on) return;
  if ((acc += dt) >= 0.1) { acc = 0; compute(x, z); }
  drawVision(dt, x + W / 2, z + H / 2);
}
const idx = (x, z) => { const c = Math.floor(x + W / 2), r = Math.floor(z + H / 2); return c < 0 || r < 0 || c >= W || r >= H ? -1 : r * W + c; };
export const visibleAt = (x, z) => { if (!on) return true; const i = idx(x, z); return i >= 0 && L.vis[i] === 1; };
export const exploredAt = (x, z) => { if (!on) return true; const i = idx(x, z); return i >= 0 && L.seen[i] === 1; };
export const fogSeen = () => on ? L.seen : null;
export const fogSeenOf = k => on ? layers[k]?.seen : null;

// ---------- 畫面用的視線遮罩 ----------
// 每幀：從玩家位置往四周打射線（逐格精確走，算出每條線停在哪：穿過障礙物、從後面那面出來就停，規則和上面 compute 一樣）
//   射線方向 = 均勻 360 條 + 範圍內每個障礙物角落左右各一條 → 影子的邊剛好貼著角落拉出去，是筆直的線，走動時也不會抖
//   連成扇形多邊形，畫進遮罩：fogVis 往新的形狀過渡（剛看到的地方淡入），看過的遮罩直接疊上去（取最大值）
const MS = 24, LN = 2048, MAXR = 6000, BASE = 360, EPS = 4e-4;
const ms = () => Math.min(MS, Math.floor(4096 / Math.max(W, H)));   // 大地圖：看過的遮罩最大 4096 像素寬
const LIN = { format: THREE.RedFormat, type: THREE.UnsignedByteType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter };
const maskRT = () => new THREE.WebGLRenderTarget(W * ms(), H * ms(), LIN);
// 玩家周圍那塊：polyRT = 這一幀的多邊形（4 倍反鋸齒）、visRT 兩張輪流 = 淡入淡出後的結果
const polyRT = new THREE.WebGLRenderTarget(LN, LN, { ...LIN, samples: 4 });
const visRT = [new THREE.WebGLRenderTarget(LN, LN, LIN), new THREE.WebGLRenderTarget(LN, LN, LIN)];
let cur = 0, mW = 0, mH = 0, mcam = null;   // mcam：看過的遮罩的 (u, v) = 世界的 (x, z)（用到才建：arena.js 和這裡互相 import，載入時 W、H 還沒好）
const lcam = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
// 地圖大小變了（每張遠征地圖不一樣大）：相機重建
function fitMask() { if (mW !== W || mH !== H) { mW = W; mH = H; mcam = null; } }
const mscene = new THREE.Scene();
const VS = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
const mat = (uniforms, frag, blend = {}) => new THREE.ShaderMaterial({ uniforms, vertexShader: VS, fragmentShader: frag, depthTest: false, depthWrite: false, side: THREE.DoubleSide, ...blend });
const MAX = { transparent: true, blending: THREE.CustomBlending, blendEquation: THREE.MaxEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor };
const polyMat = mat({}, 'void main() { gl_FragColor = vec4(1.0); }');
const belowMat = mat({}, `void main() { gl_FragColor = vec4(${(BELOW / 255).toFixed(4)}); }`, MAX);
// 看過的：把這幀的多邊形（玩家周圍那塊）以 DIM 的亮度疊進整張地圖的遮罩
const seenMat = mat({ poly: { value: polyRT.texture } }, `uniform sampler2D poly; varying vec2 vUv;
  void main() { gl_FragColor = vec4(texture2D(poly, vUv).r * ${(DIM / 255).toFixed(4)}); }`, MAX);
// 淡入淡出：新的 = mix(上一張（換算到新的位置）, 這幀的多邊形, k)
const fadeMat = new THREE.ShaderMaterial({
  uniforms: { prev: { value: null }, poly: { value: polyRT.texture }, prevR: { value: new THREE.Vector4() }, nowR: { value: new THREE.Vector4() }, k: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `uniform sampler2D prev, poly; uniform vec4 prevR, nowR; uniform float k; varying vec2 vUv;
    void main() {
      vec2 w = nowR.xy + vUv / nowR.z, pv = (w - prevR.xy) * prevR.z;
      float p = prevR.z > 0.0 && pv.x > 0.0 && pv.y > 0.0 && pv.x < 1.0 && pv.y < 1.0 ? texture2D(prev, pv).r : 0.0;
      gl_FragColor = vec4(mix(p, texture2D(poly, vUv).r, k));
    }`,
  depthTest: false, depthWrite: false,
});
const polyPos = new Float32Array(MAXR * 9), polyGeo = new THREE.BufferGeometry();
polyGeo.setAttribute('position', new THREE.BufferAttribute(polyPos, 3).setUsage(THREE.DynamicDrawUsage));
polyGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(MAXR * 6), 2));
const unit = new THREE.PlaneGeometry(1, 1), full = new THREE.PlaneGeometry(2, 2);
let sqGeo = null;
const mmesh = new THREE.Mesh(polyGeo, polyMat);
mmesh.frustumCulled = false;
mscene.add(mmesh);
function draw(rt, geo, m, cam, clear = false) {
  if (!mcam) mcam = new THREE.OrthographicCamera(-W / 2, W / 2, H / 2, -H / 2, -1, 1);
  const prev = renderer.getRenderTarget(), ac = renderer.autoClear;
  mmesh.geometry = geo; mmesh.material = m;
  renderer.autoClear = false; renderer.setRenderTarget(rt);
  if (clear) clearRT(rt, true);
  renderer.render(mscene, cam ?? mcam);
  renderer.setRenderTarget(prev); renderer.autoClear = ac;
  mmesh.position.set(0, 0, 0); mmesh.scale.set(1, 1, 1);
}
const cc = new THREE.Color();
function clearRT(rt, bound = false) {
  const prev = renderer.getRenderTarget(), a = renderer.getClearAlpha();
  renderer.getClearColor(cc);
  if (!bound) renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 1); renderer.clear(true, false, false);
  renderer.setClearColor(cc, a);
  if (!bound) renderer.setRenderTarget(prev);
}
function drawSquares(rt, list) {
  const n = list.length / 2, pos = new Float32Array(n * 18);
  for (let k = 0; k < n; k++) {
    const x0 = list[k * 2] - W / 2, z0 = list[k * 2 + 1] - H / 2, x1 = x0 + 1, z1 = z0 + 1;
    pos.set([x0, z0, 0, x1, z0, 0, x1, z1, 0, x0, z0, 0, x1, z1, 0, x0, z1, 0], k * 18);
  }
  sqGeo?.dispose();
  sqGeo = new THREE.BufferGeometry();
  sqGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  sqGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 12), 2));
  draw(rt, sqGeo, belowMat);
}
// 一條射線（格子座標 ox, oz 出發，角度 a）能看多遠
function castRay(ox, oz, a, R) {
  const dx = Math.cos(a), dz = Math.sin(a), g = L.g, low = L.low, edge = L.edge, deep = L.deep;
  let c = Math.floor(ox), r = Math.floor(oz);
  const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1, tdx = dx ? Math.abs(1 / dx) : Infinity, tdz = dz ? Math.abs(1 / dz) : Infinity;
  let tx = dx ? (dx > 0 ? c + 1 - ox : ox - c) * tdx : Infinity, tz = dz ? (dz > 0 ? r + 1 - oz : oz - r) * tdz : Infinity;
  let t = 0, wall = -1, lim = 0;
  for (;;) {
    if (c < 0 || r < 0 || c >= W || r >= H) return t;
    const tn = Math.min(tx, tz, R), i = r * W + c, b = tn > 1 && g[r][c] === '#' && !low.has(i);   // 腳邊 1 格內不擋（同 compute 的 s > 1）
    if (wall >= 0) {
      if (!b || edge?.[i]) return t;                 // 穿出障礙物：後面看不到
      if (t - wall > lim) return wall + lim;         // 太厚
    }
    if (b && wall < 0) {
      if (edge?.[i]) return tn;                      // 邊緣那圈：只看得到表面這格
      wall = t; lim = deep?.[i] ? DEEP : THROUGH;
    }
    if (tn >= R) return R;
    if (tx < tz) { t = tx; tx += tdx; c += sx; } else { t = tz; tz += tdz; r += sz; }
  }
}
const angs = new Float32Array(MAXR);
function drawVision(dt, ox, oz) {
  const R = L.sight, g = L.g, low = L.low;
  const bl = (c, r) => c >= 0 && r >= 0 && c < W && r < H && g[r][c] === '#' && !low.has(r * W + c) ? 1 : 0;
  let n = 0;
  for (let k = 0; k < BASE; k++) angs[n++] = -Math.PI + (k + 0.5) / BASE * Math.PI * 2;
  // 障礙物的角落（格點周圍 4 格裡擋視線的是 1、3 格，或斜對角 2 格）
  const c0 = Math.max(0, Math.floor(ox - R)), c1 = Math.min(W, Math.ceil(ox + R)), r0 = Math.max(0, Math.floor(oz - R)), r1 = Math.min(H, Math.ceil(oz + R));
  outer: for (let vr = r0; vr <= r1; vr++) for (let vc = c0; vc <= c1; vc++) {
    const a = bl(vc - 1, vr - 1), b = bl(vc, vr - 1), c = bl(vc - 1, vr), d = bl(vc, vr), s = a + b + c + d;
    if (s === 0 || s === 4 || (s === 2 && a !== d)) continue;
    const ex = vc - ox, ez = vr - oz, d2 = ex * ex + ez * ez;
    if (d2 > R * R || d2 < 0.25) continue;
    const an = Math.atan2(ez, ex);
    angs[n++] = an - EPS; angs[n++] = an + EPS;
    if (n >= MAXR - 2) break outer;
  }
  const A = angs.subarray(0, n).sort();
  const wx = ox - W / 2, wz = oz - H / 2;
  let px = 0, pz = 0, fx = 0, fz = 0;
  for (let k = 0; k <= n; k++) {
    let x, z;
    if (k < n) { const a = A[k], t = castRay(ox, oz, a, R); x = wx + Math.cos(a) * t; z = wz + Math.sin(a) * t; }
    else { x = fx; z = fz; }
    if (k === 0) { fx = x; fz = z; }
    else polyPos.set([wx, wz, 0, px, pz, 0, x, z, 0], (k - 1) * 9);
    px = x; pz = z;
  }
  polyGeo.attributes.position.needsUpdate = true;
  polyGeo.setDrawRange(0, n * 3);
  // 1. 這幀的多邊形畫進玩家周圍那塊（反鋸齒）
  const half = R + 1, x0 = wx - half, z0 = wz - half, size = half * 2;
  lcam.left = x0; lcam.right = x0 + size; lcam.bottom = z0; lcam.top = z0 + size; lcam.updateProjectionMatrix();
  draw(polyRT, polyGeo, polyMat, lcam, true);
  // 2. 淡入淡出：上一張換算到新位置，往這幀的多邊形過渡 → 新看到的地方淡入、離開的淡出
  const F = fadeMat.uniforms;
  F.prev.value = visRT[cur].texture; F.prevR.value.copy(VIS_R.value); F.nowR.value.set(x0, z0, 1 / size, 0); F.k.value = 1 - Math.exp(-dt * 12);
  cur ^= 1;
  draw(visRT[cur], full, fadeMat, lcam);
  VIS_T.value = visRT[cur].texture; VIS_R.value.set(x0, z0, 1 / size, 0);
  // 3. 看過的：同一塊疊進整張地圖的遮罩
  mmesh.position.set(x0 + half, z0 + half, 0); mmesh.scale.set(size, size, 1);
  draw(L.rt, unit, seenMat);
}
