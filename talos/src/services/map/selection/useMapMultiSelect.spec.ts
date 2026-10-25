import L from 'leaflet';
import { afterEach, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { registerLassoHandler, useMapMultiSelect, isLassoSelected } from './useMapMultiSelect';
import { getMarkerState, setMarkerState, SceneIcon } from '@/services/map/core/canvas/markerModel';
import { ViewportMarker } from '@/services/map/core/canvas/markerViewport';
import { useMarkerStore } from '@/store/marker';
import { useUiPrefsStore } from '@/store/uiPrefs';
import * as records from '@/store/userRecord';
import type { IMarkerData } from '@/data/marker';

it('previews lasso deselection and restores checked points on cancel without marker elements', () => {
    const host = document.createElement('div'); document.body.append(host);
    const map = L.map(host, { crs: L.CRS.Simple }).setView([0, 0], 2);
    const marker = L.marker([0, 0]);
    const point: IMarkerData = { id: 'lasso', type: 'test', subregId: 'fixture', pos: [0, 0], x: 0, y: 0, z: 0, tier: 0 };
    const active = vi.spyOn(records, 'getActivePoints').mockReturnValue(['lasso']);
    const previous = useMarkerStore.getState().selectedPoints;
    useMarkerStore.setState({ selectedPoints: ['lasso'] });
    setMarkerState(marker, { selected: true, checked: true });
    const stop = registerLassoHandler(map, { markerDict: { lasso: marker }, markerDataDict: { lasso: point },
        getActiveFilterKeys: () => ['test'], isSubregionVisible: () => true });
    try {
        expect(marker.getElement()).toBeUndefined();
        map.fire('talos:lassoHighlight', { bounds: L.latLngBounds([-1, -1], [1, 1]), deselect: true });
        expect(getMarkerState(marker)).toMatchObject({ selected: false, checked: false });
        map.fire('talos:lassoClear');
        expect(getMarkerState(marker)).toMatchObject({ selected: true, checked: true });
        stop();
        expect(map.hasEventListeners('talos:lassoHighlight')).toBe(false);
    } finally { stop(); active.mockRestore(); useMarkerStore.setState({ selectedPoints: previous }); map.remove(); host.remove(); }
});

const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).reverse().forEach(cleanup => cleanup()); vi.restoreAllMocks(); });
function fixture() {
    const host = document.createElement('div'); document.body.append(host);
    Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
    const map = L.map(host, { crs: L.CRS.Simple, zoomAnimation: false }).setView([0, 0], 2);
    let removed = false; map.once('unload', () => { removed = true; });
    const snapshot = useMarkerStore.getState(), prefs = useUiPrefsStore.getState();
    useMarkerStore.setState({ selectedPoints: [] });
    useUiPrefsStore.setState({ prefsHideCompletedMarkers: false });
    cleanups.push(() => { if (!removed) map.remove(); host.remove(); useMarkerStore.setState(snapshot); useUiPrefsStore.setState(prefs); });
    return { host, map };
}
function point(id: string, pos: [number, number], type = 'visible', subregId = 'fixture'): IMarkerData {
    return { id, type, subregId, pos, x: pos[1], y: 0, z: pos[0], tier: 0 };
}

