import L from 'leaflet';
import { describe, expect, it, vi } from 'vitest';
import { SmoothTileLayer } from '@/services/map/core/smoothTileLayer';
import {
    getRegionTileCoverage,
    getMaxTileZoom,
    getAvailableLayers,
    hasTileInCoverage,
    hasSatelliteTiles,
    type RegionTileCoverage,
} from './tileCoverage';
import { getTileLayers } from '@/data/map/tiles';

vi.mock('@/data/map/satelliteCoverage.json', () => ({ default: { version: 1, regions: { Dijiang: { '3': { '': { '4': [123, 123] } } } } } }));

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
    it('derives floor availability from populated standard tiles in display order', () => {
        expect(getTileLayers({ zooms: { '0': { _b1: { '0': [0, 0] }, _l2: { '1': [1, 1] } },
            '3': { _b2: { '0': [] }, _l1: {} } } })).toEqual(['L2', 'M', 'B1']);
        expect(getAvailableLayers('Valley_4')).toEqual(['L2', 'L1', 'M', 'B1', 'B2']);
        expect(getAvailableLayers('Wuling')).toEqual(['L4', 'L3', 'L2', 'L1', 'M', 'B1', 'B2', 'B3', 'B4']);
        expect(getAvailableLayers('Weekraid_1')).toEqual(['L1', 'M', 'B1', 'B2', 'B3']);
        expect(getAvailableLayers('Dijiang')).toEqual(['M']);
        expect(getAvailableLayers('missing-region')).toEqual(['M']);
    });

    it('derives native detail from populated coverage for the selected layers', () => {
        const levels = { zooms: { ...coverage.zooms, '4': { _b1: { '0': [0, 1] } }, '5': { '': {} } } };
        expect(getMaxTileZoom(levels)).toBe(2);
        expect(getMaxTileZoom(levels, ['', '_b1'])).toBe(4);
    });

    it('matches inclusive x ranges and rejects missing coordinates', () => {
        expect(hasTileInCoverage(coverage, 2, 1, 4, '')).toBe(true);
        expect(hasTileInCoverage(coverage, 2, 3, 4, '')).toBe(true);
        expect(hasTileInCoverage(coverage, 2, 7, 4, '')).toBe(true);
        expect(hasTileInCoverage(coverage, 2, 4, 4, '')).toBe(false);
        expect(hasTileInCoverage(coverage, 2, 2, 5, '')).toBe(false);
        expect(hasTileInCoverage(coverage, 1, 2, 4, '')).toBe(false);
        expect(hasTileInCoverage(coverage, 2, 3, 4, '_b1')).toBe(false);
    });

    it('keeps satellite coverage independent and hides unsupported regions', () => {
        expect(hasSatelliteTiles('Dijiang')).toBe(true);
        expect(hasSatelliteTiles('Wuling')).toBe(false);
        expect(hasTileInCoverage(getRegionTileCoverage('Dijiang', 'satellite'), 3, 123, 4, '')).toBe(true);
        expect(hasTileInCoverage(getRegionTileCoverage('Dijiang'), 3, 123, 4, '')).toBe(false);
        expect(() => getRegionTileCoverage('Wuling', 'satellite')).toThrow();
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
