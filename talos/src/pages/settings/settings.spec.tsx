import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Settings from './settings';
import { useUiPrefsStore } from '@/store/uiPrefs';
import { useMarkerStore } from '@/store/marker';
import { useUserRecordStore } from '@/store/userRecord';
import { installResizeObserver } from '../../../test-support/browser';
import TreeMap from '@/pages/storage/treeMap/treeMap';
import * as d3 from 'd3';
import { useHistoryStore } from '@/store/history';

const api = vi.hoisted(() => ({ t: (key: string) => key, clear: vi.fn(), clearAll: vi.fn(), export: vi.fn(), import: vi.fn(), applyTheme: vi.fn(), followSystem: vi.fn(), tree: vi.fn() }));
vi.mock('@/locale', () => ({ useTranslateUI: () => api.t }));
vi.mock('@/locale/useFontRegion', () => ({ useFontRegion: () => () => {} }));
vi.mock('@/platform/device', () => ({ useDevice: () => ({ type: 'desktop' }) }));
vi.mock('@/platform/pictureInPicture', () => ({ useAppDocument: () => document, getOpenerDocument: () => document }));
vi.mock('@/component/effects/AdaptiveLinearBlur', () => ({ default: () => null }));
vi.mock('@/platform/theme', () => ({ applyTheme: api.applyTheme, startSystemFollow: api.followSystem }));
vi.mock('@/services/storageInspector', () => ({ getStorageTreeMapData: api.tree, clearStorageItem: api.clear, clearAllStorage: api.clearAll }));
vi.mock('@/services/markerDataTransfer', () => ({ exportMarkerData: api.export, importMarkerData: api.import }));
const prefs = useUiPrefsStore.getState(), markers = useMarkerStore.getState(), records = useUserRecordStore.getState(), history = useHistoryStore.getState();
beforeEach(() => {
    installResizeObserver(); vi.clearAllMocks();
    api.tree.mockResolvedValue([{ name: 'marker-filter', id: 'marker-filter', value: 128 }]);
    // Deletion is an external boundary here. Do not reload jsdom or touch real browser data.
    api.clear.mockReturnValue(new Promise<void>(() => {})); api.clearAll.mockReturnValue(new Promise<void>(() => {}));
    useUiPrefsStore.setState({ prefsSidebarEnabled: true, prefsHideCompletedMarkers: false, theme: 'light' });
});
afterEach(() => { cleanup(); useUiPrefsStore.setState(prefs, true); useMarkerStore.setState(markers, true); useUserRecordStore.setState(records, true); useHistoryStore.setState(history, true); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });
const mount = () => render(<Settings open onClose={vi.fn()} />);

it('writes the actual preference store from real triggers and applies explicit or system-following themes', async () => {
    mount(); await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getByRole('button', { name: 'settings.uiPrefs.sidebar' }));
    expect(useUiPrefsStore.getState().prefsSidebarEnabled).toBe(false);
    expect(screen.getByRole('button', { name: 'settings.uiPrefs.sidebar' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByRole('button', { name: 'settings.mapPrefs.hideCompleted' }));
    expect(useUiPrefsStore.getState().prefsHideCompletedMarkers).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /settings.theme.dark/ }));
    expect(useUiPrefsStore.getState().theme).toBe('dark');
    expect(api.applyTheme).toHaveBeenCalledExactlyOnceWith('dark', true);
    fireEvent.click(screen.getByRole('button', { name: /settings.theme.auto/ }));
    expect(useUiPrefsStore.getState().theme).toBe('auto');
    expect(api.followSystem).toHaveBeenCalledExactlyOnceWith(true);
});

it('requires a delayed second click to clear storage, cancels outside, and keeps destructive scopes distinct', async () => {
    vi.useFakeTimers(); mount(); await act(async () => { await Promise.resolve(); });
    const clearAll = screen.getByRole('button', { name: 'common.clear common.all' });
    fireEvent.click(clearAll); fireEvent.click(clearAll);
    expect(api.clearAll).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(799); }); fireEvent.click(clearAll);
    expect(api.clearAll).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(1); });
    fireEvent.click(document.body); fireEvent.click(clearAll);
    expect(api.clearAll).not.toHaveBeenCalled();
    act(() => { vi.advanceTimersByTime(800); });
    fireEvent.click(clearAll);
    expect(api.clearAll).toHaveBeenCalledOnce();
    expect(api.clear).not.toHaveBeenCalled();
    api.clear.mockResolvedValueOnce(undefined).mockReturnValueOnce(new Promise<void>(() => {}));
    const clearProgress = screen.getByRole('button', { name: 'common.clear storage.filtersAndMarkers' });
    fireEvent.click(clearProgress); act(() => { vi.advanceTimersByTime(800); });
    await act(async () => { fireEvent.click(clearProgress); await Promise.resolve(); });
    expect(api.clear.mock.calls).toEqual([[['LocalStorage', 'marker-filter']], [['LocalStorage', 'points-storage']]]);
});

