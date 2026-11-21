// AMBER QUAY: bootstrap, input, main loop, title/pause flow and the deterministic ?shot= photo modes.
import { buildWorld, LOC } from './world.js';
import { Game } from './game.js';
import { Renderer } from './render.js';
import { UI } from './ui.js';
import { AudioMix } from './audio.js';
import { fillWorld } from './ai.js';
import { trafficCtl } from './ai.js';
import { makeEnemy, makeCop } from './ai.js';
import { money } from './util.js';

const canvas = document.getElementById('game');
const params = new URLSearchParams(location.search);
const shot = params.get('shot');
const seed = parseInt(params.get('seed') || '1', 10) || 1;
window.addEventListener('error', (e) => { document.documentElement.dataset.err = (document.documentElement.dataset.err || '') + ' | ' + e.message + ' @' + (e.filename || '').split('/').pop() + ':' + e.lineno; });
window.addEventListener('unhandledrejection', (e) => { document.documentElement.dataset.err = (document.documentElement.dataset.err || '') + ' | ' + String(e.reason); });

class Input {
  constructor() {
    this.keys = new Set(); this.edge = new Set();
    this.mouse = { x: 640, y: 360, down: false, pressed: false, rpressed: false };
  }
  down(c) { return this.keys.has(c); }
  pressed(c) { return this.edge.has(c); }
  flush() { this.edge.clear(); this.mouse.pressed = false; this.mouse.rpressed = false; }
}
const inp = new Input();
const world = buildWorld();
const game = new Game(world);
const r = new Renderer(canvas);
r.buildMap(world);
game.renderCam = r.cam;
const ui = new UI();
const audio = new AudioMix();
let frozen = false;

function refreshSaveInfo() {
  const s = Game.readSave();
  ui.hasSave = !!s;
  ui.saveInfo = s ? (s.done ? 'FREE ROAM' : `JOB ${Math.min(3, (s.job || 0) + 1)}`) + ' · ' + money(s.cash || 0) : '';
}
function titleScene() {
  game.init(seed);
  game.mode = 'title'; game.camLocked = true; game.noSave = true;
  game.player.hidden = true;
  game.cam.x = 700; game.cam.y = 800; game.cam.S = 4.6; game.cam.yaw = -0.45;
  fillWorld(game, 700, 800, 70, 26);
  game.markers = [];
}
function startPlay(save) {
  game.init((Math.random() * 1e6) | 0);
  game.mode = 'play'; game.camLocked = false; game.noSave = false;
  game.cam.x = game.player.x; game.cam.y = game.player.y;
  fillWorld(game, game.player.x, game.player.y, 40, 14);
  if (save) { game.applySave(save); game.mis.start(false); } else game.mis.start(true);
  game.banner = { text: 'AMBER QUAY', sub: 'Rookspire · late afternoon', t: 0, dur: 3, kind: 'warn' };
  ui.sel = 0; ui.overlay = null;
  for (const v of game.vehicles) if (v.ai === 'traffic') { /* keep */ }
}
function toTitle() { refreshSaveInfo(); titleScene(); ui.sel = 0; ui.overlay = null; }

