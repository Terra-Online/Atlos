/* global window, document, localStorage, MutationObserver, getComputedStyle, requestAnimationFrame */
import { parseArgs } from 'node:util';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { createGzip } from 'node:zlib';
import { once } from 'node:events';
import { pipeline } from 'node:stream/promises';
import { resolve } from 'node:path';
import os from 'node:os';
import { chromium, webkit } from 'playwright';
import { createHash } from 'node:crypto';
import { hashFiles } from './release-snapshot.mjs';
import { createProductionServer } from './lib/production-server.mjs';
import { writeProductionReport } from './report-production.mjs';
import { createServices, installBrowserServices, browserUser, seedContributions } from '../test-support/browser/services.mjs';

const { values } = parseArgs({ options: { dist: { type: 'string' }, out: { type: 'string', default: '../docs/perf/production/latest' },
    rounds: { type: 'string', default: '5' }, trace: { type: 'boolean', default: false }, app: { type: 'string' }, profile: { type: 'string' }, 'bundle-reports': { type: 'string' }, 'webkit-rounds': { type: 'string', default: '5' } } });
const rounds = Number(values.rounds), webkitRounds = Number(values['webkit-rounds']);
if (!values.dist || !Number.isInteger(rounds) || rounds < 1 || !Number.isInteger(webkitRounds) || webkitRounds < 0)
    throw new Error('Use --dist FROZEN_FULL_SITE [--rounds 5] [--webkit-rounds 5] [--bundle-reports DIR] [--out DIR].');
const out = resolve(values.out); await mkdir(out, { recursive: true });
const server = await createProductionServer({ dist: values.dist });
const artifactFiles = await hashFiles(server.root);
const collector = {};
for (const file of ['scripts/bench-production.mjs', 'scripts/report-production.mjs', 'scripts/lib/production-server.mjs', 'test-support/browser/services.mjs'])
    collector[file] = createHash('sha256').update(await readFile(file)).digest('hex');
const report = { collector, artifact: { sha256: createHash('sha256').update(JSON.stringify(artifactFiles)).digest('hex'), files: Object.keys(artifactFiles).length, method: 'SHA256 of JSON.stringify(release-snapshot.hashFiles), including complete frozen resources and receipt' }, startedAt: new Date().toISOString(), source: server.info.source, sourceDirty: server.info.sourceDirty,
    build: { target: server.info.target, channel: server.info.channel, builtAt: server.info.builtAt, resourcesPrefix: server.info.resources.prefix },
    environment: { os: `${os.platform()} ${os.release()}`, arch: os.arch(), cpu: os.cpus()[0].model, cores: os.cpus().length,
        memoryBytes: os.totalmem(), node: process.version, playwright: '1.62.1' },
    method: { rounds, webkitRounds, minimumStartupWindowMs: 2000, locale: 'en-US', deviceScaleFactor: 1,
        cold: 'Fresh isolated browser context for each app/profile/round.',
        repeat: 'Reload in the same context. Routing disables HTTP cache; this is repeat execution, not a warm HTTP-cache result.',
        transport: 'Unmodified production bundles; local identity-encoded asset responses through explicit CDN interception. HTTP/session/cloud fixtures; separately generated OG previews use fixed PNG. No WAN/server latency claim.',
        readiness: 'Visible usable app element followed by two rAF callbacks; FCP/LCP/CLS sampled after readiness and at least 2s from navigation; sampledAt records the actual boundary. LCP is a lab snapshot, not finalized field LCP. Interaction timing is driver-inclusive; no field INP claim.',
        mobile: '390x844 touch emulation and 4x Chromium CPU slowdown, not a physical mobile device.',
        intelInput: 'Show Details uses pointer click on desktop and tap on mobile after layout stabilization. Content scroll workload is a bounded 1200 CSS-pixel smooth roundtrip, not the changing end of a virtualized list.',
        cpu: 'CDP Performance counters for the current document, seconds converted to milliseconds; enable reset before each navigation, no subtraction across documents. Raw nativeMetrics retained.',
        contributions: '20 fixed image records with null previewUrl: supported placeholder path, not thumbnail decoding or a live media feed.',
        heap: 'Chromium CDP usedJSHeapSize/DOM counts; explicit GC before/after repeated interactions. Not total process/GPU memory.' },
    startup: [], interactions: [], memory: [], errors: [] };
