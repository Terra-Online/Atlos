// @vitest-environment node
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { physicalRouteBuilder } from '../physical-route-builder';

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
        import { writeFile, rename } from 'node:fs/promises';
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
            console.log(JSON.stringify({ phase: 'ground-route' }));
            if (!process.argv.includes('--ground-only')) {
                await new Promise(resolve => setTimeout(resolve, 700));
                await save({ source, scene: 'map01', status: 'candidate', optimizing: false });
            }
        }
    `,
    );
    const source = { buildGuid: 'build', contentHash: 'content' };
    const request = {
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
        const walking = await builder.solve(next, request, true, 'walking');
        if (!walking)
            throw new Error('Foreground walking stage was not created');
        await expect.poll(() => walking.status).toBe('ready');
        expect(walking.result).toMatchObject({ optimizing: false });
        expect(route.status).toBe('building');
        builder.close();
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
        await expect.poll(() => resumed.status).toBe('ready');
        expect(resumed.result).toMatchObject({ optimizing: false });
    } finally {
        builder.close();
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
        builder.close();
        await rm(directory, { recursive: true, force: true });
    }
});
