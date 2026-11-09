// ---------- 戰爭迷霧（遠征模式） ----------
// 視線：從玩家所在位置往四周打 720 條射線（每 0.5 格一步），最遠 sight 格（每層可以不一樣：地下短一點）
//   碰到擋視線的格子：繼續穿過「這個障礙物本身」（最多 THROUGH 格，整棟建築 / 整段岩壁都算看得到），一出到後面的空地就停 → 只有後面被蓋住
//   地下的岩層、上一層的崖壁不穿（edge：只看得到表面）；地圖邊緣那圈山（deep）看得進去 DEEP 格，再裡面是黑的 → 看起來是一大片山，不是一道牆
//   擋視線：'#'（岩壁、高的建築）；1 層樓的矮建築（掩體、廢墟的小屋）不擋視線、只擋子彈 —— 機體比它高；'v'（懸空，往下看得到下一層）不擋
// 三種狀態：沒去過（全黑）、去過但現在看不到（變暗）、看得到（正常）；一秒算 10 次，亮度每幀慢慢過渡
// 多層地圖：每層一份迷霧（看過哪裡各自記）；從懸空的地方往下看 = 下一層那一格也算看過
// 畫法：地板、岩壁、建築、箱子的材質掛上 fogMaterial(mat, U)，片段著色器依世界座標查那一層的迷霧貼圖（每格一個像素），乘上 fogDim
//   U 不給 = 共用的 fogU（永遠指向「目前這一層」：箱子、傳送門這些只在目前這層畫的東西用）
// 其他模式 fogOn = 0，不受影響
import * as THREE from 'three';
import { H, W, grid } from './arena.js';

export const RADIUS = 32;
const THROUGH = 12, DEEP = 8;   // 穿過障礙物最多幾格；地圖邊緣那圈山最多看進去幾格
const DIM = 80, LIT = 255, BELOW = 200;   // 去過 / 看得到 / 從上一層往下看得到 的亮度（0～255）
export const makeFogU = () => ({ fogTex: { value: null }, fogOn: { value: 0 }, fogSize: { value: new THREE.Vector2(64, 48) }, fogDim: { value: 1 } });
export const fogU = makeFogU();
let on = false, L = null, layers = [], acc = 1, pc = 0, pr = 0;

// 高度霧：比目前這層的地面低的東西（坑、下面那層、崖壁）越深越往霧色混 → 看下去有深度、深處模糊成一片
// 1 − exp(−深度 × 密度)：沉 5 格（下一層）大約混一半、9 格深的崖壁底幾乎全是霧；所有吃迷霧的材質共用（其他模式也有）
export const heightFog = { hfColor: { value: new THREE.Color(0x232831) }, hfDensity: { value: 0.16 } };
export function setHeightFog(hex, density) { heightFog.hfColor.value.setHex(hex); heightFog.hfDensity.value = density; }