const save = () => writeFile(resolve(out, 'runtime.json'), JSON.stringify(report, null, 2) + '\n');
const profiles = [{ name: 'desktop', viewport: { width: 1440, height: 1000 }, cpu: 1, isMobile: false },
    { name: 'mobile-cpu4', viewport: { width: 390, height: 844 }, cpu: 4, isMobile: true }].filter((profile) => !values.profile || values.profile === profile.name);
const apps = [{ name: 'main', path: '/', selector: '[data-search-input="true"]' },
    { name: 'intel', path: '/intel/', selector: 'article[data-intel-archive]' },
    { name: 'hub', path: '/me/content', selector: '[role="tabpanel"] li' }].filter((app) => !values.app || values.app === app.name);
if (!profiles.length || !apps.length) throw new Error('Unknown --app or --profile.');
report.method.workloads = profiles.length * apps.length;

async function setup(browser, profile) {
    const context = await browser.newContext({ viewport: profile.viewport, locale: 'en-US', deviceScaleFactor: 1,
        isMobile: profile.isMobile, hasTouch: profile.isMobile, reducedMotion: 'no-preference' });
    const services = createServices(); services.user = { ...browserUser };
    seedContributions(services);
    await installBrowserServices(context, services, { origin: server.origin, production: server });
    const page = await context.newPage();
    page.setDefaultTimeout(30_000); page.setDefaultNavigationTimeout(45_000);
    return { context, services, page };
}

// The timestamp is captured in the browser; Playwright polling completion is not
// used as the first-frame measurement. No production entrypoint is instrumented.
function observeStartup(selector) {
    performance.setResourceTimingBufferSize(10_000);
    const sample = window.__productionBench = { readyDOM: null, readyFrame: null, lcp: null, cls: 0, longTasks: [], paints: [], resources: [] };
    const observe = (type, callback) => {
        if (!PerformanceObserver.supportedEntryTypes.includes(type)) return;
        new PerformanceObserver((list) => callback(list.getEntries())).observe({ type, buffered: true });
    };
    observe('paint', (entries) => { sample.paints.push(...entries.map(({ name, startTime }) => ({ name, startTime }))); });
    observe('largest-contentful-paint', (entries) => { sample.lcp = entries.at(-1).startTime; });
    observe('layout-shift', (entries) => { for (const entry of entries) if (!entry.hadRecentInput) sample.cls += entry.value; });
    observe('longtask', (entries) => { sample.longTasks.push(...entries.map(({ startTime, duration }) => ({ startTime, duration }))); });
    let scheduled = false;
    const observer = new MutationObserver(check);
    function check() {
        if (sample.readyFrame !== null || scheduled) return;
        const target = document.querySelector(selector);
        if (!target || !target.getClientRects().length || getComputedStyle(target).visibility === 'hidden') return;
        const panel = target.closest('[role="tabpanel"]');
        if (panel && panel.clientHeight < target.getBoundingClientRect().height) return;
        sample.readyDOM ??= performance.now(); scheduled = true;
        requestAnimationFrame(() => requestAnimationFrame(() => {
            const current = document.querySelector(selector);
            if (current?.getClientRects().length && getComputedStyle(current).visibility !== 'hidden') {
                sample.readyFrame = performance.now(); observer.disconnect();
            } else { scheduled = false; check(); }
        }));
    }
    observer.observe(document, { childList: true, subtree: true, attributes: true });
    document.addEventListener('DOMContentLoaded', check, { once: true });
}

