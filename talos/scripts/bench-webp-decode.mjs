/* global window, document, localStorage, MutationObserver, FontFace,
   HTMLImageElement, WebGL2RenderingContext, requestAnimationFrame,
   location, innerWidth, innerHeight, NodeFilter, getComputedStyle, Element, CanvasRenderingContext2D */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname, dirname } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: {
    baseline: { type: 'string' }, candidate: { type: 'string' },
    out: { type: 'string', default: '../docs/perf/webp-decode/results.json' },
    rounds: { type: 'string', default: '1' },
    engines: { type: 'string', default: 'chromium' },
    viewports: { type: 'string', default: 'desktop' },
    scenarios: { type: 'string', default: 'refresh-wuling' },
    locale: { type: 'string', default: 'zh-CN' },
    'latency-ms': { type: 'string', default: '0' },
    'font-delay-ms': { type: 'string', default: '0' },
    'other-data-delay-ms': { type: 'string', default: '0' },
    'no-interactions': { type: 'boolean', default: false },
    'no-screenshots': { type: 'boolean', default: false },
    'audit-font-frames': { type: 'boolean', default: false },
    'persisted-progress': { type: 'boolean', default: false },
    'tile-decoding': { type: 'string' },
    'cpu-profile': { type: 'boolean', default: false },
    'gecko-profile': { type: 'boolean', default: false },
    'audit-region-wait': { type: 'boolean', default: false },
    'reduced-motion': { type: 'boolean', default: false },
    help: { type: 'boolean' },
} });
if (values.help) {
    console.log('node scripts/bench-webp-decode.mjs --baseline dist/webp-decode/beta-reference-complete --candidate dist/webp-decode/candidate-admission [--rounds 1] [--engines chromium|firefox|webkit] [--viewports desktop|mobile] [--scenarios refresh-wuling|plain|normal|share] [--locale zh-CN] [--latency-ms 80] [--font-delay-ms 1000] [--other-data-delay-ms 1000] [--audit-font-frames] [--audit-region-wait] [--persisted-progress] [--tile-decoding auto|async] [--cpu-profile] [--gecko-profile] [--reduced-motion] [--no-interactions] [--no-screenshots] [--out results.json]');
    process.exit(0);
}
assert.ok(values.baseline && values.candidate, 'Provide frozen baseline and candidate build directories.');
const rounds = Number(values.rounds);
assert.ok(Number.isInteger(rounds) && rounds > 0 && rounds <= 20, '--rounds must be 1..20.');
const latency = Number(values['latency-ms']);
const fontDelay = Number(values['font-delay-ms']);
const dataDelay = Number(values['other-data-delay-ms']);
assert.ok([latency, fontDelay, dataDelay].every(n => Number.isFinite(n) && n >= 0 && n <= 10000));
const engines = values.engines.split(',');
const viewports = values.viewports.split(',');
const scenarios = values.scenarios.split(',');
assert.ok(engines.every(n => ['chromium', 'firefox', 'webkit'].includes(n)));
assert.ok(viewports.every(n => ['desktop', 'mobile'].includes(n)));
assert.ok(scenarios.every(n => ['plain', 'normal', 'share', 'refresh-wuling'].includes(n)));
assert.ok(!values['tile-decoding'] || ['auto', 'async'].includes(values['tile-decoding']));
const out = resolve(values.out);
await mkdir(dirname(out), { recursive: true });
const roots = { baseline: resolve(values.baseline), candidate: resolve(values.candidate) };
const types = Object.keys(JSON.parse(await readFile(new URL('../src/data/marker/type.json', import.meta.url), 'utf8')));
const regionNames = JSON.parse(await readFile(new URL(`../src/locale/data/region/${values.locale}.json`, import.meta.url), 'utf8'));
const headers = new Map();
for (const [variant, root] of Object.entries(roots)) {
    const html = await readFile(resolve(root, 'index.html'), 'utf8');
    const prefix = /https?:\/\/[^"'<>\s]+?(?=\/assets\/)/.exec(html)?.[0];
    headers.set(variant, { prefix, htmlHash: createHash('sha256').update(html).digest('hex') });
}
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.css': 'text/css', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.woff': 'font/woff' };
const serverRequests = [];
let origin;
const server = createServer(async (req, res) => {
    const variant = /benchVariant=([^;]+)/.exec(req.headers.cookie || '')?.[1];
    const root = roots[variant];
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const started = Date.now();
    const record = { variant, pathname, started, status: null, bytes: 0 };
    serverRequests.push(record);
    try {
        assert.ok(root, 'Unknown fixture variant.');
        if (pathname === '/__external.css') {
            res.writeHead(200, { 'content-type': 'text/css', 'cache-control': 'public, max-age=31536000' });
            res.end(''); record.status = 200; record.end = Date.now(); return;
        }
        const file = resolve(root, '.' + (pathname === '/' || !extname(pathname) ? '/index.html' : pathname));
        assert.ok(file.startsWith(root + '/'), 'Invalid fixture path.');
        let body = await readFile(file);
        if (['.html', '.js', '.css'].includes(extname(file))) {
            let text = body.toString();
            if (headers.get(variant).prefix) text = text.replaceAll(headers.get(variant).prefix, origin);
            if (extname(file) === '.html') {
                text = text.replace(/href="https:\/\/fonts\.googleapis\.com[^"]*"/g, 'href="/__external.css"');
                text = text.replace(/<script[^>]*src="https:\/\/[^"]*"[^>]*>[\s\S]*?<\/script>/g, '');
            }
            body = Buffer.from(text);
        }
        const delay = latency + (pathname.endsWith('.woff2') ? fontDelay : 0) + (/\/WL_\d+-[^/]+\.js$/.test(pathname) ? dataDelay : 0);
        if (delay) await new Promise(r => setTimeout(r, delay));
        if (res.destroyed) return;
        res.writeHead(200, {
            'content-type': mime[extname(file)] || 'application/octet-stream',
            'cache-control': extname(file) === '.html' ? 'no-store' : 'public, max-age=31536000, immutable',
            // The fixture intentionally stays on one origin. This does not establish production CDN CORS support.
            'content-security-policy': "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' blob:; img-src 'self' data: blob:; font-src 'self' data:",
        });
        res.end(body); record.status = 200; record.bytes = body.length;
    } catch (error) {
        record.status = 404;
        if (!res.destroyed) { res.writeHead(404); res.end('missing'); }
        record.error = error.message;
    } finally { record.end = Date.now(); }
});
await new Promise(r => server.listen(0, 'localhost', r));
origin = `http://localhost:${server.address().port}`;
const require = createRequire(import.meta.url);
const loadedPlaywright = process.env.PLAYWRIGHT_MODULE
    ? await import(process.env.PLAYWRIGHT_MODULE)
    : require('playwright');
