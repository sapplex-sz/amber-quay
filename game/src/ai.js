// AMBER QUAY: traffic, police, pedestrian and enemy behaviour plus population management.
import { clamp, angDiff, TAU } from './util.js';
import { MODELS, CIV_MODELS } from './defs.js';
import { NI, NJ, DIRS, LANE, nodeX, nodeY, edgeExists } from './world.js';

const COPCOL = { shirt: [40, 58, 112], pants: [28, 32, 50], hair: [40, 30, 26], skin: [218, 164, 120], cap: [26, 34, 72] };
const THUGCOL = (r) => ({ shirt: [r.pick([[54, 48, 66], [44, 58, 62], [70, 52, 50]])][0], pants: [34, 36, 44], hair: [30, 26, 26], skin: [r.pick([[218, 164, 120], [240, 205, 170], [170, 112, 78]])][0], scarf: [190, 214, 70], cap: r.chance(0.4) ? [30, 30, 36] : null });
export const BOSSCOL = { shirt: [238, 228, 202], pants: [70, 44, 44], hair: [200, 196, 190], skin: [240, 205, 170], scarf: [170, 40, 54] };

// ------------------------------------------------------------------ road helpers
export function nearestNode(x, y) {
  let bi = Math.round(x / 120), bj = 0, bd = 1e9;
  bi = clamp(bi, 0, NI - 1);
  for (let j = 0; j < NJ; j++) { const d = Math.abs(nodeY(j) - y); if (d < bd) { bd = d; bj = j; } }
  return [bi, bj];
}
export function bfsFrom(i0, j0) {
  const dist = new Int16Array(NI * NJ).fill(-1);
  const q = [[i0, j0]]; dist[j0 * NI + i0] = 0;
  for (let h = 0; h < q.length; h++) {
    const [i, j] = q[h];
    for (let k = 0; k < 4; k++) {
      if (!edgeExists(i, j, k)) continue;
      const ni = i + DIRS[k][0], nj = j + DIRS[k][1];
      if (dist[nj * NI + ni] >= 0) continue;
      dist[nj * NI + ni] = dist[j * NI + i] + 1; q.push([ni, nj]);
    }
  }
  return dist;
}
export function locateNav(v) {
  const k = ((Math.round(v.ang / (Math.PI / 2)) % 4) + 4) % 4;
  const [dx, dy] = DIRS[k];
  if (dy === 0) {
    let j = -1;
    for (let jj = 0; jj < NJ; jj++) if (Math.abs(v.y - nodeY(jj)) < 13) j = jj;
    if (j < 0) return null;
    const i = dx > 0 ? Math.ceil((v.x + 0.05) / 120) : Math.floor((v.x - 0.05) / 120);
    if (i < 0 || i >= NI || !edgeExists(i, j, (k + 2) % 4)) return null;
    return { i, j, dir: k, next: -1 };
  }
  let i = -1;
  for (let ii = 0; ii < NI; ii++) if (Math.abs(v.x - nodeX(ii)) < 13) i = ii;
  if (i < 0) return null;
  let j = -1;
  if (dy > 0) { for (let jj = 0; jj < NJ; jj++) if (nodeY(jj) > v.y + 0.05) { j = jj; break; } }
  else { for (let jj = NJ - 1; jj >= 0; jj--) if (nodeY(jj) < v.y - 0.05) { j = jj; break; } }
  if (j < 0 || !edgeExists(i, j, (k + 2) % 4)) return null;
  return { i, j, dir: k, next: -1 };
}
function pickDir(g, nav, v) {
  const opts = [];
  for (let k = 0; k < 4; k++) if (k !== (nav.dir + 2) % 4 && edgeExists(nav.i, nav.j, k)) opts.push(k);
  if (!opts.length) return (nav.dir + 2) % 4; // dead end: turn around
  if (v.ai === 'cop' && g.copDist) {
    let best = opts[0], bd = 1e9;
    for (const k of opts) { const d = g.copDist[(nav.j + DIRS[k][1]) * NI + nav.i + DIRS[k][0]]; const dd = d < 0 ? 999 : d + g.rng.next() * 0.2; if (dd < bd) { bd = dd; best = k; } }
    return best;
  }
  const w = opts.map((k) => (k === nav.dir ? 0.6 : 0.2));
  let r = g.rng.next() * w.reduce((a, b) => a + b, 0);
  for (let n = 0; n < opts.length; n++) { r -= w[n]; if (r <= 0) return opts[n]; }
  return opts[0];
}
export function hasLOS(g, x0, y0, x1, y1) {
  const d = Math.hypot(x1 - x0, y1 - y0);
  const n = Math.ceil(d / 3);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    const l = g.world.solidsNear(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, 0.2, g.near);
    for (const s of l) if (s.tag !== 'water' && s.tag !== 'pond' && s.tag !== 'tree') return false;
  }
  return true;
}
function sense(g, v, ignorePlayer) {
  const m = MODELS[v.kind];
  const c = Math.cos(v.ang), s = Math.sin(v.ang);
  let gap = 1e9;
  const reach = 8 + Math.abs(v.speed) * 1.1;
  for (const o of g.vehicles) {
    if (o === v || o.dead && false) continue;
    if (ignorePlayer && o.ai === 'player') continue;
    const dx = o.x - v.x, dy = o.y - v.y;
    if (Math.abs(dx) > 26 || Math.abs(dy) > 26) continue;
    const f = dx * c + dy * s, l = -dx * s + dy * c;
    const om = MODELS[o.kind];
    const ro = o.kind === 'tram' ? 9 : om.len * 0.5;
    if (f > 0 && f < reach + ro && Math.abs(l) < m.wid / 2 + om.wid / 2 * 0.9 + 0.35) gap = Math.min(gap, f - ro - m.len / 2);
  }
  for (const q of g.peds) {
    if (q.down) continue;
    const dx = q.x - v.x, dy = q.y - v.y;
    if (Math.abs(dx) > 14 || Math.abs(dy) > 14) continue;
    const f = dx * c + dy * s, l = -dx * s + dy * c;
    if (f > 0 && f < 9 && Math.abs(l) < m.wid / 2 + 0.7) gap = Math.min(gap, f - m.len / 2 - 0.4);
  }
  if (!g.player.inVeh && !g.player.down && !ignorePlayer) {
    const dx = g.player.x - v.x, dy = g.player.y - v.y, f = dx * c + dy * s, l = -dx * s + dy * c;
    if (f > 0 && f < 9 && Math.abs(l) < m.wid / 2 + 0.7) gap = Math.min(gap, f - m.len / 2 - 0.4);
  }
  return gap;
}
function followNav(g, v, dt, cruise, ignoreSignal) {
  const nav = v.nav;
  const [dx, dy] = DIRS[nav.dir];
  const nx = nodeX(nav.i), ny = nodeY(nav.j);
  const dist = (nx - v.x) * dx + (ny - v.y) * dy;
  if (nav.next < 0) { nav.next = pickDir(g, nav, v); if (nav.next < 0) { v.remove = true; v.ctl = { throttle: 0, steer: 0, brake: 1, hand: 0 }; return 0; } }
  const [ex, ey] = DIRS[nav.next];
  if (dist < 0.6) { nav.i += ex; nav.j += ey; nav.dir = nav.next; nav.next = -1; }
  const LA = 5.5 + Math.abs(v.speed) * 0.5;
  const t = LA - dist;
  let tx, ty;
  if (t <= 0) { tx = nx - dy * LANE + dx * t; ty = ny + dx * LANE + dy * t; if (false) tx = 0; }
  else { tx = nx - ey * LANE + ex * t; ty = ny + ex * LANE + ey * t; }
  // fix: right-hand vector of travel dir is (-dy, dx)
  const ta = Math.atan2(ty - v.y, tx - v.x);
  const err = angDiff(v.ang, ta);
  let steer = clamp(err * 2.4, -1, 1);
  if (v.speed < -0.5) steer = -steer;
  let target = cruise;
  if (nav.next !== nav.dir && dist < 26) target = Math.min(target, v.ai === 'cop' ? 10 : 6.6);
  if (!ignoreSignal && nav.i > 0 && nav.i < NI - 1 && nav.j > 0 && nav.j < 8 && dist > 0) {
    const st = g.signal(nav.dir % 2);
    const stop = 11.6;
    const bd = (v.speed * v.speed) / 9 + 3;
    if ((st === 'r' || (st === 'y' && dist > stop + v.speed * 0.9)) && dist > stop - 1.2 && dist < stop + bd) target = Math.min(target, Math.max(0, (dist - stop) * 1.1));
  }
  const gap = v.ghost > 0 ? 1e9 : sense(g, v, v.ai === 'cop');
  if (v.ghost > 0) v.ghost -= dt;
  if (gap < 1e8) target = Math.min(target, Math.max(0, gap * 0.85 - 1.2));
  v.blockedGap = gap;
  const sp = v.speed;
  const th = sp < target ? clamp((target - sp) * 0.5, 0, 1) : 0;
  const br = sp > target ? clamp((sp - target) * 0.4, 0, 1) : 0;
  v.ctl = { throttle: th, steer, brake: br, hand: 0 };
  return target;
}
export function trafficCtl(g, v, dt) {
  v.lights = true; v.siren = false;
  if (!v.nav) { v.nav = locateNav(v); if (!v.nav) { v.ctl = { throttle: 0, steer: 0, brake: 1, hand: 0 }; v.stuck += dt; if (v.stuck > 3) v.remove = true; return; } }
  const target = followNav(g, v, dt, v.cruise, false);
  if (Math.abs(v.speed) < 0.4 && target > 1.5) v.stuck += dt; else v.stuck = 0;
  if (v.stuck > 2.5 && v.blockedGap < 6 && g.tick % 90 === 0 && g.rng.chance(0.5)) { g.sfx('horn', v.x, v.y); v.honkT = 0.3; }
  if (v.stuck > 9 && !(v.ghost > 0)) { v.ghost = 3; v.stuck = 5; }
  if (v.stuck > 24) v.remove = true;
}
export function copCtl(g, v, dt) {
  const p = g.player;
  if (g.heat <= 0 || p.down) { v.ai = 'traffic'; v.siren = false; v.nav = null; v.stuck = 0; return; }
  v.siren = true; v.lights = true;
  const tx = p.x + (p.inVeh ? p.inVeh.vx * 0.5 : 0), ty = p.y + (p.inVeh ? p.inVeh.vy * 0.5 : 0);
  const d = Math.hypot(p.x - v.x, p.y - v.y);
  v.losT = (v.losT || 0) - dt;
  if (v.losT <= 0) { v.losT = 0.3; v.los = d < 90 && hasLOS(g, v.x, v.y, p.x, p.y); }
  if (v.revT > 0) {
    v.revT -= dt;
    v.ctl = { throttle: -1, steer: -(v.revSteer || 0), brake: 0, hand: 0 };
    return;
  }
  const direct = (d < 80 && v.los) || d < 16 || !v.nav;
  const cruise = 19 + g.heat * 2.4;
  if (direct) {
    const ta = Math.atan2(ty - v.y, tx - v.x), err = angDiff(v.ang, ta);
    const steer = clamp(err * 2.6, -1, 1);
    let target = d > 14 ? cruise + 6 : p.inVeh ? Math.max(8, Math.abs(p.inVeh.speed) + 4) : 5;
    if (Math.abs(err) > 1.1) target = Math.min(target, 9);
    const gap = sense(g, v, true);
    if (gap < 1e8) target = Math.min(target, Math.max(2, gap * 0.9));
    const sp = v.speed;
    v.ctl = { throttle: sp < target ? clamp((target - sp) * 0.6, 0, 1) : 0, steer, brake: sp > target + 2 ? clamp((sp - target) * 0.3, 0, 1) : 0, hand: 0 };
    if (Math.abs(sp) < 0.6 && d > 5) v.stuck += dt; else v.stuck = 0;
    if (v.stuck > 0.9) { v.revT = 0.9; v.revSteer = steer; v.stuck = 0; }
    if (!v.los && d > 30 && v.nav === null) v.nav = locateNav(v);
    if (!v.nav && !direct) return;
    if (v.nav === null && d >= 16) v.nav = locateNav(v);
  } else {
    followNav(g, v, dt, cruise, true);
    if (Math.abs(v.speed) < 0.5) v.stuck += dt; else v.stuck = 0;
    if (v.stuck > 1.5) { v.nav = null; v.revT = 0.8; v.revSteer = 0; v.stuck = 0; }
  }
  if (direct && d >= 16 && !v.nav && g.tick % 20 === 0) v.nav = locateNav(v);
}

