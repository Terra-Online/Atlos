/* global window, document, localStorage, HTMLCanvasElement, CanvasRenderingContext2D, WebGL2RenderingContext */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';

/** Identical local assets, map input and API fixtures for runtime and visual comparisons. */
export async function createMapBrowser({ baseline, candidate, headed = false, windowPosition, onError = () => {} }) {
    const roots = { baseline: resolve(baseline), candidate: resolve(candidate) };
    const types = Object.keys(JSON.parse(await readFile(new URL('../../src/data/marker/type.json', import.meta.url), 'utf8')));
    const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
    const mime = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.html': 'text/html',
        '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg' };
    const server = createServer(async (req, res) => {
        try {
            const variant = /benchVariant=([^;]+)/.exec(req.headers.cookie ?? '')?.[1];
            const root = roots[variant];
            if (!root) throw new Error('Unknown variant');
            const path = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
            const file = resolve(root, '.' + (path === '/' ? '/index.html' : path));
            if (!file.startsWith(root + '/')) throw new Error('Invalid path');
            const body = await readFile(file);
            res.writeHead(200, { 'content-type': mime[extname(file)] ?? 'application/octet-stream' });
            res.end(body);
        } catch { res.writeHead(404); res.end('missing'); }
    });
    await new Promise(done => server.listen(0, 'localhost', done));
    const origin = `http://localhost:${server.address().port}`;
    const browser = await chromium.launch({ channel: 'chrome', headless: !headed });
    async function open(variant, { viewport = { width: 1200, height: 762 }, dpr = 2, prefs = {}, manualClock = false, locale = 'en-US' } = {}) {
        const context = await browser.newContext({ viewport, deviceScaleFactor: dpr, locale });
        await context.addCookies([{ url: origin, name: 'benchVariant', value: variant }]);
        await context.route('**/*', async route => {
            const url = new URL(route.request().url());
            if (url.origin === origin) return route.continue();
            // Keep input and asset bytes identical, and avoid depending on live APIs.
            const asset = url.pathname.indexOf('/assets/');
            if (asset >= 0) {
                const path = resolve(roots[variant], '.' + url.pathname.slice(asset));
                try { return await route.fulfill({ body: await readFile(path), contentType: mime[extname(path)] ?? 'application/octet-stream' }); }
                catch { return route.abort(); }
            }
            if (route.request().resourceType() === 'image') return route.abort();
            return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ items: [], session: null, user: null }) });
        });
        await context.addInitScript(({ types, prefs, manualClock, locale }) => {
            localStorage.setItem('talos:locale', locale);
            localStorage.setItem('marker-filter', JSON.stringify({ state: { filter: types, selectedPoints: [] }, version: 0 }));
            localStorage.setItem('ui-prefs', JSON.stringify({ state: { prefsSidebarEnabled: true, prefsTriggersEnabled: true,
                sidebarOpen: false, sidebarWidthV2: 500, prefsViewStateEnabled: true,
                triggerCluster: true, triggerlabelName: true, theme: 'light', ...prefs }, version: 1 }));
            window.__runtimeBench = { resizes: [], longTasks: [], draws: [], copies: [], frameDraws: [], frame: null };
            if (!manualClock) {
                const request = window.requestAnimationFrame;
                window.requestAnimationFrame = callback => request(time => {
                    window.__runtimeBench.frame = time;
                    try { callback.call(window, time); }
                    finally { window.__runtimeBench.frame = null; }
                });
            }
            const gpu = new WeakSet();
            const getContext = HTMLCanvasElement.prototype.getContext;
            HTMLCanvasElement.prototype.getContext = function(type, ...args) {
                const value = getContext.call(this, type, ...args);
                if (type === 'webgl2' && value) gpu.add(this);
                return value;
            };
            if (typeof WebGL2RenderingContext !== 'undefined') {
                const draw = WebGL2RenderingContext.prototype.drawArraysInstanced;
                WebGL2RenderingContext.prototype.drawArraysInstanced = function(...args) {
                    window.__runtimeBench.draws.push(performance.now());
                    window.__runtimeBench.frameDraws.push({ time: performance.now(), frame: window.__runtimeBench.frame });
                    return draw.apply(this, args);
                };
            }
            const copy = CanvasRenderingContext2D.prototype.drawImage;
            CanvasRenderingContext2D.prototype.drawImage = function(...args) {
                if (gpu.has(args[0])) window.__runtimeBench.copies.push({ start: performance.now(), frame: window.__runtimeBench.frame,
                    pixels: args.length === 9 ? args[7] * args[8] : args[0].width * args[0].height });
                return copy.apply(this, args);
            };
            for (const property of ['width', 'height']) {
                const descriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, property);
                Object.defineProperty(HTMLCanvasElement.prototype, property, { ...descriptor, set(value) {
                    const start = performance.now(); descriptor.set.call(this, value);
                    if (gpu.has(this)) window.__runtimeBench.resizes.push({ start, ms: performance.now() - start });
                } });
            }
            new PerformanceObserver(list => {
                window.__runtimeBench.longTasks.push(...list.getEntries().map(({ startTime, duration }) => ({ startTime, duration })));
            }).observe({ type: 'longtask' });
        }, { types, prefs, manualClock, locale });
        const page = await context.newPage();
        if (headed && windowPosition) {
            const session = await context.newCDPSession(page);
            const { targetInfo } = await session.send('Target.getTargetInfo');
            const root = await browser.newBrowserCDPSession();
            try {
                const { windowId } = await root.send('Browser.getWindowForTarget', { targetId: targetInfo.targetId });
                await root.send('Browser.setWindowBounds', { windowId, bounds: { left: windowPosition[0], top: windowPosition[1] } });
            } finally { await root.detach(); await session.detach(); }
        }
        if (headed) await page.bringToFront();
        page.on('pageerror', error => onError({ variant, message: error.message }));
        if (manualClock) {
            await page.clock.install({ time: new Date('2026-10-24T00:00:00Z') });
        }
        await page.goto(`${origin}/?r=VL&c=-625,375&z=2`, { waitUntil: 'domcontentloaded' });
        await page.locator('.oem-canvas-markers').waitFor({ timeout: 30_000 });
        if (manualClock) {
            await page.evaluate(() => document.fonts.ready);
            await page.clock.pauseAt(new Date('2026-10-24T00:01:00Z'));
            await page.waitForTimeout(500);
            await page.clock.runFor(1000);
        } else await page.waitForTimeout(1500);
        const cdp = await context.newCDPSession(page);
        await cdp.send('HeapProfiler.enable');
        return { context, page, cdp };
    }
    return { open, browser, close: async () => { await browser.close(); await new Promise(done => server.close(done)); } };
}

