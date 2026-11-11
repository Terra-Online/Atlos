// @vitest-environment node
import {writePhysicalAdapter} from "../../../test-support/physical-adapter.mjs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { expect, test } from 'vitest';
import { physicalRouteBuilder, routeAttempts, physicalMargins } from '../physical-route-builder';

test('publishes walking progress and resumes an interrupted provisional cache', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'world-route-progress-'));
    const options = {
        directory: join(directory, 'data'),
        extractor: directory,
        config: 'fixture',
        solver: 'fixture',
        node: process.execPath,
    };
    await mkdir(options.directory, { recursive: true });
    await mkdir(join(directory, 'packages/extractor/src'), { recursive: true });
    await writeFile(
        join(options.directory, 'movement-settings-current.json'),
        '{}',
    );
    await writeFile(
        join(directory, 'packages/extractor/src/cli.ts'),
        `
        import { access, writeFile, rename } from 'node:fs/promises';
        if (process.argv.includes('--identity')) {console.log(JSON.stringify({generator:'fixture-generator'}));process.exit(0);}
        const output = process.argv[process.argv.indexOf('-o') + 1];
        const source = { buildGuid: 'build', contentHash: 'content' };
        const save = async (value) => {
            await writeFile(output + '.tmp', JSON.stringify(value));
            await rename(output + '.tmp', output);
        };
        if (process.argv[2] === 'player-ground') {
            await save({ source, surfaces: [] });
        } else {
            await save({ source, scene: 'map01', status: 'candidate', optimizing: !process.argv.includes('--ground-only') });
            console.log(JSON.stringify({ phase: 'ground-route', elapsedMs: 1 }));
            if (!process.argv.includes('--ground-only')) {
                // The test owns completion so machine load cannot finish the interrupted run.
                while (true) {
                    try { await access(output + '.release'); break; }
                    catch { await new Promise(resolve => setTimeout(resolve, 20)); }
                }
                await save({ source, scene: 'map01', status: 'candidate', optimizing: false });
            }
        }
    `,
    );
    const source = { buildGuid: 'build', contentHash: 'content' };
    const request = {
        point: 'fixture-point',
        scene: 'map01',
        source,
        arrival: {
            id: 'start',
            position: [0, 0, 0] as [number, number, number],
            cost: 0,
            state: 'available' as const,
        },
        target: [1, 0, 1] as [number, number, number],
        walls: [],
    };
    await writePhysicalAdapter(directory);
    let builder = physicalRouteBuilder(options);
    try {
        const ground = await builder.query(
            'map01',
            source,
            [0, 0, 0],
            [1, 0, 1],
            { startBuild: true },
        );
        if (!ground) throw new Error('Ground job was not created');
        await expect.poll(() => ground.status).toBe('ready');
        const route = await builder.solve(ground, request, true);
        if (!route) throw new Error('Route job was not created');
        await expect
            .poll(() => route.result)
            .toMatchObject({ optimizing: true });
        expect(route.status).toBe('building');
        const next = await builder.query(
            'map01',
            source,
            [100, 0, 100],
            [101, 0, 101],
            { startBuild: true },
        );
        if (!next) throw new Error('Next ground job was not created');
        await expect.poll(() => next.status).toBe('ready');
        expect(ground.result).toBeUndefined();
        const restored = await builder.query(
            'map01',
            source,
            [0, 0, 0],
            [1, 0, 1],
            { startBuild: false },
        );
        expect(restored).toMatchObject({
            output: ground.output,
            status: 'ready',
        });
        expect(restored?.result).toMatchObject({ source, surfaces: [] });
        expect(next.result).toBeUndefined();
        await builder.query('map01', source, [100, 0, 100], [101, 0, 101], {
            startBuild: false,
        });
        expect(next.result).toMatchObject({ source, surfaces: [] });
        expect(ground.result).toBeUndefined();
        expect(restored?.result).toMatchObject({ source, surfaces: [] });
        const walking = await builder.solve(next, request, true, 'walking');
        if (!walking)
            throw new Error('Foreground walking stage was not created');
        await expect.poll(() => walking.status).toBe('ready');
        expect(walking.result).toMatchObject({ optimizing: false });
        expect(route.status).toBe('building');
        await builder.close();
        await expect.poll(() => route.status).toBe('failed');

        builder = physicalRouteBuilder(options);
        const cached = await builder.query(
            'map01',
            source,
            [0, 0, 0],
            [1, 0, 1],
            { startBuild: true },
        );
        if (!cached) throw new Error('Cached ground job was not loaded');
        expect(cached.status).toBe('ready');
        const resumed = await builder.solve(cached, request, true);
        if (!resumed) throw new Error('Provisional route was not resumed');
        expect(resumed.status).not.toBe('ready');
        expect(resumed.result).toMatchObject({ optimizing: true });
        await writeFile(resumed.output + '.release', '');
        await expect.poll(() => resumed.status).toBe('ready');
        expect(resumed.result).toMatchObject({ optimizing: false });
        if (!resumed.log) throw new Error('Task log was not retained');
        await expect
            .poll(async () =>
                (await readFile(resumed.log!, 'utf8')).includes(
                    '"event":"finished"',
                ),
            )
            .toBe(true);
        const records = (await readFile(resumed.log, 'utf8'))
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line));
        expect(
            records.some(
                (row) =>
                    row.event === 'progress' && row.phase === 'ground-route',
            ),
        ).toBe(true);
        expect(new Set(records.map((row) => row.run)).size).toBeGreaterThan(1);
        expect(
            records.find((row) => row.phase === 'ground-route')?.durationMs,
        ).toBe(1);
        for (const run of new Set(records.map((row) => row.run))) {
            const elapsed = records
                .filter(
                    (row) => row.run === run && Number.isFinite(row.elapsedMs),
                )
                .map((row) => row.elapsedMs);
            expect(
                elapsed.every(
                    (value, index) =>
                        index === 0 || value >= elapsed[index - 1],
                ),
            ).toBe(true);
        }
        const index = await readFile(
            join(options.directory, 'route-jobs.jsonl'),
            'utf8',
        );
        expect(index).toContain('fixture-point');
        const negative = await builder.query(
            'map01',
            source,
            [-100, 0, -100],
            [-99, 0, -99],
            {
                startBuild: true,
                corridor: {
                    kind: 'corridor-proposal',
                    bounds: { min: [-115.2, -115.2], max: [-76.8, -76.8] },
                    tiles: [{ x: -3, z: -3 }],
                    coarse: { regions: 0, edges: 0, halo: 0, path: [] },
                },
            },
        );
        await expect.poll(() => negative?.status).toBe('ready');
        const queued = (await readFile(negative!.log!, 'utf8'))
            .trim()
            .split('\n')
            .map((line) => JSON.parse(line))
            .find((row) => row.event === 'queued');
        const tileArgs = queued.command.slice(
            queued.command.findIndex((arg: string) =>
                arg.startsWith('--tiles'),
            ),
        );
        expect(
            parseArgs({
                args: tileArgs,
                options: { tiles: { type: 'string' } },
            }).values.tiles,
        ).toBe('-3,-3');
        await builder.close();
        builder = physicalRouteBuilder({
            ...options,
            solver: 'updated-runtime',
        });
        const reused = await builder.query(
            'map01',
            source,
            [0, 0, 0],
            [1, 0, 1],
            { startBuild: true },
        );
        expect(reused?.status).toBe('ready');
        expect(reused?.output).toBe(cached.output);

        await builder.close();
        const cli = join(directory, 'packages/extractor/src/cli.ts');
        await writeFile(
            cli,
            (await readFile(cli, 'utf8')).replace(
                'fixture-generator',
                'changed-generator',
            ),
        );
        builder = physicalRouteBuilder(options);
        const rebuilt = await builder.query(
            'map01',
            source,
            [0, 0, 0],
            [1, 0, 1],
            { startBuild: true },
        );
        expect(rebuilt?.output).not.toBe(cached.output);
        await expect.poll(() => rebuilt?.status).toBe('ready');
    } finally {
        await builder.close();
        await rm(directory, { recursive: true, force: true });
    }
});

