import { test, expect } from './fixtures.mjs';

test.beforeEach(async ({ page }) => {
    await page.goto('/test-support/browser/index.html');
    await expect(page.locator('[data-fixture="ready"]')).toBeVisible();
});

async function recordFrames(page) {
    await page.evaluate(() => {
        window.__behaviorTimeline = { active: true, frames: [] };
        const sample = () => {
            const timeline = window.__behaviorTimeline;
            const dialog = document.querySelector('[role="dialog"]');
            if (dialog) {
                const style = getComputedStyle(dialog);
                const rect = dialog.getBoundingClientRect();
                timeline.frames.push({ time: performance.now(), state: dialog.dataset.state, opacity: Number(style.opacity), transform: style.transform, x: rect.x, y: rect.y, width: rect.width, height: rect.height, inert: !!dialog.closest('[inert]') });
            }
            if (timeline.active) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
    });
}

async function finishFrames(page, testInfo) {
    const frames = await page.evaluate(() => { window.__behaviorTimeline.active = false; return window.__behaviorTimeline.frames; });
    await testInfo.attach('animation-frames', { body: JSON.stringify(frames, null, 2), contentType: 'application/json' });
    return frames;
}

test('TEST-BROWSER-OVERLAY-001 nested Viewer preserves the modal, scroll lock and opener focus', async ({ page }, testInfo) => {
    const firstOpener = page.getByRole('button', { name: 'Open fixture modal', exact: true });
    await firstOpener.focus();
    await page.keyboard.press('Enter');
    const modal = page.getByRole('dialog', { name: 'Fixture modal', exact: true });
    await expect(modal).toHaveCSS('opacity', '1');
    const opener = page.getByRole('button', { name: 'Open nested viewer', exact: true });
    await opener.focus();
    await page.keyboard.press('Enter');
    const first = page.getByRole('dialog', { name: 'First fixture image', exact: true });
    await expect(first).toBeVisible();
    await expect(first).toHaveAttribute('data-state', 'open');
    await expect(first).toHaveCSS('opacity', '1');
    await expect(first.getByRole('img', { name: 'First fixture image', exact: true })).toHaveAttribute('data-loaded', 'true');
    const carousel = page.getByRole('button', { name: 'Switch image', exact: true });
    await carousel.focus();
    await page.keyboard.press('ArrowRight');
    const second = page.getByRole('dialog', { name: 'Second fixture image', exact: true });
    await expect(second.getByText('Second author', { exact: true })).toBeVisible();
    const secondImage = second.getByRole('img', { name: 'Second fixture image', exact: true });
    await expect(secondImage).toHaveAttribute('data-loaded', 'true');
    await expect(secondImage).toHaveCSS('opacity', '1');
    await testInfo.attach('nested-viewer', { body: await page.screenshot(), contentType: 'image/png' });
    await page.keyboard.press('Escape');
    await expect(second).toHaveCount(0);
    await expect(modal).toBeVisible();
    await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
    await expect(opener).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(modal).toHaveCount(0);
    await expect(firstOpener).toBeFocused();
    await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
});

test('TEST-BROWSER-MOTION-001 modal entry and interrupted exit keep real transitions and one close callback', async ({ page }, testInfo) => {
    await recordFrames(page);
    await page.getByRole('button', { name: 'Open fixture modal', exact: true }).click();
    const modal = page.getByRole('dialog', { name: 'Fixture modal', exact: true });
    await expect(modal).toHaveCSS('opacity', '1');
    const original = await modal.elementHandle();
    await page.getByRole('button', { name: 'Interrupt modal exit', exact: true }).click();
    await page.waitForFunction(() => window.__behaviorTimeline.frames.some((frame) => frame.inert));
    await expect(modal).toHaveAttribute('data-state', 'open');
    await expect(modal).toHaveCSS('opacity', '1');
    expect(await original.evaluate((node) => node.isConnected)).toBe(true);
    await expect(page.locator('[data-result="closed"]')).toHaveText('0');
    const frames = await finishFrames(page, testInfo);
    expect(frames.some((frame) => frame.opacity > 0 && frame.opacity < 1)).toBe(true);
    expect(frames.some((frame) => frame.inert)).toBe(true);
    expect(frames.every((frame) => frame.width > 0 && frame.height > 0 && Number.isFinite(frame.x))).toBe(true);
    await testInfo.attach('modal-reopened', { body: await page.screenshot(), contentType: 'image/png' });
    await page.getByRole('button', { name: 'Close fixture modal', exact: true }).click();
    await expect(modal).toHaveCount(0);
    await expect(page.locator('[data-result="closed"]')).toHaveText('1');
});

test('TEST-BROWSER-POPOVER-001 tooltip and context menu use native positioning, keyboard and dismissal', async ({ page }, testInfo) => {
    const trigger = page.getByRole('button', { name: 'Tooltip fixture', exact: true });
    await trigger.hover();
    const tooltip = page.getByRole('tooltip').filter({ hasText: 'Native tooltip content' });
    await expect(tooltip).toBeVisible();
    await expect.poll(async () => { const rect = await tooltip.boundingBox(); return rect.x + rect.width; }).toBeLessThanOrEqual(page.viewportSize().width + 1);
    const bounds = await tooltip.boundingBox();
    await testInfo.attach('tooltip-position', { body: JSON.stringify(await tooltip.evaluate((node) => ({ rect: node.getBoundingClientRect().toJSON(), style: node.getAttribute('style'), viewport: { width: innerWidth, height: innerHeight, visualWidth: visualViewport?.width, scale: visualViewport?.scale }, documentWidth: document.documentElement.scrollWidth, bodyWidth: document.body.scrollWidth })), null, 2), contentType: 'application/json' });
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize().width + 1);
    await page.keyboard.press('Escape');
    await expect(tooltip).toBeHidden();
    const menuTrigger = page.getByRole('button', { name: 'Context fixture', exact: true });
    await menuTrigger.focus();
    await menuTrigger.click({ button: 'right' });
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Disabled menu action', exact: true })).toBeDisabled();
    await page.keyboard.press('End');
    await expect(page.getByRole('menuitem', { name: 'Last menu action', exact: true })).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(page.getByRole('menuitem', { name: 'First menu action', exact: true })).toBeFocused();
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-result="action"]')).toHaveText('last');
    await expect(menu).toHaveCount(0);
    // WebKit deliberately blurs buttons during pointer activation. Verify exact
    // opener restoration through a keyboard activation that preserves focus.
    await menuTrigger.focus();
    await page.keyboard.press('Shift+F10');
    await expect(menu).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(menuTrigger).toBeFocused();
});

