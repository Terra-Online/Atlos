import { test, expect, browserUser } from './fixtures.mjs';
import { contributionRoute } from './hub.mjs';

const detail = (page) => page.locator('[data-font-region="detail"][data-state="open"]');
const storage = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('points-storage')).state.activePoints);

test('TEST-PRODUCTION-MAP-001 built search, lazy detail, collection and Enter preserve the document', async ({ page }, info) => {
    await page.goto('/');
    const search = page.locator('[data-search-input="true"]');
    await expect(search).toBeVisible();
    await search.fill('Control Nexus');
    const result = page.locator('form button').filter({ hasText: 'Control Nexus' });
    await expect(result).toHaveCount(1);
    await result.evaluate((node) => node.scrollIntoView({ behavior: 'instant', block: 'center' }));
    await result.click();
    await expect(detail(page)).toBeVisible();
    await expect(detail(page)).toContainText('Control Nexus');
    const token = await page.evaluate(() => { window.__productionDocument = Math.random(); return window.__productionDocument; });
    await search.press('Enter');
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    expect(await page.evaluate(() => window.__productionDocument)).toBe(token);
    await expect(search).toHaveValue('Control Nexus');
    await expect(detail(page)).toBeVisible();
    await detail(page).locator('img').first().locator('..').click();
    await expect.poll(() => storage(page)).toContain('9800000003');
    await page.reload();
    await expect(search).toBeVisible();
    expect(await storage(page)).toContain('9800000003');
    await info.attach('production-main', { body: await page.screenshot(), contentType: 'image/png' });
});

test('TEST-PRODUCTION-CROSS-APP-001 built Intel shares progress with an open built map', async ({ page, context }, info) => {
    await page.goto('/');
    const search = page.locator('[data-search-input="true"]');
    await search.fill('nar_col_lv003_1');
    const result = page.locator('form button').filter({ hasText: 'Letter from Valley IV' });
    await expect(result).toHaveCount(1);
    await result.evaluate((node) => node.scrollIntoView({ behavior: 'instant', block: 'center' }));
    await result.click();
    await expect(detail(page)).toBeVisible();
    const artwork = detail(page).locator('img').first().locator('..');
    await artwork.click();
    await expect.poll(() => storage(page)).toContain('300030037');
    const intel = await context.newPage();
    await intel.goto('/intel/?type=nar_col_lv003_1');
    const card = intel.locator('article[data-intel-archive="nar_col_lv003_1"]');
    await expect(card).toHaveAttribute('aria-pressed', 'true');
    await card.click();
    await expect(card).toHaveAttribute('aria-pressed', 'false');
    // This checks the live map UI as well as persisted data, without importing
    // source modules or adding debug exports to a production bundle.
    await expect(artwork).not.toHaveClass(/collected/);
    expect(await storage(page)).not.toContain('300030037');
    await artwork.click();
    await expect(card).toHaveAttribute('aria-pressed', 'true');
    await info.attach('production-cross-app', { body: await intel.screenshot(), contentType: 'image/png' });
});

test('TEST-PRODUCTION-HUB-001 built hub deep routes, auth chunk, locale and profile work', async ({ page, services }, info) => {
    await page.goto('/me/profile');
    await expect(page.locator('#access-email')).toBeVisible();
    const signIn = page.getByRole('button', { name: 'Sign in here.', exact: true });
    if (await signIn.isVisible()) await signIn.click();
    await page.locator('#access-email').fill(browserUser.email);
    await page.locator('#access-password').fill('BrowserPassword123');
    await page.locator('#access-password').press('Tab');
    await expect(page.locator('input[name="avatar"][value="2"]')).toBeVisible();
    await page.locator('input[name="avatar"][value="2"]').check();
    await expect.poll(() => services.user.avatar).toBe(2);
    await page.getByRole('button', { name: 'Choose language', exact: true }).click();
    await page.getByRole('radio', { name: 'Japanese', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja-JP');
    await page.keyboard.press('Escape');
    await page.reload();
    await expect(page).toHaveURL(/\/me\/profile$/);
    await expect(page.locator('input[name="avatar"][value="2"]')).toBeChecked();
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja-JP');
    await info.attach('production-hub-profile', { body: await page.screenshot(), contentType: 'image/png' });
});


test('TEST-PRODUCTION-HUB-CONTENT-001 contribution cards occupy a reachable scrolling viewport across routes', contributionRoute);
