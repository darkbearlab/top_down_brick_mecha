// ---------- 輸入：鍵盤滑鼠 / 手把（雙搖桿） ----------
// 主動裝置：R / 滑鼠中鍵；手把 Y / 按下右搖桿
// 鍵盤滑鼠：WASD 移動、滑鼠瞄準、左鍵 / 右鍵 = 左邊 / 右邊目前準備好的武器開火、Q / E = 左邊 / 右邊在手臂武器和背部武器之間切換、Space / Shift = 推進衝刺、G = 整備、F = 互動（遠征模式的箱子、武器、傳送門）
// 手把：左搖桿移動、右搖桿瞄準、LB / RB = 左右開火、RT = 推進衝刺、左邊的鍵 / 上面的鍵 = 左右切換手臂 / 背部武器、
//   確認 = 互動（選單裡按下）、取消 = 選單返回、LT / 按下右搖桿 = 主動裝置、Start = 暫停、Back = 整備
//   瀏覽器的標準手把是照「位置」編號的（0 下、1 右、2 左、3 上）：Xbox 配置 A 在下 B 在右；任天堂配置 A 在右 B 在下（padCfg.layout，設定裡切換）
// 輸出都是「螢幕方向」：x 往右、y 往下（= 世界的 +x、+z）
const DEAD = 0.2;

export const input = {
  source: 'mouse',            // 'mouse' | 'pad'
  move: { x: 0, y: 0 },
  mouse: { x: innerWidth / 2, y: innerHeight / 2, seen: false },
  look: { dx: 0, dy: 0 },     // 游標鎖住時（滑鼠轉向模式）：這一幀滑鼠移了多少（像素）
  locked: false,
  padAim: { x: 0, y: -1, active: false },
  fireL: false, fireR: false, readyL: false, readyR: false,   // readyL / R：這一幀按下切換
  boostPressed: false, techPressed: false, pausePressed: false, resetPressed: false, passivePressed: false, garagePressed: false, interactPressed: false,
};
// 手把按鍵配置：xbox（A 在下、B 在右）/ nintendo（A 在右、B 在下）；X / Y 切換武器照位置（左邊的切左、上面的切右），兩種配置一樣
const PAD_KEY = 'brickmecha.pad';
export const padCfg = { layout: 'xbox' };
try { Object.assign(padCfg, JSON.parse(localStorage.getItem(PAD_KEY)) ?? {}); } catch { /* 用預設 */ }
export function setPadLayout(v) { padCfg.layout = v; try { localStorage.setItem(PAD_KEY, JSON.stringify(padCfg)); } catch { /* 存不了就算了 */ } }
// 這一幀手把在選單裡的操作（padnav.js 用）：confirm / cancel 按下、nav 方向（十字鍵或左搖桿，按住會重複）
export const padUi = { confirm: false, cancel: false, nav: { x: 0, y: 0 }, present: false };
let navHold = 0, navDir = '';
const keys = new Set();
let mouseL = false, mouseR = false, padPrev = [];

