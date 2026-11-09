/* global document, getComputedStyle */
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createMapBrowser } from './lib/map-browser.mjs';
const { values } = parseArgs({ options: { baseline: { type: 'string' }, candidate: { type: 'string' }, out: { type: 'string', default: '../docs/perf/sidebar-audit/mask' } } });
if (!values.baseline || !values.candidate) throw new Error('Provide --baseline and --candidate builds.');
const out = resolve(values.out); await mkdir(out, { recursive: true });
const types = JSON.parse(await readFile(new URL('../src/data/marker/type.json', import.meta.url), 'utf8'));
const expanded = Object.fromEntries([...new Set(Object.values(types).map(type => type.category?.sub).filter(Boolean))].map(key => [key, true]));
const result = { cases: [], errors: [] };
const harness = await createMapBrowser({ baseline: values.baseline, candidate: values.candidate, onError: error => result.errors.push(error) });
try {
    for (const [variant, performanceMode] of [['baseline', false], ['candidate', false], ['candidate', true]]) {
        const { page, context } = await harness.open(variant, { viewport: { width: 390, height: 844 }, prefs: { prefsPerformanceModeEnabled: performanceMode, markFilterExpanded: expanded } });
        try {
            const handle = await page.locator('[class*="_mobileDrawerHandle_"]').first().boundingBox();
            await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down();
            await page.mouse.move(195, 100, { steps: 10 }); await page.mouse.up(); await page.waitForTimeout(1200);
            const divider = page.locator('[data-sidebar-layout="mobile"] [role="separator"][aria-orientation="vertical"]'), box = await divider.boundingBox();
            await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
            await page.mouse.move(box.x - 180, box.y + box.height / 2, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(500);
            const row = page.locator('[class*="_topRow_"]'), before = await row.boundingBox();
            await page.locator('[data-sidebar-scroll]').evaluate(element => element.scrollTo({ top: 1000, behavior: 'instant' })); await page.waitForTimeout(500);
            const state = await row.evaluate(element => {
                const masks = [];
                for (let parent = element; parent; parent = parent.parentElement) if (getComputedStyle(parent).maskImage !== 'none') masks.push(parent.className);
                const category = document.querySelector('[data-category="archives"]');
                let categoryMasked = false;
                for (let parent = category; parent; parent = parent.parentElement) if (getComputedStyle(parent).maskImage !== 'none') categoryMasked = true;
                const divider = element.querySelector('[role="separator"]'), rect = divider.getBoundingClientRect();
                return { masks, categoryMasked, rowZ: getComputedStyle(element).zIndex,
                    dividerHit: document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === divider,
                    hasMarkerList: !!element.querySelector('[class*="_mainFilterList_"]') };
            });
            const after = await row.boundingBox();
            assert.ok(Math.abs(before.y - after.y) <= 1, 'Controls stay pinned while categories scroll');
            if (variant === 'candidate') {
                assert.deepEqual(state.masks, [], 'The sticky controls must not have a masked ancestor');
                assert.ok(state.dividerHit); assert.ok(state.hasMarkerList);
                assert.equal(state.categoryMasked, performanceMode);
            }
            await page.screenshot({ path: resolve(out, `${variant}-${performanceMode ? 'performance' : 'normal'}.png`) });
            result.cases.push({ variant, performanceMode, before, after, ...state });
        } finally { await context.close(); }
    }
    const a = result.cases[0].after, b = result.cases[1].after;
    for (const key of ['x', 'y', 'width', 'height']) assert.ok(Math.abs(a[key] - b[key]) <= 2, `Normal-mode ${key} must match baseline`);
    assert.deepEqual(result.errors, []);
} finally { await writeFile(resolve(out, 'results.json'), JSON.stringify(result, null, 2)); await harness.close(); }
console.log(JSON.stringify(result));
