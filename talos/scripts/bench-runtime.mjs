/* global window, document, localStorage, requestAnimationFrame */
import { parseArgs } from 'node:util';
import { writeFile, mkdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Buffer } from 'node:buffer';
import { resolve, dirname, basename } from 'node:path';
import { createMapBrowser, exerciseMapInteractions } from './lib/map-browser.mjs';

const { values } = parseArgs({ options: {
    baseline: { type: 'string' }, candidate: { type: 'string' },
    rounds: { type: 'string', default: '10' },
    'soak-minutes': { type: 'string', default: '0' },
    out: { type: 'string', default: '.cache/runtime-perf/results.json' },
    'heap-snapshots': { type: 'boolean', default: false },
    scenario: { type: 'string', default: 'camera' },
    seed: { type: 'string', default: '20261024' },
    headed: { type: 'boolean', default: false },
    'gpu-trace': { type: 'boolean', default: false },
    'map-hover': { type: 'boolean', default: false },
    'window-position': { type: 'string' },
} });
if (!values.baseline || !values.candidate) throw new Error('Provide --baseline and --candidate production build directories.');
const rounds = Number(values.rounds), minutes = Number(values['soak-minutes']);
if (!Number.isInteger(rounds) || rounds < 2 || !Number.isFinite(minutes) || minutes < 0) throw new Error('Invalid rounds or soak duration.');
if (!['camera', 'mixed'].includes(values.scenario) || !Number.isInteger(Number(values.seed))) throw new Error('Invalid scenario or seed.');
const windowPosition = values['window-position']?.split(',').map(Number);
if (windowPosition && (!values.headed || windowPosition.length !== 2 || !windowPosition.every(Number.isFinite))) throw new Error('Window position requires --headed and two coordinates.');
let seed = Number(values.seed) >>> 0;
const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
const out = resolve(values.out);
await mkdir(dirname(out), { recursive: true });
const result = { startedAt: new Date().toISOString(), scenario: values.scenario, seed: values.seed,
    headed: values.headed, mapHover: values['map-hover'], gpuTrace: values['gpu-trace'],
    environment: {}, rounds: [], soak: [], actions: {}, errors: [] };
const save = () => writeFile(out, JSON.stringify(result, null, 2));
const { open, close } = await createMapBrowser({ baseline: values.baseline, candidate: values.candidate, headed: values.headed, windowPosition,
    onError: error => result.errors.push(error) });
