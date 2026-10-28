// Build the historical atlas bundle (build/history.json) from jiangshan-map (GPL-3.0).
// Run tools/fetch_sources.sh once first, then:  node tools/build_history.js
//
// Output: eras with their phases (year ranges -> snapshot), one entry per snapshot listing
// its polities, the deduplicated polity outlines (simplified to ~1 km, quantised to 0.01 deg,
// delta-coded Int16, gzip + base64), and the settlements with the years they are shown.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'sources', 'jiangshan-map', 'js');
const OUT = path.resolve(process.argv[2] || path.join(ROOT, 'build', 'history.json'));

const ctx = { window: {} };
vm.createContext(ctx);
for (const f of ['map_data.js', 'atlas_snapshots.js']) {
  vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
}
const DYN = ctx.window.DYNASTY_DATA;
const SNAP = ctx.window.ATLAS_SNAPSHOTS;

const Q = 100;        // quantisation: 0.01 deg
const EPS = 0.01;     // simplification tolerance, deg
const ROLES = ['neighbor', 'main', 'rival', 'protectorate'];

// ---------- geometry ----------
function dpOpen(pts, eps) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy);
    let md = 0, mi = -1;
    for (let i = a + 1; i < b; i++) {
      const d = L ? Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L : Math.hypot(pts[i][0] - ax, pts[i][1] - ay);
      if (d > md) { md = d; mi = i; }
    }
    if (md > eps) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
// closed ring: split at the vertex farthest from the first so both halves are open polylines
function simplifyRing(r, eps) {
  if (r.length < 4) return r;
  let far = 0, fd = -1;
  for (let i = 1; i < r.length; i++) {
    const d = Math.hypot(r[i][0] - r[0][0], r[i][1] - r[0][1]);
    if (d > fd) { fd = d; far = i; }
  }
  return dpOpen(r.slice(0, far + 1), eps).concat(dpOpen(r.slice(far), eps).slice(1));
}
function quantRing(r) {
  const out = [];
  for (const p of simplifyRing(r, EPS)) {
    const x = Math.round(p[0] * Q), y = Math.round(p[1] * Q);
    const last = out[out.length - 1];
    if (!last || last[0] !== x || last[1] !== y) out.push([x, y]);
  }
  if (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop();
  return out.length >= 3 ? out : null;
}

// ---------- outlines (deduplicated across snapshots) ----------
// stream per shape: nPolys, then per polygon nRings, then per ring nPts, x0, y0, dx, dy, ...
const stream = [];
const shapeIndex = new Map();
function addShape(shape) {
  const polys = shape.type === 'Polygon' ? [shape.coordinates] : shape.coordinates;
  const key = JSON.stringify(polys);
  if (shapeIndex.has(key)) return shapeIndex.get(key);
  const qp = polys.map((rings) => {
    const qr = [];
    rings.forEach((r, i) => { const q = quantRing(r); if (q) qr.push(q); else if (i === 0) qr.length = 0; });
    return qr;
  }).filter((rings) => rings.length);
  stream.push(qp.length);
  for (const rings of qp) {
    stream.push(rings.length);
    for (const r of rings) {
      stream.push(r.length, r[0][0], r[0][1]);
      for (let i = 1; i < r.length; i++) stream.push(r[i][0] - r[i - 1][0], r[i][1] - r[i - 1][1]);
    }
  }
  const id = shapeIndex.size;
  shapeIndex.set(key, id);
  return id;
}

// ---------- eras, phases, snapshots ----------
const snapIds = new Map();
const snaps = [];
function snapId(key) {
  if (snapIds.has(key)) return snapIds.get(key);
  const s = SNAP[key];
  const pol = ((s && s.polities) || []).map((p) => [
    addShape(p.shape), p.title, ROLES.indexOf(p.role), p.tint || null,
    p.anchor ? Math.round(p.anchor[0] * Q) / Q : null, p.anchor ? Math.round(p.anchor[1] * Q) / Q : null,
  ]);
  pol.forEach((p) => { if (p[2] < 0) throw new Error(`unknown role in ${key}`); });
  snaps.push({ cap: (s && s.caption) || '', pol });
  snapIds.set(key, snaps.length - 1);
  return snaps.length - 1;
}

// A boundary year belongs to the later dynasty (as in jiangshan-map's _findDynastyIndex).
const eras = DYN.map((d, di) => {
  const end = di < DYN.length - 1 ? DYN[di + 1].fromYear - 1 : d.toYear;
  const phases = d.phases && d.phases.length ? d.phases : [{ until: d.toYear, snap: `s_${d.key}` }];
  const ph = phases.map((p, i) => {
    const from = i === 0 ? d.fromYear : phases[i - 1].until;
    const to = Math.min(i === phases.length - 1 ? end : p.until - 1, end);
    return from <= to ? [from, to, snapId(p.snap), p.overview || ''] : null;
  }).filter(Boolean);
  return { key: d.key, title: d.title, from: d.fromYear, to: end, focus: d.focusYear != null ? d.focusYear : d.fromYear, badge: d.badge || d.title, tint: d.tint, seat: d.seat || '', ph };
});

// ---------- settlements ----------
// [ancient, modern, lon, lat, from, to, tier, capitalPeriods|0, remark]
const settlements = [];
DYN.forEach((d, di) => {
  const era = eras[di];
  for (const s of d.settlements || []) {
    if (!Array.isArray(s.coord)) continue;
    const from = Math.max(era.from, s.appear != null ? s.appear : -1e4);
    const to = Math.min(era.to, s.vanish != null ? s.vanish - 1 : 1e4);
    if (from > to) continue;
    const cap = s.isCapital ? (s.capitalPeriods || [[era.from, era.to]]) : 0;
    settlements.push([s.ancient, s.modern || '', +s.coord[0].toFixed(3), +s.coord[1].toFixed(3), from, to, s.tier || 0, cap, s.remark || '']);
  }
});

// ---------- pack ----------
for (const v of stream) if (v < -32768 || v > 32767) throw new Error(`value out of Int16 range: ${v}`);
const i16 = Int16Array.from(stream);
const packed = zlib.gzipSync(Buffer.from(i16.buffer), { level: 9 }).toString('base64');
const bundle = { q: Q, roles: ROLES, eras, snaps, nshapes: shapeIndex.size, shapes: packed, settlements };
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const json = JSON.stringify(bundle);
fs.writeFileSync(OUT, json);
let pts = 0;
for (let i = 0; i < stream.length; ) { // count points for the log
  const np = stream[i++];
  for (let p = 0; p < np; p++) { const nr = stream[i++]; for (let r = 0; r < nr; r++) { const n = stream[i++]; pts += n; i += n * 2; } }
}
console.log(`eras ${eras.length}, snapshots ${snaps.length}, shapes ${shapeIndex.size} (${pts} points), settlements ${settlements.length}`);
console.log(`wrote ${path.relative(ROOT, OUT)} (${(json.length / 1e3).toFixed(0)} kB, outlines ${(packed.length / 1e3).toFixed(0)} kB)`);