it.each([true, false])('matches inclusive range selection and current visibility after data changes (versioned=%s)', versioned => {
    const { map } = fixture();
    let version = 0, filters = ['visible'], completed = ['p-11', 'p-22'];
    const regions = new Set(['fixture']);
    const markerDataDict: Record<string, IMarkerData> = {}, markerDict: Record<string, L.Layer> = {};
    for (let i = 0; i < 221; i++) {
        const row = point(`p-${i}`, [(i * 7) % 17 - 8, (i * 11) % 13 - 6], i % 5 ? 'visible' : 'hidden', i % 7 ? 'fixture' : 'other');
        markerDataDict[row.id] = row; markerDict[row.id] = L.marker(row.pos);
    }
    markerDataDict.invalid = point('invalid', [NaN, 0]);
    markerDict.invalid = L.marker([0, 0]);
    vi.spyOn(records, 'getActivePoints').mockImplementation(() => completed);
    useUiPrefsStore.setState({ prefsHideCompletedMarkers: true });
    const stop = registerLassoHandler(map, { markerDict, markerDataDict, getMarkerVersion: versioned ? () => version : undefined,
        getActiveFilterKeys: () => filters, isSubregionVisible: subregId => regions.has(subregId) });
    cleanups.push(stop);
    const query = (bounds: L.LatLngBounds) => {
        const collected: string[] = [];
        map.fire('talos:lassoSelect', { bounds, collected, deselect: false });
        const expected = Object.entries(markerDataDict).filter(([id, row]) => filters.includes(row.type)
            && regions.has(row.subregId) && (!useUiPrefsStore.getState().prefsHideCompletedMarkers || !completed.includes(id))
            && row.pos[0] >= bounds.getSouth() && row.pos[0] <= bounds.getNorth()
            && row.pos[1] >= bounds.getWest() && row.pos[1] <= bounds.getEast()).map(([id]) => id);
        expect(collected).toEqual(expected);
    };
    for (const bounds of [L.latLngBounds([-2, -1], [3, 2]), L.latLngBounds([0, -20], [0, 20]), L.latLngBounds([-20, 1], [20, 1])]) query(bounds);
    filters = ['visible', 'hidden']; regions.add('other'); completed = ['p-33'];
    query(L.latLngBounds([-3, -2], [3, 2]));
    useUiPrefsStore.setState({ prefsHideCompletedMarkers: false });
    query(L.latLngBounds([-8, -6], [8, 6]));
    delete markerDataDict['p-1']; delete markerDict['p-1'];
    markerDataDict.added = point('added', [0, 0]); markerDict.added = L.marker([0, 0]); version++;
    query(L.latLngBounds([0, 0], [0, 0]));
});

it('reconciles a preview against the exact final bounds before discarding gesture tracking', () => {
    const { map } = fixture(), a = L.marker([-10, -10]), b = L.marker([0, 0]), c = L.marker([10, 10]);
    useMarkerStore.setState({ selectedPoints: ['b'] }); setMarkerState(b, { selected: true });
    vi.spyOn(records, 'getActivePoints').mockReturnValue([]);
    cleanups.push(registerLassoHandler(map, { markerDict: { a, b, c }, markerDataDict: {
        a: point('a', [-10, -10]), b: point('b', [0, 0]), c: point('c', [10, 10]),
    }, getActiveFilterKeys: () => ['visible'], isSubregionVisible: () => true, getMarkerVersion: () => 0 }));
    map.fire('talos:lassoHighlight', { bounds: L.latLngBounds([-11, -11], [1, 1]), deselect: false });
    expect(getMarkerState(a).selected).toBe(true);
    const collected: string[] = [];
    map.fire('talos:lassoSelect', { bounds: L.latLngBounds([9, 9], [11, 11]), collected, deselect: false });
    expect(collected).toEqual(['c']);
    expect(getMarkerState(a).selected).toBe(false);
    expect(getMarkerState(b).selected).toBe(true);
    expect(getMarkerState(c).selected).toBe(true);
});

function gesture(canvas = false) {
    const { host, map } = fixture();
    const frames = new Map<number, FrameRequestCallback>(); let next = 0;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.set(++next, callback); return next; });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(id => { frames.delete(id); });
    const frame = () => {
        for (const id of [...frames.keys()]) {
            const callback = frames.get(id); frames.delete(id); callback?.(performance.now());
        }
    };
    const markerDict: Record<string, L.Marker> = {}, markerDataDict: Record<string, IMarkerData> = {};
    for (const [id, x, y] of [['a', 150, 150], ['b', 350, 200], ['c', 600, 400]] as const) {
        const latlng = map.containerPointToLatLng([x, y]);
        markerDict[id] = canvas ? new ViewportMarker(latlng, { icon: new SceneIcon({ image: '', subImage: '', tier: '', noFrame: false }, id) }).addTo(map) : L.marker(latlng);
        markerDataDict[id] = point(id, [latlng.lat, latlng.lng]);
    }
    const paint = vi.fn();
    if (canvas) { map.fire('move'); host.querySelector('canvas')!.getContext('2d')!.clearRect = paint; }
    vi.spyOn(records, 'getActivePoints').mockReturnValue([]);
    const stop = registerLassoHandler(map, { markerDict, markerDataDict, getMarkerVersion: () => 0,
        getActiveFilterKeys: () => ['visible'], isSubregionVisible: () => true });
    cleanups.push(stop);
    const hook = renderHook(() => useMapMultiSelect(map)); cleanups.push(hook.unmount);
    const highlights = vi.fn(); map.on('talos:lassoHighlight', highlights);
    const send = (type: string, x: number, y: number, shiftKey = false) => act(() => {
        host.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, ctrlKey: true, metaKey: true, shiftKey, buttons: type === 'pointerup' ? 0 : 1 }));
    });
    return { host, map, frame, send, highlights, markerDict, hook, paint };
}

