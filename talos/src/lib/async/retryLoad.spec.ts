import { afterEach, expect, it, vi } from 'vitest';
import { retryLoad } from './retryLoad';

afterEach(() => vi.useRealTimers());

it('spaces failures, reports each failure, and applies a success continuation once', async () => {
    vi.useFakeTimers();
    const first = new Error('catalog offline');
    const second = new Error('catalog still offline');
    const load = vi.fn().mockRejectedValueOnce(first).mockRejectedValueOnce(second).mockResolvedValue('catalog');
    const onRetry = vi.fn();
    const commit = vi.fn();
    const ready = retryLoad(load, { onRetry }).then(commit);
    await vi.advanceTimersByTimeAsync(0);
    expect(onRetry).toHaveBeenLastCalledWith(first);
    await vi.advanceTimersByTimeAsync(799);
    expect(load).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1);
    expect(onRetry).toHaveBeenLastCalledWith(second);
    await vi.advanceTimersByTimeAsync(800);
    await ready;
    expect(load).toHaveBeenCalledTimes(3);
    expect(commit).toHaveBeenCalledExactlyOnceWith('catalog');
    expect(vi.getTimerCount()).toBe(0);
});

it('clears a scheduled retry when cancelled and preserves the abort reason', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const load = vi.fn().mockRejectedValue(new Error('offline'));
    const ready = retryLoad(load, { signal: controller.signal });
    const reason = new Error('owner closed');
    const rejected = expect(ready).rejects.toBe(reason);
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    controller.abort(reason);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(1600);
    expect(load).toHaveBeenCalledOnce();
});

it('never starts an already cancelled operation or retries a late rejection after cancellation', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    controller.abort();
    const load = vi.fn().mockResolvedValue('ready');
    await expect(retryLoad(load, { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(load).not.toHaveBeenCalled();
    const next = new AbortController();
    let reject!: (error: Error) => void;
    load.mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail; }));
    const ready = retryLoad(load, { signal: next.signal });
    const rejected = expect(ready).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(0);
    next.abort();
    reject(new Error('late'));
    await rejected;
    await vi.advanceTimersByTimeAsync(1600);
    expect(load).toHaveBeenCalledOnce();
});

it('rejects errors in the failure reporter instead of treating application code as another load attempt', async () => {
    vi.useFakeTimers();
    const reportError = new Error('reporter failed');
    const load = vi.fn().mockRejectedValue(new Error('offline'));
    await expect(retryLoad(load, { onRetry: () => { throw reportError; } })).rejects.toBe(reportError);
    expect(load).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
});
