import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
});
afterEach(() => {
    vi.useRealTimers();
});

describe('marker batches', () => {
    it('deduplicates overlapping callers and permits retry after failure', async () => {
        const { createMarkerQueue, listByMarkerIds } = await import('./batch');
        const read = vi
            .fn()
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValue({ items: [{ markerId: 'a' }] });
        const stored = new Map<string, { markerId: string }[]>();
        const queue = createMarkerQueue({
            read,
            normalize: (item: { markerId: string }) => item,
            store: (id, items) => {
                stored.set(id, items);
            },
        });
        const peek = (id: string) => stored.get(id) ?? null;
        const first = listByMarkerIds([' a ', 'a', ''], peek, queue);
        const second = listByMarkerIds(['a'], peek, queue);
        const failed = Promise.allSettled([first, second]);
        await vi.runAllTimersAsync();
        expect((await failed).map((result) => result.status)).toEqual([
            'rejected',
            'rejected',
        ]);
        expect(read).toHaveBeenCalledTimes(1);
        expect(stored.size).toBe(0);
        const retry = listByMarkerIds(['a'], peek, queue);
        await vi.runAllTimersAsync();
        expect(await retry).toEqual({ a: [{ markerId: 'a' }] });
        expect(await listByMarkerIds(['a'], peek, queue)).toEqual(await retry);
        expect(read).toHaveBeenCalledTimes(2);
    });

    it('does not cache failed markers as empty lists, including legacy partial responses', async () => {
        const { createMarkerQueue } = await import('./batch');
        const read = vi
            .fn()
            .mockResolvedValueOnce({
                items: [{ markerId: 'a' }],
                partial: true,
            })
            .mockResolvedValueOnce({ items: [], failedMarkerIds: ['c'] })
            .mockResolvedValue({ items: [] });
        const store = vi.fn();
        const queue = createMarkerQueue({
            read,
            normalize: (item: { markerId: string }) => item,
            store,
        });
        const results = Promise.allSettled([queue('a'), queue('b')]);
        await vi.runAllTimersAsync();
        expect(await results).toMatchObject([
            { status: 'fulfilled' },
            { status: 'rejected', reason: { code: 'partialResponse' } },
        ]);
        expect(store).toHaveBeenCalledTimes(1);
        expect(store).toHaveBeenCalledWith('a', [{ markerId: 'a' }]);
        const next = Promise.allSettled([queue('b'), queue('c')]);
        await vi.runAllTimersAsync();
        expect(await next).toMatchObject([
            { status: 'fulfilled', value: [] },
            { status: 'rejected' },
        ]);
        expect(store).toHaveBeenCalledWith('b', []);
        const retry = queue('c');
        await vi.runAllTimersAsync();
        expect(await retry).toEqual([]);
    });

    it('shares eight request slots between resources and caps batches at 100 markers', async () => {
        const { createMarkerQueue } = await import('./batch');
        let active = 0;
        let peak = 0;
        const releases: (() => void)[] = [];
        const read = vi.fn((ids: string[]) => {
            expect(ids.length).toBeLessThanOrEqual(100);
            active += 1;
            peak = Math.max(peak, active);
            return new Promise<{ items: { markerId: string }[] }>((resolve) => {
                releases.push(() => {
                    active -= 1;
                    resolve({ items: ids.map((markerId) => ({ markerId })) });
                });
            });
        });
        const options = {
            read,
            normalize: (item: { markerId: string }) => item,
            store: () => undefined,
        };
        const images = createMarkerQueue(options);
        const comments = createMarkerQueue(options);
        const completed = Promise.all([
            ...Array.from({ length: 501 }, (_, i) => images(String(i))),
            ...Array.from({ length: 400 }, (_, i) => comments(String(i))),
        ]);
        await vi.runAllTimersAsync();
        expect(read).toHaveBeenCalledTimes(8);
        while (releases.length) {
            releases.splice(0).forEach((release) => release());
            await vi.runAllTimersAsync();
        }
        expect((await completed).length).toBe(901);
        expect(read).toHaveBeenCalledTimes(10);
        expect(peak).toBe(8);
        expect(active).toBe(0);
    });
});
