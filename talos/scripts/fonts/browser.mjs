/* global document, window */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'vite';
import { root } from './catalog.mjs';
import { fontShardsPlugin } from './vite-plugin.mjs';
const { chromium, firefox, webkit } = createRequire(import.meta.url)(
    'playwright',
);
const html = fs.readFileSync(
    new URL('./fixture.html', import.meta.url),
    'utf8',
);
const server = await createServer({
    configFile: false,
    root,
    optimizeDeps: { noDiscovery: true, entries: [], include: ['accept-language-parser'] },
    resolve: { alias: { '@': root + 'src' } },
    plugins: [
        {
            name: 'font-fixture',
            configureServer(instance) {
                instance.middlewares.use('/__font-fixture', (_req, res) => {
                    res.setHeader('Content-Type', 'text/html');
                    res.end(html);
                });
            },
        },
        fontShardsPlugin(),
    ],
    server: {
        host: '127.0.0.1',
        port: 0,
        hmr: false,
        watch: { ignored: ['**/.cache/**', '**/dist/**'] },
    },
});
await server.listen();
const fixtureUrl = `http://127.0.0.1:${server.httpServer.address().port}/__font-fixture`;
const active = (page, id, face) =>
    page.waitForFunction(
        ({ id, face }) =>
            document
                .getElementById(id)
                .style.getPropertyValue(`--font-${face}`)
                .includes('Atlos-area'),
        { id, face },
    );

