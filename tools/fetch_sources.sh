#!/usr/bin/env bash
# Download the source data into ./sources (git sparse clones, a few MB in total).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p sources
cd sources

clone() { # url dir [branch] -- paths...
  local url=$1 dir=$2 branch=$3; shift 3
  if [ -d "$dir/.git" ]; then echo "skip $dir (exists)"; return; fi
  git clone --depth 1 ${branch:+--branch "$branch"} --filter=blob:none --sparse "$url" "$dir"
  (cd "$dir" && git sparse-checkout set --no-cone "$@")
}

# NASA Blue Marble-derived topography + water mask (via turban/webgl-earth)
clone https://github.com/turban/webgl-earth webgl-earth "" /images/elev_bump_4k.jpg /images/water_4k.png
# ECharts 4.9 map data (China provinces, world countries)
clone https://github.com/apache/echarts echarts 4.9.0 /map/js/china.js /map/js/world.js
# three.js r147 (only needed for tools/screenshot.js offline rendering)
clone https://github.com/mrdoob/three.js three r147 /build/three.min.js /examples/js/controls/OrbitControls.js
# jiangshan-map (GPL-3.0): historical polities, eras, settlements, river courses and lakes, pinned to a commit
if [ -d jiangshan-map/.git ]; then echo "skip jiangshan-map (exists)"; else
  git clone --filter=blob:none --sparse --no-checkout https://github.com/DeanChensj/jiangshan-map jiangshan-map
  (cd jiangshan-map && git sparse-checkout set --no-cone /js/map_data.js /js/atlas_snapshots.js /js/china_geo_data.js /LICENSE \
    && git checkout -q b66b846b61fd27c4fa728769900f0913bfc7f811)
fi

cd ..
node tools/extract_echarts_maps.js
echo "sources ready"
