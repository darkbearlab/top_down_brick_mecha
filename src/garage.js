// ---------- 整備（組裝機體） ----------
// G 開關；左邊選要換哪個部位，中間列出可以用的零件和數值，右邊是整台機體的數值與負重
// 改了馬上換到場上的機體上看得到；配裝存在瀏覽器裡
import { ARMORS, ARMOR_PARTS, CORES, DMG_TYPES, EFFECT, HEADS, HP_MUL, LEGS, SLOTS, SLOT_KEYS, SLOT_NAMES, WEAPONS, computeSpec, fireTime, saveLoadout } from './parts.js';
import { sfx } from './audio.js';

const $ = id => document.getElementById(id);
let lo = null, onChange = null, cat = 'head';
export const garage = { open: false };

const CATS = [
  ['head', '頭部'], ['core', '軀幹'], ['legs', '腳部'],
  ...SLOTS.map(s => [s, `${SLOT_NAMES[s]}（${SLOT_KEYS[s]}）`]),
  ...Object.keys(ARMOR_PARTS).map(k => ['armor.' + k, `裝甲・${ARMOR_PARTS[k]}`]),
];
const typeTag = t => `<span class="tag" style="--c:${DMG_TYPES[t].css}">${DMG_TYPES[t].name}</span>`;
const armorTag = a => `<span class="tag" style="--c:${ARMORS[a].css}">${ARMORS[a].name}</span>`;

function currentName(key) {
  if (key.startsWith('armor.')) return ARMORS[lo.armor[key.slice(6)]].name;
  if (key === 'head') return HEADS[lo.head].name;
  if (key === 'core') return CORES[lo.core].name;
  if (key === 'legs') return LEGS[lo.legs].name;
  return lo[key] ? WEAPONS[lo[key]].name : '（空）';
}

function options(key) {
  if (key.startsWith('armor.')) return Object.entries(ARMORS).map(([id, A]) => {
    const good = Object.keys(EFFECT).find(t => EFFECT[t][id] < 1), bad = Object.keys(EFFECT).find(t => EFFECT[t][id] > 1);
    return { id, name: A.name, html: `${armorTag(id)} 擋 ${typeTag(good)}・怕 ${typeTag(bad)}` };
  });
  if (key === 'head') return Object.entries(HEADS).map(([id, H]) => ({ id, name: H.name,
    html: `視野 ${H.vision}°・${H.range} 格・雷達 ${H.radar}<br>鎖定 ${H.lockCount} 台・${H.lockTime}s・${H.lockRange} 格${H.radarLock ? '・雷達鎖定（看不到也能鎖）' : ''}${H.intel ? '・敵情' : ''}<br>耐久 ${Math.round(H.hp * HP_MUL)}・重 ${H.weight}` }));
  if (key === 'core') return Object.entries(CORES).map(([id, C]) => ({ id, name: C.name,
    html: `耐久 ${Math.round(C.hp * HP_MUL)}・轉速 ${C.turn}<br>手臂負重 ${C.armLoad}・背部負重 ${C.backLoad}・重 ${C.weight}` }));
  if (key === 'legs') return Object.entries(LEGS).map(([id, L]) => ({ id, name: L.name,
    html: `極速 ${L.vmax}・加速 ${L.acc}・轉向 ${L.legTurn}<br>負重 ${L.maxLoad}・衝刺 ×${L.boost}・失衡門檻 ${L.stagger === Infinity ? '不會失衡' : L.stagger}・耐久 ${Math.round(L.hp * HP_MUL)}${L.type === 'tread' ? '<br>只能前後開＋旋轉' : L.type === 'hover' ? '<br>到處都滑、不怕泥地' : ''}` }));
  const mount = key.startsWith('arm') ? 'arm' : 'back';
  return [{ id: null, name: '（空）', html: '不裝武器' }, ...Object.entries(WEAPONS).filter(([, W]) => W.mount === mount).map(([id, W]) => ({ id, name: W.name,
    html: `${typeTag(W.type)} 傷害 ${W.dmg}${W.pellets ? '×' + W.pellets : W.salvo > 1 ? '×' + W.salvo : ''}・${(1 / W.interval).toFixed(1)} 發/秒<br>` +
      `${W.energy ? `能量 ${W.energy}/發・無彈藥限制` : `彈藥 ${W.ammo}・連射 ${Math.round(fireTime(W))} 秒（${fireTime(W) >= 35 ? '持久型' : '決戰型'}）`}・重 ${W.weight}${W.needLock ? '・需鎖定' : W.kind === 'missile' || W.kind === 'split' ? '・可追蹤' : ''}` }))];
}

function pick(key, id) {
  if (key.startsWith('armor.')) lo.armor[key.slice(6)] = id; else lo[key] = id;
  sfx.click();
  saveLoadout(lo);
  onChange?.(lo);
  render();
}

function bar(label, v, max, warn) {
  const k = Math.min(1, v / max);
  return `<div class="stat"><span>${label}</span><b class="${warn ? 'warn' : ''}">${v}/${max}</b><i><u style="width:${k * 100}%" class="${warn ? 'warn' : ''}"></u></i></div>`;
}
function render() {
  const S = computeSpec(lo);
  $('gCats').innerHTML = CATS.map(([k, n]) => `<button class="${k === cat ? 'on' : ''}" data-k="${k}"><span>${n}</span><small>${currentName(k)}</small></button>`).join('');
  const cur = cat.startsWith('armor.') ? lo.armor[cat.slice(6)] : lo[cat] ?? null;
  $('gOpts').innerHTML = options(cat).map(o => `<button class="${o.id === cur ? 'on' : ''}" data-id="${o.id ?? ''}"><b>${o.name}</b><small>${o.html}</small></button>`).join('');
  $('gStats').innerHTML =
    bar('總重量 / 腳部負重', S.total, S.legs.maxLoad, S.loadK > 1) +
    bar('手臂負重', S.armW, S.core.armLoad, S.armOver) +
    bar('背部負重', S.backW, S.core.backLoad, S.backOver) +
    `<div class="line">極速 <b>${S.vmax.toFixed(1)}</b>　加速 <b>${S.acc.toFixed(1)}</b>　衝刺 <b>×${S.boost.toFixed(2)}</b></div>` +
    `<div class="line">上半身轉速 <b>${S.turn.toFixed(1)}</b>　下半身轉速 <b>${S.legTurn.toFixed(1)}</b></div>` +
    `<div class="line">視野 <b>${S.head.vision}°</b>　鎖定 <b>${S.head.lockCount}</b> 台</div>` +
    (S.loadK > 1 ? '<div class="note warn">超重：移動變慢</div>' : '') +
    (S.armOver ? '<div class="note warn">手臂超重：上半身轉得慢、子彈較散</div>' : '') +
    (S.backOver ? '<div class="note warn">背部超重：能量回復變慢</div>' : '');
  $('gCats').querySelectorAll('button').forEach(b => b.onclick = () => { cat = b.dataset.k; sfx.click(); render(); });
  $('gOpts').querySelectorAll('button').forEach(b => b.onclick = () => pick(cat, b.dataset.id || null));
}

export function openGarage(loadout, cb) {
  lo = loadout; onChange = cb;
  garage.open = true;
  $('garage').classList.remove('hidden');
  render();
}
export function closeGarage() {
  garage.open = false;
  $('garage').classList.add('hidden');
}