// ------------------------------------------------------------------ pedestrians
export function pedUpdate(g, q, dt) {
  const pn = g.world.pn;
  if (q.state === 'flee') {
    let dx = q.x - q.fromX, dy = q.y - q.fromY; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
    q.vx += (dx * 6.4 - q.vx) * Math.min(1, dt * 8); q.vy += (dy * 6.4 - q.vy) * Math.min(1, dt * 8);
    q.ang = Math.atan2(q.vy, q.vx); q.moving = true;
    q.fleeT -= dt;
    if (q.fleeT <= 0) { q.state = 'walk'; q.node = -1; q.prev = -1; }
    g.moveCircle(q, dt, 0.35);
    return;
  }
  if (q.wait > 0) { q.wait -= dt; q.vx *= 0.8; q.vy *= 0.8; q.moving = false; g.moveCircle(q, dt, 0.35); return; }
  if (q.node < 0) {
    let bd = 1e9, bi = 0;
    for (let i = 0; i < pn.length; i++) { const d = (pn[i].x - q.x) ** 2 + (pn[i].y - q.y) ** 2; if (d < bd) { bd = d; bi = i; } }
    q.node = bi;
  }
  let n = pn[q.node];
  let dx = n.x - q.x, dy = n.y - q.y, d = Math.hypot(dx, dy);
  if (d < 1.0) {
    const nb = n.nb.filter((k) => k !== q.prev);
    const next = nb.length ? nb[Math.floor(g.rng.next() * nb.length)] : n.nb[0];
    q.prev = q.node; q.node = next; n = pn[next];
    dx = n.x - q.x; dy = n.y - q.y; d = Math.hypot(dx, dy);
    if (g.rng.chance(0.06)) q.wait = g.rng.range(1, 4);
  }
  // look out for cars
  q.look = (q.look || 0) - dt;
  if (q.look <= 0) {
    q.look = 0.25;
    for (const v of g.vehicles) {
      if (v.kinematic || Math.abs(v.x - q.x) > 9 || Math.abs(v.y - q.y) > 9) continue;
      const sp = Math.hypot(v.vx, v.vy);
      if (sp < 2.5) continue;
      const rx = q.x - v.x, ry = q.y - v.y;
      const dot = (rx * v.vx + ry * v.vy) / (sp * Math.hypot(rx, ry) + 1e-3);
      if (dot > 0.6 && Math.hypot(rx, ry) < 8.5) { if (Math.hypot(rx, ry) < 4 && v.ai === 'player') { q.state = 'flee'; q.fleeT = 3; q.fromX = v.x; q.fromY = v.y; } else q.wait = 0.5; break; }
    }
    const pl = g.player;
    if (g.heat > 0 && g.rng.chance(0.02) && Math.hypot(pl.x - q.x, pl.y - q.y) < 12 && pl.aimT > 0) { q.state = 'flee'; q.fleeT = 5; q.fromX = pl.x; q.fromY = pl.y; }
  }
  const sp = q.speed;
  q.vx += (dx / (d || 1) * sp - q.vx) * Math.min(1, dt * 6); q.vy += (dy / (d || 1) * sp - q.vy) * Math.min(1, dt * 6);
  q.ang += angDiff(q.ang, Math.atan2(q.vy, q.vx)) * Math.min(1, dt * 8);
  q.moving = true;
  g.moveCircle(q, dt, 0.35);
}

