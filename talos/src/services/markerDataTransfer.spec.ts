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

const importBackup = (data: string) => importMarkerData(data, {
    replacePoints: replacePointProgressFromExternal,
    getActivePoints: () => useUserRecordStore.getState().activePoints,
    setFilter: vi.fn(),
    setSelected: vi.fn(),
});

const downloadBackup = (activePoints: string[], activeArchives: string[]) => {
    const createObjectURL = vi.fn<(backup: Blob) => string>(() => 'blob:backup');
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    exportMarkerData(activePoints, [], [], activeArchives);
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
    const content = await downloadBackup([], activeArchives);

    useUserRecordStore.setState({ activePoints: [], activeArchives: [] });
    expect(importBackup(content)).toBe(true);

    // Reload the store module with the same browser storage, as on page reload.
    vi.resetModules();
    const { useUserRecordStore: reloaded } = await import('@/store/userRecord');
    expect(reloaded).not.toBe(useUserRecordStore);
    await reloaded.persist.rehydrate();
    expect(reloaded.getState()).toMatchObject({ activePoints: [], activeArchives });
});

it('keeps existing Intel on legacy imports and rejects malformed Intel before writing progress', () => {
    useUserRecordStore.setState({ activePoints: [], activeArchives: ['nar_existing'] });
    const legacy = { version: 3, activePoints: [42], filter: [], selectedPoints: [] };
    expect(importBackup(JSON.stringify(legacy))).toBe(true);
    const snapshot = useUserRecordStore.getState();
    expect(snapshot).toMatchObject({ activePoints: ['42'], activeArchives: ['nar_existing'] });

    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(importBackup(JSON.stringify({ ...legacy, activePoints: ['new'], activeArchives: [null] }))).toBe(false);
    expect(useUserRecordStore.getState()).toBe(snapshot);
});
