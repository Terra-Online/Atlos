/* global window, document, localStorage, MutationObserver, requestAnimationFrame, getComputedStyle */
import { parseArgs } from 'node:util';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname, dirname } from 'node:path';
const { values } = parseArgs({
    options: {
        baseline: { type: 'string' },
        candidate: { type: 'string' },
        out: { type: 'string', default: '../docs/perf/app-startup/results.json' },
        rounds: { type: 'string', default: '10' },
        help: { type: 'boolean' },
    },
});
if (values.help) {
    console.log(
        'PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs node scripts/bench-app-startup.mjs --baseline /frozen/build --candidate /frozen/build [--out results.json] [--rounds 10]',
    );
    process.exit(0);
}
if (!values.baseline || !values.candidate)
    throw new Error(
        'Provide --baseline and --candidate directories containing intel/ and me/.',
    );
const rounds = Number(values.rounds);
if (!Number.isInteger(rounds) || rounds < 1)
    throw new Error('--rounds must be a positive integer.');
const roots = {
    baseline: resolve(values.baseline),
    candidate: resolve(values.candidate),
};
const variants = ['baseline', 'candidate'];
const out = resolve(values.out);
await mkdir(dirname(out), { recursive: true });
const { chromium } = await import(
    process.env.PLAYWRIGHT_MODULE ?? 'playwright'
);
const mime = {
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.html': 'text/html',
    '.woff2': 'font/woff2',
    '.woff': 'font/woff',
    '.svg': 'image/svg+xml',
    '.webp': 'image/webp',
    '.png': 'image/png',
    '.json': 'application/json',
};
const server = createServer(async (req, res) => {
    try {
        const variant = /benchVariant=([^;]+)/.exec(
            req.headers.cookie ?? '',
        )?.[1];
        const root = roots[variant];
        if (!root) throw new Error('Unknown variant');
        let path = new URL(req.url, 'http://localhost').pathname;
        let file = resolve(root, '.' + path);
        if (!extname(file))
            file = resolve(
                root,
                path.startsWith('/intel') ? 'intel' : 'me',
                'index.html',
            );
        const body = await readFile(file);
        res.writeHead(200, {
            'content-type': mime[extname(file)] ?? 'application/octet-stream',
        });
        res.end(body);
    } catch {
        res.writeHead(404);
        res.end('missing');
    }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
const workload = new Map();
const user = {
    uid: '42',
    nickname: 'Tester',
    avatar: 1,
    groupCode: 'normal',
    email: 'tester@example.test',
    registeredAt: '2026-01-01T00:00:00Z',
};
async function setup(context, variant, app, mode) {
    await context.addCookies([
        { url: origin, name: 'benchVariant', value: variant },
    ]);
    await context.addInitScript(
        ({ app, mode }) => {
            localStorage.setItem('talos:locale', 'en-US');
            localStorage.setItem(
                'ui-prefs',
                JSON.stringify({ state: { theme: 'light' }, version: 0 }),
            );
            const b = (window.__startup = {
                fetches: [],
                longTasks: [],
                fontEvents: [],
            });
            const fetch = window.fetch;
            window.fetch = async (...args) => {
                const start = performance.now();
                const response = await fetch(...args);
                b.fetches.push({
                    url: response.url,
                    start,
                    end: performance.now(),
                    status: response.status,
                });
                if (
                    response.status === 401 &&
                    response.url.includes('/me/v1/overview')
                )
                    b.overview401 = performance.now();
                return response;
            };
            new PerformanceObserver((list) =>
                b.longTasks.push(
                    ...list.getEntries().map((e) => ({
                        start: e.startTime,
                        duration: e.duration,
                    })),
                ),
            ).observe({ type: 'longtask', buffered: true });
            for (const event of ['loading', 'loadingdone', 'loadingerror'])
                document.fonts.addEventListener(event, () =>
                    b.fontEvents.push({ event, time: performance.now() }),
                );
            const selector =
                app === 'intel'
                    ? '[data-intel-archive]'
                    : mode === 'auth'
                      ? '[role="tabpanel"] li'
                      : 'input[type="email"]'; // Timestamp in the browser; Playwright's polling completion is only diagnostic.
            let scheduled = false;
            const observer = new MutationObserver(check);
            observer.observe(document, {
                childList: true,
                subtree: true,
                attributes: true,
            });
            function check() {
                const el = document.querySelector(selector);
                if (!el || b.sampleAt !== undefined) return;
                if (b.domReadyMs === undefined)
                    b.domReadyMs = performance.now();
                if (scheduled) return;
                scheduled = true;
                requestAnimationFrame(() => {
                    scheduled = false;
                    const el = document.querySelector(selector);
                    if (
                        !el ||
                        !el.getClientRects().length ||
                        getComputedStyle(el).visibility === 'hidden'
                    ) {
                        check();
                        return;
                    }
                    b.visibleFrameMs = performance.now();
                    observer.disconnect();
                    requestAnimationFrame(() => {
                        b.frameProxyMs = performance.now();
                        b.sampleAt = b.frameProxyMs;
                        b.resources = performance
                            .getEntriesByType('resource')
                            .map((e) => ({
                                name: e.name,
                                start: e.startTime,
                                end: e.responseEnd,
                                bytes: e.transferSize,
                                initiator: e.initiatorType,
                            }));
                        b.cards = document.querySelectorAll(
                            app === 'intel'
                                ? '[data-intel-archive]'
                                : '[role="tabpanel"] li',
                        ).length;
                        b.navigation = performance
                            .getEntriesByType('navigation')[0]
                            ?.toJSON();
                    });
                });
            }
            check();
        },
        { app, mode },
    );
    await context.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.origin === origin) return route.continue();
        if (url.hostname === 'api.fixture.test') {
            let status = 200,
                body = {};
            if (url.pathname.endsWith('/overview')) {
                status = mode === 'auth' ? 200 : 401;
                body =
                    mode === 'auth'
                        ? {
                              user,
                              contributions: {
                                  imageCount: 20,
                                  commentCount: 20,
                                  pendingCount: 0,
                              },
                          }
                        : { error: 'SESSION_REQUIRED' };
            } else if (url.pathname.includes('/contributions'))
                body = {
                    items: Array.from({ length: 20 }, (_, i) => ({
                        id: String(i),
                        kind: 'image',
                        markerId: '1',
                        poiType: 'fixture',
                        content: null,
                        previewUrl: null,
                        status: 'active',
                        visibility: 'public',
                        createdAt: '2026-01-01T00:00:00Z',
                    })),
                    nextCursor: null,
                };
            else if (url.pathname.endsWith('/session')) {
                status = mode === 'auth' ? 200 : 401;
                body =
                    mode === 'auth' ? { user } : { error: 'SESSION_REQUIRED' };
            } else if (url.pathname.includes('progress'))
                body = {
                    revision: 0,
                    pointIds: [],
                    retainedPointIds: [],
                    archiveIds: [],
                    pointIndexHash: 'fixture',
                    archiveIndexHash: 'fixture',
                };
            else if (url.pathname.includes('binding'))
                body = { bound: false, enabled: false };
            return route.fulfill({
                status,
                contentType: 'application/json',
                body: JSON.stringify(body),
            });
        }
        const suffix = url.pathname.slice(url.pathname.indexOf('/assets/') + 1);
        if (url.pathname.includes('/assets/'))
            try {
                const file = resolve(roots[variant], app, suffix);
                return route.fulfill({
                    contentType:
                        mime[extname(file)] ?? 'application/octet-stream',
                    body: await readFile(file),
                });
            } catch {
                // Optional external media uses the fixed placeholder below.
            }
        return route.fulfill({
            status: 200,
            contentType: 'image/gif',
            body: Buffer.from(
                'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
                'base64',
            ),
        });
    });
}
try {
    for (const viewport of [
        { width: 1440, height: 960 },
        { width: 390, height: 844 },
    ])
        for (const [app, mode] of [
            ['intel', 'auth'],
            ['me', 'auth'],
            ['me', 'unauth'],
        ].filter(
            ([app]) => !process.env.BENCH_APP || app === process.env.BENCH_APP,
        ))
            for (let round = 0; round < rounds; round++)
                for (const variant of round % 2
                    ? [...variants].reverse()
                    : variants) {
                    const context = await browser.newContext({
                        viewport,
                        deviceScaleFactor: 1,
                        reducedMotion: 'reduce',
                    });
                    await setup(context, variant, app, mode);
                    const page = await context.newPage();
                    const errors = [];
                    page.on('pageerror', (e) => errors.push(String(e)));
                    const cdp = await context.newCDPSession(page);
                    await cdp.send('Performance.enable');
                    for (const visit of ['cold', 'repeat']) {
                        await page.goto(origin + '/' + app + '/', {
                            waitUntil: 'domcontentloaded',
                        });
                        const selector =
                            app === 'intel'
                                ? '[data-intel-archive]'
                                : mode === 'auth'
                                  ? '[role="tabpanel"] li'
                                  : 'input[type="email"]';
                        await page
                            .locator(selector)
                            .first()
                            .waitFor({ state: 'visible', timeout: 30000 });
                        const observedMs = await page.evaluate(() =>
                            performance.now(),
                        );
                        await page.waitForFunction(
                            () => window.__startup?.sampleAt !== undefined,
                        );
                        // Fixed navigation window: capture background work as well as the first frame.
                        await page.waitForFunction(
                            () => performance.now() >= 1000,
                        );
                        const b = await page.evaluate(() => window.__startup);
                        if (errors.length) throw new Error(errors.join('\n'));
                        const key = `${app}/${mode}/${viewport.width}/${visit}`;
                        if (variant === 'baseline' && !workload.has(key))
                            workload.set(key, b.cards);
                        if (
                            workload.has(key) &&
                            workload.get(key) !== b.cards
                        ) {
                            throw new Error(
                                `Rendered workload differs for ${key}: ${b.cards} vs ${workload.get(key)}`,
                            );
                        }
                        const cpu = (await cdp.send('Performance.getMetrics'))
                            .metrics;
                        const tasks = b.longTasks.filter((x) => x.start < 1000);
                        const blockingMs = tasks.reduce(
                            (n, x) =>
                                n +
                                Math.max(
                                    0,
                                    Math.min(1000, x.start + x.duration) -
                                        x.start -
                                        50,
                                ),
                            0,
                        );
                        const fonts = b.resources.filter((x) =>
                            /\.(woff2?|otf|ttf)(\?|$)/.test(x.name),
                        );
                        results.push({
                            variant,
                            app,
                            mode,
                            viewport: viewport.width,
                            round,
                            visit,
                            domReadyMs: b.domReadyMs,
                            visibleFrameMs: b.visibleFrameMs,
                            frameProxyMs: b.frameProxyMs,
                            observedMs,
                            pollLagMs: observedMs - b.domReadyMs,
                            loginFrom401Ms:
                                b.overview401 === undefined
                                    ? null
                                    : b.visibleFrameMs - b.overview401,
                            overview401: b.overview401,
                            scriptMs:
                                (cpu.find((x) => x.name === 'ScriptDuration')
                                    ?.value ?? 0) * 1000,
                            blockingMs,
                            longTaskCount: tasks.length,
                            longTaskMs: tasks.reduce(
                                (n, x) => n + x.duration,
                                0,
                            ),
                            resources: b.resources,
                            fetches: b.fetches,
                            fontEvents: b.fontEvents,
                            fontEndMs: Math.max(0, ...fonts.map((x) => x.end)),
                            cards: b.cards,
                            errors,
                        });
                    }
                    await context.close();
                    await writeFile(
                        out,
                        JSON.stringify(
                            {
                                browser: await browser.version(),
                                rounds,
                                variants,
                                method: 'browser MutationObserver DOM mark + two rAF; alternating AB/BA, frozen builds',
                                results,
                            },
                            null,
                            2,
                        ),
                    );
                    console.log(variant, app, mode, viewport.width, round);
                }
} finally {
    await browser.close();
    await new Promise((r) => server.close(r));
}
