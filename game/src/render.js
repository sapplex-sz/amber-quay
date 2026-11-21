// AMBER QUAY: the custom 2.5D canvas renderer (ground, shadows, depth-sorted solids, lights, atmosphere, minimap).
import { clamp, rgba, TAU, hash2, lerp } from './util.js';
import { Camera, fillFace, makeFacade, faceNormal, facing, lightFor, SHADOW, SUN, vignette, FONT } from './gfx.js';
import { MODELS } from './defs.js';
import { WATER, BOUNDS, NI, NJ, nodeX, nodeY, edgeExists, HALF, ASPH, BRIDGE_X, zoneOf } from './world.js';

const COL = {
  land: [204, 188, 154], outer: [128, 112, 88], asphalt: [66, 66, 80], walk: [216, 200, 172], apron: [196, 184, 166],
  yard: [158, 148, 132], grass: [118, 156, 86], plank: [156, 112, 72], cobble: [210, 182, 140],
};
const BRIDGE = (() => {
  const mk = (id, x0, y0, x1, y1, z0, z1, wall) => ({ id, x0, y0, x1, y1, z0, z1, wall, style: 'plain', roofKind: 'flat', roof: wall, solid: true, tex: [null, null, null, null] });
  const parts = [];
  let id = 9000;
  for (const y of [1066]) {
    for (const x of [582.4, 615.4]) parts.push(mk(id++, x, y - 1.6, x + 2.2, y + 1.6, 0, 46, [236, 226, 206]));
    parts.push(mk(id++, 582.4, y - 1.2, 617.6, y + 1.2, 32, 34.4, [226, 214, 190]));
    parts.push(mk(id++, 582.4, y - 1.0, 617.6, y + 1.0, 44, 46, [226, 214, 190]));
  }
  return { type: 'b', parts, x0: 580, y0: 1000, x1: 620, y1: 1130, h: 46, bridge: true };
})();

