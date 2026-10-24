/* global window */
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createMapBrowser, exerciseMapInteractions } from './lib/map-browser.mjs';

const { values } = parseArgs({ options: { build: { type: 'string' }, out: { type: 'string', default: '.cache/runtime-perf/interaction-acceptance.json' } } });
if (!values.build) throw new Error('Provide --build with a frozen application build.');
const result = { actions: {}, mobile: {}, errors: [] };
const harness = await createMapBrowser({ baseline: values.build, candidate: values.build, onError: error => result.errors.push(error) });
try {
    const desktop = await harness.open('candidate');
    try {
        let seed = 20261024;
        const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
        for (let i = 0; i < 5; i++) await exerciseMapInteractions(desktop.page, { random,
            record: name => { result.actions[name] = (result.actions[name] ?? 0) + 1; } });
    } finally { await desktop.context.close(); }

    const mobile = await harness.open('candidate', { viewport: { width: 390, height: 844 } });
    try {
        const page = mobile.page;
        const handle = page.locator('[class*="_mobileDrawerHandle_"]').first();
        const before = await handle.boundingBox();
        await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
        await page.mouse.down(); await page.mouse.move(190, 180, { steps: 10 }); await page.mouse.up();
        await page.waitForTimeout(650);
        const after = await handle.boundingBox();
        assert.ok(after.y < before.y - 200, 'The drawer must open after dragging its handle.');
        const divider = page.locator('[class*="_divider_"]').first();
        const box = await divider.boundingBox();
        assert.ok(box && box.width > 0, 'The top-row divider must be available.');
        await page.evaluate(() => {
            const add = window.addEventListener, remove = window.removeEventListener;
            window.__dragAudit = [];
            window.addEventListener = function(type, listener, options) {
                if (['pointermove', 'pointerup', 'pointercancel'].includes(type)) window.__dragAudit.push({ type, listener, removed: false });
                return add.call(this, type, listener, options);
            };
            window.removeEventListener = function(type, listener, options) {
                for (const row of window.__dragAudit) if (row.type === type && row.listener === listener) row.removed = true;
                return remove.call(this, type, listener, options);
            };
        });
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await page.mouse.move(Math.min(380, box.x + 35), box.y + box.height / 2);
        await page.setViewportSize({ width: 1200, height: 762 });
        await page.waitForTimeout(300);
        const audit = await page.evaluate(() => window.__dragAudit.map(({ type, removed }) => ({ type, removed })));
        assert.ok(audit.length >= 3, 'The gesture must install its move/end/cancel listeners.');
        assert.ok(audit.every(row => row.removed), 'Changing layout must release the active gesture listeners.');
        await page.mouse.up();
        result.mobile = { drawerMoved: before.y - after.y, responsiveDragCleanup: audit };
    } finally { await mobile.context.close(); }
    assert.equal(result.errors.length, 0, 'Interaction replay must not raise page script errors.');
    result.finishedAt = new Date().toISOString();
    await mkdir(dirname(resolve(values.out)), { recursive: true });
    await writeFile(resolve(values.out), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
} finally { await harness.close(); }
