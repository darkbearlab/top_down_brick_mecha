// ---------- 設定（畫面） ----------
// 主選單、暫停選單的「設定」打開；分頁「畫面」：品質預設（高 / 中 / 低）+ 每一項各自調，最後是效能面板開關
// 存在 localStorage（brickmecha.gfx）；模型桌效果沿用 post.js 自己存的（O 鍵也能切）
// 沒列進來的（方塊明暗、碎片、焦痕、迷霧的視線多邊形）幾乎不花效能，就不給關
import { renderer, resize, scene, sun } from './core.js';
import { dioramaOn, setBloom, setDiorama, setMsaa, setTone } from './post.js';
import { setHazeLevel } from './haze.js';
import { setLightsOn } from './lights.js';
import { setHeightFogOn, setSurface } from './fog.js';
import { setPerfPanel } from './perf.js';
import { padCfg, setPadLayout } from './input.js';
import { setViewMode, setViewSens, setViewSmooth, view } from './camview.js';

const KEY = 'brickmecha.gfx';
// 每一項：選項（值、顯示文字）、說明（花在哪）
const ITEMS = [
  { k: 'scale', name: '解析度', opts: [[1, '100%'], [0.85, '85%'], [0.7, '70%'], [0.5, '50%']], note: '畫面實際算幾成的像素再放大；顯卡吃不消時最有效' },
  { k: 'msaa', name: '反鋸齒', opts: [[4, '4×'], [2, '2×'], [0, '關']], note: '方塊邊緣的鋸齒；倍數越高顯卡越累' },
  { k: 'shadow', name: '陰影', opts: [[2048, '高'], [1024, '中'], [0, '關']], note: '太陽的影子；每幀要從太陽方向多畫一次場景' },
  { k: 'tone', name: '色調映射', opts: [[true, '開'], [false, '關']], note: '火、爆炸、光束亮到溢出也不死白（ACES + AgX）；幾乎不花效能' },
  { k: 'surf', name: '材質細節', opts: [[true, '開'], [false, '關']], note: '地面、岩壁的大片色差、積灰、流痕和方塊邊緣的倒角亮邊；每個像素多算幾次雜訊' },
  { k: 'bloom', name: '泛光', opts: [[true, '開'], [false, '關']], note: '火、爆炸、發光方塊的光暈' },
  { k: 'lights', name: '動態光源', opts: [[true, '開'], [false, '關']], note: '爆炸、砲口、火焰照亮周圍；切換時會頓一下（重新編譯）' },
  { k: 'haze', name: '地面風沙', opts: [[2, '兩層'], [1, '一層'], [0, '關']], note: '貼地飄的薄霧；整個畫面每個像素都要算雜訊' },
  { k: 'hfog', name: '高度霧', opts: [[true, '開'], [false, '關']], note: '坑和下層的霧；幾乎不花效能' },
  { k: 'dio', name: '模型桌效果', opts: [[true, '開'], [false, '關']], note: '四角模糊、暗角、調色（O 鍵也能切）' },
];
const PRESETS = {
  high: { name: '高', v: { scale: 1, msaa: 4, shadow: 2048, tone: true, surf: true, bloom: true, lights: true, haze: 2, hfog: true, dio: true } },
  mid: { name: '中', v: { scale: 1, msaa: 2, shadow: 1024, tone: true, surf: true, bloom: true, lights: true, haze: 1, hfog: true, dio: true } },
  low: { name: '低', v: { scale: 0.7, msaa: 0, shadow: 1024, tone: true, surf: false, bloom: false, lights: false, haze: 0, hfog: true, dio: false } },
};
const S = { ...PRESETS.high.v, perf: false };
try { Object.assign(S, JSON.parse(localStorage.getItem(KEY)) ?? {}); } catch { /* 讀不到就用預設 */ }
S.dio = dioramaOn();
const save = () => { try { const { dio, ...rest } = S; localStorage.setItem(KEY, JSON.stringify(rest)); } catch { /* 存不了就算了 */ } };

let shadowNow = -1;
function apply(k) {
  const all = !k;
  if (all || k === 'scale') { renderer.setPixelRatio(Math.min(devicePixelRatio, 2) * S.scale); resize(); }
  if (all || k === 'msaa') setMsaa(S.msaa);
  if ((all || k === 'shadow') && shadowNow !== S.shadow) {
    const was = shadowNow > 0, now = S.shadow > 0;
    shadowNow = S.shadow;
    renderer.shadowMap.enabled = now; sun.castShadow = now;
    if (now) { sun.shadow.mapSize.set(S.shadow, S.shadow); sun.shadow.map?.dispose(); sun.shadow.map = null; }
    if (was !== now) scene.traverse(o => { for (const m of [o.material].flat()) if (m) m.needsUpdate = true; });   // 開關陰影：材質要重新編譯
  }
  if (all || k === 'tone') setTone(S.tone !== false);
  if (all || k === 'bloom') setBloom(S.bloom);
  if (all || k === 'lights') setLightsOn(S.lights);
  if (all || k === 'haze') setHazeLevel(S.haze);
  if (all || k === 'hfog') setHeightFogOn(S.hfog);
  if (all || k === 'surf') setSurface(S.surf !== false);
  if (k === 'dio') setDiorama(S.dio);
  if (all || k === 'perf') setPerfPanel(S.perf);
}
apply();

