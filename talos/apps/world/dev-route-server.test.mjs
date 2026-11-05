import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventEmitter } from 'node:events';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { routeServer } from './dev-route-server.ts';
test(
    'preserves bounded nearby grounding, supports floating targets and reports distinct failures',
    { timeout: 3000 },
    async () => {
        const directory = await mkdtemp(
                join(tmpdir(), 'world-route-diagnostic-'),
            ),
            source = { buildGuid: 'build-test', contentHash: 'hash-test' };
        const floor = (id, x, y = 0) => ({
            id,
            vertices: [
                [x, y, 0],
                [x, y, 3],
                [x + 3, y, 3],
                [x + 3, y, 0],
            ],
        });
        const anchor = {
            id: 'tp',
            position: [0.5, 0, 0.5],
            cost: 0,
            state: 'unknown',
        };
        let data = {
            scene: 'map01',
            source,
            surfaces: [floor('floor', 0)],
            arrivals: [anchor],
            options: {
                speed: 5,
                maxVertical: 0.5,
                profile: { radius: 0.35, height: 1.66 },
                walls: [],
            },
        };
        let interactionCatalog;
        async function makeRequest() {
            await writeFile(
                directory + '/map01-ground-all.json',
                JSON.stringify(data),
            );
            await writeFile(
                directory + '/travel-points.json',
                JSON.stringify({
                    source,
                    points: data.arrivals.map((a) => ({
                        ...a,
                        level: 'map01_lv001',
                    })),
                }),
            );
            if (interactionCatalog)
                await writeFile(
                    directory + '/map01-interaction-points.json',
                    JSON.stringify(interactionCatalog),
                );
            let handle;
            routeServer(directory).configureServer({
                middlewares: {
                    use: (_path, handler) => {
                        handle = handler;
                    },
                },
                config: { logger: { error: console.error } },
            });
            return async (y, x = 2.5, point) =>
                new Promise((resolve) => {
                    const params = new URLSearchParams({
                        scene: 'map01',
                        level: 'map01_lv001',
                        x: String(x),
                        y: String(y),
                        z: '.5',
                        ...source,
                    });
                    if (point) params.set('point', point);
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
        }
        try {
            let request = await makeRequest();
            let result = await request(2);
            assert.equal(result.body.status, 'candidate');
            assert.equal(result.body.grounding.heightOffset, 2);
            assert.deepEqual(
                result.body.markers.at(-1).position,
                [2.5, 2, 0.5],
            );
            assert.equal(result.body.route.points.at(-1)[1], 0);
            result = await request(5);
            assert.equal(result.body.category, 'projection-target');
            assert.ok(result.body.diagnostics.attempts.length);
            result = await request(-0.1);
            assert.equal(result.body.status, 'candidate');
            assert.equal(result.body.grounding.heightOffset, -0.1);
            assert.equal(
                result.body.grounding.method,
                'near-surface-or-downward',
            );
            result = await request(-1);
            assert.equal(result.body.category, 'projection-target');
            data.surfaces.push(floor('outside-crop', 5000));
            data.options.portals = [
                {
                    from: 'floor',
                    to: 'outside-crop',
                    points: [
                        [3, 0, 0],
                        [3, 0, 3],
                    ],
                },
            ];
            request = await makeRequest();
            result = await request(2);
            assert.equal(result.body.status, 'candidate');
            data.options.portals = [];
            data.surfaces.push(floor('upper', 0, 1));
            request = await makeRequest();
            result = await request(2);
            assert.equal(result.body.category, 'disconnected-ground');
            assert.equal(
                result.body.diagnostics.attempts[0].target.position[1],
                1,
            );
            data.surfaces = [floor('left', 0), floor('right', 5)];
            request = await makeRequest();
            result = await request(0, 6);
            assert.equal(result.body.category, 'disconnected-ground');
            data.surfaces = [floor('floor', 0)];
            data.arrivals = [
                { ...anchor, id: 'nearest', position: [5.1, 0, 0.5] },
                { ...anchor, id: 'farther', position: [0.5, 0, 2.9] },
            ];
            request = await makeRequest();
            result = await request(0);
            assert.equal(result.body.category, 'projection-anchor');
            assert.equal(result.body.anchor.id, 'nearest');

            data.surfaces = [floor('floor', 0)];
            data.arrivals = [anchor];
            const item = {
                id: '123',
                level: 'map01_lv001',
                position: [3.5, 1, 0.5],
                template: 'collection',
                templatePath: 'fixture-template.json',
                effective: { unresolved: [] },
                navigationGoal: {
                    position: [3.5, 0.6, 0.5],
                    interaction: { radius: 1.5 },
                },
            };
            interactionCatalog = { scene: 'map01', source, points: [item] };
            request = await makeRequest();
            result = await request(1, 3.5);
            assert.equal(result.body.category, 'projection-target');
            result = await request(1, 3.5, '123');
            assert.equal(result.body.status, 'candidate');
            assert.equal(
                result.body.grounding.method,
                'source-interaction-volume',
            );
            assert.equal(result.body.interaction.template, 'collection');
            const end = result.body.route.points.at(-1);
            assert.ok(
                Math.hypot(
                    ...end.map((v, i) => v - item.navigationGoal.position[i]),
                ) <= 1.5,
            );
            assert.equal(end[1], 0);
            item.navigationGoal.interaction = {
                radius: 1.5,
                facing: [1, 0, 0],
                halfAngle: 90,
            };
            request = await makeRequest();
            result = await request(1, 3.5, '123');
            assert.equal(result.body.category, 'projection-target');
            item.navigationGoal = null;
            item.effective.unresolved = ['unsupported-shape'];
            request = await makeRequest();
            result = await request(1, 3.5, '123');
            assert.equal(result.body.category, 'projection-target');
            assert.equal(result.body.interaction.status, 'unresolved');
            interactionCatalog.source = { ...source, contentHash: 'old' };
            request = await makeRequest();
            result = await request(1, 3.5, '123');
            assert.equal(result.body.category, 'stale-build');
        } finally {
            await rm(directory, { recursive: true, force: true });
        }
    },
);

test(
    'builds physical ground after a generic routing failure and reuses the completed job',
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
                state: 'unknown',
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
                    arrivals: [anchor],
                    surfaces: [],
                    options,
                }),
            );
            await writeFile(
                join(directory, 'travel-points.json'),
                JSON.stringify({
                    source,
                    points: [{ ...anchor, level: 'map01_lv001' }],
                }),
            );
            const extractor = join(directory, 'extractor');
            await mkdir(join(extractor, 'packages/extractor/src'), {
                recursive: true,
            });
            const config = join(directory, 'fixture-config.json');
            await writeFile(
                join(directory, 'movement-settings-current.json'),
                JSON.stringify({ source }),
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
                JSON.stringify({ result: fixture, routeCost: 1 }),
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
                if (fixture.failRoute) throw new Error('synthetic action search failure');
                if (Number.isFinite(fixture.routeCost)) {
                    const points = [request.arrival.position, request.target], cost = fixture.routeCost;
                    await writeFile(args[args.indexOf('-o') + 1], JSON.stringify({
                        scene: request.scene, source: request.source, status: 'candidate',
                        diagnostics: { truncated: false },
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
            let result = await request();
            assert.equal(result.body.status, 'building-ground');
            assert.equal(result.body.retryAfter, 1000);
            const deadline = Date.now() + 3000;
            do {
                await new Promise((resolve) => setTimeout(resolve, 25));
                result = await request();
            } while (
                result.body.status === 'building-ground' &&
                Date.now() < deadline
            );
            assert.equal(result.body.status, 'candidate');
            assert.match(result.body.coverage, /Physical collision ground/);
            assert.deepEqual(result.body.coverageDetails.remaining, [
                'interactive-prefabs',
            ]);
            assert.deepEqual(result.body.coverageDetails.approximations, [
                'sphere-envelope',
            ]);
            assert.ok(
                result.body.assumptions.includes(
                    'Base scene state 0 and area 0 are assumed',
                ),
            );
            result = await request({ x: '6.5' });
            const secondDeadline = Date.now() + 3000;
            while (
                result.body.status === 'building-ground' &&
                Date.now() < secondDeadline
            ) {
                await new Promise((resolve) => setTimeout(resolve, 25));
                result = await request({ x: '6.5' });
            }
            assert.equal(result.body.status, 'candidate');
            assert.equal(result.body.route.points.at(-1)[0], 6.5);
            assert.equal(await readFile(config + '.runs', 'utf8'), 'run\n');
            result = await request({ scene: 'map../01' });
            assert.equal(result.code, 400);
            result = await request({ buildGuid: 'stale' });
            assert.equal(result.body.category, 'stale-build');
            assert.equal(await readFile(config + '.runs', 'utf8'), 'run\n');

            // A separate source/build key must retain its failed job rather than retrying forever.
            await writeFile(config, JSON.stringify({ fail: true }));
            result = await request({ x: '40' });
            assert.equal(result.body.status, 'building-ground');
            const failureDeadline = Date.now() + 3000;
            do {
                await new Promise((resolve) => setTimeout(resolve, 25));
                result = await request({ x: '40' });
            } while (
                result.body.status === 'building-ground' &&
                Date.now() < failureDeadline
            );
            assert.equal(result.body.category, 'physical-build-failed');
            assert.match(
                result.body.message,
                /synthetic collision decoder failure/,
            );
            result = await request({ x: '40' });
            assert.equal(result.body.category, 'physical-build-failed');
            assert.equal(
                await readFile(config + '.runs', 'utf8'),
                'run\nrun\n',
            );

            // Wider physical coverage must use valid source input after the failed-build case.
            await writeFile(config, JSON.stringify({ result: fixture }));
            // Physical ground retains scene exclusions, including a wall absent from the bake output.
            await writeFile(
                join(directory, 'map01-ground-all.json'),
                JSON.stringify({
                    scene: 'map01',
                    source,
                    arrivals: [anchor],
                    surfaces: [],
                    options: {
                        ...options,
                        walls: [
                            {
                                min: [3, -1, -10],
                                max: [3.2, 4, 10],
                                state: 'unknown',
                            },
                        ],
                    },
                }),
            );
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
            result = await request();
            assert.equal(result.body.status, 'building-ground');
            const movementDeadline = Date.now() + 3000;
            do {
                await new Promise((resolve) => setTimeout(resolve, 25));
                result = await request();
            } while (
                result.body.status === 'building-ground' &&
                Date.now() < movementDeadline
            );
            assert.equal(result.body.category, 'movement-coverage');
            assert.match(
                result.body.log,
                /^\/__routes\/log\?path=player-routes/,
            );
            assert.deepEqual(
                result.body.diagnostics.physicalMargins,
                [24, 64, 128, 256],
            );
            assert.equal(result.body.diagnostics.traversal.walls.length, 1);
            assert.equal(
                result.body.diagnostics.traversal.walls[0].state,
                'unknown',
            );
            const routeRuns = await readFile(config + '.route-runs', 'utf8');
            result = await request();
            assert.equal(result.body.category, 'movement-coverage');
            assert.equal(
                await readFile(config + '.route-runs', 'utf8'),
                routeRuns,
            );
            assert.equal(
                await readFile(config + '.runs', 'utf8'),
                'run\n'.repeat(5),
            );
            const previousRouteRuns = (
                await readFile(config + '.route-runs', 'utf8')
            ).length;
            // Rebuilding movement rules in the same game build must invalidate both artifact stages.
            await writeFile(config, JSON.stringify({ result: fixture }));
            await writeFile(
                join(directory, 'movement-settings-current.json'),
                JSON.stringify({ source, policy: 'updated' }),
            );
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
            result = await request();
            assert.equal(result.body.status, 'building-ground');
            const revisedDeadline = Date.now() + 3000;
            do {
                await new Promise((resolve) => setTimeout(resolve, 25));
                result = await request();
            } while (
                result.body.status === 'building-ground' &&
                Date.now() < revisedDeadline
            );
            assert.equal(result.body.category, 'movement-coverage');
            assert.equal(
                await readFile(config + '.runs', 'utf8'),
                'run\n'.repeat(9),
            );
            assert.ok(
                (await readFile(config + '.route-runs', 'utf8')).length >
                    previousRouteRuns,
            );
            const policies = (
                await readFile(config + '.movement-files', 'utf8')
            )
                .trim()
                .split('\n')
                .map(JSON.parse);
            assert.notEqual(policies[0].path, policies.at(-1).path);
            assert.equal(policies.at(-1).data.policy, 'updated');
            assert.deepEqual(
                JSON.parse(await readFile(policies[0].path, 'utf8')),
                { source },
            );
            // Successful ground queries now enqueue action optimization too. Keep
            // that incumbent visible through polling, failures and slower results.
            await writeFile(
                join(directory, 'map01-ground-all.json'),
                JSON.stringify({
                    scene: 'map01',
                    source,
                    options,
                    surfaces: [floor],
                    arrivals: [anchor],
                }),
            );
            for (const scenario of [
                { name: 'faster', routeCost: 0.2 },
                { name: 'slower', routeCost: 99 },
                { name: 'unavailable' },
                { name: 'failure', failRoute: true },
            ]) {
                await Promise.all(
                    httpServer
                        .rawListeners('close')
                        .map((listener) => listener.call(httpServer)),
                );
                await writeFile(
                    config,
                    JSON.stringify({ result: fixture, ...scenario }),
                );
                await writeFile(
                    join(directory, 'movement-settings-current.json'),
                    JSON.stringify({ source, scenario: scenario.name }),
                );
                const buildsBefore = (await readFile(config + '.runs', 'utf8'))
                    .trim()
                    .split('\n').length;
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
                const initial = await request();
                assert.equal(initial.body.status, 'candidate');
                assert.equal(initial.body.optimizing, true);
                const baselineCost = initial.body.route.cost;
                const concurrent = await Promise.all([
                    request(),
                    request(),
                    request(),
                ]);
                for (const response of concurrent) {
                    assert.equal(response.body.status, 'candidate');
                    assert.ok(response.body.route.cost <= baselineCost);
                }
                let final = concurrent.at(-1);
                const deadline = Date.now() + 3000;
                while (final.body.optimizing && Date.now() < deadline) {
                    await new Promise((resolve) => setTimeout(resolve, 25));
                    final = await request();
                    assert.equal(final.body.status, 'candidate');
                    assert.ok(final.body.route.cost <= baselineCost);
                }
                assert.equal(final.body.optimizing, false);
                assert.equal(
                    final.body.route.cost,
                    scenario.name === 'faster' ? 0.2 : baselineCost,
                );
                assert.equal(
                    (await request()).body.route.cost,
                    final.body.route.cost,
                );
                assert.equal(
                    (await readFile(config + '.runs', 'utf8'))
                        .trim()
                        .split('\n').length,
                    buildsBefore + 1,
                );
            }
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