async function measure(page, label, action, cdp, tags) {
    await page.evaluate(() => {
        const sample = window.__interaction = { start: performance.now(), frames: [] };
        const frame = (time) => { if (window.__interaction === sample) { sample.frames.push(time); requestAnimationFrame(frame); } };
        requestAnimationFrame(frame);
    });
    const outcome = await action();
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    const sample = await page.evaluate(() => {
        const sample = window.__interaction; window.__interaction = null;
        return { ...sample, end: performance.now(), longTasks: window.__productionBench.longTasks.filter((task) => task.startTime >= sample.start) };
    });
    const gaps = sample.frames.slice(1).map((time, index) => time - sample.frames[index]);
    report.interactions.push({ ...tags, label, driverInclusiveMs: sample.end - sample.start,
        outcome, frames: sample.frames, maxFrameGap: gaps.length ? Math.max(...gaps) : null,
        longTasks: sample.longTasks, ...(cdp ? {} : { longTaskSupport: false }) });
}

async function snapshot(cdp) {
    await cdp.send('HeapProfiler.collectGarbage');
    return { heap: await cdp.send('Runtime.getHeapUsage'), dom: await cdp.send('Memory.getDOMCounters') };
}

async function exercise(page, app, profile, cdp, tags) {
    const click = async (locator) => { await locator.evaluate((node) => node.scrollIntoView({ behavior: 'instant', block: 'center' })); await locator.click(); };
    if (app.name === 'main') {
        await measure(page, 'search-results', async () => {
            await page.locator(app.selector).fill('Control Nexus');
            await page.locator('form button').filter({ hasText: 'Control Nexus' }).waitFor();
        }, cdp, tags);
        await page.locator(app.selector).fill('');
        if (profile.isMobile) await page.locator('[data-guide="headbar"] button').first().click();
        await measure(page, 'preferences-open-close', async () => {
            const opener = page.getByRole('button', { name: 'Preferences', exact: true });
            await click(opener);
            const dialog = page.getByRole('dialog', { name: 'Settings', exact: true });
            await dialog.waitFor();
            await dialog.getByRole('button', { name: 'Close', exact: true }).click();
            await dialog.waitFor({ state: 'detached' });
        }, cdp, tags);
    } else if (app.name === 'intel') {
        const button = page.getByRole('button', { name: 'Show Details', exact: true });
        if (profile.isMobile) {
            const sidebar = page.locator('[data-sidebar-layout="mobile"]');
            const drawer = sidebar.locator('[data-font-region="drawer"]').first();
            if (await drawer.getAttribute('data-snap') === '0') await sidebar.getByRole('separator').click();
            await button.evaluate((node) => node.scrollIntoView({ behavior: 'instant', block: 'center' }));
        } else {
            const handle = page.locator('.intelBottomTools').getByRole('separator');
            const box = await handle.boundingBox();
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
            await page.mouse.move(box.x + box.width / 2, box.y - 90, { steps: 10 }); await page.mouse.up();
        }
        await button.waitFor();
        // This matches the behavior baseline's measured-before-motion contract.
        await button.evaluate((node) => node.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'nearest' }));
        await page.waitForFunction(async () => {
            let previous;
            for (let frame = 0; frame < 12; frame++) {
                await new Promise(requestAnimationFrame);
                const content = document.querySelector('.intelContent'), viewport = content.getBoundingClientRect();
                const visible = [...content.querySelectorAll('article[data-intel-archive]')].flatMap((node) => {
                    const rect = node.getBoundingClientRect();
                    if (rect.bottom <= viewport.top || rect.top >= viewport.bottom) return [];
                    if (node.parentElement.dataset.measuring === 'true' || node.parentElement.dataset.layoutSync === 'true') return [null];
                    return [{ id: node.dataset.intelArchive, x: rect.x, y: rect.y, width: rect.width, height: rect.height }];
                });
                if (!visible.length || visible.includes(null) || (previous && (visible.length !== previous.length || visible.some((rect, i) => rect.id !== previous[i].id || ['x', 'y', 'width', 'height'].some((key) => Math.abs(rect[key] - previous[i][key]) > .5))))) return false;
                previous = visible;
            }
            return true;
        });
        await measure(page, 'details-expand-collapse', async () => {
            await (profile.isMobile ? button.tap() : button.click());
            await page.waitForFunction(() => document.querySelector('[data-app="intel"]').dataset.cardsExpanded === 'true');
            await page.waitForFunction(() => !document.querySelector('article[data-intel-archive]').getAnimations({ subtree: true }).some((a) => a.playState === 'running'));
            await (profile.isMobile ? button.tap() : button.click());
            await page.waitForFunction(() => document.querySelector('[data-app="intel"]').dataset.cardsExpanded === 'false');
            await page.waitForFunction(() => !document.querySelector('article[data-intel-archive]').getAnimations({ subtree: true }).some((a) => a.playState === 'running'));
        }, cdp, tags);
        const content = page.locator('.intelContent');
        await measure(page, 'content-scroll-roundtrip', async () => {
            const destination = await content.evaluate((node) => Math.min(1200, node.scrollHeight - node.clientHeight));
            await content.evaluate((node, top) => node.scrollTo({ top, behavior: 'smooth' }), destination);
            await page.waitForFunction((top) => Math.abs(document.querySelector('.intelContent').scrollTop - top) < 2, destination);
            const down = await content.evaluate((node) => node.scrollTop);
            await content.evaluate((node) => node.scrollTo({ top: 0, behavior: 'smooth' }));
            await page.waitForFunction(() => Math.abs(document.querySelector('.intelContent').scrollTop) < 1);
            return { destination, down, restored: await content.evaluate((node) => node.scrollTop) };
        }, cdp, tags);
    } else {
        await measure(page, 'profile-route-roundtrip', async () => {
            await click(page.locator('nav a[href="/me/profile"]'));
            await page.locator('input[name="avatar"]').first().waitFor();
            await click(page.locator('nav a[href="/me/content"]'));
            await page.locator(app.selector).first().waitFor();
        }, cdp, tags);
    }
}

