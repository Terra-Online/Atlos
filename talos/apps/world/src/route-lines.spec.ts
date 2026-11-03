import { describe, expect, it } from 'vitest';
import { DASH_PERIOD, projectLines } from './route-lines';
import type { Segment } from '@oem/ganglia';

const camera: Parameters<typeof projectLines>[1] = {
    position: [0, 0, 0],
    near: 0.25,
    fovY: Math.PI / 2,
    right: () => [1, 0, 0],
    up: () => [0, 1, 0],
    forward: () => [0, 0, 1],
};
const run = (points: Segment['points']): Segment => ({
    mode: 'walk',
    points,
    times: points.map((_, index) => index),
});

describe('route line projection', () => {
    it('keeps dash phase continuous over short segments and stable across pixel ratios', () => {
        const segments = [
            run([
                [-2, 0, 10],
                [0, 0, 10],
                [2, 0, 10],
            ]),
        ];
        const normal = projectLines(segments, camera, 200, 100, 1);
        const retina = projectLines(segments, camera, 400, 200, 2);
        expect(Array.from(retina)).toEqual(Array.from(normal));
        expect(normal.length).toBe(16);
        expect(normal[3]).toBe(0);
        expect(normal[7]).toBeCloseTo(10);
        expect(normal[11]).toBeCloseTo(normal[7] % DASH_PERIOD);
        expect(normal[2]).toBeCloseTo(camera.near / 10);
    });
    it('clips segments crossing the near plane before projection', () => {
        const result = projectLines(
            [
                run([
                    [-1, 0, -2],
                    [1, 1, 3],
                ]),
            ],
            camera,
            200,
            100,
            1,
        );
        expect(result.length).toBe(8);
        expect(result[2]).toBeCloseTo(1);
        expect(result[6]).toBeCloseTo(camera.near / 3);
        expect(Array.from(result).every(Number.isFinite)).toBe(true);
    });
    it('omits hidden-behind-camera and zero-screen-length segments', () => {
        expect(
            projectLines(
                [
                    run([
                        [0, 0, -3],
                        [1, 0, -2],
                    ]),
                    run([
                        [0, 0, 1],
                        [0, 0, 2],
                    ]),
                ],
                camera,
                200,
                100,
                1,
            ).length,
        ).toBe(0);
    });
});