test('TEST-BROWSER-LAYOUT-001 ResizeObserver keeps tab geometry and scroll masks in sync', async ({ page }, testInfo) => {
    const tabs = page.locator('[data-fixture="tabs"]');
    await tabs.getByRole('tab', { name: 'Second longer tab', exact: true }).click();
    const delta = () => tabs.getByRole('tablist').evaluate((bar) => {
        const selected = bar.querySelector('[aria-selected="true"]');
        const indicator = bar.querySelector('[style*="left"]');
        const rect = selected.getBoundingClientRect();
        return Math.abs(parseFloat(indicator.style.left) - (rect.left - bar.getBoundingClientRect().left + bar.scrollLeft + rect.width / 2));
    });
    await expect.poll(delta).toBeLessThan(1);
    await page.getByRole('button', { name: 'Resize tab fixture', exact: true }).click();
    await expect.poll(delta).toBeLessThan(1);
    await expect(tabs.getByRole('tab', { name: 'Disabled tab', exact: true })).toBeDisabled();
    const feed = page.locator('[data-fixture="feed"]').getByRole('tabpanel');
    await feed.scrollIntoViewIfNeeded();
    expect(await feed.evaluate((node) => node.scrollHeight > node.clientHeight)).toBe(true);
    await expect.poll(() => feed.evaluate((node) => parseFloat(node.style.getPropertyValue('--scroll-fade-bottom')) || 0)).toBeGreaterThan(0);
    await feed.evaluate((node) => { node.scrollTop = node.scrollHeight; });
    await expect.poll(() => feed.evaluate((node) => parseFloat(node.style.getPropertyValue('--scroll-fade-bottom')) || 0)).toBe(0);
    await page.getByRole('button', { name: 'Reset feed fixture', exact: true }).click();
    await expect.poll(() => feed.evaluate((node) => node.scrollTop)).toBe(0);
    await testInfo.attach('real-layout', { body: await page.screenshot(), contentType: 'image/png' });
});

test('TEST-BROWSER-ACTIONBAR-001 selection actions preserve editor focus and release their native layer', async ({ page }) => {
    const editor = page.getByRole('textbox', { name: 'Floating editor', exact: true });
    await editor.focus();
    const action = page.getByRole('button', { name: 'Format fixture text', exact: true });
    await expect(action).toBeVisible();
    await action.click();
    await expect(page.locator('[data-result="action"]')).toHaveText('format');
    await expect(editor).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(action).toBeHidden();
    await expect(editor).toBeFocused();
});
