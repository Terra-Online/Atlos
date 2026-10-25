import * as markers from '@/data/marker';
import { useMarkerStore } from '@/store/marker';
import L from 'leaflet';
import { waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { IMarkerData } from '@/data/marker';
import type { MapCore } from '@/services/map/core/map';
import { useLayerStore } from '@/store/layer';
import { getInitialNavigationView, prepareInitialNavigation, navigateToMarkerId, navigateToSharedLocation, navigateToSharedPoint, registerSharedPointMapCore } from './navigation';
import useViewState from '@/store/viewState';

const cleanups: Array<() => void> = [];
afterEach(() => { cleanups.splice(0).forEach((fn) => fn()); vi.restoreAllMocks(); });

it('selects the target floor on every navigation, including a repeated basement target', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const map = L.map(host, { crs: L.CRS.Simple, maxZoom: 5 }).setView([0, 0], 1);
    const flyTo = vi.spyOn(map, 'flyTo').mockImplementation((center, zoom) => {
        map.setView(center, zoom, { animate: false });
        map.fire('moveend');
        return map;
    });
    const point = { id: 'floor-target', type: 'test', subregId: 'VL_1', pos: [1, 2], tier: -1 } as IMarkerData;
    const switchLayer = vi.fn(() => Promise.resolve());
    const unregister = registerSharedPointMapCore({
        map, switchRegion: () => Promise.resolve(true), switchLayer,
        markerLayer: { markerDataDict: { [point.id]: point }, filterMarker: vi.fn(), ensureMarkerVisible: () => Promise.resolve(), startMarkerPulse: () => true },
    } as unknown as MapCore);
    cleanups.push(() => { unregister(); map.remove(); host.remove(); });
    const target = { regionKey: 'Valley_4', pointId: point.id };
    navigateToSharedPoint(target);
    await waitFor(() => expect(flyTo).toHaveBeenCalledTimes(1));
    expect(useLayerStore.getState().currentLayer).toBe('B1');
    useLayerStore.getState().setCurrentLayer('M');
    navigateToSharedPoint(target);
    await waitFor(() => expect(flyTo).toHaveBeenCalledTimes(2));
    expect(switchLayer.mock.calls).toEqual([['B1'], ['B1']]);
    expect(useLayerStore.getState().currentLayer).toBe('B1');
});

it('applies the latest target without waiting for an old reveal and discards an older ID lookup', async () => {
    const host = document.createElement('div'); document.body.append(host);
    const map = L.map(host, { crs: L.CRS.Simple, maxZoom: 5 }).setView([0, 0], 1);
    const flyTo = vi.spyOn(map, 'flyTo').mockImplementation((center, zoom) => {
        map.setView(center, zoom, { animate: false }); map.fire('moveend'); return map;
    });
    const previous = { id: 'old', type: 'test', subregId: 'VL_1', pos: [1, 2], tier: 0 } as IMarkerData;
    const latest = { ...previous, id: 'new', pos: [3, 4] } as IMarkerData;
    let finishReveal!: (shown: boolean) => void;
    const ensureMarkerVisible = vi.fn<() => Promise<boolean>>()
        .mockImplementationOnce(() => new Promise((resolve) => { finishReveal = resolve; }))
        .mockResolvedValue(true);
    const unregister = registerSharedPointMapCore({
        map, switchRegion: () => Promise.resolve(true), switchLayer: () => Promise.resolve(),
        markerLayer: { markerDataDict: { old: previous, new: latest }, filterMarker: vi.fn(), ensureMarkerVisible, startMarkerPulse: () => true },
    } as unknown as MapCore);
    cleanups.push(() => { unregister(); map.remove(); host.remove(); });
    navigateToSharedPoint({ regionKey: 'Valley_4', pointId: 'old' });
    await waitFor(() => expect(ensureMarkerVisible).toHaveBeenCalledOnce());
    let finishLookup!: (marker: IMarkerData) => void;
    vi.spyOn(markers, 'findMarkerById').mockImplementation(() => new Promise((resolve) => { finishLookup = resolve; }));
    const lookup = navigateToMarkerId('old');
    navigateToSharedPoint({ regionKey: 'Valley_4', pointId: 'new' });
    await waitFor(() => expect(flyTo).toHaveBeenCalledOnce());
    expect(useMarkerStore.getState().currentActivePoint?.id).toBe('new');
    finishReveal(true); finishLookup(previous);
    expect(await lookup).toBe(false);
    expect(flyTo).toHaveBeenCalledOnce();
    expect(useMarkerStore.getState().currentActivePoint?.id).toBe('new');
});

