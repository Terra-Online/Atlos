import { act, renderHook } from '@testing-library/react';
import L from 'leaflet';
import { expect, it, vi } from 'vitest';
import { MapCore } from '@/services/map/core/map';
import { useMarkerStore } from '@/store/marker';
import { useUiPrefsStore } from '@/store/uiPrefs';
import { useUserRecordStore } from '@/store/userRecord';
import { useLocatorStore } from '@/store/locator';
import { REGION_DICT } from '@/data/map';
import * as data from '@/data/marker';
import { useMarker } from './useMarker';
import { beginGuideProgress, endGuideProgress, previewGuideProgress } from '@/store/guideProgress';
import { getMarkerState } from '@/services/map/core/canvas/markerModel';

it('publishes region membership on data changes without repeating its already committed filter', async () => {
    const host = document.createElement('div'); document.body.append(host);
    const snapshots = { marker: useMarkerStore.getState(), prefs: useUiPrefsStore.getState(),
        records: useUserRecordStore.getState(), locator: useLocatorStore.getState() };
    useMarkerStore.setState({ filter: ['crate_ii'], points: [], selectedPoints: [], temporarySelectedPoints: [], visibleSubregionKey: null });
    useUiPrefsStore.setState({ prefsAutoClusterEnabled: false, prefsHideCompletedMarkers: false });
    useUserRecordStore.setState({ activePoints: [] });
    useLocatorStore.setState({ viewMode: 'off', lastPosition: null });
    const core = new MapCore(host);
    core.map.setView([0, 0], 2);
    const point: data.IMarkerData = { id: 'region-membership', type: 'crate_ii',
        subregId: REGION_DICT.Valley_4.subregions[0], pos: [0, 0], x: 0, y: 0, z: 0, tier: 0 };
    const load = vi.spyOn(data, 'loadRegionMarkers').mockResolvedValue([point]);
    const previewLoad = vi.spyOn(data, 'loadAllMarkers').mockResolvedValue([point]);
    const filter = vi.spyOn(core.markerLayer, 'filterMarker');
    const hook = renderHook(() => useMarker(core, 'Valley_4', true));
    const owner = beginGuideProgress();
    try {
        await act(() => core.markerLayer.changeRegion('Valley_4'));
        expect(useMarkerStore.getState().points).toEqual([point.id]);
        const layer = core.markerLayer.markerDict[point.id];
        if (!(layer instanceof L.Marker)) throw new Error('Expected the real point marker');
        await act(() => previewGuideProgress(point.type, true));
        expect(getMarkerState(layer)).toMatchObject({ checked: true, completed: true });
        expect(useUserRecordStore.getState().activePoints).toEqual([]);
        act(() => endGuideProgress(owner));
        expect(getMarkerState(layer)).toMatchObject({ checked: false, completed: false });
        const committed = filter.mock.calls.length;
        act(() => useMarkerStore.getState().bumpMarkerDataVersion());
        expect(filter).toHaveBeenCalledTimes(committed);
        expect(useMarkerStore.getState().points).toEqual([point.id]);
        act(() => useMarkerStore.getState().setFilter([]));
        expect(filter).toHaveBeenCalledTimes(committed + 1);
        expect(useMarkerStore.getState().points).toEqual([point.id]);
    } finally {
        endGuideProgress(owner); hook.unmount(); core.destroy(); host.remove(); load.mockRestore(); previewLoad.mockRestore(); filter.mockRestore();
        useMarkerStore.setState(snapshots.marker); useUiPrefsStore.setState(snapshots.prefs);
        useUserRecordStore.setState(snapshots.records); useLocatorStore.setState(snapshots.locator);
    }
});
