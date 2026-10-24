import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { usePresence } from './usePresence';

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

it('cancels an interrupted exit and notifies once after the next complete exit', async () => {
    vi.useFakeTimers();
    const onAfterClose = vi.fn();
    const { result, rerender } = renderHook(({ open }) => usePresence({ open, exitDuration: 300, onAfterClose }), { initialProps: { open: true } });
    await act(() => vi.advanceTimersToNextFrame());
    await act(() => vi.advanceTimersToNextFrame());
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

it.each([false, true])('keeps a committed starting frame when initially open is %s', async (initialOpen) => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ open }) => usePresence({ open, exitDuration: 300 }), { initialProps: { open: initialOpen } });
    if (!initialOpen) rerender({ open: true });
    expect(result.current.phase).toBe('entering');
    await act(() => vi.advanceTimersToNextFrame());
    expect(result.current.phase).toBe('entering');
    await act(() => vi.advanceTimersToNextFrame());
    expect(result.current.phase).toBe('open');
});

it('cancels entering frames on close and unmount, and skips them when animation is disabled', async () => {
    vi.useFakeTimers();
    const { result, rerender, unmount } = renderHook(({ open, animateOnOpen }) => usePresence({ open, animateOnOpen, exitDuration: 300 }), { initialProps: { open: true, animateOnOpen: true } });
    await act(() => vi.advanceTimersToNextFrame());
    rerender({ open: false, animateOnOpen: true });
    await act(() => vi.advanceTimersByTime(50));
    expect(result.current.phase).toBe('exiting');
    rerender({ open: true, animateOnOpen: false });
    expect(result.current.phase).toBe('open');
    rerender({ open: false, animateOnOpen: false });
    rerender({ open: true, animateOnOpen: true });
    unmount();
    expect(vi.getTimerCount()).toBe(0);
});

it('moves pending entry frames to the destination document', () => {
    vi.useFakeTimers();
    const iframe = document.createElement('iframe'); document.body.append(iframe);
    const other = iframe.contentWindow!;
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(other, 'requestAnimationFrame').mockImplementation((callback) => { frames.push(callback); return frames.length; });
    const { result, rerender, unmount } = renderHook(({ ownerDocument }) => usePresence({ open: true, exitDuration: 300, ownerDocument }), { initialProps: { ownerDocument: document } });
    try {
        rerender({ ownerDocument: other.document });
        expect(vi.getTimerCount()).toBe(0);
        act(() => frames.shift()!(0));
        expect(result.current.phase).toBe('entering');
        act(() => frames.shift()!(16));
        expect(result.current.phase).toBe('open');
    } finally { unmount(); iframe.remove(); }
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
