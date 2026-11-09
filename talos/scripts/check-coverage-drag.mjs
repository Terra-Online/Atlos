/* global window, localStorage, requestAnimationFrame */
import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';

const url = process.argv[2] || 'http://127.0.0.1:5174';
const browser = await chromium.launch({ headless: true });
const results = [];
try {
    for (const touch of [false, true]) {
        const context = await browser.newContext({ viewport: touch ? { width: 390, height: 700 } : { width: 1100, height: 760 }, hasTouch: touch, isMobile: touch });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.stack));
        await page.addInitScript(() => {
            localStorage.setItem('region-storage', JSON.stringify({ state: { currentRegionKey: 'Dijiang', currentSubregionKey: null }, version: 2 }));
            localStorage.setItem('atlos-layer-storage', JSON.stringify({ state: { currentLayer: 'M', satellite: false }, version: 0 }));
            localStorage.setItem('talos:locale', 'en-US');
        });
        await page.goto(`${url}/?r=DJ`);
        await page.waitForFunction(() => window.__TALOS_DEV__?.map?._loaded, {}, { timeout: 30000 });
        await page.evaluate(async () => {
            const { isRegionSwitching } = await import('/src/services/map/regionLifecycle.ts');
            const { getRegionTileCoverage, hasTileInCoverage } = await import('/src/services/map/tileCoverage.ts');
            const { useMarkerStore } = await import('/src/store/marker.ts');
            const { useUiPrefsStore } = await import('/src/store/uiPrefs.ts');
            useMarkerStore.getState().setFilter([]);
            useUiPrefsStore.getState().setSidebarOpen(false);
            for (let attempt = 0; attempt < 300 && !window.__coverageController; attempt++) {
                const map = window.__TALOS_DEV__?.map;
                const urls = [...new Set(performance.getEntriesByType('resource').map((entry) => entry.name)
                    .filter((name) => name.includes('/src/services/map/core/coverageBounds.ts')))];
                for (const url of urls) {
                    const { getCoverageBounds } = await import(url);
                    const controller = map && getCoverageBounds(map);
                    if (controller) { window.__coverageController = controller; break; }
                }
                if (!window.__coverageController) await new Promise(requestAnimationFrame);
            }
            const map = window.__TALOS_DEV__.map;
            if (!window.__coverageController) throw new Error('Coverage controller unavailable');
            window.__coverageCheck = { samples: 0, domSamples: 0, pendingTileFrames: 0, zoomSamples: 0, failures: [], maxOverdrag: 0, stopped: false };
            const sample = () => {
                const state = window.__coverageCheck;
                if (state.stopped) return;
                const bounds = window.__coverageController;
                if (!isRegionSwitching(map) && bounds) {
                    state.samples++;
                    if (window.__zoomExercise) state.zoomSamples++;
                    // Independent DOM-area check after downloads have settled.
                    // Geometry tests separately prove the continuous patch shape.
                    const tileLayers = Object.values(map._layers).filter((layer) => typeof layer._url === 'string');
                    // updateWhenIdle/throttled admission can precede _loading.
                    // Check all required viewport files, not just that flag, to
                    // separate data geometry from request/decoding latency.
                    const ready = tileLayers.length && tileLayers.every((layer) => {
                        const match = layer._url.match(/\/(clips|satellite)\/([^/]+)\//);
                        const level = layer._tileZoom;
                        if (!match || level === undefined) return false;
                        const coverage = getRegionTileCoverage(match[2], match[1]);
                        const suffix = /\{y\}([^.]*)\.webp/.exec(layer._url)?.[1] || '';
                        const tile = layer.options.tileSize;
                        const center = map.project(map.getCenter(), level);
                        const half = map.getSize().divideBy(2 * 2 ** (map.getZoom() - level));
                        for (let y = Math.floor((center.y - half.y) / tile); y < Math.ceil((center.y + half.y) / tile); y++) {
                            for (let x = Math.floor((center.x - half.x) / tile); x < Math.ceil((center.x + half.x) / tile); x++) {
                                if (!hasTileInCoverage(coverage, level, x, y, suffix)) continue;
                                const coordinates = center.clone(); Object.assign(coordinates, { x, y, z: level });
                                if (!layer._isValidTile(coordinates)) continue;
                                const image = layer._tiles[`${x}:${y}:${level}`];
                                if (!image?.loaded || !image.el.complete || !image.el.naturalWidth) return false;
                            }
                        }
                        return true;
                    });
                    if (!ready) state.pendingTileFrames++;
                    if (ready) {
                        const viewport = map.getContainer().getBoundingClientRect();
                        const images = [...map.getContainer().querySelectorAll('img.leaflet-tile-loaded')];
                        const rects = images.map((image) => image.getBoundingClientRect()).map((rect) => ({
                            left: Math.max(viewport.left, rect.left), right: Math.min(viewport.right, rect.right),
                            top: Math.max(viewport.top, rect.top), bottom: Math.min(viewport.bottom, rect.bottom),
                        })).filter((rect) => rect.right > rect.left && rect.bottom > rect.top);
                        const patch = bounds.frame.patch.multiplyBy(bounds.frame.scale);
                        // Independent rectangle-union oracle on rendered tiles,
                        // including continuous patches spanning multiple seams.
                        const ys = [...new Set([viewport.top, viewport.bottom - patch.y,
                            ...rects.flatMap((rect) => [rect.top, rect.bottom - patch.y])])]
                            .filter((y) => y >= viewport.top - 0.01 && y + patch.y <= viewport.bottom + 0.01);
                        const covered = ys.some((top) => {
                            const edges = [...new Set([top, top + patch.y, ...rects.flatMap((rect) => [rect.top, rect.bottom])
                                .filter((y) => y > top && y < top + patch.y)])].sort((a, b) => a - b);
                            let common = [[viewport.left, viewport.right]];
                            for (let i = 1; i < edges.length; i++) {
                                const y = (edges[i - 1] + edges[i]) / 2;
                                // CSS transform bounds can differ by a few millionths of a pixel at a seam.
                                const spans = rects.filter((rect) => rect.top <= y + 0.01 && rect.bottom >= y - 0.01)
                                    .map((rect) => [rect.left, rect.right]).sort((a, b) => a[0] - b[0]);
                                const merged = [];
                                for (const span of spans) {
                                    const last = merged.at(-1);
                                    if (last && span[0] <= last[1] + 0.01) last[1] = Math.max(last[1], span[1]);
                                    else merged.push([...span]);
                                }
                                common = common.flatMap(([a, b]) => merged.map(([c, d]) => [Math.max(a, c), Math.min(b, d)]))
                                    .filter(([a, b]) => b - a >= patch.x - 0.02);
                                if (!common.length) return false;
                            }
                            return common.length > 0;
                        });
                        state.domSamples++;
                        if (!covered && state.failures.length < 10) state.failures.push({ kind: 'DOM patch', patch, zoom: map.getZoom() });
                    }

                    if (!bounds.isVisible()) state.failures.push({ center: map.getCenter(), zoom: map.getZoom() });
                    const rest = bounds.limitCenter(map.getCenter(), map.getZoom());
                    state.maxOverdrag = Math.max(state.maxOverdrag, map.project(rest).distanceTo(map.project(map.getCenter())));
                }
                requestAnimationFrame(sample);
            };
            requestAnimationFrame(sample);
        });
        const cdp = touch ? await context.newCDPSession(page) : null;
        const cases = touch
            ? [['Dijiang', false, 'M', 0], ['Dijiang', true, 'M', 2.37], ['Wuling', false, 'B1', 4.5], ['Valley_4', false, 'M', 4.5], ['Valley_4', true, 'M', 0], ['Valley_4', true, 'M', 2.37], ['Valley_4', true, 'M', 4.5], ['Weekraid_1', false, 'M', 3]]
            : [['Dijiang', false, 'M', 0], ['Dijiang', false, 'M', 2.37], ['Dijiang', false, 'M', 4], ['Dijiang', true, 'M', 0], ['Dijiang', true, 'M', 2.37], ['Dijiang', true, 'M', 4], ['Valley_4', false, 'M', 0], ['Valley_4', false, 'M', 4.5], ['Valley_4', true, 'M', 0], ['Valley_4', true, 'M', 2.37], ['Valley_4', true, 'M', 4.5], ['Wuling', false, 'M', 2.37], ['Wuling', false, 'B1', 4.5], ['Weekraid_1', false, 'M', 0], ['Weekraid_1', false, 'M', 3]];
        for (const [region, satellite, floor, zoom] of cases) {
            await page.evaluate(async ({ region, satellite, floor, zoom }) => {
                const { default: useRegion } = await import('/src/store/region.ts');
                const { useLayerStore } = await import('/src/store/layer.ts');
                const map = window.__TALOS_DEV__.map;
                if (useRegion.getState().currentRegionKey !== region) {
                    await new Promise((resolve) => { map.once('talos:regionSwitched', resolve); useRegion.getState().setCurrentRegion(region); });
                }
                useLayerStore.getState().setSatellite(satellite);
                useLayerStore.getState().setCurrentLayer(floor);
                await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                map.setZoom(zoom, { animate: false });
            }, { region, satellite, floor, zoom });
            if (touch) {
                for (let gesture = 0; gesture < 3; gesture++) {
                    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: 320 }] });
                    for (let i = 1; i <= 14; i++) {
                        await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: 200 - 80 * i, y: 320 - 55 * i }] });
                        await page.waitForTimeout(16);
                    }
                    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
                    await page.waitForTimeout(320);
                }
            } else {
                for (const [dx, dy] of [[1800, 0], [-2200, -1600], [1300, 1800]]) {
                    await page.mouse.move(550, 370);
                    await page.mouse.down();
                    await page.mouse.move(550 + dx, 370 + dy, { steps: 14 });
                    await page.mouse.up();
                    await page.waitForTimeout(320);
                }
                await page.mouse.move(550, 370);
                for (let i = 0; i < 12; i++) await page.mouse.wheel(100, 17);
                await page.waitForTimeout(500);
            }
        }
        // Aim at blank corners after dragging to a wall; exercise both wheel
        // zoom and Leaflet's normally CSS-driven setZoomAround animation.
        for (const satellite of [false, true]) {
            await page.evaluate(async (satellite) => {
                const { default: useRegion } = await import('/src/store/region.ts');
                const { useLayerStore } = await import('/src/store/layer.ts');
                const map = window.__TALOS_DEV__.map;
                if (useRegion.getState().currentRegionKey !== 'Dijiang') {
                    await new Promise((resolve) => { map.once('talos:regionSwitched', resolve); useRegion.getState().setCurrentRegion('Dijiang'); });
                }
                useLayerStore.getState().setSatellite(satellite);
                useLayerStore.getState().setCurrentLayer('M');
                map.setZoom(0, { animate: false });
                map.panBy([-10000, -10000], { animate: false });
                window.__zoomExercise = true;
            }, satellite);
            await page.waitForTimeout(300);
            if (!touch) {
                await page.mouse.move(20, 20);
                for (let i = 0; i < 24; i++) {
                    await page.mouse.wheel(0, -48);
                    await page.waitForTimeout(16);
                }
                await page.waitForTimeout(300);
                for (let i = 0; i < 24; i++) {
                    await page.mouse.wheel(0, 48);
                    await page.waitForTimeout(16);
                }
                await page.waitForTimeout(300);
            }
            for (const [index, zoom] of [3.7, 0.37, 3, 0].entries()) {
                await page.evaluate(({ index, zoom }) => {
                    const map = window.__TALOS_DEV__.map;
                    const size = map.getSize();
                    const anchor = size.clone();
                    anchor.x *= index % 2 ? 0.95 : 0.05;
                    anchor.y *= index < 2 ? 0.05 : 0.95;
                    map.setZoomAround(anchor, zoom, { animate: true });
                }, { index, zoom });
                await page.waitForTimeout(350);
            }
            await page.evaluate(() => { window.__zoomExercise = false; });
        }
        if (touch) {
            await page.evaluate(() => { window.__zoomExercise = true; });
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 30, y: 100 }, { x: 160, y: 100 }] });
            for (let i = 1; i <= 12; i++) {
                await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: Math.max(1, 30 - i * 2), y: 100 }, { x: 160 + i * 12, y: 100 }] });
                await page.waitForTimeout(16);
            }
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        }
        await page.setViewportSize(touch ? { width: 700, height: 390 } : { width: 850, height: 600 });
        await page.evaluate(async () => {
            const { useUiPrefsStore } = await import('/src/store/uiPrefs.ts');
            useUiPrefsStore.getState().setSidebarOpen(true);
            window.__TALOS_DEV__.map.invalidateSize({ animate: false });
        });
        await page.waitForTimeout(600);
        const result = await page.evaluate(() => {
            const bounds = window.__coverageController;
            const state = window.__coverageCheck;
            state.stopped = true;
            return { ...state, finalVisible: bounds.isVisible(), finalOverdragged: bounds.isOverdragged() };
        });
        result.mode = touch ? 'touch' : 'mouse+trackpad';
        result.cases = cases.length;
        result.errors = errors;
        results.push(result);
        await context.close();
    }
    await writeFile('/tmp/atlos-coverage-drag.json', JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results));
    if (results.some((result) => result.failures.length || result.errors.length || !result.finalVisible || result.finalOverdragged || result.samples < 50 || result.domSamples < 10 || result.zoomSamples < 50)) process.exitCode = 1;
    if (!results.some((result) => result.maxOverdrag > 1)) throw new Error('No elastic rebound was exercised');
} finally {
    await browser.close();
}
