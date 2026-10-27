import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { deferred } from '../../../test-support/pages';
import { usePointShareLink } from './usePointShareLink';
import { copyTextToClipboard } from '@/platform/clipboard';

vi.mock('@/platform/clipboard', () => ({ copyTextToClipboard: vi.fn() }));
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });
const point = (id: string) => ({ id, type: 'crate_ii', subregId: 'VL_1' });

it('does not show a copied popup for a different point after clipboard completion', async () => {
    vi.useFakeTimers();
    const pending = deferred<boolean>(); vi.mocked(copyTextToClipboard).mockReturnValue(pending.promise);
    const hook = renderHook(({ id }) => usePointShareLink(point(id)), { initialProps: { id: 'a' } });
    const originalUrl = hook.result.current.pointShareUrl;
    const copied = hook.result.current.copyPointShareUrl();
    hook.rerender({ id: 'b' });
    await act(async () => { pending.resolve(true); await copied; vi.advanceTimersToNextFrame(); });
    expect(hook.result.current.copiedPopupVisible).toBe(false);
    expect(copyTextToClipboard).toHaveBeenCalledExactlyOnceWith(originalUrl);
});

it('does not leave a popup frame or timer after its owner unmounts', async () => {
    vi.useFakeTimers();
    const pending = deferred<boolean>(); vi.mocked(copyTextToClipboard).mockReturnValue(pending.promise);
    const hook = renderHook(() => usePointShareLink(point('a')));
    const copied = hook.result.current.copyPointShareUrl();
    hook.unmount();
    pending.resolve(true); await copied;
    expect(vi.getTimerCount()).toBe(0);
});

it('shows and restarts the current popup, then clears it on point changes', async () => {
    vi.useFakeTimers(); vi.mocked(copyTextToClipboard).mockResolvedValue(true);
    const hook = renderHook(({ id }) => usePointShareLink(point(id)), { initialProps: { id: 'a' } });
    await act(async () => { await hook.result.current.copyPointShareUrl(); vi.advanceTimersToNextFrame(); });
    expect(hook.result.current.copiedPopupVisible).toBe(true);
    hook.rerender({ id: 'b' });
    expect(hook.result.current.copiedPopupVisible).toBe(false);
});
