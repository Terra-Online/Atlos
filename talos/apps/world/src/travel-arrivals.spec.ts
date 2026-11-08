// @vitest-environment node
import { expect, test } from 'vitest';
import { travelArrivals, type TravelPoint } from '../travel-arrivals';
import type { GroundArrival } from '@opendfieldmap/ganglia';

test('fully enabled previews include new base centres with their source height bounds', () => {
    const points: TravelPoint[] = [
        { id: 'camp', scene: 'map', level: 'level', position: [40, 0, 0] },
        {
            id: 'main-base',
            scene: 'map',
            level: 'level',
            kind: 'base',
            position: [2, 12, 0],
            requiresGroundProjection: true,
            groundRange: [-1, 24],
        },
        { id: 'other-base', scene: 'map', level: 'other', position: [0, 0, 0] },
        {
            id: 'unbounded',
            scene: 'map',
            level: 'level',
            position: [0, 0, 0],
            requiresGroundProjection: true,
        },
    ];
    const existing: GroundArrival[] = [
        { id: 'camp', position: [40, 0, 0], cost: 0, state: 'unknown' },
    ];
    const before = structuredClone(points);
    const arrivals = travelArrivals(
        points,
        existing,
        'map',
        'level',
        true,
        [0, 0, 0],
    );
    expect(arrivals.map((a) => a.id)).toEqual(['main-base', 'camp']);
    expect(arrivals[0].groundRange).toEqual([-1, 24]);
    expect(arrivals.every((a) => a.state === 'available')).toBe(true);
    expect(
        travelArrivals(points, existing, 'map', 'level', false, [0, 0, 0]).map(
            (a) => a.id,
        ),
    ).toEqual(['camp']);
    expect(points).toEqual(before);
});
