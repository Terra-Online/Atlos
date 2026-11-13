// @vitest-environment node
import { expect, test } from 'vitest';
import type { Surface } from '@opendfieldmap/ganglia';
import { coarseCorridors } from '../coarse-route';

const floor = (x: number, z: number): Surface => ({
    id: `${x}/${z}`,
    vertices: [
        [x * 8 + 0.1, 0, z * 8 + 0.1],
        [x * 8 + 7.9, 0, z * 8 + 0.1],
        [x * 8 + 7.9, 0, z * 8 + 7.9],
        [x * 8 + 0.1, 0, z * 8 + 7.9],
    ],
});

test('chooses a broad approach around missing regions before requesting physical detail', () => {
    const surfaces = [
        [0, 0],
        [1, 0],
        [2, 0],
        [3, 0],
        [3, 1],
        [3, 2],
        [2, 2],
        [1, 2],
        [0, 2],
    ].map(([x, z]) => floor(x, z));
    const before = structuredClone(surfaces);
    const data = {
        surfaces,
        options: { profile: { height: 1.7 }, maxVertical: 0.5 },
    };
    const proposals = coarseCorridors(data, [4, 0, 4], [4, 0, 20], 8);
    expect(proposals.length).toBeGreaterThan(0);
    expect(proposals[0].coarse.path.some((p) => p[0] > 20)).toBe(true);
    for (const proposal of proposals) {
        expect(proposal.kind).toBe('corridor-proposal');
        expect(proposal).not.toHaveProperty('route');
        expect(
            proposal.tiles.some((tile) => tile.x === 0 && tile.z === 0),
        ).toBe(true);
        expect(
            proposal.tiles.some((tile) => tile.x === 0 && tile.z === 2),
        ).toBe(true);
    }
    expect(surfaces).toEqual(before);
});

test('keeps an unknown approach as a proposal requiring detail rather than a reachability result', () => {
    const data = {
        surfaces: [],
        options: { profile: { height: 1.7 }, maxVertical: 0.5 },
    };
    const proposals = coarseCorridors(data, [-80, 0, 0], [80, 10, 0], 8);
    expect(proposals.length).toBeGreaterThan(0);
    expect(proposals[0].kind).toBe('corridor-proposal');
    expect(proposals[0]).not.toHaveProperty('status');
    expect(proposals[0].coarse.path).toEqual([
        [-80, 0, 0],
        [80, 10, 0],
    ]);
});
