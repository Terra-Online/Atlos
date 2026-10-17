/* global document, window, localStorage, requestAnimationFrame, getComputedStyle */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { root } from './catalog.mjs';

const { chromium } = createRequire(import.meta.url)('playwright');
const output = new URL('../../.cache/font-browser/', import.meta.url);
await fs.mkdir(output, { recursive: true });
// Keep the application's real CSS, components and early entry. A fixture that
// only waits for FontFace.load cannot detect a wrong inherited family.
const server = process.env.FONT_UI_URL
    ? undefined
    : await createServer({
          root,
          mode: 'dev',
          cacheDir: '.cache/font-browser/ui-vite',
          optimizeDeps: { entries: ['src/main.tsx'] },
          server: {
              port: 0,
              hmr: false,
              watch: { ignored: ['**/.cache/**', '**/dist/**'] },
          },
      });
await server?.listen();
const url =
    process.env.FONT_UI_URL ||
    `http://localhost:${server.httpServer.address().port}/`;
const browser = await chromium.launch();
try {
    // Finish Vite's initial dependency discovery before the measured session.
    if (server) {
        const warmup = await browser.newPage();
        await warmup.goto(url);
        await warmup.waitForSelector('[class*="filterTitle"]');
        await warmup.close();
    }
    const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
        locale: 'zh-CN',
    });
    const errors = [];
    let navigations = 0;
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) navigations++;
    });
    // Remote announcement popups are unrelated to the language control under test.
    await page.route('**/api/*/announcements**', (route) =>
        route.fulfill({
            contentType: 'application/json',
            body: route.request().url().includes('/latest')
                ? '{"latestId":null,"version":"font-test"}'
                : '[]',
        }),
    );
    await page.addInitScript(() => {
        localStorage.setItem('talos:locale', 'zh-CN');
        localStorage.setItem(
            'UserGuide',
            JSON.stringify({
                state: {
                    stepCompleted: {
                        'STEP-0_welcome': true,
                        'MSTEP-0_welcome': true,
                    },
                },
                version: 1,
            }),
        );
    });
    await page.route('**/@vite/client', async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 900));
        await route.continue();
    });
    await page.route(/\/(?:HK|JP)-.*\.woff2$/, async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 700));
        await route.continue();
    });
    await page.goto(url);
    await page.waitForSelector('[class*="filterTitle"]');
    await page.locator('[data-guide="language"]').click();
    await page.waitForSelector('[class*="langOrigin"]');
    await page.waitForFunction(() => {
        const element = document.querySelector('[class*="langDisplay"]');
        return (
            !getComputedStyle(element).fontFamily.includes('Atlos-pending') &&
            [...document.fonts].some(
                (font) =>
                    font.family === 'Lang Origin' && font.status === 'loaded',
            )
        );
    });
    const client = await page.context().newCDPSession(page);
    await client.send('DOM.enable');
    await client.send('CSS.enable');
    const platform = async (selector) => {
        const { root: node } = await client.send('DOM.getDocument');
        const { nodeId } = await client.send('DOM.querySelector', {
            nodeId: node.nodeId,
            selector,
        });
        return (await client.send('CSS.getPlatformFontsForNode', { nodeId }))
            .fonts;
    };
    const origins = async () => {
        const fonts = [];
        for (const lang of ['zh-CN', 'zh-HK', 'ja-JP'])
            fonts.push(await platform(`[class*="langOrigin"][lang="${lang}"]`));
        return fonts;
    };
    const initial = {
        sidebar: await platform('[class*="filterTitle"]'),
        origin: await origins(),
        display: await platform('[class*="langDisplay"]'),
    };
    assert(
        initial.sidebar.some(
            (font) => font.postScriptName === 'UDShinGoSCGbe-DeB',
        ),
    );
    assert(
        initial.display.some((font) =>
            /UDShinGoSC.*Med/.test(font.postScriptName),
        ),
    );
    for (const fonts of initial.origin)
        assert(fonts.some((font) => font.postScriptName === 'LangOrigin-DB'));
    await page.evaluate(() => {
        window.fontFrames = [];
        window.fontSampling = true;
        const sample = () => {
            if (!window.fontSampling) return;
            const element = document.querySelector('[class*="filterTitle"]');
            window.fontFrames.push({
                lang: document.documentElement.lang,
                text: element?.textContent,
                family: getComputedStyle(element).fontFamily,
            });
            requestAnimationFrame(sample);
        };
        sample();
    });
    const pick = (lang) =>
        page
            .locator(
                `[class*="langItem"]:has([class*="langOrigin"][lang="${lang}"])`,
            )
            .click();
    await pick('zh-HK');
    await page.waitForTimeout(200);
    assert.equal(
        await page.evaluate(() => document.documentElement.lang),
        'zh-CN',
    );
    await page.waitForFunction(() => document.documentElement.lang === 'zh-HK');
    const hk = await platform('[class*="filterTitle"]');
    assert(hk.some((font) => font.postScriptName === 'UDShinGo_HK_DB'));
    assert.deepEqual(await origins(), initial.origin);
    await pick('ja-JP');
    await page.waitForFunction(() => document.documentElement.lang === 'ja-JP');
    const jp = await platform('[class*="filterTitle"]');
    assert(jp.some((font) => font.postScriptName === 'ShinGoPr6N-DeBold'));
    assert.deepEqual(await origins(), initial.origin);
    await pick('zh-CN');
    await page.waitForFunction(() => document.documentElement.lang === 'zh-CN');
    const frames = await page.evaluate(() => {
        window.fontSampling = false;
        return window.fontFrames;
    });
    assert(!frames.some((frame) => frame.family.includes('Atlos-pending')));
    assert.equal(navigations, 1);
    // A stale language must not commit even while its replacement catalog is
    // still downloading. Cold HK fonts make this ordering deterministic.
    await page.reload();
    await page.waitForSelector('[class*="filterTitle"]');
    await page.route(/\/(?:data\/ui\/ja-JP\.json|assets\/ja-JP-[^/]+\.js)/, async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 1200));
        await route.continue();
    });
    await page.locator('[data-guide="language"]').click();
    await page.evaluate(() => {
        window.languageChanges = [];
        new MutationObserver(() =>
            window.languageChanges.push(document.documentElement.lang),
        ).observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['lang'],
        });
    });
    await pick('zh-HK');
    await page.waitForTimeout(100);
    await pick('ja-JP');
    await page.waitForFunction(() => document.documentElement.lang === 'ja-JP');
    await page.waitForTimeout(900);
    assert.equal(
        await page.evaluate(() => document.documentElement.lang),
        'ja-JP',
    );
    assert.deepEqual(await page.evaluate(() => window.languageChanges), [
        'ja-JP',
    ]);
    assert.deepEqual(await origins(), initial.origin);
    // The one explicit reload above belongs to this cold-session test.
    assert.equal(navigations, 2);
    assert.deepEqual(errors, []);
    await page.screenshot({ path: fileURLToPath(new URL('ui.png', output)) });
    const result = {
        initial,
        hk,
        jp,
        navigations,
        errors,
        frames: frames.length,
        pendingFrames: 0,
    };
    await fs.writeFile(
        new URL('ui.json', output),
        JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result, null, 2));
} finally {
    await browser.close();
    await server?.close();
}
