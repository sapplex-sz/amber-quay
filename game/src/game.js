// AMBER QUAY: game simulation core (state, vehicles, on-foot, combat, heat, camera, saves).
import { RNG, clamp, lerp, angDiff, TAU } from './util.js';
import { MODELS, CAR_COLORS, CIV_MODELS, SKIN, HAIR, SHIRTS, PANTS, WEAPONS } from './defs.js';
import { LOC, DIRS, nodeX, nodeY, BRIDGE_X, districtAt } from './world.js';
import { trafficCtl, copCtl, pedUpdate, population, policeUpdate, enemyUpdate } from './ai.js';
import { Missions } from './missions.js';

const ZERO_CTL = { throttle: 0, steer: 0, brake: 0, hand: 0 };
export const SAVE_KEY = 'amberquay.save.v1';

export class Game {
  constructor(world) {
    this.world = world;
    this.near = [];
    this.mode = 'title';
    this.init(1);
  }
  init(seed) {
    this.seed = seed;
    this.rng = new RNG(seed * 7919 + 13);
    this.time = 0; this.tick = 0; this.nid = 1;
    this.vehicles = []; this.peds = []; this.pickups = []; this.bullets = []; this.parts = []; this.skids = []; this.decals = [];
    this.events = []; this.timers = []; this.dialog = []; this.toasts = [];
    this.cash = 250; this.heat = 0; this.heatPts = 0; this.unseen = 0; this.heatFlash = 0; this.shake = 0; this.hurt = 0;
    this.stats = { kills: 0, wrecks: 0, jobs: 0 };
    this.markers = []; this.district = ''; this.districtT = 0; this.districtLast = '';
    this.dead = 0; this.busted = 0; this.arrest = 0; this.banner = null; this.paused = false;
    this.player = this.makePed(LOC.loft.x, LOC.loft.y + 1, { role: 'player', col: { shirt: [214, 98, 50], pants: [48, 56, 80], hair: [36, 28, 26], skin: SKIN[1], cap: [34, 52, 84], scarf: [38, 150, 160] }, hp: 100 });
    const p = this.player;
    p.weapon = 'pistol'; p.clip = 12; p.reserve = 48; p.reload = 0; p.inVeh = null; p.combo = 0; p.comboT = 0; p.armed = false;
    p.ang = Math.PI / 2;
    this.cam = { x: p.x, y: p.y, yawOff: 0, S: 8.2, yaw: -0.3, shx: 0, shy: 0 };
    this.mis = new Missions(this);
    this.tram = [];
    this.copTimer = 0; this.popTimer = 0; this.pathTimer = 0; this.copDist = null;
    this.spawnWorld();
  }
  // ------------------------------------------------------------ factories
  makePed(x, y, o = {}) {
    const r = this.rng;
    const p = {
      type: 'ped', id: this.nid++, x, y, ang: r.range(0, TAU), vx: 0, vy: 0, walk: r.range(0, 6), moving: false,
      hp: o.hp || 40, maxHp: o.hp || 40, role: o.role || 'civ', state: 'walk', hitFlash: 0, down: false, fade: 1, armed: false, aim: 0, aimT: 0, flash: 0, punch: 0,
      cd: 0, wait: 0, speed: r.range(1.3, 2.0), prev: -1, node: -1, bar: !!o.bar, fleeT: 0, alert: false, tdown: 0,
      col: o.col || { shirt: r.pick(SHIRTS), pants: r.pick(PANTS), hair: r.pick(HAIR), skin: r.pick(SKIN), cap: r.chance(0.12) ? r.pick(SHIRTS) : null },
    };
    return p;
  }
  addPed(x, y, o) { const p = this.makePed(x, y, o); this.peds.push(p); return p; }
  makeVehicle(kind, x, y, ang, col, o = {}) {
    const m = MODELS[kind];
    const v = {
      type: 'v', id: this.nid++, kind, x, y, ang, vx: 0, vy: 0, speed: 0, steer: 0, hp: m.hp, col: col || this.rng.pick(CAR_COLORS), ctl: { ...ZERO_CTL },
      ai: o.ai || 'none', lights: true, braking: false, siren: false, dead: false, fire: false, flash: 0, hasDriver: !!o.driver, nav: null, cruise: this.rng.range(9, 13.5),
      stuck: 0, parked: !!o.parked, honkT: 0, burnT: 0, lastHit: 0, wasPlayer: false, special: o.special || null, skidA: null, skidB: null,
    };
    if (kind === 'police') { v.col = [236, 236, 242]; }
    if (kind === 'taxi') v.col = [236, 188, 40];
    if (kind === 'tram') { v.kinematic = true; v.col = [240, 226, 192]; v.lights = false; }
    this.vehicles.push(v);
    return v;
  }
  spawnWorld() {
    for (const s of this.world.parked) {
      const kind = s.special === 'marlin' ? 'sport' : s.lot ? this.rng.pick(['sedan', 'hatch', 'sport', 'pickup', 'taxi']) : this.rng.pick(CIV_MODELS);
      const v = this.makeVehicle(kind, s.x, s.y, s.ang + (this.rng.chance(0.5) ? 0 : Math.PI) * (s.lot ? 0 : 1), s.special === 'marlin' ? [226, 160, 34] : null, { parked: true });
      v.lights = false;
      if (s.special) v.special = s.special;
    }
    for (const [x, dir] of [[200, 1], [980, -1]]) { const t = this.makeVehicle('tram', x, 360, dir > 0 ? 0 : Math.PI, null, {}); t.dir = dir; t.ai = 'tram'; this.tram.push(t); }
    // pickups
    const r = new RNG(77);
    for (let k = 0; k < 26; k++) { const n = this.world.pn[r.int(0, this.world.pn.length - 1)]; this.pickups.push({ kind: k % 5 === 0 ? 'health' : k % 4 === 0 ? 'ammo' : 'cash', x: n.x + r.range(-1, 1), y: n.y + r.range(-1, 1), v: r.int(20, 90) }); }
  }
  isDriving() { return !!this.player.inVeh; }
  // traffic light for an axis: 0 = east-west flow, 1 = north-south
  signal(axis) {
    const t = (this.time + 3) % 22;
    const a = axis === 0 ? t : (t + 11) % 22;
    return a < 9 ? 'g' : a < 10.4 ? 'y' : 'r';
  }
  at(delay, fn) { this.timers.push({ t: this.time + delay, fn }); }
  say(who, text, dur = 4.2) { this.dialog.push({ who, text, dur, t: 0 }); }
  toast(text, kind = 'info') { this.toasts.push({ text, kind, t: 0 }); if (this.toasts.length > 4) this.toasts.shift(); }
  sfx(name, x, y, a) { this.events.push({ n: name, x, y, a }); }
  fx(type, x, y, z, o = {}) { this.parts.push({ type, x, y, z, vx: 0, vy: 0, vz: 0, life: 1, max: 1, size: 0.5, ...o }); if (this.parts.length > 700) this.parts.splice(0, 100); }
  floatText(x, y, text, c) { this.fx('text', x, y, 2.4, { vz: 1.6, life: 1.3, max: 1.3, text, c }); }
  // ------------------------------------------------------------ main step
  step(dt, inp) {
    this.time += dt; this.tick++;
    const p = this.player;
    const play = this.mode === 'play';
    if (play && !this.paused) {
      if (this.dead > 0) this.updateDead(dt);
      else if (this.busted > 0) this.updateBusted(dt);
      else this.updatePlayer(dt, inp);
    }
    if (this.paused) return;
    for (const v of this.vehicles) this.updateVehicle(v, dt);
    this.collideVehicles(dt);
    for (const q of this.peds) this.updatePed(q, dt);
    this.peds = this.peds.filter((q) => !q.remove);
    this.updateBullets(dt);
    this.updateParts(dt);
    this.updateTimers();
    if (play) { this.mis.update(dt); this.updatePickups(dt); this.updateHeat(dt); this.updateDistrict(dt); }
    population(this, dt);
    policeUpdate(this, dt);
    this.updateWorldFx(dt);
    this.updateCamera(dt, inp);
    this.shake = Math.max(0, this.shake - dt * 2.5); this.hurt = Math.max(0, this.hurt - dt * 1.6);
    for (const d of this.dialog.slice(0, 1)) { d.t += dt; if (d.t > d.dur) this.dialog.shift(); }
    for (const t of this.toasts) t.t += dt;
    this.toasts = this.toasts.filter((t) => t.t < 4.2);
    if (this.banner) { this.banner.t += dt; if (this.banner.t > this.banner.dur) this.banner = null; }
  }
  updateTimers() {
    for (let i = this.timers.length - 1; i >= 0; i--) if (this.timers[i].t <= this.time) { const f = this.timers[i].fn; this.timers.splice(i, 1); f(); }
  }
  updateWorldFx(dt) {
    const t = this.world.tug;
    t.x += t.dir * 3.2 * dt; if (t.x > 1500) t.dir = -1; if (t.x < -150) t.dir = 1;
    for (const s of this.skids) s.a -= dt * 0.08;
    this.skids = this.skids.filter((s) => s.a > 0);
    for (const d of this.decals) d.a -= dt * 0.01;
    this.decals = this.decals.filter((d) => d.a > 0);
  }
  updateParts(dt) {
    for (const q of this.parts) {
      q.life -= dt / q.max; q.x += q.vx * dt; q.y += q.vy * dt; q.z += q.vz * dt;
      if (q.type === 'spark') q.vz -= 14 * dt;
      if (q.type === 'smoke') q.size += dt * 0.6;
    }
    this.parts = this.parts.filter((q) => q.life > 0);
  }
  updateDistrict(dt) {
    const p = this.player;
    const d = districtAt(p.x, p.y);
    if (d !== this.districtLast) { this.districtLast = d; this.district = d; this.districtT = 3.2; }
    this.districtT = Math.max(0, this.districtT - dt);
  }
  // ------------------------------------------------------------ camera
  updateCamera(dt, inp) {
    const c = this.cam, p = this.player;
    if (this.camLocked) return;
    let tx = p.x, ty = p.y, S = 9.4;
    const v = p.inVeh;
    if (v) { tx = v.x + v.vx * 0.55; ty = v.y + v.vy * 0.55; S = lerp(8.6, 6.6, clamp(Math.abs(v.speed) / 34, 0, 1)); }
    else if (p.aimT > 0) { tx = p.x + Math.cos(p.aim) * 3; ty = p.y + Math.sin(p.aim) * 3; }
    const k = 1 - Math.exp(-dt * (v ? 4.2 : 6));
    c.x += (tx - c.x) * k; c.y += (ty - c.y) * k;
    c.S += (S - c.S) * (1 - Math.exp(-dt * 2));
    if (inp) { if (inp.down('KeyQ')) c.yawOff -= dt * 1.2; if (inp.down('KeyE')) c.yawOff += dt * 1.2; }
    c.yawOff = clamp(c.yawOff, -1.2, 1.2);
    c.yaw = -0.3 + c.yawOff;
    const sh = this.shake;
    c.shx = (Math.sin(this.time * 91) * sh) * 0.9; c.shy = (Math.cos(this.time * 77) * sh) * 0.9;
  }
  // ------------------------------------------------------------ player
  updatePlayer(dt, inp) {
    const p = this.player, cam = this.cam;
    p.cd = Math.max(0, p.cd - dt); p.punch = Math.max(0, p.punch - dt); p.flash = Math.max(0, p.flash - dt); p.aimT = Math.max(0, p.aimT - dt);
    p.hitFlash = Math.max(0, p.hitFlash - dt); p.comboT = Math.max(0, p.comboT - dt); if (p.comboT <= 0) p.combo = 0;
    if (p.reload > 0) { p.reload -= dt; if (p.reload <= 0) { const n = Math.min(12 - p.clip, p.reserve); p.clip += n; p.reserve -= n; } }
    // aim
    const [mx, my] = this.unprojectMouse(inp);
    p.aim = Math.atan2(my - p.y, mx - p.x);
    p.armed = p.weapon === 'pistol';
    if (inp.pressed('Digit1')) p.weapon = 'fists';
    if (inp.pressed('Digit2')) p.weapon = 'pistol';
    if (inp.pressed('Tab')) p.weapon = p.weapon === 'pistol' ? 'fists' : 'pistol';
    const v = p.inVeh;
    if (v) { this.drive(v, inp, dt); p.x = v.x; p.y = v.y; p.moving = false; if (inp.pressed('KeyF') || inp.pressed('Enter')) this.exitVehicle(); return; }
    // on foot
    let ix = (inp.down('KeyD') || inp.down('ArrowRight') ? 1 : 0) - (inp.down('KeyA') || inp.down('ArrowLeft') ? 1 : 0);
    let iy = (inp.down('KeyS') || inp.down('ArrowDown') ? 1 : 0) - (inp.down('KeyW') || inp.down('ArrowUp') ? 1 : 0);
    const l = Math.hypot(ix, iy);
    const sprint = inp.down('ShiftLeft') || inp.down('ShiftRight');
    const sp = sprint ? 7.4 : 4.6;
    if (l > 0) { ix /= l; iy /= l; }
    const cY = Math.cos(cam.yaw), sY = Math.sin(cam.yaw);
    const wx = ix * cY - iy * sY, wy = ix * sY + iy * cY;
    const acc = 1 - Math.exp(-dt * 14);
    p.vx += (wx * sp - p.vx) * acc; p.vy += (wy * sp - p.vy) * acc;
    if (p.punch > 0) { p.vx *= 0.5; p.vy *= 0.5; }
    p.moving = l > 0;
    if (p.moving) { p.walk += dt * (sprint ? 14 : 10); }
    if (p.aimT > 0 || inp.mouse.down) p.ang = p.aim;
    else if (l > 0) { const ta = Math.atan2(wy, wx); p.ang += angDiff(p.ang, ta) * Math.min(1, dt * 14); }
    this.moveCircle(p, dt, 0.4);
    // actions
    if (inp.mouse.pressed) {
      p.aimT = 2.4;
      if (p.weapon === 'pistol') this.playerShoot(p);
      else this.playerPunch(p);
    } else if (inp.mouse.down && p.weapon === 'pistol' && p.cd <= 0) { p.aimT = 2.4; this.playerShoot(p); }
    if (inp.mouse.rpressed || inp.pressed('KeyV')) { p.aimT = 1.5; this.playerPunch(p); }
    if (inp.pressed('KeyR') && p.clip < 12 && p.reserve > 0 && p.reload <= 0) { p.reload = 0.95; this.sfx('reload', p.x, p.y); }
    if (inp.pressed('KeyF') || inp.pressed('KeyG')) this.tryEnter();
    // gun noise heat
  }
  unprojectMouse(inp) {
    const r = this.renderCam;
    if (!r) return [this.player.x + 1, this.player.y];
    return r.unproject(inp.mouse.x, inp.mouse.y);
  }
  playerShoot(p) {
    if (p.cd > 0 || p.reload > 0) return;
    if (p.clip <= 0) { if (p.reserve > 0) { p.reload = 0.95; this.sfx('reload', p.x, p.y); } else { this.sfx('empty', p.x, p.y); p.cd = 0.3; } return; }
    p.clip--; p.cd = WEAPONS.pistol.rate;
    this.fire(p, p.aim + (this.rng.next() - 0.5) * 0.04, false, 24);
    this.shake = Math.min(1, this.shake + 0.12);
    this.crime(3, p.x, p.y, 'shot');
  }
  fire(s, aim, hostile, dmg) {
    const px = -Math.sin(aim), py = Math.cos(aim);
    const x = s.x + Math.cos(aim) * 1.2 + px * 0.27, y = s.y + Math.sin(aim) * 1.2 + py * 0.27;
    this.bullets.push({ x, y, vx: Math.cos(aim) * 85, vy: Math.sin(aim) * 85, life: 0.7, hostile, dmg, from: s });
    s.flash = 0.075; s.aim = aim; s.aimT = Math.max(s.aimT, 1);
    this.sfx('shot', s.x, s.y);
    for (let i = 0; i < 2; i++) this.fx('spark', x, y, 1.3, { vx: Math.cos(aim) * 6 + (this.rng.next() - 0.5) * 6, vy: Math.sin(aim) * 6 + (this.rng.next() - 0.5) * 6, vz: this.rng.range(1, 4), life: 1, max: 0.25 });
  }
  playerPunch(p) {
    if (p.cd > 0) return;
    p.cd = 0.34; p.punch = 0.2; p.combo = p.combo < 3 ? p.combo + 1 : 1; p.comboT = 0.8;
    this.sfx('swing', p.x, p.y);
    const heavy = p.combo === 3;
    let hit = false;
    const reach = 2.4;
    for (const q of this.peds) {
      if (q.down || q.remove) continue;
      const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy);
      if (d > reach || Math.abs(angDiff(p.aim, Math.atan2(dy, dx))) > 1.0) continue;
      hit = true;
      this.hurtPed(q, heavy ? 30 : 17, p, 'melee');
      q.vx += Math.cos(p.aim) * (heavy ? 9 : 4); q.vy += Math.sin(p.aim) * (heavy ? 9 : 4);
      this.fx('ring', q.x, q.y, 1.2, { size: 1.2, max: 0.25 });
    }
    // punching a parked/idle car's driver? no. shove cars lightly
    if (hit) { this.sfx('punch', p.x, p.y); this.shake = Math.min(1, this.shake + 0.18); }
  }
  tryEnter() {
    const p = this.player;
    let best = null, bd = 3.6;
    for (const v of this.vehicles) {
      if (v.dead || v.kind === 'tram') continue;
      const m = MODELS[v.kind];
      const c = Math.cos(v.ang), s = Math.sin(v.ang);
      const lx = (p.x - v.x) * c + (p.y - v.y) * s, ly = -(p.x - v.x) * s + (p.y - v.y) * c;
      const d = Math.hypot(Math.max(0, Math.abs(lx) - m.len / 2), Math.max(0, Math.abs(ly) - m.wid / 2));
      if (d < bd) { bd = d; best = v; }
    }
    if (!best) return false;
    const v = best;
    if (v.hasDriver && v.ai !== 'cop') {
      // carjack: pull the driver out
      v.hasDriver = false;
      const c = Math.cos(v.ang), s = Math.sin(v.ang);
      const d = this.addPed(v.x - s * 1.6, v.y + c * 1.6, {});
      d.state = 'flee'; d.fleeT = 6; d.fromX = p.x; d.fromY = p.y;
      this.crime(14, p.x, p.y, 'jack');
      this.floatText(v.x, v.y, 'HIJACK', '#ffcf6a');
      this.sfx('door', v.x, v.y);
    } else if (v.ai === 'cop' || v.kind === 'police') { this.crime(30, p.x, p.y, 'copcar'); v.hasDriver = false; }
    else if (v.parked) this.crime(4, p.x, p.y, 'theft');
    this.enterVehicle(v);
    return true;
  }
  enterVehicle(v) {
    const p = this.player;
    p.inVeh = v; v.ai = 'player'; v.parked = false; v.lights = true; v.wasPlayer = true; v.stuck = 0;
    p.hidden = true; p.x = v.x; p.y = v.y; p.vx = 0; p.vy = 0;
    this.sfx('door', v.x, v.y);
    this.mis.onEnter(v);
  }
  exitVehicle() {
    const p = this.player, v = p.inVeh;
    if (!v) return;
    if (Math.abs(v.speed) > 9) { this.toast('Too fast to bail out'); return; }
    const c = Math.cos(v.ang), s = Math.sin(v.ang), m = MODELS[v.kind];
    const tryPos = [[-s * -1, c * -1], [s, -c], [c * 2, s * 2], [-c * 2, -s * 2]];
    let spot = null;
    for (const [ox, oy] of tryPos) {
      const k = (m.wid / 2 + 1.2) / (Math.hypot(ox, oy) || 1);
      const x = v.x + ox * k, y = v.y + oy * k;
      if (this.world.solidsNear(x, y, 0.45, this.near).length === 0) { spot = [x, y]; break; }
    }
    if (!spot) spot = [v.x, v.y];
    p.x = spot[0]; p.y = spot[1]; p.hidden = false; p.inVeh = null; v.ai = 'none'; v.ctl = { ...ZERO_CTL, brake: 1 }; v.siren = false; p.ang = v.ang;
    this.sfx('door', v.x, v.y);
    this.mis.onExit(v);
  }
  drive(v, inp, dt) {
    const k = (a, b) => inp.down(a) || inp.down(b);
    const th = (k('KeyW', 'ArrowUp') ? 1 : 0) - (k('KeyS', 'ArrowDown') ? 1 : 0);
    const st = (k('KeyD', 'ArrowRight') ? 1 : 0) - (k('KeyA', 'ArrowLeft') ? 1 : 0);
    const hand = inp.down('Space') ? 1 : 0;
    let brake = 0, throttle = th;
    if (th < 0 && v.speed > 1.2) { brake = 1; throttle = 0; }
    v.ctl = { throttle, steer: st, brake, hand };
    if (inp.pressed('KeyH')) { this.sfx('horn', v.x, v.y); v.honkT = 0.4; }
    if (v.kind === 'police' && inp.pressed('KeyT')) v.siren = !v.siren;
    v.reverseLight = v.speed < -0.5;
    v.lights = true;
  }
  // ------------------------------------------------------------ vehicles
  updateVehicle(v, dt) {
    const m = MODELS[v.kind];
    v.flash = Math.max(0, v.flash - dt); v.honkT = Math.max(0, v.honkT - dt);
    if (v.kinematic) {
      v.x += v.dir * 7 * dt; v.speed = v.dir * 7; v.vx = v.speed; v.vy = 0;
      if (v.x > 1350) { v.dir = -1; v.ang = Math.PI; } if (v.x < -30) { v.dir = 1; v.ang = 0; }
      return;
    }
    if (v.dead) {
      v.ctl = { ...ZERO_CTL, brake: 0.3 };
      v.burnT += dt;
      if (this.tick % 3 === 0) { this.fx('fire', v.x + (this.rng.next() - 0.5) * 2, v.y + (this.rng.next() - 0.5), 0.8, { vz: 3, max: 0.5, size: 0.9 }); this.fx('smoke', v.x + (this.rng.next() - 0.5) * 2, v.y, 1.2, { vz: 3.4, max: 1.6, size: 0.6 }); }
      if (!v.boomed && v.burnT > 4.5) this.explode(v);
    } else if (v.hp < m.hp * 0.3 && this.tick % 6 === 0) this.fx('smoke', v.x + Math.cos(v.ang) * m.len * 0.3, v.y + Math.sin(v.ang) * m.len * 0.3, 1, { vz: 2.2, max: 1.2, size: 0.5 });
    if (v.ai === 'traffic') trafficCtl(this, v, dt);
    else if (v.ai === 'cop') copCtl(this, v, dt);
    else if (v.ai === 'none' && Math.abs(v.vx) + Math.abs(v.vy) < 0.05) { v.speed = 0; v.braking = false; return; }
    else if (v.ai === 'none') { v.ctl = { ...ZERO_CTL, brake: 0.4 }; }
    const ctl = v.dead ? ZERO_CTL : v.ctl;
    let c = Math.cos(v.ang), s = Math.sin(v.ang);
    let vf = v.vx * c + v.vy * s, vl = -v.vx * s + v.vy * c;
    const th = ctl.throttle, br = ctl.brake;
    let acc = 0;
    if (th > 0) acc = vf < -0.5 ? 30 * th : m.acc * th * Math.max(0, 1 - vf / m.spd);
    else if (th < 0) acc = vf > 0.8 ? -28 * -th : -m.acc * 0.5 * -th * Math.max(0, 1 + vf / 9);
    if (br > 0) acc -= Math.sign(vf) * Math.min(Math.abs(vf) / dt * 0.9, 28 * br);
    acc -= vf * 0.04 + (Math.abs(vf) > 0.08 ? Math.sign(vf) * 0.5 : 0);
    vf += acc * dt;
    if (ctl.hand) vf *= 1 - 0.7 * dt;
    const grip = ctl.hand ? 1.3 : v.kind === 'sport' ? 6.2 : 7.8;
    vl *= Math.exp(-grip * dt);
    const maxSt = 0.62 / (1 + Math.abs(vf) / 15);
    let yaw = (vf / (m.len * 0.55)) * Math.tan(ctl.steer * maxSt) * (m.turn / 2.4);
    if (ctl.hand && Math.abs(vf) > 4) yaw *= 1.7;
    v.ang += yaw * dt;
    v.steer += (ctl.steer - v.steer) * Math.min(1, dt * 10);
    c = Math.cos(v.ang); s = Math.sin(v.ang);
    v.vx = c * vf - s * vl; v.vy = s * vf + c * vl;
    v.x += v.vx * dt; v.y += v.vy * dt;
    v.speed = vf;
    v.braking = (br > 0.15 && vf > 0.5) || (th < 0 && vf > 0.8);
    // skids
    const slide = Math.abs(vl) > 2.6 && Math.abs(vf) > 5;
    if (slide || (ctl.hand && Math.abs(vf) > 6) || (br > 0.8 && vf > 14)) {
      const L = m.len / 2 * 0.62, Wd = m.wid / 2 - 0.15;
      const pts = [[-L, -Wd], [-L, Wd]].map(([lx, ly]) => [v.x + lx * c - ly * s, v.y + lx * s + ly * c]);
      if (v.skidA) { this.skids.push({ x1: v.skidA[0], y1: v.skidA[1], x2: pts[0][0], y2: pts[0][1], a: 1 }); this.skids.push({ x1: v.skidB[0], y1: v.skidB[1], x2: pts[1][0], y2: pts[1][1], a: 1 }); if (this.skids.length > 420) this.skids.splice(0, 40); }
      v.skidA = pts[0]; v.skidB = pts[1];
      if (this.tick % 4 === 0) this.fx('dust', pts[0][0], pts[0][1], 0.2, { vz: 0.8, max: 0.8, size: 0.7 });
      if (v.ai === 'player') this.sfx('skid', v.x, v.y);
    } else { v.skidA = null; v.skidB = null; }
    this.collideWorld(v, dt);
    this.hitPeds(v);
  }
  collideWorld(v, dt) {
    const m = MODELS[v.kind];
    const r = m.wid / 2 + 0.02;
    const c = Math.cos(v.ang), s = Math.sin(v.ang);
    for (const off of [-0.3, 0.3, 0]) {
      const cx = v.x + c * off * m.len, cy = v.y + s * off * m.len;
      const list = this.world.solidsNear(cx, cy, r + 0.2, this.near);
      for (const b of list) {
        const px = clamp(cx, b.x0, b.x1), py = clamp(cy, b.y0, b.y1);
        let dx = cx - px, dy = cy - py, d = Math.hypot(dx, dy);
        let nx, ny, pen;
        if (d < 1e-4) {
          const l = cx - b.x0, rr = b.x1 - cx, t = cy - b.y0, bt = b.y1 - cy, mn = Math.min(l, rr, t, bt);
          if (mn === l) { nx = -1; ny = 0; } else if (mn === rr) { nx = 1; ny = 0; } else if (mn === t) { nx = 0; ny = -1; } else { nx = 0; ny = 1; }
          pen = mn + r;
        } else { if (d >= r) continue; nx = dx / d; ny = dy / d; pen = r - d; }
        v.x += nx * pen; v.y += ny * pen;
        const vn = v.vx * nx + v.vy * ny;
        if (vn < 0) {
          v.vx -= 1.25 * vn * nx; v.vy -= 1.25 * vn * ny;
          const imp = -vn;
          if (imp > 3 && this.time - v.lastHit > 0.15) {
            v.lastHit = this.time;
            this.damageVehicle(v, Math.max(0, imp - 4) * 3.4, imp);
            this.sfx(imp > 8 ? 'crash' : 'bump', v.x, v.y, imp);
            for (let i = 0; i < 3; i++) this.fx('spark', cx - nx * r, cy - ny * r, 0.8, { vx: nx * 3 + (this.rng.next() - 0.5) * 5, vy: ny * 3 + (this.rng.next() - 0.5) * 5, vz: this.rng.range(1, 4), max: 0.4 });
            if (v.ai === 'player') { this.shake = Math.min(1, this.shake + imp * 0.05); if (imp > 7 && b.tag !== 'edge') this.crime(2, v.x, v.y, 'crash'); }
          }
        }
      }
    }
  }
  damageVehicle(v, dmg, imp = 0) {
    if (v.dead || dmg <= 0) return;
    v.hp -= dmg; v.flash = 0.12;
    if (v.ai === 'player') { const p = this.player; if (imp > 10) this.hurtPlayer(imp * 0.9, 'crash'); }
    if (v.hp <= 0) this.wreck(v);
  }
  wreck(v) {
    v.dead = true; v.fire = true; v.burnT = 0; v.ai = v.ai === 'player' ? 'none' : 'none'; v.lights = false; v.siren = false; v.hasDriver = false;
    this.stats.wrecks++;
    if (this.player.inVeh === v) { this.exitVehicleForce(); }
    this.mis.onWreck(v);
  }
  exitVehicleForce() {
    const p = this.player, v = p.inVeh;
    const c = Math.cos(v.ang), s = Math.sin(v.ang);
    p.x = v.x - s * 3; p.y = v.y + c * 3; p.hidden = false; p.inVeh = null;
    p.vx = -s * 3; p.vy = c * 3;
    this.hurtPlayer(15, 'crash');
  }
  explode(v) {
    v.boomed = true; v.fire = false;
    this.fx('boom', v.x, v.y, 1, { size: 12, max: 0.7 });
    for (let i = 0; i < 12; i++) this.fx('fire', v.x + (this.rng.next() - 0.5) * 4, v.y + (this.rng.next() - 0.5) * 4, 1, { vz: this.rng.range(3, 8), vx: (this.rng.next() - 0.5) * 8, vy: (this.rng.next() - 0.5) * 8, max: 0.8, size: 1.4 });
    this.decals.push({ x: v.x, y: v.y, r: 3, a: 1 });
    this.sfx('boom', v.x, v.y); this.shake = Math.min(1, this.shake + 0.6);
    const R = 11;
    for (const q of this.peds) { const d = Math.hypot(q.x - v.x, q.y - v.y); if (d < R && !q.down) this.hurtPed(q, 90 * (1 - d / R), this.player, 'blast'); }
    const p = this.player; const d = Math.hypot(p.x - v.x, p.y - v.y);
    if (d < R && !p.inVeh && this.dead <= 0) this.hurtPlayer(70 * (1 - d / R), 'blast');
    for (const o of this.vehicles) { if (o === v || o.dead || o.kinematic) continue; const dd = Math.hypot(o.x - v.x, o.y - v.y); if (dd < R) { const k = (1 - dd / R); o.vx += ((o.x - v.x) / (dd + 1)) * 8 * k; o.vy += ((o.y - v.y) / (dd + 1)) * 8 * k; this.damageVehicle(o, 70 * k); } }
  }
  collideVehicles(dt) {
    const vs = this.vehicles;
    const grid = new Map();
    for (const v of vs) { if (v.kinematic) continue; const k = Math.floor(v.x / 14) * 1000 + Math.floor(v.y / 14); let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(v); }
    const circles = (v) => { const m = MODELS[v.kind]; const c = Math.cos(v.ang), s = Math.sin(v.ang); const r = m.wid / 2 + 0.03; return [-0.3, 0, 0.3].map((o) => [v.x + c * o * m.len, v.y + s * o * m.len, r]); };
    for (const a of vs) {
      if (a.kinematic) {
        // tram shoves things on the tracks
        for (const b of vs) { if (b.kinematic || Math.abs(b.y - a.y) > 4 || Math.abs(b.x - a.x) > 12) continue; const m = MODELS[b.kind]; if (Math.abs(b.y - a.y) < 1.4 + m.wid / 2) { b.vx += a.dir * 6 * dt * 10; this.damageVehicle(b, 0.4); } }
        continue;
      }
      const active = Math.abs(a.vx) + Math.abs(a.vy) > 0.4 || a.ai === 'player';
      if (!active) continue;
      const cx = Math.floor(a.x / 14), cy = Math.floor(a.y / 14);
      const ca = circles(a);
      for (let gx = cx - 1; gx <= cx + 1; gx++) for (let gy = cy - 1; gy <= cy + 1; gy++) {
        const lst = grid.get(gx * 1000 + gy); if (!lst) continue;
        for (const b of lst) {
          if (b === a) continue;
          const bActive = Math.abs(b.vx) + Math.abs(b.vy) > 0.4 || b.ai === 'player';
          if (bActive && b.id < a.id) continue;
          if (Math.hypot(a.x - b.x, a.y - b.y) > 7) continue;
          const cb = circles(b);
          let hit = false;
          for (const A of ca) for (const B of cb) {
            let dx = B[0] - A[0], dy = B[1] - A[1], d = Math.hypot(dx, dy); const rr = A[2] + B[2];
            if (d >= rr) continue;
            if (d < 1e-4) { dx = 1; dy = 0; d = 1; }
            const nx = dx / d, ny = dy / d, pen = (rr - d);
            const ma = MODELS[a.kind].mass, mb = MODELS[b.kind].mass, tot = ma + mb;
            a.x -= nx * pen * (mb / tot) * 0.6; a.y -= ny * pen * (mb / tot) * 0.6; b.x += nx * pen * (ma / tot) * 0.6; b.y += ny * pen * (ma / tot) * 0.6;
            const rvx = a.vx - b.vx, rvy = a.vy - b.vy, vn = rvx * nx + rvy * ny;
            if (vn > 0) {
              const j = (1.35 * vn) / (1 / ma + 1 / mb);
              a.vx -= (j * nx) / ma; a.vy -= (j * ny) / ma; b.vx += (j * nx) / mb; b.vy += (j * ny) / mb;
              if (vn > 3 && !hit) {
                hit = true;
                const dm = Math.max(0, vn - 3) * 3.2;
                if (this.time - a.lastHit > 0.2) { a.lastHit = this.time; this.damageVehicle(a, dm * mb / tot * 1.5, vn); }
                if (this.time - b.lastHit > 0.2) { b.lastHit = this.time; this.damageVehicle(b, dm * ma / tot * 1.5, vn); }
                this.sfx(vn > 8 ? 'crash' : 'bump', a.x, a.y, vn);
                this.fx('spark', (A[0] + B[0]) / 2, (A[1] + B[1]) / 2, 0.9, { vx: (this.rng.next() - 0.5) * 6, vy: (this.rng.next() - 0.5) * 6, vz: 3, max: 0.35 });
                if (a.ai === 'player' || b.ai === 'player') { this.shake = Math.min(1, this.shake + vn * 0.04); const o = a.ai === 'player' ? b : a; if (o.ai === 'traffic' || o.parked) this.crime(3, a.x, a.y, 'crash'); if (o.ai === 'cop') { if (this.heat < 1) this.crime(18, a.x, a.y, 'ramcop'); } }
                if ((a.ai === 'cop' && b.ai === 'player') || (b.ai === 'cop' && a.ai === 'player')) { /* ram */ }
                if (b.ai === 'traffic' && !b.dead && vn > 6) b.honkT = 0.6;
              }
            }
          }
        }
      }
    }
  }
  hitPeds(v) {
    if (Math.abs(v.speed) < 3.2 || v.dead) return;
    const m = MODELS[v.kind];
    const c = Math.cos(v.ang), s = Math.sin(v.ang);
    const check = (q) => {
      if (q.down || q.remove || q.hidden) return;
      const dx = q.x - v.x, dy = q.y - v.y;
      if (Math.abs(dx) > 5 || Math.abs(dy) > 5) return;
      const lx = dx * c + dy * s, ly = -dx * s + dy * c;
      if (Math.abs(lx) < m.len / 2 + 0.35 && Math.abs(ly) < m.wid / 2 + 0.35) {
        const dmg = clamp(Math.abs(v.speed) * 4, 12, 110);
        q.vx += v.vx * 0.9 + -s * (ly > 0 ? 1 : -1) * 2; q.vy += v.vy * 0.9;
        if (q === this.player) { if (this.time - (this.lastRunOver || 0) > 0.4) { this.lastRunOver = this.time; this.hurtPlayer(dmg * 0.5, 'car'); } }
        else {
          this.hurtPed(q, dmg, v.ai === 'player' ? this.player : null, 'car');
          v.vx *= 0.97; v.vy *= 0.97;
          if (v.ai === 'player') { this.shake = Math.min(1, this.shake + 0.25); }
        }
      }
    };
    for (const q of this.peds) check(q);
    if (!this.player.inVeh) check(this.player);
  }
  // ------------------------------------------------------------ peds, damage
  moveCircle(q, dt, r) {
    q.x += q.vx * dt; q.y += q.vy * dt;
    const list = this.world.solidsNear(q.x, q.y, r + 0.1, this.near);
    for (const b of list) {
      const px = clamp(q.x, b.x0, b.x1), py = clamp(q.y, b.y0, b.y1);
      let dx = q.x - px, dy = q.y - py, d = Math.hypot(dx, dy);
      if (d >= r) continue;
      if (d < 1e-4) {
        const l = q.x - b.x0, rr = b.x1 - q.x, t = q.y - b.y0, bt = b.y1 - q.y, mn = Math.min(l, rr, t, bt);
        if (mn === l) { dx = -1; dy = 0; } else if (mn === rr) { dx = 1; dy = 0; } else if (mn === t) { dx = 0; dy = -1; } else { dx = 0; dy = 1; }
        d = 1; q.x += dx * (mn + r); q.y += dy * (mn + r);
      } else { q.x += (dx / d) * (r - d); q.y += (dy / d) * (r - d); }
      const vn = q.vx * dx + q.vy * dy; if (vn < 0) { q.vx -= vn * dx / (d || 1); q.vy -= vn * dy / (d || 1); }
    }
    // parked / slow cars act as obstacles
    for (const v of this.vehicles) {
      if (Math.abs(v.x - q.x) > 7 || Math.abs(v.y - q.y) > 7 || v.kinematic) continue;
      if (Math.abs(v.speed) > 3.2 && v.ai !== 'none') continue;
      const m = MODELS[v.kind], c = Math.cos(v.ang), s = Math.sin(v.ang);
      const dx = q.x - v.x, dy = q.y - v.y, lx = dx * c + dy * s, ly = -dx * s + dy * c;
      const ex = m.len / 2 + r, ey = m.wid / 2 + r;
      if (Math.abs(lx) < ex && Math.abs(ly) < ey) {
        const px = ex - Math.abs(lx), py = ey - Math.abs(ly);
        if (px < py) { const k = Math.sign(lx || 1) * px; q.x += c * k; q.y += s * k; } else { const k = Math.sign(ly || 1) * py; q.x += -s * k; q.y += c * k; }
      }
    }
  }
  updatePed(q, dt) {
    q.hitFlash = Math.max(0, q.hitFlash - dt); q.flash = Math.max(0, q.flash - dt); q.punch = Math.max(0, q.punch - dt); q.aimT = Math.max(0, q.aimT - dt); q.cd = Math.max(0, q.cd - dt);
    if (q.down) {
      q.tdown += dt; q.vx *= 0.9; q.vy *= 0.9; q.x += q.vx * dt; q.y += q.vy * dt;
      if (q.tdown > 5) q.fade = 1 - (q.tdown - 5) / 1.5; if (q.fade <= 0) q.remove = true;
      return;
    }
    if (q.role === 'civ') pedUpdate(this, q, dt);
    else enemyUpdate(this, q, dt);
    if (Math.abs(q.vx) + Math.abs(q.vy) > 0.2) q.walk += dt * (q.state === 'flee' || q.state === 'chase' ? 13 : 8);
  }
  hurtPed(q, dmg, src, kind) {
    if (q.down) return;
    q.hp -= dmg; q.hitFlash = 0.12;
    this.fx('spark', q.x, q.y, 1.3, { vx: (this.rng.next() - 0.5) * 3, vy: (this.rng.next() - 0.5) * 3, vz: 2, max: 0.3 });
    const byPlayer = src === this.player;
    if (q.role === 'civ') {
      q.state = 'flee'; q.fleeT = 7; q.fromX = src ? src.x : q.x; q.fromY = src ? src.y : q.y;
      if (byPlayer && q.hp > 0) this.crime(kind === 'car' ? 12 : 7, q.x, q.y, 'assault');
    } else if (q.role === 'cop') { q.alert = true; if (byPlayer) this.crime(45, q.x, q.y, 'copassault'); }
    else { q.alert = true; }
    if (q.hp <= 0) {
      q.down = true; q.tdown = 0; q.ang = Math.atan2(q.vy, q.vx) || q.ang; q.state = 'down';
      this.sfx('down', q.x, q.y);
      if (byPlayer) {
        this.stats.kills++;
        if (q.role === 'civ') this.crime(16, q.x, q.y, 'kill');
        else if (q.role === 'cop') this.crime(75, q.x, q.y, 'copkill');
      }
      const drop = q.role === 'civ' ? this.rng.int(6, 34) : q.role === 'cop' ? this.rng.int(30, 80) : this.rng.int(40, 120);
      if (byPlayer || kind === 'car') this.pickups.push({ kind: 'cash', x: q.x, y: q.y, v: drop, life: 30 });
      if (q.role !== 'civ' && this.rng.chance(0.5)) this.pickups.push({ kind: 'ammo', x: q.x + 1, y: q.y + 0.5, v: 8, life: 30 });
      this.mis.onKill(q);
    }
  }
  hurtPlayer(dmg, src) {
    const p = this.player;
    if (this.dead > 0 || this.busted > 0 || this.godmode) return;
    p.hp -= dmg; p.hitFlash = 0.15; this.hurt = Math.min(1, this.hurt + dmg / 25); this.shake = Math.min(1, this.shake + dmg / 40);
    this.sfx('hurt', p.x, p.y);
    if (p.hp <= 0) { p.hp = 0; this.dead = 0.001; this.sfx('down', p.x, p.y); }
  }
  updateDead(dt) {
    this.dead += dt;
    const p = this.player;
    p.down = true;
    if (this.dead > 3.2) this.respawn(false);
  }
  updateBusted(dt) {
    this.busted += dt;
    if (this.busted > 3) this.respawn(true);
  }
  respawn(busted) {
    const p = this.player;
    const loss = Math.round(this.cash * (busted ? 0.15 : 0.1));
    this.cash = Math.max(0, this.cash - loss);
    if (p.inVeh) { p.inVeh.ai = 'none'; p.inVeh = null; }
    p.hidden = false; p.down = false; p.hp = 100; p.x = LOC.loft.x + 2; p.y = LOC.loft.y + 1; p.vx = p.vy = 0; p.reload = 0; p.clip = Math.max(p.clip, 6); p.reserve = Math.max(p.reserve, 24);
    this.dead = 0; this.busted = 0; this.heat = 0; this.heatPts = 0;
    for (const v of this.vehicles) if (v.ai === 'cop') { v.ai = 'traffic'; v.siren = false; }
    this.peds = this.peds.filter((q) => q.role !== 'cop' || q.down);
    this.cam.x = p.x; this.cam.y = p.y;
    this.banner = { text: busted ? 'BUSTED' : 'WASTED', sub: `Calder's loft · -${loss ? '$' + loss : '$0'}`, t: 0, dur: 3, kind: 'fail' };
    this.mis.onFail(busted ? 'Busted' : 'Wasted');
    this.save();
  }
  updatePickups(dt) {
    const p = this.player;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const k = this.pickups[i];
      if (k.life !== undefined) { k.life -= dt; if (k.life <= 0) { this.pickups.splice(i, 1); continue; } }
      if (Math.hypot(k.x - p.x, k.y - p.y) < 1.8 && !p.down) {
        if (k.kind === 'cash') { this.cash += k.v; this.floatText(k.x, k.y, '+$' + k.v); this.sfx('cash', p.x, p.y); }
        else if (k.kind === 'health') { if (p.hp >= 100) continue; p.hp = Math.min(100, p.hp + 35); this.floatText(k.x, k.y, '+HEALTH', '#ff9a8a'); this.sfx('pick', p.x, p.y); }
        else if (k.kind === 'ammo') { p.reserve += k.v || 12; this.floatText(k.x, k.y, '+AMMO', '#ffe08a'); this.sfx('pick', p.x, p.y); }
        else if (k.kind === 'case' || k.kind === 'ledger') { this.mis.onPickup(k); }
        this.pickups.splice(i, 1);
      }
    }
  }
  // ------------------------------------------------------------ bullets
  updateBullets(dt) {
    const p = this.player;
    for (const b of this.bullets) {
      for (let st = 0; st < 2 && b.life > 0; st++) {
        b.x += (b.vx * dt) / 2; b.y += (b.vy * dt) / 2; b.life -= dt / 2;
        if (this.world.solidsNear(b.x, b.y, 0.05, this.near).some((s) => s.tag !== 'water')) {
          b.life = 0; this.fx('spark', b.x, b.y, 1.2, { vx: -b.vx * 0.05, vy: -b.vy * 0.05, vz: 2, max: 0.3 }); this.fx('dust', b.x, b.y, 1.2, { vz: 0.5, max: 0.4, size: 0.4 }); this.sfx('ricochet', b.x, b.y);
          break;
        }
        for (const q of this.peds) {
          if (q.down || q === b.from) continue;
          if (b.hostile && q.role !== 'civ') continue;
          if (!b.hostile && false) continue;
          if (Math.hypot(q.x - b.x, q.y - b.y) < 0.6) { b.life = 0; this.hurtPed(q, b.dmg, b.from, 'shot'); q.vx += b.vx * 0.04; q.vy += b.vy * 0.04; break; }
        }
        if (b.life <= 0) break;
        if (b.hostile && !p.inVeh && !p.down && Math.hypot(p.x - b.x, p.y - b.y) < 0.65) { b.life = 0; this.hurtPlayer(b.dmg, 'shot'); break; }
        for (const v of this.vehicles) {
          if (v.dead || Math.abs(v.x - b.x) > 4 || Math.abs(v.y - b.y) > 4 || v.kinematic) continue;
          const m = MODELS[v.kind], c = Math.cos(v.ang), s = Math.sin(v.ang);
          const dx = b.x - v.x, dy = b.y - v.y, lx = dx * c + dy * s, ly = -dx * s + dy * c;
          if (Math.abs(lx) < m.len / 2 && Math.abs(ly) < m.wid / 2) {
            b.life = 0; this.damageVehicle(v, b.dmg * 0.7); this.fx('spark', b.x, b.y, 1, { vz: 2, max: 0.3 }); this.sfx('ricochet', b.x, b.y);
            if (v.ai === 'player') this.hurtPlayer(b.dmg * 0.15, 'shot');
            if (!b.hostile && b.from === p && v.hasDriver) { this.crime(8, v.x, v.y, 'shootcar'); }
            break;
          }
        }
      }
    }
    this.bullets = this.bullets.filter((b) => b.life > 0);
  }
  // ------------------------------------------------------------ heat
  crime(pts, x, y, kind) {
    // witnessed by a civilian, officer or police car nearby
    let seen = kind === 'copassault' || kind === 'copkill' || kind === 'ramcop' || kind === 'copcar';
    if (!seen) {
      for (const q of this.peds) { if (!q.down && q.role !== 'enemy' && q.role !== 'thug' && q.role !== 'boss' && Math.hypot(q.x - x, q.y - y) < 38) { seen = true; break; } }
      if (!seen) for (const v of this.vehicles) { if (v.ai === 'cop' && Math.hypot(v.x - x, v.y - y) < 90) { seen = true; break; } }
    }
    if (!seen) return;
    this.heatPts = Math.min(260, this.heatPts + pts);
    this.unseen = 0;
    this.updateHeatLevel();
  }
  updateHeatLevel() {
    const T = [1, 22, 55, 100, 160];
    let lv = 0;
    for (let i = 0; i < T.length; i++) if (this.heatPts >= T[i]) lv = i + 1;
    if (lv > this.heat) { this.heat = lv; this.heatFlash = 2; this.sfx('heat', 0, 0); this.toast(`HEAT ${lv}: the Harbour Constabulary is after you`, 'heat'); }
  }
  setHeat(lv) { this.heat = lv; this.heatPts = [0, 1, 22, 55, 100, 160][lv]; this.unseen = 0; this.heatFlash = 2; }
  updateHeat(dt) {
    this.heatFlash = Math.max(0, this.heatFlash - dt);
    if (this.heat <= 0) return;
    let near = 1e9;
    const p = this.player;
    for (const v of this.vehicles) if (v.ai === 'cop' && !v.dead) near = Math.min(near, Math.hypot(v.x - p.x, v.y - p.y));
    for (const q of this.peds) if (q.role === 'cop' && !q.down) near = Math.min(near, Math.hypot(q.x - p.x, q.y - p.y));
    this.copNear = near;
    if (near < 110) this.unseen = 0; else this.unseen += dt;
    if (this.unseen > 9) {
      this.heatPts -= dt * 4.5;
      if (this.heatPts <= 0) { this.heatPts = 0; this.heat = 0; this.toast('You lost them. Heat cleared.', 'good'); this.banner = { text: 'HEAT CLEARED', sub: 'The Constabulary lost your trail', t: 0, dur: 2.6, kind: 'good' }; this.sfx('clear', 0, 0); }
      else { const T = [1, 22, 55, 100, 160]; let lv = 0; for (let i = 0; i < T.length; i++) if (this.heatPts >= T[i]) lv = i + 1; this.heat = lv; }
    }
  }
  // ------------------------------------------------------------ save
  save() {
    if (this.noSave) return;
    try {
      const p = this.player;
      localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 1, cash: Math.round(this.cash), job: this.mis.idx, hp: Math.round(p.hp), clip: p.clip, reserve: p.reserve, stats: this.stats, done: this.mis.done, at: Date.now() }));
    } catch (e) { /* storage unavailable */ }
  }
  static readSave() {
    try { const s = localStorage.getItem(SAVE_KEY); return s ? JSON.parse(s) : null; } catch (e) { return null; }
  }
  applySave(s) {
    this.cash = s.cash || 0; this.player.reserve = s.reserve ?? 48; this.player.clip = s.clip ?? 12; this.stats = s.stats || this.stats;
    this.mis.restore(s.job || 0, !!s.done);
    this.player.hp = 100;
  }
}