const playwright = loadedPlaywright.default ?? loadedPlaywright;
const results = { schemaVersion: 2, startedAt: new Date().toISOString(), options: values,
    builds: Object.fromEntries(headers), engines: {}, runs: [], errors: [],
    limitations: [
        'Local frozen assets and guest API fixtures; no production CDN, bandwidth, server-load or real-mobile conclusions.',
        'Static resource URL prefixes are rewritten to localhost identically in both builds. WebP/font binary bytes are unchanged.',
        'Cold means a new browser context; OS caches are not cleared. Warm refresh-wuling uses a real reload; legacy scenarios revisit their original URL, preserving share parameters. HTTP cache stays enabled without Playwright routing.',
        'rAF intervals describe callbacks, not completed display presentation. Screenshots verify settled appearance only.',
        'Image load, explicit decode promises and Leaflet tile-ready classes are separate observations; only application decode calls are observed.',
        'Long Tasks availability is recorded per engine. A missing API is not zero long tasks.',
        'Synthetic latency applies per HTTP request; it does not simulate a shared bandwidth cap.',
        'Local transport is HTTP/1.1. Its connection-slot limits differ from production HTTP/2 and must not be used to claim an H2 queueing improvement.',
    ] };
const save = async () => {
    await writeFile(out, JSON.stringify(results, null, 2));
};

