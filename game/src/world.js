// AMBER QUAY: the city of Rookspire. Layout, districts, buildings, props, colliders, road + walk graphs.
import { RNG, clamp, hash2 } from './util.js';

export const NI = 12; // road columns (x = i*120)
export const NJ = 9; // road rows (y = j*120, last row is the south bank road)
export const CELL = 120;
export const HALF = 12; // half width of a road corridor
export const ASPH = 7.2; // half width of asphalt
export const LANE = 2.5; // lane centre offset
export const WATER = { y0: 952, y1: 1180 };
export const BOUNDS = { x0: -12, y0: -12, x1: 1332, y1: 1332 };
export const BRIDGE_X = 600;
export const nodeX = (i) => i * CELL;
export const nodeY = (j) => (j < 8 ? j * CELL : 1250);
export const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];

const C = {
  cream: [236, 220, 186], brick: [172, 88, 64], ochre: [216, 162, 86], teal: [92, 142, 140], rust: [182, 86, 40],
  sand: [224, 198, 152], slate: [98, 106, 120], white: [240, 234, 222], terra: [198, 112, 72], olive: [140, 142, 98],
  rose: [222, 168, 150], navy: [60, 84, 112], mint: [168, 204, 176], roofTar: [150, 138, 124], roofTile: [196, 104, 66],
  roofSlate: [118, 128, 142], concrete: [188, 178, 164],
};
export const PAL = C;

export function edgeExists(i, j, k) {
  const [dx, dy] = DIRS[k];
  const ni = i + dx, nj = j + dy;
  if (ni < 0 || ni >= NI || nj < 0 || nj >= NJ) return false;
  if (dy === 0) return true;
  const a = Math.min(j, nj), b = Math.max(j, nj);
  if (b < 7) return true;
  if (a === 7 && b === 8) return i === 5;
  return false;
}

export function districtAt(x, y) {
  if (y > WATER.y0 + 2 && y < WATER.y1 - 2) return Math.abs(x - BRIDGE_X) < HALF ? 'Marrow Bridge' : 'Rook River';
  if (y >= WATER.y1) return 'Gull Yard';
  if (y > 850) return 'Saltgate Quay';
  const i = Math.floor(x / CELL), j = Math.floor(y / CELL);
  const z = zoneOf(clamp(i, 0, 10), clamp(j, 0, 6));
  return { park: 'Heronfield Park', market: 'Ferrow Market', downtown: 'Meridian Centre', hill: 'Larkhill Terraces', mid: 'Brasswick', customs: 'Customs Plaza', resi: i < 5 ? 'Cinder Row' : 'Tidewater' }[z];
}

export function zoneOf(i, j) {
  if (j === 7) return 'dock';
  if (i <= 2 && j <= 1) return 'park';
  if ((i === 3 || i === 4) && (j === 2 || j === 3)) return 'market';
  if (i >= 5 && i <= 7 && j >= 1 && j <= 3) return 'downtown';
  if ((i === 6 || i === 7) && j === 6) return 'customs';
  if (i >= 8 && j <= 3) return 'hill';
  if (i >= 5 && i <= 7 && j >= 4 && j <= 5) return 'mid';
  return 'resi';
}

export const LOC = {
  loft: { x: 130, y: 650, name: "Calder's loft" },
  cafe: { x: 370, y: 540, name: 'Tidewater Café' },
  stall: { x: 420, y: 300, name: 'Olive & Ash stall' },
  pier3: { x: 302, y: 925, name: 'Pier 3 office' },
  court: { x: 900, y: 180, name: 'Meridian parking court' },
  yard: { x: 1140, y: 1214, name: 'Gull Yard' },
  plaza: { x: 850, y: 792, name: 'Customs Plaza' },
  tower: { x: 765, y: 765, name: 'Customs Tower' },
};

let UID = 1;
function prism(x0, y0, x1, y1, z0, z1, o = {}) {
  return Object.assign({ id: UID++, x0, y0, x1, y1, z0, z1, wall: C.cream, style: 'plain', roofKind: 'flat', roof: C.roofTar, solid: false, tex: [null, null, null, null] }, o);
}

