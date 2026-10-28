"""Build the terrain data bundle (build/terrain.json) used by src/template.html.

Run tools/fetch_sources.sh once first, then:  python3 tools/build_data.py

Original notes: for the 3D China + neighbours map.

Elevation: NASA 'elev_bump_4k' global topography (0.088 deg), calibrated against
44 places with known elevations: metres = 28.1 * (grey - 23.5).
Coastline/water: NASA 'water_4k' mask. Borders: ECharts 4.9 china.js / world.js.
"""
import numpy as np, gzip, base64, json, sys, os
from pathlib import Path as FsPath
from PIL import Image
from scipy import ndimage as ndi
from matplotlib.path import Path
ROOT = FsPath(__file__).resolve().parents[1]
SRC = ROOT / 'sources'
OUT = FsPath(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'build' / 'terrain.json'
OUT.parent.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(ROOT / 'tools'))
from geo_util import features

LON0, LON1, LAT0, LAT1, RES = 60.0, 146.0, 3.5, 56.0, 0.1
NX = int(round((LON1 - LON0) / RES)) + 1
NY = int(round((LAT1 - LAT0) / RES)) + 1
lon = LON0 + np.arange(NX) * RES
lat = LAT1 - np.arange(NY) * RES
LON, LAT = np.meshgrid(lon, lat)
PTS = np.column_stack([LON.ravel(), LAT.ravel()])
print("grid", NX, NY, NX * NY)

# ---------------- elevation ----------------
g = np.asarray(Image.open(SRC / 'webgl-earth/images/elev_bump_4k.jpg').convert('L')).astype(float)
g = ndi.gaussian_filter(g, 0.55)                     # soften JPEG blocking
GH, GW = g.shape
def sample(img, lons, lats, order=1):
    H, W = img.shape
    cols = (lons + 180) / 360 * W - 0.5
    rows = (90 - lats) / 180 * H - 0.5
    return ndi.map_coordinates(img, [rows.ravel(), cols.ravel()], order=order, mode='nearest').reshape(lons.shape)
v = sample(g, LON, LAT, order=3)
E = np.maximum(0, 28.1 * (v - 23.5))

# ---------------- water ----------------
w = np.asarray(Image.open(SRC / 'webgl-earth/images/water_4k.png').convert('L')).astype(float)
wv = sample(w, LON, LAT, order=1)
water = wv > 140
lab, n = ndi.label(water)
border_labels = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
sizes = ndi.sum(water, lab, index=np.arange(1, n + 1))
ocean = np.isin(lab, list(border_labels))
# very large enclosed water bodies (none expected) also count as ocean
lakes = water & ~ocean
print("water comps", n, "ocean comps", len(border_labels), "lake cells", lakes.sum())

# ---------------- regions ----------------
def raster_polys(polys):
    m = np.zeros(NY * NX, bool)
    for rings in polys:
        for r in rings:
            r = np.asarray(r)
            if len(r) < 3: continue
            bb = (PTS[:, 0] >= r[:, 0].min()) & (PTS[:, 0] <= r[:, 0].max()) & (PTS[:, 1] >= r[:, 1].min()) & (PTS[:, 1] <= r[:, 1].max())
            if not bb.any(): continue
            idx = np.where(bb)[0]
            inside = Path(r).contains_points(PTS[idx])
            m[idx[inside]] ^= True        # even-odd for holes
    return m.reshape(NY, NX)

cn = features(SRC / 'china.geo.json')
wd = features(SRC / 'world.geo.json')
region = np.zeros((NY, NX), np.uint8)
names = [""]
prov_cp = []
for f in cn:
    m = raster_polys(f['polys'])
    names.append(f['name'])
    region[m & (region == 0)] = len(names) - 1
    prov_cp.append([f['name'], f['cp']])
N_PROV = len(names) - 1
china = (region > 0) & (region <= N_PROV)

