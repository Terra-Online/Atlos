import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReadCache } from './readCache';

afterEach(() => vi.useRealTimers());
describe('point response retention', () => {
    it('releases expired values on reads and writes without a polling timer', () => {
        vi.useFakeTimers();
        const cache = new ReadCache<{ expiresAt: number; value: string }>();
        cache.set('read', { expiresAt: Date.now() + 10, value: 'first' });
        cache.set('write', { expiresAt: Date.now() + 10, value: 'second' });
        vi.advanceTimersByTime(11);
        expect(cache.get('read')).toBeUndefined();
        expect(cache.has('read')).toBe(false);
        cache.set('fresh', { expiresAt: Date.now() + 100, value: 'fresh' });
        expect([...cache.keys()]).toEqual(['fresh']);
        expect(vi.getTimerCount()).toBe(0);
    });
    it('bounds responses while keeping a frequently revisited point', () => {
        const cache = new ReadCache<{ expiresAt: number }>();
        const value = { expiresAt: Date.now() + 60_000 };
        for (let i = 0; i < 512; i++) cache.set(String(i), value);
        expect(cache.get('0')).toBe(value);
        cache.set('next', value);
        expect(cache.size).toBe(512);
        expect(cache.has('0')).toBe(true);
        expect(cache.has('1')).toBe(false);
        cache.clear();
        expect(cache.size).toBe(0);
    });
});
