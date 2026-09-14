import { describe, expect, it, vi } from 'vitest';
import { CollectedCountCache } from './collectedCountCache';
describe('collection counts', () => {
    it('does not scan marker data for an empty collection', () => {
        const cache = new CollectedCountCache(), load = vi.fn(() => []);
        expect(cache.get([], 1, 'region:a', load).size).toBe(0);
        expect(load).not.toHaveBeenCalled();
    });
    it('shares a scope scan across type counters and invalidates on data or collection changes', () => {
        const cache = new CollectedCountCache(), ids = ['a', 'c'];
        const load = vi.fn(() => [{ id: 'a', type: 'x' }, { id: 'b', type: 'x' }, { id: 'c', type: 'y' }]);
        expect(cache.get(ids, 1, 'region:a', load).get('x')).toBe(1);
        expect(cache.get(ids, 1, 'region:a', load).get('y')).toBe(1);
        expect(load).toHaveBeenCalledTimes(1);
        cache.get(ids, 2, 'region:a', load); expect(load).toHaveBeenCalledTimes(2);
        expect(cache.get(['b'], 2, 'region:a', load).get('y')).toBeUndefined();
        expect(load).toHaveBeenCalledTimes(3);
    });
});
