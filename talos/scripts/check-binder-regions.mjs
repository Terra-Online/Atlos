/* global localStorage */
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createMapBrowser } from './lib/map-browser.mjs';
const { values } = parseArgs({ options: {
    build: { type: 'string' }, out: { type: 'string', default: '../docs/perf/webp-decode/binder-regression' },
} });
assert.ok(values.build, 'Provide --build with a frozen main build.');
const out = resolve(values.out); await mkdir(out, { recursive: true });
const types = JSON.parse(await readFile(new URL('../src/data/marker/type.json', import.meta.url), 'utf8'));
const data = new URL('../src/data/marker/data/', import.meta.url);
const collected = (await Promise.all((await readdir(data)).filter(file => file.endsWith('.json')).map(async file =>
    JSON.parse(await readFile(new URL(file, data), 'utf8')).filter(point => types[point[5]]?.category.main === 'files').map(point => String(point[0])),
))).flat();
const errors = [], cases = [];
const harness = await createMapBrowser({ baseline: values.build, candidate: values.build, onError: error => errors.push(error) });
try {
    const { context, page } = await harness.open('candidate', { locale: 'zh-CN', viewport: { width: 1512, height: 982 },
        prefs: { sidebarOpen: true, sidebarWidthV2: 520, markFilterExpanded: { archives: true, collection: true }, prefsHideCompletedMarkers: false } });
    await context.addInitScript(ids => localStorage.setItem('points-storage', JSON.stringify({ state: { activePoints: ids, activeArchives: [], updatedAt: 1 }, version: 0 })), collected);
    await page.reload({ waitUntil: 'domcontentloaded' });
    const category = page.locator('[data-category="archives"]');
    await category.scrollIntoViewIfNeeded();
    await category.locator('[data-binder-wrap]').first().waitFor();
    for (const [index, region] of ['Wuling', 'Valley_4', 'Wuling', 'Valley_4', 'Wuling'].entries()) {
        await page.getByRole('button', { name: region === 'Wuling' ? '武陵' : '四号谷地', exact: true }).click();
        await page.waitForFunction(region => JSON.parse(localStorage.getItem('region-storage')).state.currentRegionKey === region, region);
        await page.mouse.move(1200, 100);
        await page.waitForTimeout(1300);
        await category.scrollIntoViewIfNeeded();
        await page.waitForTimeout(250);
        const geometry = await category.evaluate(element => [...element.querySelectorAll('[data-sidebar-rows]')].flatMap(grid => {
            const top = grid.getBoundingClientRect().top;
            return [...grid.children].map(row => ({ key: row.querySelector('[data-key]')?.getAttribute('data-key'),
                delta: row.getBoundingClientRect().top - top - (row.offsetTop - grid.offsetTop) }));
        }));
        assert.ok(geometry.length > 0, 'The expanded archive must contain measured virtual rows.');
        const shifted = geometry.filter(row => !Number.isFinite(row.delta) || Math.abs(row.delta) > 1);
        cases.push({ region, rows: geometry.length, shifted });
        await page.screenshot({ path: resolve(out, `${index}-${region}.png`) });
        assert.deepEqual(shifted, [], 'Settled virtual rows must occupy their own CSS grid slots.');
    }
    assert.deepEqual(errors, [], 'Page script errors.');
    await context.close();
} finally { await writeFile(resolve(out, 'results.json'), JSON.stringify({ cases, errors }, null, 2)); await harness.close(); }
console.log(JSON.stringify({ cases: cases.length, rows: cases.map(test => test.rows), errors }));