test('runs a queued known-device query before further ground construction', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'world-device-priority-'));
    await mkdir(join(directory, 'packages/extractor/src'), { recursive: true });
    await writeFile(join(directory, 'movement-settings-current.json'), '{}');
    await writeFile(join(directory, 'map01-traversal-devices.json'), '{}');
    await writeFile(
        join(directory, 'packages/extractor/src/cli.ts'),
        `
        import {writeFile} from 'node:fs/promises';
        if (process.argv.includes('--identity')) {console.log(JSON.stringify({generator:'fixture-generator'}));process.exit(0);}
        const output = process.argv[process.argv.indexOf('-o') + 1];
        const source = {buildGuid:'build',contentHash:'content'};
        if (process.argv[2] === 'player-ground') {
            await new Promise(resolve => setTimeout(resolve, 300));
            await writeFile(output, JSON.stringify({source,surfaces:[]}));
        } else {
            await writeFile(output, JSON.stringify({source,scene:'map01',status:'candidate',optimizing:false,
                devicesOnly:process.argv.includes('--devices-only')}));
        }
    `,
    );
    await writePhysicalAdapter(directory);
    const builder = physicalRouteBuilder({
        directory,
        extractor: directory,
        config: 'fixture',
        node: process.execPath,
    });
    const source = { buildGuid: 'build', contentHash: 'content' };
    try {
        const ready = await builder.query(
            'map01',
            source,
            [0, 0, 0],
            [1, 0, 1],
            { startBuild: true },
        );
        if (!ready) throw new Error('missing ground job');
        await expect.poll(() => ready.status).toBe('ready');
        const active = await builder.query(
            'map01',
            source,
            [100, 0, 100],
            [101, 0, 101],
            { startBuild: true },
        );
        if (!active) throw new Error('missing active build');
        await expect.poll(() => active.status).toBe('building');
        const queued = await builder.query(
            'map01',
            source,
            [200, 0, 200],
            [201, 0, 201],
            { startBuild: true },
        );
        if (!queued) throw new Error('missing queued build');
        const route = await builder.solve(
            ready,
            {
                scene: 'map01',
                source,
                arrival: {
                    id: 'start',
                    position: [0, 0, 0],
                    cost: 0,
                    state: 'available',
                },
                target: [1, 0, 1],
                walls: [],
            },
            true,
            'devices',
        );
        if (!route) throw new Error('missing device query');
        await expect.poll(() => route.status).toBe('ready');
        expect(route.result).toMatchObject({
            devicesOnly: true,
            optimizing: false,
        });
        expect(queued.status).not.toBe('ready');
    } finally {
        await builder.close();
        await rm(directory, { recursive: true, force: true });
    }
});


test('checks known routes from all origins before starting jump discovery and retains widening attempts', () => {
    const anchors = 5;
    const attempts = routeAttempts(anchors);
    expect(attempts.slice(0, anchors)).toEqual(Array.from({ length: anchors }, (_, anchorIndex) =>
        ({ anchorIndex, marginIndex: 0 })));
    const searches = attempts.slice(anchors);
    for (let anchorIndex = 0; anchorIndex < anchors; anchorIndex++) {
        expect(searches.filter(attempt => attempt.anchorIndex === anchorIndex)
            .map(attempt => attempt.marginIndex).sort((a, b) => a - b))
            .toEqual(Array.from({ length: physicalMargins.length * 2 }, (_, index) => index));
    }
    expect(searches[0]).toEqual({ anchorIndex: 0, marginIndex: 0 });
    // Airborne endpoints always require flight discovery, so retain the original schedule.
    expect(routeAttempts(anchors, false)).toEqual(searches);
    expect(searches.findIndex(attempt => attempt.anchorIndex === 1 && attempt.marginIndex === 0))
        .toBeLessThan(searches.findIndex(attempt => attempt.anchorIndex === 0 && attempt.marginIndex === 2));
});