// ------------------------------------------------------------------ enemies, officers
export function enemyUpdate(g, q, dt) {
  const p = g.player;
  const dx = p.x - q.x, dy = p.y - q.y, d = Math.hypot(dx, dy);
  const toP = Math.atan2(dy, dx);
  const live = !p.down && g.dead <= 0 && g.busted <= 0;
  q.look = (q.look || 0) - dt;
  if (q.look <= 0) { q.look = 0.25; q.los = d < 45 && hasLOS(g, q.x, q.y, p.x, p.y); }
  let tvx = 0, tvy = 0, moveSp = 5;
  q.moving = false;
  if (q.role === 'cop') {
    if (g.heat <= 0 || !live) {
      q.state = 'idle';
      if (d > 70 || !live) { q.fadeT = (q.fadeT || 0) + dt; if (q.fadeT > 6 && d > 40) q.remove = true; }
    } else {
      q.state = 'chase';
      moveSp = 5.4 + g.heat * 0.35;
      const gun = g.heat >= 2;
      if (gun && q.los && d < 28) {
        // hold at range and fire
        if (d > 13) { tvx = Math.cos(toP) * moveSp; tvy = Math.sin(toP) * moveSp; }
        q.aim = toP; q.aimT = 1.2; q.armed = true;
        if (q.cd <= 0) { q.cd = 1.15 - g.heat * 0.07 + g.rng.next() * 0.3; g.fire(q, toP + (g.rng.next() - 0.5) * 0.2, true, 4 + g.heat); }
      } else if (d > 1.5) { tvx = Math.cos(toP) * moveSp; tvy = Math.sin(toP) * moveSp; q.armed = false; }
      // arrest
      if (d < 1.9 && !p.inVeh || (p.inVeh && Math.abs(p.inVeh.speed) < 2.5 && d < 4.5)) {
        q.arrestT = (q.arrestT || 0) + dt;
        if (q.arrestT > 1.6 && g.busted <= 0) { g.busted = 0.001; g.sfx('busted', p.x, p.y); }
      } else q.arrestT = Math.max(0, (q.arrestT || 0) - dt);
    }
  } else {
    // Kestrel crews
    const aggro = q.alert || d < (q.aggro || 36);
    if (aggro && live) {
      q.alert = true; q.state = 'chase';
      moveSp = q.role === 'boss' ? 4.4 : q.gun ? 4.2 : 5.4;
      if (q.gun) {
        const want = q.role === 'boss' ? 12 : 9 + (q.id % 5);
        if (q.los) {
          q.aim = toP; q.aimT = 1.2; q.armed = true;
          if (d > want + 3) { tvx = Math.cos(toP) * moveSp; tvy = Math.sin(toP) * moveSp; }
          else if (d < want - 3) { tvx = -Math.cos(toP) * moveSp * 0.6; tvy = -Math.sin(toP) * moveSp * 0.6; }
          else { const sd = q.id % 2 ? 1 : -1; tvx = -Math.sin(toP) * sd * 2.6; tvy = Math.cos(toP) * sd * 2.6; }
          if (q.cd <= 0 && d < 36) { q.cd = (q.role === 'boss' ? 0.55 : 1.05) + g.rng.next() * 0.5; g.fire(q, toP + (g.rng.next() - 0.5) * (q.role === 'boss' ? 0.1 : 0.2), true, q.dmg || 6); }
        } else { tvx = Math.cos(toP) * moveSp; tvy = Math.sin(toP) * moveSp; q.armed = false; }
      } else {
        if (d > 1.7) { tvx = Math.cos(toP) * moveSp; tvy = Math.sin(toP) * moveSp; }
        else if (q.cd <= 0 && !p.inVeh) {
          q.cd = 0.85; q.punch = 0.2; q.aim = toP; g.hurtPlayer(q.dmg || 8, 'melee'); g.sfx('punch', q.x, q.y);
          p.vx += Math.cos(toP) * 3; p.vy += Math.sin(toP) * 3;
        }
      }
    } else q.state = 'idle';
  }
  const k = Math.min(1, dt * 8);
  q.vx += (tvx - q.vx) * k; q.vy += (tvy - q.vy) * k;
  if (Math.abs(q.vx) + Math.abs(q.vy) > 0.3) { q.moving = true; if (q.aimT <= 0) q.ang += angDiff(q.ang, Math.atan2(q.vy, q.vx)) * Math.min(1, dt * 10); else q.ang = q.aim; }
  else if (q.aimT > 0) q.ang = q.aim;
  g.moveCircle(q, dt, 0.4);
  // separate from each other a little
  for (const o of g.peds) { if (o === q || o.down || o.role === 'civ') continue; const ddx = q.x - o.x, ddy = q.y - o.y, dd = Math.hypot(ddx, ddy); if (dd < 0.9 && dd > 0.01) { q.x += (ddx / dd) * (0.9 - dd) * 0.5; q.y += (ddy / dd) * (0.9 - dd) * 0.5; } }
}
export function makeEnemy(g, x, y, kind) {
  const r = g.rng;
  if (kind === 'boss') { const q = g.addPed(x, y, { role: 'boss', hp: 240, bar: true, col: BOSSCOL }); q.gun = true; q.dmg = 9; q.alert = true; q.aggro = 70; q.name = 'CORBIN VELL'; return q; }
  const q = g.addPed(x, y, { role: 'thug', hp: kind === 'gun' ? 60 : 85, bar: true, col: THUGCOL(r) });
  q.gun = kind === 'gun'; q.dmg = q.gun ? 6 : 9; q.aggro = 50;
  return q;
}
export function makeCop(g, x, y) {
  const q = g.addPed(x, y, { role: 'cop', hp: 60, bar: true, col: COPCOL });
  q.alert = true; return q;
}

