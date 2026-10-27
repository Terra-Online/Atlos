import { readFileSync } from 'node:fs';
import { test, expect, browserUser } from './fixtures.mjs';

const types = JSON.parse(readFileSync(new URL('../../src/data/marker/type.json', import.meta.url), 'utf8'));
const lookup = JSON.parse(readFileSync(new URL('../../src/data/marker/lookup.json', import.meta.url), 'utf8'));
// Match the walkthrough's existing first boss category using the actual dataset.
const firstType = Object.values(types).find((type) => type.category.sub === 'boss').key;
const demoBoss = lookup.firstTypes[firstType];
const saved = { activePoints: ['9800000003'], activeArchives: [], updatedAt: 1_760_000_000_000 };
const tooltip = (page, index) => page.locator(`#react-joyride-step-${index} [class*="_container_"]`);
const currentTooltip = (page) => page.locator('[id^="react-joyride-step-"]').filter({ has: page.locator('button[data-type="next"]') });
const spotlight = (page) => page.locator('[class*="spotlightBox"]');
const syncWrites = (services) => services.requests.filter((request) => request.method === 'POST' && /^\/progress\/v1\/(archive\/)?sync$/.test(request.path));

async function progress(page) {
    return page.evaluate(async () => {
        // Observe the running app's stores, including the current Vite HMR URL.
        // These imports never dispatch a guide action or mutate application state.
        const loaded = (path) => {
            const entry = performance.getEntriesByType('resource').findLast((resource) => new URL(resource.name).pathname === path);
            if (!entry) throw new Error(`App module was not loaded: ${path}`);
            return entry.name;
        };
        const { useUserRecordStore } = await import(loaded('/src/store/userRecord.ts'));
        const { useHistoryStore } = await import(loaded('/src/store/history.ts'));
        const { getDisplayedPointProgress } = await import(loaded('/src/store/guideProgress.ts'));
        const state = useUserRecordStore.getState();
        const history = useHistoryStore.getState();
        return {
            real: {
                activePoints: state.activePoints,
                activeArchives: state.activeArchives,
                updatedAt: state.updatedAt,
                storage: localStorage.getItem('points-storage'),
                // Selecting a guide filter legitimately creates filter history;
                // completing/clearing its demonstration must not create progress history.
                past: history.past.filter((entry) => !('kind' in entry)),
                future: history.future.filter((entry) => !('kind' in entry)),
            },
            displayed: getDisplayedPointProgress(),
        };
    });
}

async function openHelp(page, mobile) {
    const header = page.locator('[data-guide="headbar"]');
    if (mobile && (await header.getAttribute('class'))?.includes('collapsed')) {
        await header.locator('button').first().tap();
        await expect(header).toHaveClass(/expanded/);
    }
    const help = page.locator('[data-guide="help"]');
    await expect(help).toBeVisible();
    if (mobile) await help.tap();
    else await help.click();
    await expect(tooltip(page, 0)).toBeVisible();
}

async function atStep(page, index, selector) {
    await expect(tooltip(page, index)).toBeVisible();
    const target = page.locator(selector).first();
    await expect(target).toBeVisible();
    await expect(target).toBeInViewport();
    // The custom spotlight follows live layout every frame and animates its box.
    // Poll its measured geometry, not the CSS duration or just an inline style.
    await expect.poll(async () => {
        const [actual, expected] = await Promise.all([spotlight(page).boundingBox(), target.boundingBox()]);
        if (!actual || !expected) return Infinity;
        return Math.max(Math.abs(actual.x - (expected.x - 10)), Math.abs(actual.y - (expected.y - 10)),
            Math.abs(actual.width - (expected.width + 20)), Math.abs(actual.height - (expected.height + 20)));
    }).toBeLessThan(2);
}

async function next(page, index) {
    await tooltip(page, index).locator('button[data-type="next"]').click();
}