ZH = {'Russia': '俄罗斯', 'Mongolia': '蒙古', 'Kazakhstan': '哈萨克斯坦', 'Kyrgyzstan': '吉尔吉斯斯坦', 'Tajikistan': '塔吉克斯坦',
      'Afghanistan': '阿富汗', 'Pakistan': '巴基斯坦', 'India': '印度', 'Nepal': '尼泊尔', 'Bhutan': '不丹', 'Myanmar': '缅甸',
      'Lao PDR': '老挝', 'Vietnam': '越南', 'Dem. Rep. Korea': '朝鲜', 'Korea': '韩国', 'Japan': '日本', 'Philippines': '菲律宾',
      'Thailand': '泰国', 'Cambodia': '柬埔寨', 'Malaysia': '马来西亚', 'Indonesia': '印度尼西亚', 'Brunei': '文莱',
      'Bangladesh': '孟加拉国', 'Sri Lanka': '斯里兰卡', 'Uzbekistan': '乌兹别克斯坦', 'Turkmenistan': '土库曼斯坦', 'Iran': '伊朗',
      'Siachen Glacier': '锡亚琴冰川地区', 'Singapore': '新加坡', 'Timor-Leste': '东帝汶', 'Palau': '帕劳', 'N. Mariana Is.': '北马里亚纳群岛', 'Guam': '关岛'}
bbox_poly = Path([(LON0, LAT0), (LON1, LAT0), (LON1, LAT1), (LON0, LAT1)])
country_feats = []
for f in wd:
    if f['name'] in ('China', ''): continue
    allp = np.concatenate([np.asarray(r) for p in f['polys'] for r in p])
    if allp[:, 0].max() < LON0 or allp[:, 0].min() > LON1 or allp[:, 1].max() < LAT0 or allp[:, 1].min() > LAT1: continue
    m = raster_polys(f['polys'])
    if not m.any() and f['name'] not in ZH: continue
    names.append(ZH.get(f['name'], f['name']))
    region[m & (region == 0)] = len(names) - 1
    country_feats.append(f)
print("countries", names[N_PROV + 1:])

land = ~ocean | china
land &= ~(ocean & ~china)
land = ~ocean | china
# land cells without a region: nearest region
unassigned = land & (region == 0)
# unassigned land touching a neighbour (e.g. strips between the two map sources' borders) goes to that neighbour;
# everything else (coastline mismatch, slivers between provinces) goes to the nearest region.
foreign = region > N_PROV
labu, nu = ndi.label(unassigned)
touch = np.unique(labu[ndi.binary_dilation(foreign) & unassigned])
touch = touch[touch > 0]
strip = np.isin(labu, touch)
if strip.any():
    d, (ii, jj) = ndi.distance_transform_edt(~foreign, return_indices=True)
    region[strip] = region[ii[strip], jj[strip]]
    print("unassigned cells given to neighbours", int(strip.sum()), "of", int(unassigned.sum()))
unassigned = land & (region == 0)
if unassigned.any():
    d, (ii, jj) = ndi.distance_transform_edt(region == 0, return_indices=True)
    region[unassigned] = region[ii[unassigned], jj[unassigned]]
region[~land] = 0
lakes &= land
# lakes: flatten to their median level
lab2, n2 = ndi.label(lakes)
for k in range(1, n2 + 1):
    m = lab2 == k
    if m.sum() < 2:
        lakes[m] = False; continue
    E[m] = np.percentile(E[m], 30)

# extra lakes missing from the water mask (small ones the map still shows)
EXTRA_LAKES = [(100.18, 36.88, 0.42, 0.24), (116.25, 29.05, 0.22, 0.42), (112.9, 29.25, 0.32, 0.25), (120.22, 31.2, 0.22, 0.2),
               (90.6, 30.72, 0.4, 0.14), (88.95, 31.8, 0.3, 0.13), (117.4, 49.0, 0.28, 0.2), (87.0, 41.98, 0.3, 0.13),
               (132.4, 45.1, 0.35, 0.28), (118.55, 33.3, 0.22, 0.2), (117.55, 31.58, 0.2, 0.1), (97.7, 34.9, 0.16, 0.13), (97.3, 34.95, 0.15, 0.1),
               (77.3, 42.43, 1.05, 0.22), (100.45, 51.05, 0.2, 0.5), (92.8, 50.3, 0.4, 0.17), (104.0, 12.9, 0.45, 0.2), (84.05, 48.0, 0.5, 0.13)]
