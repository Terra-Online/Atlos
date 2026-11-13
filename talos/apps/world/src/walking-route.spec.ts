import { describe, expect, it } from 'vitest';
import {
    planWalkingRoute,
    journeySample,
    type WalkingData,
} from './walking-route';

describe('walking route package integration', () => {
    const data: WalkingData = {
        version: 1,
        binding: 'scene:build:state',
        surfaces: [
            {
                id: 'ground',
                vertices: [
                    [-2, 0, -2],
                    [2, 0, -2],
                    [2, 0, 2],
                    [-2, 0, 2],
                ],
            },
        ],
        options: {
            speed: 1,
            maxVertical: 0.5,
            walls: [{ min: [0, 0, -2], max: [0.2, 3, 2], state: 'unknown' }],
            profile: { radius: 0.4, height: 2 },
        },
    };
    const starts = [
        {
            id: 'player',
            position: [-1, 0, 0] as [number, number, number],
            cost: 0,
            state: 'available' as const,
        },
    ];
    it('rejects unknown walls and stale source bindings through the installed package', () => {
        expect(
            planWalkingRoute(data, data.binding, starts, [1, 0, 0]).status,
        ).toBe('no-verified-route');
        expect(() =>
            planWalkingRoute(data, 'other-state', starts, [1, 0, 0]),
        ).toThrow('Stale walking data');
    });
    it('selects a reachable unlocked arrival and samples only its ground segment', () => {
        const route = planWalkingRoute(
            data,
            data.binding,
            [
                ...starts,
                {
                    id: 'teleport',
                    position: [1, 0, 0],
                    cost: 2,
                    state: 'available',
                },
                {
                    id: 'locked-base',
                    position: [1.8, 0, 0],
                    cost: 0,
                    state: 'locked',
                },
            ],
            [1.8, 0, 0],
        );
        expect(route.status).toBe('complete');
        if (route.status !== 'complete') throw new Error('Expected route');
        expect(route.start).toBe('teleport');
        expect(journeySample(route, 0).position).toEqual([1, 0, 0]);
        expect(journeySample(route, 10).position).toEqual([1.8, 0, 0]);
    });
    it('plays a directed launch with its supplied timing, without inventing a reverse connection', () => {
        const launchData: WalkingData = {
            ...data,
            surfaces: [
                ...data.surfaces,
                {
                    id: 'upper',
                    vertices: [
                        [-2, 8, -2],
                        [2, 8, -2],
                        [2, 8, 2],
                        [-2, 8, 2],
                    ],
                },
            ],
            options: {
                ...data.options,
                walls: [],
                connections: [
                    {
                        id: 'launch',
                        mode: 'launch',
                        state: 'open',
                        points: [
                            [-1, 0, 0],
                            [-1, 6, 0],
                            [-1, 8, 0],
                        ],
                        times: [0, 0.5, 1],
                    },
                ],
            },
        };
        const route = planWalkingRoute(
            launchData,
            data.binding,
            starts,
            [-1, 8, 0],
        );
        if (route.status !== 'complete')
            throw new Error('Expected launch route');
        expect(journeySample(route, 0.75)).toEqual({
            position: [-1, 7, 0],
            mode: 'launch',
            connection: 'launch',
        });
        expect(
            planWalkingRoute(
                launchData,
                data.binding,
                [{ ...starts[0], position: [-1, 8, 0] }],
                [-1, 0, 0],
            ).status,
        ).toBe('no-verified-route');
    });
});

describe('continuous routing through the installed package', () => {
    it('reuses a prepared scene for arbitrary endpoints and preserves sprint timing', async () => {
        const { createWalkingPlanner } = await import('./walking-route');
        const data: WalkingData = {
            version: 1,
            binding: 'continuous',
            surfaces: [
                {
                    id: 'a',
                    vertices: [
                        [0, 0, 0],
                        [2, 0, 0],
                        [2, 0, 2],
                        [0, 0, 2],
                    ],
                },
                {
                    id: 'b',
                    vertices: [
                        [2, 0, 0],
                        [4, 0, 0],
                        [4, 0, 2],
                        [2, 0, 2],
                    ],
                },
            ],
            options: {
                speed: 1,
                maxVertical: 0.5,
                walls: [],
                profile: { radius: 0.35, height: 1.66 },
                locomotion: { speed: 1, sprintSpeed: 2, sprintAcceleration: 4 },
            },
        };
        const planner = createWalkingPlanner(data, data.binding);
        for (const z of [0.2, 0.7, 1.5]) {
            const result = planner.plan(
                [
                    {
                        id: 'player',
                        position: [0.2, 0, z],
                        cost: 0,
                        state: 'available',
                    },
                ],
                [3.8, 0, z],
            );
            if (result.status !== 'complete')
                throw new Error('Expected continuous route');
            expect(result.length).toBeCloseTo(3.6);
            expect(result.points.every((p) => Math.abs(p[2] - z) < 1e-7)).toBe(
                true,
            );
            expect(result.segments[0].gait).toBe('sprint');
            expect(result.cost).toBeLessThan(3.6);
        }
    });
});