(async () => {
    const results = {};
    for (const [name, type] of Object.entries({ chromium, firefox, webkit })) {
        const browser = await type.launch({ headless: true });
        const page = await browser.newPage({
            viewport: { width: 1100, height: 800 },
        });
        const errors = [];
        page.on('pageerror', (e) => errors.push(e.message));
        let requests = [];
        page.on('response', async (r) => {
            if (r.url().endsWith('.woff2'))
                requests.push({
                    url: r.url().split('/').pop(),
                    bytes: (await r.body().catch(() => Buffer.alloc(0))).length,
                });
        });
        await page.route('**/*.woff2', async (route) => {
            await new Promise((r) =>
                setTimeout(
                    r,
                    route.request().url().includes('-h-') ? 500 : 100,
                ),
            );
            await route.continue();
        });
        console.log(name, 'starting');
        const start = performance.now();
        await page.goto(fixtureUrl);
        await page.waitForFunction(() => window.fixtureReady);
        await Promise.all([
            active(page, 'shell', 'db'),
            active(page, 'detail', 'r'),
            active(page, 'detail', 'h'),
            active(page, 'card', 'r'),
            active(page, 'cardCopy', 'r'),
        ]);
        const readyMs = Math.round(performance.now() - start);
        await page.waitForTimeout(100);
        const initialRequests = requests.length;
        const initialBytes = requests.reduce((n, r) => n + r.bytes, 0);
        let state = await page.evaluate(() => ({
            styles: ['shell', 'detail', 'card', 'offscreen'].map((id) => [
                id,
                document.getElementById(id).getAttribute('style'),
            ]),
            fonts: document.fonts.size,
            metrics: window.metrics,
        }));
        const partial = state.metrics.frames.filter((frame) => {
            const a = frame[1];
            return a[0].includes('Atlos-area') !== a[1].includes('Atlos-area');
        });
        if (partial.length)
            throw Error(`${name}: partial region activation ${partial.length}`);
        assert.doesNotMatch(state.styles[3][1], /Atlos-area/);
        const shared = await page.evaluate(() => {
            window.stopSampling();
            const original = document
                .getElementById('card')
                .style.getPropertyValue('--font-r');
            const copy = document
                .getElementById('cardCopy')
                .style.getPropertyValue('--font-r');
            window.owners.card.stop();
            document.getElementById('card').remove();
            return original === copy;
        });
        assert(
            shared,
            `${name}: identical complete sets should share native font faces`,
        );
        await page.route('**/HK-*.json', async (route) => {
            await new Promise((r) => setTimeout(r, 700));
            await route.continue();
        });
        await page.evaluate(() => window.regionController.setRegion('HK'));
        await page.waitForTimeout(50);
        await page.evaluate(() => {
            document.querySelector('#detail p').textContent = '新しい名前鱻';
            window.owners.detail.update([{faces: ['r'], text: '新しい名前鱻'}]);
            window.regionController.setRegion('JP');
        });
        await active(page, 'detail', 'r');
        const jpAlias = await page
            .locator('#detail')
            .evaluate((e) => e.style.getPropertyValue('--font-r'));
        await page.waitForTimeout(900);
        assert.equal(
            await page
                .locator('#detail')
                .evaluate((e) => e.style.getPropertyValue('--font-r')),
            jpAlias,
        );
        await page.locator('#offscreen').scrollIntoViewIfNeeded();
        assert.equal(await page.locator('#offscreen').evaluate((e) => e.style.getPropertyValue('--font-r')), '');
        await page.evaluate(() => window.mount('offscreen', [{faces: ['r'], text: '远处文字'}]));
        await active(page, 'offscreen', 'r');
        const beforeStop = await page.evaluate(() => document.fonts.size);
        await page.evaluate(() => window.regionController.stop());
        const afterStop = await page.evaluate(() => document.fonts.size);
        results[name] = {
            errors,
            readyMs,
            initialRequests,
            initialBytes,
            initialFonts: state.fonts,
            cls: state.metrics.cls,
            partialFrames: partial.length,
            requests: requests.length,
            uniqueRequests: new Set(requests.map((r) => r.url)).size,
            bytes: requests.reduce((n, r) => n + r.bytes, 0),
            beforeStop,
            afterStop,
        };
        if (errors.length || afterStop !== 0)
            throw Error(JSON.stringify(results[name]));
        const failed = await browser.newPage({
            viewport: { width: 1100, height: 800 },
        });
        let abort = true;
        await failed.route('**/*-h-*.woff2', async (route) => {
            if (abort) {
                abort = false;
                await route.abort();
            } else await route.continue();
        });
        await failed.goto(fixtureUrl);
        await active(failed, 'shell', 'db');
        await failed.waitForTimeout(300);
        const fallback = await failed
            .locator('#detail')
            .evaluate((e) =>
                ['r', 'h'].map((f) => e.style.getPropertyValue('--font-' + f)),
            );
        assert(
            fallback.every((v) => v.includes('pending')),
            `${name}: failed region partially activated`,
        );
        await failed.evaluate(
            () => {
                document.querySelector('#detail p').textContent += '更新';
                window.owners.detail.update([{faces: ['r'], text: '一二龘更新'}, {faces: ['h'], text: '查看评论'}]);
            },
        );
        await active(failed, 'detail', 'h');
        await failed.evaluate(() => { window.owners.detail.stop(); document.getElementById('detail').remove(); });
        await failed.waitForTimeout(100);
        await failed.evaluate(() => window.regionController.stop());
        assert.equal(await failed.evaluate(() => document.fonts.size), 0);
        results[name].failureRetry = 'passed';
        results[name].languageRace = 'passed';
        results[name].explicitMount = 'passed';
        results[name].cleanup = 'passed';
        await page.evaluate(async () => {
            const fonts = await import('/src/locale/fontLoader.ts');
            const node = document.createElement('div');
            node.id = 'adopted';
            node.textContent = '昵称龘';
            node.className = 'r';
            document.body.append(node);
            window.adoptFonts = fonts;
            window.adoptOwner = fonts.registerFontRegion(node, [{ faces: ['r'], text: '昵称龘' }]);
        });
        await active(page, 'adopted', 'r');
        await page.evaluate(() => {
            const frame = document.createElement('iframe');
            frame.id = 'pip';
            document.body.append(frame);
            frame.contentDocument.documentElement.lang = 'zh-CN';
            frame.contentDocument.body.append(document.getElementById('adopted'));
            window.adoptFonts.migrateFontRegions();
        });
        await page.waitForFunction(() => {
            const doc = document.getElementById('pip').contentDocument;
            const family = doc.getElementById('adopted').style.getPropertyValue('--font-r').replaceAll('"', '');
            return [...doc.fonts].some((font) => font.family === family);
        });
        await page.evaluate(() => {
            const doc = document.getElementById('pip').contentDocument;
            document.body.append(doc.getElementById('adopted'));
            window.adoptFonts.migrateFontRegions();
            window.adoptFonts.stopFontLoader(doc);
        });
        await active(page, 'adopted', 'r');
        await page.evaluate(() => { window.adoptOwner.stop(); window.adoptFonts.stopFontLoader(document); });
        assert.equal(await page.evaluate(() => document.fonts.size), 0);
        results[name].documentAdoption = 'passed';
        await browser.close();
        console.log(name, JSON.stringify(results[name]));
    }
    fs.mkdirSync(new URL('../../.cache/font-browser/', import.meta.url), {
        recursive: true,
    });
    fs.writeFileSync(
        new URL('../../.cache/font-browser/results.json', import.meta.url),
        JSON.stringify(results, null, 2),
    );
    await server.close();
})().catch((e) => {
    console.error(e);
    server.close().finally(() => process.exit(1));
});
