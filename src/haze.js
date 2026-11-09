// ---------- 地面的風沙薄霧 ----------
// 兩片貼著地面的大平面（低的一片 y = 0.12、高一點的 y = 0.5），跟著鏡頭走；花紋用世界座標的雜訊（不會跟著鏡頭滑），隨時間往風向飄
// 半透明、不寫深度：機體的腳、牆腳被薄薄蓋一層；沒去過的地方（迷霧全黑）不畫；懸空的格子上面也照畫（看下去像有霧從坑裡飄過）
// setHaze(color, amount) 換顏色和濃度（每種地形 / 每層可以不一樣；amount = 0 關掉）
import * as THREE from 'three';
import { scene } from './core.js';
import { fogU } from './fog.js';

const SIZE = 70;
const U = {
  t: { value: 0 }, color: { value: new THREE.Color(0xb8a482) }, amount: { value: 0.16 },
  wind: { value: new THREE.Vector2(0.55, 0.22) },
};
const VERT = `varying vec2 vXZ;
  void main() { vec4 w = modelMatrix * vec4(position, 1.0); vXZ = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const FRAG = `uniform float t, amount, scale, speed, fogOn, fogDim; uniform vec3 color; uniform vec2 wind, fogSize; uniform sampler2D fogTex;
  varying vec2 vXZ;
  float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
  float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { v += a * n(p); p = p * 2.03 + 17.1; a *= 0.5; } return v; }
  void main() {
    vec2 p = vXZ * scale - wind * t * speed;
    // 大塊的雲 × 細的條紋（被風拉長）
    float big = fbm(p * 0.35 + vec2(0.0, t * 0.02)), streak = fbm(vec2(p.x * 0.6, p.y * 1.8) - wind * t * speed * 0.6);
    float a = smoothstep(0.38, 0.85, big * 0.65 + streak * 0.5) * amount;
    if (fogOn > 0.5) a *= texture2D(fogTex, (vXZ + fogSize * 0.5) / fogSize).r * fogDim;
    gl_FragColor = vec4(color, a);
    #include <colorspace_fragment>
  }`;
function layer(y, scale, speed, k) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { ...U, ...fogU, amount: { get value() { return U.amount.value * k; } }, scale: { value: scale }, speed: { value: speed } },
    vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(SIZE, SIZE), mat);
  m.rotation.x = -Math.PI / 2; m.position.y = y; m.renderOrder = 2; m.frustumCulled = false;
  scene.add(m);
  return m;
}
const planes = [layer(0.12, 0.22, 1.0, 1), layer(0.5, 0.16, 1.6, 0.6)];

export function setHaze(hex, amount) { U.color.value.setHex(hex); U.amount.value = amount; for (const m of planes) m.visible = amount > 0; }
export function updateHaze(dt, cx, cz) {
  U.t.value += dt;
  for (const m of planes) m.position.set(cx, m.position.y, cz);
}
