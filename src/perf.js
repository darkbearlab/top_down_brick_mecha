// ---------- 效能面板 ----------
// 左上角一小塊：FPS、每幀 CPU 毫秒（整個 frame 函式：遊戲邏輯 + 送出繪圖指令）、GPU 毫秒（顯卡實際畫的時間）、繪圖呼叫數、三角形數
// GPU 時間用 EXT_disjoint_timer_query_webgl2（有些瀏覽器 / 顯卡沒開，就顯示「—」）；結果晚幾幀才拿得到，所以排隊等
// 一幀的預算：60 FPS = 16.7 ms；CPU 或 GPU 哪個超過預算，FPS 就掉
import { renderer } from './core.js';

const gl = renderer.getContext();
const ext = gl.getExtension('EXT_disjoint_timer_query_webgl2');
let on = false, el = null, t0 = 0, q = null;
const pending = [];
const acc = { n: 0, cpu: 0, gpu: 0, gn: 0, time: 0, calls: 0, tris: 0 };
renderer.info.autoReset = false;   // 一幀裡畫好幾次（迷霧遮罩、後製），自己在每幀開頭歸零

export function setPerfPanel(v) {
  on = v;
  if (v && !el) {
    el = document.createElement('div');
    el.id = 'perf';
    document.body.appendChild(el);
  }
  el?.classList.toggle('hidden', !v);
}
export function perfBegin() {
  renderer.info.reset();
  if (!on) return;
  t0 = performance.now();
  if (ext && !q) { q = gl.createQuery(); gl.beginQuery(ext.TIME_ELAPSED_EXT, q); }
}
export function perfEnd(dtMs) {
  if (!on) return;
  acc.cpu += performance.now() - t0; acc.n++; acc.time += dtMs;
  acc.calls += renderer.info.render.calls; acc.tris += renderer.info.render.triangles;
  if (q) { gl.endQuery(ext.TIME_ELAPSED_EXT); pending.push(q); q = null; }
  while (pending.length && gl.getQueryParameter(pending[0], gl.QUERY_RESULT_AVAILABLE)) {
    const p = pending.shift();
    if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) { acc.gpu += gl.getQueryParameter(p, gl.QUERY_RESULT) / 1e6; acc.gn++; }
    gl.deleteQuery(p);
  }
  if (pending.length > 8) gl.deleteQuery(pending.shift());
  if (acc.time < 500) return;
  // 每半秒更新一次數字
  const fps = acc.n * 1000 / acc.time, cpu = acc.cpu / acc.n, gpu = acc.gn ? acc.gpu / acc.gn : null;
  const c = v => v == null ? '' : v > 16.7 ? 'bad' : v > 11 ? 'warn' : 'ok';
  el.innerHTML = `<b class="${fps < 50 ? 'bad' : fps < 58 ? 'warn' : 'ok'}">${fps.toFixed(0)} FPS</b>`
    + `<span>CPU <i class="${c(cpu)}">${cpu.toFixed(1)} ms</i></span>`
    + `<span>GPU <i class="${c(gpu)}">${gpu == null ? '—' : gpu.toFixed(1) + ' ms'}</i></span>`
    + `<span>繪圖 ${Math.round(acc.calls / acc.n)} 次・${(acc.tris / acc.n / 1000).toFixed(0)}k 三角形</span>`
    + `<span class="dim">預算 16.7 ms（60 FPS）</span>`;
  Object.assign(acc, { n: 0, cpu: 0, gpu: 0, gn: 0, time: 0, calls: 0, tris: 0 });
}