async function install(context, variant, scenario) {
    if (variant === 'candidate' && values['tile-decoding']) await context.addInitScript(mode => {
        // Diagnostic only: change the candidate native hint on tile images
        // without changing requests, Leaflet callbacks or decode() behavior.
        const prototype = HTMLImageElement.prototype;
        const decoding = Object.getOwnPropertyDescriptor(prototype, 'decoding');
        const source = Object.getOwnPropertyDescriptor(prototype, 'src');
        Object.defineProperty(prototype, 'decoding', { ...decoding, set(value) {
            decoding.set.call(this, this.src.includes('/clips/') ? mode : value);
        } });
        Object.defineProperty(prototype, 'src', { ...source, set(value) {
            if (String(value).includes('/clips/')) decoding.set.call(this, mode);
            source.set.call(this, value);
        } });
    }, values['tile-decoding']);
    if (values['audit-font-frames']) await context.addInitScript(() => {
        const failures = [], first = new Map();
        window.__fontFrameAudit = { failures, first: [], frames: 0 };
        const clean = value => value.trim().replace(/^['"]|['"]$/g, '');
        const sample = () => {
            const audit = window.__fontFrameAudit;
            audit.frames++;
            const fonts = [...document.fonts];
            for (const selector of ['[class*="filterTitle"]', '[class*="markName"]', '[class*="innerSite"]', '[class*="innerSub"]', '[class*="markStat"]', '[class*="subregName"]', '[class*="txtInner"]']) {
                const visible = [...document.querySelectorAll(selector)].filter(element => {
                    const rect = element.getBoundingClientRect();
                    if (!rect.width || !rect.height || rect.bottom <= 0 || rect.top >= innerHeight || rect.right <= 0 || rect.left >= innerWidth) return false;
                    for (let parent = element; parent; parent = parent.parentElement) {
                        const style = getComputedStyle(parent);
                        if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) === 0) return false;
                    }
                    return true;
                }).slice(0, 4);
                for (const element of visible) {
                    const text = element.textContent.trim(), families = getComputedStyle(element).fontFamily.split(',').map(clean);
                    if (!text) continue;
                    const key = `${selector}:${text}:${families.join(',')}`;
                    if (first.has(key)) continue;
                    const aliases = families.filter(family => /^(?:OEM|Atlos)-/.test(family));
                    const glyphs = [...new Set([...text])].filter(char => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(char));
                    const covers = (font, char) => font.unicodeRange.split(',').some(range => {
                        const [start, end = start] = range.trim().replace(/^U\+/i, '').split('-');
                        const code = char.codePointAt(0);
                        return code >= parseInt(start.replaceAll('?', '0'), 16) && code <= parseInt(end.replaceAll('?', 'f'), 16);
                    });
                    const missing = aliases.length ? glyphs.filter(char => !fonts.some(font => font.status === 'loaded' && aliases.includes(clean(font.family)) && covers(font, char))) : [];
                    const latin = /[a-z0-9]/i.test(text) && !glyphs.length && fonts.some(font => clean(font.family) === families[0])
                        ? fonts.filter(font => clean(font.family) === families[0]).every(font => font.status !== 'loaded') : false;
                    const record = { time: performance.now(), selector, text, families, missing, latinPending: latin, lang: document.documentElement.lang };
                    first.set(key, record);
                    audit.first.push(record);
                    if (missing.length || latin) failures.push(record);
                }
            }
            requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
    });
    await context.addInitScript(({ types, locale, origin, progress, scenario }) => {
        performance.setResourceTimingBufferSize(10000);
        localStorage.setItem('talos:locale', locale);
        localStorage.setItem('marker-filter', JSON.stringify({ state: { filter: types, selectedPoints: [] }, version: 0 }));
        if (progress) localStorage.setItem('points-storage', JSON.stringify({ state: {
            activePoints: ['2100500004', '10100350000'], activeArchives: [], updatedAt: 1,
        }, version: 0 }));
        localStorage.setItem('ui-prefs', JSON.stringify({ state: { sidebarOpen: false, sidebarWidthV2: 500,
            prefsSidebarEnabled: true, prefsTriggersEnabled: true, prefsViewStateEnabled: true,
            triggerCluster: true, triggerlabelName: true, theme: 'light' }, version: 1 }));
        if (scenario === 'refresh-wuling') {
            localStorage.setItem('region-storage', JSON.stringify({ state: { currentRegionKey: 'Wuling', currentSubregionKey: null }, version: 2 }));
            localStorage.setItem('map-view-states', JSON.stringify({ state: { viewStates: { Wuling: { lat: -812.5, lng: 812.5, zoom: 2 } } }, version: 0 }));
            localStorage.setItem('UserGuide', JSON.stringify({ state: { stepCompleted: { 'STEP-0_welcome': true, 'MSTEP-0_welcome': true } }, version: 1 }));
        }
        const stats = window.__webpBench = { start: performance.now(), frames: [], gpu: [], marks: [], decodes: [], fonts: [], images: [], tileReady: [], longTasks: [], firstGPU: null, segment: 'startup',
            visual: [], opaqueTiles: [], longTaskSupported: PerformanceObserver.supportedEntryTypes.includes('longtask') };
        // Observe the existing scene without exporting a product-only debug API.
        // Restore the generic hook as soon as its instance is identified.
        const weakSet = WeakMap.prototype.set;
        WeakMap.prototype.set = function(key, value) {
            if (value?.painter?.assets instanceof Map && value?.onscreen instanceof Set) {
                window.__webpSurface = value; WeakMap.prototype.set = weakSet;
            }
            return weakSet.call(this, key, value);
        };
        const paint = CanvasRenderingContext2D.prototype.drawImage;
        CanvasRenderingContext2D.prototype.drawImage = function(...args) {
            const result = paint.apply(this, args), scene = window.__webpSurface;
            if (this.canvas.classList?.contains('oem-canvas-markers') && scene?.onscreen.size) {
                let record = stats.visual.at(-1);
                if (record?.frame !== stats.currentFrame) {
                    const entries = [...scene.onscreen], now = performance.now();
                    record = { frame: stats.currentFrame, time: performance.now(), total: entries.length,
                        ready: entries.filter(entry => scene.painter.isArtReady(entry.art)).length,
                        revealed: entries.filter(entry => scene.painter.isArtReady(entry.art) && !entry.motion.alpha.active(now)
                            && !(entry.motion.state?.appearing && now < entry.motion.fadeStart + 150)
                            && !entry.reveal?.active(now)).length,
                        ids: entries.map(entry => entry.marker._leaflet_id) };
                    stats.visual.push(record);
                } else record.time = performance.now();
            }
            return result;
        };
        const originalFetch = window.fetch;
        window.fetch = (input, init) => {
            const url = new URL(typeof input === 'string' ? input : input.url || input.href, location.href);
            if (url.origin === origin || !/^https?:$/.test(url.protocol)) return originalFetch(input, init);
            const guest = /\/auth\/v1\/session/.test(url.pathname);
            return Promise.resolve(new Response(JSON.stringify(guest ? { user: null, session: null } : { items: [], announcements: [], version: 'fixture', locale: 'en', user: null, session: null }), {
                status: guest ? 401 : 200, headers: { 'content-type': 'application/json' },
            }));
        };
        if (stats.longTaskSupported) new PerformanceObserver(list => stats.longTasks.push(...list.getEntries().map(e => ({ start: e.startTime, duration: e.duration })))).observe({ type: 'longtask', buffered: true });
        const decode = HTMLImageElement.prototype.decode;
        if (decode) HTMLImageElement.prototype.decode = function(...args) {
            const record = { url: this.currentSrc || this.src, start: performance.now(), end: null, error: false };
            stats.decodes.push(record);
            return decode.apply(this, args).then(value => { record.end = performance.now(); return value; }, error => { record.end = performance.now(); record.error = true; throw error; });
        };
        const fontLoad = FontFace.prototype.load;
        FontFace.prototype.load = function(...args) {
            const record = { family: this.family, start: performance.now(), end: null, error: false };
            stats.fonts.push(record);
            return fontLoad.apply(this, args).then(value => { record.end = performance.now(); return value; }, error => { record.end = performance.now(); record.error = true; throw error; });
        };
        document.addEventListener('load', event => {
            if (event.target instanceof HTMLImageElement) stats.images.push({ url: event.target.currentSrc || event.target.src, time: performance.now(), width: event.target.naturalWidth, height: event.target.naturalHeight, decoding: event.target.decoding });
        }, true);
        for (const name of ['loading', 'loadingdone', 'loadingerror']) document.fonts.addEventListener(name, () => stats.marks.push({ kind: 'font-' + name, time: performance.now() }));
        const readyTiles = new WeakMap();
        new MutationObserver(records => {
            if (document.querySelector('#root')?.childElementCount && !stats.root) stats.root = performance.now();
            if (document.querySelector('#map') && !stats.map) stats.map = performance.now();
            for (const record of records) {
                const element = record.target;
                if (record.type !== 'attributes' || !(element instanceof Element) || !element.classList.contains('leaflet-tile-loaded')) continue;
                const url = element.currentSrc || element.src || element.getAttribute('data-tile-url');
                if (readyTiles.get(element) === url) continue;
                readyTiles.set(element, url);
                stats.tileReady.push({ url, time: performance.now(), tag: element.tagName });
            }
        }).observe(document, { childList: true, attributes: true, attributeFilter: ['class'], subtree: true });
        if (window.WebGL2RenderingContext) {
            const draw = WebGL2RenderingContext.prototype.drawArraysInstanced;
            WebGL2RenderingContext.prototype.drawArraysInstanced = function(...args) {
                if (args[3] > 0) {
                    const time = performance.now();
                    stats.firstGPU ??= time; stats.lastGPU = time;
                    stats.gpu.push({ time, instances: args[3] });
                }
                return draw.apply(this, args);
            };
        }
        window.__webpCore = () => {
            const element = document.getElementById('map');
            if (!element) return undefined;
            let fiber = element[Object.keys(element).find(key => key.startsWith('__reactFiber$'))];
            for (; fiber; fiber = fiber.return) for (let hook = fiber.memoizedState; hook; hook = hook.next)
                if (hook.memoizedState?.current?.map && hook.memoizedState.current.markerLayer) return hook.memoizedState.current;
            return undefined;
        };
        let previous;
        function frame(time) {
            stats.currentFrame = time;
            if (previous !== undefined && stats.segment) stats.frames.push({ time, ms: time - previous, segment: stats.segment });
            previous = time;
            const core = window.__webpCore();
            if (core && stats.segment) {
                const key = `${stats.segment}:${core.currentRegionId}`;
                if (!stats.opaqueTiles.some(record => record.key === key)) {
                    const tiles = [...document.querySelectorAll('.leaflet-tile')];
                    if (tiles.length && tiles.every(tile => tile.classList.contains('leaflet-tile-loaded')
                        && Number(tile.style.opacity || '1') >= .99)) {
                        stats.opaqueTiles.push({ key, region: core.currentRegionId, segment: stats.segment, time: performance.now() });
                    }
                }
            }
            if (core && !stats.firstMarkers && Object.keys(core.markerLayer.markerDict).length) stats.firstMarkers = performance.now();
            if (core && core.map._loaded) {
                const center = core.map.getCenter(), key = `${center.lat}:${center.lng}:${core.map.getZoom()}`;
                if (stats.camera?.key !== key) stats.camera = { key, changedAt: performance.now() };
            }
            if (core && !stats.bound) {
                stats.bound = true;
                for (const kind of ['talos:regionSwitchStart', 'talos:regionSwitched', 'talos:layerSwitched', 'zoomstart', 'zoomend', 'movestart', 'moveend'])
                    core.map.on(kind, () => stats.marks.push({ kind, time: performance.now(), region: core.currentRegionId, layer: core.currentLayer }));
            }
            requestAnimationFrame(frame);
        }
        requestAnimationFrame(frame);
    }, { types, locale: values.locale, origin, progress: values['persisted-progress'], scenario });
}

const inspect = page => page.evaluate(() => {
    const stats = window.__webpBench;
    const core = window.__webpCore();
    const tiles = [...document.querySelectorAll('.leaflet-tile')].map(el => {
        const rect = el.getBoundingClientRect();
        return { url: el.currentSrc || el.src || null, ready: el.classList.contains('leaflet-tile-loaded'), width: el.naturalWidth || el.width,
            height: el.naturalHeight || el.height, tag: el.tagName,
            visible: rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight };
    });
    const aliasValues = [...document.querySelectorAll('[data-font-owner]')].map(el => ({
        tag: el.tagName, fonts: ['b','db','m','r','h'].map(face => el.style.getPropertyValue('--font-' + face)),
    }));
    const semantic = document.querySelector('.oem-canvas-semantics');
    return { now: performance.now(), root: stats.root, map: stats.map, firstGPU: stats.firstGPU, firstMarkers: stats.firstMarkers,
        dom: { connectedElements: document.querySelectorAll('*').length,
            semanticElements: semantic ? semantic.querySelectorAll('*').length + 1 : 0,
            pointIconElements: semantic?.querySelectorAll('.leaflet-marker-icon').length ?? 0 },
        fontFrameAudit: window.__fontFrameAudit,
        region: core?.currentRegionId, layer: core?.currentLayer, logicalMarkers: core ? Object.keys(core.markerLayer.markerDict).length : 0,
        switching: !!core?.switchRegionPromise, selectedRegion: JSON.parse(localStorage.getItem('region-storage') || 'null')?.state?.currentRegionKey,
        zoom: core?.map.getZoom(), center: core?.map._loaded ? core.map.getCenter() : null, camera: stats.camera,
        tiles, aliases: aliasValues, fontsStatus: document.fonts.status,
        fontFaces: [...document.fonts].map(f => ({ family: f.family, status: f.status })),
        visual: stats.visual, opaqueTiles: stats.opaqueTiles, images: stats.images, gpu: stats.gpu, tileReady: stats.tileReady, decodes: stats.decodes, fontLoads: stats.fonts, marks: stats.marks, longTasks: stats.longTasks,
        longTaskSupported: stats.longTaskSupported, frames: stats.frames,
        paints: performance.getEntriesByType('paint').map(e => ({ name: e.name, time: e.startTime })),
        navigation: performance.getEntriesByType('navigation').map(e => ({ type: e.type, ttfb: e.responseStart, dcl: e.domContentLoadedEventEnd, load: e.loadEventEnd })),
        resources: performance.getEntriesByType('resource').map(e => ({ url: e.name, initiator: e.initiatorType, start: e.startTime, end: e.responseEnd,
            transfer: e.transferSize, encoded: e.encodedBodySize, decoded: e.decodedBodySize, protocol: e.nextHopProtocol })),
    };
});

const checkFontCoverage = page => page.evaluate(() => {
    const clean = family => family.trim().replace(/^['"]|['"]$/g, '');
    const faces = [...document.fonts].filter(font => font.status === 'loaded' && /^(?:OEM|Atlos)-/.test(clean(font.family))).map(font => ({
        family: clean(font.family), ranges: font.unicodeRange.split(',').map(range => {
            const [first, last = first] = range.trim().replace(/^U\+/i, '').split('-');
            return [parseInt(first.replaceAll('?', '0'), 16), parseInt(last.replaceAll('?', 'f'), 16)];
        }),
    }));
    const missing = [], checked = new Set();
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) {
        const node = walk.currentNode, element = node.parentElement;
        if (!element || element.closest('script,style')) continue;
        const cjk = [...new Set([...node.textContent])].filter(char => {
            const n = char.codePointAt(0);
            return (n >= 0x2e80 && n <= 0xa4cf) || (n >= 0xac00 && n <= 0xd7af) || (n >= 0xf900 && n <= 0xffff) || (n >= 0x20000 && n <= 0x3134f);
        });
        if (!cjk.length) continue;
        const style = getComputedStyle(element), rect = element.getBoundingClientRect();
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0 || !rect.width || !rect.height
            || rect.bottom <= 0 || rect.right <= 0 || rect.top >= innerHeight || rect.left >= innerWidth) continue;
        const families = style.fontFamily.split(',').map(clean).filter(family => /^(?:OEM|Atlos)-/.test(family));
        if (!families.length) continue;
        for (const char of cjk) {
            const point = char.codePointAt(0), key = `${families.join(',')}:${point}`;
            if (checked.has(key)) continue;
            checked.add(key);
            const covered = faces.some(font => families.includes(font.family) && font.ranges.some(([first, last]) => point >= first && point <= last));
            if (!covered) missing.push({ char, codepoint: point.toString(16), families, text: node.textContent.trim().slice(0, 80) });
        }
    }
    return { pass: missing.length === 0, checked: checked.size, missing,
        method: 'Visible CJK characters with authored OEM/legacy Atlos aliases must match a loaded FontFace unicodeRange. Binary cmap verification is separate.' };
});

async function settled(page, region = 'Valley_4', targetZoom) {
    await page.waitForFunction(({ region, targetZoom }) => {
        const core = window.__webpCore?.();
        if (!core || core.currentRegionId !== region || core.switchRegionPromise || !Object.keys(core.markerLayer.markerDict).length) return false;
        if (targetZoom !== undefined && Math.abs(core.map.getZoom() - targetZoom) > 1e-6) return false;
        if (!window.__webpBench.camera || performance.now() - window.__webpBench.camera.changedAt < 120) return false;
        if (region === 'Wuling') {
            const scene = window.__webpSurface;
            if (!scene?.onscreen.size || [...scene.onscreen].some(entry => !scene.painter.isArtReady(entry.art))) return false;
        }
        const tiles = [...document.querySelectorAll('.leaflet-tile')].filter(el => { const r = el.getBoundingClientRect(); return r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight; });
        return tiles.length > 0 && tiles.every(el => el.classList.contains('leaflet-tile-loaded')) && document.fonts.status === 'loaded'
            && window.__webpBench.fonts.every(font => font.end !== null);
    }, { region, targetZoom }, { timeout: 30000 });
    // Keep a fixed tail for each build; waiting itself is never reported as business work.
    await page.waitForTimeout(350);
}

async function segment(page, name, action, region) {
    const start = await page.evaluate(name => { const s = window.__webpBench; s.segment = name; const time = performance.now(); s.marks.push({ kind: name + ':start', time }); return time; }, name);
    const started = Date.now();
    await action();
    await settled(page, region);
    const driverAndWaitMs = Date.now() - started;
    const snapshot = await inspect(page);
    await page.evaluate(() => { window.__webpBench.segment = null; });
    const fontCoverage = await checkFontCoverage(page);
    const resources = snapshot.resources.filter(resource => resource.start >= start);
    const tiles = resources.filter(resource => resource.url.includes('/clips/'));
    const decodeCalls = snapshot.decodes.filter(record => record.start >= start);
    return { name, driverAndWaitMs, start, snapshot, fontCoverage, activity: {
        tileResources: tiles.length, tileNetworkFetches: tiles.filter(resource => resource.transfer > 0).length,
        tileTransferBytes: tiles.reduce((sum, resource) => sum + resource.transfer, 0),
        tileEncodedBytes: tiles.reduce((sum, resource) => sum + resource.encoded, 0),
        explicitTileDecodeCalls: decodeCalls.filter(record => record.url.includes('/clips/')).length,
        explicitOtherDecodeCalls: decodeCalls.filter(record => !record.url.includes('/clips/')).length,
        imageLoadEvents: snapshot.images.filter(record => record.time >= start).length,
        tileReadyEvents: snapshot.tileReady.filter(record => record.time >= start).length,
    } };
}

async function interactions(page, variant) {
    const operations = [];
    for (const [index, region] of ['Wuling', 'Valley_4', 'Wuling', 'Valley_4'].entries()) {
        const label = regionNames[region === 'Wuling' ? 'WL' : 'VL'].main;
        const button = page.getByRole('button', { name: label, exact: true });
        await button.waitFor();
        let waiting;
        operations.push(await segment(page, 'region-' + region + '-' + (Math.floor(index / 2) + 1), async () => {
            await button.click();
            if (values['audit-region-wait'] && index === 0) {
                await page.waitForTimeout(250);
                waiting = await inspect(page);
                waiting.busy = await button.getAttribute('aria-busy');
                if (!values['no-screenshots']) {
                    const engine = page.context().browser().browserType().name();
                    const name = `${engine}-${page.viewportSize().width}-${variant}-region-wait.png`;
                    await page.screenshot({ path: resolve(dirname(out), name) });
                    waiting.screenshot = name;
                }
                if (variant === 'candidate') {
                    assert.equal(waiting.region, 'Valley_4', 'Keep the previous region while destination data is delayed.');
                    assert.ok(waiting.logicalMarkers > 0, 'Previous scene retains its point objects while preparing.');
                    assert.equal(waiting.busy, 'true', 'Destination exposes its pending state.');
                }
            }
        }, region));
        if (waiting) operations.at(-1).waiting = waiting;
        const state = operations.at(-1).snapshot;
        assert.equal(state.region, region);
        assert.equal(state.selectedRegion, region, 'UI store must follow the renderer during region measurements.');
        assert.ok(state.logicalMarkers > 0, 'Region must contain actual points.');
    }
    await page.locator('[data-guide="layer-main-toggle"]').click();
    const floor = page.getByRole('button', { name: 'Layer B1', exact: true });
    await floor.waitFor();
    operations.push(await segment(page, 'floor-B1', () => floor.click(), 'Valley_4'));
    assert.equal(operations.at(-1).snapshot.layer, 'B1');
    await page.locator('[data-guide="layer-main-toggle"]').click();
    operations.push(await segment(page, 'floor-M', async () => { await page.getByRole('button', { name: 'Layer M', exact: true }).click(); }, 'Valley_4'));
    const box = await page.locator('#map').boundingBox();
    const x = box.x + box.width * .63, y = box.y + box.height * .48;
    operations.push(await segment(page, 'drag-roundtrip', async () => {
        await page.mouse.move(x, y); await page.mouse.down();
        await page.mouse.move(x - 180, y + 100, { steps: 20 });
        // Pause before releasing so this deterministic round trip measures a
        // stopped drag, rather than accumulating engine-dependent flick inertia.
        await page.waitForTimeout(100); await page.mouse.up();
        await page.waitForTimeout(300);
        await page.mouse.move(x - 180, y + 100); await page.mouse.down();
        await page.mouse.move(x, y, { steps: 20 });
        await page.waitForTimeout(100); await page.mouse.up();
    }, 'Valley_4'));
    operations.push(await segment(page, 'zoom-roundtrip', async () => {
        await page.mouse.move(x, y);
        for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, -32); await page.waitForTimeout(25); }
        await page.waitForTimeout(300);
        for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 32); await page.waitForTimeout(25); }
    }, 'Valley_4'));
    operations.push(await segment(page, 'filter-strip-roundtrip', async () => {
        const strip = page.locator('[class*="mainFilterList"] [class*="mainFilterContentContainer"]').first();
        await strip.hover();
        const ready = () => page.waitForFunction(() => {
            const strip = document.querySelector('[class*="mainFilterList"] [class*="mainFilterContentContainer"]');
            if (!strip) return false;
            const clip = strip.getBoundingClientRect();
            return [...strip.querySelectorAll('img')].filter(image => {
                const rect = image.getBoundingClientRect();
                return rect.right > clip.left && rect.left < clip.right;
            }).every(image => image.complete && image.naturalWidth > 0);
        });
        await page.mouse.wheel(2500, 0); await page.waitForTimeout(200); await ready();
        await page.mouse.wheel(-2500, 0); await page.waitForTimeout(200); await ready();
    }, 'Valley_4'));
    return operations;
}

