import { describe, expect, it } from 'vitest';
import L from 'leaflet';
import {
    buildProjectedCurves,
    cubicBetween,
    cubicTAtLength,
    type CubicGeometry,
} from '@/pages/map/behaviorOverlay/cubicSpline';

describe('cubic spline geometry', () => {
    it('preserves straight-line length and arc-length lookup', () => {
        const curves = buildProjectedCurves(
            [L.point(0, 0), L.point(10, 0), L.point(20, 0)],
            false,
        );
        const totalLength = curves.reduce(
            (total, curve) => total + curve.length,
            0,
        );

        expect(curves).toHaveLength(2);
        expect(totalLength).toBeCloseTo(20, 8);
        expect(cubicTAtLength(curves[0], 0)).toBeCloseTo(0, 8);
        expect(cubicTAtLength(curves[0], curves[0].length)).toBeCloseTo(1, 8);
    });

    it('builds one cubic segment for each edge of a closed path', () => {
        const curves = buildProjectedCurves(
            [
                L.point(0, 0),
                L.point(10, 0),
                L.point(10, 10),
                L.point(0, 10),
                L.point(0, 0),
            ],
            true,
        );

        expect(curves).toHaveLength(4);
        expect(curves[0].startLength).toBe(0);
        expect(curves[3].startLength).toBeGreaterThan(curves[2].startLength);
        expect(curves[3].p3.equals(L.point(0, 0))).toBe(true);
    });

    it('clips a cubic without moving the requested endpoints', () => {
        const curve: CubicGeometry = {
            p0: L.point(0, 0),
            p1: L.point(10 / 3, 0),
            p2: L.point(20 / 3, 0),
            p3: L.point(10, 0),
        };
        const middle = cubicBetween(curve, 0.25, 0.75);

        expect(middle.p0.x).toBeCloseTo(2.5, 8);
        expect(middle.p3.x).toBeCloseTo(7.5, 8);
        expect(middle.p0.y).toBe(0);
        expect(middle.p3.y).toBe(0);
    });
});
