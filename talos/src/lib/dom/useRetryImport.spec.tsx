import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useRetryImport } from './useRetryImport';

afterEach(() => { cleanup(); vi.useRealTimers(); });
function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}
const settle = async (update: () => void = () => {}) => {
    await act(async () => { update(); for (let i = 0; i < 4; i++) await Promise.resolve(); });
};

it('waits for activation, retries repeatedly with spacing, and reuses a successful payload after reopening', async () => {
    vi.useFakeTimers();
    const payload = { default: () => null };
    const load = vi.fn().mockRejectedValueOnce(new Error('offline')).mockRejectedValueOnce(new Error('offline again')).mockResolvedValue(payload);
    const { result, rerender } = renderHook(({ active }) => useRetryImport(load, active), { initialProps: { active: false } });
    await act(() => vi.advanceTimersByTimeAsync(1600));
    expect(load).not.toHaveBeenCalled();
    await settle(() => rerender({ active: true }));
    expect(result.current).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(799));
    expect(load).toHaveBeenCalledTimes(1);
    await act(() => vi.advanceTimersByTimeAsync(801));
    expect(load).toHaveBeenCalledTimes(3);
    expect(result.current).toBe(payload);
    rerender({ active: false }); rerender({ active: true });
    await settle();
    expect(load).toHaveBeenCalledTimes(3);
});

it.each(['close', 'unmount'])('clears pending retry timers on %s', async (mode) => {
    vi.useFakeTimers();
    const load = vi.fn().mockRejectedValue(new Error('offline'));
    const view = renderHook(({ active }) => useRetryImport(load, active, 200), { initialProps: { active: true } });
    await settle();
    expect(vi.getTimerCount()).toBe(1);
    if (mode === 'close') view.rerender({ active: false });
    else view.unmount();
    expect(vi.getTimerCount()).toBe(0);
    await act(() => vi.advanceTimersByTimeAsync(1000));
    expect(load).toHaveBeenCalledOnce();
});

it.each(['resolve', 'reject'] as const)('ignores stale %s after close and lets a new activation own its result', async (completion) => {
    vi.useFakeTimers();
    const stale = deferred<string>();
    const next = deferred<string>();
    const load = vi.fn().mockReturnValueOnce(stale.promise).mockReturnValueOnce(next.promise);
    const { result, rerender } = renderHook(({ active }) => useRetryImport(load, active), { initialProps: { active: true } });
    await settle();
    rerender({ active: false });
    await settle(() => rerender({ active: true }));
    await settle(() => completion === 'resolve' ? stale.resolve('old') : stale.reject(new Error('old')));
    expect(result.current).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    await settle(() => next.resolve('current'));
    expect(result.current).toBe('current');
});

it('also spaces synchronous loader throws instead of starting a hot retry loop', async () => {
    vi.useFakeTimers();
    const load = vi.fn<() => Promise<string>>(() => { throw new Error('loader'); });
    renderHook(() => useRetryImport(load, true, 100));
    await settle();
    expect(load).toHaveBeenCalledOnce();
    await act(() => vi.advanceTimersByTimeAsync(99));
    expect(load).toHaveBeenCalledOnce();
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(load).toHaveBeenCalledTimes(2);
});

it('does not start an import if its owner unmounts before the activation microtask runs', async () => {
    const load = vi.fn().mockResolvedValue('ready');
    const view = renderHook(() => useRetryImport(load, true));
    view.unmount();
    await settle();
    expect(load).not.toHaveBeenCalled();
});
