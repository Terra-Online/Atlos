import { beforeEach, expect, it, vi } from 'vitest';
import { waitFor } from '@testing-library/react';
import type { IMarkerData } from '@/data/marker';
import type { MapCore } from '@/component/mapCore/map';

vi.mock('@/data/marker', () => ({
    findMarkerById: vi.fn(() => Promise.resolve({ id: '1', type: 'test', subregId: 'sub', pos: [1, 2] })),
}));
vi.mock('@/data/map', () => ({ REGION_DICT: { Valley_4: { subregions: ['sub'] } } }));
vi.mock('@/store/userRecord', () => ({ useUserRecord: vi.fn() }));
vi.mock('@/store/region', () => ({ default: { getState: () => ({ currentRegionKey: 'Valley_4', setCurrentRegion: vi.fn(), setCurrentSubregion: vi.fn() }) } }));
import { useMarkerStore } from '@/store/marker';
import { navigateToMarkerId, registerSharedPointMapCore } from './navigation';

const point = { id: '1', type: 'test', subregId: 'sub', pos: [1, 2] } as IMarkerData;
beforeEach(() => {
    useMarkerStore.getState().setCurrentActivePoint(point);
});

it('navigates to a comment through the public marker navigation API', async () => {
    let moved: () => void = () => {};
    registerSharedPointMapCore({
        switchRegion: () => Promise.resolve(),
        markerLayer: {
            markerDataDict: { '1': point }, filterMarker: vi.fn(), ensureMarkerVisible: () => Promise.resolve(), startMarkerPulse: () => true,
        },
        map: { getMaxZoom: () => 5, once: (_: string, callback: () => void) => { moved = callback; }, off: vi.fn(), flyTo: () => moved() },
    } as unknown as MapCore);
    expect(await navigateToMarkerId('1', { content: { kind: 'comment', id: 'reply' } })).toBe(true);
    await waitFor(() => expect(useMarkerStore.getState().commentOpenRequest).toEqual({ markerId: '1', commentId: 'reply' }));
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
