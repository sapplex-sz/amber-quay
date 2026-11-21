// AMBER QUAY: HUD, title screen, menus. Everything is drawn on the canvas.
import { clamp, TAU, money, lerp } from './util.js';
import { FONT, FONT2 } from './gfx.js';
import { MODELS, WEAPONS } from './defs.js';

const AMBER = '#ffb23a', AMBER2 = '#ff8a2a', INK = 'rgba(16,10,22,0.78)', CREAM = '#fff0d2';

function panel(ctx, x, y, w, h, o = {}) {
  const sk = o.skew ?? 10;
  ctx.beginPath(); ctx.moveTo(x + sk, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w - sk, y + h); ctx.lineTo(x, y + h); ctx.closePath();
  ctx.fillStyle = o.fill || INK; ctx.fill();
  if (o.stroke !== false) { ctx.strokeStyle = o.stroke || 'rgba(255,178,58,0.55)'; ctx.lineWidth = 1.5; ctx.stroke(); }
}
function text(ctx, s, x, y, size, color = CREAM, align = 'left', weight = 700, font = FONT, shadow = true) {
  ctx.font = `${weight} ${size}px ${font}`; ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
  if (shadow) { ctx.fillStyle = 'rgba(8,4,14,0.8)'; ctx.fillText(s, x + 1.5, y + 1.5); }
  ctx.fillStyle = color; ctx.fillText(s, x, y);
}
function spaced(ctx, s, x, y, size, color, sp, align = 'left', weight = 700) {
  ctx.font = `${weight} ${size}px ${FONT}`; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  let w = 0; for (const ch of s) w += ctx.measureText(ch).width + sp; w -= sp;
  let cx = align === 'center' ? x - w / 2 : align === 'right' ? x - w : x;
  for (const ch of s) { ctx.fillStyle = 'rgba(8,4,14,0.8)'; ctx.fillText(ch, cx + 1.5, y + 1.5); ctx.fillStyle = color; ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + sp; }
  return w;
}
function wrap(ctx, s, maxW) {
  const words = s.split(' '), lines = []; let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur);
  return lines;
}

