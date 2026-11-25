import { afterEach, expect, it, vi } from 'vitest';
import { exportMarkerData, importMarkerData } from './markerDataTransfer';
import { replacePointProgressFromExternal } from '@/store/history';
import { useUserRecordStore } from '@/store/userRecord';

const original = useUserRecordStore.getState();
afterEach(() => {
    useUserRecordStore.setState(original);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

const importBackup = (data: string) => importMarkerData(data, {
    replacePoints: replacePointProgressFromExternal,
    getActivePoints: () => useUserRecordStore.getState().activePoints,
    setFilter: vi.fn(),
    setSelected: vi.fn(),
});

it('exports and restores non-map Intel alongside map progress, merging both with existing records', async () => {
    const createObjectURL = vi.fn<(backup: Blob) => string>(() => 'blob:backup');
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    exportMarkerData(['42'], [], [], ['nar_mission', 'nar_shop']);
    const [[backup]] = createObjectURL.mock.calls;
    const content = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            if (typeof reader.result === 'string') resolve(reader.result);
            else reject(new Error('Expected a text backup'));
        };
        reader.onerror = reject;
        reader.readAsText(backup);
    });

    useUserRecordStore.setState({ activePoints: ['existing'], activeArchives: ['nar_existing', 'nar_shop'] });
    expect(importBackup(content)).toBe(true);
    expect(importBackup(content)).toBe(true);
    expect(useUserRecordStore.getState()).toMatchObject({
        activePoints: ['existing', '42'],
        activeArchives: ['nar_existing', 'nar_shop', 'nar_mission'],
    });
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