it('passes raw storage ids from the real D3 tree into selected deletion and exports the live store values', async () => {
    vi.useFakeTimers(); mount(); await act(async () => { await Promise.resolve(); });
    const selected = screen.getByRole('button', { name: 'common.clear common.selected' });
    expect((selected as HTMLButtonElement).disabled).toBe(true);
    const leaf = screen.getByText('MarkerFilter');
    fireEvent.click(leaf.closest('g')!);
    const clear = screen.getByRole('button', { name: 'common.clear MarkerFilter' });
    fireEvent.click(clear); act(() => { vi.advanceTimersByTime(800); }); fireEvent.click(clear);
    expect(api.clear).toHaveBeenCalledExactlyOnceWith(['marker-filter']);
    useMarkerStore.setState({ filter: ['ore'], selectedPoints: ['point'] }); useUserRecordStore.setState({ activePoints: ['collected'] });
    fireEvent.click(screen.getByRole('button', { name: 'storage.export' }));
    expect(api.export).toHaveBeenCalledExactlyOnceWith(['collected'], ['ore'], ['point']);
});

it('keeps original URL ids and byte totals while navigating a nested storage tree', async () => {
    vi.useFakeTimers();
    api.tree.mockResolvedValue([{ name: 'cache-storage', id: 'CacheStorage', children: [
        { name: 'large-object', id: 'https://assets.example/map tile?v=2', value: 1048576 },
        { name: 'tiny-object', id: 'tiny', value: 1 },
    ] }]);
    const selected = vi.fn(); const view = render(<TreeMap onSelect={selected} />);
    await act(async () => { await Promise.resolve(); });
    const parent = screen.getByText('CacheStorage').closest('g')!;
    expect(parent.querySelector('title')!.textContent).toContain('1.00 MiB');
    fireEvent.click(parent);
    expect(selected).toHaveBeenLastCalledWith(['CacheStorage'], 'CacheStorage');
    fireEvent.click(screen.getByText('LargeObject').closest('g')!);
    expect(selected).toHaveBeenLastCalledWith(['CacheStorage', 'https://assets.example/map tile?v=2'], 'LargeObject');
    expect(screen.getByText('TinyObject').closest('g')!.querySelector('title')!.textContent).toContain('1 B');
    // jsdom has no SVG transform interpolation. Navigation and raw ids above use real D3;
    // interrupt only the scheduled visual transition before leaving this DOM fixture.
    const svg = d3.select(view.container.querySelector('svg')!); svg.interrupt(); svg.selectAll('*').interrupt();
});

it('reads import files and wires parsed data to the real progress and filter stores', async () => {
    mount(); await act(async () => { await Promise.resolve(); });
    api.import.mockImplementation((content: string, callbacks: {
        replacePoints: (points: string[]) => void;
        setFilter: (filter: string[]) => void;
        setSelected: (id: string, value: boolean) => void;
        getActivePoints: () => string[];
        getFilter: () => string[];
    }) => {
        expect(content).toBe('{"source":"fixture"}');
        callbacks.replacePoints(['restored']); callbacks.setFilter(['ore']); callbacks.setSelected('selected', true);
        expect(callbacks.getActivePoints()).toEqual(['restored']); expect(callbacks.getFilter()).toEqual(['ore']);
        // Parsing/merge confirmation is the transfer service boundary; no browser reload here.
        return false;
    });
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const picked = vi.spyOn(input, 'click'); fireEvent.click(screen.getByRole('button', { name: 'storage.import' })); expect(picked).toHaveBeenCalledOnce();
    fireEvent.change(input, { target: { files: [] } }); expect(api.import).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { files: [new File(['{"source":"fixture"}'], 'markers.json', { type: 'application/json' })] } });
    await waitFor(() => { expect(api.import).toHaveBeenCalledOnce(); }); expect(input.value).toBe('');
    expect(useMarkerStore.getState().selectedPoints).toContain('selected');
});
