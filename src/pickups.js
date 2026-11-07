// ---------- 掉落物（無盡 / 遠征模式） ----------
// 敵機被打爆有機率掉：彈藥（黃）、修理（綠）、強化模組（紫）；遠征模式另外一定掉零件（金色小方塊，吸得比較遠、放得比較久）
// 浮在地上轉圈、地上一圈光環；玩家靠近 2.5 格會被吸過來，碰到就撿起；放 25 秒沒撿就消失（最後 5 秒閃爍）
import * as THREE from 'three';
import { addMat, scene } from './core.js';

export const PICK_KINDS = {
  ammo: { name: '彈藥', hex: 0xffd060 },
  repair: { name: '修理', hex: 0x60ff90 },
  mod: { name: '強化模組', hex: 0xc080ff },
  scrap: { name: '零件', hex: 0xffb830, size: 0.55, magnet: 6, life: 40 },
};
export const pickups = [];
const BOX = new THREE.BoxGeometry(0.42, 0.42, 0.42), RING = new THREE.RingGeometry(0.5, 0.62, 24);
const LIFE = 25, MAGNET = 2.5, TAKE = 1.0;

export function spawnPickup(kind, x, z, val = 0) {
  const K = PICK_KINDS[kind], g = new THREE.Group();
  const box = new THREE.Mesh(BOX, new THREE.MeshBasicMaterial({ color: K.hex }));
  const glow = new THREE.Mesh(BOX, addMat(K.hex, 0.35));
  glow.scale.setScalar(1.6);
  const ring = new THREE.Mesh(RING, addMat(K.hex, 0.6));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -0.55;
  g.add(box, glow, ring);
  if (K.size) g.scale.setScalar(K.size);
  g.position.set(x, 0.6, z);
  scene.add(g);
  // 掉出來時往外彈一下
  const a = Math.random() * Math.PI * 2, s = 1.5 + Math.random() * 2;
  pickups.push({ kind, val, g, box, glow, ring, x, z, vx: Math.sin(a) * s, vz: Math.cos(a) * s, life: K.life ?? LIFE, magnet: K.magnet ?? MAGNET, t: Math.random() * 6 });
}

function removeAt(i) {
  const p = pickups[i];
  scene.remove(p.g);
  p.box.material.dispose(); p.glow.material.dispose(); p.ring.material.dispose();
  pickups.splice(i, 1);
}
export function clearPickups() { while (pickups.length) removeAt(pickups.length - 1); }
// 多層地圖：離開一層時把那層地上的東西收起來（回來再擺回去）
export function stashPickups() { const out = pickups.splice(0); for (const p of out) scene.remove(p.g); return out; }
export function restorePickups(list) { for (const p of list ?? []) { scene.add(p.g); pickups.push(p); } }

// onTake(kind, val) 回傳 false = 這次不撿（例如滿血時的修理）；canTake(kind) 回傳 false = 現在用不到，不吸過來、也不撿
export function updatePickups(dt, player, onTake, canTake = () => true) {
  for (let i = pickups.length - 1; i >= 0; i--) {
    const p = pickups[i];
    p.life -= dt; p.t += dt;
    if (p.life <= 0) { removeAt(i); continue; }
    p.vx *= Math.exp(-4 * dt); p.vz *= Math.exp(-4 * dt);
    if (player?.alive && canTake(p.kind)) {
      const dx = player.x - p.x, dz = player.z - p.z, d = Math.hypot(dx, dz);
      if (d < TAKE + player.r * 0.5 && onTake(p.kind, p.val) !== false) { removeAt(i); continue; }
      if (d < p.magnet) { const k = 9 * (1 - d / p.magnet) + 2; p.vx += dx / d * k * dt * 4; p.vz += dz / d * k * dt * 4; }
    }
    p.x += p.vx * dt; p.z += p.vz * dt;
    p.g.position.set(p.x, (0.6 + Math.sin(p.t * 3) * 0.12) * p.g.scale.y, p.z);
    p.box.rotation.set(p.t * 1.3, p.t * 2, 0);
    p.glow.rotation.copy(p.box.rotation);
    p.ring.position.y = -0.55 - Math.sin(p.t * 3) * 0.12;
    p.g.visible = p.life > 5 || Math.sin(p.t * 18) > -0.3;
  }
}