export function buildWorld() {
  const rng = new RNG(20251);
  const W = { buildings: [], props: [], solids: [], water: [], boats: [], parkRects: [], pierRects: [], apronRects: [], yardRects: [], marketRects: [], cranes: [], lamps: [], parked: [] };
  const cellMap = new Map();
  const CS = 64;
  const cellKey = (cx, cy) => cx * 1000 + cy;
  function register(o, x0, y0, x1, y1) {
    for (let cx = Math.floor(x0 / CS); cx <= Math.floor(x1 / CS); cx++) {
      for (let cy = Math.floor(y0 / CS); cy <= Math.floor(y1 / CS); cy++) {
        const k = cellKey(cx, cy);
        let a = cellMap.get(k);
        if (!a) cellMap.set(k, (a = []));
        a.push(o);
      }
    }
  }
  const solids = W.solids;
  function addSolid(x0, y0, x1, y1, tag) { solids.push({ x0, y0, x1, y1, tag }); }
  function building(parts, zone, solid = true, extra = {}) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, h = 0;
    for (const p of parts) {
      if (p.kind === 'tree') { x0 = Math.min(x0, p.x - p.r); x1 = Math.max(x1, p.x + p.r); y0 = Math.min(y0, p.y - p.r); y1 = Math.max(y1, p.y + p.r); h = Math.max(h, p.z0 + p.h); continue; }
      x0 = Math.min(x0, p.x0); y0 = Math.min(y0, p.y0); x1 = Math.max(x1, p.x1); y1 = Math.max(y1, p.y1); h = Math.max(h, p.z1 + (p.roofKind === 'gable' ? (Math.min(p.x1 - p.x0, p.y1 - p.y0) * 0.3) : 0));
    }
    const b = Object.assign({ type: 'b', parts, x0, y0, x1, y1, h, zone }, extra);
    W.buildings.push(b);
    register(b, x0, y0, x1, y1);
    if (solid) { const p0 = parts[0]; addSolid(p0.x0, p0.y0, p0.x1, p0.y1, 'b'); }
    return b;
  }
  function prop(kind, x, y, o = {}) {
    const p = Object.assign({ type: 'p', kind, x, y }, o);
    W.props.push(p);
    register(p, x - 4, y - 4, x + 4, y + 4);
    if (o.solid) addSolid(x - (o.r || 0.5), y - (o.r || 0.5), x + (o.r || 0.5), y + (o.r || 0.5), kind);
    return p;
  }
  const blockRect = (i, j) => ({ x0: i * CELL + HALF, y0: j * CELL + HALF, x1: (i + 1) * CELL - HALF, y1: (j + 1) * CELL - HALF });

  function subdivide(r, minS, depth) {
    const w = r.x1 - r.x0, h = r.y1 - r.y0;
    if (depth <= 0 || (w < minS * 1.8 && h < minS * 1.8) || (depth < 2 && rng.chance(0.18))) return [r];
    const vertical = w > h ? true : h > w ? false : rng.chance(0.5);
    const t = rng.range(0.38, 0.62);
    if (vertical) { const m = r.x0 + w * t; return [...subdivide({ x0: r.x0, y0: r.y0, x1: m, y1: r.y1 }, minS, depth - 1), ...subdivide({ x0: m, y0: r.y0, x1: r.x1, y1: r.y1 }, minS, depth - 1)]; }
    const m = r.y0 + h * t;
    return [...subdivide({ x0: r.x0, y0: r.y0, x1: r.x1, y1: m }, minS, depth - 1), ...subdivide({ x0: r.x0, y0: m, x1: r.x1, y1: r.y1 }, minS, depth - 1)];
  }
  const inset = (r, d) => ({ x0: r.x0 + d, y0: r.y0 + d, x1: r.x1 - d, y1: r.y1 - d });
  const SIGNS = ['BRINE & CO.', 'HALLOWAY', 'OLIVE & ASH', 'KESTREL FREIGHT', 'TIDEWATER', 'FERROW BAKERY', 'LANTERN HALL', 'ROOK CHANDLERY', 'SALT & STEEL', 'MARROW TAILORS', 'NORTH GATE PAWN', 'PIER BAR'];

  function roofDetails(parts, p, zone) {
    const w = p.x1 - p.x0, d = p.y1 - p.y0;
    if (w < 10 || d < 10) return;
    const n = rng.int(1, 3);
    for (let k = 0; k < n; k++) {
      const bw = rng.range(2, Math.min(6, w * 0.3)), bd = rng.range(2, Math.min(5, d * 0.3));
      const bx = rng.range(p.x0 + 1.5, p.x1 - bw - 1.5), by = rng.range(p.y0 + 1.5, p.y1 - bd - 1.5);
      parts.push(prism(bx, by, bx + bw, by + bd, p.z1, p.z1 + rng.range(1.2, 2.6), { solid: true, wall: rng.pick([C.concrete, C.slate, [150, 154, 150], C.rust]), roof: [170, 170, 168] }));
    }
  }

  // ---------- zones ----------
  for (let j = 0; j <= 6; j++) {
    for (let i = 0; i <= 10; i++) {
      const zone = zoneOf(i, j);
      const R = blockRect(i, j);
      if (zone === 'park') { W.parkRects.push(R); continue; }
      if (zone === 'market') { W.marketRects.push(R); continue; }
      if (zone === 'hill') {
        const H = [18, 13, 8, 4][j];
        const plat = prism(R.x0, R.y0, R.x1, R.y1, 0, H, { wall: C.sand, style: 'stone', roofKind: 'turf', roof: [126, 132, 80], solid: false });
        const parts = [plat];
        const inner = inset(R, 4);
        const cols = 3, rows = 2;
        const cw = (inner.x1 - inner.x0) / cols, rh = (inner.y1 - inner.y0) / rows;
        for (let a = 0; a < cols; a++) for (let b = 0; b < rows; b++) {
          const hx0 = inner.x0 + a * cw + 1.5, hy0 = inner.y0 + b * rh + 2.5;
          const hx1 = inner.x0 + (a + 1) * cw - 1.5, hy1 = inner.y0 + (b + 1) * rh - 3;
          if (rng.chance(0.12)) { parts.push({ kind: 'tree', x: (hx0 + hx1) / 2, y: (hy0 + hy1) / 2, z0: H, h: 7, r: 3.6, col: rng.pick([[84, 120, 70], [100, 130, 70], [70, 108, 78]]) }); continue; }
          const wall = rng.pick([C.cream, C.ochre, C.rose, C.white, C.mint, C.sand]);
          parts.push(prism(hx0, hy0, hx1, hy1, H, H + rng.range(4.5, 7.5), { wall, style: 'house', roofKind: 'gable', roof: rng.pick([C.roofTile, C.roofTile, C.roofSlate, [170, 80, 56]]), shop: false }));
        }
        building(parts, zone, true);
        continue;
      }
      let lots;
      if (zone === 'customs' && i === 6) {
        // Customs tower block
        const T = inset(R, 4);
        const parts = [];
        parts.push(prism(R.x0 + 6, R.y0 + 6, R.x0 + 56, R.y0 + 56, 0, 10, { wall: [120, 170, 178], style: 'glass', roof: C.concrete, sign: 'RUKH CUSTOMS' }));
        parts.push(prism(R.x0 + 12, R.y0 + 12, R.x0 + 50, R.y0 + 50, 10, 88, { wall: [96, 158, 172], style: 'glass', roof: [150, 190, 196] }));
        parts.push(prism(R.x0 + 17, R.y0 + 17, R.x0 + 45, R.y0 + 45, 88, 118, { wall: [104, 168, 180], style: 'glass', roof: [210, 214, 206] }));
        parts.push(prism(R.x0 + 29, R.y0 + 29, R.x0 + 33, R.y0 + 33, 118, 138, { solid: true, wall: [214, 80, 54], roof: [230, 230, 220] }));
        building(parts, zone, false);
        addSolid(R.x0 + 6, R.y0 + 6, R.x0 + 56, R.y0 + 56, 'b');
        // low annex
        const an = [prism(R.x0 + 60, R.y0 + 8, R.x1 - 4, R.y0 + 44, 0, 8, { wall: C.cream, style: 'office', roof: C.roofTar, shop: false })];
        roofDetails(an, an[0], zone);
        building(an, zone, true);
        W.apronRects.push({ x0: R.x0, y0: R.y0 + 58, x1: R.x1, y1: R.y1 });
        for (let k = 0; k < 6; k++) prop('planter', R.x0 + 10 + k * 14, R.y0 + 68, { solid: true, r: 1.4, h: 1.1 });
        prop('tree', R.x0 + 10, R.y1 - 8, { r: 3, h: 7, col: [90, 128, 74] });
        prop('tree', R.x1 - 10, R.y1 - 8, { r: 3, h: 7, col: [100, 130, 72] });
        continue;
      }
      if (zone === 'customs' && i === 7) {
        // open plaza with fountain
        W.apronRects.push(R);
        const cx = (R.x0 + R.x1) / 2, cy = (R.y0 + R.y1) / 2;
        const f = prism(cx - 7, cy - 7, cx + 7, cy + 7, 0, 1.1, { solid: true, wall: C.concrete, roof: [90, 190, 200], roofKind: 'water' });
        building([f, prism(cx - 1, cy - 1, cx + 1, cy + 1, 1.1, 3.4, { solid: true, wall: C.white, roof: C.white })], zone, true);
        for (const [dx, dy] of [[-24, -24], [24, -24], [-24, 24], [24, 24], [-36, 0], [36, 0]]) prop('tree', cx + dx, cy + dy, { r: 3, h: 7, col: [96, 132, 72], solid: true });
        for (const [dx, dy] of [[-16, 18], [16, 18], [0, -22], [-30, 30], [30, -34]]) prop('planter', cx + dx, cy + dy, { solid: true, r: 1.5, h: 1.1 });
        prop('crate', cx - 12, cy + 24, { solid: true, r: 1.4, h: 1.4 });
        prop('crate', cx + 14, cy + 28, { solid: true, r: 1.4, h: 1.4 });
        continue;
      }
      lots = subdivide(R, 30, zone === 'downtown' ? 2 : 2).map((l) => inset(l, 1.2));
      // special block: parking court (7,1), loft (1,5), cafe (3,4)
      if (i === 7 && j === 1) {
        W.apronRects.push(R);
        const bth = prism(R.x0 + 4, R.y0 + 4, R.x0 + 14, R.y0 + 12, 0, 3.6, { wall: C.cream, style: 'house', roofKind: 'flat', roof: C.rust, shop: false, sign: 'PARK' });
        building([bth], zone, true);
        for (let k = 0; k < 6; k++) W.parked.push({ x: R.x0 + 14 + k * 11.5, y: R.y0 + 22, ang: Math.PI / 2, lot: true });
        for (let k = 0; k < 6; k++) W.parked.push({ x: R.x0 + 14 + k * 11.5, y: R.y1 - 20, ang: -Math.PI / 2, lot: true });
        W.parked.push({ x: 900, y: 180, ang: Math.PI, special: 'marlin' });
        continue;
      }
      for (const L of lots) {
        const w = L.x1 - L.x0, d = L.y1 - L.y0;
        if (w < 12 || d < 12) continue;
        let parts = [];
        if (zone === 'downtown') {
          const wall = rng.pick([[196, 186, 168], C.cream, [174, 150, 130], [206, 198, 184]]);
          const podH = rng.range(7, 13);
          const pod = prism(L.x0, L.y0, L.x1, L.y1, 0, podH, { wall, style: rng.pick(['office', 'brick', 'office']), roof: rng.pick([C.roofTar, [128, 132, 136], [176, 116, 90]]), shop: true, sign: rng.pick(SIGNS) });
          parts.push(pod);
          const ins = Math.min(w, d) * rng.range(0.14, 0.24);
          const th = rng.range(30, 92);
          const glass = rng.chance(0.55);
          parts.push(prism(L.x0 + ins, L.y0 + ins, L.x1 - ins, L.y1 - ins, podH, th, { wall: glass ? rng.pick([[92, 150, 168], [120, 164, 172], [78, 124, 150]]) : rng.pick([[200, 190, 172], [184, 120, 90], [214, 204, 186]]), style: glass ? 'glass' : 'office', roof: glass ? [140, 180, 186] : C.roofTar }));
          if (th > 70 && rng.chance(0.6)) {
            const ins2 = ins + Math.min(w, d) * 0.12;
            parts.push(prism(L.x0 + ins2, L.y0 + ins2, L.x1 - ins2, L.y1 - ins2, th, th + rng.range(8, 16), { wall: parts[1].wall, style: parts[1].style, roof: C.concrete }));
          }
          roofDetails(parts, parts[parts.length - 1], zone);
        } else {
          let h, style, wall, roofKind = 'flat', roof = rng.pick([C.roofTar, [128, 132, 136], [176, 116, 90], [118, 140, 124], [160, 150, 140]]);
          if (zone === 'mid') { h = rng.range(20, 40); style = rng.pick(['office', 'brick', 'glass']); wall = style === 'glass' ? [100, 156, 170] : rng.pick([C.brick, C.cream, C.ochre, C.slate]); }
          else { h = rng.range(8, 21); style = rng.pick(['brick', 'cream', 'brick', 'house']); wall = rng.pick([C.brick, C.cream, C.ochre, C.terra, C.sand, C.rose, C.teal, C.white]); if (Math.min(w, d) < 32 && rng.chance(0.45)) { roofKind = 'gable'; roof = rng.pick([C.roofTile, C.roofSlate, [176, 84, 58]]); h = rng.range(8, 14); } }
          const sign = rng.chance(0.5) ? rng.pick(SIGNS) : null;
          const p = prism(L.x0, L.y0, L.x1, L.y1, 0, h, { wall, style, roofKind, roof, shop: zone !== 'hill', sign });
          parts.push(p);
          if (roofKind === 'flat') roofDetails(parts, p, zone);
        }
        const special = (i === 3 && j === 4 && L === lots[0]) ? 'cafe' : null;
        if (special) { parts[0].sign = 'TIDEWATER CAFÉ'; parts[0].awning = [[40, 150, 150], [240, 232, 214]]; }
        building(parts, zone, true);
        // trees & lamps near lot
      }
    }
  }

  // ---------- docks ----------
  for (let i = 0; i <= 10; i++) {
    const R = { x0: i * CELL + HALF, y0: 852, x1: (i + 1) * CELL - HALF, y1: 950 };
    W.apronRects.push(R);
    if (i <= 4) {
      const wh = [];
      const split = rng.range(0.4, 0.6);
      const mx = R.x0 + (R.x1 - R.x0) * split;
      for (const [a, b] of [[R.x0 + 2, mx - 2], [mx + 2, R.x1 - 2]]) {
        const hgt = rng.range(9, 13);
        const wall = rng.pick([C.cream, C.brick, C.rust, C.sand, C.teal]);
        const p = prism(a, 858, b, 918, 0, hgt, { wall, style: 'warehouse', roofKind: 'gable', roof: rng.pick([[150, 90, 70], C.roofSlate, [120, 126, 128]]), shop: false, sign: rng.chance(0.5) ? rng.pick(SIGNS) : null });
        building([p], 'dock', true);
      }
    } else {
      // container yard
      W.yardRects.push(R);
      const cols = [[182, 70, 46], [48, 130, 140], [226, 196, 150], [52, 78, 112], [196, 120, 40], [120, 130, 82], [170, 60, 56]];
      for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 2; c++) {
          if (rng.chance(0.22)) continue;
          const cx0 = R.x0 + 4 + c * 46, cy0 = 858 + r * 15;
          const hs = rng.int(1, 3);
          const parts = [];
          for (let s = 0; s < hs; s++) parts.push(prism(cx0, cy0, cx0 + 40, cy0 + 6, s * 2.7, (s + 1) * 2.7, { wall: rng.pick(cols), style: 'container', roof: [120, 118, 112], solid: false }));
          building(parts, 'dock', true);
        }
      }
    }
  }
  // quay props
  for (let x = 20; x < 1320; x += 40) prop('bollard', x, 946, { r: 0.4 });
  // piers
  for (const px of [76, 291, 900, 1112]) W.pierRects.push({ x0: px - 21, y0: 952, x1: px + 21, y1: 1040 });
  // Pier 3 office
  building([prism(280, 905, 304, 925, 0, 5.5, { wall: C.cream, style: 'house', roofKind: 'gable', roof: C.rust, sign: 'PIER 3' })], 'dock', true);
  // gantry cranes
  for (const cx of [291, 900, 1112, 560]) {
    const parts = [];
    const cy0 = 934, cy1 = 950;
    const col = [200, 88, 36];
    for (const [lx, ly] of [[cx - 9, cy0], [cx + 8, cy0], [cx - 9, cy1 - 1.6], [cx + 8, cy1 - 1.6]]) {
      parts.push(prism(lx, ly, lx + 1.6, ly + 1.6, 0, 24, { solid: true, wall: col, roof: [220, 120, 60] }));
      addSolid(lx, ly, lx + 1.6, ly + 1.6, 'crane');
    }
    parts.push(prism(cx - 12, cy0 - 2, cx + 12, cy1 + 1, 24, 27, { solid: true, wall: [210, 96, 40], roof: [226, 130, 70] }));
    parts.push(prism(cx - 2, cy0 + 2, cx + 2, 1004, 27, 29.5, { solid: true, wall: [196, 82, 34], roof: [222, 118, 60] }));
    parts.push(prism(cx - 3.2, cy1 - 8, cx + 3.2, cy1 - 2, 29.5, 34, { solid: true, wall: [236, 214, 160], roof: [250, 240, 210] }));
    parts.push(prism(cx - 6, cy0 - 14, cx + 6, cy0 - 2, 24, 27, { solid: true, wall: [90, 90, 96], roof: [120, 120, 126] }));
    building(parts, 'dock', false, { crane: true });
    W.cranes.push({ x: cx, y: cy0 });
  }
  // boats
  W.boats.push({ x: 380, y: 1010, len: 22, wid: 7, col: [196, 64, 48], ang: 0.1 }, { x: 760, y: 1030, len: 16, wid: 5.5, col: [236, 226, 206], ang: -0.05 }, { x: 1250, y: 1000, len: 26, wid: 8, col: [52, 84, 116], ang: 0 }, { x: 150, y: 1050, len: 14, wid: 5, col: [216, 170, 60], ang: 0.2 });
  W.tug = { x: 900, y: 1120, dir: 1 };

  // ---------- south bank ----------
  for (const [x0, x1] of [[20, 200], [210, 400], [420, 570], [640, 760], [780, 980], [1210, 1320]]) {
    const p = prism(x0, 1192, x1, 1230, 0, rng.range(8, 14), { wall: rng.pick([C.brick, C.rust, C.sand, C.slate]), style: 'warehouse', roofKind: 'gable', roof: C.roofSlate, sign: null });
    building([p], 'bank', true);
  }
  for (const [x0, x1] of [[20, 180], [200, 380], [420, 570], [640, 820], [1000, 1100], [1200, 1320]]) {
    const p = prism(x0, 1272, x1, 1316, 0, rng.range(7, 16), { wall: rng.pick([C.brick, C.cream, C.ochre]), style: rng.pick(['brick', 'cream']), roofKind: 'flat', roof: C.roofTar, shop: true });
    building([p, ...(() => { const a = []; roofDetails(a, p, 'bank'); return a; })()], 'bank', true);
  }
  // scrapyard (Gull Yard)
  W.yardRects.push({ x0: 1040, y0: 1186, x1: 1190, y1: 1236 });
  for (let k = 0; k < 5; k++) {
    const parts = [prism(1050 + k * 26, 1196, 1068 + k * 26, 1203, 0, 2.4, { wall: rng.pick([[130, 70, 50], [90, 100, 100], [150, 120, 70]]), style: 'container', roof: [100, 96, 90] })];
    building(parts, 'bank', true);
  }
  building([prism(1050, 1224, 1090, 1236, 0, 6, { wall: C.rust, style: 'warehouse', roofKind: 'gable', roof: C.roofSlate, sign: 'GULL YARD' })], 'bank', true);

  // ---------- water colliders ----------
  const holes = [{ x0: BRIDGE_X - HALF, x1: BRIDGE_X + HALF, y0: 940, y1: 1190 }, ...W.pierRects.map((p) => ({ x0: p.x0, x1: p.x1, y0: p.y0 - 2, y1: p.y1 }))];
  let pieces = [{ x0: BOUNDS.x0, y0: WATER.y0, x1: BOUNDS.x1, y1: WATER.y1 }];
  for (const h of holes) {
    const next = [];
    for (const p of pieces) {
      if (h.x1 <= p.x0 || h.x0 >= p.x1 || h.y1 <= p.y0 || h.y0 >= p.y1) { next.push(p); continue; }
      if (h.x0 > p.x0) next.push({ x0: p.x0, y0: p.y0, x1: h.x0, y1: p.y1 });
      if (h.x1 < p.x1) next.push({ x0: h.x1, y0: p.y0, x1: p.x1, y1: p.y1 });
      const mx0 = Math.max(p.x0, h.x0), mx1 = Math.min(p.x1, h.x1);
      if (h.y0 > p.y0) next.push({ x0: mx0, y0: p.y0, x1: mx1, y1: h.y0 });
      if (h.y1 < p.y1) next.push({ x0: mx0, y0: h.y1, x1: mx1, y1: p.y1 });
    }
    pieces = next;
  }
  for (const p of pieces) { W.water.push(p); addSolid(p.x0, p.y0, p.x1, p.y1, 'water'); }
  // world edge walls
  addSolid(-60, -60, 1392, BOUNDS.y0, 'edge'); addSolid(-60, BOUNDS.y1, 1392, 1392, 'edge');
  addSolid(-60, -60, BOUNDS.x0, 1392, 'edge'); addSolid(BOUNDS.x1, -60, 1392, 1392, 'edge');

  // ---------- trees, lamps, park, market props ----------
  const onRoad = (x, y) => {
    for (let i = 0; i < NI; i++) if (Math.abs(x - nodeX(i)) < HALF + 1 && y >= -12 && y <= (i === 5 ? 1262 : 852)) return true;
    for (let j = 0; j < NJ; j++) if (Math.abs(y - nodeY(j)) < HALF + 1) return true;
    return false;
  };
  // park
  for (const R of W.parkRects) {
    for (let k = 0; k < 14; k++) {
      const x = rng.range(R.x0 + 6, R.x1 - 6), y = rng.range(R.y0 + 6, R.y1 - 6);
      if (Math.hypot(x - (R.x0 + R.x1) / 2, y - (R.y0 + R.y1) / 2) < 12) continue;
      prop('tree', x, y, { r: rng.range(3, 4.4), h: rng.range(6, 10), col: rng.pick([[84, 128, 70], [102, 138, 66], [72, 112, 76], [150, 130, 60]]), solid: true });
    }
  }
  const pr = W.parkRects;
  W.pond = { x: (pr[4].x0 + pr[4].x1) / 2, y: (pr[4].y0 + pr[4].y1) / 2, rx: 24, ry: 15 };
  addSolid(W.pond.x - 24, W.pond.y - 15, W.pond.x + 24, W.pond.y + 15, 'pond');
  W.bandstand = { x: (pr[0].x0 + pr[0].x1) / 2, y: (pr[0].y0 + pr[0].y1) / 2 };
  building([prism(W.bandstand.x - 6, W.bandstand.y - 6, W.bandstand.x + 6, W.bandstand.y + 6, 0, 1, { solid: true, wall: C.cream, roof: [190, 150, 110] }),
    prism(W.bandstand.x - 6, W.bandstand.y - 6, W.bandstand.x - 5, W.bandstand.y - 5, 1, 5, { solid: true, wall: C.white, roof: C.white }),
    prism(W.bandstand.x + 5, W.bandstand.y - 6, W.bandstand.x + 6, W.bandstand.y - 5, 1, 5, { solid: true, wall: C.white, roof: C.white }),
    prism(W.bandstand.x - 6, W.bandstand.y + 5, W.bandstand.x - 5, W.bandstand.y + 6, 1, 5, { solid: true, wall: C.white, roof: C.white }),
    prism(W.bandstand.x + 5, W.bandstand.y + 5, W.bandstand.x + 6, W.bandstand.y + 6, 1, 5, { solid: true, wall: C.white, roof: C.white }),
    prism(W.bandstand.x - 7.5, W.bandstand.y - 7.5, W.bandstand.x + 7.5, W.bandstand.y + 7.5, 5, 6.2, { solid: true, wall: [200, 70, 52], roof: [224, 96, 70], awning: [[200, 70, 52], [240, 230, 210]] })], 'park', true);
  // market stalls
  const awnCols = [[[200, 62, 48], [244, 232, 212]], [[40, 140, 146], [244, 232, 212]], [[226, 164, 40], [244, 232, 212]], [[90, 130, 70], [244, 232, 212]], [[170, 60, 110], [244, 232, 212]]];
  for (const R of W.marketRects) {
    const cx = (R.x0 + R.x1) / 2, cy = (R.y0 + R.y1) / 2;
    for (let a = 0; a < 5; a++) for (let b = 0; b < 4; b++) {
      const sx = R.x0 + 10 + a * 17, sy = R.y0 + 8 + b * 22;
      if (Math.abs(sx + 2 - cx) < 11 || Math.abs(sy + 4 - cy) < 9) continue;
      if (Math.abs(sx - LOC.stall.x) < 14 && Math.abs(sy - LOC.stall.y) < 14) continue;
      const aw = rng.pick(awnCols);
      building([
        prism(sx, sy, sx + 5, sy + 2.8, 0, 1.1, { solid: true, wall: [150, 108, 70], roof: [180, 140, 90] }),
        prism(sx, sy - 0.2, sx + 0.3, sy + 0.1, 0, 2.5, { solid: true, wall: [110, 80, 54], roof: [110, 80, 54] }),
        prism(sx + 4.7, sy - 0.2, sx + 5, sy + 0.1, 0, 2.5, { solid: true, wall: [110, 80, 54], roof: [110, 80, 54] }),
        prism(sx - 0.4, sy - 0.8, sx + 5.4, sy + 3.2, 2.5, 2.8, { solid: true, wall: aw[0], roof: aw[0], awning: aw }),
      ], 'market', false, { stall: true });
      addSolid(sx, sy, sx + 5, sy + 2.8, 'stall');
    }
    // perimeter shop strip
    for (let a = 0; a < 5; a++) {
      const x = R.x0 + 4 + a * 18, y = R.y1 - 8;
      if (Math.abs(x + 7 - cx) < 12) continue;
      prop('crate', x + 3, y, { solid: true, r: 1.0, h: 1.0, col: rng.pick([[196, 140, 60], [150, 100, 60], [120, 150, 80]]) });
    }
  }
  // stall spot crate
  prop('crate', LOC.stall.x + 3, LOC.stall.y - 2, { solid: false, r: 1, h: 1.2, col: [196, 140, 60] });

  // roadside trees + lamps
  for (let i = 0; i < NI; i++) {
    for (let t = 0; t < 852; t += 36) {
      const jitter = hash2(i, t);
      if (jitter < 0.25 || Math.abs(((t + 6) % 120) - 60) > 40) { /* skip near intersections handled below */ }
      for (const s of [-1, 1]) {
        const x = nodeX(i) + s * 11.4, y = t + 18 + (jitter * 8 - 4);
        if (x < 0 || x > 1320 || onRoadH(y)) continue;
        const k = hash2(i * 7 + s, t);
        const j = Math.floor(y / CELL), zn = zoneOf(clamp(i - (s < 0 ? 1 : 0), 0, 10), clamp(j, 0, 6));
        if (zn === 'hill' || zn === 'market') continue;
        if (k < 0.5) prop('tree', x, y, { r: 2.6, h: 5.6, col: [88, 126, 68], solid: true, rr: 0.4 });
        else if (k < 0.8) prop('lamp', x, y, { solid: true, r: 0.3, h: 6.4 });
        else prop('bench', x - s * 0.6, y, { r: 0.5, vert: true });
      }
    }
  }
  function onRoadH(y) { for (let j = 0; j < 8; j++) if (Math.abs(y - nodeY(j)) < HALF + 1.5) return true; return false; }
  // corner lamps and traffic signals
  for (let i = 1; i < NI - 1; i++) for (let j = 1; j < 8; j++) {
    if (!(edgeExists(i, j, 0) && edgeExists(i, j, 2) && edgeExists(i, j, 1) && edgeExists(i, j, 3))) continue;
    const x = nodeX(i), y = nodeY(j);
    prop('signal', x + 8.2, y + 8.2, { solid: false, axis: 0 });
    prop('signal', x - 8.2, y - 8.2, { solid: false, axis: 0 });
    prop('signal', x + 8.2, y - 8.2, { solid: false, axis: 1 });
    prop('signal', x - 8.2, y + 8.2, { solid: false, axis: 1 });
  }

  // spatial hash for solids
  const SG = 48;
  const sg = new Map();
  solids.forEach((s, idx) => {
    for (let cx = Math.floor(s.x0 / SG); cx <= Math.floor(s.x1 / SG); cx++) for (let cy = Math.floor(s.y0 / SG); cy <= Math.floor(s.y1 / SG); cy++) {
      const k = cx * 1000 + cy;
      let a = sg.get(k);
      if (!a) sg.set(k, (a = []));
      a.push(idx);
    }
  });
  W.solidsNear = (x, y, r, out) => {
    out.length = 0;
    const seen = new Set();
    for (let cx = Math.floor((x - r) / SG); cx <= Math.floor((x + r) / SG); cx++) for (let cy = Math.floor((y - r) / SG); cy <= Math.floor((y + r) / SG); cy++) {
      const a = sg.get(cx * 1000 + cy);
      if (!a) continue;
      for (const idx of a) if (!seen.has(idx)) { seen.add(idx); const s = solids[idx]; if (x + r > s.x0 && x - r < s.x1 && y + r > s.y0 && y - r < s.y1) out.push(s); }
    }
    return out;
  };
  W.cellsIn = (x0, y0, x1, y1, stamp, out) => {
    out.length = 0;
    for (let cx = Math.floor(x0 / CS); cx <= Math.floor(x1 / CS); cx++) for (let cy = Math.floor(y0 / CS); cy <= Math.floor(y1 / CS); cy++) {
      const a = cellMap.get(cx * 1000 + cy);
      if (!a) continue;
      for (const o of a) if (o._s !== stamp) { o._s = stamp; out.push(o); }
    }
    return out;
  };

  // parked cars along kerbs
  for (let i = 0; i < NI; i++) for (let t = 30; t < 840; t += 60) {
    for (const s of [-1, 1]) {
      const h = hash2(i * 13 + s, t * 3);
      if (h > 0.34) continue;
      const y = t + (h * 20 - 4);
      if (onRoadH(y) || onRoadH(y + 4) || onRoadH(y - 4)) continue;
      const x = nodeX(i) + s * 6.15;
      const zn = zoneOf(clamp(i - (s < 0 ? 1 : 0), 0, 10), clamp(Math.floor(y / CELL), 0, 6));
      if (zn === 'hill') continue;
      W.parked.push({ x, y, ang: s > 0 ? Math.PI / 2 : -Math.PI / 2 });
    }
  }

  // ---------- walk graph (pedestrians) ----------
  const corner = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const pn = [];
  const pid = (i, j, k) => (j * NI + i) * 4 + k;
  for (let j = 0; j < NJ; j++) for (let i = 0; i < NI; i++) for (let k = 0; k < 4; k++) {
    pn[pid(i, j, k)] = { x: nodeX(i) + corner[k][0] * 9.6, y: nodeY(j) + corner[k][1] * 9.6, nb: [], i, j, k };
  }
  const link = (a, b) => { pn[a].nb.push(b); pn[b].nb.push(a); };
  for (let j = 0; j < NJ; j++) for (let i = 0; i < NI; i++) {
    const arms = [edgeExists(i, j, 3), edgeExists(i, j, 0), edgeExists(i, j, 1), edgeExists(i, j, 2)];
    const pairs = [[0, 1], [1, 2], [2, 3], [3, 0]];
    pairs.forEach(([a, b], idx) => { if (arms[idx]) link(pid(i, j, a), pid(i, j, b)); });
    if (edgeExists(i, j, 0)) { link(pid(i, j, 1), pid(i + 1, j, 0)); link(pid(i, j, 2), pid(i + 1, j, 3)); }
    if (edgeExists(i, j, 1)) { link(pid(i, j, 3), pid(i, j + 1, 0)); link(pid(i, j, 2), pid(i, j + 1, 1)); }
  }
  W.pn = pn.filter((n) => n.nb.length > 0);
  // reindex
  const remap = new Map();
  W.pn.forEach((n, idx) => remap.set(pn.indexOf(n), idx));
  W.pn.forEach((n) => { n.nb = n.nb.map((o) => remap.get(o)); });
  return W;
}