// 迷霧取樣（著色器共用）：貼圖一格一個像素，直接線性內插的話邊緣是糊糊的鋸齒（一格一格的階梯）
// 改成：取周圍 4 格，在最暗和最亮的中間畫一條等高線、只在一兩個螢幕像素內過渡 → 階梯變成乾淨的直線 / 斜線
// 4 格都一樣（或一起淡入淡出）時 max = min，就照原本的值，不影響漸變
export const FOG_GLSL = `uniform sampler2D fogTex; uniform vec2 fogSize;
  float fogSample(vec2 xz) {
    vec2 p = (xz + fogSize * 0.5) - 0.5, i = floor(p), f = p - i;
    float a = texture2D(fogTex, (i + vec2(0.5, 0.5)) / fogSize).r, b = texture2D(fogTex, (i + vec2(1.5, 0.5)) / fogSize).r;
    float c = texture2D(fogTex, (i + vec2(0.5, 1.5)) / fogSize).r, d = texture2D(fogTex, (i + vec2(1.5, 1.5)) / fogSize).r;
    // 平滑的值：三次 B 樣條（用 4 次線性取樣湊出 4×4 格的加權）→ 階梯被抹成平順的坡，等高線就是直的 / 圓滑的
    vec2 f2 = f * f, f3 = f2 * f;
    vec2 w0 = (1.0 - 3.0 * f + 3.0 * f2 - f3) / 6.0, w1 = (4.0 - 6.0 * f2 + 3.0 * f3) / 6.0;
    vec2 w2 = (1.0 + 3.0 * f + 3.0 * f2 - 3.0 * f3) / 6.0, w3 = f3 / 6.0;
    vec2 g0 = w0 + w1, g1 = w2 + w3, h0 = i + 0.5 - 1.0 + w1 / g0, h1 = i + 0.5 + 1.0 + w3 / g1;
    float v = g0.y * (g0.x * texture2D(fogTex, vec2(h0.x, h0.y) / fogSize).r + g1.x * texture2D(fogTex, vec2(h1.x, h0.y) / fogSize).r)
            + g1.y * (g0.x * texture2D(fogTex, vec2(h0.x, h1.y) / fogSize).r + g1.x * texture2D(fogTex, vec2(h1.x, h1.y) / fogSize).r);
    float lo = min(min(a, b), min(c, d)), hi = max(max(a, b), max(c, d));
    v = clamp(v, lo, hi);
    float t = (v - lo) / max(hi - lo, 1e-3), w = clamp(fwidth(t) * 0.8, 0.01, 0.5);   // 導數要在分支外面算
    return hi - lo < 0.02 ? v : mix(lo, hi, smoothstep(0.5 - w, 0.5 + w, t));
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
  const data = new Uint8Array(W * H);
  const tex = new THREE.DataTexture(data, W, H, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  U ??= makeFogU();
  U.fogTex.value = tex; U.fogOn.value = 1; U.fogSize.value.set(W, H);
  return { low, edge, deep, sight, g, vis: new Uint8Array(W * H), seen: new Uint8Array(W * H), data, tex, U };
}
function disposeAll() { for (const l of layers) l.tex.dispose(); layers = []; }
// 單層（舊的用法）
export function initFog(lowTiles, edgeBand = null) { initFogLayers([{ low: lowTiles, edge: edgeBand }]); }
// 多層：list[k] = { low, edge, sight, g, U }（U = 那層地板、岩壁、建築材質用的 uniforms，arena.js 建的，這裡填進貼圖）
export function initFogLayers(list) {
  disposeAll();
  layers = list.map(makeLayer);
  on = true; acc = 1;
  setFogLayer(0);
  return layers.map(l => l.U);
}
// 換到第 k 層：離開的那層「看得到」全部變成「去過」；共用的 fogU 指到新的這層
export function setFogLayer(k) {
  if (L && L !== layers[k]) { L.vis.fill(0); for (let i = 0; i < L.data.length; i++) L.data[i] = L.seen[i] ? DIM : 0; L.tex.needsUpdate = true; }
  L = layers[k]; acc = 1;
  fogU.fogTex.value = L.tex; fogU.fogOn.value = 1; fogU.fogSize.value.set(W, H);
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
    const R2 = R + 1;
    for (let r = Math.max(0, pr - R2); r < Math.min(H, pr + R2); r++) for (let c = Math.max(0, pc - R2); c < Math.min(W, pc + R2); c++) {
      const i = r * W + c;
      if (!vis[i] || L.g[r][c] !== 'v') continue;
      for (let j = k - 1; j >= 0; j--) {
        const D = layers[j];
        if (D.data[i] < BELOW) { D.seen[i] = 1; D.data[i] = BELOW; D.dirty = true; }   // 從上面看下去：比「去過」亮一點
        if (D.g[r][c] !== 'v') break;
      }
    }
    for (const D of layers) if (D.dirty) { D.dirty = false; D.tex.needsUpdate = true; }
  }
}
export function updateFog(dt, x, z) {
  if (!on) return;
  if ((acc += dt) >= 0.1) { acc = 0; compute(x, z); }
  // 亮度往目標過渡（只看玩家附近：會變的格子都在視線半徑內）
  const R = L.sight + 6, k = Math.min(1, dt * 8), vis = L.vis, seen = L.seen, data = L.data;
  for (let r = Math.max(0, pr - R); r < Math.min(H, pr + R); r++) for (let c = Math.max(0, pc - R); c < Math.min(W, pc + R); c++) {
    const i = r * W + c, want = vis[i] ? LIT : seen[i] ? DIM : 0;
    if (data[i] !== want) data[i] = Math.abs(want - data[i]) < 3 ? want : data[i] + (want - data[i]) * k;
  }
  L.tex.needsUpdate = true;
}
const idx = (x, z) => { const c = Math.floor(x + W / 2), r = Math.floor(z + H / 2); return c < 0 || r < 0 || c >= W || r >= H ? -1 : r * W + c; };
export const visibleAt = (x, z) => { if (!on) return true; const i = idx(x, z); return i >= 0 && L.vis[i] === 1; };
export const exploredAt = (x, z) => { if (!on) return true; const i = idx(x, z); return i >= 0 && L.seen[i] === 1; };
export const fogSeen = () => on ? L.seen : null;
export const fogSeenOf = k => on ? layers[k]?.seen : null;
