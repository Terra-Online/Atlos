export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ZCEAAAAASUVORK5CYII=', 'base64');
const unread = { system: 0, community: 0, total: 0 };
const localFrontend = (url) => ['localhost', '127.0.0.1'].includes(url.hostname) && ['5173', '5174', '5175'].includes(url.port);

export const browserUser = { uid: 'browser-user', nickname: 'Browser reader', avatar: 1, email: 'reader@example.test', role: 'n', registeredAt: '2026-01-01T00:00:00Z' };

// Missing previews exercise the supported placeholder path without remote images.
export function seedContributions(services, count = 20) {
    services.overviewCounts.imageCount = count;
    services.contributions.set('image:', { items: Array.from({ length: count }, (_, index) => ({
        id: `image-${index}`, kind: 'image', markerId: '9800000003', poiType: 'control_nexus',
        content: null, previewUrl: null, status: 'active', visibility: 'public', createdAt: '2026-05-21T03:28:31Z',
    })), nextCursor: null });
}

export function deferred() {
    let resolve;
    const promise = new Promise((done) => { resolve = done; });
    return { promise, resolve };
}

export function createServices() {
    return {
        user: null,
        loginUser: { ...browserUser },
        contributions: new Map([['all:', { items: [], nextCursor: null }]]),
        overviewCounts: { imageCount: 0, commentCount: 0, pendingCount: 0 },
        points: new Set(), archives: new Set(), pointRevision: 0, archiveRevision: 0,
        requests: [], unexpected: [], pageErrors: [], handlers: new Map(),
        handle(method, path, handler) { this.handlers.set(`${method} ${path}`, handler); },
    };
}

export async function serviceResponse(services, request, url) {
    const method = request.method();
    let body = null;
    try { body = request.postDataJSON(); } catch { /* Non-JSON payloads remain in the request log. */ }
    const entry = { method, path: url.pathname, query: url.search, body };
    services.requests.push(entry);
    const custom = services.handlers.get(`${method} ${url.pathname}`);
    if (custom) return custom({ request, url, body, services });
    const ok = (body) => ({ status: 200, body });
    const unauthorized = () => ({ status: 401, body: { code: 'UNAUTHORIZED', message: 'Unauthorized' } });
    if (method === 'GET' && url.pathname === '/auth/v1/session') return services.user ? ok({ user: services.user }) : unauthorized();
    if (method === 'PATCH' && url.pathname === '/auth/v1/profile') {
        if (!services.user) return unauthorized();
        services.user = { ...services.user, ...body };
        return ok({ user: services.user });
    }
    if (method === 'POST' && url.pathname === '/auth/v1/sign-in/email') {
        services.user = { ...services.loginUser };
        return ok({ user: services.user, ok: true });
    }
    if (method === 'POST' && url.pathname === '/auth/v1/sign-out') { services.user = null; return ok({ ok: true }); }
    if (method === 'GET' && url.pathname === '/me/v1/overview') return services.user ? ok({ user: services.user, contributions: services.overviewCounts }) : unauthorized();
    if (method === 'GET' && url.pathname === '/me/v1/contributions') {
        if (!services.user) return unauthorized();
        const key = `${url.searchParams.get('kind') || 'all'}:${url.searchParams.get('cursor') || ''}`;
        const value = services.contributions.get(key);
        if (value) return ok(value);
    }
    if (method === 'GET' && url.pathname === '/binding/v1/endfield/status') return ok({ binding: { bound: false, enabled: false } });
    if (method === 'GET' && url.pathname === '/notify/v1/unread-count') return ok({ unread });
    if (method === 'GET' && /^\/notify\/v1\/(system|community)\/messages$/.test(url.pathname)) return ok({ items: [], nextCursor: null, unread });
    if (method === 'POST' && /^\/notify\/v1\/(system|community)\/(messages\/read|read-all)$/.test(url.pathname)) return ok({ unread });
    if (method === 'GET' && /^\/uploads\/v1\/(images|comments)(\/mine)?$/.test(url.pathname)) {
        return ok(url.searchParams.has('includeMine') ? { images: { items: [] }, mine: { items: [] } } : { items: [] });
    }
    if (method === 'GET' && url.pathname === '/progress/v1/stats') return ok({ markerIndexHash: url.searchParams.get('markerIndexHash'), totalSyncedUsers: 0, sampleSize: 0, counts: '', updatedAt: null });
    const progress = url.pathname.match(/^\/progress\/v1\/(archive\/)?(state|manifest|sync)$/);
    if (progress) {
        const archive = Boolean(progress[1]);
        const hashKey = archive ? 'archiveIndexHash' : 'markerIndexHash';
        const idsKey = archive ? 'archiveIds' : 'pointIds';
        const setKey = archive ? 'setArchiveIds' : 'setPointIds';
        const clearKey = archive ? 'clearArchiveIds' : 'clearPointIds';
        const revisionKey = archive ? 'archiveRevision' : 'pointRevision';
        const values = archive ? services.archives : services.points;
        if (method === 'GET' && progress[2] === 'state') return ok({ progress: { revision: String(services[revisionKey]), [hashKey]: url.searchParams.get(hashKey), updatedAt: null, [idsKey]: [...values], ...(archive ? {} : { retainedPointIds: [] }) } });
        if (method === 'POST' && progress[2] === 'manifest') return ok({ ok: true, manifest: { [hashKey]: body[hashKey] } });
        if (method === 'POST' && progress[2] === 'sync') {
            for (const id of body[setKey] || []) values.add(id);
            for (const id of body[clearKey] || []) values.delete(id);
            services[revisionKey] += 1;
            return ok({ ok: true, progress: { revision: String(services[revisionKey]), [hashKey]: body[hashKey], updatedAt: body.updatedAt, ...(archive ? {} : { retainedPointIds: [] }) } });
        }
    }
    if (method === 'GET' && /^\/api\/[^/]+\/announcements\/latest$/.test(url.pathname)) return ok({ latestId: null, version: 'browser-fixture', locale: url.pathname.split('/')[2] });
    if (method === 'GET' && /^\/api\/[^/]+\/announcements$/.test(url.pathname)) return ok([]);
    if (method === 'GET' && url.hostname === 'api.ip.sb' && url.pathname === '/geoip') return ok({ country_code: 'US', country: 'United States' });
    if (method === 'GET' && url.hostname === 'data.opendfieldmap.org' && url.pathname === '/channels/stable.json') return ok({ manifest: { path: '/__behavior__/sdk-manifest.json' } });
    if (method === 'GET' && url.hostname === 'data.opendfieldmap.org' && url.pathname === '/__behavior__/sdk-manifest.json') return ok({ gameVersion: '1_6_0', gameBuild: 'behavior-fixture' });
    services.unexpected.push(`${method} ${url.href}`);
    return { status: 404, body: { code: 'UNMOCKED_BROWSER_SERVICE', message: `${method} ${url.pathname}` } };
}

