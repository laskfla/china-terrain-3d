// Build the historical atlas bundle (build/history.json) from jiangshan-map (GPL-3.0).
// Run tools/fetch_sources.sh once first, then:  node tools/build_history.js
//
// Output: eras with their phases (year ranges -> snapshot), one entry per snapshot listing
// its polities, the deduplicated polity outlines (simplified to ~1 km, quantised to 0.01 deg,
// delta-coded Int16, gzip + base64), the settlements with the years they are shown, and the
// river courses, lakes and water labels that existed only in some years (e.g. the Yellow River's
// former courses, Yunmeng and Juye marshes), plus the Juyan lakes, which are drawn in this file.
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
for (const f of ['map_data.js', 'china_geo_data.js', 'atlas_snapshots.js']) {
  vm.runInContext(fs.readFileSync(path.join(SRC, f), 'utf8'), ctx, { filename: f });
}
const DYN = ctx.window.DYNASTY_DATA;
const SNAP = ctx.window.ATLAS_SNAPSHOTS;
const HYDRO = ctx.window.HYDRO_DATA;

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

// ---------- time-bound hydrography ----------
// Only features with an appear/vanish year: the rest is today's water, which the terrain already has.
// The modern Yellow River (appear 1855, open-ended) is skipped too: the page draws its own, valley-snapped.
const OPEN0 = -9999, OPEN1 = 9999;
const span = (f) => [f.appear != null ? f.appear : OPEN0, f.vanish != null ? f.vanish - 1 : OPEN1];
const timed = (f) => f.appear != null || f.vanish != null;
const r2 = (v) => Math.round(v * 100) / 100;
function chaikin(line, rounds) { // smooth the coarse hand-drawn courses, keeping the end points
  for (let k = 0; k < rounds; k++) {
    const out = [line[0]];
    for (let i = 0; i < line.length - 1; i++) {
      const a = line[i], b = line[i + 1];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    out.push(line[line.length - 1]);
    line = out;
  }
  return line;
}
const ZH_RIVER = { Huang: '黄河', Huai: '淮河', Ji: '济水', Si: '泗水', Feihuang: '废黄河' };
// [name, rank, from, to, lines]
const hydroRivers = HYDRO.rivers.filter(timed).filter((r) => !(r.name === 'Huang' && r.appear >= 1855 && r.vanish == null))
  .map((r) => [ZH_RIVER[r.name] || r.name, r.rank, ...span(r), r.lines.map((l) => chaikin(l, 3).map((p) => [r2(p[0]), r2(p[1])]))]);
// [name, from, to, rings]
const hydroLakes = HYDRO.lakes.filter(timed).map((l) => [l.name, ...span(l), l.rings.map((r) => r.map((p) => [r2(p[0]), r2(p[1])]))]);
// [text, lon, lat, kind, from, to]; labels still valid today (Yellow River, Hongze) are the page's own
const hydroLabels = HYDRO.labels.filter((l) => l.vanish != null)
  .map((l) => [l.zh.replace(/\s+/g, ''), l.coord[0], l.coord[1], l.kind, ...span(l)]);
// Juyan is not in jiangshan-map, and today's terrain has no water there, so its outlines are added here.
// Schematic shapes with areas from the literature: Qin-Han ~720 km2, gone by about AD 250; West 267 and
// East 35 km2 as of 1958, used for all later years (the fluctuations in between are not modelled).
// West dried up in 1961, East in 1992; East was refilled from 2002 (a far `to`, not "today's lake").
const JUYAN_EAST = [[[101.22, 42.28], [101.24, 42.31], [101.27, 42.31], [101.3, 42.28], [101.28, 42.25], [101.24, 42.25]]];
hydroLakes.push(
  ['Juyan Ze', OPEN0, 250, [[[101.48, 41.93], [101.55, 41.99], [101.66, 42.02], [101.79, 42.02], [101.91, 41.98], [101.96, 41.91], [101.9, 41.84], [101.77, 41.82], [101.63, 41.83], [101.52, 41.86]]]],
  ['Juyan West', 251, 1960, [[[100.48, 42.29], [100.53, 42.34], [100.62, 42.36], [100.71, 42.34], [100.76, 42.29], [100.72, 42.24], [100.62, 42.22], [100.53, 42.24]]]],
  ['Juyan East', 251, 1991, JUYAN_EAST],
  ['Juyan East', 2002, OPEN1 - 1, JUYAN_EAST],
);
hydroLabels.push(
  ['居延泽', 101.72, 42.1, 'lake', OPEN0, 250],
  ['西居延海', 100.62, 42.45, 'lake', 251, 1960],
  ['东居延海', 101.26, 42.4, 'lake', 251, 1991],
  ['东居延海', 101.26, 42.4, 'lake', 2002, OPEN1],
);

// ---------- pack ----------
for (const v of stream) if (v < -32768 || v > 32767) throw new Error(`value out of Int16 range: ${v}`);
const i16 = Int16Array.from(stream);
const packed = zlib.gzipSync(Buffer.from(i16.buffer), { level: 9 }).toString('base64');
const bundle = { q: Q, roles: ROLES, eras, snaps, nshapes: shapeIndex.size, shapes: packed, settlements,
  hydro: { rivers: hydroRivers, lakes: hydroLakes, labels: hydroLabels } };
fs.mkdirSync(path.dirname(OUT), { recursive: true });
const json = JSON.stringify(bundle);
fs.writeFileSync(OUT, json);
let pts = 0;
for (let i = 0; i < stream.length; ) { // count points for the log
  const np = stream[i++];
  for (let p = 0; p < np; p++) { const nr = stream[i++]; for (let r = 0; r < nr; r++) { const n = stream[i++]; pts += n; i += n * 2; } }
}
console.log(`eras ${eras.length}, snapshots ${snaps.length}, shapes ${shapeIndex.size} (${pts} points), settlements ${settlements.length}`);
console.log(`hydro: ${hydroRivers.length} river courses, ${hydroLakes.length} lakes, ${hydroLabels.length} labels`);
console.log(`wrote ${path.relative(ROOT, OUT)} (${(json.length / 1e3).toFixed(0)} kB, outlines ${(packed.length / 1e3).toFixed(0)} kB)`);
