import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { routeServer } from './dev-route-server.ts';
import { physicalApproaches } from './physical-route-builder.ts';

test('ranks local and corridor coverage by tile cost for every endpoint geometry', () => {
    const corridor = {
        kind: 'corridor-proposal',
        bounds: { min: [-38.4, -38.4], max: [76.8, 76.8] },
        tiles: Array.from({ length: 9 }, (_, index) => ({
            x: (index % 3) - 1,
            z: Math.floor(index / 3) - 1,
        })),
        coarse: {
            regions: 1,
            edges: 0,
            path: [
                [0, 0, 0],
                [1, 0, 1],
            ],
            halo: 1,
        },
    };
    for (const elevation of [0, 10, 100, 1000]) {
        const approaches = physicalApproaches(
            [0, elevation, 0],
            [1, 0, 1],
            [corridor],
        );
        assert.equal(approaches[0].corridor, undefined);
        assert.ok(
            approaches.some((approach) => approach.corridor === corridor),
        );
    }
    const longCorridor = {
        ...corridor,
        bounds: { min: [-38.4, -38.4], max: [1036.8, 1036.8] },
        tiles: Array.from({ length: 81 }, (_, index) => ({
            x: Math.floor(index / 3),
            z: Math.floor(index / 3) + (index % 3) - 1,
        })),
    };
    const far = physicalApproaches([0, 0, 0], [1000, 0, 1000], [longCorridor]);
    assert.equal(far[0].corridor, longCorridor);
    assert.deepEqual(
        far
            .filter((approach) => !approach.corridor)
            .map((approach) => approach.margin),
        [24, 64, 128, 256],
    );
});
test(
    'polls global candidates and bounded windows, distinguishes partial output and caches terminal results',
    { timeout: 15000 },
    async () => {
        const directory = await mkdtemp(join(tmpdir(), 'world-route-build-'));
        const source = { buildGuid: 'build-test', contentHash: 'hash-test' };
        const httpServer = new EventEmitter();
        try {
            const options = {
                speed: 5,
                maxVertical: 0.5,
                profile: { radius: 0.35, height: 1.66 },
                walls: [],
            };
            const anchor = {
                id: 'tp',
                position: [0.5, 0, 0.5],
                cost: 0,
                state: 'available',
            };
            const floor = {
                id: 'physical',
                vertices: [
                    [0, 0, 0],
                    [0, 0, 3],
                    [8, 0, 3],
                    [8, 0, 0],
                ],
            };
            await writeFile(
                join(directory, 'map01-ground-all.json'),
                JSON.stringify({
                    scene: 'map01',
                    source,
                    arrivals: [anchor, { ...anchor, id: 'alternate', position: [1, 0, 0.5] }],
                    surfaces: [floor],
                    options,
                }),
            );
            await writeFile(
                join(directory, 'travel-points.json'),
                JSON.stringify({
                    source,
                    points: [{ ...anchor, level: 'map01_lv001' }, { ...anchor, id: 'alternate', position: [1, 0, 0.5], level: 'map01_lv002' }],
                }),
            );
            const extractor = join(directory, 'extractor');
            await mkdir(join(extractor, 'packages/extractor/src'), {
                recursive: true,
            });
            const config = join(directory, 'fixture-config.json');
            await writeFile(
                join(directory, 'movement-settings-current.json'),
                JSON.stringify({ source, sustainedSprint: { speed: 5, sprintSpeed: 5, sprintAcceleration: 1 } }),
            );
            const fixture = {
                scene: 'map01',
                source,
                options,
                surfaces: [floor],
                selection: { sceneState: 0, area: 0 },
                coverage: {
                    complete: false,
                    remaining: ['interactive-prefabs'],
                    approximations: ['sphere-envelope'],
                },
            };
            await writeFile(
                config,
                JSON.stringify({
                    result: fixture,
                    routeCost: 1,
                    supportBoxes: [
                        {
                            device: 'borrowed-box',
                            family: 'conveyor',
                            role: 'use',
                            min: [2, 0, 0],
                            max: [4, 2, 2],
                        },
                    ],
                }),
            );
            await writeFile(
                join(extractor, 'packages/extractor/src/cli.ts'),
                `
            import { readFile, writeFile } from 'node:fs/promises';
            const args = process.argv.slice(2);
            if (args.includes('--identity')) {console.log(JSON.stringify({generator:'fixture-generator'}));process.exit(0);}
            if (args[0] === 'player-route') {
                const request = JSON.parse(await readFile(args[args.indexOf('--request') + 1], 'utf8'));
                await writeFile(${JSON.stringify(config + '.route-runs')}, 'route\\n', { flag: 'a' });
                const fixture = JSON.parse(await readFile(${JSON.stringify(config)}, 'utf8'));
                await new Promise(resolve => setTimeout(resolve, 60));
                if (fixture.failRoute || (fixture.onlyTail && request.arrival.id !== 'target-approach') || (fixture.failPrefix && request.arrival.id !== 'target-approach' && request.arrival.id !== 'alternate')) throw new Error('synthetic action search failure');
                if (Number.isFinite(fixture.routeCost)) {
                    const points = [request.arrival.position, request.target], cost = fixture.routeCost;
                    await writeFile(args[args.indexOf('-o') + 1], JSON.stringify({
                        scene: request.scene, source: request.source, status: 'candidate',
                        diagnostics: { truncated: false },
                        supportBoxes: fixture.supportBoxes,
                        route: { status: 'complete', start: request.arrival.id, arrivalCost: 0, cost,
                            length: Math.hypot(...points[0].map((v,i)=>v-points[1][i])), points,
                            segments: [{ mode: 'walk', points, times: [0, cost] }] },
                    }));
                    process.exit(0);
                }
                await writeFile(args[args.indexOf('-o') + 1], JSON.stringify({
                    scene: request.scene, source: request.source, status: 'unavailable',
                    diagnostics: { walls: request.walls },
                }));
                process.exit(0);
            }
            const config = args[args.indexOf('--config') + 1];
            const fixture = JSON.parse(await readFile(config, 'utf8'));
            const movementPath = args[args.indexOf('--movement-settings') + 1];
            await writeFile(config + '.movement-files', JSON.stringify({
                path: movementPath, data: JSON.parse(await readFile(movementPath, 'utf8')),
            }) + '\\n', { flag: 'a' });
            await writeFile(config + '.runs', 'run\\n', { flag: 'a' });
            await new Promise(resolve => setTimeout(resolve, 60));
            if (fixture.fail) {
                process.stderr.write('Error: synthetic collision decoder failure\\n');
                process.exitCode = 1;
            } else {
                const bounds = args.find(value => value.startsWith('--bounds=')).slice(9).split(',').map(Number);
                await writeFile(args[args.indexOf('-o') + 1], JSON.stringify({ ...fixture.result,
                    build: { bounds: { min: bounds.slice(0, 2), max: bounds.slice(2) } } }));
            }
        `,
            );
            let handle;
            routeServer(directory, {
                extractor,
                config,
                node: process.execPath,
            }).configureServer({
                httpServer,
                middlewares: {
                    use: (_path, handler) => {
                        handle = handler;
                    },
                },
                config: { logger: { error: console.error } },
            });
            const request = async (overrides = {}) =>
                new Promise((resolve) => {
                    const params = new URLSearchParams({
                        scene: 'map01',
                        level: 'map01_lv001',
                        x: '5.5',
                        y: '0',
                        z: '.5',
                        ...source,
                        ...overrides,
                    });
                    handle(
                        { method: 'GET', url: '/?' + params },
                        {
                            statusCode: 200,
                            setHeader() {},
                            end(body) {
                                resolve({
                                    code: this.statusCode,
                                    body: JSON.parse(body),
                                });
                            },
                        },
                    );
                });
            const poll = async (overrides = {}, terminal = false) => {
                const deadline = Date.now() + 5000;
                let result;
                do {
                    result = await request(overrides);
                    if (result.body.status !== 'building-ground' && (!terminal || !result.body.optimizing)) return result;
                    await new Promise(resolve => setTimeout(resolve, 25));
                } while (Date.now() < deadline);
                throw new Error('Route polling timed out: ' + JSON.stringify(result.body));
            };
            let result = await request();
            assert.equal(result.body.status, 'building-ground');
            assert.equal(result.body.retryAfter, 1000);
            result = await poll();
            assert.equal(result.body.status, 'candidate');
            assert.equal(result.body.partial, true);
            assert.equal(result.body.optimizing, true);
            assert.match(result.body.title, /Partial/);
            assert.equal(result.body.markers[0].label, 'Local approach start');
            assert.equal(result.body.supportBoxes[0].device, 'borrowed-box');
            result = await poll({}, true);
            assert.equal(result.body.partial, false);
            assert.equal(result.body.optimizing, false);
            assert.equal(result.body.title, 'Teleport → Target');
            assert.equal(result.body.markers[0].label, 'Teleport');
            assert.equal(result.body.route.points.at(-1)[0], 5.5);
            const runs = await readFile(config + '.route-runs', 'utf8');
            assert.deepEqual((await request()).body, result.body);
            assert.equal(await readFile(config + '.route-runs', 'utf8'), runs);
            assert.equal((await request({ scene: 'map../01' })).code, 400);
            assert.equal((await request({ buildGuid: 'stale' })).body.category, 'stale-build');
            const missing = await poll({ x: '500' }, true);
            assert.equal(missing.body.status, 'unavailable');
            assert.equal(missing.body.category, 'candidate-search');
            assert.deepEqual((await request({ x: '500' })).body, missing.body);
            // Preserve a verified tail while retrying another scene anchor after a prefix failure.
            await writeFile(config, JSON.stringify({ result: fixture, routeCost: 1, failPrefix: true }));
            const rerouted = await poll({ x: '7' }, true);
            assert.equal(rerouted.body.status, 'candidate');
            assert.equal(rerouted.body.partial, false);
            assert.equal(rerouted.body.anchor.id, 'alternate');
            assert.equal(rerouted.body.route.start, 'alternate');
            await writeFile(config, JSON.stringify({ result: fixture, routeCost: 1, onlyTail: true }));
            const partial = await poll({ x: '7.5' }, true);
            assert.equal(partial.body.status, 'candidate');
            assert.equal(partial.body.partial, true);
            assert.equal(partial.body.optimizing, false);
            assert.match(partial.body.title, /Partial/);
            assert.equal(partial.body.markers[0].label, 'Local approach start');
            assert.deepEqual((await request({ x: '7.5' })).body, partial.body);
            // A failed physical search is terminal, and subsequent polls retain it.
            await writeFile(config, JSON.stringify({ result: fixture, failRoute: true }));
            const failed = await poll({ x: '6.5' }, true);
            assert.equal(failed.body.status, 'unavailable');
            assert.equal(failed.body.category, 'window-route');
            const failedRuns = await readFile(config + '.route-runs', 'utf8');
            assert.deepEqual((await request({ x: '6.5' })).body, failed.body);
            assert.equal(await readFile(config + '.route-runs', 'utf8'), failedRuns);
        } finally {
            await Promise.all(
                httpServer
                    .rawListeners('close')
                    .map((listener) => listener.call(httpServer)),
            );
            await rm(directory, { recursive: true, force: true });
        }
    },
);