async function sampleSpotlight(page, active) {
    return page.evaluate((start) => {
        if (!start) {
            window.__guideFrames.active = false;
            return window.__guideFrames.frames;
        }
        window.__guideFrames = { active: true, frames: [] };
        const sample = () => {
            const box = document.querySelector('[class*="spotlightBox"]')?.getBoundingClientRect();
            window.__guideFrames.frames.push({ time: performance.now(), box: box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null });
            if (window.__guideFrames.active) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
        return [];
    }, active);
}

test('TEST-BROWSER-GUIDE-001 real Help/Joyride navigation owns its targets and preserves saved progress', async ({ page, context, services }, testInfo) => {
    test.setTimeout(90_000);
    const mobile = testInfo.project.name.endsWith('-mobile');
    services.user = { ...browserUser };
    services.points = new Set(saved.activePoints);
    await context.addInitScript((state) => {
        if (location.origin !== 'null') localStorage.setItem('points-storage', JSON.stringify({ state, version: 0 }));
    }, saved);
    await page.goto('/');
    await expect(page.locator('[data-search-input="true"]')).toBeVisible();
    await expect.poll(() => services.requests.filter((request) => request.method === 'GET' && request.path === '/progress/v1/state').length).toBeGreaterThan(0);
    const before = await progress(page);
    expect(before.real.activePoints).toEqual(saved.activePoints);
    expect(before.real.activeArchives).toEqual(saved.activeArchives);
    expect(before.real.updatedAt).toBe(saved.updatedAt);
    expect(before.displayed).not.toContain(demoBoss);
    const writesBefore = syncWrites(services);
    await openHelp(page, mobile);
    await atStep(page, 0, mobile ? '[data-guide="headbar"]' : '[class*="sidebarToggle"]');

    // Use the actual buttons while the first delayed transition is in flight.
    // No Joyride/store substitute is installed by this browser fixture.
    await next(page, 0);
    await currentTooltip(page).getByRole('button', { name: 'Skip', exact: true }).click();
    await expect(currentTooltip(page)).toHaveCount(0);
    await openHelp(page, mobile);
    const restartFrames = await page.evaluate(() => new Promise((resolve) => {
        const until = performance.now() + 800;
        const ids = [];
        const sample = () => {
            const next = document.querySelector('[id^="react-joyride-step-"] button[data-type="next"]');
            ids.push({ time: performance.now(), id: next?.closest('[id^="react-joyride-step-"]')?.id ?? null });
            if (performance.now() < until) requestAnimationFrame(sample);
            else resolve(ids);
        };
        requestAnimationFrame(sample);
    }));
    expect(restartFrames.filter((frame) => frame.id !== null).every((frame) => frame.id === 'react-joyride-step-0')).toBe(true);
    await atStep(page, 0, mobile ? '[data-guide="headbar"]' : '[class*="sidebarToggle"]');
    await testInfo.attach('guide-reopen-native-frames', { body: JSON.stringify(restartFrames, null, 2), contentType: 'application/json' });

    if (mobile) {
        // The desktop path below covers the batch demo. This mobile path records
        // the native compact header, force expansion and real Joyride measurement.
        await next(page, 0);
        await atStep(page, 1, '[data-guide="auth"]');
        expect((await progress(page)).real).toEqual(before.real);
        await testInfo.attach('mobile-guide-header-target', { body: await page.screenshot(), contentType: 'image/png' });
        await currentTooltip(page).getByRole('button', { name: 'Skip', exact: true }).click();
        await expect(currentTooltip(page)).toHaveCount(0);
        expect((await progress(page)).real).toEqual(before.real);
        expect(syncWrites(services)).toEqual(writesBefore);
        return;
    }

    await next(page, 0);
    await atStep(page, 1, '[class*="searchContainer"]');
    await sampleSpotlight(page, true);
    await next(page, 1);
    await atStep(page, 2, '[data-category="boss"]');
    const frames = await sampleSpotlight(page, false);
    const measured = frames.filter((frame) => frame.box !== null);
    expect(measured.length).toBeGreaterThan(2);
    const first = measured[0].box;
    const last = measured.at(-1).box;
    expect(measured.some(({ box }) => ['x', 'y', 'width', 'height'].some((axis) => Math.abs(first[axis] - last[axis]) > 4
        && box[axis] > Math.min(first[axis], last[axis]) + 1 && box[axis] < Math.max(first[axis], last[axis]) - 1))).toBe(true);
    await testInfo.attach('guide-scroll-and-spotlight-frames', { body: JSON.stringify(frames, null, 2), contentType: 'application/json' });
    await next(page, 2);
    await atStep(page, 3, '[data-category="boss"] [class*="filterIcon"]');
    await next(page, 3);
    await atStep(page, 4, `[data-key="${firstType}"]`);
    await next(page, 4);
    await atStep(page, 5, `[data-key="${firstType}"]`);
    await next(page, 5);
    await atStep(page, 6, '[class*="triggerDrawerHandle"]');
    const completed = await progress(page);
    expect(completed.real).toEqual(before.real);
    expect(completed.displayed).toContain(demoBoss);
    await testInfo.attach('guide-demo-completed', { body: await page.screenshot(), contentType: 'image/png' });
    await next(page, 6);
    await atStep(page, 7, '[class*="triggerButton"]');
    const cleared = await progress(page);
    expect(cleared.real).toEqual(before.real);
    expect(cleared.displayed).not.toContain(demoBoss);
    expect(cleared.displayed).toContain('9800000003');
    await testInfo.attach('guide-demo-cleared', { body: await page.screenshot(), contentType: 'image/png' });
    await currentTooltip(page).getByRole('button', { name: 'Skip', exact: true }).click();
    await expect(currentTooltip(page)).toHaveCount(0);
    const after = await progress(page);
    expect(after.real).toEqual(before.real);
    expect(after.displayed).toEqual(before.displayed);
    expect(syncWrites(services)).toEqual(writesBefore);
    expect([...services.points]).toEqual(saved.activePoints);
    await testInfo.attach('guide-progress-boundaries', { body: JSON.stringify({ firstType, before, completed, cleared, after, syncWrites: syncWrites(services) }, null, 2), contentType: 'application/json' });
});