async function toggle(page, variant, round) {
    const measurement = await page.evaluate(async ({ variant, round }) => {
        const bench = window.__runtimeBench;
        performance.mark(`atlos:${variant}:${round}:start`);
        const start = performance.now(), frames = [];
        let done = false, last;
        const frame = time => { if (last !== undefined) frames.push(time - last); last = time; if (!done) requestAnimationFrame(frame); };
        requestAnimationFrame(frame);
        document.querySelector('button[class*="sidebarToggle"]').click();
        await new Promise(resolve => window.setTimeout(resolve, 500));
        done = true;
        performance.mark(`atlos:${variant}:${round}:end`);
        frames.sort((a, b) => a - b);
        const resizes = bench.resizes.filter(event => event.start >= start);
        const tasks = bench.longTasks.filter(event => event.startTime >= start);
        const copies = bench.copies.filter(event => event.start >= start);
        const byFrame = new Map();
        for (const event of copies) if (event.frame !== null) byFrame.set(event.frame, (byFrame.get(event.frame) ?? 0) + 1);
        const geometry = Object.fromEntries(['switchArea', 'mainFilterList', 'scaleContainer', 'sidebarToggle'].map(name => {
            const element = document.querySelector(`[class*="_${name}_"]`);
            if (!element) return [name, null];
            const { x, y, width, height } = element.getBoundingClientRect();
            return [name, { x, y, width, height }];
        }));
        return { p50: frames[Math.floor(frames.length * 0.5)], p95: frames[Math.floor(frames.length * 0.95)],
            max: Math.max(...frames), frames: frames.length, over2T: frames.filter(value => value > 33.4).length,
            gpuResizes: resizes.length, gpuResizeMs: resizes.reduce((sum, event) => sum + event.ms, 0),
            longTasks: tasks.length, longTaskMs: tasks.reduce((sum, event) => sum + event.duration, 0),
            gpuDraws: bench.draws.filter(time => time >= start).length, gpuCopies: copies.length,
            duplicateCopyFrames: [...byFrame.values()].filter(count => count > 1).length,
            maxCopiesPerFrame: Math.max(0, ...byFrame.values()),
            over60Hz: frames.filter(value => value > 25).length, over120Hz: frames.filter(value => value > 12.5).length,
            over144Hz: frames.filter(value => value > 1000 / 144 * 1.5).length,
            gpuCopyPixels: copies.reduce((sum, event) => sum + event.pixels, 0), geometry };
    }, { variant, round });
    return { variant, round, ...measurement };
}
async function snapshot({ page, cdp }, phase) {
    const beforeGC = await cdp.send('Runtime.getHeapUsage');
    await cdp.send('HeapProfiler.collectGarbage');
    const heap = await cdp.send('Runtime.getHeapUsage');
    const dom = await cdp.send('Memory.getDOMCounters');
    const visible = await page.evaluate(() => ({ nodes: document.querySelectorAll('*').length,
        markers: document.querySelectorAll('.oem-canvas-semantics .leaflet-marker-icon').length,
        canvases: [...document.querySelectorAll('canvas')].map(canvas => ({ width: canvas.width, height: canvas.height })) }));
    return { phase, at: new Date().toISOString(), beforeGC, heap, dom, visible };
}
const countAction = name => { result.actions[name] = (result.actions[name] ?? 0) + 1; };
const mixedCycle = page => exerciseMapInteractions(page, { random, record: countAction });
async function heapSnapshot(cdp, name) {
    if (!values['heap-snapshots']) return;
    const stream = createWriteStream(resolve(dirname(out), `${name}.heapsnapshot`));
    const append = ({ chunk }) => stream.write(chunk);
    cdp.on('HeapProfiler.addHeapSnapshotChunk', append);
    try { await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false }); }
    finally { cdp.off('HeapProfiler.addHeapSnapshotChunk', append); await new Promise(done => stream.end(done)); }
}
async function stopTrace(cdp, name) {
    const complete = new Promise(done => cdp.once('Tracing.tracingComplete', done));
    await cdp.send('Tracing.end');
    const { stream } = await complete;
    const compressed = createGzip();
    const finished = pipeline(compressed, createWriteStream(resolve(dirname(out), `${basename(out, '.json')}-${name}-trace.json.gz`)));
    try {
        for (;;) {
            const chunk = await cdp.send('IO.read', { handle: stream });
            const data = chunk.base64Encoded ? Buffer.from(chunk.data, 'base64') : chunk.data;
            if (!compressed.write(data)) await new Promise(done => compressed.once('drain', done));
            if (chunk.eof) break;
        }
    } finally { await cdp.send('IO.close', { handle: stream }); compressed.end(); await finished; }
}
try {
    // Each frozen build uses the same input and an isolated browser profile.
    for (const variant of ['baseline', 'candidate']) {
        const run = await open(variant);
        if (values['map-hover']) { await run.page.mouse.move(1190, 750); await run.page.waitForTimeout(150); }
        if (values['gpu-trace']) await run.cdp.send('Tracing.start', {
            categories: 'devtools.timeline,blink.user_timing,cc,gpu,viz', transferMode: 'ReturnAsStream',
        });
        result.environment = await run.page.evaluate(() => ({ ua: window.navigator.userAgent,
            viewport: [window.innerWidth, window.innerHeight], dpr: window.devicePixelRatio,
            screen: [window.screen.width, window.screen.height, window.screen.availLeft, window.screen.availTop],
            window: [window.screenX, window.screenY, window.outerWidth, window.outerHeight],
            filters: JSON.parse(localStorage.getItem('marker-filter')).state.filter.length }));
        const idle = await run.page.evaluate(async () => {
            const frames = [];
            await new Promise(done => { let start, previous; const sample = time => {
                if (previous !== undefined) frames.push(time - previous); previous = time; start ??= time;
                if (time - start < 500) requestAnimationFrame(sample); else done();
            }; requestAnimationFrame(sample); });
            frames.sort((a, b) => a - b);
            return { frames: frames.length, p50: frames[Math.floor(frames.length / 2)], p95: frames[Math.floor(frames.length * 0.95)] };
        });
        result[`${variant}Idle`] = idle;
        result.rounds.push(await toggle(run.page, variant, 'first'));
        for (let i = 0; i < rounds; i++) result.rounds.push(await toggle(run.page, variant, i));
        if (values['gpu-trace']) await stopTrace(run.cdp, variant);
        result[`${variant}Memory`] = await snapshot(run, 'warm');
        await run.context.close(); await save();
        console.log(JSON.stringify({ variant, rounds: result.rounds.filter(row => row.variant === variant) }));
    }
    if (minutes > 0) {
        const run = await open('candidate');
        // Warm both regions once before measuring retained memory.
        for (const label of ['Wuling', 'Valley IV']) {
            await run.page.getByRole('button', { name: label, exact: true }).click();
            await run.page.waitForTimeout(1500);
        }
        await toggle(run.page, 'candidate', 'soak-warm');
        await toggle(run.page, 'candidate', 'soak-warm');
        result.soak.push(await snapshot(run, 'start'));
        await heapSnapshot(run.cdp, 'start'); await save();
        const started = Date.now(); let cycle = 0, checkpoint = 1;
        while (Date.now() - started < minutes * 60_000) {
            await toggle(run.page, 'candidate', cycle++);
            await toggle(run.page, 'candidate', cycle++);
            if (values.scenario === 'mixed') await mixedCycle(run.page);
            const box = await run.page.locator('#map').boundingBox();
            await run.page.mouse.move(box.x + 850, box.y + 350);
            await run.page.mouse.down();
            await run.page.mouse.move(box.x + 900, box.y + 380, { steps: 10 });
            await run.page.mouse.move(box.x + 850, box.y + 350, { steps: 10 });
            await run.page.mouse.up();
            if (cycle % 10 === 0) {
                for (const label of ['Wuling', 'Valley IV']) {
                    await run.page.getByRole('button', { name: label, exact: true }).click();
                    await run.page.waitForTimeout(1000);
                }
            }
            await run.page.waitForTimeout(750);
            if (Date.now() - started >= checkpoint * 60_000) {
                const sample = await snapshot(run, `minute-${checkpoint}`);
                sample.interaction = await toggle(run.page, 'candidate', 'checkpoint');
                await toggle(run.page, 'candidate', 'checkpoint');
                result.soak.push(sample); await save();
                console.log(JSON.stringify(sample)); checkpoint++;
            }
            // Diagnostic arrays cannot become the source of a soak-test leak.
            await run.page.evaluate(() => { window.__runtimeBench.resizes = []; window.__runtimeBench.longTasks = [];
                window.__runtimeBench.draws = []; window.__runtimeBench.copies = []; window.__runtimeBench.frameDraws = []; });
        }
        result.soak.push(await snapshot(run, 'end'));
        await heapSnapshot(run.cdp, 'end'); await run.context.close();
    }
    result.finishedAt = new Date().toISOString(); await save();
} finally { await close(); }