export class UI {
  constructor() { this.btns = []; this.sel = 0; this.overlay = null; this.hasSave = false; this.saveInfo = ''; this.t = 0; this.mouse = { x: -1, y: -1 }; }
  items(g) {
    if (g.mode === 'title') return [['NEW GAME', 'new'], ['CONTINUE', 'continue', !this.hasSave], ['CONTROLS', 'controls']];
    return [['RESUME', 'resume'], ['SAVE GAME', 'save'], ['CONTROLS', 'controls'], ['QUIT TO TITLE', 'quit']];
  }
  // ---------------------------------------------------------------- HUD
  hud(ctx, g, r, W, H) {
    this.t += 1 / 60;
    const cam = r.cam;
    this.worldMarkers(ctx, g, cam);
    const p = g.player;
    this.minimap(ctx, g, r, W, H);
    this.statusPanel(ctx, g, W, H);
    this.cashHeat(ctx, g, W, H);
    this.missionCard(ctx, g, r, W, H);
    this.offscreenArrows(ctx, g, r, W, H);
    if (p.inVeh) this.vehiclePanel(ctx, g, W, H);
    this.dialog(ctx, g, W, H);
    this.toasts(ctx, g, W, H);
    this.districtBanner(ctx, g, W, H);
    this.banner(ctx, g, W, H);
    if (g.dead > 0 || g.busted > 0) this.wasted(ctx, g, W, H);
  }
  worldMarkers(ctx, g, cam) {
    for (const m of g.markers) {
      cam.p(m.x, m.y, 0);
      const x = cam.ox, y = cam.oy, S = cam.S;
      if (x < -80 || x > cam.W + 80 || y < -200 || y > cam.H + 80) continue;
      const pul = 0.5 + 0.5 * Math.sin(g.time * 3.2);
      const col = m.kind === 'start' ? '255,178,58' : '120,230,255';
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const hgt = S * 13;
      const gr = ctx.createLinearGradient(0, y, 0, y - hgt);
      gr.addColorStop(0, `rgba(${col},0.5)`); gr.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = gr; ctx.beginPath(); ctx.moveTo(x - S * 2.6, y); ctx.lineTo(x - S * 2.0, y - hgt); ctx.lineTo(x + S * 2.0, y - hgt); ctx.lineTo(x + S * 2.6, y); ctx.fill();
      const rg = ctx.createRadialGradient(x, y, 0, x, y, S * 3.4);
      rg.addColorStop(0, `rgba(${col},0.55)`); rg.addColorStop(0.7, `rgba(${col},0.25)`); rg.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = rg; ctx.beginPath(); ctx.ellipse(x, y, S * 3.4, S * 3.4 * cam.sE, 0, 0, TAU); ctx.fill();
      ctx.strokeStyle = `rgba(${col},${0.7 + pul * 0.3})`; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(x, y, S * (2.6 + pul * 0.4), S * (2.6 + pul * 0.4) * cam.sE, 0, 0, TAU); ctx.stroke();
      ctx.restore();
      // floating label
      const ly = y - S * 6.2 - pul * 4;
      ctx.fillStyle = m.kind === 'start' ? AMBER : '#7fe6ff';
      ctx.beginPath(); ctx.moveTo(x, ly + 12); ctx.lineTo(x - 11, ly - 2); ctx.lineTo(x, ly - 16); ctx.lineTo(x + 11, ly - 2); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(16,10,22,0.9)'; ctx.lineWidth = 2; ctx.stroke();
      text(ctx, m.label.length > 3 ? m.label : m.label, x, ly - 22, 15, CREAM, 'center', 700, FONT, true);
    }
  }
  minimap(ctx, g, r, W, H) {
    const R = Math.round(clamp(H * 0.15, 78, 112)), cx = 24 + R + 8, cy = H - 24 - R - 8;
    const p = g.player, cam = r.cam;
    const sp = p.inVeh ? Math.abs(p.inVeh.speed) : 0;
    const Z = R / (62 + sp * 2.6);
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R + 7, 0, TAU); ctx.fillStyle = 'rgba(14,8,20,0.88)'; ctx.fill();
    ctx.strokeStyle = AMBER; ctx.lineWidth = 2.5; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.clip();
    ctx.fillStyle = '#2a2433'; ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
    const px = p.x, py = p.y;
    ctx.save();
    ctx.translate(cx, cy); ctx.rotate(-cam.yaw);
    ctx.scale(Z / r.mapScale, Z / r.mapScale);
    ctx.translate(-(px + 24) * r.mapScale, -(py + 24) * r.mapScale);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(r.mapCv, 0, 0);
    ctx.restore();
    const toMap = (x, y) => { const dx = (x - px) * Z, dy = (y - py) * Z; const c = Math.cos(cam.yaw), s = Math.sin(cam.yaw); return [cx + dx * c + dy * s, cy - dx * s + dy * c]; };
    // blips
    const ph = Math.floor(g.time * 4) % 2;
    for (const v of g.vehicles) {
      if (v.ai === 'cop' && !v.dead) { const [x, y] = toMap(v.x, v.y); if (Math.hypot(x - cx, y - cy) < R - 3) { ctx.fillStyle = ph ? '#ff4a3a' : '#5a7aff'; ctx.beginPath(); ctx.arc(x, y, 4, 0, TAU); ctx.fill(); ctx.strokeStyle = '#10081a'; ctx.lineWidth = 1; ctx.stroke(); } }
    }
    for (const q of g.peds) {
      if (q.down) continue;
      if (q.role === 'cop' || q.role === 'thug' || q.role === 'boss') { const [x, y] = toMap(q.x, q.y); if (Math.hypot(x - cx, y - cy) < R - 3) { ctx.fillStyle = q.role === 'cop' ? (ph ? '#ff4a3a' : '#5a7aff') : '#ff5a4a'; ctx.beginPath(); ctx.arc(x, y, q.role === 'boss' ? 5 : 3.2, 0, TAU); ctx.fill(); } }
    }
    for (const m of g.markers) {
      let [x, y] = toMap(m.x, m.y);
      let d = Math.hypot(x - cx, y - cy);
      const edge = d > R - 12;
      if (edge) { x = cx + ((x - cx) / d) * (R - 12); y = cy + ((y - cy) / d) * (R - 12); }
      ctx.fillStyle = m.kind === 'start' ? AMBER : '#7fe6ff';
      ctx.beginPath(); ctx.moveTo(x, y - 9); ctx.lineTo(x + 8, y); ctx.lineTo(x, y + 9); ctx.lineTo(x - 8, y); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#10081a'; ctx.lineWidth = 2; ctx.stroke();
    }
    for (const k of g.pickups) { if (k.kind !== 'case' && k.kind !== 'ledger') continue; const [x, y] = toMap(k.x, k.y); ctx.fillStyle = '#ffd25a'; ctx.fillRect(x - 3, y - 3, 6, 6); }
    // player arrow
    ctx.translate(cx, cy); ctx.rotate(p.inVeh ? p.inVeh.ang - cam.yaw : p.ang - cam.yaw);
    ctx.fillStyle = '#fff6dc'; ctx.strokeStyle = '#10081a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(9, 0); ctx.lineTo(-6, 6); ctx.lineTo(-3, 0); ctx.lineTo(-6, -6); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.restore();
    // north tag + ring
    const nx = cx - Math.sin(cam.yaw) * (R - 2), ny = cy - Math.cos(cam.yaw) * (R - 2);
    ctx.fillStyle = '#10081a'; ctx.beginPath(); ctx.arc(nx, ny, 9, 0, TAU); ctx.fill();
    text(ctx, 'N', nx, ny + 5, 13, AMBER, 'center', 700, FONT, false);
    ctx.strokeStyle = 'rgba(255,178,58,0.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, R - 6, 0, TAU); ctx.stroke();
    this.mmR = R; this.mmX = cx; this.mmY = cy;
  }
  statusPanel(ctx, g, W, H) {
    const R = this.mmR, x = this.mmX + R + 22, y = H - 24 - 8 - 78, w = 250;
    const p = g.player;
    panel(ctx, x, y, w, 78);
    spaced(ctx, 'NIM CALDER', x + 20, y + 20, 15, AMBER, 2.5);
    // health segments
    const seg = 12, sw = (w - 52) / seg;
    for (let i = 0; i < seg; i++) {
      const f = clamp(p.hp / 100 * seg - i, 0, 1);
      ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.fillRect(x + 20 + i * sw, y + 30, sw - 3, 13);
      if (f > 0) { ctx.fillStyle = p.hp < 30 ? (Math.floor(g.time * 5) % 2 ? '#ff4a3a' : '#a82a2a') : '#ff6a4a'; ctx.fillRect(x + 20 + i * sw, y + 30, (sw - 3) * f, 13); ctx.fillStyle = 'rgba(255,255,255,0.25)'; ctx.fillRect(x + 20 + i * sw, y + 30, (sw - 3) * f, 4); }
    }
    text(ctx, '♥', x + w - 24, y + 42, 14, '#ff6a4a', 'right', 700, FONT2, false);
    const wp = p.weapon;
    text(ctx, WEAPONS[wp].name, x + 20, y + 66, 17, CREAM, 'left');
    if (wp === 'pistol') {
      const rl = p.reload > 0;
      text(ctx, rl ? 'RELOADING' : `${p.clip}`, x + w - 74, y + 67, 22, rl ? AMBER : p.clip === 0 ? '#ff6a4a' : CREAM, 'right');
      text(ctx, `/ ${p.reserve}`, x + w - 22, y + 66, 15, 'rgba(255,240,210,0.6)', 'right');
    } else text(ctx, 'MELEE', x + w - 22, y + 66, 15, 'rgba(255,240,210,0.6)', 'right');
  }
  cashHeat(ctx, g, W, H) {
    const w = 270, x = W - w - 22, y = 20;
    panel(ctx, x, y, w, 58, { fill: 'rgba(16,10,22,0.8)' });
    text(ctx, 'CASH', x + 24, y + 22, 13, 'rgba(255,200,120,0.8)', 'left');
    this.dispCash = this.dispCash === undefined ? g.cash : this.dispCash + (g.cash - this.dispCash) * 0.15;
    text(ctx, money(this.dispCash), x + w - 22, y + 46, 36, '#9cf5b8', 'right');
    // heat
    const hy = y + 70;
    panel(ctx, x + 40, hy, w - 40, 44, { fill: 'rgba(16,10,22,0.8)', stroke: g.heat > 0 ? 'rgba(255,90,70,0.8)' : 'rgba(255,178,58,0.35)' });
    spaced(ctx, 'HEAT', x + 62, hy + 28, 15, g.heat > 0 ? '#ff9a7a' : 'rgba(255,200,130,0.7)', 3);
    const searching = g.heat > 0 && (g.copNear ?? 0) > 55;
    const ph = Math.floor(g.time * 4) % 2;
    for (let i = 0; i < 5; i++) {
      const cx = x + 128 + i * 28, cy = hy + 22;
      const on = i < g.heat;
      ctx.beginPath();
      ctx.moveTo(cx - 9, cy - 13); ctx.lineTo(cx + 1, cy - 13); ctx.lineTo(cx + 11, cy); ctx.lineTo(cx + 1, cy + 13); ctx.lineTo(cx - 9, cy + 13); ctx.lineTo(cx + 1, cy); ctx.closePath();
      if (on) {
        let col = AMBER;
        if (searching) col = ph ? '#5a7aff' : AMBER; else col = ph ? '#ff5a4a' : '#ffb23a';
        ctx.fillStyle = col; ctx.shadowColor = col; ctx.shadowBlur = 10; ctx.fill(); ctx.shadowBlur = 0;
        ctx.strokeStyle = '#10081a'; ctx.lineWidth = 1.5; ctx.stroke();
      } else { ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fill(); ctx.strokeStyle = 'rgba(255,200,130,0.3)'; ctx.lineWidth = 1.2; ctx.stroke(); }
    }
    if (g.heat > 0) text(ctx, searching ? 'SEARCHING' : 'PURSUIT', x + w - 12, hy + 60, 12, searching ? '#9ab0ff' : '#ff8a7a', 'right', 700, FONT, true);
  }
  missionCard(ctx, g, r, W, H) {
    const o = g.mis.obj;
    if (!o || g.mode !== 'play') return;
    const x = 22, y = 20, w = Math.min(470, W * 0.4);
    ctx.font = `700 21px ${FONT2}`;
    const lines = wrap(ctx, o.text, w - 56);
    const h = 56 + lines.length * 26 + (o.sub ? 22 : 0);
    panel(ctx, x, y, w, h, { fill: 'rgba(16,10,22,0.82)' });
    ctx.fillStyle = AMBER; ctx.fillRect(x + 6, y + 8, 4, h - 16);
    spaced(ctx, o.kicker, x + 28, y + 26, 15, AMBER, 2.2);
    let ty = y + 54;
    ctx.font = `700 21px ${FONT2}`;
    for (const l of lines) { text(ctx, l, x + 28, ty, 21, CREAM, 'left', 700, FONT2); ty += 26; }
    if (o.sub) text(ctx, o.sub, x + 28, ty + 4, 14, 'rgba(255,230,190,0.72)', 'left', 500, FONT2);
    const m = g.markers[0];
    if (m) {
      const d = Math.hypot(m.x - g.player.x, m.y - g.player.y);
      text(ctx, `${Math.round(d)} m`, x + w - 20, y + 26, 16, '#7fe6ff', 'right');
    }
  }
  offscreenArrows(ctx, g, r, W, H) {
    const cam = r.cam;
    for (const m of g.markers.slice(0, 1)) {
      cam.p(m.x, m.y, 0);
      let x = cam.ox, y = cam.oy;
      const m0 = 46;
      if (x > m0 && x < W - m0 && y > m0 + 40 && y < H - m0) continue;
      const cx = W / 2, cy = H / 2;
      const dx = x - cx, dy = y - cy;
      const k = Math.min((W / 2 - m0) / Math.abs(dx || 1e-3), (H / 2 - m0) / Math.abs(dy || 1e-3));
      const ax = cx + dx * k, ay = cy + dy * k;
      ctx.save(); ctx.translate(ax, ay); ctx.rotate(Math.atan2(dy, dx));
      ctx.fillStyle = m.kind === 'start' ? AMBER : '#7fe6ff'; ctx.strokeStyle = '#10081a'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(-10, 13); ctx.lineTo(-3, 0); ctx.lineTo(-10, -13); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  }
  vehiclePanel(ctx, g, W, H) {
    const v = g.player.inVeh, m = MODELS[v.kind];
    const w = 250, x = W - w - 22, y = H - 24 - 96;
    panel(ctx, x, y, w, 96);
    const kmh = Math.round(Math.abs(v.speed) * 3.6);
    text(ctx, String(kmh), x + 168, y + 60, 46, CREAM, 'right', 700);
    text(ctx, 'KM/H', x + 176, y + 58, 15, AMBER, 'left');
    text(ctx, m.name.toUpperCase(), x + 22, y + 24, 14, 'rgba(255,230,190,0.85)', 'left');
    ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.fillRect(x + 22, y + 72, w - 52, 9);
    const f = clamp(v.hp / m.hp, 0, 1);
    ctx.fillStyle = f > 0.5 ? '#9cf5b8' : f > 0.25 ? AMBER : '#ff5a4a'; ctx.fillRect(x + 22, y + 72, (w - 52) * f, 9);
    // speed ticks
    for (let i = 0; i < 12; i++) { ctx.fillStyle = i / 12 < Math.abs(v.speed) / m.spd ? AMBER : 'rgba(255,255,255,0.12)'; ctx.fillRect(x + 22 + i * ((w - 52) / 12), y + 62, (w - 52) / 12 - 3, 4); }
  }
  dialog(ctx, g, W, H) {
    const d = g.dialog[0];
    if (!d) return;
    const w = Math.min(780, W - 60), x = (W - w) / 2, y = H - 24 - 84 - 112;
    ctx.font = `600 20px ${FONT2}`;
    const lines = wrap(ctx, d.text, w - 56);
    const h = 40 + lines.length * 26;
    const a = clamp(Math.min(d.t / 0.2, (d.dur - d.t) / 0.3), 0, 1);
    ctx.globalAlpha = a;
    panel(ctx, x, y - h + 84, w, h, { fill: 'rgba(16,10,22,0.86)' });
    const col = d.who === 'NIM' ? '#7fe6ff' : d.who === 'CORBIN' ? '#ff8a7a' : d.who === 'ALARM' ? '#ff6a5a' : AMBER;
    spaced(ctx, d.who, x + 26, y - h + 84 + 24, 15, col, 2.5);
    let ty = y - h + 84 + 24 + 24;
    for (const l of lines) { text(ctx, l, x + 26, ty, 20, CREAM, 'left', 600, FONT2); ty += 26; }
    ctx.globalAlpha = 1;
  }
  toasts(ctx, g, W, H) {
    let y = 196;
    for (const t of g.toasts) {
      const a = clamp(Math.min(t.t / 0.2, (4.2 - t.t) / 0.4), 0, 1);
      ctx.globalAlpha = a;
      ctx.font = `700 16px ${FONT2}`;
      const w = ctx.measureText(t.text).width + 36;
      panel(ctx, W - w - 22, y, w, 30, { fill: 'rgba(16,10,22,0.8)', stroke: t.kind === 'heat' ? '#ff6a5a' : t.kind === 'good' ? '#7af0a8' : 'rgba(255,178,58,0.5)' });
      text(ctx, t.text, W - 22 - w / 2, y + 21, 16, CREAM, 'center', 700, FONT2);
      y += 36;
    }
    ctx.globalAlpha = 1;
  }
  districtBanner(ctx, g, W, H) {
    if (g.districtT <= 0 || g.banner) return;
    const a = clamp(Math.min((3.2 - g.districtT) / 0.4, g.districtT / 0.6), 0, 1);
    ctx.globalAlpha = a;
    spaced(ctx, 'DISTRICT', W / 2, H * 0.14 - 34, 14, 'rgba(255,200,130,0.85)', 5, 'center');
    ctx.save(); ctx.font = `700 italic 46px ${FONT}`;
    spaced(ctx, g.district.toUpperCase(), W / 2, H * 0.14 + 10, 46, CREAM, 6, 'center');
    ctx.restore();
    ctx.fillStyle = AMBER; ctx.fillRect(W / 2 - 60, H * 0.14 + 22, 120, 3);
    ctx.globalAlpha = 1;
  }
  banner(ctx, g, W, H) {
    const b = g.banner; if (!b) return;
    const a = clamp(Math.min(b.t / 0.25, (b.dur - b.t) / 0.5), 0, 1);
    ctx.globalAlpha = a;
    const col = b.kind === 'good' ? '#9cf5b8' : b.kind === 'fail' ? '#ff6a5a' : AMBER;
    const y = H * 0.3, ww = Math.min(W - 80, 760);
    const gr = ctx.createLinearGradient(W / 2 - ww / 2, 0, W / 2 + ww / 2, 0);
    gr.addColorStop(0, 'rgba(16,10,22,0)'); gr.addColorStop(0.2, 'rgba(16,10,22,0.82)'); gr.addColorStop(0.8, 'rgba(16,10,22,0.82)'); gr.addColorStop(1, 'rgba(16,10,22,0)');
    ctx.fillStyle = gr; ctx.fillRect(W / 2 - ww / 2, y - 56, ww, 112);
    ctx.fillStyle = col; ctx.fillRect(W / 2 - 150, y - 56, 300, 2); ctx.fillRect(W / 2 - 150, y + 54, 300, 2);
    ctx.save(); ctx.font = `700 italic 64px ${FONT}`;
    spaced(ctx, b.text, W / 2, y + 16, 64, col, 7, 'center');
    ctx.restore();
    if (b.sub) text(ctx, b.sub, W / 2, y + 44, 19, CREAM, 'center', 600, FONT2);
    ctx.globalAlpha = 1;
  }
  wasted(ctx, g, W, H) {
    const t = Math.max(g.dead, g.busted);
    const a = clamp(t / 0.8, 0, 1);
    ctx.fillStyle = `rgba(10,6,16,${0.55 * a})`; ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = a;
    ctx.save(); ctx.font = `700 italic 120px ${FONT}`;
    spaced(ctx, g.busted > 0 ? 'BUSTED' : 'WASTED', W / 2, H / 2 + 36, 120, g.busted > 0 ? '#7a9aff' : '#ff4a3a', 12, 'center');
    ctx.restore(); ctx.globalAlpha = 1;
  }
  // ---------------------------------------------------------------- title + menus
  title(ctx, g, W, H) {
    // darken the left for readability, keep the city bright on the right
    const gr = ctx.createLinearGradient(0, 0, W * 0.7, 0);
    gr.addColorStop(0, 'rgba(12,6,20,0.7)'); gr.addColorStop(0.5, 'rgba(12,6,20,0.3)'); gr.addColorStop(1, 'rgba(12,6,20,0)');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
    const bg = ctx.createLinearGradient(0, H * 0.7, 0, H);
    bg.addColorStop(0, 'rgba(12,6,20,0)'); bg.addColorStop(1, 'rgba(12,6,20,0.7)');
    ctx.fillStyle = bg; ctx.fillRect(0, H * 0.7, W, H * 0.3);
    const x = Math.max(44, W * 0.07), y = H * 0.33;
    const sz = Math.min(H * 0.2, W * 0.1);
    spaced(ctx, 'ROOKSPIRE  ·  HARBOUR CITY', x + 4, y - sz * 0.88, Math.round(sz * 0.17), AMBER, 5);
    // logo
    ctx.save();
    ctx.font = `700 italic ${sz}px ${FONT}`; ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    let lw = 0; const word = 'AMBER'; const sp = sz * 0.05;
    for (const ch of word) lw += ctx.measureText(ch).width + sp;
    const grad = ctx.createLinearGradient(0, y - sz, 0, y);
    grad.addColorStop(0, '#fff0b0'); grad.addColorStop(0.45, '#ffb23a'); grad.addColorStop(1, '#e8541e');
    let cx = x;
    for (const ch of word) {
      ctx.fillStyle = 'rgba(8,4,14,0.9)'; ctx.fillText(ch, cx + sz * 0.045, y + sz * 0.045);
      ctx.lineWidth = sz * 0.03; ctx.strokeStyle = '#2a0f1a'; ctx.strokeText(ch, cx, y);
      ctx.fillStyle = grad; ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + sp;
    }
    const y2 = y + sz * 0.92; cx = x + sz * 0.1;
    const g2 = ctx.createLinearGradient(0, y2 - sz, 0, y2);
    g2.addColorStop(0, '#ffffff'); g2.addColorStop(0.5, '#ffd9a0'); g2.addColorStop(1, '#ff9a4a');
    for (const ch of 'QUAY') {
      ctx.fillStyle = 'rgba(8,4,14,0.9)'; ctx.fillText(ch, cx + sz * 0.045, y2 + sz * 0.045);
      ctx.lineWidth = sz * 0.03; ctx.strokeStyle = '#2a0f1a'; ctx.strokeText(ch, cx, y2);
      ctx.fillStyle = g2; ctx.fillText(ch, cx, y2); cx += ctx.measureText(ch).width + sp * 1.4;
    }
    ctx.restore();
    // chevrons
    for (let i = 0; i < 5; i++) {
      const bx = x + lw + 24 + i * 26, by = y - sz * 0.45;
      ctx.beginPath(); ctx.moveTo(bx, by - 18); ctx.lineTo(bx + 11, by - 18); ctx.lineTo(bx + 24, by); ctx.lineTo(bx + 11, by + 18); ctx.lineTo(bx, by + 18); ctx.lineTo(bx + 13, by); ctx.closePath();
      ctx.fillStyle = i < 3 ? AMBER : 'rgba(255,178,58,0.25)'; ctx.fill();
    }
    spaced(ctx, 'A ROOKSPIRE CRIME STORY', x + 6, y2 + sz * 0.3, Math.round(sz * 0.15), CREAM, 7);
    // menu
    const items = this.items(g);
    this.btns = [];
    let my = y2 + sz * 0.62;
    const bw = Math.min(330, W * 0.34), bh = 48;
    items.forEach(([label, id, disabled], i) => {
      const sel = this.sel === i;
      const bx = x + (sel ? 14 : 0);
      this.btns.push({ x, y: my, w: bw, h: bh, id, disabled });
      ctx.beginPath(); ctx.moveTo(bx + 14, my); ctx.lineTo(bx + bw, my); ctx.lineTo(bx + bw - 14, my + bh); ctx.lineTo(bx, my + bh); ctx.closePath();
      ctx.fillStyle = sel ? (disabled ? 'rgba(120,100,100,0.7)' : AMBER) : 'rgba(16,10,22,0.7)'; ctx.fill();
      ctx.strokeStyle = sel ? '#fff0d0' : 'rgba(255,178,58,0.5)'; ctx.lineWidth = 1.6; ctx.stroke();
      ctx.save(); ctx.font = `700 24px ${FONT}`;
      spaced(ctx, label, bx + 34, my + 33, 24, disabled ? 'rgba(255,240,210,0.35)' : sel ? '#1a0c1c' : CREAM, 4);
      ctx.restore();
      if (id === 'continue' && !disabled) text(ctx, this.saveInfo, bx + bw - 26, my + 31, 14, sel ? '#3a1c10' : 'rgba(255,230,190,0.75)', 'right', 600, FONT2, false);
      my += bh + 12;
    });
    text(ctx, '↑ ↓ select · ENTER confirm · click works too', x + 4, H - 38, 14, 'rgba(255,230,190,0.7)', 'left', 500, FONT2);
    text(ctx, 'Original game. Every name, street and faction is invented.', x + 4, H - 18, 12, 'rgba(255,230,190,0.45)', 'left', 500, FONT2);
    if (this.overlay === 'controls') this.controls(ctx, W, H);
  }
  pause(ctx, g, W, H) {
    ctx.fillStyle = 'rgba(10,6,16,0.62)'; ctx.fillRect(0, 0, W, H);
    spaced(ctx, 'PAUSED', W / 2, H * 0.3, 64, AMBER, 10, 'center');
    const items = this.items(g);
    this.btns = [];
    let my = H * 0.3 + 40;
    const bw = 320, bh = 48;
    items.forEach(([label, id], i) => {
      const sel = this.sel === i, bx = W / 2 - bw / 2;
      this.btns.push({ x: bx, y: my, w: bw, h: bh, id });
      ctx.beginPath(); ctx.moveTo(bx + 14, my); ctx.lineTo(bx + bw, my); ctx.lineTo(bx + bw - 14, my + bh); ctx.lineTo(bx, my + bh); ctx.closePath();
      ctx.fillStyle = sel ? AMBER : 'rgba(16,10,22,0.8)'; ctx.fill(); ctx.strokeStyle = sel ? '#fff0d0' : 'rgba(255,178,58,0.5)'; ctx.stroke();
      spaced(ctx, label, W / 2, my + 33, 24, sel ? '#1a0c1c' : CREAM, 4, 'center');
      my += bh + 12;
    });
    if (this.overlay === 'controls') this.controls(ctx, W, H);
  }
  controls(ctx, W, H) {
    ctx.fillStyle = 'rgba(10,6,16,0.9)'; ctx.fillRect(0, 0, W, H);
    const w = Math.min(820, W - 60), x = (W - w) / 2, y = H * 0.12;
    panel(ctx, x, y, w, H * 0.76, { fill: 'rgba(22,14,30,0.95)' });
    spaced(ctx, 'CONTROLS', x + 36, y + 56, 40, AMBER, 6);
    const rows = [
      ['W A S D / Arrows', 'Move on foot · throttle and steer in a car'], ['Shift', 'Sprint'], ['Mouse', 'Aim (on foot)'], ['Left click', 'Shoot the Rivet .38 / punch'], ['Right click / V', 'Punch'],
      ['R', 'Reload'], ['1 / 2 / Tab', 'Fists · pistol · swap'], ['F', 'Enter / exit a vehicle · carjack a driver'], ['Space', 'Handbrake'], ['S while moving', 'Brake, then reverse'],
      ['H', 'Horn'], ['Q / E', 'Rotate camera'], ['M', 'Toggle music'], ['Esc / P', 'Pause'],
    ];
    let ry = y + 100;
    const step = Math.min(34, (H * 0.76 - 150) / rows.length);
    for (const [k, d] of rows) {
      text(ctx, k, x + 40, ry, 20, AMBER, 'left'); text(ctx, d, x + 280, ry, 19, CREAM, 'left', 500, FONT2); ry += step;
    }
    text(ctx, 'Press any key or click to close', x + w / 2, y + H * 0.76 - 18, 15, 'rgba(255,230,190,0.7)', 'center', 500, FONT2);
  }
  hit(x, y) {
    for (let i = 0; i < this.btns.length; i++) { const b = this.btns[i]; if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return i; }
    return -1;
  }
}
