import { contributionRoute } from './hub.mjs';
import { test, expect, browserUser, deferred } from './fixtures.mjs';

async function mainReady(page) {
    await page.goto('/');
    await expect(page.locator('[data-sidebar-layout="desktop"]')).toBeVisible();
    await expect(page.locator('[data-search-input="true"]')).toBeVisible();
}

async function shot(page, testInfo, name) {
    await testInfo.attach(name, { body: await page.screenshot(), contentType: 'image/png' });
}

async function pointState(page) {
    return page.evaluate(async () => {
        // Reuse Vite's already loaded URL, including its HMR version. Importing
        // the unversioned URL would instantiate a second store during dev.
        const loaded = (path) => {
            const entry = performance.getEntriesByType('resource').findLast((resource) => new URL(resource.name).pathname === path);
            if (!entry) throw new Error(`App module was not loaded: ${path}`);
            return entry.name;
        };
        const { useMarkerStore } = await import(loaded('/src/store/marker.ts'));
        const { default: useRegion } = await import(loaded('/src/store/region.ts'));
        const state = useMarkerStore.getState();
        return { query: state.searchString, filters: state.filter, point: state.currentActivePoint?.id, region: useRegion.getState().currentRegionKey };
    });
}

test('TEST-BROWSER-MAIN-SEARCH-001 Enter retains the document, query, filters and active point', async ({ page }, testInfo) => {
    await mainReady(page);
    const search = page.locator('[data-search-input="true"]');
    await search.fill('Control Nexus');
    const result = page.locator('form button').filter({ hasText: 'Control Nexus' });
    await expect(result).toHaveCount(1);
    // WebKit's automatic click scrolling can honor the app's global smooth
    // behavior and move nested scroll containers after pointer coordinates are
    // chosen. Finish that native scroll chain before the real pointer click.
    await result.evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
    await result.click();
    await expect.poll(async () => (await pointState(page)).point).toBe('9800000003');
    await expect(page.locator('[data-font-region="detail"][data-state="open"]')).toBeVisible();
    const before = await pointState(page);
    const documentToken = await page.evaluate(() => { window.__behaviorDocumentToken = Math.random(); return window.__behaviorDocumentToken; });
    let documentNavigations = 0;
    page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) documentNavigations += 1; });
    await search.press('Enter');
    // The next animation frame is beyond the native form submit default action.
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    expect(await pointState(page)).toEqual(before);
    expect(await page.evaluate(() => window.__behaviorDocumentToken)).toBe(documentToken);
    expect(documentNavigations).toBe(0);
    expect(before.filters).toContain('control_nexus');
    await shot(page, testInfo, 'main-search-detail-after-enter');
});

test('TEST-BROWSER-MAIN-SETTINGS-001 theme persists and the language modal commits the selected locale', async ({ page }, testInfo) => {
    await mainReady(page);
    const preferences = page.getByRole('button', { name: 'Preferences', exact: true });
    // Focus restoration needs an actually focused opener at registration.
    // WebKit's native mouse default action does not focus a clicked button.
    await preferences.focus();
    await preferences.press('Enter');
    const settings = page.getByRole('dialog', { name: 'Settings', exact: true });
    await expect(settings).toBeVisible();
    await settings.locator('button[data-pref="dark"]').click();
    await expect(settings.locator('button[data-pref="dark"]')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('ui-prefs')).state.theme)).toBe('dark');
    await shot(page, testInfo, 'settings-dark');
    await page.keyboard.press('Escape');
    await expect(settings).toHaveCount(0);
    await expect(preferences).toBeFocused();
    await page.getByRole('button', { name: 'Choose language', exact: true }).click();
    const language = page.getByRole('dialog', { name: 'language', exact: true });
    await expect(language).toBeVisible();
    await expect(language.getByRole('radio', { name: 'English', exact: true })).toHaveAttribute('aria-checked', 'true');
    await language.getByRole('radio', { name: 'Japanese', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja-JP');
    await expect.poll(() => page.evaluate(() => localStorage.getItem('talos:locale'))).toBe('ja-JP');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.reload();
    await expect(page.locator('[data-search-input="true"]')).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja-JP');
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('ui-prefs')).state.theme)).toBe('dark');
});