it('initializes a point link at its destination floor without flying, retaining focused content and later navigation', async () => {
    const point = { id: 'initial', type: 'test', subregId: 'VL_1', pos: [-625, 375], tier: -1 } as IMarkerData;
    vi.spyOn(markers, 'findMarkerById').mockResolvedValue(point);
    const saved = { ...useViewState.getState().viewStates };
    navigateToSharedPoint({ regionKey: 'Valley_4', pointId: point.id, content: { kind: 'comment', id: 'comment' } });
    await prepareInitialNavigation();
    expect(getInitialNavigationView()).toMatchObject({ regionId: 'Valley_4', view: { lat: -625, lng: 375, zoom: 3 } });
    expect(useLayerStore.getState().currentLayer).toBe('B1');
    expect(useViewState.getState().viewStates).toEqual(saved);
    const host = document.createElement('div'); document.body.append(host);
    const map = L.map(host, { crs: L.CRS.Simple, maxZoom: 5 }).setView(point.pos, 3);
    const flyTo = vi.spyOn(map, 'flyTo').mockImplementation((center, zoom) => {
        map.setView(center, zoom, { animate: false }); map.fire('moveend'); return map;
    });
    const pulse = vi.fn();
    const core = { map, switchRegion: () => Promise.resolve(true), switchLayer: () => Promise.resolve(),
        markerLayer: { markerDataDict: { [point.id]: point }, filterMarker: vi.fn(), ensureMarkerVisible: () => Promise.resolve(), startMarkerPulse: pulse } } as unknown as MapCore;
    const unregister = registerSharedPointMapCore(core);
    cleanups.push(() => { unregister(); map.remove(); host.remove(); });
    await waitFor(() => expect(pulse).toHaveBeenCalledOnce());
    expect(flyTo).not.toHaveBeenCalled();
    expect(useMarkerStore.getState().currentActivePoint?.id).toBe(point.id);
    expect(useMarkerStore.getState().commentOpenRequest).toMatchObject({ markerId: point.id, commentId: 'comment' });
    core.currentRegionId = 'Valley_4';
    navigateToSharedPoint({ regionKey: 'Valley_4', pointId: point.id });
    await waitFor(() => expect(flyTo).toHaveBeenCalledOnce());
});

it('prepares the initial location and discards a stale asynchronous point preparation', async () => {
    let finish!: (point: IMarkerData) => void;
    vi.spyOn(markers, 'findMarkerById').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    navigateToSharedPoint({ regionKey: 'Valley_4', pointId: 'old' });
    const preparing = prepareInitialNavigation();
    navigateToSharedLocation({ regionKey: 'Valley_4', center: [-500, 300], zoom: 2 });
    await prepareInitialNavigation();
    const expected = { regionId: 'Valley_4', view: { lat: -500, lng: 300, zoom: 2 }, kind: 'location' };
    expect(getInitialNavigationView()).toEqual(expected);
    useLayerStore.getState().setCurrentLayer('M');
    finish({ id: 'old', pos: [-100, 100], subregId: 'VL_1', tier: -1 } as IMarkerData);
    await preparing;
    expect(getInitialNavigationView()).toEqual(expected);
    expect(useLayerStore.getState().currentLayer).toBe('M');
    // Clear the queued navigation without starting a real map.
    const unregister = registerSharedPointMapCore({ currentRegionId: 'Valley_4', map: { stop() {} }, switchRegion: () => Promise.resolve(false) } as unknown as MapCore);
    unregister();
});
