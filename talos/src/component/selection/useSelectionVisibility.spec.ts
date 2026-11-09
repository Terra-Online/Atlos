import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useSelectionVisibility } from '@/component/selection/useSelectionVisibility';

afterEach(() => vi.useRealTimers());

it.each([250, 300])(
    'retains the %i ms fade and cancels removal when selecting again',
    async (delay) => {
        vi.useFakeTimers();
        const { result, rerender, unmount } = renderHook(
            ({ selecting }) => useSelectionVisibility(selecting, delay),
            { initialProps: { selecting: true } },
        );
        expect(result.current).toEqual({ visible: true, fading: false });
        rerender({ selecting: false });
        await act(() => vi.advanceTimersByTime(20));
        expect(result.current).toEqual({ visible: true, fading: true });
        rerender({ selecting: true });
        await act(() => vi.advanceTimersByTime(delay));
        expect(result.current).toEqual({ visible: true, fading: false });
        rerender({ selecting: false });
        await act(() => vi.advanceTimersByTime(delay - 1));
        expect(result.current.visible).toBe(true);
        await act(() => vi.advanceTimersByTime(1));
        expect(result.current.visible).toBe(false);
        unmount();
    },
);