export async function exerciseMapInteractions(page, { random = Math.random, record = () => {} } = {}) {
    const actions = ['modal', 'point', 'filter', 'zoom'].sort(() => random() - 0.5);
    for (const action of actions) {
        if (action === 'modal') {
            const name = ['Preferences', 'Choose language', 'Notifications'][Math.floor(random() * 3)];
            await page.getByRole('button', { name, exact: true }).click();
            const dialog = page.locator('[role="dialog"][data-state="open"]');
            await dialog.waitFor();
            await page.waitForTimeout(250);
            await dialog.getByRole('button', { name: 'Close', exact: true }).click();
            await dialog.waitFor({ state: 'detached' });
            record(name);
        } else if (action === 'filter') {
            const toggle = page.locator('button[class*="sidebarToggle"]');
            if (await toggle.getAttribute('aria-label') !== 'Collapse') await toggle.click();
            await page.waitForTimeout(350);
            const groups = page.locator('[data-category]:has([data-filter-header])');
            const group = groups.nth(Math.floor(random() * await groups.count()));
            const header = group.locator('[data-filter-header]');
            const wasOpen = await group.locator('[data-filter-content]').getAttribute('data-expanded') === 'true';
            if (!wasOpen) await header.click();
            const items = group.locator('[data-mark-selector-item]');
            if (await items.count()) {
                const item = items.nth(Math.floor(random() * await items.count()));
                await item.click(); await page.waitForTimeout(150); await item.click();
                record('filter-pair');
            }
            await header.click();
            if (wasOpen) await header.click();
            record('category-pair');
            await toggle.click(); await page.waitForTimeout(350);
        } else if (action === 'zoom') {
            const zoomIn = random() > 0.5;
            await page.locator(`button[class*="_zoomButton_"][class*="_${zoomIn ? 'in' : 'out'}_"]`).click();
            await page.waitForTimeout(350);
            await page.locator(`button[class*="_zoomButton_"][class*="_${zoomIn ? 'out' : 'in'}_"]`).click();
            await page.waitForTimeout(350);
            record('zoom-pair');
        } else {
            const points = await page.evaluate(() => {
                const mapElement = document.querySelector('#map');
                let fiber = mapElement[Object.keys(mapElement).find(key => key.startsWith('__reactFiber$'))], core;
                for (; fiber && !core; fiber = fiber.return) for (let hook = fiber.memoizedState; hook; hook = hook.next) {
                    if (hook.memoizedState?.current?.map) { core = hook.memoizedState.current; break; }
                }
                return Object.values(core.map._layers).filter(layer => layer.getLatLng && !layer.getChildCount && core.map.hasLayer(layer)
                    && (layer.options.icon?.art || layer._icon?.isConnected)
                    && layer.options.alt && (layer.options.opacity ?? 1) > 0)
                    .map(layer => core.map.latLngToContainerPoint(layer.getLatLng()))
                    .filter(point => point.x > 100 && point.x < 1050 && point.y > 150 && point.y < 620);
            });
            if (!points.length) throw new Error('No interactive point in replay viewport');
            const box = await page.locator('#map').boundingBox();
            const detail = page.locator('[class*="_detailContainer_"][data-state="open"]');
            for (let attempt = 0; attempt < 8; attempt++) {
                const point = points[Math.floor(random() * points.length)];
                await page.mouse.move(box.x + point.x, box.y + point.y - 16);
                if (await page.locator('#map').evaluate(element => element.style.cursor) !== 'pointer') continue;
                await page.mouse.click(box.x + point.x, box.y + point.y - 16);
                await page.waitForTimeout(400);
                if (await detail.count()) break;
            }
            await detail.waitFor({ timeout: 2000 });
            await page.waitForTimeout(350);
            await detail.getByRole('button', { name: 'Close', exact: true }).click();
            await page.waitForTimeout(350);
            record('point-detail');
        }
    }
}