// ------------------------------------------------------------------ population
function offscreen(g, x, y) {
  const c = g.cam;
  return Math.abs(x - c.x) > 125 || Math.abs(y - c.y) > 100;
}
export function spawnTraffic(g, anywhere, fx, fy) {
  const r = g.rng;
  for (let tries = 0; tries < 14; tries++) {
    const i = r.int(0, NI - 1), j = r.int(0, NJ - 1);
    const dirs = []; for (let k = 0; k < 4; k++) if (edgeExists(i, j, k)) dirs.push(k);
    if (!dirs.length) continue;
    const k = r.pick(dirs);
    const [dx, dy] = DIRS[k];
    const bi = i + dx, bj = j + dy;
    const len = Math.hypot(nodeX(bi) - nodeX(i), nodeY(bj) - nodeY(j));
    const f = r.range(0.2, 0.8) * len;
    const x = nodeX(i) + dx * f - dy * LANE, y = nodeY(j) + dy * f + dx * LANE;
    const dd = Math.hypot(x - fx, y - fy);
    if (anywhere ? dd > 230 || dd < 15 : (dd < 105 || dd > 280 || !offscreen(g, x, y))) continue;
    if (g.vehicles.some((o) => Math.abs(o.x - x) < 8 && Math.abs(o.y - y) < 8)) continue;
    const kind = r.pick(CIV_MODELS);
    const v = g.makeVehicle(kind, x, y, Math.atan2(dy, dx), null, { ai: 'traffic', driver: true });
    v.nav = { i: bi, j: bj, dir: k, next: -1 };
    v.vx = dx * 8; v.vy = dy * 8; v.speed = 8;
    return v;
  }
  return null;
}
export function spawnPed(g, anywhere, fx, fy) {
  const r = g.rng, pn = g.world.pn;
  for (let tries = 0; tries < 14; tries++) {
    const idx = r.int(0, pn.length - 1), n = pn[idx];
    const dd = Math.hypot(n.x - fx, n.y - fy);
    if (anywhere ? dd > 150 : (dd < 60 || dd > 240 || !offscreen(g, n.x, n.y))) continue;
    const q = g.addPed(n.x + r.range(-0.5, 0.5), n.y + r.range(-0.5, 0.5), {});
    q.node = n.nb[r.int(0, n.nb.length - 1)]; q.prev = idx;
    return q;
  }
  return null;
}
export function fillWorld(g, fx, fy, nPeds, nCars) {
  let n = 0;
  for (let t = 0; t < nPeds * 12 && n < nPeds; t++) if (spawnPed(g, true, fx, fy)) n++;
  n = 0;
  for (let t = 0; t < nCars * 12 && n < nCars; t++) if (spawnTraffic(g, true, fx, fy)) n++;
}
export function population(g, dt) {
  g.popTimer -= dt;
  if (g.popTimer > 0) return;
  g.popTimer = 0.35;
  const fx = g.cam.x, fy = g.cam.y;
  const title = g.mode === 'title';
  let nPed = 0, nCar = 0;
  for (const q of g.peds) if (q.role === 'civ' && !q.down) nPed++;
  for (const v of g.vehicles) if (v.ai === 'traffic') nCar++;
  if (!g.noPop) {
    const wantP = title ? 34 : 48, wantC = title ? 16 : 22;
    if (nPed < wantP) spawnPed(g, false, fx, fy);
    if (nCar < wantC) spawnTraffic(g, false, fx, fy);
  }
  for (const q of g.peds) if (q.role === 'civ' && Math.hypot(q.x - fx, q.y - fy) > 290) q.remove = true;
  let wrecks = 0;
  for (const v of g.vehicles) {
    if (v.parked || v.kinematic || v.ai === 'player') continue;
    const far = Math.hypot(v.x - fx, v.y - fy);
    if (v.dead) wrecks++;
    if ((far > 320 && v.ai !== 'cop') || (v.remove && offscreen(g, v.x, v.y)) || (v.dead && v.boomed && far > 140) || (v.ai === 'cop' && far > 380)) v.remove2 = true;
  }
  if (g.vehicles.some((v) => v.remove2)) g.vehicles = g.vehicles.filter((v) => !v.remove2);
}
export function policeUpdate(g, dt) {
  if (g.mode !== 'play') return;
  const p = g.player;
  g.pathTimer -= dt;
  if (g.heat > 0 && g.pathTimer <= 0) {
    g.pathTimer = 0.6;
    const [i, j] = nearestNode(p.x, p.y);
    g.copDist = bfsFrom(i, j);
  }
  if (g.heat <= 0) return;
  g.copTimer -= dt;
  const want = [0, 1, 2, 3, 4, 6][g.heat];
  let cars = 0, officers = 0;
  for (const v of g.vehicles) if (v.ai === 'cop' && !v.dead) cars++;
  for (const q of g.peds) if (q.role === 'cop' && !q.down) officers++;
  const deployedCars = g.vehicles.filter((v) => v.deployed && !v.dead).length;
  if (cars + deployedCars < want && g.copTimer <= 0 && !g.noCops) {
    g.copTimer = 2.4;
    for (let tries = 0; tries < 20; tries++) {
      const i = g.rng.int(0, NI - 1), j = g.rng.int(0, NJ - 1);
      const dirs = []; for (let k = 0; k < 4; k++) if (edgeExists(i, j, k)) dirs.push(k);
      if (!dirs.length) continue;
      const dd = Math.hypot(nodeX(i) - p.x, nodeY(j) - p.y);
      if (dd < 120 || dd > 240 || !offscreen(g, nodeX(i), nodeY(j))) continue;
      // face roughly toward the player
      let best = dirs[0], bd = 1e9;
      for (const k of dirs) { const d2 = Math.hypot(nodeX(i) + DIRS[k][0] * 60 - p.x, nodeY(j) + DIRS[k][1] * 60 - p.y); if (d2 < bd) { bd = d2; best = k; } }
      const [dx, dy] = DIRS[best];
      const x = nodeX(i) + dx * 20 - dy * LANE, y = nodeY(j) + dy * 20 + dx * LANE;
      if (g.vehicles.some((o) => Math.abs(o.x - x) < 8 && Math.abs(o.y - y) < 8)) continue;
      const v = g.makeVehicle('police', x, y, Math.atan2(dy, dx), null, { ai: 'cop', driver: true });
      v.nav = { i: i + dx, j: j + dy, dir: best, next: -1 }; v.vx = dx * 12; v.vy = dy * 12; v.speed = 12; v.siren = true;
      if (!edgeExists(i, j, best)) v.nav = null;
      g.sfx('siren_spawn', x, y);
      break;
    }
  }
  // deploy officers from cruisers that reach a stationary player
  for (const v of g.vehicles) {
    if (v.ai !== 'cop' || v.dead || v.deployed) continue;
    const d = Math.hypot(v.x - p.x, v.y - p.y);
    const playerStill = !p.inVeh || Math.abs(p.inVeh.speed) < 3;
    if (d < 16 && playerStill && Math.abs(v.speed) < 6 && officers < 8) {
      v.deployed = true; v.ai = 'none'; v.ctl = { throttle: 0, steer: 0, brake: 1, hand: 0 }; v.siren = true;
      const c = Math.cos(v.ang), s = Math.sin(v.ang);
      for (const sg of [1, -1]) { if (sg < 0 && g.heat < 2) continue; makeCop(g, v.x - s * sg * 2.2, v.y + c * sg * 2.2); officers++; }
    }
  }
}
