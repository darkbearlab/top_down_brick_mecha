// ---------- 小地圖（遠征模式） ----------
// 右上角。地圖先整張畫一次（岩壁、建築、泥地、空地），沒去過的地方蓋黑：有迷霧（fog.js）就照迷霧「看過的格子」，不然玩家周圍 REVEAL 格內會慢慢揭開
// 圓形，只畫以玩家為中心直徑 VW 格的範圍（看不出自己在整張地圖的哪裡、邊在哪）；傳送門在範圍外就貼在圓邊上指方向
// 上面畫：玩家（白色箭頭）、發現過的遭遇點（紅圈 = 還在、灰叉 = 清掉了）、交戰中的敵機（紅點）、
//   揭開的地方裡的箱子（紫 = 補給箱、黃 = 武器箱、灰 = 開過了）、傳送門（菱形，看過或條件達成後才標；在別層 = 空心）
// 多層地圖：每層一張底圖（setMinimapLayer 換），懸空的地方畫成深藍灰；連接點畫成三角形（青色朝上 = 往上、橘色朝下 = 往下）
import { H, W, grid, tileC, tileR } from './arena.js';
import { props } from './props.js';
import { exploredAt, fogSeen } from './fog.js';

const el = document.getElementById('minimap');
const g = el.getContext('2d');
const CELL = 4, REVEAL = 26;   // 揭開的解析度（格）、半徑（格）
const VW = 76, VH = 76;         // 小地圖看得到的範圍（格；圓形，直徑 76 格）
let base = null, bases = [], seen = null, sc = 1, CW = 0, CH = 0, acc = 0, fogC = null, fogImg = null;

// list：每層 { grid, buildings }（不給 grid = 目前的）
export function initMinimap(list) {
  el.width = el.height = 190;
  sc = el.width / VW;
  bases = list.map(({ grid: gg = grid, buildings, under }) => {
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const b = cv.getContext('2d'), img = b.createImageData(W, H), k = under ? 0.7 : 1;
    const put = (c, r, [R, G, B]) => { const i = (r * W + c) * 4; img.data[i] = R * k; img.data[i + 1] = G * k; img.data[i + 2] = B * k; img.data[i + 3] = 255; };
    for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
      const t = gg[r][c];
      put(c, r, t === '#' ? [92, 80, 66] : t === 'v' ? [16, 20, 30] : t === 'm' ? [70, 54, 38] : t === 'd' ? [44, 42, 38] : [36, 40, 48]);
    }
    for (const [c0, r0, w, h] of buildings) for (let r = r0; r < r0 + h; r++) for (let c = c0; c < c0 + w; c++) put(c, r, [140, 146, 158]);
    b.putImageData(img, 0, 0);
    return cv;
  });
  base = bases[0];
  CW = Math.ceil(W / CELL); CH = Math.ceil(H / CELL);
  seen = new Uint8Array(CW * CH);
  fogC = document.createElement('canvas'); fogC.width = W; fogC.height = H;
  fogImg = fogC.getContext('2d').createImageData(W, H);
  el.classList.remove('hidden');
}
export function revealAll() { seen?.fill(1); }   // 除錯用
export function hideMinimap() { el.classList.add('hidden'); base = null; bases = []; }
export function setMinimapLayer(k) { if (bases[k]) base = bases[k]; }

export function updateMinimap(dt, player, enemies, squads, ex = null) {
  if (!base) return;
  // 揭開
  const pc = tileC(player.x) / CELL, pr = tileR(player.z) / CELL, rr = REVEAL / CELL;
  for (let y = Math.floor(pr - rr); y <= pr + rr; y++) for (let x = Math.floor(pc - rr); x <= pc + rr; x++)
    if (x >= 0 && y >= 0 && x < CW && y < CH && Math.hypot(x + 0.5 - pc, y + 0.5 - pr) <= rr) seen[y * CW + x] = 1;
  if ((acc += dt) < 0.1) return;   // 一秒畫十次就夠
  acc = 0;
  g.imageSmoothingEnabled = false;
  // 範圍：以玩家為中心（格座標）；超出地圖的地方是黑的
  const x0 = player.x + W / 2 - VW / 2, y0 = player.z + H / 2 - VH / 2;
  const crop = img => {
    const sx = Math.max(0, x0), sy = Math.max(0, y0), ex = Math.min(W, x0 + VW), ey = Math.min(H, y0 + VH);
    if (ex > sx && ey > sy) g.drawImage(img, sx, sy, ex - sx, ey - sy, (sx - x0) * sc, (sy - y0) * sc, (ex - sx) * sc, (ey - sy) * sc);
  };
  g.fillStyle = '#07080b'; g.fillRect(0, 0, el.width, el.height);
  g.save(); g.beginPath(); g.arc(el.width / 2, el.height / 2, el.width / 2, 0, Math.PI * 2); g.clip();   // 圓形
  crop(base);
  const fs = fogSeen();
  if (fs) {
    const d = fogImg.data;
    for (let i = 0; i < fs.length; i++) { d[i * 4] = 7; d[i * 4 + 1] = 8; d[i * 4 + 2] = 11; d[i * 4 + 3] = fs[i] ? 0 : 255; }
    fogC.getContext('2d').putImageData(fogImg, 0, 0);
    crop(fogC);
  } else g.fillStyle = '#07080b';
  if (!fs) for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) if (!seen[y * CW + x]) g.fillRect(Math.floor((x * CELL - x0) * sc), Math.floor((y * CELL - y0) * sc), Math.ceil(CELL * sc) + 1, Math.ceil(CELL * sc) + 1);
  const P = (x, z) => [(x + W / 2 - x0) * sc, (z + H / 2 - y0) * sc];
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
      if (p.kind === 'portal' || (ex.layer !== undefined && p.layer !== ex.layer) || !(fs ? exploredAt(p.x, p.z) : seenAt(p.x, p.z))) continue;
      const [x, y] = P(p.x, p.z);
      if (p.kind === 'link') {
        g.fillStyle = p.up ? '#60d0ff' : '#ffb040';
        const s = p.up ? -1 : 1;
        g.beginPath(); g.moveTo(x, y + 4 * s); g.lineTo(x + 4, y - 3 * s); g.lineTo(x - 4, y - 3 * s); g.fill();
        continue;
      }
      g.fillStyle = p.used ? '#5a5e66' : p.kind === 'cache' ? '#c080ff' : p.kind === 'station' ? '#60ff90' : p.kind === 'supply' ? '#ff9a30' : '#ffd060';
      g.fillRect(x - 2, y - 2, 4, 4);
    }
    if (ex.portalKnown) {
      // 範圍外：貼在框邊上（往傳送門的方向）
      let [x, y] = P(ex.portal.x, ex.portal.z);
      const cx = el.width / 2, cy = el.height / 2, dx = x - cx, dy = y - cy, k = Math.min(1, (cx - 8) / (Math.hypot(dx, dy) || 1e-6));
      x = cx + dx * k; y = cy + dy * k;
      g.fillStyle = { idle: '#a04030', ready: '#ff9030', boss: '#ff3020', open: '#60f0ff' }[ex.portal.state];
      g.beginPath(); g.moveTo(x, y - 5); g.lineTo(x + 5, y); g.lineTo(x, y + 5); g.lineTo(x - 5, y); g.closePath();
      if (ex.layer === undefined || ex.portal.layer === ex.layer) g.fill(); else { g.strokeStyle = g.fillStyle; g.lineWidth = 1.5; g.stroke(); }
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
  g.restore();
}
