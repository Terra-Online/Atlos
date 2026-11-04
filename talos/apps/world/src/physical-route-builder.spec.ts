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
        const walking = await builder.solve(next, request, true, true);
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
