// ---------- 小地圖（遠征模式） ----------
// 右上角。地圖先整張畫一次（岩壁、建築、泥地、空地），沒去過的地方蓋黑：有迷霧（fog.js）就照迷霧「看過的格子」，不然玩家周圍 REVEAL 格內會慢慢揭開
// 上面畫：玩家（白色箭頭）、發現過的遭遇點（紅圈 = 還在、灰叉 = 清掉了）、交戰中的敵機（紅點）、
//   揭開的地方裡的箱子（紫 = 補給箱、黃 = 武器箱、灰 = 開過了）、傳送門（菱形，看過或條件達成後才標）
import { H, W, grid, tileC, tileR } from './arena.js';
import { props } from './props.js';
import { exploredAt, fogSeen } from './fog.js';

const el = document.getElementById('minimap');
const g = el.getContext('2d');
const CELL = 4, REVEAL = 26;   // 揭開的解析度（格）、半徑（格）
let base = null, seen = null, sc = 1, CW = 0, CH = 0, acc = 0, fogC = null, fogImg = null;

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
  fogC = document.createElement('canvas'); fogC.width = W; fogC.height = H;
  fogImg = fogC.getContext('2d').createImageData(W, H);
  el.classList.remove('hidden');
}
export function revealAll() { seen?.fill(1); }   // 除錯用
export function hideMinimap() { el.classList.add('hidden'); base = null; }

export function updateMinimap(dt, player, enemies, squads, ex = null) {
  if (!base) return;
  // 揭開
  const pc = tileC(player.x) / CELL, pr = tileR(player.z) / CELL, rr = REVEAL / CELL;
  for (let y = Math.floor(pr - rr); y <= pr + rr; y++) for (let x = Math.floor(pc - rr); x <= pc + rr; x++)
    if (x >= 0 && y >= 0 && x < CW && y < CH && Math.hypot(x + 0.5 - pc, y + 0.5 - pr) <= rr) seen[y * CW + x] = 1;
  if ((acc += dt) < 0.1) return;   // 一秒畫十次就夠
  acc = 0;
  g.imageSmoothingEnabled = false;
  g.drawImage(base, 0, 0, el.width, el.height);
  const fs = fogSeen();
  if (fs) {
    const d = fogImg.data;
    for (let i = 0; i < fs.length; i++) { d[i * 4] = 7; d[i * 4 + 1] = 8; d[i * 4 + 2] = 11; d[i * 4 + 3] = fs[i] ? 0 : 255; }
    fogC.getContext('2d').putImageData(fogImg, 0, 0);
    g.drawImage(fogC, 0, 0, el.width, el.height);
  } else g.fillStyle = '#07080b';
  if (!fs) for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) if (!seen[y * CW + x]) g.fillRect(Math.floor(x * CELL * sc), Math.floor(y * CELL * sc), Math.ceil(CELL * sc) + 1, Math.ceil(CELL * sc) + 1);
  const P = (x, z) => [(x + W / 2) * sc, (z + H / 2) * sc];
  for (const S of squads) {
    if (!S.found) continue;
    const [x, y] = P(S.x, S.z);
    g.lineWidth = 1.5;
    if (S.cleared) { g.strokeStyle = '#6a6e78'; g.beginPath(); g.moveTo(x - 3, y - 3); g.lineTo(x + 3, y + 3); g.moveTo(x + 3, y - 3); g.lineTo(x - 3, y + 3); g.stroke(); }
    else { g.strokeStyle = S.awake ? '#ff5040' : '#d07050'; g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.stroke(); }
  }
  if (ex) {
    const seenAt = (x, z) => { const c = Math.floor(tileC(x) / CELL), r = Math.floor(tileR(z) / CELL); return seen[r * CW + c]; };
    for (const p of props) {
      if (p.kind === 'portal' || !(fs ? exploredAt(p.x, p.z) : seenAt(p.x, p.z))) continue;
      const [x, y] = P(p.x, p.z);
      g.fillStyle = p.used ? '#5a5e66' : p.kind === 'cache' ? '#c080ff' : p.kind === 'station' ? '#60ff90' : '#ffd060';
      g.fillRect(x - 2, y - 2, 4, 4);
    }
    if (ex.portalKnown) {
      const [x, y] = P(ex.portal.x, ex.portal.z);
      g.fillStyle = { idle: '#a04030', ready: '#ff9030', boss: '#ff3020', open: '#60f0ff' }[ex.portal.state];
      g.beginPath(); g.moveTo(x, y - 5); g.lineTo(x + 5, y); g.lineTo(x, y + 5); g.lineTo(x - 5, y); g.fill();
    }
  }
  g.fillStyle = '#ff5040';
  for (const e of enemies) if (e.alive && !e.dormant && e.fogVis !== false) { const [x, y] = P(e.x, e.z); g.fillRect(x - 1.5, y - 1.5, 3, 3); }
  const [x, y] = P(player.x, player.z), a = player.torsoYaw;
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.moveTo(x + Math.sin(a) * 5, y + Math.cos(a) * 5);
  g.lineTo(x + Math.sin(a + 2.5) * 3.5, y + Math.cos(a + 2.5) * 3.5);
  g.lineTo(x + Math.sin(a - 2.5) * 3.5, y + Math.cos(a - 2.5) * 3.5);
  g.fill();
}
