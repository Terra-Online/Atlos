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

it('rotates Dijiang world coordinates onto the existing OEM floor plan and inverts that rotation', () => {
    const p = convertEFPosition({
        mapId: 'base01_lv001',
        levelId: 'base01_lv001',
        pos: { x: 0, y: 2.41, z: -50 },
        isOnline: true,
    });
    expect(p.mapX).toBeCloseTo(340.2204, 3);
    expect(p.mapZ).toBeCloseTo(-528.2047, 3);
    const world = convertMapMarkerToEFGamePosition(
        { x: 340.2204, y: 2.41, z: -528.2047, subregId: 'DJ_1' },
        'Dijiang',
    );
    expect(world.x).toBeCloseTo(0, 4);
    expect(world.z).toBeCloseTo(-50, 4);
    expect(world.y).toBe(2.41);
});

it('keeps the existing Valley, Wuling, independent scene and weekly map transforms invertible', () => {
    for (const [scene, region, subregId] of [
        ['map01', 'Valley_4', 'VL_1'],
        ['map02', 'Wuling', 'WL_1'],
        ['indie_dg005', 'Wuling', 'WL_2'],
        ['indie_dg007', 'Wuling', 'WL_4'],
        ['indie_dg016', 'Wuling', 'WL_16'],
        ['dung01_wrdg001', 'Weekraid_1', 'ES_1'],
    ]) {
        const pos = { x: 12, y: 40, z: -70 };
        const p = convertEFPosition({
            mapId: scene,
            levelId: scene,
            pos,
            isOnline: true,
        });
        const result = convertMapMarkerToEFGamePosition(
            { x: p.mapX, y: pos.y, z: p.mapZ, subregId },
            region,
        );
        expect(result.x).toBeCloseTo(pos.x, 10);
        expect(result.z).toBeCloseTo(pos.z, 10);
        expect(result.y).toBe(pos.y);
    }
});
