import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as markers from '@/data/marker';
import { useUserRecordStore, getActivePoints } from './userRecord';
import { useHistoryStore, commitPointProgress } from './history';
import { useUiPrefsStore } from './uiPrefs';
import { beginGuideProgress, endGuideProgress, previewGuideProgress, getDisplayedPointProgress, useDisplayedPointProgress } from './guideProgress';

const original = { records: useUserRecordStore.getState(), history: useHistoryStore.getState(), prefs: useUiPrefsStore.getState() };
const point = (id: string, type = 'guide'): markers.IMarkerData => ({ id, type, subregId: 'VL_1', pos: [0, 0], x: 0, y: 0, z: 0, tier: 0 });
const data = [point('saved'), point('new'), point('outside', 'other')];
let owner: symbol;
const deferred = () => {
    let resolve!: (value: markers.IMarkerData[]) => void;
    const promise = new Promise<markers.IMarkerData[]>((done) => { resolve = done; });
    return { promise, resolve };
};
beforeEach(() => {
    useUiPrefsStore.setState({ prefsMarkerProgressEnabled: true });
    useUserRecordStore.setState({ activePoints: ['saved', 'outside'], activeArchives: ['archive'], updatedAt: 7 });
    useHistoryStore.setState({ past: [], future: [] });
    vi.spyOn(markers, 'loadAllMarkers').mockResolvedValue(data);
    owner = beginGuideProgress();
});
afterEach(() => {
    cleanup(); endGuideProgress(owner);
    useUserRecordStore.setState(original.records, true); useHistoryStore.setState(original.history, true); useUiPrefsStore.setState(original.prefs, true);
    vi.restoreAllMocks();
});

it('shows complete and cleared previews without notifying real progress, persistence or history consumers', async () => {
    commitPointProgress('manual', { collect: ['manual'] });
    useHistoryStore.getState().undo();
    const saved = useUserRecordStore.getState(), history = useHistoryStore.getState();
    const persisted = localStorage.getItem('points-storage');
    const changed = vi.fn(); const unsubscribe = useUserRecordStore.subscribe(changed);
    const view = renderHook(() => useDisplayedPointProgress());
    try {
        await act(() => previewGuideProgress('guide', true));
        expect(view.result.current).toEqual(['saved', 'outside', 'new']);
        expect(getDisplayedPointProgress()).toBe(view.result.current);
        expect(getActivePoints()).toEqual(['saved', 'outside']);
        await act(() => previewGuideProgress('guide', false));
        expect(view.result.current).toEqual(['outside']);
        expect(useUserRecordStore.getState()).toBe(saved);
        expect(useHistoryStore.getState()).toBe(history);
        expect(localStorage.getItem('points-storage')).toBe(persisted);
        expect(changed).not.toHaveBeenCalled();
        act(() => endGuideProgress(owner));
        expect(view.result.current).toBe(saved.activePoints);
    } finally { unsubscribe(); }
});

it('reveals the latest real changes on exit instead of restoring a stale snapshot', async () => {
    const view = renderHook(() => useDisplayedPointProgress());
    await act(() => previewGuideProgress('guide', false));
    act(() => { commitPointProgress('real edit', { collect: ['new', 'another'], uncollect: ['outside'] }); });
    expect(view.result.current).toEqual(['another']);
    act(() => endGuideProgress(owner));
    expect(view.result.current).toEqual(['saved', 'new', 'another']);
    act(() => useHistoryStore.getState().undo());
    expect(view.result.current).toEqual(['saved', 'outside']);
});

it('keeps the last requested demo action when marker loads resolve in reverse order', async () => {
    const older = deferred(), newer = deferred();
    vi.mocked(markers.loadAllMarkers).mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const complete = previewGuideProgress('guide', true), clear = previewGuideProgress('guide', false);
    newer.resolve(data); await clear;
    expect(getDisplayedPointProgress()).toEqual(['outside']);
    older.resolve(data); await complete;
    expect(getDisplayedPointProgress()).toEqual(['outside']);
    expect(getActivePoints()).toEqual(['saved', 'outside']);
});

it('ignores an old load and its cleanup after a new walkthrough begins', async () => {
    const oldOwner = owner, pending = deferred();
    vi.mocked(markers.loadAllMarkers).mockReturnValueOnce(pending.promise);
    const oldAction = previewGuideProgress('guide', true);
    endGuideProgress(owner); owner = beginGuideProgress();
    await previewGuideProgress('guide', false);
    endGuideProgress(oldOwner);
    pending.resolve(data); await oldAction;
    expect(getDisplayedPointProgress()).toEqual(['outside']);
    endGuideProgress(owner);
    expect(getDisplayedPointProgress()).toEqual(['saved', 'outside']);
});

it('preserves the current view on loading failure and allows a later action to recover', async () => {
    await previewGuideProgress('guide', true);
    vi.mocked(markers.loadAllMarkers).mockRejectedValueOnce(new Error('temporary load'));
    await expect(previewGuideProgress('guide', false)).rejects.toThrow('temporary load');
    expect(getDisplayedPointProgress()).toEqual(['saved', 'outside', 'new']);
    await previewGuideProgress('guide', false);
    expect(getDisplayedPointProgress()).toEqual(['outside']);
    expect(getActivePoints()).toEqual(['saved', 'outside']);
});
