// ---------- 手把操作選單 ----------
// 有選單 / 面板開著的時候：十字鍵（或左搖桿）在按鈕之間移動、確認鍵按下、取消鍵返回
// 哪個選單：照優先順序找第一個看得到的（設定 > 對話面板 > 重組 > 整備 > 對戰設定 > 主選單）
// 移動：往那個方向、最近的按鈕（主軸距離 + 2 倍的側向偏移）；一開始停在主要按鈕（.primary）上
// 取消：那個選單裡有「返回 / 取消 / 先不要 / 繼續 / 完成」之類的按鈕就按它，不然當作按了 Esc
import { input, padUi } from './input.js';

const LAYERS = ['settings', 'panel', 'reasm', 'garage', 'duel', 'menu'];
const FOCUSABLE = 'button, .card, select';
const BACK = /返回|取消|先不要|繼續|完成|關閉/;
let focus = null;

function activeLayer() {
  for (const id of LAYERS) { const el = document.getElementById(id); if (el && !el.classList.contains('hidden') && el.getClientRects().length) return el; }
  return null;
}
const items = root => [...root.querySelectorAll(FOCUSABLE)].filter(el => !el.disabled && el.getClientRects().length);   // 有畫出來的（display: none 的沒有 rect）
function setFocus(el) {
  focus?.classList.remove('padfocus');
  focus = el;
  if (el) { el.classList.add('padfocus'); el.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }); }
}
function move(list, dx, dy) {
  const r0 = focus.getBoundingClientRect(), cx = r0.left + r0.width / 2, cy = r0.top + r0.height / 2;
  let best = null, bs = Infinity;
  for (const el of list) {
    if (el === focus) continue;
    const r = el.getBoundingClientRect(), ex = r.left + r.width / 2 - cx, ey = r.top + r.height / 2 - cy;
    const along = dx ? ex * dx : ey * dy, side = dx ? Math.abs(ey) : Math.abs(ex);
    if (along <= 2) continue;
    const sc = along + side * 2;
    if (sc < bs) { bs = sc; best = el; }
  }
  if (best) setFocus(best);
}

// 每幀呼叫；回傳 true = 有選單開著（手把的確認鍵拿來按按鈕，不當遊戲裡的互動）
export function updatePadNav() {
  const root = activeLayer();
  if (!root) { setFocus(null); return false; }
  if (!padUi.present) return true;
  const list = items(root);
  if (!list.length) return true;
  if (!focus || !list.includes(focus)) {
    if (!(padUi.confirm || padUi.cancel || padUi.nav.x || padUi.nav.y) && input.source !== 'pad') { setFocus(null); return true; }   // 沒在用手把：不顯示焦點框
    setFocus(list.find(el => el.classList.contains('primary')) ?? list[0]);
    if (padUi.nav.x || padUi.nav.y) return true;   // 第一下只是叫出焦點框
  }
  if (padUi.nav.x || padUi.nav.y) move(list, padUi.nav.y ? 0 : padUi.nav.x, padUi.nav.y);
  if (padUi.confirm) focus.click();
  else if (padUi.cancel) {
    const back = list.find(el => BACK.test(el.textContent));
    if (back) back.click(); else input.pausePressed = true;
  }
  return true;
}
