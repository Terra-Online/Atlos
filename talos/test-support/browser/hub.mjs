import { expect } from 'playwright/test';
import { browserUser, seedContributions } from './services.mjs';

export async function expectContributionViewport(page) {
    const panel = page.getByRole('tabpanel');
    const cards = panel.locator('ul > li');
    await expect(cards).toHaveCount(20);
    // Playwright visibility alone ignores clipping by a scroll ancestor.
    // Require room for a full card, and prove both ends are reachable.
    await expect.poll(() => panel.evaluate((node) => node.clientHeight - node.querySelector('ul > li').getBoundingClientRect().height)).toBeGreaterThanOrEqual(0);
    for (const card of [cards.first(), cards.last()]) {
        await card.scrollIntoViewIfNeeded();
        await expect.poll(() => card.evaluate((node) => {
            const rect = node.getBoundingClientRect();
            const viewport = node.closest('[role="tabpanel"]').getBoundingClientRect();
            return rect.top >= viewport.top - 1 && rect.bottom <= viewport.bottom + 1 && rect.top >= -1 && rect.bottom <= innerHeight + 1;
        })).toBe(true);
    }
}


export async function contributionRoute({ page, services }, info) {
    services.user = { ...browserUser };
    seedContributions(services);
    await page.goto('/me/content');
    await expectContributionViewport(page);
    await page.locator('nav a[href="/me/profile"]').click();
    await expect(page.locator('input[name="avatar"]').first()).toBeVisible();
    await page.locator('nav a[href="/me/content"]').click();
    await expectContributionViewport(page);
    services.handle('GET', '/me/v1/overview', () => ({ status: 500, body: { code: 'TEST_FAILURE' } }));
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    // The shared HTTP helper's default decoder exposes the status, not a payload message.
    await expect(page.getByRole('alert')).toHaveText('HTTP 500');
    await expectContributionViewport(page);
    await info.attach('hub-contributions', { body: await page.screenshot(), contentType: 'image/png' });
}