test('serves retained task logs while rejecting paths outside the task directories', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'world-route-logs-'));
    const handlers = new Map();
    const plugin = routeServer(directory);
    try {
        await mkdir(join(directory, 'player-routes'));
        await writeFile(
            join(directory, 'route-jobs.jsonl'),
            '{"event":"queued"}\n',
        );
        await writeFile(
            join(directory, 'player-routes/map01-fixture.json.progress.jsonl'),
            '{"phase":"ground-route"}\n',
        );
        plugin.configureServer({
            middlewares: {
                use: (path, handler) => handlers.set(path, handler),
            },
        });
        const get = (path, url) =>
            new Promise((resolve) => {
                handlers.get(path)(
                    { method: 'GET', url },
                    {
                        statusCode: 200,
                        setHeader() {},
                        end(text) {
                            resolve({ code: this.statusCode, text });
                        },
                    },
                );
            });
        assert.equal((await get('/__routes/logs', '/')).code, 200);
        const valid = await get(
            '/__routes/log',
            '/?path=player-routes%2Fmap01-fixture.json.progress.jsonl',
        );
        assert.equal(valid.code, 200);
        assert.match(valid.text, /ground-route/);
        assert.equal(
            (await get('/__routes/log', '/?path=..%2Fendfield.local.json'))
                .code,
            404,
        );
    } finally {
        plugin.closeBundle();
        await rm(directory, { recursive: true, force: true });
    }
});

