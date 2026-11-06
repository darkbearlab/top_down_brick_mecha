// ---------- 戰爭迷霧（遠征模式） ----------
// 視線：從玩家所在位置往四周打 720 條射線（每 0.5 格一步），碰到擋視線的格子就停（那一格本身算看得到），最遠 RADIUS 格
//   擋視線：'#'（岩壁、高的建築）；1 層樓的矮建築（掩體、廢墟的小屋）不擋視線、只擋子彈 —— 機體比它高
// 三種狀態：沒去過（全黑）、去過但現在看不到（變暗）、看得到（正常）；一秒算 10 次，亮度每幀慢慢過渡
// 畫法：地板、岩壁、建築、箱子的材質掛上 fogMaterial()，片段著色器依世界座標查一張每格一個像素的迷霧貼圖，把顏色乘上去
// 其他模式 fogOn = 0，不受影響
import * as THREE from 'three';
import { H, W, grid } from './arena.js';

export const RADIUS = 32;
const DIM = 80, LIT = 255;   // 去過 / 看得到 的亮度（0～255）
export const fogU = { fogTex: { value: null }, fogOn: { value: 0 }, fogSize: { value: new THREE.Vector2(64, 48) } };
let on = false, vis = null, seen = null, data = null, tex = null, low = null, acc = 1, pc = 0, pr = 0;

// 讓材質吃迷霧（InstancedMesh 也可以）
export function fogMaterial(mat) {
  mat.onBeforeCompile = sh => {
    Object.assign(sh.uniforms, fogU);
    sh.vertexShader = 'varying vec2 vFogXZ;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
      vec4 fogP = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        fogP = instanceMatrix * fogP;
      #endif
      vFogXZ = (modelMatrix * fogP).xz;`);
    sh.fragmentShader = 'uniform sampler2D fogTex;\nuniform float fogOn;\nuniform vec2 fogSize;\nvarying vec2 vFogXZ;\n' + sh.fragmentShader.replace('#include <dithering_fragment>', `#include <dithering_fragment>
      if (fogOn > 0.5) gl_FragColor.rgb *= texture2D(fogTex, (vFogXZ + fogSize * 0.5) / fogSize).r;`);
  };
  mat.customProgramCacheKey = () => 'fog';
  return mat;
}

// lowTiles：1 層樓建築佔的格子（不擋視線）
export function initFog(lowTiles) {
  on = true; low = lowTiles; acc = 1;
  vis = new Uint8Array(W * H); seen = new Uint8Array(W * H); data = new Uint8Array(W * H);
  tex?.dispose();
  tex = new THREE.DataTexture(data, W, H, THREE.RedFormat, THREE.UnsignedByteType);
  tex.magFilter = tex.minFilter = THREE.LinearFilter;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  fogU.fogTex.value = tex; fogU.fogOn.value = 1; fogU.fogSize.value.set(W, H);
}
export function fogOff() { on = false; fogU.fogOn.value = 0; }
export const fogActive = () => on;

const blocksSight = i => grid[(i / W) | 0][i % W] === '#' && !low.has(i);
function compute(x, z) {
  vis.fill(0);
  const ox = x + W / 2, oz = z + H / 2;
  pc = Math.floor(ox); pr = Math.floor(oz);
  const N = 720;
  for (let k = 0; k < N; k++) {
    const a = k / N * Math.PI * 2, dx = Math.cos(a) * 0.5, dz = Math.sin(a) * 0.5;
    let px = ox, pz = oz;
    for (let s = 0; s <= RADIUS * 2; s++) {
      const c = Math.floor(px), r = Math.floor(pz);
      if (c < 0 || r < 0 || c >= W || r >= H) break;
      const i = r * W + c;
      vis[i] = 1; seen[i] = 1;
      if (s > 1 && blocksSight(i)) break;
      px += dx; pz += dz;
    }
  }
}
export function updateFog(dt, x, z) {
  if (!on) return;
  if ((acc += dt) >= 0.1) { acc = 0; compute(x, z); }
  // 亮度往目標過渡（只看玩家附近：會變的格子都在視線半徑內）
  const R = RADIUS + 6, k = Math.min(1, dt * 8);
  for (let r = Math.max(0, pr - R); r < Math.min(H, pr + R); r++) for (let c = Math.max(0, pc - R); c < Math.min(W, pc + R); c++) {
    const i = r * W + c, want = vis[i] ? LIT : seen[i] ? DIM : 0;
    if (data[i] !== want) data[i] = Math.abs(want - data[i]) < 3 ? want : data[i] + (want - data[i]) * k;
  }
  tex.needsUpdate = true;
}
const idx = (x, z) => { const c = Math.floor(x + W / 2), r = Math.floor(z + H / 2); return c < 0 || r < 0 || c >= W || r >= H ? -1 : r * W + c; };
export const visibleAt = (x, z) => { if (!on) return true; const i = idx(x, z); return i >= 0 && vis[i] === 1; };
export const exploredAt = (x, z) => { if (!on) return true; const i = idx(x, z); return i >= 0 && seen[i] === 1; };
export const fogSeen = () => on ? seen : null;
