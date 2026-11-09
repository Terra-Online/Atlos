import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { observeProgressStorage, useUserRecordStore } from './userRecord';
import { useUiPrefsStore } from './uiPrefs';

const original = { record: useUserRecordStore.getState(), prefs: useUiPrefsStore.getState() };
const stops: (() => void)[] = [];
const channels: { onmessage: (() => void) | null; close: ReturnType<typeof vi.fn> }[] = [];
beforeEach(() => {
    localStorage.clear();
    channels.length = 0;
    useUiPrefsStore.setState({ prefsMarkerProgressEnabled: true });
    useUserRecordStore.setState({ activePoints: ['saved'], activeArchives: ['archive'], updatedAt: 1 });
    vi.stubGlobal('BroadcastChannel', class {
        onmessage = null;
        close = vi.fn();
        constructor() { channels.push(this); }
    });
});
afterEach(() => {
    for (const stop of stops.splice(0)) stop();
    useUserRecordStore.setState(original.record, true); useUiPrefsStore.setState(original.prefs, true);
    localStorage.clear(); vi.unstubAllGlobals(); vi.restoreAllMocks();
});
const storage = (value: unknown) => {
    localStorage.setItem('points-storage', JSON.stringify(value));
    window.dispatchEvent(new StorageEvent('storage', { key: 'points-storage' }));
};

it('finishes hydration of absent or invalid-shaped storage without discarding live progress', async () => {
    const saved = useUserRecordStore.getState();
    for (const value of [undefined, null, { state: null }, { state: { activePoints: 'invalid' } }]) {
        if (value === undefined) localStorage.removeItem('points-storage');
        else localStorage.setItem('points-storage', JSON.stringify(value));
        await useUserRecordStore.persist.rehydrate();
        expect(useUserRecordStore.getState()).toBe(saved);
        expect(useUserRecordStore.persist.hasHydrated()).toBe(true);
    }
});

it('accepts a partial legacy update and preserves the other collection', () => {
    const changed = vi.fn(); stops.push(observeProgressStorage(changed));
    storage({ state: { activePoints: [42, 'new'], updatedAt: 7 } });
    expect(useUserRecordStore.getState()).toEqual({ activePoints: ['42', 'new'], activeArchives: ['archive'], updatedAt: 7 });
    expect(changed).toHaveBeenCalledOnce();
    storage({ state: { activeArchives: ['new-archive'], updatedAt: 8 } });
    expect(useUserRecordStore.getState().activePoints).toEqual(['42', 'new']);
    expect(changed).toHaveBeenCalledOnce();
});

it('restores changes that arrived between module hydration and mounting the app observer', () => {
    localStorage.setItem('points-storage', JSON.stringify({ state: { activePoints: ['during-startup'], updatedAt: 7 } }));
    const changed = vi.fn(); stops.push(observeProgressStorage(changed));
    expect(useUserRecordStore.getState().activePoints).toEqual(['during-startup']);
    expect(useUserRecordStore.getState().activeArchives).toEqual(['archive']);
    expect(changed).toHaveBeenCalledOnce();
    channels[0].onmessage?.();
    expect(changed).toHaveBeenCalledOnce();
});

it('deduplicates native storage and broadcast notifications instead of echoing writes or undo barriers', () => {
    const changed = vi.fn(); stops.push(observeProgressStorage(changed));
    storage({ state: { activePoints: ['new'], activeArchives: ['archive'], updatedAt: 7 } });
    const saved = useUserRecordStore.getState();
    const write = vi.spyOn(localStorage, 'setItem');
    channels[0].onmessage?.();
    window.dispatchEvent(new StorageEvent('storage', { key: 'points-storage' }));
    expect(useUserRecordStore.getState()).toBe(saved);
    expect(changed).toHaveBeenCalledOnce();
    expect(write).not.toHaveBeenCalled();
});

it('ignores malformed JSON, invalid fields and unrelated storage while retaining the current owner', () => {
    const changed = vi.fn(); stops.push(observeProgressStorage(changed));
    const saved = useUserRecordStore.getState();
    localStorage.setItem('points-storage', '{invalid'); channels[0].onmessage?.();
    storage({ state: { activePoints: [null], activeArchives: 'invalid', updatedAt: 99 } });
    localStorage.setItem('points-storage', JSON.stringify({ state: { activePoints: ['another'], updatedAt: 9 } }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'other' }));
    // The test runtime exposes Node's sessionStorage, not a jsdom Storage wrapper.
    const unrelatedArea = new StorageEvent('storage', { key: 'points-storage' });
    Object.defineProperty(unrelatedArea, 'storageArea', { value: window.sessionStorage });
    window.dispatchEvent(unrelatedArea);
    expect(useUserRecordStore.getState()).toBe(saved);
    expect(changed).not.toHaveBeenCalled();
});

it('restores existing external data with persistence disabled without replacing that storage payload', () => {
    stops.push(observeProgressStorage());
    useUiPrefsStore.setState({ prefsMarkerProgressEnabled: false });
    const raw = JSON.stringify({ state: { activePoints: [42], updatedAt: 7 } });
    localStorage.setItem('points-storage', raw); channels[0].onmessage?.();
    expect(useUserRecordStore.getState().activePoints).toEqual(['42']);
    expect(useUserRecordStore.getState().activeArchives).toEqual(['archive']);
    expect(localStorage.getItem('points-storage')).toBe(raw);
});

it('stops both listeners and late channel callbacks when the consumer unmounts', () => {
    const changed = vi.fn(); const stop = observeProgressStorage(changed); stops.push(stop);
    stop();
    storage({ state: { activePoints: ['late'], updatedAt: 9 } });
    channels[0].onmessage?.();
    expect(useUserRecordStore.getState().activePoints).toEqual(['saved']);
    expect(changed).not.toHaveBeenCalled();
    expect(channels[0].close).toHaveBeenCalledOnce();
});

it('keeps a new progress undo created immediately after persistence is re-enabled and restored', async () => {
    const { commitPointProgress, useHistoryStore } = await import('./history');
    await vi.dynamicImportSettled();
    const history = useHistoryStore.getState();
    try {
        useHistoryStore.getState().clear();
        useUiPrefsStore.getState().setPrefsMarkerProgressEnabled(false);
        localStorage.setItem('points-storage', JSON.stringify({ state: { activePoints: ['external'], activeArchives: ['archive'], updatedAt: 7 }, version: 0 }));
        useUiPrefsStore.getState().setPrefsMarkerProgressEnabled(true);
        // localStorage hydration is synchronous. A new user command belongs to
        // the restored baseline, even if lazy history cleanup has not settled.
        expect(useUserRecordStore.getState().activePoints).toEqual(['external']);
        expect(commitPointProgress('after restore', { collect: ['new-point'] })).toBe(true);
        expect(useHistoryStore.getState().canUndo()).toBe(true);
        await vi.dynamicImportSettled();
        expect(useUserRecordStore.getState().activePoints).toEqual(['external', 'new-point']);
        expect(useHistoryStore.getState().canUndo()).toBe(true);
        useHistoryStore.getState().undo();
        expect(useUserRecordStore.getState().activePoints).toEqual(['external']);
    } finally {
        useHistoryStore.setState(history, true);
    }
});
