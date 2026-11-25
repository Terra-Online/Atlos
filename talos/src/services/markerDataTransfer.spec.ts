import { afterEach, expect, it, vi } from 'vitest';
import { exportMarkerData, importMarkerData } from './markerDataTransfer';
import { replacePointProgressFromExternal } from '@/store/history';
import { useUiPrefsStore } from '@/store/uiPrefs';
import { useUserRecordStore } from '@/store/userRecord';

const original = useUserRecordStore.getState();
const originalProgressPreference = useUiPrefsStore.getState().prefsMarkerProgressEnabled;
afterEach(() => {
    useUserRecordStore.setState(original);
    useUiPrefsStore.setState({ prefsMarkerProgressEnabled: originalProgressPreference });
    localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

const importBackup = (data: string, setSelected = vi.fn()) => importMarkerData(data, {
    replacePoints: replacePointProgressFromExternal,
    getActivePoints: () => useUserRecordStore.getState().activePoints,
    setFilter: vi.fn(),
    setSelected,
});

const downloadBackup = (activePoints: string[], activeArchives: string[], selectedPoints: string[] = []) => {
    const createObjectURL = vi.fn<(backup: Blob) => string>(() => 'blob:backup');
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    exportMarkerData(activePoints, [], selectedPoints, activeArchives);
    const [[backup]] = createObjectURL.mock.calls;
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result === 'string') resolve(reader.result);
            else reject(new Error('Expected a text backup'));
        };
        reader.onerror = reject;
        reader.readAsText(backup);
    });
};

it('exports and restores non-map Intel alongside map progress, merging both with existing records', async () => {
    const content = await downloadBackup(['42'], ['nar_mission', 'nar_shop']);

    useUserRecordStore.setState({ activePoints: ['existing'], activeArchives: ['nar_existing', 'nar_shop'] });
    expect(importBackup(content)).toBe(true);
    expect(importBackup(content)).toBe(true);
    expect(useUserRecordStore.getState()).toMatchObject({
        activePoints: ['existing', '42'],
        activeArchives: ['nar_existing', 'nar_shop', 'nar_mission'],
    });
});

it('restores an Intel-only backup from browser storage after the progress store reloads', async () => {
    useUiPrefsStore.setState({ prefsMarkerProgressEnabled: true });
    const activeArchives = ['nar_mission', 'nar_shop'];
    const content = await downloadBackup([], activeArchives, ['selected-only']);

    useUserRecordStore.setState({ activePoints: [], activeArchives: [] });
    expect(importBackup(content)).toBe(true);

    // Reload the store module with the same browser storage, as on page reload.
    vi.resetModules();
    const { useUserRecordStore: reloaded } = await import('@/store/userRecord');
    expect(reloaded).not.toBe(useUserRecordStore);
    await reloaded.persist.rehydrate();
    expect(reloaded.getState()).toMatchObject({ activePoints: [], activeArchives });
});

it('keeps an imported archive in the current session when progress saving is disabled', async () => {
    useUiPrefsStore.setState({ prefsMarkerProgressEnabled: false });
    useUserRecordStore.setState({ activePoints: [], activeArchives: [] });
    const saved = JSON.stringify({ state: { activePoints: [], activeArchives: [] }, version: 0 });
    localStorage.setItem('points-storage', saved);
    const postMessage = vi.fn();
    vi.stubGlobal('BroadcastChannel', class {
        postMessage = postMessage;
        close() {}
    });

    expect(importBackup(await downloadBackup([], ['nar_mission']))).toBe(true);
    expect(useUserRecordStore.getState().activeArchives).toEqual(['nar_mission']);
    expect(localStorage.getItem('points-storage')).toBe(saved);
    expect(postMessage).not.toHaveBeenCalled();
});

it('keeps selections separate from completion and preserves existing Intel on legacy imports', () => {
    useUserRecordStore.setState({ activePoints: [], activeArchives: ['nar_existing'] });
    const legacy = { version: 3, activePoints: [23], filter: [], selectedPoints: [42, 43, 44, 45] };
    const setSelected = vi.fn();
    expect(importBackup(JSON.stringify(legacy), setSelected)).toBe(true);
    const snapshot = useUserRecordStore.getState();
    expect(snapshot).toMatchObject({ activePoints: ['23'], activeArchives: ['nar_existing'] });
    expect(setSelected).toHaveBeenCalledWith('42', true);
});

it('rejects malformed Intel before writing progress', () => {
    const snapshot = useUserRecordStore.getState();
    const invalid = { version: 4, activePoints: ['new'], filter: [], selectedPoints: [], activeArchives: [null] };
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(importBackup(JSON.stringify(invalid))).toBe(false);
    expect(useUserRecordStore.getState()).toBe(snapshot);
});
