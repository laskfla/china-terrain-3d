// Render index.html headlessly and save screenshots (needs: npm i playwright; npx playwright install chromium).
// Uses the local three.js copy in sources/three, so it works offline.
// Usage: node tools/screenshot.js [out-dir]
// Modern-map shots use ?mode=modern; the historical ones open a year with ?year=.
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const outDir = path.resolve(process.argv[2] || path.join(root, 'build', 'shots'));
fs.mkdirSync(outDir, { recursive: true });
const three = path.join(root, 'sources', 'three');
// [file, viewport, colour scheme, query string, views: [lon, lat, distance, polar°, azimuth°]]
const runs = [
  ['overview', { width: 1400, height: 860 }, 'light', '?mode=modern', []],
  ['everest', { width: 1400, height: 860 }, 'light', '?mode=modern', [[86.9, 28.2, 45, 50, 10]]],
  ['sichuan', { width: 1400, height: 860 }, 'dark', '?mode=modern', [[104, 30.5, 140, 45, 0]]],
  ['phone', { width: 400, height: 820 }, 'light', '?mode=modern', []],
  ['tang', { width: 1400, height: 860 }, 'light', '?year=741', []],
  ['song', { width: 1400, height: 860 }, 'light', '?year=1100', []],
  ['ming', { width: 1400, height: 860 }, 'light', '?year=1415', [[116, 36, 160, 45, 0]]],
];
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  for (const [name, viewport, scheme, query, views] of runs) {
    const ctx = await browser.newContext({ viewport, colorScheme: scheme, hasTouch: viewport.width < 600, isMobile: viewport.width < 600 });
    const page = await ctx.newPage();
    page.on('pageerror', e => console.error(`[${name}] page error:`, e.message));
    await page.route('**/*', route => {
      const u = route.request().url();
      if (u.includes('three.min.js')) return route.fulfill({ body: fs.readFileSync(path.join(three, 'build/three.min.js')), contentType: 'application/javascript' });
      if (u.includes('OrbitControls.js')) return route.fulfill({ body: fs.readFileSync(path.join(three, 'examples/js/controls/OrbitControls.js')), contentType: 'application/javascript' });
      if (u.startsWith('file://')) return route.continue();
      return route.abort();   // fonts etc. fall back to system fonts
    });
    await page.goto('file://' + path.join(root, 'index.html') + query);
    await page.waitForFunction(() => window.__terrainReady === true, null, { timeout: 120000 });
    for (const v of views) await page.evaluate(v => window.__view(...v), v);
    await page.waitForTimeout(1500);
    const file = path.join(outDir, `${name}.png`);
    await page.screenshot({ path: file });
    console.log('saved', file);
    await ctx.close();
  }
  await browser.close();
})();
