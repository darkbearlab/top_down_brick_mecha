// ---------- 關卡之間的重組（傳送途中） ----------
// 機體被分解傳送走之後（warp.js），進到這個畫面：深色的傳送隧道（光線、光環從前面飛過來），機體在左邊一邊飛一邊被一塊塊方塊組回來
// 右邊的面板可以換晶片 ×2、主動裝置 ×1（基礎款 + 這一趟遠征撿到的）；每換一次，機體散開一些再組回去
// 按「出發」（或 Enter / F）→ 畫面白掉 → 下一關
// 用自己的場景和鏡頭（main.js 這段時間改畫這個場景、世界停住）
import * as THREE from 'three';
import { UNIT_BOX, addMat, camera } from './core.js';
import { buildMechModel } from './model.js';
import { PLAYER_COLORS } from './mech.js';
import { sampleVoxels } from './voxel.js';
import { BASIC_CHIPS, BASIC_DEVICES, CHIPS, DEVICES } from './tech.js';
import { sfx } from './audio.js';

const $ = id => document.getElementById(id);
const RS = { active: false };
export const reasmActive = () => RS.active;

const scn = new THREE.Scene();
scn.background = new THREE.Color(0x04060c);
scn.fog = new THREE.Fog(0x04060c, 14, 46);
scn.add(new THREE.HemisphereLight(0xc8d8ff, 0x101420, 1.5));
const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(5, 9, 6); scn.add(key);
const rim = new THREE.DirectionalLight(0x60d0ff, 1.4); rim.position.set(-6, 3, -8); scn.add(rim);
const cam = new THREE.PerspectiveCamera(42, 1, 0.1, 120);
cam.position.set(6.2, 2.6, 4.4);
const holder = new THREE.Group(); scn.add(holder);
// 光線：細長的發光方塊從前面（+z）往後飛過去
const NS = 150, streaks = new THREE.InstancedMesh(UNIT_BOX, addMat(0x8fdcff, 0.45), NS), sd = [];
streaks.frustumCulled = false;
for (let i = 0; i < NS; i++) sd.push(newStreak(true));
scn.add(streaks);
function newStreak(any) {
  const a = Math.random() * Math.PI * 2, r = 3 + Math.random() * 11;
  return { x: Math.cos(a) * r, y: 1.2 + Math.sin(a) * r * 0.7, z: any ? -50 + Math.random() * 80 : 30 + Math.random() * 10, len: 1.5 + Math.random() * 4, v: 30 + Math.random() * 30, w: 0.02 + Math.random() * 0.04 };
}
// 光環：大圈圈一個接一個從前面穿過
const rings = [];
for (let i = 0; i < 5; i++) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(7.5, 0.05, 6, 48), addMat(0x60d0ff, 0.35));
  m.position.set(0, 1.2, 30 - i * 16);
  rings.push(m); scn.add(m);
}
const mtx = new THREE.Matrix4(), col = new THREE.Color(), v3 = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
const HOT = new THREE.Color(0xb0faff);
const ease = t => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

