/* global document, localStorage, getComputedStyle */
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { createMapBrowser } from './lib/map-browser.mjs';
const { values } = parseArgs({ options: { baseline: { type: 'string' }, candidate: { type: 'string' }, out: { type: 'string', default: '.cache/sidebar-audit/interaction' }, mobile: { type: 'boolean', default: false } } });
if (!values.baseline || !values.candidate) throw new Error('Provide --baseline and --candidate builds.');
const out = resolve(values.out); await mkdir(out, { recursive: true });
const types = JSON.parse(await readFile(new URL('../src/data/marker/type.json', import.meta.url), 'utf8'));
const expanded = Object.fromEntries([...new Set(Object.values(types).map(type => type.category?.sub).filter(Boolean)), 'version-new'].map(key => [key, true]));
const dataDir = new URL('../src/data/marker/data/', import.meta.url), byType = new Map();
for (const file of (await readdir(dataDir)).filter(file => /^VL_\d+\.json$/.test(file))) {
    for (const point of JSON.parse(await readFile(new URL(file, dataDir), 'utf8'))) {
        if (!byType.has(point[5])) byType.set(point[5], []);
        byType.get(point[5]).push(String(point[0]));
    }
}
const collected = [...byType.values()].flatMap(ids => ids.slice(0, Math.max(1, Math.floor(ids.length / 2))));
const mobile = values.mobile;
const result = { mobile, cases: [], comparisons: [], selection: null, retention: null, layouts: [], consoleIssues: [], errors: [] }, images = new Map();
const harness = await createMapBrowser({ baseline: values.baseline, candidate: values.candidate, onError: error => result.errors.push(error) });
async function openDrawer(page) {
    const box = await page.locator('[class*="_mobileDrawerHandle_"]').first().boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(195, 100, { steps: 10 }); await page.mouse.up(); await page.waitForTimeout(1200);
}
try {
    for (const theme of ['light', 'dark']) for (const variant of ['baseline', 'candidate']) {
        const { page, context } = await harness.open(variant, { viewport: mobile ? { width: 390, height: 844 } : { width: 1200, height: 762 }, prefs: { sidebarOpen: true, sidebarWidthV2: 500, markFilterExpanded: expanded, theme, prefsMarkerProgressEnabled: true } });
        try {
            await page.evaluate(points => localStorage.setItem('points-storage', JSON.stringify({ state: { activePoints: points, activeArchives: [], updatedAt: 1 }, version: 0 })), collected);
            page.on('console', message => {
                if (/flushSync|Maximum update depth|Cannot update a component/.test(message.text())) result.consoleIssues.push(message.text());
            });
            await page.reload({ waitUntil: 'domcontentloaded' });
            if (mobile) await openDrawer(page);
            const item = page.locator('[data-category="collection"] [data-key="aurylene"]');
            await item.waitFor(); await page.waitForTimeout(1000); await page.mouse.move(-10, -10);
            const progress = await item.evaluate(element => ({ value: element.style.getPropertyValue('--progress-percentage'), active: element.dataset.active,
                after: getComputedStyle(element, '::after').clipPath, isolation: getComputedStyle(element).isolation,
                geometry: [...element.children, element.children[1].firstElementChild].map(child => { const root = element.getBoundingClientRect(), rect = child.getBoundingClientRect(); return [rect.x - root.x, rect.y - root.y, rect.width, rect.height]; }) }));
            assert.equal(progress.active, 'true'); assert.ok(parseFloat(progress.value) > 0 && parseFloat(progress.value) < 100);
            // Keep the live settled pose: disabling transitions here can finish a
            // drawer/grid transition after Playwright has chosen the crop rectangle.
            const png = await item.screenshot();
            await writeFile(resolve(out, `${variant}-${theme}-progress.png`), png); images.set(`${variant}-${theme}`, png);
            const binder = page.locator('[data-category="archives"] [data-binder-wrap]').first();
            await binder.scrollIntoViewIfNeeded(); await page.waitForTimeout(500);
            const bounds = await binder.boundingBox();
            await page.screenshot({ path: resolve(out, `${variant}-${theme}-binder.png`), clip: { x: bounds.x, y: Math.max(0, bounds.y), width: bounds.width, height: Math.min(500, page.viewportSize().height - Math.max(0, bounds.y)) }, animations: 'disabled' });
            const scroll = page.locator('[data-sidebar-scroll]');
            await scroll.evaluate(element => { element.scrollTo({ top: 0, behavior: 'instant' }); }); await page.waitForTimeout(250);
            await item.click(); await page.mouse.move(-10, -10); await page.waitForTimeout(500);
            assert.equal(await item.getAttribute('data-active'), 'false');
            await scroll.evaluate(element => { element.scrollTo({ top: element.scrollHeight, behavior: 'instant' }); }); await page.waitForTimeout(250);
            const unmounted = await item.count() === 0;
            if (variant === 'candidate') assert.ok(unmounted, 'Offscreen selector should unmount');
            await scroll.evaluate(element => { element.scrollTo({ top: 0, behavior: 'instant' }); }); await page.waitForTimeout(250);
            assert.equal(await item.getAttribute('data-active'), 'false', 'Deselection must survive remount');
            await item.click(); await page.mouse.move(-10, -10); await page.waitForTimeout(500);
            assert.equal(await item.getAttribute('data-active'), 'true');
            assert.equal(await item.evaluate(element => element.style.getPropertyValue('--progress-percentage')), progress.value);
            result.cases.push({ variant, theme, progress, unmounted });
        } catch (error) {
            await page.screenshot({ path: resolve(out, `${variant}-${theme}-failure.png`) });
            const state = await page.evaluate(() => ({
                snap: document.querySelector('[data-sidebar-layout="mobile"] [data-snap]')?.getAttribute('data-snap'),
                collection: document.querySelector('[data-category="collection"]')?.outerHTML.slice(0, 1800),
                rows: [...document.querySelectorAll('[data-category="collection"] [data-sidebar-rows]')].map(element => ({ html: element.outerHTML.slice(0, 500), rect: element.getBoundingClientRect().toJSON() })),
                count: document.querySelectorAll('[data-mark-selector-item]').length,
            }));
            result.failure = state;
            throw error;
        } finally { await context.close(); }
    }
    for (const theme of ['light', 'dark']) {
        const a = await sharp(images.get(`baseline-${theme}`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        const b = await sharp(images.get(`candidate-${theme}`)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        assert.deepEqual(b.info, a.info, 'Selector geometry must match');
        const reference = result.cases.find(row => row.variant === 'baseline' && row.theme === theme).progress.geometry;
        const candidate = result.cases.find(row => row.variant === 'candidate' && row.theme === theme).progress.geometry;
        reference.forEach((rect, index) => rect.forEach((value, field) => assert.ok(Math.abs(value - candidate[index][field]) <= 1 / 32, 'Card content geometry must match')));
        // Element clips can include one extra CSS pixel on either edge when the
        // sheet has a fractional origin. Internal DOM geometry is checked above;
        // register at most one CSS pixel before comparing the actual artwork.
        const { width, height } = a.info, margin = 2;
        const pixels = (width - margin * 2) * (height - margin * 2);
        let best = { changedPixelsOver8: Infinity, meanMaxChannelDelta: Infinity, dx: 0, dy: 0 };
        for (let dy = -margin; dy <= margin; dy++) for (let dx = -margin; dx <= margin; dx++) {
            let changed = 0, sum = 0;
            for (let y = margin; y < height - margin; y++) for (let x = margin; x < width - margin; x++) {
                const index = (y * width + x) * 4, other = ((y + dy) * width + x + dx) * 4;
                let delta = 0;
                for (let channel = 0; channel < 3; channel++) delta = Math.max(delta, Math.abs(a.data[index + channel] - b.data[other + channel]));
                if (delta > 8) changed++; sum += delta;
            }
            if (changed < best.changedPixelsOver8) best = { changedPixelsOver8: changed, meanMaxChannelDelta: sum / pixels, dx, dy };
        }
        assert.ok(best.changedPixelsOver8 / pixels < .02, `${theme}: progress appearance differs on more than 2% of card pixels`);
        result.comparisons.push({ theme, pixels, ...best });
    }
    if (!mobile) {
    const { page, context } = await harness.open('candidate', { prefs: { sidebarOpen: true, sidebarWidthV2: 350, markFilterExpanded: expanded } });
    try {
        const scroll = page.locator('[data-sidebar-scroll]');
        const initial = await page.evaluate(() => ({ filter: JSON.parse(localStorage.getItem('marker-filter')).state.filter,
            mounted: [...document.querySelectorAll('[data-mark-selector-item]')].map(element => element.getAttribute('data-key')) }));
        const first = await page.locator('[data-category="collection"] [data-mark-selector-item]').first().boundingBox();
        const viewport = await scroll.boundingBox();
        await page.mouse.move(first.x - 5, first.y + 5); await page.mouse.down();
        await page.mouse.move(viewport.x + viewport.width - 8, viewport.y + viewport.height - 4, { steps: 5 });
        await page.waitForTimeout(2600); await page.mouse.up();
        const selection = await page.evaluate(() => ({ filter: JSON.parse(localStorage.getItem('marker-filter')).state.filter,
            top: document.querySelector('[data-sidebar-scroll]').scrollTop }));
        const removed = initial.filter.filter(key => !selection.filter.includes(key));
        result.selection = { autoScrollTop: selection.top, removed: removed.length, initiallyUnmountedRemoved: removed.filter(key => !initial.mounted.includes(key)).length };
        assert.ok(selection.top > 1000, 'Box selection should auto-scroll');
        assert.ok(removed.some(key => !initial.mounted.includes(key)), 'Box selection should reach rows absent at pointerdown');
        const height = await scroll.evaluate(element => element.scrollHeight);
        await scroll.evaluate(element => { element.scrollTo({ top: 0, behavior: 'instant' }); });
        await page.route('**/assets/images/item/*', async route => {
            if (route.request().url().includes('/aurylene.webp')) return route.abort();
            await new Promise(resolve => setTimeout(resolve, 100)); return route.fallback();
        });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.locator('[data-category="collection"]').waitFor();
        await page.waitForTimeout(1200);
        assert.equal(await scroll.evaluate(element => element.scrollHeight), height, 'Failed/delayed images must not change row geometry');
        const counts = [];
        for (let cycle = 0; cycle < 20; cycle++) {
            await scroll.evaluate(element => element.scrollTo({ top: element.scrollHeight, behavior: 'instant' })); await page.waitForTimeout(150);
            await scroll.evaluate(element => element.scrollTo({ top: 0, behavior: 'instant' })); await page.waitForTimeout(150);
            counts.push(await page.locator('[data-sidebar-layout] *').count());
        }
        assert.equal(new Set(counts).size, 1, 'Same-window DOM must not accumulate after 20 round trips');
        result.retention = { cycles: 20, counts };
        result.selection = { autoScrollTop: selection.top, removed: removed.length, initiallyUnmountedRemoved: removed.filter(key => !initial.mounted.includes(key)).length };
    } finally { await context.close(); }
    for (const [columns, width, viewportWidth, locale] of [[2, 350, 1200, 'en-US'], [4, 750, 2800, 'en-US'], [3, 500, 1200, 'zh-CN']]) {
        const { page, context } = await harness.open('candidate', { viewport: { width: viewportWidth, height: 762 }, dpr: 1, locale,
            prefs: { sidebarOpen: true, sidebarWidthV2: width, markFilterExpanded: expanded } });
        try {
            await page.evaluate(() => document.fonts.ready);
            const grid = page.locator('[data-category="collection"] [data-sidebar-rows]');
            const positions = await grid.locator('[data-mark-selector-item]').evaluateAll(elements => elements.slice(0, 4).map(element => element.getBoundingClientRect().y));
            assert.equal(new Set(positions.slice(0, columns)).size, 1, `${columns} columns must share the first row`);
            if (columns === 2) assert.ok(positions[2] > positions[0]);
            const scroll = page.locator('[data-sidebar-scroll]'), height = await scroll.evaluate(element => element.scrollHeight);
            const input = page.locator('[data-sidebar-layout] input').first();
            await input.fill('Aurylene'); await page.waitForTimeout(650);
            const matching = await page.locator('[data-mark-selector-item]').evaluateAll(elements => elements.map(element => element.getAttribute('data-key')));
            assert.ok(matching.length > 0 && matching.every(key => key === 'aurylene'));
            await input.fill('no-matching-type-fixture'); await page.waitForTimeout(650);
            assert.equal(await page.locator('[data-mark-selector-item]').count(), 0);
            await input.fill(''); await page.waitForTimeout(650);
            assert.ok(Math.abs(await scroll.evaluate(element => element.scrollHeight) - height) <= 2);
            const collection = page.locator('[data-category="collection"]');
            await collection.locator('[data-filter-header]').click({ position: { x: 80, y: 20 } }); await page.waitForTimeout(600);
            assert.equal(await collection.locator('[data-mark-selector-item]').count(), 0);
            await collection.locator('[data-filter-header]').click({ position: { x: 80, y: 20 } }); await page.waitForTimeout(600);
            assert.ok(await collection.locator('[data-mark-selector-item]').count() > 0);
            result.layouts.push({ columns, locale, searchAndCollapse: true });
        } finally { await context.close(); }
    }
    } else {
        const { page, context } = await harness.open('candidate', { viewport: { width: 390, height: 844 }, locale: 'zh-CN', prefs: { markFilterExpanded: expanded } });
        try {
            await openDrawer(page);
            await page.evaluate(() => document.fonts.ready);
            const scroll = page.locator('[data-sidebar-scroll]');
            const height = await scroll.evaluate(element => element.scrollHeight);
            const input = page.locator('[data-sidebar-layout] input').first();
            await input.fill('Aurylene'); await page.waitForTimeout(650);
            const matches = await page.locator('[data-mark-selector-item]').evaluateAll(elements => elements.map(element => element.getAttribute('data-key')));
            assert.ok(matches.length > 0 && matches.every(key => key === 'aurylene'));
            await input.fill('no-matching-type-fixture'); await page.waitForTimeout(650);
            assert.equal(await page.locator('[data-mark-selector-item]').count(), 0);
            await input.fill(''); await input.blur(); await page.waitForTimeout(1100);
            assert.ok(Math.abs(await scroll.evaluate(element => element.scrollHeight) - height) <= 2);
            const counts = [];
            for (let cycle = 0; cycle < 20; cycle++) {
                await scroll.evaluate(element => element.scrollTo({ top: element.scrollHeight, behavior: 'instant' })); await page.waitForTimeout(150);
                await scroll.evaluate(element => element.scrollTo({ top: 0, behavior: 'instant' })); await page.waitForTimeout(150);
                counts.push(await page.locator('[data-sidebar-layout] *').count());
            }
            assert.equal(new Set(counts).size, 1, 'Mobile DOM must not accumulate after 20 round trips');
            assert.ok(Math.abs(await scroll.evaluate(element => element.scrollHeight) - height) <= 2);
            result.retention = { cycles: 20, counts, height };
            result.layouts.push({ columns: 2, locale: 'zh-CN', searchAndClear: true });
        } finally { await context.close(); }
    }
    assert.deepEqual(result.consoleIssues, []);
    assert.deepEqual(result.errors, []);
} finally { await writeFile(resolve(out, 'results.json'), JSON.stringify(result, null, 2)); await harness.close(); }
console.log(JSON.stringify(result));