it('coalesces preview input and commits the pointer-up position before its pending frame', () => {
    const { host, map, send, frame, highlights, markerDict } = gesture();
    send('pointerdown', 450, 350);
    send('pointermove', 400, 300); send('pointermove', 300, 200); send('pointermove', 100, 100);
    expect(highlights).not.toHaveBeenCalled(); act(frame);
    expect(highlights).toHaveBeenCalledOnce();
    expect(getMarkerState(markerDict.a).selected).toBe(true); expect(getMarkerState(markerDict.b).selected).toBe(true);
    send('pointermove', 700, 500); send('pointerup', 650, 450);
    expect(useMarkerStore.getState().selectedPoints).toEqual(['c']);
    expect(isLassoSelected('c')).toBe(true);
    expect(getMarkerState(markerDict.a).selected).toBe(false); expect(getMarkerState(markerDict.b).selected).toBe(false);
    const overlay = host.querySelector<HTMLDivElement>('[class*="lassoOverlay"]')!;
    expect(overlay.style.left).toBe('450px'); expect(overlay.style.top).toBe('350px');
    expect(overlay.style.width).toBe('200px'); expect(overlay.style.height).toBe('100px');
    act(frame); expect(highlights).toHaveBeenCalledOnce();
    expect(map.dragging.enabled()).toBe(true);
    send('pointerdown', 450, 350, true); send('pointerup', 650, 450, true);
    expect(useMarkerStore.getState().selectedPoints).toEqual([]);
    expect(isLassoSelected('c')).toBe(false);
});

it.each(['release', 'unmount'])('cancels pending preview work and restores marker state and map dragging on %s', reason => {
    const { map, send, frame, highlights, markerDict, hook } = gesture();
    send('pointerdown', 50, 50); send('pointermove', 400, 250); act(frame);
    expect(getMarkerState(markerDict.a).selected).toBe(true);
    send('pointermove', 700, 500);
    if (reason === 'release') act(() => { window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', ctrlKey: false, metaKey: false })); });
    else hook.unmount();
    expect(map.dragging.enabled()).toBe(true);
    expect(getMarkerState(markerDict.a).selected).toBe(false); expect(getMarkerState(markerDict.b).selected).toBe(false);
    act(frame); expect(highlights).toHaveBeenCalledOnce();
    expect(useMarkerStore.getState().selectedPoints).toEqual([]);
});

it('preserves handlers that were disabled before the gesture', () => {
    const { map, send } = gesture();
    map.dragging.disable(); map.boxZoom.disable();
    send('pointerdown', 50, 50); send('pointerup', 55, 55);
    expect(map.dragging.enabled()).toBe(false); expect(map.boxZoom.enabled()).toBe(false);
});

it('cancels pending work on map unload without enabling removed map handlers', () => {
    const { map, send, frame, highlights, hook } = gesture();
    send('pointerdown', 50, 50); send('pointermove', 400, 250);
    map.remove(); hook.unmount();
    act(frame); expect(highlights).not.toHaveBeenCalled();
    expect(map.dragging.enabled()).toBe(false);
});

it('paints each coalesced preview once while earlier marker transitions are still active', () => {
    const { send, frame, paint } = gesture(true);
    send('pointerdown', 50, 50); send('pointermove', 400, 250); act(frame);
    expect(paint).toHaveBeenCalledOnce(); paint.mockClear();
    send('pointermove', 410, 260); act(frame);
    expect(paint).toHaveBeenCalledOnce();
});
