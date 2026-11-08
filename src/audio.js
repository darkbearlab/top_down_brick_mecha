// 極簡 WebAudio 合成音效，不需要任何音檔
let ctx = null, master = null, noiseBuf = null;

export function unlockAudio() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.35;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
}

function tone(type, f0, f1, dur, vol) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + dur);
}

function noise(dur, vol, freq, q = 1) {
  if (!ctx) return;
  const t = ctx.currentTime;
  const s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  s.buffer = noiseBuf;
  f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f).connect(g).connect(master);
  s.start(t); s.stop(t + dur);
}

export const sfx = {
  autocannon() { tone('square', 700, 160, 0.06, 0.1); noise(0.05, 0.22, 2200, 0.8); },
  cannon() { tone('sawtooth', 160, 35, 0.35, 0.28); noise(0.3, 0.6, 450, 0.5); },
  enemyShot() { tone('sawtooth', 420, 110, 0.1, 0.08); noise(0.06, 0.18, 1400); },
  hit() { tone('square', 320, 90, 0.06, 0.12); noise(0.04, 0.2, 3200); },
  armorHit() { tone('triangle', 1700, 1300, 0.05, 0.08); noise(0.03, 0.12, 6000, 3); },
  partBreak() { tone('sawtooth', 220, 40, 0.45, 0.3); noise(0.4, 0.6, 700, 0.6); },
  explode() { tone('sawtooth', 120, 25, 0.9, 0.4); noise(0.9, 0.8, 260, 0.4); },
  boost() { noise(0.28, 0.35, 700, 0.6); tone('sawtooth', 90, 180, 0.2, 0.06); },
  crash() { tone('triangle', 90, 30, 0.3, 0.3); noise(0.2, 0.5, 380, 0.6); },
  step() { tone('triangle', 70, 40, 0.08, 0.05); noise(0.05, 0.06, 500, 1); },
  land() { tone('triangle', 80, 25, 0.5, 0.35); noise(0.45, 0.6, 300, 0.5); },
  reload() { tone('square', 600, 300, 0.05, 0.08); noise(0.04, 0.15, 3000, 2); },
  reloadDone() { tone('square', 300, 800, 0.07, 0.1); noise(0.05, 0.2, 2200, 2); },
  beam() { tone('sine', 1800, 300, 0.18, 0.12); tone('square', 900, 200, 0.12, 0.05); },
  sniper() { tone('sawtooth', 900, 60, 0.3, 0.22); noise(0.25, 0.6, 1800, 0.6); },
  shotgun() { tone('square', 300, 60, 0.15, 0.2); noise(0.18, 0.7, 1200, 0.5); },
  missile() { noise(0.35, 0.3, 1600, 0.7); tone('sawtooth', 200, 600, 0.25, 0.05); },
  blast() { tone('triangle', 140, 30, 0.4, 0.3); noise(0.4, 0.6, 500, 0.5); },
  saber() { tone('sine', 300, 900, 0.18, 0.12); noise(0.16, 0.25, 3000, 2); },
  saberHit() { tone('square', 1200, 200, 0.12, 0.14); noise(0.1, 0.4, 2500, 1); },
  lock() { tone('square', 1500, 1500, 0.04, 0.05); },
  deploy() { tone('square', 220, 520, 0.12, 0.08); noise(0.14, 0.22, 1600, 1.5); },
  stow() { tone('square', 480, 200, 0.1, 0.07); noise(0.1, 0.18, 1400, 1.5); },
  alarm() { tone('square', 880, 880, 0.16, 0.07); setTimeout(() => tone('square', 660, 660, 0.2, 0.07), 180); },
  warp() { tone('sine', 220, 1800, 1.4, 0.12); tone('triangle', 110, 900, 1.2, 0.06); noise(1.2, 0.18, 4000, 2); },
  flame() { noise(0.16, 0.13, 700, 0.6); tone('sawtooth', 70, 50, 0.12, 0.03); },
  click() { tone('triangle', 700, 900, 0.05, 0.1); },
};