// ---------- 介面 ----------
const root = document.createElement('div');
root.id = 'settings'; root.className = 'hidden';
root.innerHTML = `<div class="sbox">
  <div class="shead"><b>設定</b><div class="stabs"><button class="on">畫面</button></div></div>
  <div class="sbody"></div>
  <div class="sfoot"><button class="btn primary" id="sDone">完成（Esc）</button></div>
</div>`;
document.body.appendChild(root);
const body = root.querySelector('.sbody');
let onClose = null;

const same = (a, b) => a === b;
function row(name, note, opts, cur, pick) {
  const r = document.createElement('div');
  r.className = 'srow';
  r.innerHTML = `<div class="sl"><b>${name}</b>${note ? `<small>${note}</small>` : ''}</div><div class="seg"></div>`;
  const seg = r.querySelector('.seg');
  for (const [v, label] of opts) {
    const b = document.createElement('button');
    b.textContent = label;
    if (same(v, cur)) b.className = 'on';
    b.onclick = () => { pick(v); render(); };
    seg.appendChild(b);
  }
  body.appendChild(r);
}
function render() {
  S.dio = dioramaOn();
  body.innerHTML = '';
  const preset = Object.keys(PRESETS).find(p => ITEMS.every(it => same(PRESETS[p].v[it.k], S[it.k])));
  row('品質預設', preset ? '' : '自訂', Object.entries(PRESETS).map(([p, P]) => [p, P.name]), preset, p => { Object.assign(S, PRESETS[p].v); apply(); setDiorama(S.dio); save(); });
  const sep = document.createElement('div'); sep.className = 'ssep'; body.appendChild(sep);
  for (const it of ITEMS) row(it.name, it.note, it.opts, S[it.k], v => { S[it.k] = v; apply(it.k); save(); });
  const sep2 = document.createElement('div'); sep2.className = 'ssep'; body.appendChild(sep2);
  row('效能面板', '左上角顯示 FPS、每幀 CPU / GPU 毫秒（60 FPS 的預算是 16.7 ms）', [[true, '顯示'], [false, '隱藏']], S.perf, v => { S.perf = v; apply('perf'); save(); });
  const sep3 = document.createElement('div'); sep3.className = 'ssep'; body.appendChild(sep3);
  row('鏡頭', view.mode === 'turn' ? '滑鼠鎖住：左右轉鏡頭和上半身、上下調瞄準遠近；WASD 照畫面方向走。點一下畫面開始、Esc 暫停並放開滑鼠' : '鏡頭固定朝北，游標指哪打哪', [['fixed', '固定'], ['turn', '滑鼠轉向']], view.mode, v => setViewMode(v));
  if (view.mode === 'turn') row('轉向靈敏度', '', [[0.6, '低'], [1, '中'], [1.5, '高'], [2.2, '很高']], view.sens, v => setViewSens(v));
  if (view.mode === 'turn') row('鏡頭緩衝', '鏡頭追上半身時起步和停下都放慢；越高越穩、越有重量感，但反應越慢', [[0, '低'], [1, '中'], [2, '高']], view.smooth, v => setViewSmooth(v));
  row('手把按鍵配置', padCfg.layout === 'nintendo' ? 'A（確認 / 互動）在右、B（取消）在下；Y 在左 = 切左邊武器、X 在上 = 切右邊' : 'A（確認 / 互動）在下、B（取消）在右；X 在左 = 切左邊武器、Y 在上 = 切右邊', [['xbox', 'Xbox'], ['nintendo', '任天堂']], padCfg.layout, v => setPadLayout(v));
}
export const settingsOpen = () => !root.classList.contains('hidden');
export function openSettings(then = null) { onClose = then; render(); root.classList.remove('hidden'); }
export function closeSettings() { root.classList.add('hidden'); const f = onClose; onClose = null; f?.(); }
root.querySelector('#sDone').onclick = closeSettings;
addEventListener('keydown', e => { if (e.code === 'KeyO' && settingsOpen()) setTimeout(render); });   // O 鍵切模型桌：面板上的按鈕跟著變
