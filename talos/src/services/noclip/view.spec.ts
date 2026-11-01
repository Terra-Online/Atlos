import { expect, it } from 'vitest';
import { minimapZoom } from './view';

const view = {
    altitude: 100,
    down: 1,
    fovY: Math.PI / 3,
    aspect: 1,
    width: 256,
    height: 256,
    unitsPerMeter: 0.5,
};

it('zooms out one level when altitude doubles, independent of absolute scene elevation', () => {
    expect(minimapZoom({ ...view, altitude: 200 })).toBeCloseTo(
        minimapZoom(view) - 1,
    );
});

it('follows the lens, pitch and local map transform scale', () => {
    expect(minimapZoom({ ...view, fovY: Math.PI / 6 })).toBeGreaterThan(
        minimapZoom(view),
    );
    expect(minimapZoom({ ...view, down: 0.5 })).toBeCloseTo(
        minimapZoom(view) - 1,
    );
    expect(minimapZoom({ ...view, unitsPerMeter: 1 })).toBeCloseTo(
        minimapZoom(view) - 1,
    );
    expect(minimapZoom({ ...view, aspect: 2 })).toBeCloseTo(
        minimapZoom(view) - 1,
    );
});

it('keeps ground, horizon, empty-viewport and very high views within available tile zooms', () => {
    expect(minimapZoom({ ...view, altitude: 0 })).toBe(4);
    expect(minimapZoom({ ...view, altitude: -50 })).toBe(4);
    expect(minimapZoom({ ...view, altitude: 100000 })).toBe(0);
    expect(
        Number.isFinite(
            minimapZoom({ ...view, down: -1, width: 0, height: 0 }),
        ),
    ).toBe(true);
});
