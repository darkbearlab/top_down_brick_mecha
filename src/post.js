// ---------- 後製 ----------
// 先把場景畫進一張貼圖（半精度浮點，亮的東西可以超過 1），再用全畫面的著色器貼回螢幕：
//   泛光（一直開）：比 BLOOM_TH 亮的部分（火、爆炸、發光方塊、能量武器、雷射）縮小、糊開、加回去 → 溢出光暈
//   模型桌效果（O 鍵開關，記在 localStorage；網址 ?flat = 預設關）：
//     移軸：只有四個角落糊（畫面正上下左右都清楚，不干擾看敵人）　暗角：四個角落稍微壓暗　調色：飽和度稍微拉高、暗部帶一點冷色
import * as THREE from 'three';
import { renderer } from './core.js';
import { flushVoxBodies } from './voxbody.js';

const KEY = 'brickmecha.diorama';
let on = !/[?&]flat\b/.test(location.search);
try { const v = localStorage.getItem(KEY); if (v != null) on = v === '1'; } catch { /* 讀不到就用預設 */ }

const BLOOM_TH = 1.0, BLOOM_KNEE = 0.5, BLOOM_K = 0.75;   // 多亮開始發光、門檻的柔和範圍、光暈強度
const size = new THREE.Vector2();
const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
let bloomOn = true;
// 泛光用：1/4 解析度兩張來回糊
const half = () => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false });
const bA = half(), bB = half();

const VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const pass = (uniforms, frag) => new THREE.ShaderMaterial({ uniforms, vertexShader: VERT, fragmentShader: frag, depthTest: false, depthWrite: false });
// 取亮部（4 點平均順便縮小）
const brightMat = pass({ tex: { value: rt.texture }, px: { value: new THREE.Vector2() }, th: { value: BLOOM_TH }, knee: { value: BLOOM_KNEE } }, `
  uniform sampler2D tex; uniform vec2 px; uniform float th, knee; varying vec2 vUv;
  void main() {
    vec3 c = (texture2D(tex, vUv + px * vec2(-1.0, -1.0)).rgb + texture2D(tex, vUv + px * vec2(1.0, -1.0)).rgb
            + texture2D(tex, vUv + px * vec2(-1.0, 1.0)).rgb + texture2D(tex, vUv + px * vec2(1.0, 1.0)).rgb) * 0.25;
    float l = max(c.r, max(c.g, c.b));
    float s = clamp(l - th + knee, 0.0, 2.0 * knee); s = s * s / (4.0 * knee + 1e-4);
    gl_FragColor = vec4(c * max(s, l - th) / max(l, 1e-4), 1.0);
  }`);
// 9 點高斯（方向 dir）
const blurMat = pass({ tex: { value: null }, dir: { value: new THREE.Vector2() } }, `
  uniform sampler2D tex; uniform vec2 dir; varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tex, vUv).rgb * 0.227;
    c += (texture2D(tex, vUv + dir * 1.385).rgb + texture2D(tex, vUv - dir * 1.385).rgb) * 0.316;
    c += (texture2D(tex, vUv + dir * 3.231).rgb + texture2D(tex, vUv - dir * 3.231).rgb) * 0.070;
    gl_FragColor = vec4(c, 1.0);
  }`);
const mat = pass({ tex: { value: rt.texture }, bloom: { value: bA.texture }, bloomK: { value: BLOOM_K }, px: { value: new THREE.Vector2() }, band: { value: 1.08 }, blur: { value: 3.2 }, dio: { value: 1 } }, `
  uniform sampler2D tex, bloom; uniform vec2 px; uniform float band, blur, dio, bloomK;
  varying vec2 vUv;
  void main() {
    // 只有四個角落糊：離中心的距離（邊的中點 = 1、角落 ≈ 1.41）超過 band 才開始糊，正上下左右都清楚
    vec2 e = (vUv - 0.5) * 2.0;
    float k = dio * smoothstep(band, band + 0.3, length(e));
    vec3 c = texture2D(tex, vUv).rgb;
    if (k > 0.001) {
      // 16 點圓盤取樣（黃金角螺旋）
      vec3 acc = c; float w = 1.0;
      for (int i = 1; i < 16; i++) {
        float fi = float(i), r = sqrt(fi / 15.0), a = fi * 2.39996;
        acc += texture2D(tex, vUv + vec2(cos(a), sin(a)) * r * k * blur * px).rgb; w += 1.0;
      }
      c = acc / w;
    }
    c += texture2D(bloom, vUv).rgb * bloomK;
    if (dio > 0.5) {
      // 飽和度 +12%、暗部偏冷一點
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, 1.12);
      c += vec3(-0.004, 0.0, 0.01) * (1.0 - smoothstep(0.0, 0.25, l));
      // 暗角
      c *= 1.0 - 0.38 * smoothstep(0.32, 0.85, length((vUv - 0.5) * vec2(1.1, 1.0)));
    }
    gl_FragColor = vec4(max(c, 0.0), 1.0);
    #include <colorspace_fragment>
  }`);
const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
quad.frustumCulled = false;
const postScene = new THREE.Scene(), postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
postScene.add(quad);
function draw(m, target) { quad.material = m; renderer.setRenderTarget(target); renderer.render(postScene, postCam); }

export const dioramaOn = () => on;
// 設定（src/settings.js）：泛光開關、反鋸齒取樣數（0 / 2 / 4）
export function setBloom(v) { bloomOn = v; }
export function setMsaa(n) { if (rt.samples !== n) { rt.samples = n; rt.dispose(); } }
export function setDiorama(v) {
  on = v;
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* 存不了就算了 */ }
}
// 取代 renderer.render(scene, camera)
export function renderFrame(scene, camera) {
  flushVoxBodies();   // 這一幀被打掉 / 補回的機體方塊：重建網格
  renderer.getDrawingBufferSize(size);
  if (rt.width !== size.x || rt.height !== size.y) {
    rt.setSize(size.x, size.y);
    const w = Math.max(1, size.x >> 2), h = Math.max(1, size.y >> 2);
    bA.setSize(w, h); bB.setSize(w, h);
  }
  renderer.setRenderTarget(rt);
  renderer.render(scene, camera);
  // 泛光：取亮部 → 橫糊 → 直糊 → 再一輪寬一點的
  brightMat.uniforms.px.value.set(1.5 / size.x, 1.5 / size.y);   // 線性取樣 ×4 點 ≈ 涵蓋 4×4 像素
  if (bloomOn) {
    draw(brightMat, bA);
    const bw = 1 / bA.width, bh = 1 / bA.height;
    for (const r of [1, 2]) {
      blurMat.uniforms.tex.value = bA.texture; blurMat.uniforms.dir.value.set(bw * r, 0); draw(blurMat, bB);
      blurMat.uniforms.tex.value = bB.texture; blurMat.uniforms.dir.value.set(0, bh * r); draw(blurMat, bA);
    }
  }
  mat.uniforms.bloomK.value = bloomOn ? BLOOM_K : 0;
  // 合成到螢幕（模糊半徑照螢幕高度縮放）
  mat.uniforms.px.value.set(1 / size.x, 1 / size.y).multiplyScalar(size.y / 360);
  mat.uniforms.dio.value = on ? 1 : 0;
  draw(mat, null);
}
addEventListener('keydown', e => { if (e.code === 'KeyO' && !e.repeat) setDiorama(!on); });
