import L from 'leaflet';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import MapContextMenu from './MapContextMenu';
import { useMarkerStore } from '@/store/marker';
import { useUiPrefsStore } from '@/store/uiPrefs';
import { useHistoryStore } from '@/store/history';
import { MARKER_CONTEXT_MENU_EVENT } from '@/services/map/events/ContextMenuEvents';
import type { IMarkerData } from '@/data/marker';
import { mapFixture } from '../../../test-support/pages';

const api = vi.hoisted(() => ({ t: (key: string) => key, subregion: vi.fn(), copy: vi.fn(), highlight: vi.fn(), clear: vi.fn(), completed: vi.fn(), bulk: vi.fn(), pointUrl: vi.fn(), locationUrl: vi.fn() }));
vi.mock('@/locale', () => ({ useTranslateUI: () => api.t, useTranslateGame: () => api.t }));
vi.mock('@/services/map/subregionArea', () => ({ resolveSubregionAtLocation: api.subregion }));
vi.mock('@/platform/clipboard', () => ({ copyTextToClipboard: api.copy }));
vi.mock('@/services/routing', () => ({ generatePointShareUrl: api.pointUrl, generateLocationShareUrl: api.locationUrl }));
vi.mock('@/services/map/markerBulkActions', () => ({ resolveMarkerBulkTargets: api.bulk, highlightSameType: api.highlight, clearSameTypeHighlight: api.clear, setSameTypeCompleted: api.completed }));
const marker: IMarkerData = { id: 'menu-point', type: 'crate_ii', subregId: 'VL_1', pos: [0, 0], x: 0, y: 0, z: 0, tier: 0 };
const markerState = useMarkerStore.getState(), prefs = useUiPrefsStore.getState(), history = useHistoryStore.getState();
let fixture: ReturnType<typeof mapFixture>;
beforeEach(() => {
    vi.useFakeTimers(); vi.clearAllMocks(); fixture = mapFixture();
    api.subregion.mockReturnValue('VL_1'); api.copy.mockResolvedValue(true); api.pointUrl.mockReturnValue('https://example.test/point'); api.locationUrl.mockReturnValue('https://example.test/location');
    api.bulk.mockReturnValue({ allIds: ['a', 'b'], selectableIds: ['a', 'b'], selectedIds: [], completedIds: [], incompleteIds: ['a', 'b'] });
    useMarkerStore.setState({ selectedPoints: [], visibleSubregionKey: null }); useHistoryStore.setState({ past: [], future: [] });
});
afterEach(() => { cleanup(); fixture.dispose(); useMarkerStore.setState(markerState, true); useUiPrefsStore.setState(prefs, true); useHistoryStore.setState(history, true); vi.useRealTimers(); vi.restoreAllMocks(); });
const mapMenu = (latlng: L.LatLng = L.latLng(0, 0), altKey = false) => act(() => { fixture.map.fire('contextmenu', { latlng, originalEvent: new MouseEvent('contextmenu', { clientX: 40, clientY: 50, cancelable: true, altKey }) }); });
const markerMenu = () => act(() => { fixture.map.fire(MARKER_CONTEXT_MENU_EVENT, { marker, originalEvent: new MouseEvent('contextmenu', { clientX: 40, clientY: 50, cancelable: true }) }); });

it('preserves Alt native menus, allows sharing any map position and closes on camera movement', () => {
    render(<MapContextMenu map={fixture.map} />);
    mapMenu(L.latLng(0, 0), true); expect(screen.queryByRole('menu')).toBeNull();
    mapMenu(L.latLng(20, 20));
    expect(screen.getByRole<HTMLButtonElement>('menuitem', { name: 'contextMenu.shareLocation' }).disabled).toBe(false);
    expect(screen.getByRole<HTMLButtonElement>('menuitem', { name: 'contextMenu.undo' }).disabled).toBe(true);
    act(() => { fixture.map.fire('movestart'); });
    expect(screen.getByRole('menu').hasAttribute('inert')).toBe(true);
    expect(screen.getByRole('menu').style.pointerEvents).toBe('none');
});

it('uses the current camera in a location share and keeps the menu open for copy feedback', async () => {
    render(<MapContextMenu map={fixture.map} />); mapMenu(L.latLng(3, 4));
    await act(async () => { fireEvent.click(screen.getByRole('menuitem', { name: 'contextMenu.shareLocation' })); await Promise.resolve(); });
    expect(api.locationUrl).toHaveBeenCalledExactlyOnceWith({ lat: 3, lng: 4, zoom: 1 }); expect(api.copy).toHaveBeenCalledExactlyOnceWith('https://example.test/location');
    expect(screen.getByRole('menuitem', { name: 'common.copied' })).toBeTruthy();
    act(() => { vi.advanceTimersByTime(900); }); expect(screen.getByRole('menu').hasAttribute('inert')).toBe(true);
});

it('requires a second marker completion action, resets it on retargeting, and preserves scope options', () => {
    render(<MapContextMenu map={fixture.map} />); markerMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'contextMenu.completeSameType' }));
    expect(api.completed).not.toHaveBeenCalled(); expect(screen.getByRole('menuitem', { name: 'contextMenu.confirmComplete' })).toBeTruthy();
    act(() => { fixture.map.fire('talos:regionSwitched'); }); markerMenu();
    expect(screen.queryByRole('menuitem', { name: 'contextMenu.confirmComplete' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'contextMenu.completeSameType' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'contextMenu.confirmComplete' }));
    expect(api.completed).toHaveBeenCalledExactlyOnceWith(marker, { kind: 'subregion', id: 'VL_1' }, true, { treatArchivesAsSameType: true });
});

it('updates shared scope and supplement preferences and releases map listeners on unmount', () => {
    const view = render(<MapContextMenu map={fixture.map} />); markerMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: 'contextMenu.onlySubregion' }));
    expect(useMarkerStore.getState().visibleSubregionKey).toBe('VL_1');
    mapMenu(); fireEvent.click(screen.getByRole('menuitem', { name: 'contextMenu.showAllSubregions' }));
    expect(useMarkerStore.getState().visibleSubregionKey).toBeNull();
    const before = useUiPrefsStore.getState().mapSupplementsEnabled; mapMenu();
    fireEvent.click(screen.getByRole('menuitem', { name: before ? 'contextMenu.hideMapSupplements' : 'contextMenu.showMapSupplements' }));
    expect(useUiPrefsStore.getState().mapSupplementsEnabled).toBe(!before);
    const off = vi.spyOn(fixture.map, 'off'); view.unmount(); expect(off).toHaveBeenCalledWith(MARKER_CONTEXT_MENU_EVENT, expect.any(Function)); expect(fixture.map.listens('contextmenu')).toBe(false);
});
