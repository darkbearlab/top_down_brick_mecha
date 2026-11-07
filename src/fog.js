// ---------- 戰爭迷霧（遠征模式） ----------
// 視線：從玩家所在位置往四周打 720 條射線（每 0.5 格一步），最遠 sight 格（每層可以不一樣：地下短一點）
//   碰到擋視線的格子：繼續穿過「這個障礙物本身」（最多 THROUGH 格，整棟建築 / 整段岩壁都算看得到），一出到後面的空地就停 → 只有後面被蓋住
//   地圖邊緣那圈岩壁、地下的岩層、上一層的崖壁不穿（edge：只看得到表面）
//   擋視線：'#'（岩壁、高的建築）；1 層樓的矮建築（掩體、廢墟的小屋）不擋視線、只擋子彈 —— 機體比它高；'v'（懸空，往下看得到下一層）不擋
// 三種狀態：沒去過（全黑）、去過但現在看不到（變暗）、看得到（正常）；一秒算 10 次，亮度每幀慢慢過渡
// 多層地圖：每層一份迷霧（看過哪裡各自記）；從懸空的地方往下看 = 下一層那一格也算看過
// 畫法：地板、岩壁、建築、箱子的材質掛上 fogMaterial(mat, U)，片段著色器依世界座標查那一層的迷霧貼圖（每格一個像素），乘上 fogDim
//   U 不給 = 共用的 fogU（永遠指向「目前這一層」：箱子、傳送門這些只在目前這層畫的東西用）
// 其他模式 fogOn = 0，不受影響
import * as THREE from 'three';
import { H, W, grid } from './arena.js';

export const RADIUS = 32;
const THROUGH = 12;
const DIM = 80, LIT = 255, BELOW = 200;   // 去過 / 看得到 / 從上一層往下看得到 的亮度（0～255）
export const makeFogU = () => ({ fogTex: { value: null }, fogOn: { value: 0 }, fogSize: { value: new THREE.Vector2(64, 48) }, fogDim: { value: 1 } });
export const fogU = makeFogU();
let on = false, L = null, layers = [], acc = 1, pc = 0, pr = 0;

// 讓材質吃迷霧（InstancedMesh 也可以）
export function fogMaterial(mat, U = fogU) {
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, U);
    sh.vertexShader = 'varying vec2 vFogXZ;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      vec4 fogP = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        fogP = instanceMatrix * fogP;
      #endif
      vFogXZ = (modelMatrix * fogP).xz;`);
    sh.fragmentShader = 'uniform sampler2D fogTex;\nuniform float fogOn;\nuniform float fogDim;\nuniform vec2 fogSize;\nvarying vec2 vFogXZ;\n' + sh.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>
      if (fogOn > 0.5) gl_FragColor.rgb *= texture2D(fogTex, (vFogXZ + fogSize * 0.5) / fogSize).r * fogDim;`);
  };
  mat.customProgramCacheKey = () => 'fog';
  return mat;
}

// 一層的迷霧：low = 1 層樓建築佔的格子（不擋視線）、edge = 不穿的格子、sight = 視線距離、g = 這層的格子
function makeLayer({ low = new Set(), edge = null, sight = RADIUS, g = grid, U = null } = {}) {
  const data = new Uint8Array(W * H);
  const tex = new THREE.DataTexture(data, W, H, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  U ??= makeFogU();
  U.fogTex.value = tex; U.fogOn.value = 1; U.fogSize.value.set(W, H);
  return { low, edge, sight, g, vis: new Uint8Array(W * H), seen: new Uint8Array(W * H), data, tex, U };
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
  const vis = L.vis, seen = L.seen, edge = L.edge, R = L.sight;
  vis.fill(0);
  const ox = x + W / 2, oz = z + H / 2;
  pc = Math.floor(ox); pr = Math.floor(oz);
  const N = 720;
  for (let k = 0; k < N; k++) {
    const a = k / N * Math.PI * 2, dx = Math.cos(a) * 0.5, dz = Math.sin(a) * 0.5;
    let px = ox, pz = oz, wall = -1;
    for (let s = 0; s <= R * 2; s++) {
      const c = Math.floor(px), r = Math.floor(pz);
      if (c < 0 || r < 0 || c >= W || r >= H) break;
      const i = r * W + c, b = s > 1 && blocksSight(i);
      if (wall >= 0 && (!b || edge?.[i] || s - wall > THROUGH * 2)) break;   // 穿出障礙物（或太厚、碰到邊緣那圈）：後面看不到
      vis[i] = 1; seen[i] = 1;
      if (b && wall < 0) { if (edge?.[i]) break; wall = s; }
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
