// Extract the GeoJSON embedded in ECharts 4.9 map scripts (china.js, world.js)
// into sources/china.geo.json and sources/world.geo.json.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const src = path.join(root, 'sources', 'echarts', 'map', 'js');
global.echarts = {
  registerMap(name, json) {
    const out = path.join(root, 'sources', `${name}.geo.json`);
    fs.writeFileSync(out, JSON.stringify(json));
    console.log(`wrote ${out} (${json.features.length} features)`);
  },
};
for (const f of ['china', 'world']) {
  const code = fs.readFileSync(path.join(src, `${f}.js`), 'utf8');
  new Function('define', 'exports', 'module', 'require', code).call(global);
}
