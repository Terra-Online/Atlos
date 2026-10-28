/* global window, document, MutationObserver, getComputedStyle, requestAnimationFrame, caches */
import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { chromium } from 'playwright';
import { createProductionServer, readProductionArtifact } from './lib/production-server.mjs';
import { createServices, installBrowserServices, serviceResponse, browserUser, seedContributions, PNG } from '../test-support/browser/services.mjs';
import { describeArtifact, acceptArtifacts, summarizeClosure, startupStages } from './lib/closure-summary.mjs';
import { hashFiles } from './release-snapshot.mjs';

const { values } = parseArgs({ options: { dist: { type: 'string' }, probe: { type: 'string' }, out: { type: 'string', default: '../docs/perf/production/closure' },
    rounds: { type: 'string', default: '5' }, cycles: { type: 'string', default: '20' }, app: { type: 'string' }, profile: { type: 'string' } } });
const rounds = Number(values.rounds), cycles = Number(values.cycles);
if (!values.dist || !Number.isInteger(rounds) || rounds < 1 || !Number.isInteger(cycles) || cycles < 5) throw new Error('Use --dist FROZEN_SITE [--probe DIAGNOSTIC_SITE] [--rounds 5] [--cycles 20] [--out DIR].');
const out = resolve(values.out); await mkdir(dirname(out), { recursive: true }); await mkdir(out);
const report = { startedAt: new Date().toISOString(), environment: { os: `${os.platform()} ${os.release()}`, arch: os.arch(), cpu: os.cpus()[0].model, node: process.version },
    method: { rounds, cycles, cache: 'Native HTTP cache behind a local ServiceWorker transport bridge. No CacheStorage API; no Playwright HTTP routing. Original production bundle bytes unchanged; local response URLs can relocate relative imports. Cold/warm share the same bridge, so only this paired cohort is comparable, not first-run routed timings or real CDN origin topology. SW startup excluded; localhost identity bytes, no WAN/CDN claim.',
        startup: 'Visible usable entry then double rAF, at least 2s boundary. Separate probe build used only for stage diagnostics; no probe samples in uninstrumented totals.',
        heap: 'Three prewarm cycles then GC checkpoint at 0 and each 5 additional cycles; CDP usedJSHeapSize/DOM, not total process/GPU memory or leak proof.',
        heapPaths: 'Main search plus Settings open/close; Intel single-card collect/uncollect then finite animations settled (distinct from initial baseline expand/scroll); hub content/profile route roundtrip. Other paths are not cleared of leak suspicion by this workload.' },
    collector: {}, artifacts: [], startup: [], stages: [], heap: [], errors: [] };
