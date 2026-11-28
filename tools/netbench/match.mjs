// 一場據點戰（全 AI，跟 tools/sim/conquest.mjs 同一套迴圈），給伺服器測試用：newMatch(seed) → { step(), S }
import './shim.mjs';
import { G } from '../../src/core.js';
import { loadMap } from '../../src/arena.js';
import { resetBuildings, setLayout, updateBuildings } from '../../src/buildings.js';
import { collideMechs, mechs, removeMech } from '../../src/mech.js';
import { clearShots, updateShots } from '../../src/weapons.js';
import { AI, DIFFS, clearMemory, enemies, stepMech } from '../../src/ai.js';
import { updateStatus } from '../../src/status.js';
import { clearWrecks, updateWrecks } from '../../src/wreck.js';
import { updateParticles } from '../../src/fx.js';
import { applyHeavy } from '../../src/heavy.js';
import { conquestArena } from '../../src/blockgen.js';
import * as C from '../../src/conquest.js';
import { updateDevices, clearDevices } from '../../src/devices.js';

export const DT = 1 / 60;
const mulberry = a => () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
let map = null;
const none = { x: 0, z: 0, alive: false, team: 'none' };
export function newMatch(seed = 1) {
  if (!map) { map = conquestArena(); loadMap(map); setLayout(map.buildings); applyHeavy(); AI.onEnemyDeath = e => C.conquestDeath(e); }
  Math.random = mulberry(seed * 9973);
  for (const m of mechs.slice()) removeMech(m);
  enemies.length = 0; clearDevices(); clearShots(); clearWrecks(); resetBuildings(); clearMemory();
  G.now = 0; G.paused = false; G.slowMo = 0; G.hitStop = 0;
  AI.passive = false; AI.sandbox = false; AI.diff = DIFFS.hard;
  C.startConquest(map, () => {});
  const S = C.cqState();
  function step() {
    G.now += DT;
    C.preUpdate(DT);
    for (const e of enemies) { if (!e.alive && !e.fall) continue; stepMech(e, DT, e.foe ?? none, C.postUpdate); }
    collideMechs(); updateShots(DT);
    for (const m of mechs.slice()) updateStatus(m, DT);
    updateWrecks(DT, DT); updateBuildings(DT); updateDevices(DT); updateParticles(DT);
    C.updateConquest(DT);
    for (let k = enemies.length - 1; k >= 0; k--) if (!enemies[k].alive && !enemies[k].fall && enemies[k].deadT == null) enemies[k].deadT = G.now; else if (enemies[k].deadT != null && G.now - enemies[k].deadT > 3) { removeMech(enemies[k]); enemies.splice(k, 1); }
    return S.result;
  }
  return { S, step, mechCount: () => mechs.length };
}