export class Renderer {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.cam = new Camera();
    this.frame = 1;
    this.tmp = [];
    this.list = [];
    this.lamps = [];
    this.mapCv = null;
    this.W = 1280; this.H = 720;
    this.dpr = 1;
  }
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.max(320, Math.round(window.innerWidth)), h = Math.max(240, Math.round(window.innerHeight));
    this.dpr = dpr;
    if (this.cv.width !== Math.round(w * dpr) || this.cv.height !== Math.round(h * dpr)) { this.cv.width = Math.round(w * dpr); this.cv.height = Math.round(h * dpr); }
    this.W = w; this.H = h;
    this.cam.W = w; this.cam.H = h;
  }
  // ---------------------------------------------------------------- frame
  draw(g, hudFn) {
    const ctx = this.ctx, cam = this.cam;
    this.frame++;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    cam.upd();
    this.g = g;
    this.ground(g);
    const bb = cam.bbox(70, 150);
    const stamp = this.frame;
    const items = this.list; items.length = 0;
    const lamps = this.lamps; lamps.length = 0;
    const statics = g.world.cellsIn(bb[0], bb[1], bb[2], bb[3], stamp, this.tmp);
    const shadowPath = [];
    for (const o of statics) {
      if (o.type === 'b') { items.push({ d: this.bdepth(o), o, k: 0 }); this.shadowB(o, shadowPath); }
      else {
        if (o.kind === 'lamp') lamps.push(o);
        items.push({ d: cam.depth(o.x, o.y), o, k: 1 });
        if (o.kind === 'tree') this.shadowT(o, shadowPath);
        else if (o.kind === 'lamp') this.shadowL(o, shadowPath);
      }
    }
    if (bb[0] < 620 && bb[2] > 580 && bb[1] < 1130 && bb[3] > 1000) { items.push({ d: cam.depth(600, 1068), o: BRIDGE, k: 0 }); }
    for (const v of g.vehicles) { if (this.inView(v.x, v.y, 20)) { items.push({ d: cam.depth(v.x, v.y), o: v, k: 2 }); this.shadowV(v, shadowPath); } }
    for (const p of g.peds) { if (this.inView(p.x, p.y, 4)) { items.push({ d: cam.depth(p.x, p.y), o: p, k: 3 }); } }
    if (!g.player.hidden) items.push({ d: cam.depth(g.player.x, g.player.y) + 0.05, o: g.player, k: 3 });
    for (const k of g.pickups) { if (this.inView(k.x, k.y, 4)) items.push({ d: cam.depth(k.x, k.y), o: k, k: 4 }); }
    this.drawShadows(shadowPath, g);
    this.skids(g);
    items.sort((a, b) => a.d - b.d);
    const pl = g.player;
    this.plx = pl.x; this.ply = pl.y; this.pld = cam.depth(pl.x, pl.y); this.plr = pl.inVeh ? 2.6 : 1.4;
    for (const it of items) {
      switch (it.k) {
        case 0: this.drawBuilding(it.o, g); break;
        case 1: this.drawProp(it.o, g); break;
        case 2: this.drawVehicle(it.o, g); break;
        case 3: this.drawPed(it.o, g); break;
        case 4: this.drawPickup(it.o, g); break;
      }
    }
    this.drawBoats(g);
    this.drawFX(g);
    this.lights(g, lamps);
    this.atmosphere(g);
    if (hudFn) hudFn(ctx);
  }
  inView(x, y, m) {
    const cam = this.cam; cam.p(x, y, 0);
    return cam.ox > -m * cam.S && cam.ox < cam.W + m * cam.S && cam.oy > -m * cam.S * 2.5 && cam.oy < cam.H + m * cam.S * 1.5;
  }
  bdepth(b) {
    const cam = this.cam;
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    const ext = 0.5 * (Math.abs(b.x1 - b.x0) * Math.abs(cam.sY) + Math.abs(b.y1 - b.y0) * Math.abs(cam.cY));
    return cam.depth(cx, cy) + ext * 0.3;
  }
  // ---------------------------------------------------------------- ground
  quad(pts, fill, z = 0) {
    const ctx = this.ctx, cam = this.cam;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) { cam.p(pts[i][0], pts[i][1], z); i ? ctx.lineTo(cam.ox, cam.oy) : ctx.moveTo(cam.ox, cam.oy); }
    ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  }
  rect(x0, y0, x1, y1, fill, z = 0) { this.quad([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], fill, z); }
  ground(g) {
    const ctx = this.ctx, cam = this.cam, S = cam.S;
    const bb = cam.bbox(30);
    ctx.fillStyle = rgba(COL.outer); ctx.fillRect(0, 0, this.W, this.H);
    // outer horizon hills hint
    this.rect(BOUNDS.x0 - 600, BOUNDS.y0 - 600, BOUNDS.x1 + 600, BOUNDS.y1 + 600, rgba([150, 134, 100]));
    // dark surround and a perimeter wall so the edge of Rookspire reads as an edge
    this.rect(BOUNDS.x0 - 600, BOUNDS.y0 - 600, BOUNDS.x1 + 600, BOUNDS.y1 + 600, 'rgba(70,52,62,0.55)');
    this.rect(BOUNDS.x0, BOUNDS.y0, BOUNDS.x1, WATER.y0, rgba(COL.land));
    this.rect(BOUNDS.x0, WATER.y1, BOUNDS.x1, BOUNDS.y1, rgba([208, 190, 150]));
    // water
    const wq = [[-700, WATER.y0], [2100, WATER.y0], [2100, WATER.y1], [-700, WATER.y1]];
    cam.p(0, WATER.y0, 0); const wy0 = cam.oy; cam.p(0, WATER.y1, 0); const wy1 = cam.oy;
    const gr = ctx.createLinearGradient(0, wy0, 0, wy1);
    gr.addColorStop(0, '#2fa5a6'); gr.addColorStop(0.55, '#1f8794'); gr.addColorStop(1, '#176a80');
    this.quad(wq, gr);
    ctx.save();
    ctx.beginPath(); wq.forEach((p, i) => { cam.p(p[0], p[1], 0); i ? ctx.lineTo(cam.ox, cam.oy) : ctx.moveTo(cam.ox, cam.oy); }); ctx.clip();
    const t = g.time;
    ctx.lineCap = 'round';
    const x0 = Math.floor(bb[0] / 11) * 11, y0 = Math.max(Math.floor(bb[1] / 9) * 9, WATER.y0 - 9);
    for (let y = y0; y < Math.min(bb[3], WATER.y1 + 9); y += 9) {
      for (let x = x0; x < bb[2]; x += 11) {
        const h = hash2(x, y);
        const px = x + h * 8, py = y + hash2(y, x) * 6;
        const a = 0.5 + 0.5 * Math.sin(t * 0.9 + h * 40);
        const len = 2 + h * 5;
        cam.p(px, py, 0); const sx = cam.ox, sy = cam.oy; cam.p(px + len, py, 0);
        ctx.strokeStyle = h > 0.55 ? `rgba(255,220,150,${0.1 + a * 0.28})` : `rgba(190,246,240,${0.06 + a * 0.16})`;
        ctx.lineWidth = Math.max(1, S * 0.16);
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(cam.ox, cam.oy); ctx.stroke();
      }
    }
    // sun glitter lane
    const gl = ctx.createLinearGradient(0, wy0, 0, wy1);
    gl.addColorStop(0, 'rgba(255,196,110,0.0)'); gl.addColorStop(0.5, 'rgba(255,196,110,0.16)'); gl.addColorStop(1, 'rgba(255,196,110,0)');
    ctx.fillStyle = gl; ctx.fillRect(0, wy0, this.W, wy1 - wy0);
    ctx.restore();
    // tug
    // quay edge and aprons
    const apron = rgba(COL.apron);
    for (const r of g.world.apronRects) this.rect(r.x0, r.y0, r.x1, r.y1, apron);
    for (const r of g.world.yardRects) { this.rect(r.x0, r.y0, r.x1, r.y1, rgba(COL.yard)); }
    this.rect(BOUNDS.x0, 936, BOUNDS.x1, 952, rgba([172, 160, 142]));
    this.rect(BOUNDS.x0, 950.5, BOUNDS.x1, 952, rgba([110, 100, 92]));
    this.rect(BOUNDS.x0, 1180, BOUNDS.x1, 1186, rgba([172, 160, 142]));
    this.rect(BOUNDS.x0, 1180, BOUNDS.x1, 1181.4, rgba([110, 100, 92]));
    // foam line
    ctx.fillStyle = 'rgba(255,250,235,0.35)'; this.rect(BOUNDS.x0, 952, BOUNDS.x1, 953.6, ctx.fillStyle);
    // park, market
    for (const r of g.world.parkRects) {
      this.rect(r.x0, r.y0, r.x1, r.y1, rgba(COL.grass));
      for (let x = r.x0; x < r.x1; x += 12) this.rect(x, r.y0, x + 6, r.y1, 'rgba(60,110,40,0.14)');
      const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
      this.rect(cx - 1.6, r.y0, cx + 1.6, r.y1, rgba([222, 202, 156]));
      this.rect(r.x0, cy - 1.6, r.x1, cy + 1.6, rgba([222, 202, 156]));
    }
    const pd = g.world.pond;
    ctx.beginPath();
    for (let a = 0; a <= 24; a++) { const an = (a / 24) * TAU; cam.p(pd.x + Math.cos(an) * pd.rx, pd.y + Math.sin(an) * pd.ry, 0); a ? ctx.lineTo(cam.ox, cam.oy) : ctx.moveTo(cam.ox, cam.oy); }
    ctx.fillStyle = '#2b9aa4'; ctx.fill(); ctx.strokeStyle = 'rgba(240,226,190,0.9)'; ctx.lineWidth = S * 0.8; ctx.stroke();
    for (const r of g.world.marketRects) {
      this.rect(r.x0, r.y0, r.x1, r.y1, rgba(COL.cobble));
      for (let x = r.x0; x < r.x1; x += 8) for (let y = r.y0; y < r.y1; y += 8) if (hash2(x, y) > 0.55) this.rect(x, y, x + 8, y + 8, 'rgba(150,110,70,0.1)');
      const cx = (r.x0 + r.x1) / 2, cy = (r.y0 + r.y1) / 2;
      this.rect(cx - 5, r.y0, cx + 5, r.y1, 'rgba(255,238,200,0.18)'); this.rect(r.x0, cy - 4, r.x1, cy + 4, 'rgba(255,238,200,0.18)');
    }
    // piers
    for (const r of g.world.pierRects) {
      this.rect(r.x0, r.y0, r.x1, r.y1, rgba(COL.plank));
      for (let y = r.y0; y < r.y1; y += 2.2) this.rect(r.x0, y, r.x1, y + 0.2, 'rgba(60,34,20,0.35)');
      this.rect(r.x0 - 1, r.y0, r.x0, r.y1, 'rgba(40,24,16,0.6)'); this.rect(r.x1, r.y0, r.x1 + 1, r.y1, 'rgba(40,24,16,0.6)');
    }
    // sidewalks + asphalt
    const walk = rgba(COL.walk), asph = rgba(COL.asphalt);
    const vEnd = (i) => (i === 5 ? 1262 : 852);
    for (let i = 0; i < NI; i++) { const x = nodeX(i); if (x + HALF < bb[0] || x - HALF > bb[2]) continue; this.rect(x - HALF, -12, x + HALF, vEnd(i), walk); }
    for (let j = 0; j < NJ; j++) { const y = nodeY(j); if (y + HALF < bb[1] || y - HALF > bb[3]) continue; this.rect(-12, y - HALF, 1332, y + HALF, walk); }
    // sidewalk seams
    ctx.strokeStyle = 'rgba(120,100,80,0.22)'; ctx.lineWidth = 1;
    for (let i = 0; i < NI; i++) {
      const x = nodeX(i); if (x + HALF < bb[0] || x - HALF > bb[2]) continue;
      for (let y = Math.max(-12, Math.floor(bb[1] / 4) * 4); y < Math.min(bb[3], vEnd(i)); y += 4) for (const s of [-1, 1]) { cam.p(x + s * ASPH, y, 0); const ax = cam.ox, ay = cam.oy; cam.p(x + s * HALF, y, 0); ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(cam.ox, cam.oy); ctx.stroke(); }
    }
    for (let i = 0; i < NI; i++) { const x = nodeX(i); if (x + ASPH < bb[0] || x - ASPH > bb[2]) continue; this.rect(x - ASPH, -12, x + ASPH, vEnd(i) === 852 ? 852 + HALF : 1262 + HALF, asph); }
    for (let j = 0; j < NJ; j++) { const y = nodeY(j); if (y + ASPH < bb[1] || y - ASPH > bb[3]) continue; this.rect(-12, y - ASPH, 1332, y + ASPH, asph); }
    // bridge deck
    this.rect(BRIDGE_X - HALF, 944, BRIDGE_X + HALF, 1190, rgba([150, 140, 132]));
    this.rect(BRIDGE_X - ASPH, 944, BRIDGE_X + ASPH, 1190, asph);
    this.bridgeRails(g);
    // lane markings
    this.markings(g, bb);
    for (const [cx, cy, hl, hw] of [[660, -13.5, 690, 1.5], [660, 1333.5, 690, 1.5], [-13.5, 660, 1.5, 690], [1333.5, 660, 1.5, 690]]) this.box(cx, cy, 0, hl, hw, 0, 2.6, [96, 80, 84], { top: [138, 120, 112], stroke: 'rgba(20,10,24,0.4)' });
    // decals
    for (const d of g.decals) {
      if (!this.inView(d.x, d.y, 10)) continue;
      cam.p(d.x, d.y, 0);
      ctx.fillStyle = `rgba(20,14,16,${0.5 * d.a})`;
      ctx.beginPath(); ctx.ellipse(cam.ox, cam.oy, d.r * S, d.r * S * cam.sE, 0, 0, TAU); ctx.fill();
    }
  }
  bridgeRails(g) {
    const ctx = this.ctx, cam = this.cam;
    for (const x of [BRIDGE_X - ASPH - 0.6, BRIDGE_X + ASPH + 0.6]) {
      fillFace(ctx, cam, [[x, 944, 0], [x, 1190, 0], [x, 1190, 1.1], [x, 944, 1.1]], [232, 222, 200]);
      fillFace(ctx, cam, [[x, 1190, 0], [x, 944, 0], [x, 944, 1.1], [x, 1190, 1.1]], [232, 222, 200]);
      ctx.strokeStyle = '#e8dcc2'; ctx.lineWidth = Math.max(1.5, cam.S * 0.5);
      cam.p(x, 944, 1.1); ctx.beginPath(); ctx.moveTo(cam.ox, cam.oy); cam.p(x, 1190, 1.1); ctx.lineTo(cam.ox, cam.oy); ctx.stroke();
    }
  }
  markings(g, bb) {
    const ctx = this.ctx, cam = this.cam, S = cam.S;
    const dash = (x0, y0, x1, y1, w, fill) => {
      const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy), nx = (-dy / l) * w, ny = (dx / l) * w;
      ctx.beginPath();
      cam.p(x0 + nx, y0 + ny, 0); ctx.moveTo(cam.ox, cam.oy);
      cam.p(x1 + nx, y1 + ny, 0); ctx.lineTo(cam.ox, cam.oy);
      cam.p(x1 - nx, y1 - ny, 0); ctx.lineTo(cam.ox, cam.oy);
      cam.p(x0 - nx, y0 - ny, 0); ctx.lineTo(cam.ox, cam.oy);
      ctx.closePath(); ctx.fillStyle = fill; ctx.fill();
    };
    const amber = 'rgba(240,184,70,0.9)', white = 'rgba(236,228,210,0.55)';
    for (let i = 0; i < NI; i++) {
      const x = nodeX(i); if (x + 9 < bb[0] || x - 9 > bb[2]) continue;
      const yEnd = i === 5 ? 1250 : 840;
      for (let y = Math.max(0, Math.floor(bb[1] / 9) * 9); y < Math.min(bb[3], yEnd); y += 9) {
        const m = ((y % 120) + 120) % 120;
        if (m < 16 || m > 104 || (y > 940 && y < 1190 && false)) continue;
        dash(x, y, x, y + 4.5, 0.12, amber);
      }
      dash(x - ASPH + 0.5, 0, x - ASPH + 0.5, yEnd, 0.08, white);
      dash(x + ASPH - 0.5, 0, x + ASPH - 0.5, yEnd, 0.08, white);
    }
    for (let j = 0; j < NJ; j++) {
      const y = nodeY(j); if (y + 9 < bb[1] || y - 9 > bb[3]) continue;
      const tram = j === 3;
      for (let x = Math.floor(bb[0] / 9) * 9; x < Math.min(bb[2], 1320); x += 9) {
        const m = ((x % 120) + 120) % 120;
        if (m < 16 || m > 104 || x < 0 || tram) continue;
        dash(x, y, x + 4.5, y, 0.12, amber);
      }
      dash(0, y - ASPH + 0.5, 1320, y - ASPH + 0.5, 0.08, white);
      dash(0, y + ASPH - 0.5, 1320, y + ASPH - 0.5, 0.08, white);
      if (tram) {
        // tram tracks: sleepers + rails
        for (let x = Math.max(-12, Math.floor(bb[0] / 2) * 2); x < Math.min(bb[2], 1332); x += 2) dash(x, y, x + 0.45, y, 1.55, 'rgba(92,78,74,0.9)');
        dash(-12, y - 0.72, 1332, y - 0.72, 0.1, 'rgb(176,176,186)');
        dash(-12, y + 0.72, 1332, y + 0.72, 0.1, 'rgb(176,176,186)');
      }
    }
    // crosswalks
    for (let j = 0; j < 8; j++) for (let i = 0; i < NI; i++) {
      const x = nodeX(i), y = nodeY(j);
      if (x < bb[0] - 20 || x > bb[2] + 20 || y < bb[1] - 20 || y > bb[3] + 20) continue;
      for (let k = 0; k < 4; k++) {
        if (!edgeExists(i, j, k)) continue;
        const dx = [1, 0, -1, 0][k], dy = [0, 1, 0, -1][k];
        for (let s = -5.6; s <= 5.6; s += 1.6) {
          const ox = -dy * s, oy = dx * s;
          dash(x + dx * 8.4 + ox, y + dy * 8.4 + oy, x + dx * 10.6 + ox, y + dy * 10.6 + oy, 0.45, white.replace('0.55', '0.8'));
        }
      }
    }
  }
  skids(g) {
    const ctx = this.ctx, cam = this.cam;
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1.5, cam.S * 0.28);
    for (const s of g.skids) {
      cam.p(s.x1, s.y1, 0); const ax = cam.ox, ay = cam.oy; cam.p(s.x2, s.y2, 0);
      if (cam.ox < -50 || cam.ox > this.W + 50 || cam.oy < -50 || cam.oy > this.H + 50) continue;
      ctx.strokeStyle = `rgba(14,10,16,${0.42 * s.a})`; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(cam.ox, cam.oy); ctx.stroke();
    }
  }
  // ---------------------------------------------------------------- shadows
  hullPush(pts, out) {
    // pts: screen points [x,y]; monotone chain hull, normalised winding
    pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [];
    for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
    const up = [];
    for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
    lo.pop(); up.pop();
    out.push(lo.concat(up));
  }
  shadeVec(h) { const hh = Math.min(h, 52); return [SHADOW[0] * hh, SHADOW[1] * hh]; }
  shadowB(b, out) {
    const cam = this.cam;
    for (const p of b.parts) {
      if (p.kind === 'tree') continue;
      if (p.z0 > 0.5 && b.zone === 'hill') continue;
      if (p.z1 - p.z0 < 0.9) continue;
      const pts = [];
      const s0 = this.shadeVec(p.z0), s1 = this.shadeVec(p.z1);
      for (const [x, y] of [[p.x0, p.y0], [p.x1, p.y0], [p.x1, p.y1], [p.x0, p.y1]]) {
        cam.p(x + s0[0], y + s0[1], 0); pts.push([cam.ox, cam.oy]);
        cam.p(x + s1[0], y + s1[1], 0); pts.push([cam.ox, cam.oy]);
      }
      this.hullPush(pts, out);
    }
  }
  shadowT(o, out) {
    const cam = this.cam, pts = [];
    const s = this.shadeVec(o.h * 0.9);
    for (let a = 0; a < 8; a++) { const an = (a / 8) * TAU; const rx = Math.cos(an) * o.r * 0.9, ry = Math.sin(an) * o.r * 0.9; cam.p(o.x + rx + s[0], o.y + ry + s[1], 0); pts.push([cam.ox, cam.oy]); cam.p(o.x + rx * 0.4, o.y + ry * 0.4, 0); pts.push([cam.ox, cam.oy]); }
    this.hullPush(pts, out);
  }
  shadowL(o, out) {
    const cam = this.cam, pts = [];
    const s = this.shadeVec(o.h);
    for (const [dx, dy] of [[-0.2, 0], [0.2, 0], [0, -0.2], [0, 0.2]]) { cam.p(o.x + dx, o.y + dy, 0); pts.push([cam.ox, cam.oy]); cam.p(o.x + dx + s[0], o.y + dy + s[1], 0); pts.push([cam.ox, cam.oy]); }
    this.hullPush(pts, out);
  }
  shadowV(v, out) {
    const cam = this.cam, m = MODELS[v.kind], pts = [];
    const c = Math.cos(v.ang), s = Math.sin(v.ang), h = m.top + m.cab[1] * 0.7;
    const sv = this.shadeVec(h);
    for (const [lx, ly] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const wx = v.x + (lx * m.len * 0.5) * c - (ly * m.wid * 0.5) * s, wy = v.y + (lx * m.len * 0.5) * s + (ly * m.wid * 0.5) * c;
      cam.p(wx, wy, 0); pts.push([cam.ox, cam.oy]); cam.p(wx + sv[0], wy + sv[1], 0); pts.push([cam.ox, cam.oy]);
    }
    this.hullPush(pts, out);
  }
  drawShadows(polys, g) {
    const ctx = this.ctx;
    ctx.beginPath();
    for (const poly of polys) { poly.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); ctx.closePath(); }
    ctx.fillStyle = 'rgba(52,28,70,0.27)';
    ctx.fill('nonzero');
  }
  // ---------------------------------------------------------------- buildings
  drawBuilding(b, g) {
    const ctx = this.ctx, cam = this.cam;
    let alpha = 1;
    if (b.h > 14 && !b.bridge) {
      // fade tall buildings that would hide the player
      const dx = Math.abs(this.plx - (b.x0 + b.x1) / 2), dy = Math.abs(this.ply - (b.y0 + b.y1) / 2);
      if (dx < (b.x1 - b.x0) / 2 + 30 && dy < (b.y1 - b.y0) / 2 + 40 && this.bdepth(b) > this.pld) {
        cam.p(this.plx, this.ply, 1);
        const sx = cam.ox, sy = cam.oy;
        const pts = [];
        for (const [x, y] of [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]]) for (const z of [0, b.h]) { cam.p(x, y, z); pts.push([cam.ox, cam.oy]); }
        const hull = []; this.hullPush(pts, hull);
        const H = hull[0];
        const R = cam.S * (this.plr || 1.6);
        const covers = (qx, qy) => { let sgn = 0; for (let i = 0; i < H.length; i++) { const a = H[i], c = H[(i + 1) % H.length]; const cr = (c[0] - a[0]) * (qy - a[1]) - (c[1] - a[1]) * (qx - a[0]); if (Math.abs(cr) < 1e-6) continue; if (!sgn) sgn = Math.sign(cr); else if (Math.sign(cr) !== sgn) return false; } return true; };
        if ([[0, 0], [R, 0], [-R, 0], [0, -R], [0, R * 0.6]].some(([ox, oy]) => covers(sx + ox, sy + oy))) alpha = 0.42;
      }
    }
    ctx.globalAlpha = alpha;
    const parts = b.parts;
    if (parts.length > 1) {
      const sorted = parts.slice().sort((a, c) => (a.z0 || 0) - (c.z0 || 0) || cam.depth((a.x0 + a.x1) / 2 || a.x, (a.y0 + a.y1) / 2 || a.y) - cam.depth((c.x0 + c.x1) / 2 || c.x, (c.y0 + c.y1) / 2 || c.y));
      for (const p of sorted) this.drawPart(p, g);
    } else this.drawPart(parts[0], g);
    if (b.bridge) this.bridgeCables();
    ctx.globalAlpha = 1;
  }
  bridgeCables() {
    const ctx = this.ctx, cam = this.cam;
    ctx.strokeStyle = 'rgba(244,236,214,0.92)'; ctx.lineWidth = Math.max(1, cam.S * 0.12);
    for (const [tx, dx] of [[583.5, 588.4], [616.5, 611.6]]) {
      for (let k = 1; k <= 8; k++) for (const s of [-1, 1]) {
        cam.p(tx, 1066, 45); ctx.beginPath(); ctx.moveTo(cam.ox, cam.oy);
        cam.p(dx, 1066 + s * k * 11, 1.1); ctx.lineTo(cam.ox, cam.oy); ctx.stroke();
      }
    }
  }
  drawTree(x, y, z0, h, r, col, g) {
    const ctx = this.ctx, cam = this.cam, S = cam.S;
    cam.p(x, y, z0); const bx = cam.ox, by = cam.oy;
    cam.p(x, y, z0 + h * 0.55); const tx = cam.ox, ty = cam.oy;
    ctx.strokeStyle = '#5a3d2a'; ctx.lineWidth = Math.max(1.5, S * 0.4); ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(tx, ty); ctx.stroke();
    const sway = Math.sin(g.time * 1.3 + x * 0.1) * 0.12;
    cam.p(x + sway, y, z0 + h * 0.78); const cx = cam.ox, cy = cam.oy;
    const R = r * S;
    ctx.fillStyle = rgba(col, 0.62); ctx.beginPath(); ctx.ellipse(cx + R * 0.14, cy + R * 0.2, R, R * 0.92, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = rgba(col, 0.85); ctx.beginPath(); ctx.ellipse(cx, cy, R * 0.94, R * 0.86, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = rgba([col[0] * 1.35 + 24, col[1] * 1.3 + 22, col[2] * 1.1 + 6], 0.8); ctx.beginPath(); ctx.ellipse(cx - R * 0.28, cy - R * 0.3, R * 0.55, R * 0.46, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,214,130,0.22)'; ctx.beginPath(); ctx.ellipse(cx - R * 0.42, cy - R * 0.4, R * 0.28, R * 0.2, 0, 0, TAU); ctx.fill();
  }
  drawPart(p, g) {
    const ctx = this.ctx, cam = this.cam;
    if (p.kind === 'tree') { this.drawTree(p.x, p.y, p.z0, p.h, p.r, p.col, g); return; }
    const { x0, y0, x1, y1, z0, z1 } = p;
    const w = x1 - x0, d = y1 - y0, hh = z1 - z0;
    // sides: 0 south(+y) 1 north(-y) 2 west(-x) 3 east(+x)
    const sides = [
      { n: [0, 1, 0], a: [x0, y1], b: [x1, y1], len: w },
      { n: [0, -1, 0], a: [x1, y0], b: [x0, y0], len: w },
      { n: [-1, 0, 0], a: [x0, y0], b: [x0, y1], len: d },
      { n: [1, 0, 0], a: [x1, y1], b: [x1, y0], len: d },
    ];
    const edge = 'rgba(34,18,36,0.38)';
    for (let s = 0; s < 4; s++) {
      const sd = sides[s];
      if (!facing(cam, sd.n)) continue;
      cam.p(sd.a[0], sd.a[1], z0); const p0x = cam.ox, p0y = cam.oy;
      cam.p(sd.b[0], sd.b[1], z0); const p1x = cam.ox, p1y = cam.oy;
      cam.p(sd.a[0], sd.a[1], z1); const p3x = cam.ox, p3y = cam.oy;
      cam.p(sd.b[0], sd.b[1], z1); const p2x = cam.ox, p2y = cam.oy;
      if (Math.max(p0x, p1x, p2x, p3x) < -20 || Math.min(p0x, p1x, p2x, p3x) > this.W + 20) continue;
      const lit = lightFor(sd.n[0], sd.n[1], 0);
      if (p.solid) {
        ctx.beginPath(); ctx.moveTo(p0x, p0y); ctx.lineTo(p1x, p1y); ctx.lineTo(p2x, p2y); ctx.lineTo(p3x, p3y); ctx.closePath();
        const warm = Math.max(0, sd.n[0] * SUN[0] + sd.n[1] * SUN[1]);
        ctx.fillStyle = rgba([p.wall[0] * (1 + 0.14 * warm), p.wall[1] * (1 + 0.03 * warm), p.wall[2] * (1 - 0.2 * warm)], lit);
        ctx.fill();
      } else {
        let tex = p.tex[s];
        if (!tex) tex = p.tex[s] = makeFacade(p, sd.len, hh, s);
        ctx.save();
        ctx.setTransform(
          this.dpr * (p1x - p0x) / tex.width, this.dpr * (p1y - p0y) / tex.width,
          this.dpr * (p0x - p3x) / tex.height, this.dpr * (p0y - p3y) / tex.height,
          this.dpr * p3x, this.dpr * p3y,
        );
        ctx.drawImage(tex, 0, 0);
        ctx.restore();
        // light overlay
        ctx.beginPath(); ctx.moveTo(p0x, p0y); ctx.lineTo(p1x, p1y); ctx.lineTo(p2x, p2y); ctx.lineTo(p3x, p3y); ctx.closePath();
        const k = lit;
        if (k < 1) { ctx.fillStyle = `rgba(40,18,60,${(1 - k) * 0.62})`; ctx.fill(); }
        else { ctx.fillStyle = `rgba(255,170,70,${Math.min(0.3, (k - 1) * 0.55 + 0.05)})`; ctx.fill(); }
      }
      ctx.strokeStyle = edge; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(p3x, p3y); ctx.lineTo(p0x, p0y); ctx.lineTo(p1x, p1y); ctx.lineTo(p2x, p2y); ctx.stroke();
      if (p.glowFloor && false) ctx.stroke();
    }
    // roof
    if (p.roofKind === 'gable') this.gable(p, g);
    else this.flatRoof(p, g);
  }
  flatRoof(p, g) {
    const ctx = this.ctx, cam = this.cam;
    const { x0, y0, x1, y1, z1 } = p;
    const top = [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
    if (p.awning) {
      // striped awning slab
      const n = Math.max(4, Math.round((x1 - x0) / 0.8));
      for (let k = 0; k < n; k++) {
        const a = x0 + ((x1 - x0) * k) / n, b = x0 + ((x1 - x0) * (k + 1)) / n;
        fillFace(ctx, cam, [[a, y0, z1], [b, y0, z1], [b, y1, z1], [a, y1, z1]], p.awning[k % 2]);
      }
      ctx.strokeStyle = 'rgba(34,18,36,0.4)'; ctx.lineWidth = 1;
      this.quad([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], null, z1); ctx.stroke();
      return;
    }
    const col = p.roofKind === 'water' ? [60, 170, 180] : p.roof;
    fillFace(ctx, cam, top, col);
    if (p.roofKind === 'turf') {
      ctx.strokeStyle = 'rgba(70,90,40,0.3)'; ctx.lineWidth = 1;
      for (let x = x0 + 5; x < x1; x += 6) { cam.p(x, y0, z1); ctx.beginPath(); ctx.moveTo(cam.ox, cam.oy); cam.p(x, y1, z1); ctx.lineTo(cam.ox, cam.oy); ctx.stroke(); }
      // low wall
      ctx.strokeStyle = 'rgba(214,196,160,0.9)'; ctx.lineWidth = Math.max(1, cam.S * 0.35); this.quad([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], null, z1); ctx.stroke();
      return;
    }
    if (p.roofKind === 'water') {
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      for (let k = 0; k < 6; k++) { const px = x0 + 1 + hash2(k, 3) * (x1 - x0 - 2), py = y0 + 1 + hash2(3, k) * (y1 - y0 - 2); cam.p(px, py, z1); ctx.fillRect(cam.ox, cam.oy, 2, 1.2); }
      ctx.strokeStyle = 'rgba(236,226,200,0.95)'; ctx.lineWidth = cam.S * 0.5; this.quad([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], null, z1); ctx.stroke();
      return;
    }
    if (x1 - x0 > 14 && y1 - y0 > 14 && p.style !== 'glass') {
      ctx.strokeStyle = 'rgba(60,40,30,0.10)'; ctx.lineWidth = 1;
      for (let x = x0 + 5; x < x1 - 2; x += 5) { cam.p(x, y0 + 1, z1); ctx.beginPath(); ctx.moveTo(cam.ox, cam.oy); cam.p(x, y1 - 1, z1); ctx.lineTo(cam.ox, cam.oy); ctx.stroke(); }
      const sx = x0 + (x1 - x0) * 0.2, sy = y0 + (y1 - y0) * 0.7;
      if (((p.id * 7) & 3) === 0) this.quad([[sx, sy], [sx + 6, sy], [sx + 6, sy + 4], [sx, sy + 4]], 'rgba(150,200,214,0.85)', z1 + 0.3);
    }
    // parapet + recess
    ctx.strokeStyle = 'rgba(244,230,200,0.55)'; ctx.lineWidth = Math.max(1, cam.S * 0.3);
    this.quad([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], null, z1); ctx.stroke();
    if (x1 - x0 > 8 && y1 - y0 > 8) {
      this.quad([[x0 + 1, y0 + 1], [x1 - 1, y0 + 1], [x1 - 1, y1 - 1], [x0 + 1, y1 - 1]], p.style === 'glass' ? 'rgba(230,246,250,0.18)' : 'rgba(0,0,0,0.07)', z1);
      if (p.style === 'glass' && x1 - x0 > 20) {
        ctx.fillStyle = 'rgba(255,214,150,0.22)';
        this.quad([[x0, y0], [x0 + (x1 - x0) * 0.5, y0], [x0, y0 + (y1 - y0) * 0.6]], ctx.fillStyle, z1);
      }
    }
  }
  gable(p, g) {
    const ctx = this.ctx, cam = this.cam;
    const { x0, y0, x1, y1, z1 } = p;
    const w = x1 - x0, d = y1 - y0;
    const rh = Math.min(w, d) * 0.3;
    const alongX = w >= d;
    const xm = (x0 + x1) / 2, ym = (y0 + y1) / 2;
    const polys = [];
    if (alongX) {
      polys.push({ tri: true, pts: [[x0, y0, z1], [x0, y1, z1], [x0, ym, z1 + rh]], wall: true });
      polys.push({ tri: true, pts: [[x1, y1, z1], [x1, y0, z1], [x1, ym, z1 + rh]], wall: true });
      polys.push({ pts: [[x1, y0, z1], [x0, y0, z1], [x0, ym, z1 + rh], [x1, ym, z1 + rh]] });
      polys.push({ pts: [[x0, y1, z1], [x1, y1, z1], [x1, ym, z1 + rh], [x0, ym, z1 + rh]] });
    } else {
      polys.push({ tri: true, pts: [[x1, y0, z1], [x0, y0, z1], [xm, y0, z1 + rh]], wall: true });
      polys.push({ tri: true, pts: [[x0, y1, z1], [x1, y1, z1], [xm, y1, z1 + rh]], wall: true });
      polys.push({ pts: [[x0, y0, z1], [x0, y1, z1], [xm, y1, z1 + rh], [xm, y0, z1 + rh]] });
      polys.push({ pts: [[x1, y1, z1], [x1, y0, z1], [xm, y0, z1 + rh], [xm, y1, z1 + rh]] });
    }
    const cx = xm, cy = ym;
    polys.sort((a, b) => cam.depth(a.pts[0][0], a.pts[0][1]) - cam.depth(b.pts[0][0], b.pts[0][1]));
    for (const q of polys) {
      if (q.wall) { fillFace(ctx, cam, q.pts, p.wall, { stroke: 'rgba(34,18,36,0.35)' }); continue; }
      if (fillFace(ctx, cam, q.pts, p.roof, { stroke: 'rgba(34,18,36,0.3)' })) {
        // tile courses
        ctx.strokeStyle = 'rgba(0,0,0,0.12)'; ctx.lineWidth = 1;
        const [a, b, c2, d2] = q.pts;
        for (let k = 1; k < 6; k++) {
          const t = k / 6;
          cam.p(lerp(a[0], d2[0], t), lerp(a[1], d2[1], t), lerp(a[2], d2[2], t)); ctx.beginPath(); ctx.moveTo(cam.ox, cam.oy);
          cam.p(lerp(b[0], c2[0], t), lerp(b[1], c2[1], t), lerp(b[2], c2[2], t)); ctx.lineTo(cam.ox, cam.oy); ctx.stroke();
        }
      }
    }
  }
  // ---------------------------------------------------------------- props
  box(cx, cy, ang, hl, hw, z0, z1, col, opt = {}) {
    const ctx = this.ctx, cam = this.cam;
    const c = Math.cos(ang), s = Math.sin(ang);
    const P = (lx, ly, z) => [cx + lx * c - ly * s, cy + lx * s + ly * c, z];
    const B = [P(-hl, -hw, z0), P(hl, -hw, z0), P(hl, hw, z0), P(-hl, hw, z0)];
    const T = [P(-hl, -hw, z1), P(hl, -hw, z1), P(hl, hw, z1), P(-hl, hw, z1)];
    for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; fillFace(ctx, cam, [B[i], B[j], T[j], T[i]], opt.sides ? opt.sides[i] || col : col, opt); }
    fillFace(ctx, cam, T, opt.top || col, opt);
  }
  drawProp(o, g) {
    const ctx = this.ctx, cam = this.cam, S = cam.S;
    switch (o.kind) {
      case 'tree': this.drawTree(o.x, o.y, 0, o.h, o.r, o.col, g); break;
      case 'lamp': {
        cam.p(o.x, o.y, 0); const bx = cam.ox, by = cam.oy; cam.p(o.x, o.y, o.h); const tx = cam.ox, ty = cam.oy;
        ctx.strokeStyle = '#2d2a34'; ctx.lineWidth = Math.max(1.2, S * 0.26); ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(tx, ty); ctx.stroke();
        ctx.fillStyle = '#ffe6a0'; ctx.beginPath(); ctx.arc(tx, ty, Math.max(1.5, S * 0.34), 0, TAU); ctx.fill();
        break;
      }
      case 'bench': this.box(o.x, o.y, o.vert ? Math.PI / 2 : 0, 1.1, 0.35, 0, 0.5, [120, 80, 50]); break;
      case 'bollard': {
        cam.p(o.x, o.y, 0); const bx = cam.ox, by = cam.oy; cam.p(o.x, o.y, 0.8);
        ctx.strokeStyle = '#2e2a30'; ctx.lineWidth = Math.max(2, S * 0.5); ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(cam.ox, cam.oy); ctx.stroke();
        ctx.strokeStyle = '#e0b848'; ctx.lineWidth = Math.max(1.5, S * 0.4); ctx.beginPath(); ctx.moveTo(cam.ox, cam.oy + 1); ctx.lineTo(cam.ox, cam.oy - 1); ctx.stroke();
        break;
      }
      case 'crate': this.box(o.x, o.y, 0.2, o.r, o.r, 0, o.h, o.col || [170, 120, 70], { stroke: 'rgba(40,20,10,0.4)' }); break;
      case 'planter': this.box(o.x, o.y, 0, o.r, o.r, 0, o.h, [186, 176, 160], { top: [96, 140, 80] }); break;
      case 'signal': {
        cam.p(o.x, o.y, 0); const bx = cam.ox, by = cam.oy; cam.p(o.x, o.y, 4.6); const tx = cam.ox, ty = cam.oy;
        ctx.strokeStyle = '#26242c'; ctx.lineWidth = Math.max(1.2, S * 0.22); ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(tx, ty); ctx.stroke();
        const st = g.signal(o.axis);
        ctx.fillStyle = '#1c1a22'; ctx.fillRect(tx - S * 0.3, ty - S * 0.55, S * 0.6, S * 1.1);
        ctx.fillStyle = st === 'r' ? '#ff4a3a' : st === 'y' ? '#ffc23a' : '#3adf7a';
        ctx.beginPath(); ctx.arc(tx, st === 'r' ? ty - S * 0.28 : st === 'y' ? ty : ty + S * 0.28, Math.max(1.4, S * 0.2), 0, TAU); ctx.fill();
        o._st = st; o._sx = tx; o._sy = ty;
        break;
      }
    }
  }
  // ---------------------------------------------------------------- vehicles
  drawVehicle(v, g) {
    const ctx = this.ctx, cam = this.cam;
    const m = MODELS[v.kind];
    const c = Math.cos(v.ang), s = Math.sin(v.ang);
    const P = (lx, ly, z) => [v.x + lx * c - ly * s, v.y + lx * s + ly * c, z];
    const L = m.len / 2, Wd = m.wid / 2;
    const dmg = clamp(1 - v.hp / m.hp, 0, 1);
    const body = v.col;
    const bcol = v.dead ? [40, 36, 38] : body;
    const hit = v.flash > 0 ? 1.3 : 1;
    const o = { f: hit };
    const stroke = 'rgba(20,10,24,0.35)';
    if (v.kind === 'tram') return this.drawTram(v, g, P);
    // wheels
    const wcol = [26, 24, 30];
    for (const lx of [-L * 0.62, L * 0.62]) for (const ly of [-Wd + 0.1, Wd - 0.1]) this.box(v.x + lx * c - ly * s, v.y + lx * s + ly * c, v.ang + (lx > 0 ? (v.steer || 0) * 0.5 : 0), 0.42, 0.16, 0, 0.66, wcol);
    // lower body (slightly chamfered)
    const z0 = 0.26, z1 = m.top, ch = 0.14;
    const B = [P(-L, -Wd, z0), P(L, -Wd, z0), P(L, Wd, z0), P(-L, Wd, z0)];
    const T = [P(-L + ch, -Wd + ch, z1), P(L - ch * 1.6, -Wd + ch, z1), P(L - ch * 1.6, Wd - ch, z1), P(-L + ch, Wd - ch, z1)];
    for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; fillFace(ctx, cam, [B[i], B[j], T[j], T[i]], bcol, { f: hit, stroke }); }
    fillFace(ctx, cam, T, bcol, { f: hit });
    // police livery / taxi band
    if (v.kind === 'police') {
      for (let i = 0; i < 4; i += 2) { const sgn = i === 0 ? -1 : 1; const q = [P(-L * 0.85, sgn * (Wd + 0.01), 0.45), P(L * 0.85, sgn * (Wd + 0.01), 0.45), P(L * 0.85, sgn * (Wd + 0.01), 0.72), P(-L * 0.85, sgn * (Wd + 0.01), 0.72)]; if (sgn > 0) q.reverse(); fillFace(ctx, cam, q, [30, 38, 80], { f: hit }); }
    }
    if (v.kind === 'taxi') for (const sgn of [-1, 1]) { const q = [P(-L * 0.8, sgn * (Wd + 0.01), 0.5), P(L * 0.8, sgn * (Wd + 0.01), 0.5), P(L * 0.8, sgn * (Wd + 0.01), 0.62), P(-L * 0.8, sgn * (Wd + 0.01), 0.62)]; if (sgn > 0) q.reverse(); fillFace(ctx, cam, q, [30, 30, 34], { f: hit }); }
    // cabin
    const cl = m.cab[0] * m.len * 0.5, cw = m.cab[2] * Wd * 0.92, off = m.cab[3] * m.len, ch2 = m.cab[1];
    const bz = z1, tz = z1 + ch2;
    const sh = m.boxy || 0.62;
    const CB = [P(off - cl, -cw, bz), P(off + cl, -cw, bz), P(off + cl, cw, bz), P(off - cl, cw, bz)];
    const ctop = [P(off - cl * sh - cl * 0.12, -cw * 0.84, tz), P(off + cl * sh - cl * 0.12, -cw * 0.84, tz), P(off + cl * sh - cl * 0.12, cw * 0.84, tz), P(off - cl * sh - cl * 0.12, cw * 0.84, tz)];
    const glass = v.dead ? [30, 30, 34] : [60, 98, 116];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const isFront = i === 1;
      fillFace(ctx, cam, [CB[i], CB[j], ctop[j], ctop[i]], isFront ? [128, 170, 186] : glass, { glass: true, f: hit, stroke });
    }
    fillFace(ctx, cam, ctop, bcol, { f: hit * 1.05, stroke });
    // accessories
    if (v.kind === 'police') {
      const flash = v.siren ? Math.floor(g.time * 7 + v.id) % 2 : 0;
      const rz = tz + 0.02;
      this.box(v.x + (off - cl * 0.1) * c, v.y + (off - cl * 0.1) * s, v.ang, 0.18, Wd * 0.5, rz, rz + 0.2, [30, 30, 40]);
      const rx = off - cl * 0.1;
      this.box(v.x + rx * c + Wd * 0.26 * -s, v.y + rx * s + Wd * 0.26 * c, v.ang, 0.17, Wd * 0.24, rz + 0.2, rz + 0.34, flash ? [255, 80, 70] : [120, 30, 28], { f: 1.2 });
      this.box(v.x + rx * c - Wd * 0.26 * -s, v.y + rx * s - Wd * 0.26 * c, v.ang, 0.17, Wd * 0.24, rz + 0.2, rz + 0.34, flash ? [40, 60, 130] : [90, 140, 255], { f: 1.2 });
    }
    if (v.kind === 'taxi') this.box(v.x + off * c, v.y + off * s, v.ang, 0.3, 0.35, tz, tz + 0.2, [255, 220, 120], { f: 1.2 });
    // lights on the body ends
    const front = this.endFacing(v, 1), back = this.endFacing(v, -1);
    if (front) {
      for (const sg of [-1, 1]) { const a = P(L + 0.005, sg * Wd * 0.62, 0.5), b = P(L + 0.005, sg * Wd * 0.3, 0.5); const a2 = P(L + 0.005, sg * Wd * 0.62, 0.74), b2 = P(L + 0.005, sg * Wd * 0.3, 0.74); this.emit([a, b, b2, a2], v.lights && !v.dead ? '#fff2c0' : '#b8b0a0'); }
    }
    if (back) {
      const on = v.braking || v.reverseLight;
      for (const sg of [-1, 1]) { const a = P(-L - 0.005, sg * Wd * 0.62, 0.5), b = P(-L - 0.005, sg * Wd * 0.3, 0.5); const a2 = P(-L - 0.005, sg * Wd * 0.62, 0.74), b2 = P(-L - 0.005, sg * Wd * 0.3, 0.74); this.emit([a, b, b2, a2], on ? '#ff5a4a' : '#8a2a28'); }
    }
    if (dmg > 0.01 && !v.dead) { ctx.fillStyle = `rgba(20,10,10,${dmg * 0.35})`; }
  }
  endFacing(v, sign) {
    const c = Math.cos(v.ang) * sign, s = Math.sin(v.ang) * sign;
    return facing(this.cam, [c, s, 0]);
  }
  emit(pts, col) {
    const ctx = this.ctx, cam = this.cam;
    ctx.beginPath(); pts.forEach((p, i) => { cam.p(p[0], p[1], p[2]); i ? ctx.lineTo(cam.ox, cam.oy) : ctx.moveTo(cam.ox, cam.oy); }); ctx.closePath();
    ctx.fillStyle = col; ctx.fill();
  }
  drawTram(v, g, P) {
    const ctx = this.ctx, cam = this.cam;
    const m = MODELS.tram, L = m.len / 2, Wd = m.wid / 2;
    const B = [P(-L, -Wd, 0.4), P(L, -Wd, 0.4), P(L, Wd, 0.4), P(-L, Wd, 0.4)];
    const T = [P(-L, -Wd, 1.5), P(L, -Wd, 1.5), P(L, Wd, 1.5), P(-L, Wd, 1.5)];
    for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; fillFace(ctx, cam, [B[i], B[j], T[j], T[i]], [38, 138, 148], { stroke: 'rgba(20,10,24,0.35)' }); }
    const U = [P(-L, -Wd, 1.5), P(L, -Wd, 1.5), P(L, Wd, 1.5), P(-L, Wd, 1.5)];
    const V = [P(-L + 0.2, -Wd + 0.1, 3.2), P(L - 0.2, -Wd + 0.1, 3.2), P(L - 0.2, Wd - 0.1, 3.2), P(-L + 0.2, Wd - 0.1, 3.2)];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      const q = [U[i], U[j], V[j], V[i]];
      fillFace(ctx, cam, q, [240, 226, 192], { stroke: 'rgba(20,10,24,0.35)' });
      // windows drawn as dark band within the face
      const n = faceNormal(q[0], q[1], q[2]);
      if (facing(cam, n) && (i === 0 || i === 2)) {
        for (let k = 0; k < 12; k++) {
          const a = k / 12 + 0.012, b = (k + 1) / 12 - 0.012;
          const lerpP = (A, B2, t) => [A[0] + (B2[0] - A[0]) * t, A[1] + (B2[1] - A[1]) * t];
          const bl = lerpP(U[i], U[j], a), br = lerpP(U[i], U[j], b), tl = lerpP(V[i], V[j], a), tr = lerpP(V[i], V[j], b);
          const z = (p, f) => [p[0], p[1], 1.5 + (3.2 - 1.5) * f];
          this.emit([z(bl, 0.28), z(br, 0.28), z(tr, 0.82), z(tl, 0.82)], 'rgb(52,86,104)');
        }
      }
    }
    fillFace(ctx, cam, V, [226, 214, 184], { stroke: 'rgba(20,10,24,0.35)' });
    this.box(v.x, v.y, v.ang, 1.4, 0.6, 3.2, 3.45, [60, 60, 70]);
  }
  // ---------------------------------------------------------------- characters
  drawPed(p, g) {
    const ctx = this.ctx, cam = this.cam, K = 1.32, S = cam.S * K;
    const pz = (x, y, z) => cam.p(x, y, z * K);
    const c = Math.cos(p.ang), s = Math.sin(p.ang);
    const a = p.fade !== undefined ? clamp(p.fade, 0, 1) : 1;
    if (a < 1) ctx.globalAlpha = a;
    cam.p(p.x, p.y, 0);
    // contact shadow
    ctx.fillStyle = 'rgba(30,16,50,0.28)'; ctx.beginPath(); ctx.ellipse(cam.ox + S * 0.25, cam.oy + 1, S * 0.5, S * 0.22, 0, 0, TAU); ctx.fill();
    const k = p.col;
    const flash = p.hitFlash > 0;
    const sh = flash ? [255, 255, 255] : k.shirt;
    const line = (x0, y0, z0, x1, y1, z1, wid, col) => {
      pz(x0, y0, z0); const ax = cam.ox, ay = cam.oy; pz(x1, y1, z1);
      ctx.strokeStyle = col; ctx.lineWidth = Math.max(1.2, wid * S); ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(cam.ox, cam.oy); ctx.stroke();
    };
    ctx.lineCap = 'round';
    const shade = (col, f) => rgba(col, f);
    if (p.down) {
      // lying
      const x = p.x, y = p.y;
      line(x - c * 0.5, y - s * 0.5, 0.2, x + c * 0.3, y + s * 0.3, 0.2, 0.46, shade(sh, 0.9));
      line(x + c * 0.3, y + s * 0.3, 0.2, x + c * 1.1, y + s * 1.1, 0.12, 0.3, shade(k.pants, 0.9));
      line(x - c * 0.5, y - s * 0.5, 0.2, x - c * 0.9, y - s * 0.9 + 0.2, 0.2, 0.2, shade(k.skin, 0.9));
      pz(x - c * 0.7, y - s * 0.7, 0.3); ctx.fillStyle = shade(k.skin, 1); ctx.beginPath(); ctx.arc(cam.ox, cam.oy, S * 0.17, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1; return;
    }
    const ph = p.walk || 0;
    const moving = p.moving;
    const sw = moving ? Math.sin(ph) : 0;
    const bob = moving ? Math.abs(Math.cos(ph)) * 0.05 : 0;
    // facing perpendicular
    const px = -s, py = c;
    const hipz = 0.92 + bob;
    for (const sg of [-1, 1]) {
      const sw2 = sw * sg * 0.38;
      line(p.x + px * 0.12 * sg, p.y + py * 0.12 * sg, hipz, p.x + px * 0.12 * sg + c * sw2, p.y + py * 0.12 * sg + s * sw2, Math.max(0, moving ? 0.05 + Math.max(0, -sw * sg) * 0.14 : 0), 0.22, shade(k.pants, sg < 0 ? 0.85 : 1));
    }
    // torso
    line(p.x, p.y, hipz, p.x, p.y, 1.5 + bob, 0.46, shade(sh, 1));
    if (k.vest) line(p.x, p.y, hipz + 0.12, p.x, p.y, 1.4, 0.5, shade(k.vest, 0.95));
    // arms
    const armed = p.armed && p.aim !== undefined && p.aimT > 0;
    for (const sg of [-1, 1]) {
      const sx = p.x + px * 0.27 * sg, sy = p.y + py * 0.27 * sg;
      if (armed && sg > 0) {
        const ax = Math.cos(p.aim), ay = Math.sin(p.aim);
        const hx = sx + ax * 0.62, hy = sy + ay * 0.62;
        line(sx, sy, 1.4, hx, hy, 1.32, 0.17, shade(sh, 0.9));
        line(hx, hy, 1.32, hx + ax * 0.42, hy + ay * 0.42, 1.34, 0.14, '#2b2b32');
      } else if (p.punch > 0 && sg > 0) {
        const ax = Math.cos(p.aim), ay = Math.sin(p.aim), e = Math.sin(clamp(p.punch / 0.2, 0, 1) * Math.PI);
        line(sx, sy, 1.4, sx + ax * (0.3 + e * 0.8), sy + ay * (0.3 + e * 0.8), 1.3, 0.17, shade(sh, 0.9));
        pz(sx + ax * (0.3 + e * 0.8), sy + ay * (0.3 + e * 0.8), 1.3); ctx.fillStyle = shade(k.skin, 1); ctx.beginPath(); ctx.arc(cam.ox, cam.oy, S * 0.1, 0, TAU); ctx.fill();
      } else {
        const sw2 = -sw * sg * 0.3;
        line(sx, sy, 1.4 + bob, sx + c * sw2, sy + s * sw2, 0.82 + bob, 0.15, shade(sh, 0.88));
      }
    }
    // head
    const hz = 1.7 + bob;
    pz(p.x, p.y, hz); const hx = cam.ox, hy = cam.oy;
    ctx.fillStyle = shade(k.skin, flash ? 1.3 : 1); ctx.beginPath(); ctx.arc(hx, hy, S * 0.2, 0, TAU); ctx.fill();
    ctx.fillStyle = shade(k.hair, 1);
    ctx.beginPath(); ctx.arc(hx, hy - S * 0.04, S * 0.21, Math.PI * 1.05, Math.PI * 1.95); ctx.fill();
    if (k.cap) { ctx.fillStyle = shade(k.cap, 1); ctx.beginPath(); ctx.ellipse(hx, hy - S * 0.1, S * 0.24, S * 0.12, 0, Math.PI, TAU); ctx.fill(); ctx.fillRect(hx - S * 0.26, hy - S * 0.1, S * 0.52, S * 0.05); }
    if (k.scarf) { ctx.strokeStyle = shade(k.scarf, 1); ctx.lineWidth = S * 0.14; pz(p.x, p.y, 1.52 + bob); ctx.beginPath(); ctx.moveTo(cam.ox - S * 0.2, cam.oy); ctx.lineTo(cam.ox + S * 0.2, cam.oy); ctx.stroke(); }
    // muzzle flash
    if (p.flash > 0) {
      const ax = Math.cos(p.aim), ay = Math.sin(p.aim);
      pz(p.x + px * 0.27 + ax * 1.15, p.y + py * 0.27 + ay * 1.15, 1.33);
      const R = S * (0.55 + p.flash * 4);
      const mx = cam.ox, my = cam.oy;
      pz(p.x + px * 0.27 + ax * 2.4, p.y + py * 0.27 + ay * 2.4, 1.33);
      const tx = cam.ox, ty = cam.oy;
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const gr = ctx.createRadialGradient(mx, my, 0, mx, my, R);
      gr.addColorStop(0, 'rgba(255,248,210,0.95)'); gr.addColorStop(0.4, 'rgba(255,190,80,0.6)'); gr.addColorStop(1, 'rgba(255,120,30,0)');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(mx, my, R, 0, TAU); ctx.fill();
      const an = Math.atan2(ty - my, tx - mx), len = Math.hypot(tx - mx, ty - my);
      ctx.translate(mx, my); ctx.rotate(an);
      ctx.fillStyle = 'rgba(255,238,170,0.95)';
      ctx.beginPath(); ctx.moveTo(0, -R * 0.22); ctx.lineTo(len, 0); ctx.lineTo(0, R * 0.22); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(-R * 0.25, 0); ctx.lineTo(R * 0.2, -R * 0.5); ctx.lineTo(R * 0.55, 0); ctx.lineTo(R * 0.2, R * 0.5); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    // health bar for hostiles
    if (p.bar && p.hp > 0) {
      pz(p.x, p.y, 2.3);
      const w = S * 1.8;
      ctx.fillStyle = 'rgba(10,6,14,0.7)'; ctx.fillRect(cam.ox - w / 2 - 1, cam.oy - 4, w + 2, 6);
      ctx.fillStyle = p.role === 'boss' ? '#ffb23a' : '#e84a3c'; ctx.fillRect(cam.ox - w / 2, cam.oy - 3, w * clamp(p.hp / p.maxHp, 0, 1), 4);
      if (p.name) { ctx.font = `700 ${Math.max(11, S * 0.55)}px ${FONT}`; ctx.textAlign = 'center'; ctx.fillStyle = 'rgba(10,6,16,0.8)'; ctx.fillText(p.name, cam.ox + 1, cam.oy - 8 + 1); ctx.fillStyle = '#ffd28a'; ctx.fillText(p.name, cam.ox, cam.oy - 8); }
    }
    ctx.globalAlpha = 1;
  }
  drawPickup(k, g) {
    const ctx = this.ctx, cam = this.cam, S = cam.S;
    const bob = Math.sin(g.time * 3 + k.x) * 0.2 + 0.9;
    cam.p(k.x, k.y, 0);
    ctx.fillStyle = 'rgba(30,16,50,0.25)'; ctx.beginPath(); ctx.ellipse(cam.ox, cam.oy, S * 0.5, S * 0.22, 0, 0, TAU); ctx.fill();
    cam.p(k.x, k.y, bob);
    const col = k.kind === 'cash' ? '#6ee7a0' : k.kind === 'health' ? '#ff6a5a' : k.kind === 'case' ? '#ffcf5a' : '#ffd25a';
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    const gr = ctx.createRadialGradient(cam.ox, cam.oy, 0, cam.ox, cam.oy, S * 2.2);
    gr.addColorStop(0, col + 'cc'); gr.addColorStop(1, col + '00');
    ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(cam.ox, cam.oy, S * 2.2, 0, TAU); ctx.fill(); ctx.restore();
    ctx.fillStyle = k.kind === 'cash' ? '#2f9e62' : k.kind === 'health' ? '#f2f0ea' : k.kind === 'case' ? '#7a4a22' : '#6a5a3a';
    const r = S * (k.kind === 'case' ? 0.55 : 0.4);
    ctx.fillRect(cam.ox - r, cam.oy - r * 0.7, r * 2, r * 1.4);
    ctx.fillStyle = k.kind === 'health' ? '#e43a3a' : '#fff6d0';
    if (k.kind === 'health') { ctx.fillRect(cam.ox - r * 0.2, cam.oy - r * 0.6, r * 0.4, r * 1.2); ctx.fillRect(cam.ox - r * 0.7, cam.oy - r * 0.2, r * 1.4, r * 0.4); }
    else if (k.kind === 'cash') { ctx.font = `700 ${r * 1.4}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('$', cam.ox, cam.oy + 1); }
    else if (k.kind === 'case') { ctx.fillRect(cam.ox - r * 0.2, cam.oy - r * 0.8, r * 0.4, r * 0.3); }
    else { ctx.font = `700 ${r * 1.1}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('•••', cam.ox, cam.oy); }
  }
  drawBoats(g) {
    const ctx = this.ctx, cam = this.cam;
    const bb = cam.bbox(30);
    if (bb[3] < WATER.y0 || bb[1] > WATER.y1) return;
    const list = g.world.boats.map((b) => ({ ...b, y: b.y + Math.sin(g.time * 0.8 + b.x) * 0.6 }));
    const t = g.world.tug;
    list.push({ x: t.x, y: t.y, len: 18, wid: 6, col: [200, 110, 40], ang: t.dir > 0 ? 0 : Math.PI, tug: true });
    list.sort((a, b) => cam.depth(a.x, a.y) - cam.depth(b.x, b.y));
    for (const b of list) {
      if (!this.inView(b.x, b.y, 24)) continue;
      const cs = Math.cos(b.ang), sn = Math.sin(b.ang);
      this.box(b.x, b.y + 0.4, b.ang, b.len / 2, b.wid / 2, 0, 1.6, b.col, { stroke: 'rgba(20,10,24,0.35)' });
      this.box(b.x - cs * b.len * 0.12, b.y - sn * b.len * 0.12, b.ang, b.len * 0.2, b.wid * 0.34, 1.6, 3.8, [238, 232, 216], { stroke: 'rgba(20,10,24,0.35)' });
      this.box(b.x - cs * b.len * 0.12, b.y - sn * b.len * 0.12, b.ang, b.len * 0.21, b.wid * 0.36, 3.8, 4.1, [60, 70, 84]);
      if (b.tug) this.box(b.x - cs * b.len * 0.3, b.y - sn * b.len * 0.3, b.ang, 0.6, 0.6, 4.1, 7, [60, 60, 66]);
    }
  }
  // ---------------------------------------------------------------- fx
  drawFX(g) {
    const ctx = this.ctx, cam = this.cam, S = cam.S;
    // bullets
    ctx.lineCap = 'round';
    for (const b of g.bullets) {
      cam.p(b.x, b.y, 1.3); const ax = cam.ox, ay = cam.oy; cam.p(b.x - b.vx * 0.03, b.y - b.vy * 0.03, 1.3);
      ctx.strokeStyle = b.hostile ? 'rgba(255,120,90,0.95)' : 'rgba(255,236,170,0.95)'; ctx.lineWidth = Math.max(1.5, S * 0.14);
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(cam.ox, cam.oy); ctx.stroke();
    }
    for (const p of g.parts) {
      const k = p.life / p.max;
      cam.p(p.x, p.y, p.z);
      if (cam.ox < -50 || cam.ox > this.W + 50 || cam.oy < -80 || cam.oy > this.H + 50) continue;
      switch (p.type) {
        case 'smoke': ctx.fillStyle = `rgba(${p.c || '40,36,44'},${0.5 * k})`; ctx.beginPath(); ctx.arc(cam.ox, cam.oy, S * p.size * (1.6 - k), 0, TAU); ctx.fill(); break;
        case 'fire': ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.fillStyle = `rgba(255,${(70 + 120 * k) | 0},20,${0.42 * k})`; ctx.beginPath(); ctx.ellipse(cam.ox, cam.oy, S * p.size * (0.16 + k * 0.2), S * p.size * (0.3 + k * 0.4), 0, 0, TAU); ctx.fill(); ctx.restore(); break;
        case 'spark': ctx.fillStyle = `rgba(255,${(180 + 60 * k) | 0},90,${k})`; ctx.fillRect(cam.ox, cam.oy, Math.max(2, S * 0.14), Math.max(2, S * 0.14)); break;
        case 'dust': ctx.fillStyle = `rgba(214,196,160,${0.4 * k})`; ctx.beginPath(); ctx.arc(cam.ox, cam.oy, S * p.size * (1.7 - k), 0, TAU); ctx.fill(); break;
        case 'ring': ctx.strokeStyle = `rgba(255,220,150,${0.8 * k})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(cam.ox, cam.oy, S * p.size * (1 - k + 0.2), S * p.size * (1 - k + 0.2) * cam.sE, 0, 0, TAU); ctx.stroke(); break;
        case 'boom': { const R = S * p.size * (1.2 - k * 0.6); ctx.save(); ctx.globalCompositeOperation = 'lighter'; const gr = ctx.createRadialGradient(cam.ox, cam.oy, 0, cam.ox, cam.oy, R); gr.addColorStop(0, `rgba(255,240,190,${k})`); gr.addColorStop(0.5, `rgba(255,140,40,${0.8 * k})`); gr.addColorStop(1, 'rgba(255,60,10,0)'); ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(cam.ox, cam.oy, R, 0, TAU); ctx.fill(); ctx.restore(); break; }
        case 'text': ctx.font = `700 ${Math.max(14, S * 1.9)}px ${FONT}`; ctx.textAlign = 'center'; ctx.lineWidth = 4; ctx.strokeStyle = `rgba(20,10,24,${k})`; ctx.fillStyle = p.c || `rgba(255,236,170,${Math.min(1, k * 2)})`; ctx.globalAlpha = Math.min(1, k * 2); ctx.strokeText(p.text, cam.ox, cam.oy); ctx.fillText(p.text, cam.ox, cam.oy); ctx.globalAlpha = 1; break;
      }
    }
  }
  lights(g, lamps) {
    const ctx = this.ctx, cam = this.cam, S = cam.S;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // lamp pools
    for (const l of lamps) {
      cam.p(l.x, l.y, 0); const gx = cam.ox, gy = cam.oy; cam.p(l.x, l.y, l.h);
      const R = S * 8;
      const gr = ctx.createRadialGradient(gx, gy, 0, gx, gy, R);
      gr.addColorStop(0, 'rgba(255,190,90,0.22)'); gr.addColorStop(1, 'rgba(255,170,60,0)');
      ctx.fillStyle = gr; ctx.save(); ctx.translate(gx, gy); ctx.scale(1, cam.sE); ctx.translate(-gx, -gy); ctx.beginPath(); ctx.arc(gx, gy, R, 0, TAU); ctx.fill(); ctx.restore();
      const gr2 = ctx.createRadialGradient(cam.ox, cam.oy, 0, cam.ox, cam.oy, S * 2);
      gr2.addColorStop(0, 'rgba(255,230,160,0.6)'); gr2.addColorStop(1, 'rgba(255,200,100,0)');
      ctx.fillStyle = gr2; ctx.beginPath(); ctx.arc(cam.ox, cam.oy, S * 2, 0, TAU); ctx.fill();
    }
    for (const v of g.vehicles) {
      if (!this.inView(v.x, v.y, 30) || v.kind === 'tram') continue;
      const m = MODELS[v.kind], c = Math.cos(v.ang), s = Math.sin(v.ang), L = m.len / 2;
      if (v.lights && !v.dead) {
        const P = (lx, ly) => [v.x + lx * c - ly * s, v.y + lx * s + ly * c];
        const a = P(L, -m.wid * 0.3), b = P(L, m.wid * 0.3), far1 = P(L + 17, -5.4), far2 = P(L + 17, 5.4);
        cam.p(...P(L, 0), 0); const sx = cam.ox, sy = cam.oy; cam.p(...P(L + 17, 0), 0);
        const gr = ctx.createLinearGradient(sx, sy, cam.ox, cam.oy);
        gr.addColorStop(0, 'rgba(255,232,170,0.42)'); gr.addColorStop(1, 'rgba(255,220,150,0)');
        ctx.fillStyle = gr; ctx.beginPath();
        for (const [i, pt] of [a, far1, far2, b].entries()) { cam.p(pt[0], pt[1], 0); i ? ctx.lineTo(cam.ox, cam.oy) : ctx.moveTo(cam.ox, cam.oy); }
        ctx.fill();
        // lamp glare
        for (const sg of [-1, 1]) { cam.p(...P(L, sg * m.wid * 0.38), 0.6); const R = S * 1.3; const g2 = ctx.createRadialGradient(cam.ox, cam.oy, 0, cam.ox, cam.oy, R); g2.addColorStop(0, 'rgba(255,244,200,0.75)'); g2.addColorStop(1, 'rgba(255,230,160,0)'); ctx.fillStyle = g2; ctx.beginPath(); ctx.arc(cam.ox, cam.oy, R, 0, TAU); ctx.fill(); }
      }
      if (!v.dead && (v.braking || v.lights)) {
        const k = v.braking ? 1 : 0.28;
        for (const sg of [-1, 1]) { const px = v.x - L * c - sg * m.wid * 0.38 * -s * -1 * 0, py = 0; const x = v.x - L * c - (sg * m.wid * 0.38) * s, y = v.y - L * s + (sg * m.wid * 0.38) * c; cam.p(x, y, 0.62); const R = S * (v.braking ? 2.1 : 1.1); const g2 = ctx.createRadialGradient(cam.ox, cam.oy, 0, cam.ox, cam.oy, R); g2.addColorStop(0, `rgba(255,50,40,${0.8 * k})`); g2.addColorStop(1, 'rgba(255,40,30,0)'); ctx.fillStyle = g2; ctx.beginPath(); ctx.arc(cam.ox, cam.oy, R, 0, TAU); ctx.fill(); }
      }
      if (v.kind === 'police' && v.siren && !v.dead) {
        const ph = Math.floor(g.time * 7 + v.id) % 2;
        cam.p(v.x, v.y, 2.6);
        for (const [sg, col] of [[1, ph ? '255,40,40' : '60,60,255'], [-1, ph ? '60,70,255' : '255,50,40']]) {
          const x = v.x + sg * -s * 1.0, y = v.y + sg * c * 1.0;
          cam.p(x, y, 1.9); const R = S * 2.9;
          const g2 = ctx.createRadialGradient(cam.ox, cam.oy, 0, cam.ox, cam.oy, R);
          g2.addColorStop(0, `rgba(${col},0.95)`); g2.addColorStop(0.35, `rgba(${col},0.35)`); g2.addColorStop(1, `rgba(${col},0)`);
          ctx.fillStyle = g2; ctx.beginPath(); ctx.arc(cam.ox, cam.oy, R, 0, TAU); ctx.fill();
        }
      }
      if (v.fire) { cam.p(v.x, v.y, 1); const R = S * 7; const g2 = ctx.createRadialGradient(cam.ox, cam.oy, 0, cam.ox, cam.oy, R); g2.addColorStop(0, 'rgba(255,140,40,0.28)'); g2.addColorStop(1, 'rgba(255,100,20,0)'); ctx.fillStyle = g2; ctx.beginPath(); ctx.arc(cam.ox, cam.oy, R, 0, TAU); ctx.fill(); }
    }
    // muzzle light
    for (const p of [g.player, ...g.peds]) {
      if (p.flash > 0 && this.inView(p.x, p.y, 20)) { cam.p(p.x, p.y, 1); const R = S * 9 * (p.flash * 8); const g2 = ctx.createRadialGradient(cam.ox, cam.oy, 0, cam.ox, cam.oy, R); g2.addColorStop(0, 'rgba(255,200,110,0.4)'); g2.addColorStop(1, 'rgba(255,180,80,0)'); ctx.fillStyle = g2; ctx.beginPath(); ctx.arc(cam.ox, cam.oy, R, 0, TAU); ctx.fill(); }
    }
    // traffic signal glow
    for (const o of g.world.props) { if (o.kind === 'signal' && o._st && o._sx > -20 && o._sx < this.W + 20 && o._sy > -20 && o._sy < this.H + 20 && o._f === this.frame - 0) { /* handled below */ } }
    ctx.restore();
  }
  atmosphere(g) {
    const ctx = this.ctx, W = this.W, H = this.H;
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    const mg = ctx.createLinearGradient(0, 0, 0, H);
    mg.addColorStop(0, 'rgb(255,226,186)'); mg.addColorStop(0.5, 'rgb(255,238,206)'); mg.addColorStop(1, 'rgb(250,232,214)');
    ctx.fillStyle = mg; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'screen';
    const sun = ctx.createRadialGradient(W * 0.04, -H * 0.1, 10, W * 0.04, -H * 0.1, H * 1.15);
    sun.addColorStop(0, 'rgba(255,170,70,0.34)'); sun.addColorStop(0.5, 'rgba(255,140,60,0.10)'); sun.addColorStop(1, 'rgba(255,120,60,0)');
    ctx.fillStyle = sun; ctx.fillRect(0, 0, W, H);
    // light shafts
    for (const [x, w, a] of [[0.18, 0.05, 0.05], [0.34, 0.03, 0.04], [0.55, 0.07, 0.04]]) {
      const gr = ctx.createLinearGradient(0, 0, W * 0.3, H);
      gr.addColorStop(0, `rgba(255,200,120,${a})`); gr.addColorStop(1, 'rgba(255,200,120,0)');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.moveTo(W * x, 0); ctx.lineTo(W * (x + w), 0); ctx.lineTo(W * (x + w) + W * 0.35, H); ctx.lineTo(W * x + W * 0.3, H); ctx.fill();
    }
    ctx.restore();
    vignette(ctx, W, H);
    // distance haze at the top edge
    const hz = ctx.createLinearGradient(0, 0, 0, H * 0.28);
    hz.addColorStop(0, 'rgba(255,196,130,0.34)'); hz.addColorStop(1, 'rgba(255,196,130,0)');
    ctx.fillStyle = hz; ctx.fillRect(0, 0, W, H * 0.28);
    if (g.hurt > 0) { const r = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.9); r.addColorStop(0, 'rgba(220,30,30,0)'); r.addColorStop(1, `rgba(220,30,30,${0.55 * Math.min(1, g.hurt)})`); ctx.fillStyle = r; ctx.fillRect(0, 0, W, H); }
  }
  // ---------------------------------------------------------------- minimap base
  buildMap(world) {
    const MS = 0.5;
    const cv = document.createElement('canvas');
    cv.width = Math.round(1380 * MS); cv.height = Math.round(1380 * MS);
    const c = cv.getContext('2d');
    const X = (v) => (v + 24) * MS;
    c.fillStyle = '#2a2433'; c.fillRect(0, 0, cv.width, cv.height);
    c.fillStyle = '#3c3548'; c.fillRect(X(-12), X(-12), 1344 * MS, 1344 * MS);
    c.fillStyle = '#1f7f8e'; c.fillRect(X(-24), X(WATER.y0), 1380 * MS, (WATER.y1 - WATER.y0) * MS);
    c.fillStyle = '#4a7a52';
    for (const r of world.parkRects) c.fillRect(X(r.x0), X(r.y0), (r.x1 - r.x0) * MS, (r.y1 - r.y0) * MS);
    c.fillStyle = '#8a6a48';
    for (const r of world.marketRects) c.fillRect(X(r.x0), X(r.y0), (r.x1 - r.x0) * MS, (r.y1 - r.y0) * MS);
    c.fillStyle = '#5c566a';
    for (const r of world.apronRects) c.fillRect(X(r.x0), X(r.y0), (r.x1 - r.x0) * MS, (r.y1 - r.y0) * MS);
    c.fillStyle = '#9a6a3c';
    for (const r of world.pierRects) c.fillRect(X(r.x0), X(r.y0), (r.x1 - r.x0) * MS, (r.y1 - r.y0) * MS);
    for (const b of world.buildings) { if (b.stall) continue; c.fillStyle = b.zone === 'hill' ? '#6d6350' : b.h > 40 ? '#8f7f93' : '#6a5c6c'; c.fillRect(X(b.x0), X(b.y0), (b.x1 - b.x0) * MS, (b.y1 - b.y0) * MS); }
    c.strokeStyle = '#eec88a'; c.lineCap = 'butt';
    c.lineWidth = 10 * MS;
    for (let i = 0; i < NI; i++) { c.beginPath(); c.moveTo(X(nodeX(i)), X(-12)); c.lineTo(X(nodeX(i)), X(i === 5 ? 1262 : 852)); c.stroke(); }
    for (let j = 0; j < NJ; j++) { c.beginPath(); c.moveTo(X(-12), X(nodeY(j))); c.lineTo(X(1332), X(nodeY(j))); c.stroke(); }
    c.strokeStyle = '#2a2433'; c.lineWidth = 1;
    this.mapCv = cv; this.mapScale = MS;
  }
}
