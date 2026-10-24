/* global window, document, createImageBitmap, Image, HTMLImageElement, innerWidth, innerHeight, getComputedStyle */
import { parseArgs } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Buffer } from 'node:buffer';
import { createMapBrowser } from './lib/map-browser.mjs';

const { values } = parseArgs({ options: {
    baseline: { type: 'string' }, candidate: { type: 'string' },
    out: { type: 'string', default: '.cache/runtime-perf/visual-acceptance' },
    view: { type: 'string' },
} });
if (!values.baseline || !values.candidate) throw new Error('Provide two frozen build directories.');
const out = resolve(values.out);
await mkdir(out, { recursive: true });
const result = { cases: [], comparisons: [], errors: [] };
const harness = await createMapBrowser({ baseline: values.baseline, candidate: values.candidate,
    onError: error => result.errors.push(error) });
const captures = new Map();
const views = [
    { name: 'desktop-light', width: 1200, height: 762, theme: 'light' },
    { name: 'desktop-dark', width: 1200, height: 762, theme: 'dark' },
    { name: 'mobile-light', width: 390, height: 844, theme: 'light' },
    { name: 'mobile-dark', width: 390, height: 844, theme: 'dark' },
];
async function capture(page, variant, view, state) {
    const key = `${view}-${state}`;
    const unavailableAssets = await page.evaluate(async () => {
        const sources = new Set();
        for (const element of document.querySelectorAll('img, [class*="_mainFilterContentItem_"]')) {
            const rect = element.getBoundingClientRect();
            if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= innerWidth || rect.top >= innerHeight) continue;
            const source = element instanceof HTMLImageElement ? element.currentSrc : /url\(["']?(.*?)["']?\)/.exec(getComputedStyle(element).backgroundImage)?.[1];
            if (source) sources.add(source);
        }
        const settled = await Promise.allSettled([...sources].map(async source => { const image = new Image(); image.src = source; await image.decode(); }));
        return [...sources].filter((source, index) => settled[index].status === 'rejected');
    });
    if (state === 'closed' || state === 'drawer-open') for (let i = 0; i < 3; i++) {
        // ResizeObserver delivery follows real layout, while Motion uses the JS
        // clock. Settle both before comparing masks and shadows at rest.
        await page.waitForTimeout(80);
        await page.clock.runFor(500);
        await page.evaluate(() => {
            for (const animation of document.getAnimations()) {
                if (animation.constructor.name === 'CSSTransition') animation.finish();
            }
        });
    }
    const geometry = await page.evaluate(() => {
        const names = ['switchArea', 'mainFilterList', 'scaleContainer', 'sidebarToggle', 'mobileDrawerHandle', 'topRow'];
        return Object.fromEntries(names.map(name => {
            const element = document.querySelector(`[class*="_${name}_"]`);
            if (!element) return [name, null];
            const { x, y, width, height } = element.getBoundingClientRect();
            return [name, { x, y, width, height }];
        }));
    });
    const styles = await page.evaluate(() => {
        const fields = {
            search: ['boxShadow', 'backgroundColor', 'borderRadius', 'filter', 'opacity'],
            mask: ['maskImage', '--leftFade', '--rightFade'],
        };
        return Object.fromEntries(Object.entries(fields).map(([name, properties]) => {
            const element = document.querySelector(name === 'search' ? '[class*="_searchInputWrapper_"]' : '[class*="_mainFilterContentContainer_"]');
            const rect = element?.getBoundingClientRect();
            const visible = rect && rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.left < innerWidth && rect.bottom > 0 && rect.top < innerHeight;
            const style = visible && getComputedStyle(element);
            return [name, style ? Object.fromEntries(properties.map(property => [property, property.startsWith('--') ? style.getPropertyValue(property) : style[property]])) : null];
        }));
    });
    const png = await page.screenshot({ animations: state === 'closed' || state === 'drawer-open' ? 'disabled' : 'allow' });
    await writeFile(resolve(out, `${variant}-${key}.png`), png);
    captures.set(`${variant}-${key}`, { png: png.toString('base64'), geometry, styles, unavailableAssets });
    result.cases.push({ variant, key, geometry, styles, unavailableAssets });
}
async function beginToggle(page) {
    await page.evaluate(() => {
        for (const animation of window.__visualTransitions ?? []) animation.cancel();
        document.querySelector('button[class*="sidebarToggle"]').click();
    });
    // Let React commit the new classes before collecting their transitions.
    await page.clock.runFor(0);
    await page.evaluate(() => {
        // CSS transitions use the compositor clock; freeze them independently of
        // the JS clock so corresponding camera and UI poses can be compared.
        window.__visualTransitions = document.getAnimations().filter(animation => animation.constructor.name === 'CSSTransition');
        for (const animation of window.__visualTransitions) { animation.pause(); animation.currentTime = 0; }
    });
}
async function pose(page, elapsed, previous) {
    await page.clock.runFor(elapsed - previous);
    await page.evaluate(time => {
        for (const animation of window.__visualTransitions ?? []) animation.currentTime = time;
    }, elapsed);
}
try {
    for (const view of views.filter(view => !values.view || view.name === values.view)) {
        for (const variant of ['baseline', 'candidate']) {
            const run = await harness.open(variant, { viewport: { width: view.width, height: view.height },
                prefs: { theme: view.theme }, manualClock: true });
            try {
                const page = run.page;
                await page.mouse.move(-10, -10);
                await capture(page, variant, view.name, 'closed');
                if (view.width > 768) {
                    await beginToggle(page);
                    let previous = 0;
                    for (const time of [80, 160, 240, 560]) {
                        await pose(page, time, previous); previous = time;
                        await capture(page, variant, view.name, `opening-${time}`);
                    }
                    await beginToggle(page); previous = 0;
                    for (const time of [160, 560]) {
                        await pose(page, time, previous); previous = time;
                        await capture(page, variant, view.name, `closing-${time}`);
                    }
                } else {
                    const handle = page.locator('[class*="_mobileDrawerHandle_"]').first();
                    const box = await handle.boundingBox();
                    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
                    await page.mouse.down();
                    await page.mouse.move(box.x + box.width / 2, 180, { steps: 10 });
                    await page.mouse.up();
                    await page.clock.runFor(1200);
                    await page.mouse.move(-10, -10);
                    await capture(page, variant, view.name, 'drawer-open');
                }
                console.log(JSON.stringify({ variant, view: view.name, captured: true }));
            } finally { await run.context.close(); }
        }
    }
    const reader = await harness.browser.newPage();
    for (const [name, baseline] of captures) {
        if (!name.startsWith('baseline-')) continue;
        const key = name.slice('baseline-'.length), candidate = captures.get(`candidate-${key}`);
        const pixels = await reader.evaluate(async ([a, b]) => {
            const images = await Promise.all([a, b].map(async data => createImageBitmap(await (await fetch(`data:image/png;base64,${data}`)).blob())));
            const canvas = document.createElement('canvas'); canvas.width = images[0].width; canvas.height = images[0].height;
            const ctx = canvas.getContext('2d');
            const data = images.map(image => { ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0);
                return ctx.getImageData(0, 0, canvas.width, canvas.height).data; });
            const diff = ctx.createImageData(canvas.width, canvas.height);
            let changed = 0, over1 = 0, max = 0;
            for (let i = 0; i < data[0].length; i += 4) {
                let delta = 0;
                for (let channel = 0; channel < 4; channel++) delta = Math.max(delta, Math.abs(data[0][i + channel] - data[1][i + channel]));
                if (delta) changed++;
                if (delta > 1) over1++;
                max = Math.max(max, delta);
                diff.data[i] = delta ? 255 : 0; diff.data[i + 3] = 255;
            }
            ctx.putImageData(diff, 0, 0);
            return { changed, over1, max, pixels: canvas.width * canvas.height, diff: canvas.toDataURL().split(',')[1] };
        }, [baseline.png, candidate.png]);
        let maxGeometryDelta = 0;
        for (const [name, rect] of Object.entries(baseline.geometry)) {
            const next = candidate.geometry[name];
            if (Boolean(rect) !== Boolean(next)) { maxGeometryDelta = Infinity; continue; }
            if (rect) for (const field of ['x', 'y', 'width', 'height']) maxGeometryDelta = Math.max(maxGeometryDelta, Math.abs(rect[field] - next[field]));
        }
        if (pixels.changed) await writeFile(resolve(out, `diff-${key}.png`), Buffer.from(pixels.diff, 'base64'));
        delete pixels.diff;
        const row = { key, ...pixels, maxGeometryDelta, styleEqual: JSON.stringify(baseline.styles) === JSON.stringify(candidate.styles),
            assetParity: JSON.stringify([...baseline.unavailableAssets].sort()) === JSON.stringify([...candidate.unavailableAssets].sort()),
            exact: pixels.changed === 0 && maxGeometryDelta === 0 };
        result.comparisons.push(row); console.log(JSON.stringify(row));
    }
    result.finishedAt = new Date().toISOString();
    await writeFile(resolve(out, 'results.json'), JSON.stringify(result, null, 2));
    if (result.errors.length) throw new Error('Page errors during visual replay.');
    if (result.comparisons.some(row => row.maxGeometryDelta > 1 / 64 || !row.styleEqual || !row.assetParity)) {
        throw new Error('Geometry, styles or asset availability changed; inspect the saved comparisons.');
    }
} finally { await harness.close(); }
