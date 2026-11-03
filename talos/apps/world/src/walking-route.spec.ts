import { describe, expect, it } from 'vitest';
import { planWalkingRoute, walkingPosition, type WalkingData } from './walking-route';

describe('walking route package integration', () => {
    const data: WalkingData = {
        version: 1,
        binding: 'scene:build:state',
        surfaces: [{ id: 'ground', vertices: [[-2, 0, -2], [2, 0, -2], [2, 0, 2], [-2, 0, 2]] }],
        options: {
            speed: 1, maxVertical: 0.5,
            walls: [{ min: [0, 0, -2], max: [0.2, 3, 2], state: 'unknown' }],
            profile: { radius: 0.4, height: 2 },
        },
    };
    const starts = [{ id: 'player', position: [-1, 0, 0] as [number, number, number], cost: 0, state: 'available' as const }];
    it('rejects unknown walls and stale source bindings through the installed package', () => {
        expect(planWalkingRoute(data, data.binding, starts, [1, 0, 0]).status).toBe('no-verified-route');
        expect(() => planWalkingRoute(data, 'other-state', starts, [1, 0, 0])).toThrow('Stale walking data');
    });
    it('selects a reachable unlocked arrival and samples only its ground segment', () => {
        const route = planWalkingRoute(data, data.binding, [...starts,
            { id: 'teleport', position: [1, 0, 0], cost: 2, state: 'available' },
            { id: 'locked-base', position: [1.8, 0, 0], cost: 0, state: 'locked' },
        ], [1.8, 0, 0]);
        expect(route.status).toBe('complete');
        if (route.status !== 'complete') throw new Error('Expected route');
        expect(route.start).toBe('teleport');
        expect(walkingPosition(route, 0, 1)).toEqual([1, 0, 0]);
        expect(walkingPosition(route, 10, 1)).toEqual([1.8, 0, 0]);
    });
});