test('TEST-BROWSER-INTEL-MOTION-001 category/search and collect reversal finish with native animation events', async ({ page }, testInfo) => {
    await page.goto('/intel/');
    await expect(page.locator('[data-intel-archive]').first()).toBeVisible();
    const paper = page.locator('[data-intel-category="paper"]');
    await paper.click();
    await expect(paper).toHaveAttribute('aria-pressed', 'true');
    const search = page.getByPlaceholder('Search intels');
    await search.fill('there-is-no-such-intel-9fdf');
    await expect(page.getByRole('status').filter({ hasText: 'No matching intel' })).toBeVisible();
    await search.fill('');
    const card = page.locator('[data-intel-archive]').first();
    await expect(card).toBeVisible();
    const id = await card.getAttribute('data-intel-archive');
    const target = page.locator(`[data-intel-archive="${id}"]`);
    await target.evaluate((element) => {
        window.__intelAnimationTimeline = [];
        for (const type of ['animationstart', 'animationend', 'animationcancel']) element.addEventListener(type, (event) => {
            window.__intelAnimationTimeline.push({ type, animationName: event.animationName, time: performance.now(), collected: element.dataset.collected });
        });
    });
    await target.click();
    await expect(target).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => page.evaluate(() => window.__intelAnimationTimeline.some((event) => event.type === 'animationend' && !event.animationName.endsWith('Reverse')))).toBe(true);
    await target.press('Space');
    await expect(target).toHaveAttribute('data-collected', 'false');
    await expect.poll(() => page.evaluate(() => window.__intelAnimationTimeline.some((event) => event.type === 'animationstart' && event.animationName.includes('Reverse')))).toBe(true);
    await expect(target).not.toHaveAttribute('data-collection-transition', 'uncollect');
    const timeline = await page.evaluate(() => window.__intelAnimationTimeline);
    expect(timeline.some((event) => event.type === 'animationend' && event.animationName.includes('Reverse'))).toBe(true);
    await testInfo.attach('intel-native-animation-events', { body: JSON.stringify(timeline, null, 2), contentType: 'application/json' });
    await shot(page, testInfo, 'intel-reverse-complete');
});

