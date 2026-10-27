import { test, expect, browserUser } from './fixtures.mjs';

async function attachment(page, testInfo, name) {
    await testInfo.attach(name, { body: await page.screenshot(), contentType: 'image/png' });
}

test('TEST-BROWSER-MOBILE-MAP-001 search expands the drawer and Enter preserves the current document', async ({ page }, testInfo) => {
    await page.goto('/');
    const sidebar = page.locator('[data-sidebar-layout="mobile"]');
    // The mobile shell contains a fixed drawer and intentionally has zero
    // height itself. Assert the actual visible controls, not its wrapper box.
    await expect(sidebar).toHaveAttribute('aria-hidden', 'false');
    await expect(page.locator('[data-sidebar-layout="desktop"]')).toHaveCount(0);
    const drawer = sidebar.locator('[data-font-region="drawer"]').first();
    await expect(drawer).toHaveAttribute('data-snap', '0');
    const before = await drawer.boundingBox();
    const search = page.locator('[data-search-input="true"]');
    await expect(search).toBeVisible();
    await search.tap();
    await search.fill('Control Nexus');
    await expect(page.locator('form button').filter({ hasText: 'Control Nexus' })).toHaveCount(1);
    await expect.poll(async () => (await drawer.boundingBox()).height).toBeGreaterThan(before.height + 100);
    const token = await page.evaluate(() => { window.__mobileDocumentToken = Math.random(); return window.__mobileDocumentToken; });
    await search.press('Enter');
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    await expect(search).toHaveValue('Control Nexus');
    expect(await page.evaluate(() => window.__mobileDocumentToken)).toBe(token);
    await page.locator('form button').filter({ hasText: 'Control Nexus' }).tap();
    await expect(page.locator('[data-font-region="detail"][data-state="open"]')).toBeVisible();
    const width = await page.evaluate(() => ({ layout: document.documentElement.scrollWidth, viewport: innerWidth }));
    expect(width.layout).toBeLessThanOrEqual(width.viewport + 1);
    await attachment(page, testInfo, 'mobile-map-detail');
});

test('TEST-BROWSER-MOBILE-HEADBAR-001 expanded header opens language modal and returns to the map', async ({ page }, testInfo) => {
    await page.goto('/');
    await expect(page.locator('[data-search-input="true"]')).toBeVisible();
    const header = page.locator('[data-guide="headbar"]');
    await header.locator('button').first().tap();
    await page.getByRole('button', { name: 'Choose language', exact: true }).tap();
    const modal = page.getByRole('dialog', { name: 'language', exact: true });
    await expect(modal).toBeVisible();
    await expect(modal.getByRole('radio', { name: 'English', exact: true })).toHaveAttribute('aria-checked', 'true');
    const box = await modal.boundingBox();
    expect(box.width).toBeLessThanOrEqual(390);
    expect(box.x).toBeGreaterThanOrEqual(0);
    await attachment(page, testInfo, 'mobile-language-modal');
    await modal.getByRole('button', { name: 'Close', exact: true }).tap();
    await expect(modal).toHaveCount(0);
    await expect(page.locator('[data-search-input="true"]')).toBeVisible();
});

test('TEST-BROWSER-MOBILE-INTEL-001 responsive archive cards collect through touch and retain local progress', async ({ page }, testInfo) => {
    await page.goto('/intel/?type=nar_sm1l5m1_1');
    const card = page.locator('[data-intel-archive="nar_sm1l5m1_1"]');
    await expect(card).toBeVisible();
    const id = await card.getAttribute('data-intel-archive');
    await card.tap();
    await expect(card).toHaveAttribute('aria-pressed', 'true');
    await attachment(page, testInfo, 'mobile-intel-collected');
    await page.reload();
    // The app's type-target navigation scrolls to the restored collected bucket;
    // its virtual placeholder may be replaced during that native smooth scroll.
    const restored = page.locator(`article[data-intel-archive="${id}"]`);
    await expect(restored).toBeVisible();
    await expect(restored).toHaveAttribute('aria-pressed', 'true');
    await restored.tap();
    await expect(restored).toHaveAttribute('data-collected', 'false');
    await expect(restored).not.toHaveAttribute('data-collection-transition', 'uncollect');
    const width = await page.evaluate(() => ({ layout: document.documentElement.scrollWidth, viewport: innerWidth }));
    expect(width.layout).toBeLessThanOrEqual(width.viewport + 1);
});

test('TEST-BROWSER-MOBILE-HUB-001 content and profile navigation stays usable in a narrow viewport', async ({ page, services }, testInfo) => {
    services.user = { ...browserUser };
    services.contributions.set('image:', { items: [], nextCursor: null });
    await page.goto('/me/');
    await expect(page.getByText('Browser reader', { exact: true })).toBeVisible();
    await page.locator('nav[aria-label] a[href="/me/profile"]').tap();
    await expect(page).toHaveURL(/\/me\/profile$/);
    await page.getByRole('radio', { name: 'Avatar 2', exact: true }).check();
    await expect.poll(() => services.user.avatar).toBe(2);
    await attachment(page, testInfo, 'mobile-hub-profile');
    await page.locator('nav[aria-label] a[href="/me/content"]').tap();
    await expect(page.getByText('No contributions yet.', { exact: true })).toBeVisible();
    const width = await page.evaluate(() => ({ layout: document.documentElement.scrollWidth, viewport: innerWidth }));
    expect(width.layout).toBeLessThanOrEqual(width.viewport + 1);
});
