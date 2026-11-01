import { expect, it } from 'vitest';
import { MinimapZoom } from './minimap-zoom';

it('holds a band across boundary jitter in both directions', () => {
    const zoom = new MinimapZoom();
    expect(zoom.update(3, 'valley')).toBe(3);
    for (const value of [3.24, 3.26, 3.38, 3.27])
        expect(zoom.update(value, 'valley')).toBe(3);
    expect(zoom.update(3.41, 'valley')).toBe(3.5);
    for (const value of [3.26, 3.24, 3.12, 3.28])
        expect(zoom.update(value, 'valley')).toBe(3.5);
    expect(zoom.update(3.09, 'valley')).toBe(3);
});

it('bounds large changes and resets for a different scene or floor', () => {
    const zoom = new MinimapZoom();
    expect(zoom.update(3, 'a')).toBe(3);
    expect(zoom.update(0.1, 'a')).toBe(0);
    expect(zoom.update(99, 'a')).toBe(5);
    expect(zoom.update(-99, 'a')).toBe(0);
    expect(zoom.update(0.3, 'a')).toBe(0);
    expect(zoom.update(0.3, 'b')).toBe(0.5);
});

it('continuous ascent changes only at bands instead of every camera sample', () => {
    const zoom = new MinimapZoom();
    const levels = Array.from({ length: 501 }, (_, i) =>
        zoom.update(5 - i / 100, 'a'),
    );
    expect(new Set(levels).size).toBe(11);
    expect(
        levels.filter((level, i) => i > 0 && level !== levels[i - 1]),
    ).toHaveLength(10);
    expect(levels.every((level) => Number.isInteger(level * 2))).toBe(true);
});