async function refreshRegionCycles(page) {
    const operations = [];
    for (const [index, region] of ['Valley_4', 'Wuling', 'Valley_4', 'Wuling'].entries()) {
        const name = `refresh-region-${region}-${index}`;
        const label = regionNames[region === 'Wuling' ? 'WL' : 'VL'].main;
        operations.push(await segment(page, name, () => page.getByRole('button', { name: label, exact: true }).click(), region));
    }
    return operations;
}

let activeBrowser;
try {
    for (const engine of engines) {
        activeBrowser = await playwright[engine].launch({ headless: true, ...(engine === 'chromium' ? { channel: 'chrome' } : {}),
            ...(values['gecko-profile'] && engine === 'firefox' ? { env: {
                ...process.env,
                MOZ_PROFILER_STARTUP: '1', MOZ_PROFILER_STARTUP_INTERVAL: '1',
                MOZ_PROFILER_STARTUP_ENTRIES: '8000000',
                MOZ_PROFILER_STARTUP_FEATURES: 'js,stackwalk,cpu',
                // Decode work can use generically named task-pool threads.
                MOZ_PROFILER_STARTUP_FILTERS: '*',
                MOZ_PROFILER_SHUTDOWN: resolve(dirname(out), 'gecko-profile.json'),
            } } : {}),
        });
        results.engines[engine] = await activeBrowser.version();
        for (const viewport of viewports) for (const scenario of scenarios) for (let round = 0; round < rounds; round++) {
            for (const variant of round % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
                const context = await activeBrowser.newContext({ viewport: viewport === 'desktop' ? { width: 1440, height: 900 } : { width: 390, height: 844 }, deviceScaleFactor: 2, locale: values.locale, serviceWorkers: 'block' });
                await context.addCookies([{ url: origin, name: 'benchVariant', value: variant }]);
                await install(context, variant, scenario);
                const page = await context.newPage();
                if (values['reduced-motion']) await page.emulateMedia({ reducedMotion: 'reduce' });
                const profiler = values['cpu-profile'] && engine === 'chromium'
                    ? await context.newCDPSession(page) : null;
                if (profiler) { await profiler.send('Profiler.enable'); await profiler.send('Profiler.setSamplingInterval', { interval: 1000 }); }
                page.setDefaultTimeout(15000);
                const row = { engine, viewport, scenario, round, variant, cold: null, warm: null, operations: [], errors: [], failedRequests: [], requests: [] };
                results.runs.push(row);
                const requests = new WeakMap();
                page.on('request', request => {
                    const record = { url: request.url(), type: request.resourceType(), start: Date.now(), end: null, status: null };
                    requests.set(request, record); row.requests.push(record);
                });
                page.on('pageerror', e => row.errors.push(e.message));
                page.on('requestfinished', request => { const record = requests.get(request); if (record) record.end = Date.now(); });
                page.on('requestfailed', request => {
                    const error = request.failure()?.errorText, record = requests.get(request);
                    if (record) { record.end = Date.now(); record.error = error; }
                    row.failedRequests.push({ url: request.url(), error });
                });
                page.on('response', response => {
                    const record = requests.get(response.request());
                    if (record) record.status = response.status();
                    if (response.status() >= 400) row.failedRequests.push({ url: response.url(), status: response.status() });
                });
                try {
                    const initialRegion = scenario === 'refresh-wuling' ? 'Wuling' : 'Valley_4';
                    const url = origin + (scenario === 'plain' || scenario === 'refresh-wuling' ? '/' : scenario === 'normal' ? '/?r=VL&c=-625,375&z=2' : '/?p=2100500004');
                    if (profiler) await profiler.send('Profiler.start');
                    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                    await settled(page, initialRegion, scenario === 'share' ? 3 : undefined);
                    if (profiler) {
                        const { profile } = await profiler.send('Profiler.stop');
                        await writeFile(resolve(dirname(out), `${variant}-${viewport}-${scenario}-${round}-cold.cpuprofile`), JSON.stringify(profile));
                    }
                    if (values['audit-font-frames'] && viewport === 'desktop' && scenario === 'normal') {
                        // This probe is separate from performance runs: expose
                        // real selector text so its first appearance is audited.
                        await page.locator('button[class*="sidebarToggle"]').click();
                        const category = page.locator('[data-category="boss"]');
                        await category.scrollIntoViewIfNeeded();
                        if (await category.locator('[data-filter-content]').getAttribute('data-expanded') === 'false')
                            await category.locator('[data-filter-header]').click();
                        await category.locator('[data-mark-selector-item]').first().waitFor({ state: 'visible' });
                        await page.getByRole('button', { name: regionNames.VL.main, exact: true }).hover();
                        await page.waitForTimeout(fontDelay + 700);
                    }
                    row.cold = await inspect(page);
                    row.cold.fontCoverage = await checkFontCoverage(page);
                    if (!values['no-screenshots'] && round === 0) {
                        const name = `${engine}-${viewport}-${scenario}-${variant}-cold.png`;
                        await page.screenshot({ path: resolve(dirname(out), name) });
                        row.cold.screenshot = name;
                    }
                    if (scenario === 'refresh-wuling') await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
                    else await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                    await settled(page, initialRegion, scenario === 'share' ? 3 : undefined);
                    row.warm = await inspect(page);
                    row.warm.fontCoverage = await checkFontCoverage(page);
                    if (!values['no-interactions'] && scenario === 'normal') {
                        if (profiler) await profiler.send('Profiler.start');
                        row.operations = await interactions(page, variant);
                        if (profiler) {
                            const { profile } = await profiler.send('Profiler.stop');
                            await writeFile(resolve(dirname(out), `${variant}-${viewport}-${scenario}-${round}-interactions.cpuprofile`), JSON.stringify(profile));
                        }
                    }
                    if (!values['no-interactions'] && scenario === 'refresh-wuling') row.operations = await refreshRegionCycles(page);
                    assert.equal(row.errors.length, 0, 'Page script errors.');
                } catch (error) {
                    row.error = error.stack || String(error);
                    row.partial = await inspect(page).catch(() => null);
                    results.errors.push({ engine, viewport, scenario, variant, round, message: error.message });
                } finally {
                    await save();
                    await context.close();
                }
                console.log(JSON.stringify({ engine, viewport, scenario, round, variant, coldMap: row.cold?.map, coldGPU: row.cold?.firstGPU, tiles: row.cold?.tiles.length, operations: row.operations.length, error: row.error?.split('\n')[0] }));
            }
        }
        await activeBrowser.close(); activeBrowser = undefined;
    }
} finally {
    await activeBrowser?.close();
    results.finishedAt = new Date().toISOString();
    results.serverRequests = serverRequests;
    await save();
    await new Promise(r => server.close(r));
}
if (results.errors.length) process.exitCode = 1;
