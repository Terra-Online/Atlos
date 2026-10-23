import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { usePresence } from './usePresence';

afterEach(() => { cleanup(); vi.useRealTimers(); });

it('cancels an interrupted exit and notifies once after the next complete exit', async () => {
    vi.useFakeTimers();
    const onAfterClose = vi.fn();
    const { result, rerender } = renderHook(({ open }) => usePresence({ open, exitDuration: 300, onAfterClose }), { initialProps: { open: true } });
    await act(() => vi.advanceTimersByTime(20));
    expect(result.current.phase).toBe('open');
    rerender({ open: false });
    expect(result.current.phase).toBe('exiting');
    await act(() => vi.advanceTimersByTime(150));
    rerender({ open: true });
    await act(() => vi.advanceTimersByTime(500));
    expect(result.current.phase).toBe('open');
    expect(onAfterClose).not.toHaveBeenCalled();
    rerender({ open: false });
    await act(() => vi.advanceTimersByTime(300));
    expect(result.current.present).toBe(false);
    act(() => result.current.finishExit());
    expect(onAfterClose).toHaveBeenCalledOnce();
});

it('cancels pending callbacks on unmount and does not notify for an initially closed surface', async () => {
    vi.useFakeTimers();
    const onAfterClose = vi.fn();
    const { rerender, unmount } = renderHook(({ open }) => usePresence({ open, exitDuration: 300, onAfterClose }), { initialProps: { open: false } });
    await act(() => vi.advanceTimersByTime(400));
    expect(onAfterClose).not.toHaveBeenCalled();
    rerender({ open: true });
    rerender({ open: false });
    unmount();
    await act(() => vi.advanceTimersByTime(400));
    expect(onAfterClose).not.toHaveBeenCalled();
});
