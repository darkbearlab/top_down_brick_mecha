// ---------- 小地圖（探索模式） ----------
// 右上角。地圖先整張畫一次（岩壁、建築、泥地、空地），沒去過的地方蓋黑：玩家周圍 REVEAL 格內會慢慢揭開
// 上面畫：玩家（白色箭頭）、發現過的遭遇點（紅圈 = 還在、灰叉 = 清掉了）、交戰中的敵機（紅點）
import { H, W, grid, tileC, tileR } from './arena.js';

const el = document.getElementById('minimap');
const g = el.getContext('2d');
const CELL = 4, REVEAL = 26;   // 揭開的解析度（格）、半徑（格）
let base = null, seen = null, sc = 1, CW = 0, CH = 0, acc = 0;

export function initMinimap(buildings) {
  sc = Math.min(220 / W, 165 / H);
  el.width = Math.round(W * sc); el.height = Math.round(H * sc);
  base = document.createElement('canvas');
  base.width = W; base.height = H;
  const b = base.getContext('2d'), img = b.createImageData(W, H);
  const put = (c, r, [R, G, B]) => { const i = (r * W + c) * 4; img.data[i] = R; img.data[i + 1] = G; img.data[i + 2] = B; img.data[i + 3] = 255; };
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const t = grid[r][c];
    put(c, r, t === '#' ? [92, 80, 66] : t === 'm' ? [70, 54, 38] : t === 'd' ? [44, 42, 38] : [36, 40, 48]);
  }
  for (const [c0, r0, w, h] of buildings) for (let r = r0; r < r0 + h; r++) for (let c = c0; c < c0 + w; c++) put(c, r, [140, 146, 158]);
  b.putImageData(img, 0, 0);
  CW = Math.ceil(W / CELL); CH = Math.ceil(H / CELL);
  seen = new Uint8Array(CW * CH);
  el.classList.remove('hidden');
}
export function revealAll() { seen?.fill(1); }   // 除錯用
export function hideMinimap() { el.classList.add('hidden'); base = null; }

export function updateMinimap(dt, player, enemies, squads) {
  if (!base) return;
  // 揭開
  const pc = tileC(player.x) / CELL, pr = tileR(player.z) / CELL, rr = REVEAL / CELL;
  for (let y = Math.floor(pr - rr); y <= pr + rr; y++) for (let x = Math.floor(pc - rr); x <= pc + rr; x++)
    if (x >= 0 && y >= 0 && x < CW && y < CH && Math.hypot(x + 0.5 - pc, y + 0.5 - pr) <= rr) seen[y * CW + x] = 1;
  if ((acc += dt) < 0.1) return;   // 一秒畫十次就夠
  acc = 0;
  g.imageSmoothingEnabled = false;
  g.drawImage(base, 0, 0, el.width, el.height);
  g.fillStyle = '#07080b';
  for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) if (!seen[y * CW + x]) g.fillRect(Math.floor(x * CELL * sc), Math.floor(y * CELL * sc), Math.ceil(CELL * sc) + 1, Math.ceil(CELL * sc) + 1);
  const P = (x, z) => [(x + W / 2) * sc, (z + H / 2) * sc];
  for (const S of squads) {
    if (!S.found) continue;
    const [x, y] = P(S.x, S.z);
    g.lineWidth = 1.5;
    if (S.cleared) { g.strokeStyle = '#6a6e78'; g.beginPath(); g.moveTo(x - 3, y - 3); g.lineTo(x + 3, y + 3); g.moveTo(x + 3, y - 3); g.lineTo(x - 3, y + 3); g.stroke(); }
    else { g.strokeStyle = S.awake ? '#ff5040' : '#d07050'; g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.stroke(); }
  }
  g.fillStyle = '#ff5040';
  for (const e of enemies) if (e.alive && !e.dormant) { const [x, y] = P(e.x, e.z); g.fillRect(x - 1.5, y - 1.5, 3, 3); }
  const [x, y] = P(player.x, player.z), a = player.torsoYaw;
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.moveTo(x + Math.sin(a) * 5, y + Math.cos(a) * 5);
  g.lineTo(x + Math.sin(a + 2.5) * 3.5, y + Math.cos(a + 2.5) * 3.5);
  g.lineTo(x + Math.sin(a - 2.5) * 3.5, y + Math.cos(a - 2.5) * 3.5);
  g.fill();
}
