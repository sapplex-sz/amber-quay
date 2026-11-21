// AMBER QUAY: 2.5D camera (tilted ~55 deg, slight yaw), face lighting and procedural facade textures.
import { RNG, clamp, rgba } from './util.js';

export const FONT = '"Oswald","Barlow Condensed","Roboto Condensed","Arial Narrow","Liberation Sans Narrow",Impact,sans-serif';
export const FONT2 = '"Barlow Semi Condensed","Roboto Condensed","Segoe UI","Liberation Sans",Arial,sans-serif';

export class Camera {
  constructor() {
    this.x = 0; this.y = 0; this.yaw = -0.3; this.S = 7;
    this.E = (55 * Math.PI) / 180; this.zk = 0.84;
    this.W = 1280; this.H = 720; this.cyf = 0.55; this.ox = 0; this.oy = 0;
    this.upd();
  }
  upd() {
    this.cY = Math.cos(this.yaw); this.sY = Math.sin(this.yaw); this.sE = Math.sin(this.E);
    this.vd = [-this.sY * this.zk, this.cY * this.zk, this.sE];
    this.cx0 = this.W / 2; this.cy0 = this.H * this.cyf;
  }
  // project world (x,y,z) to this.ox/this.oy
  p(x, y, z = 0) {
    const dx = x - this.x, dy = y - this.y;
    const u = dx * this.cY + dy * this.sY, v = -dx * this.sY + dy * this.cY;
    this.ox = this.cx0 + u * this.S;
    this.oy = this.cy0 + v * this.S * this.sE - z * this.S * this.zk;
  }
  depth(x, y) { return -(x - this.x) * this.sY + (y - this.y) * this.cY; }
  unproject(sx, sy) {
    const u = (sx - this.cx0) / this.S, v = (sy - this.cy0) / (this.S * this.sE);
    return [this.x + u * this.cY - v * this.sY, this.y + u * this.sY + v * this.cY];
  }
  bbox(margin, up = 0) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const [sx, sy] of [[0, -up], [this.W, -up], [0, this.H], [this.W, this.H]]) {
      const [wx, wy] = this.unproject(sx, sy);
      x0 = Math.min(x0, wx); x1 = Math.max(x1, wx); y0 = Math.min(y0, wy); y1 = Math.max(y1, wy);
    }
    return [x0 - margin, y0 - margin, x1 + margin, y1 + margin];
  }
}

// sun: late afternoon, low in the west-south-west
const L = (() => { const v = [-0.8, 0.34, 0.5]; const n = Math.hypot(...v); return v.map((a) => a / n); })();
export const SUN = L;
export const SHADOW = [-L[0] / L[2], -L[1] / L[2]];
export function lightFor(nx, ny, nz) {
  const d = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
  return 0.5 + 0.62 * d + 0.12 * nz;
}
export function faceNormal(a, b, c) {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
}
export function facing(cam, n) { return n[0] * cam.vd[0] + n[1] * cam.vd[1] + n[2] * cam.vd[2] > 0.001; }

// fill a 3D polygon (array of [x,y,z]) with lit colour; returns false if back-facing
export function fillFace(ctx, cam, pts, col, opt = {}) {
  const n = faceNormal(pts[0], pts[1], pts[2]);
  if (!facing(cam, n)) return false;
  let f = lightFor(n[0], n[1], n[2]);
  if (opt.glass) f = 0.55 + 0.7 * Math.max(0, n[0] * L[0] + n[1] * L[1] + n[2] * L[2]);
  if (opt.f) f *= opt.f;
  const warm = Math.max(0, n[0] * L[0] + n[1] * L[1] + n[2] * L[2]);
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) { cam.p(pts[i][0], pts[i][1], pts[i][2]); i ? ctx.lineTo(cam.ox, cam.oy) : ctx.moveTo(cam.ox, cam.oy); }
  ctx.closePath();
  ctx.fillStyle = rgba([col[0] * (1 + 0.14 * warm), col[1] * (1 + 0.03 * warm), col[2] * (1 - 0.2 * warm + 0.06 * (1 - warm))], f);
  ctx.fill();
  if (opt.stroke) { ctx.strokeStyle = opt.stroke; ctx.lineWidth = opt.lw || 1; ctx.stroke(); }
  return true;
}

