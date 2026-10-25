import L from 'leaflet';
import { describe, expect, it } from 'vitest';
import { SmoothTileLayer } from '@/services/map/core/smoothTileLayer';
import {
    getRegionTileCoverage,
    hasTileInCoverage,
    type RegionTileCoverage,
} from './tileCoverage';

const coverage: RegionTileCoverage = {
    zooms: {
        '2': {
            '': {
                '4': [1, 3, 7, 8],
            },
            _b1: {
                '4': [2, 2],
            },
        },
    },
};

describe('tile coverage', () => {
    it('matches inclusive x ranges and rejects missing coordinates', () => {
        expect(hasTileInCoverage(coverage, 2, 1, 4, '')).toBe(true);
        expect(hasTileInCoverage(coverage, 2, 3, 4, '')).toBe(true);
        expect(hasTileInCoverage(coverage, 2, 7, 4, '')).toBe(true);
        expect(hasTileInCoverage(coverage, 2, 4, 4, '')).toBe(false);
        expect(hasTileInCoverage(coverage, 2, 2, 5, '')).toBe(false);
        expect(hasTileInCoverage(coverage, 1, 2, 4, '')).toBe(false);
        expect(hasTileInCoverage(coverage, 2, 3, 4, '_b1')).toBe(false);
    });

    it('requires every configured region to have bundled coverage', () => {
        expect(getRegionTileCoverage('Valley_4').zooms['0']).toBeDefined();
        expect(() => getRegionTileCoverage('missing-region')).toThrow(
            'Tile coverage not found for region: missing-region',
        );
    });

    it('rejects uncovered coordinates in Leaflet before tile creation', () => {
        const map = L.map(document.createElement('div'), {
            crs: L.CRS.Simple,
        });
        const layer = new SmoothTileLayer('/{z}/{x}_{y}.webp', {}, coverage);
        (layer as unknown as { _map: L.Map })._map = map;

        const covered = L.point(2, 4) as L.Coords;
        covered.z = 2;
        const missing = L.point(6, 4) as L.Coords;
        missing.z = 2;

        expect(layer._isValidTile(covered)).toBe(true);
        expect(layer._isValidTile(missing)).toBe(false);
        map.remove();
    });
});
