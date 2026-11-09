// ---------- 模型桌效果（後製） ----------
// 先把場景畫進一張貼圖，再用一個全畫面的著色器貼回螢幕：
//   移軸：只有四個角落糊（畫面正上下左右都清楚，不干擾看敵人），看起來像拍桌上的模型
//   暗角：四個角落稍微壓暗　調色：飽和度稍微拉高、暗部帶一點冷色
// O 鍵開關（記在 localStorage，只是個人偏好）；?flat 網址參數 = 預設關
import * as THREE from 'three';
import { renderer } from './core.js';

const KEY = 'brickmecha.diorama';
let on = !/[?&]flat\b/.test(location.search);
try { const v = localStorage.getItem(KEY); if (v != null) on = v === '1'; } catch { /* 讀不到就用預設 */ }

const size = new THREE.Vector2();
const rt = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
const mat = new THREE.ShaderMaterial({
  uniforms: { tex: { value: rt.texture }, px: { value: new THREE.Vector2() }, focusY: { value: 0.5 }, band: { value: 1.08 }, blur: { value: 3.2 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `
    uniform sampler2D tex; uniform vec2 px; uniform float focusY, band, blur;
    varying vec2 vUv;
    void main() {
      // 只有四個角落糊：離中心的距離（邊的中點 = 1、角落 ≈ 1.41）超過 band 才開始糊，正上下左右都清楚
      vec2 e = (vUv - 0.5) * 2.0;
      float k = smoothstep(band, band + 0.3, length(e));
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
      // 飽和度 +12%、暗部偏冷一點
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, 1.12);
      c += vec3(-0.004, 0.0, 0.01) * (1.0 - smoothstep(0.0, 0.25, l));
      // 暗角
      vec2 q = vUv - 0.5;
      c *= 1.0 - 0.38 * smoothstep(0.32, 0.85, length(q * vec2(1.1, 1.0)));
      gl_FragColor = vec4(max(c, 0.0), 1.0);
      #include <colorspace_fragment>
    }`,
  depthTest: false, depthWrite: false,
});
const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
quad.frustumCulled = false;
const postScene = new THREE.Scene(), postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
postScene.add(quad);

export const dioramaOn = () => on;
export function setDiorama(v) {
  on = v;
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* 存不了就算了 */ }
}
// 取代 renderer.render(scene, camera)
export function renderFrame(scene, camera) {
  if (!on) { renderer.render(scene, camera); return; }
  renderer.getDrawingBufferSize(size);
  if (rt.width !== size.x || rt.height !== size.y) rt.setSize(size.x, size.y);
  // 模糊半徑照螢幕高度縮放（1080p 時約 blur 個像素 × 3）
  mat.uniforms.px.value.set(1 / size.x, 1 / size.y).multiplyScalar(size.y / 360);
  renderer.setRenderTarget(rt);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  renderer.render(postScene, postCam);
}
addEventListener('keydown', e => { if (e.code === 'KeyO' && !e.repeat) setDiorama(!on); });