// ------------------------------------------------------------------ input events
const GAMEKEYS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab']);
addEventListener('keydown', (e) => {
  audio.init();
  if (GAMEKEYS.has(e.code)) e.preventDefault();
  if (e.repeat) return;
  const c = e.code;
  if (ui.overlay === 'controls') { ui.overlay = null; return; }
  if (game.mode === 'title') {
    const items = ui.items(game);
    if (c === 'ArrowUp' || c === 'KeyW') { do { ui.sel = (ui.sel + items.length - 1) % items.length; } while (items[ui.sel][2]); }
    else if (c === 'ArrowDown' || c === 'KeyS') { do { ui.sel = (ui.sel + 1) % items.length; } while (items[ui.sel][2]); }
    else if (c === 'Enter' || c === 'Space') menuAct(items[ui.sel][1]);
    else if (c === 'KeyM') audio.musicOn = !audio.musicOn;
    return;
  }
  if (game.paused) {
    const items = ui.items(game);
    if (c === 'ArrowUp' || c === 'KeyW') ui.sel = (ui.sel + items.length - 1) % items.length;
    else if (c === 'ArrowDown' || c === 'KeyS') ui.sel = (ui.sel + 1) % items.length;
    else if (c === 'Enter' || c === 'Space') menuAct(items[ui.sel][1]);
    else if (c === 'Escape' || c === 'KeyP') game.paused = false;
    return;
  }
  if (c === 'Escape' || c === 'KeyP') { game.paused = true; ui.sel = 0; return; }
  if (c === 'KeyM') audio.musicOn = !audio.musicOn;
  inp.keys.add(c); inp.edge.add(c);
});
addEventListener('keyup', (e) => { inp.keys.delete(e.code); });
addEventListener('blur', () => { inp.keys.clear(); if (game.mode === 'play' && !frozen) game.paused = true; });
canvas.addEventListener('mousemove', (e) => {
  inp.mouse.x = e.clientX; inp.mouse.y = e.clientY;
  if (game.mode === 'title' || game.paused) { const h = ui.hit(e.clientX, e.clientY); if (h >= 0 && !ui.items(game)[h][2]) ui.sel = h; }
});
canvas.addEventListener('mousedown', (e) => {
  audio.init();
  if (ui.overlay === 'controls') { ui.overlay = null; return; }
  if (game.mode === 'title' || game.paused) {
    const h = ui.hit(e.clientX, e.clientY);
    if (h >= 0 && !ui.items(game)[h][2]) menuAct(ui.items(game)[h][1]);
    return;
  }
  if (e.button === 0) { inp.mouse.down = true; inp.mouse.pressed = true; } else if (e.button === 2) { inp.mouse.rpressed = true; }
});
addEventListener('mouseup', (e) => { if (e.button === 0) inp.mouse.down = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
function menuAct(id) {
  if (id === 'new') startPlay(null);
  else if (id === 'continue') { const s = Game.readSave(); if (s) startPlay(s); }
  else if (id === 'controls') ui.overlay = 'controls';
  else if (id === 'resume') game.paused = false;
  else if (id === 'save') { game.save(); game.toast('Game saved', 'good'); game.paused = false; }
  else if (id === 'quit') { game.save(); game.paused = false; toTitle(); }
}

// ------------------------------------------------------------------ photo modes
function runSteps(n, each) { for (let i = 0; i < n; i++) { if (each) each(i); game.step(1 / 60, inp); inp.flush(); } }
function setupShot(name) {
  frozen = true;
  game.noSave = true;
  if (name === 'title') {
    titleScene();
    runSteps(420);
    game.cam.x = 690; game.cam.y = 890; game.cam.S = 4.2; game.cam.yaw = -0.5;
    refreshShotTitle();
    return;
  }
  game.init(seed);
  game.mode = 'play'; game.camLocked = false; game.noSave = true; game.noPop = true;
  const p = game.player;
  game.cash = 1840;
  game.mis.idx = 1; game.mis.done = false;
  if (name === 'downtown') {
    const car = game.vehicles.find((v) => v.special === 'marlin');
    car.x = 722.5; car.y = 478; car.ang = -Math.PI / 2; car.vx = 0; car.vy = -13; car.speed = 13; car.parked = false;
    car.nav = { i: 6, j: 3, dir: 3, next: -1 }; car.cruise = 13;
    game.mis.car = car; game.enterVehicle(car); game.autopilot = true;
    game.mis.setStep('drive');
    game.cam.x = 722; game.cam.y = 440; game.cam.S = 8.8;
    game.noPop = false;
    fillWorld(game, 722, 450, 150, 46);
    // a tight bunch of traffic near the player
    for (let k = 0; k < 12; k++) { const v = game.makeVehicle(['sedan', 'taxi', 'hatch', 'van', 'pickup', 'sedan'][k % 6], k % 2 ? 717.5 : 727.5, 420 - k * 24 + (k % 2) * 14, k % 2 ? Math.PI / 2 : -Math.PI / 2, null, { ai: 'traffic', driver: true }); v.nav = { i: 6, j: k % 2 ? (420 - k * 24 > 360 ? 4 : 3) : (420 - k * 24 > 360 ? 3 : 2), dir: k % 2 ? 1 : 3, next: -1 }; v.cruise = 9; v.vx = 0; v.vy = k % 2 ? 7 : -7; }
    game.noPop = true;
    runSteps(150);
    game.districtT = 0;
  } else if (name === 'chase') {
    const car = game.vehicles.find((v) => v.special === 'marlin');
    car.x = 597.5; car.y = 925; car.ang = Math.PI / 2; car.vx = 0; car.vy = 24; car.speed = 24; car.parked = false;
    car.nav = { i: 5, j: 8, dir: 1, next: -1 }; car.cruise = 26;
    game.mis.car = car; game.enterVehicle(car); game.autopilot = true;
    game.mis.setStep('drive');
    game.setHeat(4); game.heatPts = 120; game.cam.x = 597; game.cam.y = 960; game.cam.S = 7.6;
    const spots = [[597.5, 903, 0], [603, 888, 1], [598, 872, 0], [602.5, 856, 1], [596, 838, 0]];
    spots.forEach(([x, y, k], i) => { const v = game.makeVehicle('police', x, y, Math.PI / 2, null, { ai: 'cop', driver: true }); v.vx = 0; v.vy = 25; v.speed = 25; v.siren = true; v.nav = { i: 5, j: 8, dir: 1, next: -1 }; });
    // oncoming civilian traffic on the bridge lane
    for (const [y, k] of [[1060, 0], [1010, 1]]) { const v = game.makeVehicle(k ? 'van' : 'taxi', 602.5, y, -Math.PI / 2, null, { ai: 'traffic', driver: true }); v.nav = { i: 5, j: 7, dir: 3, next: -1 }; v.vy = -8; v.vx = 0; v.speed = 8; }
    game.noCops = true;
    runSteps(70);
    game.districtT = 0;
  } else if (name === 'mission') {
    game.mis.idx = 2; game.mis.setStep('boss');
    p.x = 817; p.y = 810; p.ang = Math.PI; p.weapon = 'pistol'; p.clip = 8; p.reserve = 36; p.hp = 72;
    game.cam.x = 800; game.cam.y = 795; game.cam.S = 13.2; game.camLocked = true;
    game.cam.yawOff = 0.12; game.cam.yaw = -0.3 + 0.12;
    game.vehicles = game.vehicles.filter((v) => !(v.parked && Math.hypot(v.x - 800, v.y - 804) < 60));
    const boss = makeEnemy(game, 793, 806, 'boss'); boss.hp = 180; boss.ang = 0;
    const t1 = makeEnemy(game, 783, 817, 'gun'); const t2 = makeEnemy(game, 797, 796, 'gun'); const t3 = makeEnemy(game, 805, 818, 'melee');
    const dead = makeEnemy(game, 828, 816, 'melee'); game.hurtPed(dead, 999, p, 'shot');
    game.districtT = 0; game.mis.enemies = [boss, t1, t2, t3]; game.mis.boss = boss;
    const wreck = game.makeVehicle('sedan', 836, 796, 0.4, [60, 70, 100], {}); wreck.hp = 0; wreck.hp = -1; game.wreck(wreck); wreck.burnT = 0;
    const cop = game.makeVehicle('police', 822, 770, 0.2, null, { ai: 'none' }); cop.siren = true;
    game.pickups = game.pickups.filter((k) => Math.hypot(k.x - 810, k.y - 800) > 40);
    game.noPop = true;
    runSteps(60, (i) => { p.aim = Math.PI + 0.04; p.aimT = 2; });
    p.aim = Math.PI + 0.02; p.aimT = 2.4; p.ang = p.aim;
    game.fire(p, p.aim, false, 24);
    game.sfx('shot', p.x, p.y);
    game.events.length = 0;
    t1.flash = 0.05; t1.aim = 0; t1.aimT = 1;
    runSteps(1, () => { p.aim = Math.PI + 0.02; p.aimT = 2.4; });
    game.fire(p, p.aim, false, 24);
    game.events.length = 0;
  }
  endShot();
}
function endShot() { game.districtT = 0; game.toasts.length = 0; game.dialog.length = 0; }
function refreshShotTitle() { ui.hasSave = true; ui.saveInfo = 'JOB 2 · ' + money(1840); ui.sel = 0; }

// ------------------------------------------------------------------ main loop
function sync() {
  const c = game.cam, rc = r.cam;
  rc.x = c.x + c.shx; rc.y = c.y + c.shy; rc.yaw = c.yaw; rc.S = c.S;
}
function draw() {
  r.resize();
  sync();
  r.draw(game, (ctx) => {
    const W = r.W, H = r.H;
    if (game.mode === 'title') ui.title(ctx, game, W, H);
    else { ui.hud(ctx, game, r, W, H); if (game.paused) ui.pause(ctx, game, W, H); }
  });
}
let last = performance.now(), acc = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (!frozen) {
    acc += dt;
    let n = 0;
    while (acc >= 1 / 60 && n < 5) {
      if (game.mode === 'title') { const t = game.time; game.cam.x = 700 + Math.sin(t * 0.07) * 50; game.cam.y = 800 + Math.cos(t * 0.05) * 24; game.cam.yaw = -0.5 + Math.sin(t * 0.04) * 0.12; }
      if (game.autopilot && game.player.inVeh) { /* scripted drive handled in step */ }
      game.step(1 / 60, inp); inp.flush(); acc -= 1 / 60; n++;
    }
    if (n === 5) acc = 0;
    audio.update(game, game.cam, dt, game.mode === 'play' && !game.paused);
  }
  draw();
  requestAnimationFrame(frame);
}

// the game exposes autopilot for photo modes: when set, the player's car follows its lane
const origDrive = game.drive.bind(game);
game.drive = (v, i, dt) => { if (game.autopilot) { trafficCtl(game, v, dt); v.lights = true; } else origDrive(v, i, dt); };

if (shot) {
  setupShot(shot);
  draw(); draw();
  requestAnimationFrame(() => { draw(); requestAnimationFrame(() => { draw(); document.documentElement.dataset.shotReady = '1'; }); });
  requestAnimationFrame(frame);
} else {
  refreshSaveInfo();
  titleScene();
  document.documentElement.dataset.ready = '1';
  requestAnimationFrame(frame);
}
window.__aq = { game, r, ui };
