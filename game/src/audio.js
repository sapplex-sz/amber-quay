// AMBER QUAY: all sound is synthesised live with Web Audio oscillators and noise. No audio files.
export class AudioMix {
  constructor() { this.ctx = null; this.musicOn = true; this.sfxOn = true; this.nextNote = 0; this.step = 0; this.engine = null; this.siren = null; }
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = (this.ctx = new AC());
    this.master = c.createGain(); this.master.gain.value = 0.7; this.master.connect(c.destination);
    this.sfx = c.createGain(); this.sfx.gain.value = 0.8; this.sfx.connect(this.master);
    this.music = c.createGain(); this.music.gain.value = 0.5; this.music.connect(this.master);
    const buf = c.createBuffer(1, c.sampleRate, c.sampleRate), d = buf.getChannelData(0);
    let s = 12345; for (let i = 0; i < d.length; i++) { s = (s * 1664525 + 1013904223) | 0; d[i] = ((s >>> 8) / 8388608) - 1; }
    this.noiseBuf = buf;
    // engine
    const eo = c.createOscillator(), eo2 = c.createOscillator(), ef = c.createBiquadFilter(), eg = c.createGain();
    eo.type = 'sawtooth'; eo2.type = 'square'; ef.type = 'lowpass'; ef.frequency.value = 420; eg.gain.value = 0;
    eo.connect(ef); eo2.connect(ef); ef.connect(eg); eg.connect(this.sfx); eo.start(); eo2.start();
    this.engine = { eo, eo2, ef, eg };
    // siren
    const so = c.createOscillator(), sg = c.createGain(), sf = c.createBiquadFilter();
    so.type = 'square'; sf.type = 'lowpass'; sf.frequency.value = 1800; sg.gain.value = 0;
    so.connect(sf); sf.connect(sg); sg.connect(this.sfx); so.start();
    this.siren = { so, sg };
    // ambience: soft harbour wind
    const ns = c.createBufferSource(); ns.buffer = buf; ns.loop = true;
    const nf = c.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.value = 500; const ng = c.createGain(); ng.gain.value = 0.05;
    ns.connect(nf); nf.connect(ng); ng.connect(this.master); ns.start();
    this.nextNote = c.currentTime + 0.2;
  }
  tone(f, dur, type = 'sine', vol = 0.2, slide = 0, delay = 0, dest = null) {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, f + slide), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o.connect(g); g.connect(dest || this.sfx); o.start(t); o.stop(t + dur + 0.05);
  }
  noise(dur, vol = 0.3, freq = 3000, delay = 0, q = 0.7, type = 'lowpass') {
    const c = this.ctx; if (!c) return;
    const t = c.currentTime + delay;
    const s = c.createBufferSource(); s.buffer = this.noiseBuf; s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    s.connect(f); f.connect(g); g.connect(this.sfx); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }
  play(e, camX, camY) {
    if (!this.ctx || !this.sfxOn) return;
    const d = Math.hypot((e.x || camX) - camX, (e.y || camY) - camY);
    const a = d > 220 ? 0 : 1 / (1 + d / 45);
    if (a < 0.03) return;
    switch (e.n) {
      case 'shot': this.noise(0.18, 0.55 * a, 2600); this.tone(160, 0.14, 'square', 0.18 * a, -110); break;
      case 'punch': this.tone(110, 0.12, 'sine', 0.5 * a, -60); this.noise(0.08, 0.3 * a, 900); break;
      case 'swing': this.noise(0.1, 0.1 * a, 1800, 0, 0.7, 'bandpass'); break;
      case 'crash': this.noise(0.4, 0.6 * a, 1400); this.tone(70, 0.3, 'sawtooth', 0.3 * a, -30); break;
      case 'bump': this.noise(0.15, 0.3 * a, 700); this.tone(90, 0.1, 'sine', 0.3 * a); break;
      case 'boom': this.noise(1.2, 0.9 * a, 500); this.tone(55, 0.9, 'sine', 0.7 * a, -30); break;
      case 'horn': this.tone(392, 0.28, 'square', 0.12 * a); this.tone(494, 0.28, 'square', 0.1 * a); break;
      case 'skid': if (!this.skidT || this.ctx.currentTime - this.skidT > 0.18) { this.skidT = this.ctx.currentTime; this.noise(0.2, 0.12 * a, 2400, 0, 3, 'bandpass'); } break;
      case 'cash': this.tone(880, 0.09, 'triangle', 0.18); this.tone(1320, 0.14, 'triangle', 0.16, 0, 0.07); break;
      case 'pick': this.tone(660, 0.1, 'triangle', 0.18); this.tone(990, 0.12, 'triangle', 0.15, 0, 0.08); break;
      case 'heat': this.tone(440, 0.18, 'sawtooth', 0.14); this.tone(330, 0.3, 'sawtooth', 0.14, 0, 0.18); break;
      case 'clear': this.tone(523, 0.14, 'triangle', 0.18); this.tone(659, 0.14, 'triangle', 0.18, 0, 0.12); this.tone(784, 0.3, 'triangle', 0.18, 0, 0.24); break;
      case 'win': [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.4, 'triangle', 0.2, 0, i * 0.13)); break;
      case 'door': this.noise(0.08, 0.2 * a, 500); this.tone(140, 0.08, 'square', 0.1 * a); break;
      case 'hurt': this.tone(200, 0.15, 'sawtooth', 0.22, -80); break;
      case 'down': this.tone(180, 0.35, 'triangle', 0.25 * a, -120); break;
      case 'reload': this.tone(900, 0.04, 'square', 0.1); this.tone(600, 0.05, 'square', 0.1, 0, 0.35); break;
      case 'empty': this.tone(1200, 0.03, 'square', 0.1); break;
      case 'ricochet': this.tone(2200, 0.1, 'sine', 0.1 * a, -1400); break;
      case 'busted': this.tone(300, 0.5, 'sawtooth', 0.2, -200); break;
      default: break;
    }
  }
  update(g, cam, dt, playing) {
    if (!this.ctx) { g.events.length = 0; return; }
    const c = this.ctx, t = c.currentTime;
    for (const e of g.events) this.play(e, cam.x, cam.y);
    g.events.length = 0;
    // engine
    const v = g.player.inVeh;
    const sp = v ? Math.abs(v.speed) : 0;
    const on = playing && v && !v.dead;
    this.engine.eo.frequency.setTargetAtTime(38 + sp * 3.4, t, 0.08);
    this.engine.eo2.frequency.setTargetAtTime(19 + sp * 1.7, t, 0.08);
    this.engine.ef.frequency.setTargetAtTime(300 + sp * 22, t, 0.1);
    this.engine.eg.gain.setTargetAtTime(on ? 0.1 + Math.min(0.09, sp * 0.004) : 0, t, 0.1);
    // siren from nearest cruiser
    let near = 1e9;
    for (const c2 of g.vehicles) if (c2.siren && !c2.dead) near = Math.min(near, Math.hypot(c2.x - cam.x, c2.y - cam.y));
    const yelp = g.heat >= 4 ? 9 : 5.2;
    this.siren.so.frequency.setTargetAtTime(760 + 420 * (0.5 + 0.5 * Math.sin(g.time * yelp)), t, 0.02);
    this.siren.sg.gain.setTargetAtTime(playing && near < 220 ? 0.05 * Math.pow(1 - near / 220, 1.6) + (near < 40 ? 0.02 : 0) : 0, t, 0.1);
    // music
    if (this.musicOn) {
      while (this.nextNote < t + 0.3) {
        const bpm = g.heat > 0 ? 112 : 86, st = 60 / bpm / 4;
        const bar = Math.floor(this.step / 16) % 8, s16 = this.step % 16;
        const chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
        const ch = chords[Math.floor(bar / 2) % 4];
        const mf = (n) => 440 * Math.pow(2, (n - 69) / 12);
        const dly = Math.max(0, this.nextNote - t);
        if (s16 === 0 || s16 === 10) this.tone(mf(ch[0] - 24), st * 5, 'sawtooth', 0.09, 0, dly, this.music);
        if (s16 % 2 === 0 && s16 % 4 !== 2) this.tone(mf(ch[(s16 / 2) % 3] + 12), st * 3, 'triangle', 0.045, 0, dly, this.music);
        if (s16 === 0) for (const n of ch) this.tone(mf(n), st * 15, 'triangle', 0.03, 0, dly, this.music);
        if (g.heat > 0 && s16 % 4 === 0) this.tone(mf(ch[0] - 12), st * 1.2, 'square', 0.03, 0, dly, this.music);
        if (s16 % 8 === 4) this.noise(0.05, 0.06, 6000, dly, 0.7, 'highpass');
        this.nextNote += st; this.step++;
      }
    }
  }
}