for x, y, rx, ry in EXTRA_LAKES:
    m = (((LON - x) / rx) ** 2 + ((LAT - y) / ry) ** 2 <= 1) & land
    if (m & lakes).sum() > 0.6 * m.sum():  # already present
        continue
    m &= ~lakes
    if m.sum():
        E[m] = np.percentile(E[m], 15); lakes |= m

# relief (local roughness) for the browser's detail synthesis: metres, 0..2550 in uint8 x10
mx = ndi.maximum_filter(E, 5); mn = ndi.minimum_filter(E, 5)
relief = np.clip((mx - mn) / 10, 0, 255).astype(np.uint8)
relief[lakes | ~land] = 0

# ---------------- borders ----------------
def dp(points, tol):
    points = np.asarray(points)
    if len(points) < 3: return points
    keep = np.zeros(len(points), bool); keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        a, b = stack.pop()
        if b <= a + 1: continue
        p, q = points[a], points[b]
        seg = q - p; L = np.hypot(*seg)
        r = points[a + 1:b] - p
        d = np.abs(seg[0] * r[:, 1] - seg[1] * r[:, 0]) / L if L > 0 else np.hypot(r[:, 0], r[:, 1])
        k = np.argmax(d)
        if d[k] > tol:
            keep[a + 1 + k] = True; stack += [(a, a + 1 + k), (a + 1 + k, b)]
    return points[keep]

def cell(lo, la):
    i = np.clip(np.round((lo - LON0) / RES).astype(int), 0, NX - 1)
    j = np.clip(np.round((LAT1 - la) / RES).astype(int), 0, NY - 1)
    return j, i

near_ocean = ndi.binary_dilation(~land, iterations=1)
near_ocean3 = ndi.binary_dilation(~land, iterations=3)
dist_china = ndi.distance_transform_edt(~china)          # cells to nearest China cell
def q(v): return int(round(v * 200))      # 0.005 deg quantum
def flat(run): return [c for p in run for c in (q(p[0] - LON0), q(p[1] - LAT0))]

prov_lines = []
for f in cn:
    for rings in f['polys']:
        for r in rings:
            r = dp(r, 0.012)
            if len(r) >= 2: prov_lines.append(flat(r))

# China's land border = province edges used by exactly one province, minus coastline
from collections import Counter
def key(p): return (round(p[0], 3), round(p[1], 3))
ecount = Counter()
for f in cn:
    for rings in f['polys']:
        for r in rings:
            for a, b in zip(r[:-1], r[1:]): ecount[tuple(sorted([key(a), key(b)]))] += 1
def runs_from(r, okfn):
    out, run = [], []
    for k in range(len(r) - 1):
        if okfn(r[k], r[k + 1]):
            if not run: run = [r[k]]
            run.append(r[k + 1])
        else:
            if len(run) >= 2: out.append(run)
            run = []
    if len(run) >= 2: out.append(run)
    return out
def side_regions(a, b, d):
    mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
    dx, dy = (b[0] - a[0]) * np.cos(np.radians(my)), b[1] - a[1]
    L = np.hypot(dx, dy) or 1
    nx, ny = -dy / L, dx / L                       # unit normal (in km-ish space)
    out = []
    for sgn in (1, -1):
        lo = mx + sgn * nx * d / np.cos(np.radians(my)); la = my + sgn * ny * d
        j, i = cell(np.array([lo]), np.array([la]))
        out.append(int(region[j[0], i[0]]))
    return out