/** routeHTTP=false preserves browser HTTP caching for the independent transport baseline. */
export async function installBrowserServices(context, services, { origin = 'http://localhost:5173', production, routeHTTP = true } = {}) {
        await context.addInitScript(() => {
            // Playwright also evaluates init scripts in its initial about:blank page.
            if (location.origin === 'null') return;
            performance.setResourceTimingBufferSize(10_000);
            const initial = {
                'talos:locale': 'en-US',
                UserGuide: JSON.stringify({ state: { stepCompleted: { 'STEP-0_welcome': true, 'MSTEP-0_welcome': true } }, version: 1 }),
                'support-prefs': JSON.stringify({ viewedVersions: ['20260216'] }),
                'ui-prefs': JSON.stringify({ state: { sidebarOpen: true, sidebarWidthV2: 500, intelSidebarWidth: 300, prefsSidebarEnabled: true, prefsMarkerProgressEnabled: true, theme: 'light' }, version: 1 }),
            };
            // New tabs share progress; initializing a tab must never reset that progress.
            for (const [key, value] of Object.entries(initial)) if (localStorage.getItem(key) === null) localStorage.setItem(key, value);
        });
        const watchPage = (page) => {
            page.on('pageerror', (error) => services.pageErrors.push(`${page.url()}: ${error.message}`));
            if (production) page.on('response', (response) => {
                const url = new URL(response.url());
                if (url.origin === origin && response.status() >= 400) services.unexpected.push(`LOCAL RESOURCE ${response.status()} ${url.pathname}`);
            });
        };
        context.on('page', watchPage);
        for (const page of context.pages()) watchPage(page);
        if (routeHTTP) await context.route('**/*', async (route) => {
            const request = route.request();
            const url = new URL(request.url());
            if (url.origin === origin || (!production && localFrontend(url))) {
                // vite-plugin-html otherwise rewrites this fixture entry as the main SPA.
                if (url.pathname === '/test-support/browser/index.html') return route.continue({ headers: { ...request.headers(), accept: '*/*' } });
                return route.continue();
            }
            const resource = production?.resourceUrl(url, origin);
            if (resource) {
                // Release builds generate/upload OG media separately (SEO_SKIP_IMAGES).
                // Only that explicit media namespace uses the fixed preview fixture.
                if (url.pathname.startsWith(production.assets.pathname + 'seo/og/')) return route.fulfill({ contentType: 'image/png', body: PNG });
                const response = await route.fetch({ url: resource });
                if (!response.ok()) services.unexpected.push(`RESOURCE ${response.status()} ${url.pathname}`);
                return route.fulfill({ response });
            }
            if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': request.headers().origin || '*', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': request.headers()['access-control-request-headers'] || 'content-type', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS' } });
            if (!production && request.resourceType() === 'image' && (['cdn.opendfieldmap.org', 'cdn.opendfieldmap.cn'].includes(url.hostname) || url.pathname.startsWith('/__behavior__/'))) return route.fulfill({ status: 200, contentType: 'image/png', body: PNG });
            // The app bundles its primary fonts. Optional remote fallback families
            // stay offline; their CDN delivery is outside this frontend baseline.
            if (request.method() === 'GET' && url.hostname === 'fonts.googleapis.com' && url.pathname === '/css2') return route.fulfill({ status: 200, contentType: 'text/css', body: '' });
            if (url.hostname === 'www.googletagmanager.com' && url.pathname === '/gtag/js') return route.fulfill({ status: 200, contentType: 'text/javascript', body: '' });
            if (['www.google-analytics.com', 'region1.google-analytics.com'].includes(url.hostname) && ['/g/collect', '/collect'].includes(url.pathname)) return route.fulfill({ status: 204 });
            const response = await serviceResponse(services, request, url);
            return route.fulfill({ status: response.status || 200, contentType: 'application/json', body: JSON.stringify(response.body), headers: { 'access-control-allow-origin': request.headers().origin || '*', 'access-control-allow-credentials': 'true', ...response.headers } });
        });
        await context.routeWebSocket('**/*', (socket) => {
            const url = new URL(socket.url());
            if (!production && localFrontend(url)) { socket.connectToServer(); return; }
            if (url.pathname === '/notify/v1/live') {
                socket.send(JSON.stringify({ event: 'notification.ready', unread }));
                socket.onMessage((message) => { if (message === 'OEMping1') socket.send(message); });
                return;
            }
            services.unexpected.push(`WS ${url.href}`);
            socket.close();
        });
}
