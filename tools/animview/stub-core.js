// 動作檢視器用：代替 src/core.js（遊戲的 core.js 會建立整個畫面，檢視器只需要這兩樣）
import * as THREE from 'three';
export const G = { now: 0, hitStop: 0, slowMo: 0, trauma: 0, paused: false };
export const addMat = (color, opacity = 1) => new THREE.MeshBasicMaterial({
  color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
});
