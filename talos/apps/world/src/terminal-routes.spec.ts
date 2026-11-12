// @vitest-environment node
import { test, expect } from 'vitest';
import { matchingTerminals, type Catalog } from '../terminal-routes';
import type { Route } from '@opendfieldmap/ganglia';
type Complete = Extract<Route, { status: 'complete' }>;
const source = { buildGuid: 'b', contentHash: 'h' },
    interaction = { radius: 1, airborne: true };
const tail: Complete = {
    status: 'complete',
    start: 'entry',
    cost: 1,
    arrivalCost: 0,
    length: 3,
    points: [
        [1, 0, 0],
        [2, 2, 0],
        [3, 1, 0],
    ],
    segments: [
        {
            mode: 'jump',
            points: [
                [1, 0, 0],
                [2, 2, 0],
                [3, 1, 0],
            ],
            times: [0, 0.5, 1],
        },
    ],
    goalHit: { segment: 0, time: 1, position: [3, 1, 0] },
};
const catalog: Catalog = {
    version: 1,
    exportRevision: 2,
    source,
    generator: 'g',
    solver: 'v',
    movementHash: 'm',
    routes: [
        {
            id: 'a',
            scene: 'scene',
            target: [3, 1, 0],
            interaction,
            route: tail,
        },
    ],
};
const context = {
    scene: 'scene',
    source,
    generator: 'g',
    solver: 'file:ganglia-v.tgz',
    movementHash: 'm',
    target: [3, 1, 0] as [number, number, number],
    interaction,
    arrivals: [
        {
            id: 'tp',
            state: 'available' as const,
            cost: 0,
            position: [0, 0, 0] as [number, number, number],
        },
    ],
    speed: 5,
};
test('terminal selection follows the goal and exact resource/model binding without point-specific rules', () => {
    expect(matchingTerminals(catalog, context)[0]?.id).toBe('a');
    expect(
        matchingTerminals(catalog, { ...context, generator: 'old' }),
    ).toEqual([]);
    expect(
        matchingTerminals(catalog, { ...context, movementHash: 'old' }),
    ).toEqual([]);
    expect(
        matchingTerminals(catalog, {
            ...context,
            interaction: { radius: 2, airborne: true },
        }),
    ).toEqual([]);
    expect(
        matchingTerminals(catalog, { ...context, target: [30, 1, 0] }),
    ).toEqual([]);
});
