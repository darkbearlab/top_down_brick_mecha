// 本機測房間：開房、跑一陣子、選機體出擊、送操作、看狀態大小
import { Room } from './room.mjs';
const R = new Room();
let bytes = 0, snaps = 0, first = null;
const snap = () => { const s = R.snapshot(); const j = JSON.stringify(s); bytes += j.length; snaps++; first ??= j.length; return s; };
for (let i = 0; i < 600; i++) { R.step(); if (R.ticks % 3 === 0) snap(); }
const I = (await import('../src/conquest.js')).cqPickInfo();
console.log('pick info: t', I?.t, 'first', I?.first, 'options', I?.options.filter(o => !o.lock).map(o => o.lo.name).join(','));
console.log('pick ok', R.pick(I.options.find(o => !o.lock).lo.name));
const h = R.human, x0 = h.x, z0 = h.z;
for (let i = 0; i < 180; i++) { R.input({ mx: 1, mz: 0, aimYaw: 0, fire: { L: true, R: false } }); R.step(); if (R.ticks % 3 === 0) snap(); }
const s = snap();
console.log('human moved', (h.x - x0).toFixed(2), (h.z - z0).toFixed(2), 'alive', h.alive, 'me', JSON.stringify(s.me).slice(0, 200));
console.log('first snapshot', first, 'B; avg', Math.round(bytes / snaps), 'B over', snaps, 'snaps →', Math.round(bytes / snaps * 20 / 1024), 'KB/s');
console.log('last: add', s.add.length, 'm', s.m.length, 'ev', s.ev.length, 'sh', s.sh.length, 'cs?', !!s.cs, 'ev types', [...new Set(s.ev.map(e => e[0]))].join(','));
