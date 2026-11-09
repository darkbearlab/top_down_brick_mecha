// ---------- 短命點光源 ----------
// 爆炸、砲口、火海、著火的殘骸亮一下照亮周圍（機體、地面、牆、煙都會被照到）
// 固定 LIGHT_N 盞一直掛在場景上，沒用的時候亮度 0：Three.js 的光源數量一變全部材質都要重新編譯（會卡），所以數量不能變
// 要新的光：挑「現在最暗」的那盞來用；全部都比新的亮就不搶（砲口火光搶不到爆炸的）
import * as THREE from 'three';
import { scene } from './core.js';

const LIGHT_N = 6;
const pool = [];
for (let i = 0; i < LIGHT_N; i++) {
  const L = new THREE.PointLight(0xffffff, 0, 8, 2);
  L.castShadow = false;
  scene.add(L);
  pool.push({ L, t: 0, dur: 0, I: 0, flick: 0 });
}
const cur = s => s.dur > 0 ? s.I * shape(s) : 0;
// 亮度曲線：一開始最亮，平方衰減；flick = 搖曳（火）
function shape(s) {
  const k = 1 - s.t / s.dur;
  return s.flick ? Math.min(1, k * 4) * (0.75 + 0.25 * Math.sin(s.t * 31 + s.flick) * Math.sin(s.t * 13)) : k * k;
}
// I：最亮時的強度（物理單位；1 格外大約 I 倍的直射光）；dist：照多遠；dur：幾秒；flick：火的搖曳
export function flashLight(x, y, z, color, I, dist, dur, flick = false) {
  let best = pool[0], bv = Infinity;
  for (const s of pool) { const v = cur(s); if (v < bv) { bv = v; best = s; } }
  if (bv > I) return;
  Object.assign(best, { t: 0, dur, I, flick: flick ? 1 + Math.random() * 10 : 0 });
  best.L.color.setHex(color);
  best.L.distance = dist;
  best.L.position.set(x, y, z);
  best.L.intensity = I;
}
export function updateLights(dt) {
  for (const s of pool) {
    if (s.dur <= 0) continue;
    s.t += dt;
    if (s.t >= s.dur) { s.dur = 0; s.L.intensity = 0; continue; }
    s.L.intensity = s.I * shape(s);
  }
}
export function clearLights() { for (const s of pool) { s.dur = 0; s.L.intensity = 0; } }
