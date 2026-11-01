import { describe, expect, it } from 'vitest';
import { isCameraSample, isCameraView, isPreviewOrigin, vector } from './types';

describe('noclip message boundaries', () => {
    it('accepts location-only camera targets and legacy full companions, rejecting invalid pose data', () => {
        const point = {
            id: '1',
            scene: 'map01',
            level: 'map01_lv001',
            region: 'Valley_4',
            subregion: 'VL_1',
            tier: 0,
            position: [1, 2, 3],
        };
        const sample = { point, position: [4, 5, 6], forward: [0, 0, 1] };
        expect(isCameraSample(sample)).toBe(true);
        expect(
            isCameraSample({
                ...sample,
                point: {
                    ...point,
                    condition: null,
                    presets: [],
                    locks: [],
                    unknown: [],
                },
            }),
        ).toBe(true);
        expect(
            isCameraSample({
                ...sample,
                point: { ...point, scene: undefined },
            }),
        ).toBe(false);
        expect(isCameraSample({ ...sample, forward: [NaN, 0, 1] })).toBe(false);
        expect(
            isCameraSample({
                ...sample,
                view: { groundY: 1, fovY: 0, aspect: 1 },
            }),
        ).toBe(false);
    });
    it('accepts the preview deployment and local development, not suffix or path lookalikes', () => {
        expect(isPreviewOrigin('https://oem-world.pages.dev')).toBe(true);
        expect(isPreviewOrigin('http://127.0.0.1:5199')).toBe(true);
        for (const origin of [
            'https://oem-world.pages.dev.attacker.test',
            'https://oem-world.pages.dev/path',
            'null',
            'javascript:alert(1)',
        ])
            expect(isPreviewOrigin(origin)).toBe(false);
    });
    it('rejects nonfinite and incomplete camera coordinates', () => {
        expect(vector([1, 2, 3])).toBe(true);
        for (const value of [
            [1, 2],
            [1, Infinity, 3],
            [1, NaN, 3],
            ['1', 2, 3],
            {},
        ])
            expect(vector(value)).toBe(false);
    });
    it('validates the optional perspective metadata before using it to zoom the minimap', () => {
        const view = { groundY: 100, fovY: Math.PI / 3, aspect: 16 / 9 };
        expect(isCameraView(view)).toBe(true);
        for (const invalid of [
            undefined,
            {},
            { ...view, groundY: NaN },
            { ...view, fovY: 0 },
            { ...view, fovY: Math.PI },
            { ...view, aspect: Infinity },
            { ...view, aspect: -1 },
        ])
            expect(isCameraView(invalid)).toBe(false);
    });
});