for (const file of ['scripts/bench-production-closure.mjs', 'scripts/lib/startup-probe.mjs', 'scripts/lib/closure-summary.mjs', 'scripts/lib/production-server.mjs', 'test-support/browser/services.mjs']) report.collector[file] = createHash('sha256').update(await readFile(file)).digest('hex');
const save = () => writeFile(resolve(out, 'closure.json'), JSON.stringify(report, null, 2) + '\n');
let activeServices, staticRequests, server, browser;
function workerSource(artifact) {
    return `const assetOrigin=${JSON.stringify(artifact.assets.origin)},assetPrefix=${JSON.stringify(artifact.assets.pathname)};
self.performance.setResourceTimingBufferSize(20000);
self.addEventListener('install', event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url); if(url.origin===self.location.origin)return;
 event.respondWith((async()=>{
  if(url.origin===assetOrigin&&url.pathname.startsWith(assetPrefix)) {
   const path='/' + url.pathname.slice(assetPrefix.length) + url.search;
   return fetch(path.startsWith('/seo/og/')?'/__baseline__/og.png':path);
  }
  const headers={'content-type':'application/json'};
  return fetch('/__baseline__/service?url='+encodeURIComponent(url.href),{method:event.request.method,headers,body:['GET','HEAD'].includes(event.request.method)?undefined:await event.request.text()});
 })());
});
self.addEventListener('message',event=>{if(event.data==='resources')event.ports[0].postMessage(self.performance.getEntriesByType('resource').map(e=>({path:new URL(e.name).pathname,transfer:e.transferSize,encoded:e.encodedBodySize,decoded:e.decodedBodySize,start:e.startTime,end:e.responseEnd})));});`;
}
async function transport(request, response, artifact) {
    const url = new URL(request.url, 'http://localhost');
    if (!url.pathname.startsWith('/__baseline__/')) { staticRequests.push({ method: request.method, path: url.pathname }); return false; }
    const send = (type, body, status = 200, cache = 'no-store') => { response.writeHead(status, { 'content-type': type, 'cache-control': cache }); response.end(body); };
    if (url.pathname === '/__baseline__/bootstrap.html') send('text/html', '<!doctype html><title>Local baseline transport</title>');
    else if (url.pathname === '/__baseline__/transport.js') { response.setHeader('service-worker-allowed', '/'); send('text/javascript', workerSource(artifact)); }
    else if (url.pathname === '/__baseline__/og.png') send('image/png', PNG, 200, 'public,max-age=3600');
    else if (url.pathname === '/__baseline__/service') {
        const remote = new URL(url.searchParams.get('url'));
        if (remote.hostname === 'fonts.googleapis.com' && remote.pathname === '/css2') send('text/css', '');
        else if (remote.hostname === 'www.googletagmanager.com' && remote.pathname === '/gtag/js') send('text/javascript', '');
        else if (['www.google-analytics.com', 'region1.google-analytics.com'].includes(remote.hostname) && ['/g/collect', '/collect'].includes(remote.pathname)) send('text/plain', '', 204);
        else {
            const chunks = []; for await (const chunk of request) chunks.push(chunk);
            const body = Buffer.concat(chunks).toString();
            const result = await serviceResponse(activeServices, { method: () => request.method, postDataJSON: () => JSON.parse(body) }, remote);
            send('application/json', JSON.stringify(result.body), result.status || 200);
        }
    } else send('text/plain', 'Unknown baseline transport', 404);
    return true;
}
function observe(selector) {
    const state = window.__closure = { ready: null, paints: [], lcp: null, cls: 0 };
    performance.setResourceTimingBufferSize(20000);
    for (const type of ['paint', 'largest-contentful-paint', 'layout-shift']) if (PerformanceObserver.supportedEntryTypes.includes(type)) new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
            if (type === 'paint') state.paints.push({ name: entry.name, startTime: entry.startTime });
            else if (type === 'largest-contentful-paint') state.lcp = entry.startTime;
            else if (!entry.hadRecentInput) state.cls += entry.value;
        }
    }).observe({ type, buffered: true });
    let scheduled = false;
    const observer = new MutationObserver(check);
    function check() {
        if (state.ready !== null || scheduled) return;
        const target = document.querySelector(selector);
        if (!target || !target.getClientRects().length || getComputedStyle(target).visibility === 'hidden') return;
        const panel = target.closest('[role="tabpanel"]');
        if (panel && panel.clientHeight < target.getBoundingClientRect().height) return;
        scheduled = true;
        requestAnimationFrame(() => requestAnimationFrame(() => { state.ready = performance.now(); observer.disconnect(); }));
    }
    observer.observe(document, { childList: true, subtree: true, attributes: true });
    document.addEventListener('DOMContentLoaded', check, { once: true });
}
const workerResources = (page) => page.evaluate(() => new Promise((done) => {
    const channel = new MessageChannel(); channel.port1.onmessage = (event) => done(event.data);
    navigator.serviceWorker.controller.postMessage('resources', [channel.port2]);
}));
const profiles = [{ name: 'desktop', viewport: { width: 1440, height: 1000 }, cpu: 1, mobile: false }, { name: 'mobile-cpu4', viewport: { width: 390, height: 844 }, cpu: 4, mobile: true }].filter((p) => !values.profile || values.profile === p.name);
const apps = [{ name: 'main', path: '/', selector: '[data-search-input="true"]' }, { name: 'intel', path: '/intel/', selector: 'article[data-intel-archive]' }, { name: 'hub', path: '/me/content', selector: '[role="tabpanel"] li' }].filter((a) => !values.app || values.app === a.name);
if (!profiles.length || !apps.length) throw new Error('Unknown --app or --profile.');
Object.assign(report.method, { apps: apps.map((a) => a.name), profiles: profiles.map((p) => p.name), hasProbe: Boolean(values.probe) });
async function contextFor(profile, app) {
    activeServices = createServices(); activeServices.user = { ...browserUser }; seedContributions(activeServices);
    const context = await browser.newContext({ viewport: profile.viewport, locale: 'en-US', deviceScaleFactor: 1, isMobile: profile.mobile, hasTouch: profile.mobile });
    await installBrowserServices(context, activeServices, { origin: server.origin, production: server, routeHTTP: false });
    await context.addInitScript(observe, app.selector);
    const page = await context.newPage(); page.setDefaultTimeout(30_000);
    await page.goto(server.origin + '/__baseline__/bootstrap.html');
    await page.evaluate(async () => {
        await navigator.serviceWorker.register('/__baseline__/transport.js', { scope: '/' });
        await navigator.serviceWorker.ready;
        if (!navigator.serviceWorker.controller) await new Promise((done) => navigator.serviceWorker.addEventListener('controllerchange', done, { once: true }));
    });
    const cdp = await context.newCDPSession(page); await cdp.send('Network.enable');
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu });
    const network = { requests: [], cache: [] };
    cdp.on('Network.responseReceived', ({ requestId, response }) => {
        const url = new URL(response.url);
        if (['http:', 'https:'].includes(url.protocol)) network.requests.push({ requestId, path: url.pathname, disk: Boolean(response.fromDiskCache), worker: Boolean(response.fromServiceWorker), status: response.status });
    });
    cdp.on('Network.requestServedFromCache', ({ requestId }) => network.cache.push(requestId));
    return { context, page, cdp, network };
}
async function cycle(page, app, number, profile) {
    if (app.name === 'main') {
        const input = page.locator(app.selector);
        await input.fill('Control Nexus');
        await page.locator('form button').filter({ hasText: 'Control Nexus' }).waitFor();
        await input.fill('');
        await page.locator('form button').filter({ hasText: 'Control Nexus' }).waitFor({ state: 'detached' });
        if (profile.mobile) await page.locator('[data-guide="headbar"] button').first().click();
        const opener = page.getByRole('button', { name: 'Preferences', exact: true });
        await opener.evaluate((node) => node.scrollIntoView({ behavior: 'instant', block: 'center' }));
        await opener.click();
        const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
        await dialog.waitFor();
        await dialog.getByRole('button', { name: 'Close', exact: true }).click();
        await dialog.waitFor({ state: 'detached' });
    } else if (app.name === 'intel') {
        const card = page.locator('article[data-intel-archive]').first();
        const initial = await card.getAttribute('aria-pressed'); await card.click();
        await page.waitForFunction((initial) => document.querySelector('article[data-intel-archive]')?.getAttribute('aria-pressed') !== initial, initial);
        await card.click(); await page.waitForFunction((initial) => document.querySelector('article[data-intel-archive]')?.getAttribute('aria-pressed') === initial, initial);
        await page.waitForFunction(() => !document.querySelector('article[data-intel-archive]').getAnimations({ subtree: true }).some((animation) => animation.playState === 'running' && animation.effect.getTiming().iterations !== Infinity));
    } else {
        await page.locator('nav a[href="/me/profile"]').click(); await page.locator('input[name="avatar"]').first().waitFor();
        await page.locator('nav a[href="/me/content"]').click(); await page.locator(app.selector).first().waitFor();
    }
    // Allow committed DOM and animation work to settle before a GC checkpoint.
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    if (number % 5 === 0) await page.waitForTimeout(250);
}
async function snapshot(cdp, cycle) {
    await cdp.send('HeapProfiler.collectGarbage');
    return { cycle, heap: await cdp.send('Runtime.getHeapUsage'), dom: await cdp.send('Memory.getDOMCounters') };
}
try {
    const builds = [['production', values.dist], ...(values.probe ? [['probe-diagnostic', values.probe]] : [])];
    for (const [kind, dist] of builds) {
        const artifact = await readProductionArtifact(dist), files = await hashFiles(artifact.root);
        report.artifacts.push(describeArtifact(kind, artifact, files));
    }
    // Refuse a stale/dirty probe before spending time collecting any page samples.
    acceptArtifacts(report);
    browser = await chromium.launch(); report.environment.chromium = await browser.version();
    for (const [kind, dist] of builds) {
        staticRequests = []; server = await createProductionServer({ dist, handleRequest: transport });
        for (const profile of profiles) for (const app of kind === 'production' ? apps : apps.filter((a) => a.name === 'main')) for (let round = 0; round < rounds; round++) {
            const { context, page, cdp, network } = await contextFor(profile, app);
            try {
                for (const visit of ['cold-context', 'warm-http']) {
                    const before = (await workerResources(page)).length;
                    staticRequests.length = network.requests.length = network.cache.length = 0;
                    await page.goto(server.origin + app.path, { waitUntil: 'domcontentloaded' });
                    await page.waitForFunction(() => window.__closure.ready !== null && performance.now() >= 2000);
                    const sample = await page.evaluate(() => ({ ...window.__closure, sampledAt: performance.now(), resources: performance.getEntriesByType('resource').map((e) => ({ path: new URL(e.name).pathname, transfer: e.transferSize, encoded: e.encodedBodySize, decoded: e.decodedBodySize })) }));
                    const downstream = (await workerResources(page)).slice(before);
                    const cachePaths = network.requests.filter((entry) => entry.disk || network.cache.includes(entry.requestId)).map((entry) => entry.path);
                    const cacheStorageNames = await page.evaluate(() => caches.keys());
                    if (cacheStorageNames.length) throw new Error('CacheStorage is outside this HTTP-cache baseline.');
                    const row = { app: app.name, profile: profile.name, round, visit, ...sample, downstream, staticRequests: [...staticRequests], network: structuredClone(network), cachePaths, cacheStorageNames };
                    if (kind === 'production') report.startup.push(row);
                    else {
                        const marks = await page.evaluate(() => performance.getEntriesByType('mark').filter((e) => e.name.startsWith('atlos:')).map((e) => ({ name: e.name.slice(6), time: e.startTime })));
                        const spans = startupStages.map((name) => {
                            const start = marks.find((m) => m.name === name + ':start')?.time, end = marks.find((m) => m.name === name + ':end')?.time;
                            if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) throw new Error(`Missing stage ${name}`);
                            return { name, start, end, duration: end - start };
                        });
                        report.stages.push({ ...row, diagnostic: true, marks, spans });
                    }
                }
                if (kind === 'production') {
                    for (let n = 1; n <= 3; n++) await cycle(page, app, n, profile);
                    const checkpoints = [await snapshot(cdp, 0)];
                    for (let n = 1; n <= cycles; n++) { await cycle(page, app, n, profile); if (n % 5 === 0 || n === cycles) checkpoints.push(await snapshot(cdp, n)); }
                    report.heap.push({ app: app.name, profile: profile.name, round, prewarm: 3, checkpoints });
                }
                if (activeServices.unexpected.length || activeServices.pageErrors.length || server.missing.length) throw new Error(JSON.stringify({ unexpected: activeServices.unexpected, pageErrors: activeServices.pageErrors, missing: server.missing }));
                console.log(`${kind} ${profile.name} ${app.name} ${round + 1}/${rounds}: passed`);
            } finally { await context.close(); await save(); }
        }
        await server.close(); server = null;
    }
} catch (error) { report.errors.push(String(error.stack || error)); process.exitCode = 1; }
finally { await browser?.close(); await server?.close(); await save(); }
if (!report.errors.length) {
    try {
        const summary = summarizeClosure(report);
        await writeFile(resolve(out, 'closure-summary.json'), JSON.stringify(summary, null, 2) + '\n');
    } catch (error) { report.errors.push(String(error.stack || error)); process.exitCode = 1; await save(); }
}