let browser;
try {
    browser = await chromium.launch(); report.environment.chromium = await browser.version();
    for (const profile of profiles) for (const app of apps) for (let round = 0; round < rounds; round++) {
        const { context, page, services } = await setup(browser, profile);
        try {
            await context.addInitScript(observeStartup, app.selector);
            const cdp = await context.newCDPSession(page); await cdp.send('Performance.enable');
            await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu });
            for (const visit of ['cold-context', 'repeat-fixture']) {
                // Chromium resets document counters on navigation. Subtracting
                // the previous document can make repeat visits falsely negative.
                await cdp.send('Performance.disable');
                await cdp.send('Performance.enable');
                await page.goto(server.origin + app.path, { waitUntil: 'domcontentloaded' });
                await page.locator(app.selector).first().waitFor();
                await page.waitForFunction(() => window.__productionBench.readyFrame !== null && performance.now() >= 2000);
                const sample = await page.evaluate(() => ({ ...window.__productionBench,
                    sampledAt: performance.now(), resources: performance.getEntriesByType('resource').map((resource) => ({
                        path: new URL(resource.name).pathname, duration: resource.duration, transfer: resource.transferSize,
                        encoded: resource.encodedBodySize, decoded: resource.decodedBodySize, end: resource.responseEnd })),
                    elements: document.querySelectorAll('*').length,
                    cards: document.querySelectorAll('article[data-intel-archive]').length,
                    visibility: document.visibilityState, focus: document.hasFocus() }));
                const metrics = (await cdp.send('Performance.getMetrics')).metrics;
                report.startup.push({ app: app.name, profile: profile.name, round, visit, ...sample, nativeMetrics: metrics,
                    cpu: Object.fromEntries(metrics.filter((m) => ['ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'TaskDuration'].includes(m.name)).map((m) => [m.name, m.value * 1000])) });
            }
            const before = await snapshot(cdp);
            for (let cycle = 0; cycle < 3; cycle++) await exercise(page, app, profile, cdp, { app: app.name, profile: profile.name, round, cycle });
            const after = await snapshot(cdp);
            if (round === 0) await page.screenshot({ path: resolve(out, `${profile.name}-${app.name}.png`) });
            report.memory.push({ app: app.name, profile: profile.name, round, cycles: 3, before, after });
            if (services.unexpected.length || services.pageErrors.length) throw new Error(JSON.stringify(services));
            console.log(`${profile.name} ${app.name} round ${round + 1}/${rounds}: passed`);
        } catch (error) {
            await page.screenshot({ path: resolve(out, 'failure.png') }).catch(() => {});
            report.failureState = await page.evaluate(() => ({ app: document.querySelector('[data-app]')?.getAttribute('data-cards-expanded'),
                prefs: localStorage.getItem('ui-prefs'), triggers: [...document.querySelectorAll('[aria-pressed]')].map((node) => ({ text: node.getAttribute('aria-label'), active: node.getAttribute('aria-pressed') })) })).catch(() => null);
            throw error;
        } finally { await context.close(); await save(); }
    }
    await browser.close(); browser = await webkit.launch(); report.environment.webkit = await browser.version();
    const desktop = { name: 'desktop', viewport: { width: 1440, height: 1000 }, cpu: 1, isMobile: false }, intel = { name: 'intel', path: '/intel/', selector: 'article[data-intel-archive]' };
    for (let round = 0; round < webkitRounds; round++) {
        const { context, page, services } = await setup(browser, desktop);
        try {
            await context.addInitScript(observeStartup, intel.selector);
            await page.goto(server.origin + intel.path);
            await page.locator(intel.selector).first().waitFor();
            await exercise(page, intel, desktop, null, { app: 'intel', profile: 'webkit-desktop', round, cycle: 0 });
            if (services.unexpected.length || services.pageErrors.length) throw new Error(JSON.stringify(services));
            if (round === 0) await page.screenshot({ path: resolve(out, 'webkit-desktop-intel.png') });
            console.log(`webkit Intel round ${round + 1}/${webkitRounds}: passed`);
        } finally { await context.close(); await save(); }
    }
    if (values.trace) {
        // Profiling is a separate replay; its overhead never enters the baseline distributions.
        await browser.close(); browser = await chromium.launch();
        const { context, page, services } = await setup(browser, desktop);
        try {
            await context.addInitScript(observeStartup, intel.selector);
            await page.goto(server.origin + intel.path); await page.locator(intel.selector).first().waitFor();
            const cdp = await context.newCDPSession(page);
            await cdp.send('Tracing.start', { categories: 'devtools.timeline,v8,blink.user_timing,disabled-by-default-v8.cpu_profiler', transferMode: 'ReturnAsStream' });
            await exercise(page, intel, desktop, cdp, { app: 'intel', profile: 'chromium-trace-diagnostic', round: 0, cycle: 0, diagnostic: true });
            const completed = new Promise((done) => cdp.once('Tracing.tracingComplete', done));
            await cdp.send('Tracing.end'); const { stream } = await completed;
            const gzip = createGzip();
            const written = pipeline(gzip, createWriteStream(resolve(out, 'intel-diagnostic.trace.json.gz')));
            try {
                for (;;) {
                    const chunk = await cdp.send('IO.read', { handle: stream });
                    if (!gzip.write(chunk.base64Encoded ? Buffer.from(chunk.data, 'base64') : chunk.data)) await once(gzip, 'drain');
                    if (chunk.eof) break;
                }
            } finally { await cdp.send('IO.close', { handle: stream }); gzip.end(); await written; }
            if (services.unexpected.length || services.pageErrors.length) throw new Error(JSON.stringify(services));
        } finally { await context.close(); }
    }
    if (values['bundle-reports']) {
        report.bundles = await Promise.all(['main', 'intel', 'user-hub'].map(async (name) => JSON.parse(await readFile(resolve(values['bundle-reports'], `${name}.json`), 'utf8'))));
    }
} catch (error) { report.errors.push(String(error.stack || error)); process.exitCode = 1; }
finally { await browser?.close(); await server.close(); await save(); }
if (!report.errors.length) await writeProductionReport(out);
