/* global window, document, requestAnimationFrame, MutationObserver */
import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createMapBrowser } from './lib/map-browser.mjs';

const { values } = parseArgs({ options: {
    baseline: { type: 'string' }, candidate: { type: 'string' },
    rounds: { type: 'string', default: '5' }, cpu: { type: 'string', default: '1' },
    mobile: { type: 'boolean', default: false }, headed: { type: 'boolean', default: false },
    out: { type: 'string', default: '../docs/perf/sidebar-audit/acceptance.json' },
} });
if (!values.baseline || !values.candidate) throw new Error('Provide frozen --baseline and --candidate production directories.');
const rounds = Number(values.rounds), rate = Number(values.cpu);
if (!Number.isInteger(rounds) || rounds < 1 || !Number.isFinite(rate) || rate < 1) throw new Error('Invalid rounds or CPU rate.');
const types = JSON.parse(await readFile(new URL('../src/data/marker/type.json', import.meta.url), 'utf8'));
const expanded = Object.fromEntries([...new Set(Object.values(types).map(type => type.category?.sub).filter(Boolean)), 'version-new'].map(key => [key, true]));
const output = resolve(values.out);
await mkdir(dirname(output), { recursive: true });
const result = { settings: values, resourceMode: 'local assets and API fixtures; fresh context per cold round', runs: [], errors: [] };
const harness = await createMapBrowser({ baseline: values.baseline, candidate: values.candidate, headed: values.headed,
    onError: error => result.errors.push(error) });
try {
    for (let round = 0; round < rounds; round++) for (const variant of ['baseline', 'candidate']) {
        const run = await harness.open(variant, { viewport: values.mobile ? { width: 390, height: 844 } : { width: 1200, height: 762 },
            prefs: { sidebarOpen: true, markFilterExpanded: expanded, desktopDrawerSnapIndex: 0 } });
        const { page, cdp, context } = run;
        try {
            await cdp.send('Emulation.setCPUThrottlingRate', { rate });
            if (values.mobile) {
                const box = await page.locator('[class*="_mobileDrawerHandle_"]').first().boundingBox();
                await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
                await page.mouse.down(); await page.mouse.move(box.x + box.width / 2, 100, { steps: 10 });
                await page.mouse.up(); await page.waitForTimeout(1200);
            }
            await page.evaluate(() => {
                window.__sidebarBench = { frames: [], tasks: [], added: 0, removed: 0, running: false, previous: null, visibilityChanges: 0, focusChanges: 0 };
                document.addEventListener('visibilitychange', () => { if (window.__sidebarBench.running) window.__sidebarBench.visibilityChanges++; });
                window.addEventListener('blur', () => { if (window.__sidebarBench.running) window.__sidebarBench.focusChanges++; });
                new MutationObserver(records => {
                    const sample = window.__sidebarBench;
                    if (sample.running) for (const record of records) { sample.added += record.addedNodes.length; sample.removed += record.removedNodes.length; }
                }).observe(document.querySelector('[data-sidebar-layout]'), { subtree: true, childList: true });
                new PerformanceObserver(list => {
                    if (window.__sidebarBench.running) window.__sidebarBench.tasks.push(...list.getEntries().map(entry => entry.duration));
                }).observe({ type: 'longtask' });
                const frame = time => {
                    const sample = window.__sidebarBench;
                    if (sample.running && sample.previous !== null) sample.frames.push(time - sample.previous);
                    sample.previous = sample.running ? time : null; requestAnimationFrame(frame);
                };
                requestAnimationFrame(frame);
            });
            const snapshot = () => page.evaluate(() => {
                const root = document.querySelector('[data-sidebar-layout]'), scroll = document.querySelector('[data-sidebar-scroll]');
                const images = [...root.querySelectorAll('img')];
                return { total: document.querySelectorAll('*').length, sidebar: root.querySelectorAll('*').length,
                    map: document.querySelector('.oem-canvas-semantics').querySelectorAll('*').length,
                    scrollHeight: scroll.scrollHeight, clientHeight: scroll.clientHeight,
                    ready: images.filter(image => image.complete && image.naturalWidth > 0).length, images: images.length };
            });
            const before = await snapshot();
            const box = await page.locator('[data-sidebar-scroll]').boundingBox();
            await page.mouse.move(box.x + box.width / 2, Math.min(500, box.y + box.height / 2));
            for (const phase of ['cold', 'warm']) {
                if (values.headed) await page.bringToFront();
                await page.evaluate(() => Object.assign(window.__sidebarBench, { frames: [], tasks: [], added: 0, removed: 0, running: true, previous: null, visibilityChanges: 0, focusChanges: 0, startVisibility: document.visibilityState, startFocus: document.hasFocus() }));
                for (const direction of [1, -1]) {
                    for (let step = 0; step < 22; step++) { await page.mouse.wheel(0, 550 * direction); await page.waitForTimeout(16); }
                    await page.waitForTimeout(150);
                }
                const sample = await page.evaluate(() => {
                    const sample = window.__sidebarBench; sample.running = false;
                    const frames = sample.frames.sort((a, b) => a - b);
                    return { p50: frames[Math.floor(frames.length * .5)], p95: frames[Math.floor(frames.length * .95)],
                        max: Math.max(...frames), frames: frames.length, longTasks: sample.tasks, added: sample.added, removed: sample.removed,
                        visibilityChanges: sample.visibilityChanges, focusChanges: sample.focusChanges,
                        environment: { startVisibility: sample.startVisibility, startFocus: sample.startFocus, visibility: document.visibilityState, focused: document.hasFocus(), ua: navigator.userAgent, dpr: window.devicePixelRatio, viewport: [window.innerWidth, window.innerHeight] } };
                });
                const row = { round, variant, phase, before, after: await snapshot(), ...sample };
                result.runs.push(row); console.log(JSON.stringify(row));
            }
            await writeFile(output, JSON.stringify(result, null, 2));
        } finally { await context.close(); }
    }
} finally { await harness.close(); }
