import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import L from 'leaflet';
import type { IMarkerData } from '@/data/marker';
import type { MapCore } from '@/services/map/core/map';

vi.mock('@/data/marker', () => ({
    findMarkerById: vi.fn(() => Promise.resolve({ id: '1', type: 'test', subregId: 'sub', pos: [1, 2] })),
}));
vi.mock('@/data/map', () => ({ REGION_DICT: { Valley_4: { subregions: ['sub'] } } }));
vi.mock('@/store/region', () => ({
    default: { getState: () => ({
        currentRegionKey: 'Valley_4',
        setCurrentRegion: vi.fn(),
        setCurrentSubregion: vi.fn(),
    }) },
}));

import { useMarkerStore } from '@/store/marker';
import { navigateToMarkerId, navigateToSharedLocation, registerSharedPointMapCore } from './navigation';

let map: L.Map;
let unregister: (() => void) | undefined;

const point = { id: '1', type: 'test', subregId: 'sub', pos: [1, 2] } as IMarkerData;

beforeEach(() => {
    const host = document.createElement('div');
    document.body.append(host);
    map = L.map(host, { crs: L.CRS.Simple, minZoom: 0, maxZoom: 5 }).setView([0, 0], 1);
    useMarkerStore.getState().setCurrentActivePoint(point);
});

afterEach(() => { unregister?.(); const host = map.getContainer(); map.remove(); host.remove(); });

it('navigates to a comment through the public marker navigation API', async () => {
    vi.spyOn(map, 'flyTo').mockImplementation(() => { map.fire('moveend'); return map; });
    unregister = registerSharedPointMapCore({
        switchRegion: () => Promise.resolve(true),
        switchLayer: () => Promise.resolve(),
        markerLayer: {
            markerDataDict: { '1': point },
            filterMarker: vi.fn(),
            ensureMarkerVisible: () => Promise.resolve(),
            startMarkerPulse: () => true,
        },
        map,
    } as unknown as MapCore);

    expect(await navigateToMarkerId('1', {
        content: { kind: 'comment', id: 'reply' },
    })).toBe(true);
    await waitFor(() => expect(useMarkerStore.getState().commentOpenRequest).toEqual({
        markerId: '1',
        commentId: 'reply',
    }));
});

it('emits distinct requests for repeated targets and clears them on marker selection', () => {
    const store = useMarkerStore.getState();
    store.openMarkerComment('1', 'reply');
    const first = useMarkerStore.getState().commentOpenRequest;
    store.openMarkerComment('1', 'reply');
    expect(useMarkerStore.getState().commentOpenRequest).not.toBe(first);
    store.setCurrentActivePoint({ ...point, id: '2' });
    expect(useMarkerStore.getState().commentOpenRequest).toBeNull();
});

it('keeps image and comment requests mutually exclusive', () => {
    const store = useMarkerStore.getState();
    store.openMarkerImage('1', 'image');
    store.openMarkerComment('1', 'reply');
    expect(useMarkerStore.getState().imageOpenRequest).toBeNull();
    store.openMarkerImage('1', 'image');
    expect(useMarkerStore.getState().commentOpenRequest).toBeNull();
});

it('waits for the region and centers a valid shared location with clamped zoom', async () => {
    const flyTo = vi.spyOn(map, 'flyTo').mockImplementation(() => map);
    map.setMaxZoom(3);
    map.setMaxBounds([[-100, -100], [100, 100]]);
    unregister = registerSharedPointMapCore({
        switchRegion: () => Promise.resolve(true),
        markerLayer: {},
        map,
    } as unknown as MapCore);

    navigateToSharedLocation({
        regionKey: 'Valley_4',
        center: [10, 20],
        zoom: 9,
    });

    await waitFor(() => expect(flyTo).toHaveBeenCalledWith(
        L.latLng(10, 20),
        3,
        { animate: true, duration: 0.9 },
    ));
});
