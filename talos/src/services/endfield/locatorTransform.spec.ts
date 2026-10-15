import { describe, expect, it } from 'vitest';
import { convertEFPosition, convertMapMarkerToEFGamePosition } from './locatorTransform';

describe('Wuling locator calibration', () => {
    it.each([
        [37900000004, 1019.780029296875, 1088.0400390625, -504.90308, 1377.10859],
        [37900000015, 1508.1700439453125, 1079.1700439453125, -507.81912, 1578.72706],
        [37900000006, 1131.1600341796875, 778.280029296875, -633.13696, 1422.4765],
    ])('places SP teleport %s near its shared map coordinate', (id, x, z, mapZ, mapX) => {
        const position = convertEFPosition({
            pos: { x, y: 0, z },
            mapId: 'map02',
            levelId: 'map02_lv010',
            isOnline: true,
        });

        expect(position.regionKey).toBe('Wuling');
        expect(position.subregionKey).toBe('WL_10');
        expect(position.mode).toBe('WL10');
        expect(Math.abs(position.mapX - mapX)).toBeLessThan(1);
        expect(Math.abs(position.mapZ - mapZ)).toBeLessThan(1);
        const roundTrip = convertMapMarkerToEFGamePosition(
            { id, x: position.mapX, y: 0, z: position.mapZ, subregId: 'WL_10' },
            'Wuling',
        );
        expect(roundTrip.x).toBeCloseTo(x, 8);
        expect(roundTrip.z).toBeCloseTo(z, 8);
    });

    it('routes the standalone Wuling scene to WL_16', () => {
        const position = convertEFPosition({
            pos: { x: 10, y: 0, z: 20 },
            mapId: 'map02',
            levelId: 'indie_dg016',
            isOnline: true,
        });
        expect(position.mode).toBe('WL4');
        expect(position.subregionKey).toBe('WL_16');
    });

    it('keeps the published transform for existing Wuling panes', () => {
        const position = convertEFPosition({
            pos: { x: 405.8999938964844, y: 0, z: -2037.27001953125 },
            mapId: 'map02',
            levelId: 'map02_lv006',
            isOnline: true,
        });
        expect(position.mode).toBe('WL');
        expect(position.mapX).toBeCloseTo(1120.8968, 3);
        expect(position.mapZ).toBeCloseTo(-1795.5209, 3);
    });
});
