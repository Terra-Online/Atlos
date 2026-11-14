/* global window, localStorage */
import { createNetworkTrace } from './lib/network-trace.mjs';
import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const { values } = parseArgs({
    options: {
        url: { type: 'string', default: 'http://127.0.0.1:5176' },
        workload: { type: 'string', default: 'apps/world/bench/map02.json' },
        rounds: { type: 'string', default: '5' },
        out: { type: 'string' },
        json: { type: 'boolean' },
        headed: { type: 'boolean' },
        'backend-cache': { type: 'string', default: 'warm' },
    },
});
const rounds = Number(values.rounds);
if (!Number.isSafeInteger(rounds) || rounds < 1)
    throw new Error('rounds must be a positive integer');
if (!values.out) throw new Error('Supply --out <local results.json>');
const out = resolve(values.out);
if (!out.endsWith('.json')) throw new Error('out must end in .json');
await mkdir(dirname(out), { recursive: true });
const workload = JSON.parse(await readFile(values.workload, 'utf8'));
if (!['warm', 'observe'].includes(values['backend-cache']))
    throw new Error('backend-cache must be warm or observe');
const backend = { mode: values['backend-cache'], preparationMs: null };
if (backend.mode === 'warm') {
    const started = performance.now();
    const params = new URLSearchParams({
        generation: workload.generation,
        state: 'fully-enabled',
        scene: workload.scene,
        level: workload.query.level,
        point: workload.points[0],
        x: String(workload.query.position[0]),
        y: String(workload.query.position[1]),
        z: String(workload.query.position[2]),
        ...workload.source,
    });
    const signal = AbortSignal.timeout(workload.timeoutMs);
    for (;;) {
        const response = await fetch(
            new URL('/__routes/nearest?' + params, values.url),
            { signal },
        );
        const result = await response.json();
        if (!response.ok || result.status === 'unavailable')
            throw new Error(
                'Backend prewarm failed: ' + JSON.stringify(result),
            );
        if (result.status === 'candidate' && !result.optimizing) {
            if (result.partial)
                throw new Error(
                    'Backend prewarm produced only a partial route',
                );
            break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
        signal.throwIfAborted();
    }
    backend.preparationMs = performance.now() - started;
}
const sourceHash = createHash('sha256');
for (const name of (await readdir('apps/world', { recursive: true })).sort()) {
    if (!/\.(ts|tsx)$/.test(name)) continue;
    sourceHash.update(name + '\0').update(await readFile('apps/world/' + name));
}
sourceHash.update(await readFile(new URL(import.meta.url)));
sourceHash.update(
    await readFile(new URL('./lib/network-trace.mjs', import.meta.url)),
);
const viewerBinding = JSON.parse(
    await readFile('.cache/noclip/.generated.json', 'utf8'),
);
const solverHash = createHash('sha256');
for (const name of (
    await readdir('packages/ganglia/src', { recursive: true })
).sort()) {
    if (!name.endsWith('.ts')) continue;
    solverHash
        .update(name + '\0')
        .update(await readFile('packages/ganglia/src/' + name));
}
const solverBinding = { sourceSha256: solverHash.digest('hex') };
const browser = await chromium.launch({
    channel: 'chrome',
    headless: !values.headed,
    args: ['--enable-unsafe-webgpu'],
});
const report = {
    schemaVersion: 1,
    revision: execFileSync('git', ['rev-parse', 'HEAD'], {
        encoding: 'utf8',
    }).trim(),
    sourceSha256: sourceHash.digest('hex'),
    viewerBinding,
    solverBinding,
    backend,
    workload,
    browser: browser.version(),
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    policy: 'Browser cold/warm cache; backend preparation and completed-route cache are independent. Client bytes are decoded observed response bytes. Network bytes use CDP, including partial failed transfers. Worker requests are also captured by the browser context.',
    runs: [],
};
const save = () => writeFile(out, JSON.stringify(report, null, 2));
try {
    for (let round = 1; round <= rounds; round++) {
        const context = await browser.newContext({
            viewport: report.viewport,
            deviceScaleFactor: 1,
            locale: 'en-US',
        });
        await context.addInitScript(() =>
            localStorage.removeItem('world-view'),
        );
        try {
            for (const cache of ['cold', 'warm']) {
                const page = await context.newPage();
                const cdp = await context.newCDPSession(page);
                await cdp.send('Network.enable');
                // CDP observes without routing/interception, preserving HTTP cache behavior.
                const network = createNetworkTrace(cdp);
                const workerRequests = [];
                const workerRead = async (request) => {
                    // PackageSource currently fetches on the host. Retain any worker
                    // traffic separately so future worker fetches cannot disappear.
                    try {
                        if (!request.frame()) {
                            workerRequests.push({
                                url: request.url(),
                                sizes: await request.sizes(),
                            });
                        }
                    } catch {
                        workerRequests.push({
                            url: request.url(),
                            sizes: await request.sizes().catch(() => null),
                        });
                    }
                };
                context.on('requestfinished', workerRead);
                const errors = [];
                page.on('pageerror', (error) => errors.push(error.message));
                try {
                    await page.goto(new URL(workload.entry, values.url).href, {
                        waitUntil: 'domcontentloaded',
                        timeout: 180000,
                    });
                    await page.waitForFunction(() => window.__worldBenchmark, {
                        timeout: 180000,
                    });
                    const opened = await page.evaluate(() =>
                        window.__worldBenchmark.ready(),
                    );
                    if (
                        opened.release !== workload.release ||
                        opened.generation !== workload.generation ||
                        opened.point?.scene !== workload.scene ||
                        opened.source?.buildGuid !==
                            workload.source.buildGuid ||
                        opened.source?.contentHash !==
                            workload.source.contentHash
                    )
                        throw new Error('Scene source differs from workload');
                    // Re-opening the same page must not restore a saved camera.
                    const result = await page.evaluate(
                        (workload) => window.__worldBenchmark.run(workload),
                        workload,
                    );
                    if (result.discardedRequests)
                        throw new Error(
                            'Client trace exceeded its retention limit',
                        );
                    const requests = network
                        .snapshot()
                        .map((r) => ({ ...r }))
                        .filter(
                            (r) =>
                                r.url.includes('/oem/') ||
                                r.url.includes('/__routes/'),
                        );
                    await page.screenshot({
                        path: out.replace(/\.json$/, `-${round}-${cache}.png`),
                    });
                    const failures = requests.filter(
                        (r) =>
                            (!r.failed && r.status >= 400) ||
                            (r.failed && r.error !== 'net::ERR_ABORTED'),
                    );
                    if (errors.length || failures.length)
                        throw new Error(
                            `Workload errors: ${JSON.stringify({ errors, failures })}`,
                        );
                    const run = {
                        round,
                        cache,
                        opened,
                        ...result,
                        network: requests,
                        workerRequests: workerRequests.slice(),
                        byOperation: result.operations.map((op) => {
                            const rows = result.requests.filter(
                                (r) => r.operation === op.name,
                            );
                            return {
                                ...op,
                                requests: rows.length,
                                responseBytes: rows.reduce(
                                    (n, r) => n + r.responseBytes,
                                    0,
                                ),
                                networkTransferBytes: rows.some(
                                    (r) => r.transferBytes === null,
                                )
                                    ? null
                                    : rows.reduce(
                                          (n, r) => n + r.transferBytes,
                                          0,
                                      ),
                                serverCache: Array.from(
                                    new Set(
                                        rows
                                            .filter(
                                                (r) => r.channel === 'routing',
                                            )
                                            .map((r) => r.serverCache),
                                    ),
                                ),
                            };
                        }),
                        byCategory: Object.fromEntries(
                            Array.from(
                                new Set(result.requests.map((r) => r.category)),
                            ).map((category) => {
                                const rows = result.requests.filter(
                                    (r) => r.category === category,
                                );
                                return [
                                    category,
                                    {
                                        requests: rows.length,
                                        responseBytes: rows.reduce(
                                            (n, r) => n + r.responseBytes,
                                            0,
                                        ),
                                    },
                                ];
                            }),
                        ),
                        totals: {
                            networkTransferBytes:
                                workerRequests.length ||
                                requests.some((r) => r.transferBytes === null)
                                    ? null
                                    : requests.reduce(
                                          (n, r) => n + r.transferBytes,
                                          0,
                                      ),
                            observedNetworkBytes: requests.reduce(
                                (n, r) => n + r.observedTransferBytes,
                                0,
                            ),
                            unknownNetworkRequests: requests.filter(
                                (r) => r.transferBytes === null,
                            ).length,
                            partialNetworkRequests: requests.filter(
                                (r) => !r.complete,
                            ).length,
                            workerNetworkBytesKnown:
                                workerRequests.length === 0,

                            responseBytes: result.requests.reduce(
                                (n, r) => n + r.responseBytes,
                                0,
                            ),
                            pageNetworkTransferBytes: requests.some(
                                (r) => r.transferBytes === null,
                            )
                                ? null
                                : requests.reduce(
                                      (n, r) => n + r.transferBytes,
                                      0,
                                  ),
                            requests: requests.length,
                        },
                    };
                    report.runs.push(run);
                    await save();
                    if (!values.json)
                        console.log(
                            JSON.stringify({ round, cache, ...run.totals }),
                        );
                } catch (error) {
                    report.runs.push({
                        round,
                        cache,
                        error: String(error),
                        errors,
                        body: await page
                            .locator('body')
                            .innerText()
                            .catch(() => ''),
                        client: await page
                            .evaluate(() => window.__worldBenchmark?.snapshot())
                            .catch(() => null),
                        network: network.snapshot(),
                    });
                    await page
                        .screenshot({
                            path: out.replace(
                                /\.json$/,
                                `-${round}-${cache}-failed.png`,
                            ),
                            timeout: 10000,
                        })
                        .catch(() => {});
                    throw error;
                } finally {
                    context.off('requestfinished', workerRead);
                    await page.close();
                }
            }
        } finally {
            await context.close();
        }
    }
} finally {
    await save();
    await browser.close();
}
if (values.json) console.log(JSON.stringify(report, null, 2));
