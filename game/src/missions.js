// AMBER QUAY: the story. Nim Calder takes three jobs for Odile Varga after the Harbour Authority collapses.
import { LOC } from './world.js';
import { makeEnemy } from './ai.js';

export const JOBS = [
  { name: 'FIRST RUN', pay: 450 },
  { name: 'BORROWED WHEELS', pay: 900 },
  { name: 'LAST CALL AT THE CUSTOMS TOWER', pay: 2500 },
];

export class Missions {
  constructor(g) {
    this.g = g;
    this.idx = 0; this.step = 'hub'; this.done = false; this.busy = 0; this.enemies = []; this.obj = null; this.t = 0;
    this.car = null; this.startHp = 0; this.waveLeft = 0; this.fresh = true;
  }
  start(fresh = true) {
    const g = this.g;
    this.fresh = fresh;
    this.setStep('hub');
    if (fresh && this.idx === 0) {
      g.at(1.0, () => g.say('ODILE', 'Nim. Since the Harbour Authority folded, every crate on the quay belongs to whoever can carry it.', 4.6));
      g.at(1.2, () => g.say('ODILE', "Come by the Tidewater Café. I've got a first run for you.", 3.6));
    }
  }
  restore(idx, done) { this.idx = Math.min(idx, 3); this.done = done || this.idx >= 3; this.setStep(this.idx >= 3 ? 'free' : 'hub'); }
  job() { return JOBS[Math.min(this.idx, 2)]; }
  kicker() { return `JOB ${this.idx + 1} · ${this.job().name}`; }
  setStep(step) {
    const g = this.g;
    this.step = step; this.t = 0;
    const J = this.idx, m = [];
    let text = '', sub = '';
    const mk = (x, y, label, kind = 'goal', ref = null) => m.push({ x, y, label, kind, ref });
    if (step === 'free') { text = 'Free roam: stack cash, stay ahead of the Constabulary.'; sub = 'Rookspire is yours.'; }
    else if (step === 'hub') { mk(LOC.cafe.x, LOC.cafe.y, 'J' + (J + 1), 'start'); text = 'Meet Odile at the Tidewater Café'; sub = 'Walk into the amber ring'; }
    else if (J === 0 && step === 'stall') { mk(LOC.stall.x, LOC.stall.y, 'CASE'); text = 'Collect the manifest case at the Olive & Ash stall'; sub = 'Ferrow Market'; }
    else if (J === 0 && step === 'fight') { text = 'Beat off the Kestrel runners'; sub = 'LMB attack · RMB punch · R reload'; }
    else if (J === 0 && step === 'deliver') { mk(LOC.pier3.x, LOC.pier3.y, 'PIER 3'); text = 'Deliver the case to the Pier 3 office'; sub = 'Saltgate Quay'; }
    else if (J === 1 && step === 'car') { mk(LOC.court.x, LOC.court.y, 'GT', 'goal', this.car); text = 'Steal the Marlin GT from the Meridian parking court'; sub = 'Press F beside the gold car'; }
    else if (J === 1 && step === 'drive') { mk(LOC.yard.x, LOC.yard.y, 'YARD'); text = 'Deliver the Marlin GT to Gull Yard'; sub = 'Cross Marrow Bridge · shake the Constabulary · keep it clean'; }
    else if (J === 1 && step === 'return') { mk(LOC.court.x, LOC.court.y, 'GT', 'goal', this.car); text = 'Get back in the Marlin GT'; sub = 'It is still hot'; }
    else if (J === 2 && step === 'plaza') { mk(LOC.plaza.x, LOC.plaza.y, 'PLAZA'); text = 'Go to Customs Plaza'; sub = 'Kestrel holds the tower'; }
    else if (J === 2 && step === 'wave1') { text = `Clear the plaza guards (${this.waveLeft} left)`; sub = 'Use cover · LMB fire · R reload'; }
    else if (J === 2 && step === 'boss') { text = 'Take down Corbin Vell'; sub = 'Boss health shown above him'; }
    else if (J === 2 && step === 'ledger') { text = 'Grab the harbour ledger'; sub = ''; }
    else if (J === 2 && step === 'return') { mk(LOC.cafe.x, LOC.cafe.y, 'ODILE', 'start'); text = 'Bring the ledger to Odile'; sub = 'Tidewater Café'; }
    g.markers = m;
    if (J === 0 && step === 'stall' && !g.pickups.some((k) => k.kind === 'case')) g.pickups.push({ kind: 'case', x: LOC.stall.x, y: LOC.stall.y, v: 1 });
    this.obj = text ? { kicker: step === 'free' ? 'AMBER QUAY' : this.kicker(), text, sub } : null;
  }
  clearEnemies() { for (const q of this.enemies) if (!q.down) q.remove = true; this.enemies = []; }
  spawnEnemies(list) {
    const g = this.g;
    for (const [x, y, kind] of list) { const q = makeEnemy(g, x, y, kind); this.enemies.push(q); }
  }
  alive() { return this.enemies.filter((q) => !q.down && !q.remove).length; }
  complete(cash, banner, sub) {
    const g = this.g;
    g.cash += cash; g.stats.jobs++;
    g.sfx('win', 0, 0);
    g.banner = { text: banner, sub, t: 0, dur: 4.2, kind: 'good' };
    g.toast(`+$${cash} · ${this.job().name}`, 'good');
    this.idx++;
    this.car = null;
    if (this.idx >= 3) { this.done = true; this.setStep('free'); } else this.setStep('hub');
    g.save();
  }
  near(m, r, foot = true) {
    const p = this.g.player;
    if (foot && p.inVeh) return false;
    return Math.hypot(p.x - m.x, p.y - m.y) < r;
  }
  update(dt) {
    const g = this.g, p = g.player;
    this.t += dt;
    if (g.dead > 0 || g.busted > 0) return;
    const J = this.idx, s = this.step;
    for (const mk of g.markers) if (mk.ref) { mk.x = mk.ref.x; mk.y = mk.ref.y; }
    if (s === 'free') return;
    if (this.busy > 0) { this.busy -= dt; return; }
    if (s === 'hub') {
      if (this.near(LOC.cafe, 3.4)) this.runBriefing();
      return;
    }
    if (J === 0) {
      if (s === 'stall' && this.near(LOC.stall, 3)) this.pickCase();
      else if (s === 'fight') {
        if (this.alive() === 0 && this.t > 1.5) { g.say('ODILE', 'Clean work. Now get that case to Pier 3 before Kestrel reorganises.', 4); this.setStep('deliver'); }
      } else if (s === 'deliver' && Math.hypot(p.x - LOC.pier3.x, p.y - LOC.pier3.y) < 4.5 && !p.inVeh) {
        g.say('MARGUERITE', 'Manifest key. Beautiful. The crane crews work again tonight.', 3.6);
        this.busy = 2;
        g.at(0.1, () => this.complete(450, 'JOB COMPLETE', 'FIRST RUN · +$450'));
      }
    } else if (J === 1) {
      if (s === 'car' || s === 'return') {
        if (!this.car) this.car = g.vehicles.find((v) => v.special === 'marlin') || null;
      }
      if (s === 'drive') {
        const v = this.car;
        if (!v || v.dead) { this.fail('The Marlin is wrecked'); return; }
        if (p.inVeh !== v) {
          if (Math.hypot(p.x - v.x, p.y - v.y) > 70) { this.fail('You abandoned the Marlin'); return; }
          this.setStep('return');
        } else if (Math.hypot(v.x - LOC.yard.x, v.y - LOC.yard.y) < 8 && Math.abs(v.speed) < 9) {
          const dmg = Math.max(0, 100 - v.hp);
          const pay = Math.max(450, 900 - Math.round(dmg * 4));
          g.say('BUYER', `Nice ride. ${dmg < 8 ? 'Not a scratch' : 'A few dents, I will dock you'}. Cash, as agreed.`, 3.4);
          g.setHeat(0); g.heat = 0; g.heatPts = 0;
          this.busy = 2;
          g.at(0.1, () => this.complete(pay, 'JOB COMPLETE', `BORROWED WHEELS · +$${pay}`));
        }
      }
      if (s === 'return' && this.car && p.inVeh === this.car) this.setStep('drive');
      if (s === 'return' && (!this.car || this.car.dead)) this.fail('The Marlin is wrecked');
    } else if (J === 2) {
      if (s === 'plaza' && Math.hypot(p.x - LOC.plaza.x, p.y - LOC.plaza.y) < 62) {
        this.clearEnemies();
        this.spawnEnemies([[890, 748, 'melee'], [930, 770, 'gun'], [925, 812, 'melee'], [870, 812, 'gun']]);
        this.waveLeft = 4;
        g.banner = { text: 'KESTREL GUARDS', sub: 'Customs Plaza', t: 0, dur: 2.4, kind: 'warn' };
        g.say('NIM', 'Four on the plaza. Two with guns. Here we go.', 3);
        this.setStep('wave1');
      } else if (s === 'wave1') {
        const n = this.alive();
        if (n !== this.waveLeft) { this.waveLeft = n; this.obj.text = `Clear the plaza guards (${n} left)`; }
        if (n === 0 && this.t > 1) {
          this.spawnEnemies([[792, 812, 'boss'], [772, 818, 'gun'], [818, 818, 'gun']]);
          this.boss = this.enemies[0];
          g.banner = { text: 'CORBIN VELL', sub: 'Kestrel Syndicate · Customs Tower', t: 0, dur: 2.8, kind: 'warn' };
          g.say('CORBIN', "You carry cases for a dead authority, runner. I own the quay now.", 4);
          this.setStep('boss');
        }
      } else if (s === 'boss') {
        if (this.boss && this.boss.down) {
          g.pickups.push({ kind: 'ledger', x: this.boss.x, y: this.boss.y, v: 1 });
          g.say('NIM', 'The ledger. Every bribe in Rookspire in one book.', 3.4);
          this.setStep('ledger');
        }
      } else if (s === 'return' && this.near(LOC.cafe, 3.4)) this.finale();
    }
  }
  onPickup(k) {
    const g = this.g;
    if (k.kind === 'case' && this.step === 'stall') this.startFight();
    if (k.kind === 'ledger' && this.step === 'ledger') { g.say('ODILE', 'Nim, sirens at the tower. Bring it to me, quickly!', 3.4); g.setHeat(2); this.setStep('return'); g.sfx('pick', 0, 0); }
  }
  pickCase() { /* handled by pickup collision */ }
  startFight() {
    const g = this.g, p = g.player;
    g.say('NIM', 'Heavier than it looks.', 2.4);
    g.sfx('pick', p.x, p.y);
    this.spawnEnemies([[356, 300, 'melee'], [420, 362, 'melee'], [478, 248, 'gun']]);
    g.at(1.6, () => {
      g.say('ODILE', 'Kestrel runners are on you! Fists work. So does the Rivet.', 3.6);
      g.banner = { text: 'KESTREL RUNNERS', sub: 'Fight back', t: 0, dur: 2.2, kind: 'warn' };
    });
    this.setStep('fight');
  }
  runBriefing() {
    const g = this.g;
    this.busy = 12;
    const J = this.idx;
    const lines = [
      [['ODILE', "Kestrel has been skimming the manifests. The key to the real ones sits in a case at the Olive & Ash stall, Ferrow Market.", 5], ['NIM', 'And you want it on the Pier 3 desk.', 2.6], ['ODILE', 'Keep your head down and your fists up.', 3]],
      [["ODILE", "The harbourmaster's Marlin GT is in the Meridian parking court. He is not coming back for it.", 4.6], ['NIM', 'It will have an alarm.', 2.2], ['ODILE', "A buyer at Gull Yard pays cash. Across Marrow Bridge. Don't scratch it.", 4.2]],
      [['ODILE', 'Corbin Vell runs Kestrel from the Customs Tower. The ledger of every bribe is up there with him.', 5], ['NIM', 'You want me to walk in alone?', 2.6], ['ODILE', 'Take the Rivet. Do not miss.', 3]],
    ][J];
    let t = 0;
    g.markers = [];
    for (const [who, text, d] of lines) { g.at(t, () => g.say(who, text, d)); t += d + 0.15; }
    g.at(t, () => {
      this.busy = 0;
      if (J === 0) this.setStep('stall');
      else if (J === 1) { this.car = g.vehicles.find((v) => v.special === 'marlin') || null; this.setStep('car'); }
      else this.setStep('plaza');
    });
    this.busy = t + 0.5;
  }
  finale() {
    const g = this.g;
    this.busy = 12;
    g.markers = [];
    g.say('ODILE', "That's the book. The quay has a future again, Nim.", 4);
    g.at(4.2, () => g.say('NIM', 'Somebody has to carry it.', 2.6));
    g.at(7, () => { this.complete(2500, 'AMBER QUAY', 'ROOKSPIRE IS YOURS · +$2,500'); g.banner.dur = 6; this.busy = 0; });
  }
  fail(reason) {
    const g = this.g;
    g.banner = { text: 'JOB FAILED', sub: reason, t: 0, dur: 3, kind: 'fail' };
    this.restartJob();
  }
  restartJob() {
    const g = this.g;
    this.clearEnemies();
    g.pickups = g.pickups.filter((k) => k.kind !== 'case' && k.kind !== 'ledger');
    this.busy = 0;
    if (this.done) return;
    const J = this.idx;
    if (this.step === 'hub') return;
    if (J === 0) this.setStep('stall');
    else if (J === 1) { g.setHeat(0); g.heat = 0; g.heatPts = 0; const old = this.car; this.car = null; if (!old || old.dead) { const nv = g.makeVehicle('sport', LOC.court.x, LOC.court.y, Math.PI, [226, 160, 34], { parked: true }); nv.special = 'marlin'; nv.lights = false; this.car = nv; } else this.car = old; this.setStep('car'); }
    else this.setStep('plaza');
  }
  onFail() { this.restartJob(); }
  onEnter(v) {
    const g = this.g;
    if (this.idx === 1 && v.special === 'marlin' && (this.step === 'car' || this.step === 'return')) {
      this.car = v;
      if (this.step === 'car') {
        g.say('ALARM', 'The Marlin screams. Harbour Constabulary has the plate.', 3.4);
        g.setHeat(2);
        g.banner = { text: 'ALARM TRIPPED', sub: 'Get to Gull Yard', t: 0, dur: 2.4, kind: 'warn' };
      }
      this.setStep('drive');
    }
  }
  onExit() {}
  onWreck(v) { if (this.car === v && this.step === 'drive') this.fail('The Marlin is wrecked'); }
  onKill() {}
}