def is_china(r): return 0 < r <= N_PROV
def china_border_ok(a, b):
    for d in (0.12, 0.25, 0.4):
        r1, r2 = side_regions(a, b, d)
        if (is_china(r1) and r2 > N_PROV) or (is_china(r2) and r1 > N_PROV): return True
    return False
def country_border_ok(a, b):
    for d in (0.12, 0.25, 0.4):
        r1, r2 = side_regions(a, b, d)
        if r1 > N_PROV and r2 > N_PROV and r1 != r2: return True
    return False
cn_border = []
for f in cn:
    for rings in f['polys']:
        for r in rings:
            r = [tuple(p) for p in r]
            def ok(a, b):
                if ecount[tuple(sorted([key(a), key(b)]))] != 1: return False
                return china_border_ok(a, b)
            for run in runs_from(r, ok):
                run = dp(np.asarray(run), 0.006)
                if len(run) >= 2: cn_border.append(flat(run))

# other countries' borders, skipping anything at/inside China's border and the coasts
country_lines = []
for f in country_feats:
    for rings in f['polys']:
        for r in rings:
            r = dp(np.asarray(r), 0.012)
            if len(r) < 2: continue
            def ok(a, b):
                mx, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
                if not (LON0 < mx < LON1 and LAT0 < my < LAT1): return False
                j, i = cell(np.array([mx]), np.array([my]))
                return dist_china[j[0], i[0]] > 2.5 and country_border_ok(a, b)
            for run in runs_from(list(map(tuple, r)), ok):
                country_lines.append(flat(run))
# drop short slivers that just shadow a longer border run (e.g. river-island shores)
from scipy.spatial import cKDTree
def run_len(fl):
    a = np.array(fl, float).reshape(-1, 2) / 200.0
    return np.hypot(*np.diff(a, axis=0).T).sum(), a
def dedupe(lines, min_len=0.3, near=0.12):
    longs = [l for l in lines if run_len(l)[0] >= min_len]
    if not longs: return lines
    tree = cKDTree(np.concatenate([run_len(l)[1] for l in longs]))
    out = []
    for l in lines:
        ln, a = run_len(l)
        if ln >= min_len: out.append(l); continue
        d, _ = tree.query(a)
        if d.max() < near: continue
        # parallel sliver: close to a long run but not attached to it at either end
        if d.max() < 0.2 and min(d[0], d[-1]) > 0.015: continue
        # tiny isolated piece (island shore inside a border river)
        if ln < 0.15 and min(d[0], d[-1]) > 0.015: continue
        out.append(l)
    return out
n0 = len(cn_border); cn_border = dedupe(cn_border); print("cn border slivers dropped", n0 - len(cn_border))
n0 = len(country_lines); country_lines = dedupe(country_lines); print("neighbour slivers dropped", n0 - len(country_lines))
# dense China-border points for snapping border rivers
_bp = []
for fl in cn_border:
    a = run_len(fl)[1] + [LON0, LAT0]
    for p, q_ in zip(a[:-1], a[1:]):
        n_ = max(1, int(np.hypot(*(q_ - p)) / 0.01))
        for t in range(n_): _bp.append(p + (q_ - p) * t / n_)
