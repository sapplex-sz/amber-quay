// AMBER QUAY: small shared helpers (seeded RNG, math, colour).
export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (t) => t * t * (3 - 2 * t);
export const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
export function angDiff(a, b) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}
export class RNG {
  constructor(seed = 1) { this.a = seed >>> 0; }
  next() {
    this.a = (this.a + 0x6d2b79f5) | 0;
    let t = Math.imul(this.a ^ (this.a >>> 15), 1 | this.a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) { return a + (b - a) * this.next(); }
  int(a, b) { return Math.floor(this.range(a, b + 1)); }
  pick(arr) { return arr[Math.floor(this.next() * arr.length) % arr.length]; }
  chance(p) { return this.next() < p; }
}
export function rgba(c, f = 1, a = 1) {
  const r = clamp(c[0] * f, 0, 255) | 0, g = clamp(c[1] * f, 0, 255) | 0, b = clamp(c[2] * f, 0, 255) | 0;
  return a >= 1 ? `rgb(${r},${g},${b})` : `rgba(${r},${g},${b},${a})`;
}
// shade with a warm/cool tint: f brightness, w warmth (-1 cool .. 1 warm)
export function tint(c, f, w = 0) {
  return rgba([c[0] * (1 + 0.12 * w), c[1] * (1 + 0.02 * w), c[2] * (1 - 0.18 * w)], f);
}
export function mixc(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }
export function money(n) { return '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
export function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
