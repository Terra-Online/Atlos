// @vitest-environment node
import { expect, test, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
let directory: string, groundPath: string;
beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'window-ground-'));
    groundPath = join(directory, 'ground.json');
    await writeFile(
        groundPath,
        JSON.stringify({
            surfaces: [
                {
                    id: 'floor',
                    vertices: [
                        [0, 0, -1],
                        [201, 0, -1],
                        [201, 0, 1],
                        [0, 0, 1],
                    ],
                },
            ],
            options: {
                speed: 5,
                maxVertical: 0.1,
                walls: [],
                profile: { radius: 0.1, height: 1.8 },
            },
        }),
    );
});
afterAll(async () => {
    await rm(directory, { recursive: true, force: true });
});
import { createWindowRoute } from '../window-route';
import type { RouteRequest } from '../physical-route-builder';
const request: RouteRequest = {
    scene: 'map02',
    source: { buildGuid: 'b', contentHash: 'c' },
    arrival: { id: 'a', position: [0, 0, 0], cost: 0, state: 'available' },
    target: [200, 0, 0],
    walls: [],
};
const settings = {
    maxTiles: 8,
    margin: 4,
    locomotion: { speed: 5, sprintSpeed: 5, sprintAcceleration: 1 },
};
test('windows retain true exits, enforce tile budget and retime the whole trajectory', async () => {
    const starts: number[][] = [];
    const builder: Parameters<typeof createWindowRoute>[0] = {
        query: (_scene, _source, _start, _target, options) => {
            expect(options.corridor.tiles.length).toBeLessThanOrEqual(8);
            return Promise.resolve({
                status: 'ready',
                message: '',
                output: groundPath,
                collision: 'collision',
            });
        },
        solve: (_ground, local) => {
            starts.push(local.arrival.position);
            const exit = [...local.target] as [number, number, number];
            if (exit[0] !== 200) exit[0] -= 0.1;
            return Promise.resolve({
                status: 'ready',
                message: '',
                output: 'route',
                collision: 'collision',
                result: {
                    route: {
                        status: 'complete',
                        start: 'a',
                        arrivalCost: 0,
                        cost: 1,
                        length: exit[0] - local.arrival.position[0],
                        points: [local.arrival.position, exit],
                        segments: [
                            {
                                mode: 'walk',
                                points: [local.arrival.position, exit],
                                times: [0, 1],
                            },
                        ],
                    },
                },
            });
        },
    };
    const search = createWindowRoute(
        builder,
        request,
        [
            [40, 0, 0],
            [80, 0, 0],
            [120, 0, 0],
            [160, 0, 0],
            [200, 0, 0],
        ],
        settings,
    );
    let result = await search.advance();
    for (let i = 0; i < 20 && result.status === 'pending'; i++)
        result = await search.advance();
    expect(result.status).toBe('complete');
    expect(starts.length).toBeGreaterThan(1);
    expect(starts[1][0] % 40).toBeCloseTo(39.9);
    if (result.status === 'complete') expect(result.route.cost).toBeCloseTo(40);
});