for (const scenario of ['unmapped', 'disconnected']) {
    test(`global candidate rejects ${scenario} nearest anchor and selects a connected scene anchor`, async () => {
        const directory = await mkdtemp(join(tmpdir(), 'world-global-arrivals-'));
        const source = { buildGuid: 'fixture', contentHash: 'fixture' };
        const { candidateJobs } = await import('./candidate-job.ts');
        const jobs = candidateJobs(directory);
        try {
            const surfaces = [{ id: 'floor', vertices: [[0, 0, 0], [8, 0, 0], [8, 0, 4], [0, 0, 4]] }];
            if (scenario === 'disconnected') surfaces.push({ id: 'upper', vertices: [[4, 2, 0], [8, 2, 0], [8, 2, 4], [4, 2, 4]] });
            await writeFile(join(directory, 'map01-ground-all.json'), JSON.stringify({ source, surfaces,
                options: { speed: 5, maxVertical: 0.5, walls: [], profile: { radius: 0.35, height: 1.66 } } }));
            const job = jobs.start({ scene: 'map01', source, target: [6, 0, 1], arrivals: [
                { id: 'bad', position: [5, 2, 1], cost: 0, state: 'available' },
                { id: 'good', position: [1, 0, 1], cost: 0, state: 'available' },
            ] });
            const deadline = Date.now() + 3000;
            while (job.status === 'pending' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
            assert.equal(job.status, 'ready');
            assert.equal(job.result.status, 'candidate');
            assert.equal(job.result.arrival.id, 'good');
            assert.deepEqual(job.result.points.at(-1), [6, 0, 1]);
        } finally { jobs.close(); await rm(directory, { recursive: true, force: true }); }
    });
}