BORDER_PTS = np.array(_bp); BORDER_TREE = cKDTree(BORDER_PTS)
print("china border runs", len(cn_border), sum(len(l) for l in cn_border) // 2)
print("prov lines", len(prov_lines), sum(len(l) for l in prov_lines) // 2, "country lines", len(country_lines), sum(len(l) for l in country_lines) // 2)

# ---------------- rivers (snapped to valleys) ----------------
RIVERS = json.load(open(ROOT / 'data' / 'rivers.json', encoding='utf8'))
Es = ndi.gaussian_filter(E, 0.8)
def snap(path, radius=0.25, k=600.0):
    pts = []
    for a, b in zip(path[:-1], path[1:]):
        n = max(1, int(np.ceil(np.hypot(b[0] - a[0], b[1] - a[1]) / 0.05)))
        for t in range(n): pts.append((a[0] + (b[0] - a[0]) * t / n, a[1] + (b[1] - a[1]) * t / n))
    pts.append(tuple(path[-1]))
    out = []
    R = int(radius / RES)
    for (lo, la) in pts:
        j, i = cell(np.array([lo]), np.array([la])); j, i = int(j[0]), int(i[0])
        j0, j1, i0, i1 = max(0, j - R), min(NY, j + R + 1), max(0, i - R), min(NX, i + R + 1)
        win = Es[j0:j1, i0:i1]
        jj, ii = np.mgrid[j0:j1, i0:i1]
        dist = np.hypot((jj - j) * RES, (ii - i) * RES * np.cos(np.radians(la)))
        cost = win + k * dist / radius * (1 + win / 3000)
        bj, bi = np.unravel_index(np.argmin(cost), cost.shape)
        out.append([LON0 + (i0 + bi) * RES, LAT1 - (j0 + bj) * RES])
    out = np.array(out)
    # smooth (keeps the shape but removes the grid staircase)
    for _ in range(3):
        out[1:-1] = (out[:-2] + 2 * out[1:-1] + out[2:]) / 4
    # thin back to ~0.1 deg spacing
    keep = [0]
    for t in range(1, len(out)):
        if np.hypot(*(out[t] - out[keep[-1]])) >= 0.09: keep.append(t)
    if keep[-1] != len(out) - 1: keep.append(len(out) - 1)
    return [[round(float(a), 3), round(float(b), 3)] for a, b in out[keep]]
BORDER_RIVERS = {"鸭绿江", "黑龙江", "乌苏里江"}
def snap_to_border(path, maxd=0.35):
    pts = []
    for a, b in zip(path[:-1], path[1:]):
        n_ = max(1, int(np.ceil(np.hypot(b[0] - a[0], b[1] - a[1]) / 0.04)))
        for t in range(n_): pts.append((a[0] + (b[0] - a[0]) * t / n_, a[1] + (b[1] - a[1]) * t / n_))
    pts.append(tuple(path[-1]))
    pts = np.array(pts)
    d, idx = BORDER_TREE.query(pts)
    out = np.where((d < maxd)[:, None], BORDER_PTS[idx], pts)
    # remove back-steps created by snapping, then light smoothing
    keep = [0]
    for t in range(1, len(out)):
        if np.hypot(*(out[t] - out[keep[-1]])) >= 0.03: keep.append(t)
    out = out[keep]
    for _ in range(2): out[1:-1] = (out[:-2] + 2 * out[1:-1] + out[2:]) / 4
    return [[round(float(a), 3), round(float(b), 3)] for a, b in out]
rivers_out = [dict(name=r['name'], w=r.get('w', 1),
                   path=snap_to_border(r['path']) if r['name'] in BORDER_RIVERS else snap(r['path'], r.get('snap', 0.22))) for r in RIVERS]

# ---------------- pack ----------------
Eq = np.clip(np.round(E), 0, 9000).astype(np.uint16) + 500
Eq[lakes] |= 0x8000
def pack(a): return base64.b64encode(gzip.compress(a.tobytes(), 9, mtime=0)).decode()   # mtime=0: reproducible output
bundle = dict(nx=NX, ny=NY, lon0=LON0, lat1=LAT1, res=RES, nprov=N_PROV, names=names, provcp=prov_cp,
              h=pack(Eq.astype('<u2')), region=pack(region), relief=pack(relief),
              prov=prov_lines, borders=country_lines, cnborder=cn_border, rivers=rivers_out)
s = json.dumps(bundle, ensure_ascii=False, separators=(',', ':'))
open(OUT, 'w', encoding='utf8').write(s)
print("bundle chars", len(s), "h", len(bundle['h']), "region", len(bundle['region']), "relief", len(bundle['relief']))
np.savez_compressed(str(OUT) + '.npz', E=E, region=region, lakes=lakes, land=land, relief=relief)  # for debugging/plots