// ---------- facade textures ----------
const stripeDefault = [[200, 66, 50], [242, 232, 212]];
function sign(ctx, text, x, y, w, h, bg, fg) {
  ctx.fillStyle = bg; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(x, y, w, Math.max(1, h * 0.08));
  ctx.fillStyle = fg;
  const fs = Math.max(6, Math.min(h * 0.7, (w * 0.9) / (text.length * 0.5)));
  ctx.font = `700 ${fs}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x + w / 2, y + h / 2 + 1);
}
function windowRect(ctx, x, y, w, h, rng, lit, style) {
  ctx.fillStyle = style === 'glass' ? '#1f3a48' : 'rgba(20,16,20,0.55)';
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  if (lit) {
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, '#ffd88a'); g.addColorStop(1, '#f3a653');
    ctx.fillStyle = g;
  } else {
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, '#9cc3cf'); g.addColorStop(0.45, '#3f6376'); g.addColorStop(1, '#223a4a');
    ctx.fillStyle = g;
  }
  ctx.fillRect(x, y, w, h);
  if (!lit) { ctx.fillStyle = 'rgba(255,214,150,0.28)'; ctx.beginPath(); ctx.moveTo(x, y + h); ctx.lineTo(x + w * 0.5, y); ctx.lineTo(x + w * 0.8, y); ctx.lineTo(x + w * 0.3, y + h); ctx.fill(); }
  ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(x - 1, y + h, w + 2, 1.5);
}

export function makeFacade(part, wm, hm, side) {
  const rng = new RNG(part.id * 31 + side * 7 + 3);
  const area = wm * hm;
  const ppm = area > 4000 ? 2.6 : area > 1800 ? 3.6 : area > 700 ? 5 : 7;
  const tw = Math.max(8, Math.round(wm * ppm)), th = Math.max(8, Math.round(hm * ppm));
  const cv = document.createElement('canvas');
  cv.width = tw; cv.height = th;
  const c = cv.getContext('2d');
  const wc = part.wall;
  c.fillStyle = rgba(wc, 1); c.fillRect(0, 0, tw, th);
  const style = part.style;
  const m = ppm;
  const floorH = style === 'glass' ? 3.6 : 3.3;
  const shop = part.shop && hm > 5;
  const gh = shop ? Math.min(4.4, hm * 0.4) : style === 'warehouse' || style === 'container' || style === 'stone' ? 0 : 0;
  if (style === 'brick' || style === 'cream' || style === 'house' || style === 'office') {
    if (style === 'brick') { c.fillStyle = 'rgba(0,0,0,0.07)'; for (let y = 0; y < th; y += m * 0.28) c.fillRect(0, y, tw, 1); }
    if (style === 'office') { c.fillStyle = 'rgba(255,255,255,0.12)'; for (let y = 0; y < th; y += floorH * m) c.fillRect(0, y, tw, 2); }
    const floors = Math.max(1, Math.round((hm - gh) / floorH));
    const fh = (hm - gh) / floors;
    const bays = Math.max(1, Math.round(wm / (style === 'office' ? 2.6 : 3.4)));
    const bw = wm / bays;
    for (let f = 0; f < floors; f++) {
      for (let b = 0; b < bays; b++) {
        const ww = bw * (style === 'office' ? 0.74 : 0.5), wh = fh * (style === 'office' ? 0.56 : 0.52);
        const x = (b * bw + (bw - ww) / 2) * m, y = (f * fh + fh * 0.22) * m;
        if (style === 'house' && (b % 2 === 1 && f === floors - 1 && floors === 1)) continue;
        windowRect(c, x, y, ww * m, wh * m, rng, rng.chance(0.2), style);
        if (style === 'cream' || style === 'house') { c.fillStyle = rgba([60, 110, 110], 1); c.fillRect(x - ww * m * 0.28, y, ww * m * 0.22, wh * m); c.fillRect(x + ww * m * 1.06, y, ww * m * 0.22, wh * m); }
        if (style === 'brick') { c.fillStyle = 'rgba(240,226,196,0.85)'; c.fillRect(x - 2, y - 3, ww * m + 4, 3); }
      }
      if (style === 'house' && f === floors - 1 && gh === 0) {
        // door
        c.fillStyle = rgba([110, 62, 44], 1); c.fillRect((wm / 2 - 0.55) * m, th - 2.0 * m, 1.1 * m, 2.0 * m);
      }
    }
    if (style === 'brick' || style === 'cream') { c.fillStyle = 'rgba(0,0,0,0.12)'; c.fillRect(0, 0, tw, Math.max(2, m * 0.5)); }
  } else if (style === 'glass') {
    const floors = Math.max(1, Math.round(hm / floorH));
    const fh = hm / floors;
    const cols = Math.max(1, Math.round(wm / 2.2));
    const cw = wm / cols;
    for (let f = 0; f < floors; f++) for (let b = 0; b < cols; b++) {
      const k = rng.next();
      const g = c.createLinearGradient(0, f * fh * m, 0, (f + 1) * fh * m);
      if (k < 0.12) { g.addColorStop(0, '#ffd58e'); g.addColorStop(1, '#e8963f'); }
      else if (k < 0.38) { g.addColorStop(0, '#c4dfe0'); g.addColorStop(1, '#6fa1ae'); }
      else { g.addColorStop(0, '#6aa0b0'); g.addColorStop(1, '#2d5b6d'); }
      c.fillStyle = g; c.fillRect(b * cw * m, f * fh * m, cw * m, fh * m);
    }
    c.fillStyle = 'rgba(14,38,50,0.55)';
    for (let f = 0; f <= floors; f++) c.fillRect(0, f * fh * m - 1, tw, 2);
    for (let b = 0; b <= cols; b++) c.fillRect(b * cw * m - 0.5, 0, 1.2, th);
    c.fillStyle = 'rgba(255,230,180,0.14)';
    c.beginPath(); c.moveTo(0, th); c.lineTo(tw * 0.5, 0); c.lineTo(tw * 0.75, 0); c.lineTo(tw * 0.25, th); c.fill();
  } else if (style === 'warehouse') {
    c.fillStyle = 'rgba(0,0,0,0.10)'; for (let x = 0; x < tw; x += m * 0.6) c.fillRect(x, 0, 1.2, th);
    c.fillStyle = 'rgba(255,255,255,0.10)'; for (let x = 0; x < tw; x += m * 0.6) c.fillRect(x + 1.5, 0, 1, th);
    const doors = Math.max(1, Math.round(wm / 12));
    for (let d = 0; d < doors; d++) {
      const dw = Math.min(5, wm / doors * 0.5) * m, dh = Math.min(5, hm * 0.65) * m;
      const x = ((d + 0.5) * wm / doors) * m - dw / 2;
      c.fillStyle = rgba([80, 74, 70], 1); c.fillRect(x - 3, th - dh - 3, dw + 6, dh + 3);
      c.fillStyle = rgba([150, 82, 56], 1); c.fillRect(x, th - dh, dw, dh);
      c.fillStyle = 'rgba(0,0,0,0.25)'; for (let y = th - dh; y < th; y += m * 0.5) c.fillRect(x, y, dw, 1);
    }
    c.fillStyle = 'rgba(30,40,48,0.8)';
    for (let x = 2 * m; x < tw - 2 * m; x += 4 * m) c.fillRect(x, hm * m * 0.18, 2 * m, 1.1 * m);
    c.fillStyle = 'rgba(90,40,16,0.18)'; for (let k = 0; k < 7; k++) c.fillRect(rng.range(0, tw), 0, rng.range(2, 6), rng.range(th * 0.2, th * 0.7));
  } else if (style === 'container') {
    c.fillStyle = 'rgba(0,0,0,0.18)'; for (let x = 0; x < tw; x += m * 0.45) c.fillRect(x, 0, 1.5, th);
    c.fillStyle = 'rgba(255,255,255,0.12)'; c.fillRect(0, 0, tw, 2);
    c.fillStyle = 'rgba(255,255,255,0.7)'; c.font = `700 ${Math.max(6, th * 0.4)}px ${FONT}`; c.textBaseline = 'middle';
    if (wm > 10) c.fillText(rng.pick(['KESTREL', 'SALTLINE', 'ROOK-LOG', 'NORTHWIND', 'OSTRANDER']), tw * 0.2, th * 0.5);
    c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(tw - 2, 0, 2, th);
  } else if (style === 'stone') {
    c.fillStyle = 'rgba(70,50,30,0.22)';
    for (let y = 0; y < th; y += m * 1.0) { c.fillRect(0, y, tw, 1.3); for (let x = (y / m) % 2 ? 0 : m * 1.2; x < tw; x += m * 2.4) c.fillRect(x, y, 1.3, m * 1.0); }
    c.fillStyle = 'rgba(86,120,60,0.55)';
    for (let k = 0; k < Math.max(3, wm / 5); k++) { const x = rng.range(0, tw); c.fillRect(x, 0, rng.range(3, 9), rng.range(th * 0.2, th * 0.6)); }
    c.fillStyle = 'rgba(30,24,20,0.5)'; for (let x = m * 6; x < tw - m * 4; x += m * 14) c.fillRect(x, th * 0.4, m * 2, th * 0.6);
  }
  if (shop && gh > 0) {
    const y0 = th - gh * m;
    c.fillStyle = rgba([wc[0] * 0.8, wc[1] * 0.8, wc[2] * 0.8], 1); c.fillRect(0, y0, tw, gh * m);
    const bays = Math.max(1, Math.round(wm / 4.2)), bw = wm / bays;
    const aw = part.awning || [rng.pick([[200, 66, 50], [40, 140, 146], [226, 164, 40], [86, 124, 74], [150, 56, 100]]), [242, 232, 212]];
    for (let b = 0; b < bays; b++) {
      const x = (b * bw + bw * 0.1) * m, w = bw * 0.8 * m;
      const g = c.createLinearGradient(0, y0 + gh * m * 0.3, 0, th);
      g.addColorStop(0, '#ffcf80'); g.addColorStop(1, '#d68a3a');
      c.fillStyle = '#26333b'; c.fillRect(x - 2, y0 + gh * m * 0.34, w + 4, gh * m * 0.66);
      c.fillStyle = g; c.fillRect(x, y0 + gh * m * 0.4, w, gh * m * 0.6 - 2);
      c.fillStyle = 'rgba(255,255,255,0.22)'; c.beginPath(); c.moveTo(x, y0 + gh * m * 0.4); c.lineTo(x + w * 0.4, y0 + gh * m * 0.4); c.lineTo(x, y0 + gh * m * 0.8); c.fill();
      // awning
      const n = Math.max(4, Math.round(w / (m * 0.55)));
      for (let s = 0; s < n; s++) { c.fillStyle = rgba(s % 2 ? aw[1] : aw[0], 1); c.fillRect(x + (s * w) / n - 1, y0 + gh * m * 0.12, w / n + 1, gh * m * 0.26); }
      c.fillStyle = 'rgba(0,0,0,0.28)'; c.fillRect(x - 1, y0 + gh * m * 0.38, w + 2, gh * m * 0.07);
    }
    if (part.sign && wm > 14) sign(c, part.sign, tw * 0.5 - Math.min(tw * 0.3, 8 * m), y0 - 1.5 * m, Math.min(tw * 0.6, 16 * m), 1.4 * m, 'rgba(26,28,34,0.9)', '#ffd27a');
  } else if (part.sign && style === 'warehouse' && wm > 18) {
    sign(c, part.sign, tw * 0.5 - 9 * m, hm * m * 0.28, 18 * m, 2.2 * m, 'rgba(240,226,196,0.9)', '#7a3a22');
  } else if (part.sign && (style === 'glass' && part.z0 < 1) && wm > 20) {
    sign(c, part.sign, tw * 0.5 - 9 * m, th - 2.6 * m, 18 * m, 1.8 * m, 'rgba(14,30,40,0.9)', '#ffe0a0');
  } else if (part.sign && style === 'house' && wm > 8 && hm < 7) {
    sign(c, part.sign, tw * 0.5 - 3 * m, 0.5 * m, 6 * m, 1.1 * m, 'rgba(26,28,34,0.9)', '#ffd27a');
  }
  // ambient occlusion at the foot, soft darkening up high
  const g = c.createLinearGradient(0, th - m * 2.4, 0, th);
  g.addColorStop(0, 'rgba(20,10,30,0)'); g.addColorStop(1, 'rgba(20,10,30,0.34)');
  c.fillStyle = g; c.fillRect(0, th - m * 2.4, tw, m * 2.4);
  return cv;
}

export function vignette(ctx, W, H) {
  const g = ctx.createRadialGradient(W / 2, H * 0.52, H * 0.35, W / 2, H * 0.52, H * 0.95);
  g.addColorStop(0, 'rgba(20,6,30,0)'); g.addColorStop(1, 'rgba(24,8,34,0.36)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
}
export const hex = (c) => rgba(c, 1);
export { clamp };
