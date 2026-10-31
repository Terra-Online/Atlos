import { test, expect } from './fixtures.mjs';

test.beforeEach(async ({ page }) => {
    await page.goto('/test-support/browser/index.html');
    await expect(page.locator('[data-fixture="ready"]')).toBeVisible();
});

const size = (drawer) => drawer.evaluate((node) => parseFloat(node.style.getPropertyValue('--drawer-size')));

async function touch(session, type, x, y) {
    await session.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' || type === 'touchCancel' ? [] : [{ x, y, id: 0, radiusX: 1, radiusY: 1, force: 1 }] });
}

test('TEST-BROWSER-DRAWER-001 trusted touch cancellation releases the drag lock when props disable it', async ({ page, context }) => {
    const drawer = page.locator('[data-fixture="drawer"] > div');
    const handle = drawer.getByRole('separator');
    await page.getByRole('button', { name: 'Drawer maximum', exact: true }).click();
    await expect.poll(() => size(drawer)).toBe(300);
    await drawer.scrollIntoViewIfNeeded();
    const box = await drawer.boundingBox();
    const x = box.x + box.width / 2, y = box.y + 40;
    const session = await context.newCDPSession(page);
    await touch(session, 'touchStart', x, y);
    await touch(session, 'touchMove', x, y + 70);
    await expect(handle).toHaveAttribute('data-dragging', 'true');
    // A prop change while the first touch remains down models a parent disabling
    // the control, rather than synthesizing a second finger or a fake pointer.
    await page.getByRole('button', { name: 'Toggle drawer disabled', exact: true }).evaluate((node) => node.click());
    await expect(handle).not.toHaveAttribute('data-dragging');
    await expect(drawer).not.toHaveCSS('touch-action', 'none');
    expect(await drawer.evaluate((node) => node.style.overscrollBehavior)).toBe('');
    await touch(session, 'touchCancel', x, y + 70);
    await page.getByRole('button', { name: 'Toggle drawer disabled', exact: true }).click();
    await page.getByRole('button', { name: 'Drawer minimum', exact: true }).click();
    await expect.poll(() => size(drawer)).toBe(60);
    await session.detach();
});

test('TEST-BROWSER-DRAWER-002 a new trusted drag owns the pose instead of the old snap animation', async ({ page, context }, testInfo) => {
    const drawer = page.locator('[data-fixture="drawer"] > div');
    await page.getByRole('button', { name: 'Drawer maximum', exact: true }).click();
    await expect.poll(() => size(drawer)).toBe(300);
    await drawer.scrollIntoViewIfNeeded();
    const box = await drawer.boundingBox();
    const x = box.x + box.width / 2, y = box.y + 40;
    const session = await context.newCDPSession(page);
    await page.getByRole('button', { name: 'Drawer minimum', exact: true }).evaluate((node) => node.click());
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
    const inFlight = await size(drawer);
    expect(inFlight).toBeGreaterThan(60);
    await touch(session, 'touchStart', x, y);
    await touch(session, 'touchMove', x, y - 40);
    await expect(drawer.getByRole('separator')).toHaveAttribute('data-dragging', 'true');
    const held = await size(drawer);
    const frames = await drawer.evaluate((node) => new Promise((resolve) => {
        const start = performance.now(), samples = [];
        const frame = () => {
            samples.push({ time: performance.now() - start, size: parseFloat(node.style.getPropertyValue('--drawer-size')) });
            if (performance.now() - start < 350) requestAnimationFrame(frame);
            else resolve(samples);
        };
        requestAnimationFrame(frame);
    }));
    await testInfo.attach('held-touch-frames', { body: JSON.stringify({ inFlight, held, frames }, null, 2), contentType: 'application/json' });
    expect(Math.max(...frames.map((frame) => Math.abs(frame.size - held)))).toBeLessThan(1);
    await touch(session, 'touchEnd', x, y - 40);
    await expect(drawer.getByRole('separator')).not.toHaveAttribute('data-dragging');
    await session.detach();
});

test('TEST-BROWSER-DRAWER-003 reversing an accepted drag releases policies when content takes scrolling', async ({ page, context }) => {
    const drawer = page.locator('[data-fixture="drawer"] > div');
    await page.getByRole('button', { name: 'Toggle drawer scrolling', exact: true }).click();
    await page.getByRole('button', { name: 'Drawer maximum', exact: true }).click();
    await expect.poll(() => size(drawer)).toBe(300);
    const surface = page.locator('[data-fixture="scroll-surface"]');
    await surface.scrollIntoViewIfNeeded();
    expect(await surface.evaluate((node) => node.scrollHeight > node.clientHeight && node.scrollTop === 0)).toBe(true);
    const rect = await surface.boundingBox();
    const x = rect.x + rect.width / 2, y = rect.y + 50;
    const session = await context.newCDPSession(page);
    await touch(session, 'touchStart', x, y);
    await touch(session, 'touchMove', x, y + 70);
    await expect(drawer.getByRole('separator')).toHaveAttribute('data-dragging', 'true');
    await touch(session, 'touchMove', x, y - 40);
    await expect(drawer.getByRole('separator')).not.toHaveAttribute('data-dragging');
    await expect(drawer).not.toHaveCSS('touch-action', 'none');
    expect(await drawer.evaluate((node) => node.style.overscrollBehavior)).toBe('');
    const surrendered = await size(drawer);
    await touch(session, 'touchEnd', x, y - 40);
    expect(await size(drawer)).toBe(surrendered);
    await session.detach();
});