addEventListener('mousemove', e => {
  input.source = 'mouse'; input.mouse.seen = true;
  if (input.locked) { input.look.dx += e.movementX; input.look.dy += e.movementY; return; }
  input.mouse.x = e.clientX; input.mouse.y = e.clientY;
});
document.addEventListener('pointerlockchange', () => { input.locked = !!document.pointerLockElement; input.look.dx = input.look.dy = 0; });
addEventListener('mousedown', e => {
  input.source = 'mouse'; input.mouse.seen = true;
  if (e.button === 0) mouseL = true;
  if (e.button === 2) mouseR = true;
  if (e.button === 1) { input.techPressed = true; e.preventDefault(); }
});
addEventListener('mouseup', e => {
  if (e.button === 0) mouseL = false;
  if (e.button === 2) mouseR = false;
});
addEventListener('contextmenu', e => e.preventDefault());
addEventListener('keydown', e => {
  keys.add(e.code);
  if (e.repeat) return;
  if (e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight') input.boostPressed = true;
  if (e.code === 'Escape' || e.code === 'KeyP') input.pausePressed = true;
  if (e.code === 'KeyR') { input.resetPressed = true; input.techPressed = true; }
  if (e.code === 'KeyT') input.passivePressed = true;
  if (e.code === 'KeyG') input.garagePressed = true;
  if (e.code === 'KeyF') input.interactPressed = true;
  if (e.code === 'KeyQ') input.readyL = true;
  if (e.code === 'KeyE') input.readyR = true;
  if (e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); mouseL = mouseR = false; });

const dz = v => Math.abs(v) < DEAD ? 0 : (v - Math.sign(v) * DEAD) / (1 - DEAD);

export function updateInput() {
  // 手把
  const pad = [...(navigator.getGamepads?.() ?? [])].find(p => p && p.connected);
  let px = 0, py = 0, ax = 0, ay = 0, padFireL = false, padFireR = false;
  padUi.present = !!pad; padUi.confirm = padUi.cancel = false; padUi.nav.x = padUi.nav.y = 0;
  if (pad) {
    px = dz(pad.axes[0] ?? 0); py = dz(pad.axes[1] ?? 0);
    ax = pad.axes[2] ?? 0; ay = pad.axes[3] ?? 0;
    const b = i => !!pad.buttons[i]?.pressed;
    const down = i => b(i) && !padPrev[i];
    const OK = padCfg.layout === 'nintendo' ? 1 : 0, NO = 1 - OK;
    padFireL = b(4); padFireR = b(5);
    if (down(2)) input.readyL = true;
    if (down(3)) input.readyR = true;
    if (down(7)) input.boostPressed = true;
    if (down(8)) input.garagePressed = true;
    if (down(9)) input.pausePressed = true;
    if (down(6) || down(11)) { input.resetPressed = true; input.techPressed = true; }
    padUi.confirm = down(OK); padUi.cancel = down(NO);
    // 選單方向：十字鍵或左搖桿；按住 0.35 秒後每 0.12 秒重複
    const nx = b(15) || px > 0.6 ? 1 : b(14) || px < -0.6 ? -1 : 0, ny = b(13) || py > 0.6 ? 1 : b(12) || py < -0.6 ? -1 : 0, key = `${nx},${ny}`;
    const now = performance.now();
    padUi.nav.x = padUi.nav.y = 0;
    if (key !== '0,0' && (key !== navDir || now >= navHold)) { padUi.nav.x = nx; padUi.nav.y = ny; navHold = now + (key !== navDir ? 350 : 120); }
    navDir = key;
    padPrev = pad.buttons.map(x => x.pressed);
    if (Math.hypot(px, py) > 0 || Math.hypot(ax, ay) > 0.35 || padFireL || padFireR || pad.buttons.some(x => x.pressed)) input.source = 'pad';
  }
  if (input.source === 'pad') {
    const m = Math.hypot(px, py);
    input.move.x = m > 1 ? px / m : px; input.move.y = m > 1 ? py / m : py;
    const am = Math.hypot(ax, ay);
    input.padAim.active = am > 0.35;
    if (am > 0.35) { input.padAim.x = ax / am; input.padAim.y = ay / am; }
    input.fireL = padFireL; input.fireR = padFireR;
  } else {
    let x = 0, y = 0;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) x -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) x += 1;
    if (keys.has('KeyW') || keys.has('ArrowUp')) y -= 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) y += 1;
    const d = Math.hypot(x, y) || 1;
    input.move.x = x / d; input.move.y = y / d;
    input.fireL = mouseL; input.fireR = mouseR;
  }
}
// 單次事件：每幀最後清掉
export function clearPressed() {
  input.boostPressed = input.techPressed = input.pausePressed = input.resetPressed = input.passivePressed = input.garagePressed = input.interactPressed = input.readyL = input.readyR = false;
  input.look.dx = input.look.dy = 0;
}
