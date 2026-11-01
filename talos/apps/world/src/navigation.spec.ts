import { expect, it, vi } from 'vitest';
import type {
    Navigation,
    Route,
} from '@endfield-noclip/package-format/navigation';
import {
    Crossing,
    destinationAt,
    destinationKey,
    rebasePosition,
} from './navigation';

vi.mock('@/data/map', () => ({
    REGION_DICT: { Valley_4: { coordZoom: 3, subregions: ['west', 'east'] } },
    SUBREGION_DICT: {
        west: {
            id: 'west',
            bounds: [
                [4000, 3600],
                [4160, 4000],
            ],
        },
        east: {
            id: 'east',
            bounds: [
                [4160, 3600],
                [4400, 4000],
            ],
        },
    },
}));
const west: Route = {
    scene: 'map01',
    level: 'west',
    region: 'Valley_4',
    subregion: 'west',
    seamless: true,
    bounds: null,
    volumes: [],
};
const east: Route = { ...west, level: 'east', subregion: 'east' };
const independent: Route = {
    ...east,
    scene: 'indie_dg007',
    level: 'indie_dg007',
    seamless: false,
    volumes: [],
};
const center = rebasePosition(west, independent, [20, 150, 0]);
independent.volumes = [
    {
        tier: 2,
        priority: 0,
        shapes: [
            {
                kind: 'box',
                position: center,
                rotation: [0, 0, 0],
                size: [50, 20, 50],
                radius: 1,
                points: [],
            },
        ],
    },
];
const data: Navigation = {
    version: 1,
    release: 'r',
    source: { buildGuid: 'b', contentHash: 'h' },
    generations: {},
    routes: [west, east, independent],
};

it('follows the main-map boundary and leaves gaps unresolved', () => {
    expect(
        destinationAt(data, { ...west, tier: 0 }, [20, 300, 0])?.route.level,
    ).toBe('east');
    expect(
        destinationAt(data, { ...west, tier: 0 }, [-1000, 300, 0]),
    ).toBeNull();
});
it('selects an overlapping independent package only inside its authored height volume and can return', () => {
    expect(
        destinationAt(data, { ...west, tier: 0 }, [20, 150, 0]),
    ).toMatchObject({ route: { scene: 'indie_dg007' }, tier: 2 });
    expect(
        destinationAt(data, { ...independent, tier: 2 }, [
            center[0],
            300,
            center[2],
        ])?.route.scene,
    ).toBe('map01');
    const restored = rebasePosition(independent, west, center);
    restored.forEach((v, i) => expect(v).toBeCloseTo([20, 150, 0][i], 8));
});
it('holds a genuine overlap rather than guessing a different package', () => {
    const overlap = {
        ...independent,
        scene: 'indie_dg005',
        level: 'another',
        volumes: [
            {
                ...independent.volumes[0],
                shapes: [
                    {
                        ...independent.volumes[0].shapes[0],
                        position: rebasePosition(
                            west,
                            {
                                ...independent,
                                scene: 'indie_dg005',
                                level: 'another',
                            },
                            [20, 150, 0],
                        ),
                    },
                ],
            },
        ],
    };
    expect(
        destinationAt(
            { ...data, routes: [...data.routes, overlap] },
            { ...west, tier: 0 },
            [20, 150, 0],
        ),
    ).toBeNull();
});
it('debounces a crossing, resets on gaps and reversals, and distinguishes floor changes', () => {
    const gate = new Crossing(),
        next = { route: east, tier: 0 },
        current = destinationKey({ route: west, tier: 0 });
    expect(gate.update(next, current, 0)).toBeNull();
    expect(gate.update(next, current, 599)).toBeNull();
    expect(gate.update(null, current, 600)).toBeNull();
    expect(gate.update(next, current, 601)).toBeNull();
    expect(gate.update(next, current, 1201)).toBe(next);
    expect(gate.update(next, destinationKey(next), 2000)).toBeNull();
    expect(
        gate.update({ route: east, tier: 2 }, destinationKey(next), 2001),
    ).toBeNull();
    expect(
        gate.update({ route: east, tier: 2 }, destinationKey(next), 2601)?.tier,
    ).toBe(2);
});