// lo = 現在的配裝；inv = 撿到的晶片 / 裝置；stage = 要去的關卡；onGo(sel) = 按出發（sel = { chips, device }）
export function openReasm(lo, inv, stage, onGo) {
  RS.active = true; RS.t = 0; RS.onGo = onGo; RS.going = false;
  RS.sel = { chips: [...(lo.chips ?? [null, null])], device: lo.device ?? null };
  RS.chips = [...BASIC_CHIPS, ...inv.filter(id => CHIPS[id] && !CHIPS[id].basic)];
  RS.devices = [...BASIC_DEVICES, ...inv.filter(id => DEVICES[id] && !DEVICES[id].basic)];
  RS.inv = inv; RS.stage = stage;
  // 機體模型 + 組裝用的方塊（掛在模型底下，跟著一起晃）
  if (RS.model) { holder.remove(RS.model.root); }
  RS.model = buildMechModel(lo, PLAYER_COLORS);
  holder.add(RS.model.root);
  holder.position.set(0, 0, 0); holder.rotation.set(0, 0, 0);
  holder.updateMatrixWorld(true);
  const vox = sampleVoxels(RS.model.root, 900);
  RS.parts = []; RS.model.root.traverse(o => { if (o.isMesh) RS.parts.push(o); });
  RS.cubes?.parent?.remove(RS.cubes);
  RS.cubes = new THREE.InstancedMesh(UNIT_BOX, new THREE.MeshLambertMaterial({ color: 0xffffff }), vox.length);
  RS.cubes.frustumCulled = false;
  RS.model.root.add(RS.cubes);
  RS.vox = vox.map(v => ({ ...v, col: new THREE.Color(v.c), sx: 0, sy: 0, sz: 0, delay: 0, dur: 0 }));
  scatter(1);
  renderUI();
  $('reasm').classList.remove('hidden');
  sfx.warp();
}
// 方塊散出去再組回來：k = 1 整台從頭組（從後面飛進來、由下往上），k < 1 = 換零件時散開一部分、很快組回去
function scatter(k) {
  const full = k >= 1, maxY = Math.max(...RS.vox.map(v => v.y), 1);
  for (const v of RS.vox) {
    const pick = full || Math.random() < 0.35;
    if (!pick) { v.delay = -1; continue; }
    const a = Math.random() * Math.PI * 2, r = full ? 2.5 + Math.random() * 4 : 0.6 + Math.random() * 1.2;
    v.sx = v.x + Math.cos(a) * r * 0.7; v.sy = v.y + (Math.random() - 0.3) * r * 0.6; v.sz = v.z - (full ? 3 + Math.random() * 6 : Math.sin(a) * r);
    v.delay = full ? 0.25 + (v.y / maxY) * 1.1 + Math.random() * 0.45 : Math.random() * 0.25;
    v.dur = full ? 0.55 : 0.35;
  }
  RS.at = 0; RS.done = false;
  for (const o of RS.parts) o.visible = false;
  RS.cubes.visible = true;
}
export function updateReasm(dt) {
  RS.t += dt; RS.at += dt;
  // 機體：往前飛（機頭微微朝下）、左右晃
  holder.position.y = 0.6 + Math.sin(RS.t * 1.3) * 0.18;
  holder.rotation.set(0.1 + Math.sin(RS.t * 0.9) * 0.03, Math.sin(RS.t * 0.4) * 0.12, Math.sin(RS.t * 0.8) * 0.07);
  // 組裝
  if (!RS.done) {
    let left = 0, i = 0;
    for (const v of RS.vox) {
      let x = v.x, y = v.y, z = v.z, s = 0.075;
      if (v.delay >= 0) {
        const k = ease((RS.at - v.delay) / v.dur);
        if (k < 1) left++;
        x = v.sx + (v.x - v.sx) * k; y = v.sy + (v.y - v.sy) * k; z = v.sz + (v.z - v.sz) * k;
        s = RS.at < v.delay ? 0 : 0.075 + (1 - k) * 0.05;
        col.copy(v.col).lerp(HOT, (1 - k) * 0.8);   // 飛行中偏青白色
      } else col.copy(v.col);
      mtx.compose(v3.set(x, y, z), q, sc.set(s, s, s));
      RS.cubes.setMatrixAt(i, mtx); RS.cubes.setColorAt(i, col); i++;
    }
    RS.cubes.instanceMatrix.needsUpdate = true; RS.cubes.instanceColor.needsUpdate = true;
    if (left === 0 && RS.at > 0.3) {
      RS.done = true; RS.cubes.visible = false;
      for (const o of RS.parts) o.visible = true;
      sfx.reloadDone();
    }
  }
  // 光線、光環往後飛
  for (let i = 0; i < NS; i++) {
    const s = sd[i];
    s.z -= s.v * dt;
    if (s.z < -50) sd[i] = newStreak(false);
    mtx.compose(v3.set(s.x, s.y, s.z), q, sc.set(s.w, s.w, s.len));
    streaks.setMatrixAt(i, mtx);
  }
  streaks.instanceMatrix.needsUpdate = true;
  for (const r of rings) { r.position.z -= 26 * dt; if (r.position.z < -50) r.position.z += 80; }
}
export function renderReasm(renderer) {
  cam.aspect = camera.aspect; cam.updateProjectionMatrix();
  // 機體在畫面左半邊（右邊是面板）
  cam.position.set(10.5 + Math.sin(RS.t * 0.3) * 0.4, 3.4, 7);
  cam.lookAt(1.1, 1.0, -1.7);   // 看機體右邊一點的地方 → 機體在畫面左半邊
  renderer.render(scn, cam);
}
export function closeReasm() {
  RS.active = false;
  $('reasm').classList.add('hidden');
}

// ---------- 面板 ----------
const techOf = id => CHIPS[id] ?? DEVICES[id];
function optionsHtml(slot, ids, cur) {
  const btn = (id, name, desc, isNew) => `<button class="${id === cur ? 'on' : ''}" data-slot="${slot}" data-id="${id ?? ''}"><b>${name}${isNew ? '<span class="new">撿到的</span>' : ''}</b><small>${desc}</small></button>`;
  return btn(null, '（空）', slot === 'device' ? '不裝主動裝置' : '不插晶片', false) + ids.map(id => {
    const T = techOf(id);
    return btn(id, T.name, `${T.desc}${T.charges ? `・${T.charges} 次` : T.cd ? `・冷卻 ${T.cd} 秒` : ''}`, !T.basic);
  }).join('');
}
function renderUI() {
  const S = RS.sel;
  $('reasm').innerHTML = `<div class="rpanel">
    <h2>重組中</h2><p class="sub">前往第 ${RS.stage} 關・傳送途中可以換上撿到的晶片和裝置</p>
    <h3>晶片 1（頭部）</h3><div class="ropts">${optionsHtml('chip0', RS.chips, S.chips[0])}</div>
    <h3>晶片 2（軀幹）</h3><div class="ropts">${optionsHtml('chip1', RS.chips, S.chips[1])}</div>
    <h3>主動裝置（R / 中鍵）</h3><div class="ropts">${optionsHtml('device', RS.devices, S.device)}</div>
    <button class="btn primary" id="rGo">出發<small>Enter / F</small></button></div>`;
  $('reasm').querySelectorAll('.ropts button').forEach(b => b.onclick = () => pick(b.dataset.slot, b.dataset.id || null));
  $('rGo').onclick = go;
}
function pick(slot, id) {
  const S = RS.sel;
  if (slot === 'device') { if (S.device === id) return; S.device = id; }
  else { const i = +slot[4]; if (S.chips[i] === id) return; if (id && S.chips[1 - i] === id) S.chips[1 - i] = null; S.chips[i] = id; }
  sfx.click();
  scatter(0.35);   // 換零件：散開一部分再組回去
  renderUI();
}
function go() {
  if (!RS.active || RS.going) return;
  RS.going = true;
  sfx.click();
  RS.onGo?.({ chips: [...RS.sel.chips], device: RS.sel.device });
}
addEventListener('keydown', e => { if (RS.active && (e.code === 'Enter' || e.code === 'KeyF')) go(); });
