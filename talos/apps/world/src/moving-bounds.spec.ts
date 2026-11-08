import { describe, expect, it } from 'vitest';
import {
    boxSegments,
    isMovingBounds,
    movingCatalog,
    nearbyMovingBounds,
    type Box,
} from './moving-bounds';

const source = { buildGuid: 'build', contentHash: 'hash' };
const bounds: Box = { min: [-2, 0, -1], max: [2, 1, 1] };
const support = (id: string, level = 'map02_lv010') => ({
    id,
    level,
    family: 'platform',
    endpoints: {
        initial: bounds,
        terminal: { min: [398, 20, -1], max: [402, 21, 1] },
    },
    surfaces: [
        {
            vertices: [
                [198, 12, -1],
                [202, 12, -1],
                [202, 12, 1],
            ],
        },
    ],
});
const fixture = () => ({
    version: 1,
    scene: 'map02',
    source,
    movingSupports: [
        support('leaf'),
        support('other-level', 'map02_lv009'),
        { id: 'legacy', family: 'platform', level: 'map02_lv010' },
    ],
});

describe('moving endpoint diagrams', () => {
    it('retains collider endpoint boxes and bounded sweep extents, including the middle of a distant trip', () => {
        const data = fixture();
        const before = structuredClone(data);
        const catalog = movingCatalog(data, 'map02');
        const nearby = nearbyMovingBounds(catalog, 'map02_lv010', [200, 12, 0]);
        expect(nearby.devices.map((device) => device.id)).toEqual(['leaf']);
        expect(nearby.devices[0].endpoints.initial).toEqual(bounds);
        expect(nearby.devices[0].extent).toEqual({
            min: [-2, 0, -1],
            max: [402, 21, 1],
        });
        expect(nearby.missing).toBe(1);
        expect(isMovingBounds(nearby)).toBe(true);
        expect(
            nearbyMovingBounds(catalog, 'map02_lv010', [1000, 12, 0]).devices,
        ).toEqual([]);
        expect(data).toEqual(before);
    });
    it('rejects mismatched scenes, ambiguous identities and malformed boxes before drawing', () => {
        expect(() => movingCatalog(fixture(), 'map01')).toThrow(/catalog/);
        const duplicate = fixture();
        duplicate.movingSupports.push(support('leaf'));
        expect(() => movingCatalog(duplicate, 'map02')).toThrow(/identity/);
        const invalid = { ...fixture(), movingSupports: [support('invalid')] };
        invalid.movingSupports[0].endpoints.initial = {
            min: [4, 0, 0],
            max: [0, 1, 1],
        };
        expect(() => movingCatalog(invalid, 'map02')).toThrow(/endpoints/);
        expect(
            isMovingBounds({
                ...nearbyMovingBounds(
                    movingCatalog(fixture(), 'map02'),
                    'map02_lv010',
                    [0, 0, 0],
                ),
                position: [0, NaN, 0],
            }),
        ).toBe(false);
    });
    it('draws exactly twelve independent edges, including coincident loop endpoint states', () => {
        const lines = boxSegments(bounds);
        expect(lines).toHaveLength(12);
        const corners = new Set(
            lines.flatMap((line) =>
                line.points.map((point) => point.join('/')),
            ),
        );
        expect(corners.size).toBe(8);
        expect(
            new Set(
                lines.map((line) =>
                    line.points
                        .map((point) => point.join('/'))
                        .sort()
                        .join(':'),
                ),
            ).size,
        ).toBe(12);
        for (const line of lines) {
            expect(
                line.points[0].filter((v, i) => v !== line.points[1][i]),
            ).toHaveLength(1);
        }
        const loop = {
            ...support('loop'),
            endpoints: { initial: bounds, terminal: bounds },
        };
        const catalog = movingCatalog(
            { ...fixture(), movingSupports: [loop] },
            'map02',
        );
        expect(catalog.devices[0].endpoints.initial).toEqual(
            catalog.devices[0].endpoints.terminal,
        );
    });
});