test('TEST-BROWSER-INTEL-LAYOUT-001 details animate measured cards and virtualization restores the expanded height', async ({ page }, testInfo) => {
    await page.goto('/intel/');
    const card = page.locator('article[data-intel-archive]').first();
    await expect(card).toBeVisible();
    const id = await card.getAttribute('data-intel-archive');
    const shell = card.locator('..');
    await expect(shell).toHaveAttribute('data-motion-ready', 'true');
    await expect(shell).toHaveAttribute('data-motion-nearby', 'true');
    const handle = page.locator('.intelBottomTools').getByRole('separator');
    const handleBox = await handle.boundingBox();
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y - 70, { steps: 10 });
    await page.mouse.up();
    const expand = page.getByRole('button', { name: 'Show Details', exact: true });
    await expect(expand).toBeVisible();
    // Opening the tools drawer can overlap font commits and card measurement.
    // Start the motion baseline only after all visible cards remain measured
    // and geometrically stable across twelve natural browser frames.
    await expect.poll(() => page.locator('.intelContent').evaluate((content) => new Promise((done) => {
        let count = 0;
        let stable = true;
        let previous;
        const sample = () => {
            const viewport = content.getBoundingClientRect();
            const visible = [...content.querySelectorAll('article[data-intel-archive]')].flatMap((element) => {
                const rect = element.getBoundingClientRect();
                if (rect.bottom <= viewport.top || rect.top >= viewport.bottom) return [];
                const shell = element.parentElement;
                if (shell.dataset.measuring === 'true' || shell.dataset.layoutSync === 'true' || rect.width <= 0 || rect.height <= 0) stable = false;
                return [{ id: element.dataset.intelArchive, x: rect.x, y: rect.y, width: rect.width, height: rect.height }];
            });
            if (!visible.length || (previous && (visible.length !== previous.length || visible.some((rect, index) => rect.id !== previous[index].id || ['x', 'y', 'width', 'height'].some((key) => Math.abs(rect[key] - previous[index][key]) > 0.5))))) stable = false;
            previous = visible;
            if (++count < 12) requestAnimationFrame(sample);
            else done(stable);
        };
        requestAnimationFrame(sample);
    }))).toBe(true);
    const collapsed = (await card.boundingBox()).height;
    await card.evaluate((element) => {
        window.__intelLayoutTimeline = { active: true, frames: [], events: [] };
        for (const type of ['transitionrun', 'transitionstart', 'transitionend', 'transitioncancel']) element.parentElement.addEventListener(type, (event) => {
            window.__intelLayoutTimeline.events.push({ time: performance.now(), type, property: event.propertyName, elapsed: event.elapsedTime });
        });
        const sample = () => {
            const timeline = window.__intelLayoutTimeline;
            timeline.frames.push({ time: performance.now(), height: element.getBoundingClientRect().height, measuring: element.parentElement.dataset.measuring, expanded: document.querySelector('[data-app="intel"]').dataset.cardsExpanded });
            if (timeline.active) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
    });
    await expand.click();
    await expect(page.locator('[data-app="intel"]')).toHaveAttribute('data-cards-expanded', 'true');
    await expect.poll(async () => (await card.boundingBox()).height).toBeGreaterThan(collapsed + 10);
    await expect.poll(() => card.evaluate((element) => element.getAnimations({ subtree: true }).filter((animation) => animation.playState === 'running').length)).toBe(0);
    const expanded = (await card.boundingBox()).height;
    const timeline = await page.evaluate(() => { window.__intelLayoutTimeline.active = false; return window.__intelLayoutTimeline; });
    const { frames } = timeline;
    const maxFrameGap = Math.max(...frames.slice(1).map((frame, index) => frame.time - frames[index].time));
    await testInfo.attach('intel-expansion-frames', { body: JSON.stringify({ collapsed, expanded, frames, events: timeline.events, maxFrameGap }, null, 2), contentType: 'application/json' });
    expect(frames.some((frame) => frame.height > collapsed + 1 && frame.height < expanded - 1)).toBe(true);
    const content = page.locator('.intelContent');
    await content.evaluate((element, id) => {
        window.__intelScrollTimeline = { active: true, frames: [] };
        const sample = () => {
            const timeline = window.__intelScrollTimeline;
            const target = element.querySelector(`[data-intel-archive="${id}"]`);
            timeline.frames.push({ time: performance.now(), top: element.scrollTop, height: element.scrollHeight, viewport: element.clientHeight, targetTag: target?.tagName, targetY: target?.getBoundingClientRect().y });
            if (timeline.active) requestAnimationFrame(sample);
        };
        requestAnimationFrame(sample);
    }, id);
    try {
        await content.evaluate((element) => { element.scrollTop = element.scrollHeight; });
        // Global CSS makes these native smooth scrolls. A card being virtualized
        // only proves that scrolling started, not that the first scroll finished.
        await expect.poll(() => content.evaluate((element) => Math.abs(element.scrollHeight - element.clientHeight - element.scrollTop))).toBeLessThan(2);
        await expect(page.locator(`article[data-intel-archive="${id}"]`)).toHaveCount(0);
        const placeholder = page.locator(`[data-intel-archive="${id}"]`);
        await expect(placeholder).toHaveAttribute('aria-hidden', 'true');
        await content.evaluate((element) => { element.scrollTop = 0; });
        await expect.poll(() => content.evaluate((element) => Math.abs(element.scrollTop))).toBeLessThan(1);
        const restored = page.locator(`article[data-intel-archive="${id}"]`);
        await expect(restored).toBeVisible();
        // IO replaces placeholder nodes as the native scroll settles. Require
        // continuous mounted, correctly sized content across twelve real frames.
        await expect.poll(() => content.evaluate((element, { id, expanded }) => new Promise((done) => {
            let count = 0;
            let maxError = 0;
            const sample = () => {
                const target = element.querySelector(`article[data-intel-archive="${id}"]`);
                maxError = Math.max(maxError, target ? Math.abs(target.getBoundingClientRect().height - expanded) : expanded);
                if (++count < 12) requestAnimationFrame(sample);
                else done(maxError);
            };
            requestAnimationFrame(sample);
        }), { id, expanded })).toBeLessThan(2);
        const stableFrames = await content.evaluate((element, { id }) => new Promise((done) => {
            const start = performance.now();
            const samples = [];
            const sample = () => {
                const target = element.querySelector(`article[data-intel-archive="${id}"]`);
                samples.push({ elapsed: performance.now() - start, top: element.scrollTop, scrollHeight: element.scrollHeight, mounted: Boolean(target), height: target?.getBoundingClientRect().height ?? null });
                if (performance.now() - start < 2_000) requestAnimationFrame(sample);
                else done(samples);
            };
            requestAnimationFrame(sample);
        }), { id });
        await testInfo.attach('intel-restored-stability-frames', { body: JSON.stringify({ expanded, frames: stableFrames }, null, 2), contentType: 'application/json' });
        expect(stableFrames.every((frame) => frame.mounted && Math.abs(frame.height - expanded) < 2 && Math.abs(frame.top) < 1)).toBe(true);
        // A temporarily shorter scroll range can clamp a native smooth scroll
        // before its true endpoint. Virtualization must preserve the full grid,
        // including the first frame of each remounted card.
        const heightRange = await page.evaluate(() => {
            const heights = window.__intelScrollTimeline.frames.map((frame) => frame.height);
            return Math.max(...heights) - Math.min(...heights);
        });
        expect(heightRange, 'Virtualization preserves the scroll range throughout the roundtrip').toBeLessThan(2);
    } finally {
        const scrollFrames = await page.evaluate(() => { window.__intelScrollTimeline.active = false; return window.__intelScrollTimeline.frames; });
        await testInfo.attach('intel-native-scroll-frames', { body: JSON.stringify(scrollFrames, null, 2), contentType: 'application/json' });
    }
    await shot(page, testInfo, 'intel-expanded-after-virtualization');
});

