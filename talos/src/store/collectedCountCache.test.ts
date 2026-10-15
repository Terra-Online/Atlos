import { describe, expect, it, vi } from 'vitest';
import { CollectedCountCache } from './collectedCountCache';
const point = (id: string, type: string, x: number, y = 0, z = 0) => ({ id, type, x, y, z });
describe('collection counts', () => {
    it('does not scan marker data for an empty collection', () => {
        const cache = new CollectedCountCache(), load = vi.fn(() => []);
        expect(cache.get([], 1, 'region:a', load).size).toBe(0);
        expect(load).not.toHaveBeenCalled();
    });
    it('shares a scope scan across type counters and invalidates on data or collection changes', () => {
        const cache = new CollectedCountCache(), ids = ['a', 'c'];
        const load = vi.fn(() => [point('a', 'x', 0), point('b', 'x', 1), point('c', 'y', 0)]);
        expect(cache.get(ids, 1, 'region:a', load).get('x')).toBe(1);
        expect(cache.get(ids, 1, 'region:a', load).get('y')).toBe(1);
        expect(load).toHaveBeenCalledTimes(1);
        cache.get(ids, 2, 'region:a', load); expect(load).toHaveBeenCalledTimes(2);
        expect(cache.get(['b'], 2, 'region:a', load).get('y')).toBeUndefined();
        expect(load).toHaveBeenCalledTimes(3);
    });
    it('counts each visible point once when duplicate IDs are also collected', () => {
        const cache = new CollectedCountCache();
        const markers = [point('a', 'x', 0), point('duplicate', 'x', 0), point('b', 'x', 1)];
        expect(cache.get(['a', 'duplicate', 'b'], 1, 'region:a', () => markers).get('x')).toBe(2);
        expect(cache.get(['a', 'duplicate'], 1, 'region:a', () => markers).get('x')).toBe(1);
        // A hidden duplicate alone must not complete the visible first marker.
        expect(cache.get(['duplicate'], 1, 'region:a', () => markers).get('x')).toBeUndefined();
    });
    it('keeps different coordinates and types separate and invalidates a deduplicated scope after loading', () => {
        const cache = new CollectedCountCache();
        const ids = ['a', 'b', 'c', 'd'];
        const markers = [point('a', 'x', 0), point('b', 'x', 0, 0.000001), point('c', 'y', 0)];
        const load = () => markers;
        expect(cache.get(ids, 1, 'world', load).get('x')).toBe(2);
        expect(cache.get(ids, 1, 'world', load).get('y')).toBe(1);
        markers.push(point('d', 'x', 2));
        expect(cache.get(ids, 2, 'world', load).get('x')).toBe(3);
    });
    it('ignores rows without a marker type, matching the generated totals', () => {
        const cache = new CollectedCountCache();
        const markers = [point('a', '', 0), point('b', 'x', 0)];
        expect(Object.fromEntries(cache.get(['a', 'b'], 1, 'world', () => markers))).toEqual({ x: 1 });
    });
});
