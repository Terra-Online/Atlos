/* global window, document, localStorage, location, requestAnimationFrame, WheelEvent, MouseEvent */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname } from 'node:path';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import os from 'node:os';
import { createServices, installBrowserServices } from '../test-support/browser/services.mjs';

const [baseline, candidate, output, devUrl = 'http://127.0.0.1:5174', workload = 'pan', publicRoot] = process.argv.slice(2);
if (!baseline || !candidate || !output) throw new Error('Usage: bench-coverage.mjs BASELINE_DIST CANDIDATE_DIST OUTPUT_DIR [DEV_URL] [pan|zoom|islands] [PUBLIC_DIR]');
if (!['pan', 'zoom', 'islands'].includes(workload)) throw new Error('Workload must be pan, zoom or islands');
await mkdir(output, { recursive: true });
const report = { baseline: resolve(baseline), candidate: resolve(candidate), environment: {
    cpu: os.cpus()[0].model, cores: os.cpus().length, os: `${os.platform()} ${os.release()}`, node: process.version,
}, method: 'Zoom: 120 corner-anchored ctrl-wheel inputs and four alternating corner double-clicks. Islands: 120 center-anchored ctrl-wheel inputs from an isolated Valley satellite tile, zooming out/in, plus four center double-clicks. Pan: 120 diagonal wheel inputs. Identical local identity-encoded assets and API fixtures; Chromium desktop and 4x CPU touch emulation. Five alternating rounds. Not WAN or physical-device performance.', workload, size: {}, runtime: [], constraints: [], errors: [] };
const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * fraction))];
for (const [variant, directory] of Object.entries({ baseline, candidate })) {
    const html = await readFile(resolve(directory, 'index.html'), 'utf8');
    const files = [...new Set([...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((match) => match[1]))];
    const totals = { raw: 0, gzip: 0, brotli: 0 };
    const assets = [];
    for (const url of files) {
        const relative = new URL(url, 'http://local/').pathname;
        const position = relative.indexOf('/assets/');
        const file = relative.slice(position + 1);
        const bytes = await readFile(resolve(directory, file));
        const sizes = { raw: bytes.length, gzip: gzipSync(bytes).length, brotli: brotliCompressSync(bytes).length };
        for (const metric of Object.keys(totals)) totals[metric] += sizes[metric];
        assets.push({ file, ...sizes });
    }
    report.size[variant] = { totals, assets };
}
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2', '.png': 'image/png' };
const browser = await chromium.launch({ headless: true });
report.environment.chromium = browser.version();
try {
    for (let round = 0; round < 5; round++) {
        for (const cpu of [1, 4]) {
            for (const variant of round % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
                const root = resolve(variant === 'baseline' ? baseline : candidate);
                const server = createServer(async (request, response) => {
                    try {
                        const pathname = new URL(request.url, 'http://local').pathname;
                        const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
                        if (!file.startsWith(root + '/')) throw new Error('Invalid path');
                        const bytes = await readFile(file).catch((error) => {
                            if (!publicRoot || error.code !== 'ENOENT') throw error;
                            const shared = resolve(publicRoot, '.' + pathname);
                            if (!shared.startsWith(resolve(publicRoot) + '/')) throw new Error('Invalid shared path');
                            return readFile(shared);
                        });
                        response.writeHead(200, { 'content-type': mime[extname(file)] || 'application/octet-stream', 'access-control-allow-origin': '*' }); response.end(bytes);
                    } catch { response.writeHead(404); response.end('missing'); }
                });
                await new Promise((done) => server.listen(0, 'localhost', done));
                const origin = `http://localhost:${server.address().port}`;
                const context = await browser.newContext({ viewport: cpu === 1 ? { width: 1100, height: 760 } : { width: 390, height: 700 }, hasTouch: cpu === 4, isMobile: cpu === 4 });
                try {
                    const html = await readFile(resolve(root, 'index.html'), 'utf8');
                    const asset = new URL(/(?:src|href)="(https:[^"]+\/assets\/[^"]+)"/.exec(html)[1]);
                    const assetRoot = asset.pathname.slice(0, asset.pathname.indexOf('/assets/') + 1);
                    const services = createServices();
                    await installBrowserServices(context, services, { origin, production: {
                        assets: new URL(assetRoot, asset.origin), resourceUrl(url) {
                            if (url.origin !== asset.origin || !url.pathname.startsWith(assetRoot)) return null;
                            return new URL('/' + url.pathname.slice(assetRoot.length) + url.search, origin).href;
                        },
                    } });
                    await context.addInitScript((islands) => {
                        if (location.origin === 'null') return;
                        localStorage.setItem('region-storage', JSON.stringify({ state: { currentRegionKey: islands ? 'Valley_4' : 'Wuling', currentSubregionKey: null }, version: 2 }));
                        localStorage.setItem('atlos-layer-storage', JSON.stringify({ state: { currentLayer: 'M', satellite: islands }, version: 0 }));
                        localStorage.setItem('ui-prefs', JSON.stringify({ state: { sidebarOpen: false, prefsViewStateEnabled: false, triggerCluster: true, triggerlabelName: true, theme: 'light' }, version: 1 }));
                    }, workload === 'islands');
                    const page = await context.newPage();
                    const cdp = await context.newCDPSession(page);
                    await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
                    await cdp.send('Performance.enable');
                    await page.goto(workload === 'islands' ? `${origin}/?r=VL&c=-737.5,-812.5&z=4.5`
                        : `${origin}/?r=WL&c=${workload === 'zoom' ? '10000,-10000&z=1' : '-650,650&z=3'}`);
                    await page.waitForSelector('.leaflet-tile-loaded').catch(async (error) => {
                        await page.screenshot({ path: resolve(output, 'startup-failure.png') });
                        console.log(JSON.stringify({ variant, errors: services.pageErrors, unexpected: services.unexpected, body: await page.locator('body').innerText() }));
                        throw error;
                    });
                    await page.waitForTimeout(1000);
                    const before = await cdp.send('Performance.getMetrics');
                    const result = await page.evaluate(async (workload) => {
                        const map = document.querySelector('#map');
                        const zooming = workload !== 'pan';
                        const islands = workload === 'islands';
                        const rect = map.getBoundingClientRect();
                        const frames = [], longTasks = [];
                        const observer = new PerformanceObserver((list) => longTasks.push(...list.getEntries().map(({ duration }) => duration)));
                        observer.observe({ type: 'longtask' });
                        let measuring = true;
                        const sample = (time) => { if (measuring) { frames.push(time); requestAnimationFrame(sample); } };
                        requestAnimationFrame(sample);
                        for (let i = 0; i < 120; i++) {
                            map.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaMode: 0,
                                deltaX: zooming ? 0 : i < 60 ? 8 : -8,
                                deltaY: islands ? i < 60 ? 8 : -8 : zooming ? i < 60 ? -4 : 4 : 2,
                                ctrlKey: zooming, clientX: rect.x + rect.width * (workload === 'zoom' ? 0.05 : 0.5), clientY: rect.y + rect.height * (workload === 'zoom' ? 0.05 : 0.5) }));
                            await new Promise((done) => window.setTimeout(done, 16));
                        }
                        if (zooming) {
                            for (let i = 0; i < 4; i++) {
                                map.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true,
                                    clientX: rect.x + rect.width * (islands ? 0.5 : i % 2 ? 0.95 : 0.05),
                                    clientY: rect.y + rect.height * (islands ? 0.5 : i < 2 ? 0.05 : 0.95), shiftKey: i % 2 === 1 }));
                                await new Promise((done) => window.setTimeout(done, 350));
                            }
                        }
                        await new Promise((done) => window.setTimeout(done, 250));
                        measuring = false; observer.disconnect();
                        return { gaps: frames.slice(1).map((time, i) => time - frames[i]), longTasks };
                    }, workload);
                    const after = await cdp.send('Performance.getMetrics');
                    const metrics = Object.fromEntries(after.metrics.map((row) => [row.name, row.value]));
                    const old = Object.fromEntries(before.metrics.map((row) => [row.name, row.value]));
                    const row = { variant, cpu, round, frameP95: percentile(result.gaps, 0.95), frameP99: percentile(result.gaps, 0.99),
                        frames: result.gaps.length, gapsOver25ms: result.gaps.filter((gap) => gap > 25).length,
                        taskMs: (metrics.TaskDuration - old.TaskDuration) * 1000, scriptMs: (metrics.ScriptDuration - old.ScriptDuration) * 1000,
                        longTasks: result.longTasks, errors: services.pageErrors, unexpected: services.unexpected };
                    report.runtime.push(row);
                    console.log(`${variant} CPU${cpu} round ${round}: p95=${row.frameP95.toFixed(2)}ms task=${row.taskMs.toFixed(2)}ms`);
                } finally { await context.close(); await new Promise((done) => server.close(done)); }
            }
        }
    }
    const page = await browser.newPage();
    await page.goto(devUrl);
    report.constraints = await page.evaluate(async () => {
        const { default: L } = await import('/node_modules/.vite/deps/leaflet.js');
        const { CoverageBounds } = await import('/src/services/map/core/coverageBounds.ts');
        const { getMaxTileZoom, getRegionTileCoverage } = await import('/src/services/map/tileCoverage.ts');
        const { REGION_DICT } = await import('/src/data/map/index.ts');
        const { TILE_SIZE } = await import('/src/data/map/tiles.js');
        const results = [];
        const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * fraction))];
        const cases = [['Dijiang', 'clips', ''], ['Dijiang', 'satellite', ''], ['Valley_4', 'clips', ''], ['Valley_4', 'satellite', ''], ['Wuling', 'clips', ''], ['Wuling', 'clips', '_b1'], ['Weekraid_1', 'clips', '']];
        for (const [region, source, suffix] of cases) for (const mobile of [false, true]) {
            const host = document.createElement('div');
            host.style.cssText = `position:fixed;left:0;top:0;width:${mobile ? 390 : 1100}px;height:${mobile ? 700 : 760}px`;
            document.body.append(host);
            const config = REGION_DICT[region], coverage = getRegionTileCoverage(region, source);
            const map = L.map(host, { crs: L.CRS.Simple, zoomAnimation: false });
            const controller = new CoverageBounds(map);
            const options = { coverage, suffixes: suffix ? ['', suffix] : [''], tileSize: TILE_SIZE,
                maxNativeZoom: getMaxTileZoom(coverage, suffix ? ['', suffix] : ['']) };
            controller.setCoverage(options); map.setView([-600, 600], config.coordZoom, { animate: false });
            const point = map.getCenter(), cold = [], pan = [], zoom = [];
            for (let i = 0; i < 30; i++) {
                controller.setCoverage(options);
                const start = performance.now(); controller.limitCenter(point, config.coordZoom); cold.push(performance.now() - start);
            }
            for (let i = 0; i < 200; i++) controller.pan(point, config.coordZoom);
            for (let batch = 0; batch < 40; batch++) {
                const start = performance.now();
                for (let i = 0; i < 50; i++) controller.pan(L.latLng(point.lat + (i % 2 ? 2000 : -2000), point.lng + 2000), config.coordZoom);
                pan.push((performance.now() - start) / 50);
            }
            for (let i = 0; i < 120; i++) {
                const start = performance.now(); controller.zoom(point, 1 + i * 0.025); zoom.push(performance.now() - start);
            }
            const frame = controller.frame;
            results.push({ region, source, suffix, mobile, coldP50: percentile(cold, 0.5), coldP95: percentile(cold, 0.95),
                panP50: percentile(pan, 0.5), panP95: percentile(pan, 0.95), zoomP50: percentile(zoom, 0.5), zoomP95: percentile(zoom, 0.95),
                cachedLevels: controller.levels.size, cameraRectangles: frame.hard.length + frame.soft.length });
            controller.dispose(); map.remove(); host.remove();
        }
        return results;
    });
    await page.close();
    report.summary = {};
    for (const cpu of [1, 4]) for (const variant of ['baseline', 'candidate']) {
        const rows = report.runtime.filter((row) => row.cpu === cpu && row.variant === variant);
        report.summary[`${variant}-cpu${cpu}`] = Object.fromEntries(['frameP95', 'frameP99', 'taskMs', 'scriptMs', 'gapsOver25ms'].map((key) => [key, percentile(rows.map((row) => row[key]), 0.5)]));
    }
    await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ size: report.size, summary: report.summary, constraints: report.constraints }));
    if (report.runtime.some((row) => row.errors.length || row.unexpected.length)) process.exitCode = 1;
} finally { await browser.close(); }