test('TEST-BROWSER-CROSS-TAB-001 main progress reaches Intel and Intel changes reach an already open map', async ({ page, context }, testInfo) => {
    await mainReady(page);
    const intel = await context.newPage();
    await intel.goto('/intel/?type=nar_col_lv003_1');
    const intelCard = intel.locator('[data-intel-archive="nar_col_lv003_1"]');
    await expect(intelCard).toBeVisible();
    await expect(intelCard).toHaveAttribute('aria-pressed', 'false');
    const search = page.locator('[data-search-input="true"]');
    await search.fill('nar_col_lv003_1');
    const result = page.locator('form button').filter({ hasText: 'Letter from Valley IV' });
    await expect(result).toHaveCount(1);
    await result.click();
    await expect.poll(async () => (await pointState(page)).point).toBe('300030037');
    const detail = page.locator('[data-font-region="detail"][data-state="open"]');
    await expect(detail).toBeVisible();
    // The detail's type artwork is its existing collect/uncollect action.
    await detail.locator('img').first().locator('..').click();
    await expect(intelCard).toHaveAttribute('aria-pressed', 'true');
    await intelCard.click();
    await expect(intelCard).toHaveAttribute('aria-pressed', 'false');
    const progressSnapshot = () => page.evaluate(async () => {
        const entry = performance.getEntriesByType('resource').findLast((resource) => new URL(resource.name).pathname === '/src/store/userRecord.ts');
        if (!entry) throw new Error('Canonical userRecord module was not loaded');
        const { useUserRecordStore } = await import(entry.name);
        return { memory: useUserRecordStore.getState().activePoints.includes('300030037'), persisted: JSON.parse(localStorage.getItem('points-storage')).state.activePoints.includes('300030037'), module: entry.name };
    });
    await testInfo.attach('cross-tab-canonical-progress', { body: JSON.stringify(await progressSnapshot(), null, 2), contentType: 'application/json' });
    await expect.poll(async () => {
        const { memory, persisted } = await progressSnapshot();
        return { memory, persisted };
    }).toEqual({ memory: false, persisted: false });
    await shot(page, testInfo, 'main-after-intel-uncollect');
    await shot(intel, testInfo, 'intel-after-main-roundtrip');
});

const contribution = (id, content, kind = 'comment') => ({ id, kind, markerId: '9800000003', poiType: 'control_nexus', content, previewUrl: null, status: 'active', visibility: 'public', createdAt: '2026-05-21T03:28:31Z' });

