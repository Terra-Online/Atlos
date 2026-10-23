import L from 'leaflet';
import { waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { IMarkerData } from '@/data/marker';
import type { MapCore } from '@/component/mapCore/map';
import { useLayerStore } from '@/store/layer';
import { navigateToSharedPoint, registerSharedPointMapCore } from './navigation';

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((fn) => fn()));

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
