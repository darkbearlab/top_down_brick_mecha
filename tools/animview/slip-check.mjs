// 量滑步：不開瀏覽器，用遊戲的模型 + 動作跑幾秒，算「腳掌著地時相對地面滑了多少」
//   先把檢視器組到 tools/sim/out/animview（src/ 原檔 + stub-core.js → src/core.js、stub-tech.js → src/tech.js），再跑：
//   node --import ./tools/sim/register.mjs tools/animview/slip-check.mjs
// 輸出每台、每種速度：滑動距離 ÷ 走過的距離（0% = 完全不滑）、腳在地上的時間比例
import * as THREE from 'three';
const { G } = await import('../sim/out/animview/src/core.js');
const { buildMechModel } = await import('../sim/out/animview/src/model.js');
const { computeSpec } = await import('../sim/out/animview/src/parts.js');
const { animMech } = await import('../sim/out/animview/src/anim.js');

const armor = { head: 'composite', torso: 'composite', arms: 'composite', legs: 'composite' };
const LO = {
  輕量: { head: 'std', core: 'light', legs: 'biped', armL: 'mg', armR: 'saber', backL: null, backR: null, armor },
  標準: { head: 'std', core: 'std', legs: 'biped', armL: 'autocannon', armR: 'shotgun', backL: 'missile', backR: 'rocket', armor },
  超載: { head: 'array', core: 'heavy', legs: 'biped', armL: 'shield', armR: 'lance', backL: 'cannon', backR: 'cannon', armor },
  逆關節: { head: 'std', core: 'light', legs: 'reverse', armL: 'sniper', armR: 'mg', backL: null, backR: 'vmissile', armor },
};
const DT = 1 / 60, v3 = new THREE.Vector3();
let id = 0;
function run(name, ml, secs = 4) {
  const lo = LO[name], M = buildMechModel(lo, { accent: 0x2aa8c8, glow: 0x7ff0ff }), S = computeSpec(lo);
  const m = { id: ++id, model: M, spec: S, parts: M.parts, guns: {}, k: 1, x: 0, z: 0, vx: 0, vz: 0, legYaw: Math.PI / 2, torsoYaw: Math.PI / 2, walk: 0, readyK: { L: 0, R: 0 } };
  const prev = [null, null];
  let slip = 0, dist = 0, ground = 0, tot = 0, lowest = Infinity;
  for (let t = 0; t < secs; t += DT) {
    // 加速到目標速度（跟遊戲一樣的加速度），之後等速
    const tv = S.vmax * ml, dv = tv - m.vx;
    m.vx += Math.sign(dv) * Math.min(Math.abs(dv), S.acc * DT);
    m.x += m.vx * DT;
    m.walk += DT * ml * 9 * (S.legs.type === 'reverse' ? 1.15 : 1);
    G.now += DT;
    M.root.position.set(m.x, 0, 0);
    M.legsG.rotation.y = m.legYaw;
    animMech(m, DT);
    M.root.updateMatrixWorld(true);
    M.rig.legs.forEach((L, j) => {
      L.ankle.getWorldPosition(v3);
      const h = v3.y - (L.ankleP.y - L.sole), p = prev[j];
      if (t > 1.5) {
        tot++; lowest = Math.min(lowest, h);
        if (p && h < 0.015 && p.h < 0.015) { slip += Math.hypot(v3.x - p.x, v3.z - p.z); ground++; }
      }
      prev[j] = { x: v3.x, z: v3.z, h };
    });
    if (t > 1.5) dist += Math.abs(m.vx) * DT;
  }
  return `${name} 速度 ${m.vx.toFixed(1)}：著地時滑動 ${(100 * slip / Math.max(dist * ground / Math.max(tot, 1) * 2, 1e-6)).toFixed(0)}%（滑 ${slip.toFixed(2)} 格 / 走 ${dist.toFixed(1)} 格）、每隻腳在地上 ${(100 * ground / tot).toFixed(0)}% 的時間、腳底最低 ${lowest.toFixed(3)}`;
}
for (const name of Object.keys(LO)) for (const ml of [1, 0.45]) console.log(run(name, ml));