test('TEST-BROWSER-HUB-001 full shell changes tabs, localizes dates and saves one pending avatar', async ({ page, services }, testInfo) => {
    services.user = { ...browserUser };
    services.overviewCounts = { imageCount: 1, commentCount: 1, pendingCount: 0 };
    services.contributions.set('image:', { items: [contribution('image-1', null, 'image')], nextCursor: null });
    services.contributions.set('comment:', { items: [contribution('comment-1', 'A browser contribution')], nextCursor: null });
    await page.goto('/me/');
    await expect(page).toHaveURL(/\/me\/content$/);
    await expect(page.getByText('Browser reader', { exact: true })).toBeVisible();
    await page.getByRole('tab', { name: 'Comments (1)', exact: true }).click();
    await expect(page.getByText('A browser contribution', { exact: true })).toBeVisible();
    const time = page.locator('time[datetime="2026-05-21T03:28:31Z"]').first();
    await expect(time).toContainText('05-21-2026');
    await page.getByRole('button', { name: 'Choose language', exact: true }).click();
    await page.getByRole('radio', { name: 'Japanese', exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('lang', 'ja-JP');
    await page.keyboard.press('Escape');
    await expect(time).toContainText('2026-05-21');
    // Navigation is the app router; this is not a store-only profile mount.
    await page.locator('nav[aria-label] a[href="/me/profile"]').click();
    const save = deferred();
    services.handle('PATCH', '/auth/v1/profile', async ({ body }) => {
        await save.promise;
        services.user = { ...services.user, ...body };
        return { body: { user: services.user } };
    });
    await page.locator('input[name="avatar"][value="2"]').check();
    await expect(page.locator('input[name="avatar"][value="3"]')).toBeDisabled();
    expect(services.requests.filter((entry) => entry.method === 'PATCH' && entry.path === '/auth/v1/profile')).toHaveLength(1);
    save.resolve();
    await expect(page.locator('input[name="avatar"][value="2"]')).toBeChecked();
    await expect(page.locator('input[name="avatar"][value="3"]')).toBeEnabled();
    expect(services.user.avatar).toBe(2);
    await shot(page, testInfo, 'hub-avatar-saved');
    await page.goBack();
    await expect(page).toHaveURL(/\/me\/content$/);
    // Content is remounted on route navigation and intentionally starts at Images.
    await page.getByRole('tab').filter({ hasText: '(1)' }).nth(1).click();
    await expect(page.getByText('A browser contribution', { exact: true })).toBeVisible();
});

test('TEST-BROWSER-HUB-AUTH-001 a paginated 401 logs in in place and resumes the same cursor', async ({ page, services }, testInfo) => {
    services.user = { ...browserUser };
    services.overviewCounts.commentCount = 21;
    services.contributions.set('image:', { items: [], nextCursor: null });
    services.contributions.set('comment:', { items: Array.from({ length: 20 }, (_, index) => contribution(`page1-${index}`, `Saved comment ${index}`)), nextCursor: 'second-page' });
    let expired = false;
    services.handle('GET', '/me/v1/contributions', ({ url }) => {
        const kind = url.searchParams.get('kind');
        const cursor = url.searchParams.get('cursor') || '';
        if (kind === 'comment' && cursor === 'second-page') {
            if (!expired) { expired = true; services.user = null; return { status: 401, body: { code: 'UNAUTHORIZED', message: 'Unauthorized' } }; }
            return { body: { items: [contribution('page2', 'Recovered second page')], nextCursor: null } };
        }
        return { body: services.contributions.get(`${kind}:`) };
    });
    await page.goto('/me/content');
    await page.getByRole('tab', { name: 'Comments (21)', exact: true }).click();
    await expect(page.getByText('Saved comment 0', { exact: true })).toBeVisible();
    const documentToken = await page.evaluate(() => { window.__hubDocumentToken = Math.random(); return window.__hubDocumentToken; });
    const more = page.getByRole('button', { name: 'Load more', exact: true });
    await more.scrollIntoViewIfNeeded();
    // Native IntersectionObserver may already have requested this page. The
    // explicit pagination control covers the same cursor when it has not.
    if (!expired) {
        try { await more.click({ timeout: 2_000 }); }
        catch (error) { if (!expired) throw error; }
    }
    await expect(page.locator('#access-email')).toBeVisible();
    await expect(page).toHaveURL(/\/me\/content$/);
    // This clean browser has no persisted "logged in before" preference.
    // Use the existing mode switch rather than pre-seeding an auth-store flag.
    const signIn = page.getByRole('button', { name: 'Sign in here.', exact: true });
    if (await signIn.isVisible()) await signIn.click();
    await page.locator('#access-email').fill(browserUser.email);
    await page.locator('#access-password').fill('BrowserPassword123');
    // The existing access form auto-submits valid credentials after both fields blur.
    await page.locator('#access-password').press('Tab');
    await expect(page.getByText('Recovered second page', { exact: true })).toBeVisible();
    await expect(page.getByText('Saved comment 0', { exact: true })).toHaveCount(1);
    await expect(page.locator('#access-email')).toHaveCount(0);
    expect(await page.evaluate(() => window.__hubDocumentToken)).toBe(documentToken);
    expect(services.requests.filter((entry) => entry.path === '/me/v1/contributions' && entry.query.includes('cursor=second-page'))).toHaveLength(2);
    await shot(page, testInfo, 'hub-restored-pagination');
});


test('TEST-BROWSER-HUB-CONTENT-001 contribution cards occupy a reachable scrolling viewport across routes', contributionRoute);
