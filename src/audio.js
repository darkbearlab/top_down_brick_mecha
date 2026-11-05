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
  click() { tone('triangle', 700, 900, 0.05, 0.1); },
};
