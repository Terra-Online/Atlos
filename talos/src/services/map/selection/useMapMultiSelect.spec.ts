import L from 'leaflet';
import { expect, it, vi } from 'vitest';
import { registerLassoHandler } from './useMapMultiSelect';
import { getMarkerState, setMarkerState } from '@/services/map/core/canvas/markerModel';
import { useMarkerStore } from '@/store/marker';
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
