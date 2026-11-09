import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { MarkFilterDragProvider } from './reorderContext';
import { useMarkFilterDragContext } from './reorderCore';
import { useUiPrefsStore } from '@/store/uiPrefs';

const prefs = useUiPrefsStore.getState();
beforeEach(() => { vi.useFakeTimers(); useUiPrefsStore.setState({ markFilterOrder: ['a', 'b', 'c'] }); });
afterEach(() => { cleanup(); useUiPrefsStore.setState(prefs, true); vi.useRealTimers(); });

it('uses the live provider order through multiple drag swaps and persists the completed gesture', () => {
    const hook = renderHook(() => useMarkFilterDragContext(), { wrapper: MarkFilterDragProvider });
    act(() => { ['a', 'b', 'c'].forEach((id, index) => hook.result.current.register(id, () => ({ top: index * 100, bottom: (index + 1) * 100, height: 100, center: index * 100 + 50 }))); });
    act(() => { hook.result.current.startDrag('a'); });
    expect(hook.result.current.draggingId).toBe('a');
    act(() => { hook.result.current.updateDrag('a', 120); });
    expect(hook.result.current.orderOf('a')).toBe(1);
    act(() => { hook.result.current.updateDrag('a', 220); });
    expect(hook.result.current.orderOf('a')).toBe(2);
    expect(useUiPrefsStore.getState().markFilterOrder).toEqual(['a', 'b', 'c']);
    act(() => { hook.result.current.endDrag(); });
    expect(useUiPrefsStore.getState().markFilterOrder).toEqual(['b', 'c', 'a']);
    expect(hook.result.current.isDragging).toBe(false);
});

it('ignores another category drag and unregistered targets without corrupting the saved order', () => {
    const hook = renderHook(() => useMarkFilterDragContext(), { wrapper: MarkFilterDragProvider });
    act(() => { hook.result.current.register('a', () => ({ top: 0, bottom: 100, height: 100, center: 50 })); hook.result.current.startDrag('a'); });
    act(() => { hook.result.current.updateDrag('b', 999); hook.result.current.unregister('a'); hook.result.current.updateDrag('a', 999); hook.result.current.endDrag(); });
    expect(useUiPrefsStore.getState().markFilterOrder).toEqual(['a', 'b', 'c']);
});

it('cannot replay registration order over a drag completed before the next timer turn', () => {
    const hook = renderHook(() => useMarkFilterDragContext(), { wrapper: MarkFilterDragProvider });
    act(() => { ['a', 'b', 'c', 'd'].forEach((id, index) => hook.result.current.register(id, () => ({ top: index * 100, bottom: (index + 1) * 100, height: 100, center: index * 100 + 50 }))); });
    act(() => { hook.result.current.startDrag('d'); });
    act(() => { hook.result.current.updateDrag('d', -220); });
    act(() => { hook.result.current.endDrag(); });
    const completed = useUiPrefsStore.getState().markFilterOrder;
    expect(completed).toEqual(['a', 'b', 'd', 'c']);
    act(() => { vi.runOnlyPendingTimers(); });
    expect(useUiPrefsStore.getState().markFilterOrder).toEqual(completed);
});

it('does not overwrite a new owner after structural registration unmounts', () => {
    const hook = renderHook(() => useMarkFilterDragContext(), { wrapper: MarkFilterDragProvider });
    act(() => { hook.result.current.register('new', () => ({ top: 0, bottom: 100, height: 100, center: 50 })); });
    hook.unmount();
    useUiPrefsStore.setState({ markFilterOrder: ['new-owner'] });
    act(() => { vi.runOnlyPendingTimers(); });
    expect(useUiPrefsStore.getState().markFilterOrder).toEqual(['new-owner']);
});
