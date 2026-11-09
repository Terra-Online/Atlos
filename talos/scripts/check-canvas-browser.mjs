/* global document, HTMLCanvasElement, Image */
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
    const page = await browser.newPage();
    await page.goto(process.env.ATLOS_DEV_URL ?? 'http://localhost:5173', { waitUntil: 'domcontentloaded' });
    const results = await page.evaluate(async () => {
        const { CanvasSpriteBatch } = await import('/src/services/map/core/canvas/canvasSpriteBatch.ts');
        const { getItemIconUrl } = await import('/src/services/assets/resource.ts');
        const results = [];
        for (const ratio of [1, 1.5, 2, 3]) {
            const output = document.createElement('canvas'); output.width = 128 * ratio; output.height = 96 * ratio;
            const batch = CanvasSpriteBatch.create(output, () => {});
            if (!batch) throw new Error('WebGL2 is required for the browser correctness gate.');
            const image = document.createElement('canvas'); image.width = image.height = 24 * ratio;
            const ctx = image.getContext('2d'); ctx.fillStyle = 'rgba(255,0,0,0.7)'; ctx.fillRect(0, 0, image.width, image.height);
            ctx.fillStyle = 'blue'; ctx.fillRect(0, 0, image.width / 2, image.height / 2);
            const sprite = { canvas: image, x: 0, y: 0, width: 24, height: 24 }, a = {}, b = {};
            try {
                batch.begin(output.width, output.height, ratio, 2);
                batch.add(a, sprite, 4, 5, 1); batch.add(b, sprite, 60, 40, 1); batch.end();
                const descriptors = ['width', 'height'].map(key => [key, Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, key)]);
                let resizes = 0;
                for (const [key, descriptor] of descriptors) Object.defineProperty(batch.source, key, {
                    configurable: true, get() { return descriptor.get.call(this); }, set(value) { resizes++; descriptor.set.call(this, value); },
                });
                batch.release(a);
                batch.begin(output.width, output.height, ratio, 0, { x: 0, y: 0, width: 32.25, height: 32.25 }); batch.end();
                const partial = batch.readPixels(0, 0, output.width, output.height);
                const presentedPixels = batch.stats.presentedPixels;
                batch.begin(output.width, output.height, ratio, 1); batch.add(b, sprite, 60, 40, 1); batch.end();
                const full = batch.readPixels(0, 0, output.width, output.height);
                const blue = batch.readPixels(Math.round(64 * ratio), Math.round(44 * ratio), 1, 1);
                results.push({ ratio, equal: partial.every((value, i) => value === full[i]), resizes, presentedPixels, blue: [...blue] });
            } finally { batch.dispose(); }
        }
        const output = document.createElement('canvas'); output.width = output.height = 512;
        const detail = new Image(); detail.src = getItemIconUrl('tp_point'); await detail.decode();
        const batch = CanvasSpriteBatch.create(output, () => {}), keys = [], sprites = [];
        try {
            batch.begin(512, 512, 1, 40);
            for (let i = 0; i < 40; i++) {
                const canvas = document.createElement('canvas'); canvas.width = canvas.height = 240;
                const context = canvas.getContext('2d');
                context.globalAlpha = (i % 3 + 1) / 3; context.drawImage(detail, 0, 0, 240, 240); context.globalAlpha = 1;
                context.font = '19px sans-serif'; context.fillStyle = `rgb(${i * 5},${255 - i * 5},60)`;
                context.shadowColor = 'rgba(0,0,0,0.7)'; context.shadowBlur = 4; context.fillText(`L${i}`, 8, 28);
                const sprite = { canvas, x: 0, y: 0, width: 240, height: 240 }, key = {};
                keys.push(key); sprites.push(sprite); batch.add(key, sprite, i % 2 * 240, Math.floor(i / 2) % 2 * 240, 1);
            }
            batch.end(); const before = batch.stats.atlasBytes;
            for (let i = 0; i < 37; i++) batch.release(keys[i]);
            const paint = () => { batch.begin(512, 512, 1, 3); for (let i = 37; i < 40; i++) batch.add(keys[i], sprites[i], (i - 37) * 100, 100, 1); batch.end(); };
            // Warm presentation/readback before isolating atlas relocation. The
            // first read can differ even when the identical frame is redrawn.
            paint(); batch.readPixels(0, 0, 512, 512);
            paint(); const previous = batch.readPixels(0, 0, 512, 512);
            batch.compact(); paint(); const compacted = batch.readPixels(0, 0, 512, 512);
            let maxAlphaDelta = 0, maxPremultipliedDelta = 0, changed = 0;
            for (let i = 0; i < previous.length; i += 4) {
                const alpha = previous[i + 3], nextAlpha = compacted[i + 3];
                maxAlphaDelta = Math.max(maxAlphaDelta, Math.abs(alpha - nextAlpha));
                let delta = Math.abs(alpha - nextAlpha);
                for (let channel = 0; channel < 3; channel++) {
                    const difference = Math.abs(previous[i + channel] * alpha / 255 - compacted[i + channel] * nextAlpha / 255);
                    maxPremultipliedDelta = Math.max(maxPremultipliedDelta, difference); delta = Math.max(delta, difference);
                }
                if (delta) changed++;
            }
            results.push({ compact: true, before, after: batch.stats.atlasBytes, equal: previous.every((value, i) => value === compacted[i]),
                maxAlphaDelta, maxPremultipliedDelta, changed });
        } finally { batch.dispose(); }
        const L = await import('/node_modules/leaflet/dist/leaflet-src.esm.js');
        const { CanvasMarkerSurface } = await import('/src/services/map/core/canvas/canvasMarkerSurface.ts');
        const host = document.createElement('div');
        host.style.cssText = 'position:fixed;left:-10000px;width:800px;height:600px'; document.body.append(host);
        const map = L.map(host, { crs: L.CRS.Simple, zoomAnimation: false }).setView([0, 0], 2);
        const surface = new CanvasMarkerSurface(map);
        try {
            const gl = surface.batch?.gl;
            if (!gl) throw new Error('WebGL2 is required for context-loss verification.');
            gl.getExtension('WEBGL_lose_context').loseContext();
            await new Promise(done => setTimeout(done, 100));
            results.push({ fallback: surface.getRendererStats().backend === 'canvas2d' });
        } finally { map.remove(); }
        results.push({ removed: host.querySelectorAll('canvas').length === 0 }); host.remove();
        return results;
    });
    for (const result of results) {
        if ('fallback' in result) { assert.equal(result.fallback, true); continue; }
        if ('removed' in result) { assert.equal(result.removed, true); continue; }
        assert.equal(result.equal, true, JSON.stringify(result));
        if (result.compact) assert.ok(result.after <= result.before / 2);
        else { assert.equal(result.resizes, 0); assert.deepEqual(result.blue, [0, 0, 255, 255]); }
    }
    console.log(JSON.stringify({ passed: true, results }, null, 2));
} finally { await browser.close(); }
