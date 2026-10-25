import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import {
    getLoadedRegionMarkers,
    getLoadedSubregionMarkers,
    getLoadedWorldMarkers,
    loadAllMarkers,
    REGION_TYPE_COUNT_MAP,
    SUBREGION_TYPE_COUNT_MAP,
    WORLD_TYPE_COUNT_MAP,
} from '@/data/marker';
import { deduplicateMarkersByPositionAndType } from '@/data/marker/deduplication.js';
import { CollectedCountCache } from './collectedCountCache';
import {
    useMarkerStore,
    useMultiRegionMarkerCount,
    useRegionMarkerCount,
    useSubregionMarkerCount,
    useWorldMarkerCount,
} from './marker';
import useRegion from './region';
import { useUserRecordStore } from './userRecord';

beforeAll(async () => {
    await loadAllMarkers();
    useMarkerStore.getState().bumpMarkerDataVersion();
});

describe('marker progress matches rendered points', () => {
    it('matches generated totals in every scope when all raw IDs are collected', () => {
        const cache = new CollectedCountCache();
        const ids = getLoadedWorldMarkers().map((point) => point.id);
        const scopes = [
            { key: 'world', totals: WORLD_TYPE_COUNT_MAP, load: getLoadedWorldMarkers },
            ...Object.entries(REGION_TYPE_COUNT_MAP).map(([region, totals]) => ({
                key: `region:${region}`, totals, load: () => getLoadedRegionMarkers(region),
            })),
            ...Object.entries(SUBREGION_TYPE_COUNT_MAP).map(([subregion, totals]) => ({
                key: `subregion:${subregion}`, totals, load: () => getLoadedSubregionMarkers(subregion),
            })),
        ];
        for (const scope of scopes) {
            expect(Object.fromEntries(cache.get(ids, 1, scope.key, scope.load)), scope.key).toEqual(scope.totals);
        }
    });

    it('updates single, grouped, subregion and world counters when collection changes', async () => {
        const markers = getLoadedRegionMarkers('Wuling');
        const unique = deduplicateMarkersByPositionAndType(markers);
        const visibleIds = new Set(unique.map((point) => point.id));
        const duplicate = markers.find((point) => !visibleIds.has(point.id))!;
        const first = unique.find((point) => point.type === duplicate.type
            && point.x === duplicate.x && point.y === duplicate.y && point.z === duplicate.z)!;
        expect(first).toBeDefined();

        const prevRegion = useRegion.getState().currentRegionKey;
        const prevRecord = useUserRecordStore.getState().activePoints;
        useRegion.setState({ currentRegionKey: 'Wuling' });
        useUserRecordStore.setState({ activePoints: getLoadedWorldMarkers().map((point) => point.id) });
        const { result, unmount } = renderHook(() => ({
            single: useRegionMarkerCount(first.type),
            grouped: useMultiRegionMarkerCount([first.type])[0],
            subregion: useSubregionMarkerCount(first.type, first.subregId),
            world: useWorldMarkerCount(first.type),
        }));
        try {
            await waitFor(() => {
                for (const count of Object.values(result.current)) expect(count.collected).toBe(count.total);
            });
            // Only IDs for rendered markers affect the progress counters.
            act(() => useUserRecordStore.setState({ activePoints: [duplicate.id] }));
            for (const count of Object.values(result.current)) expect(count.collected).toBe(0);
            act(() => useUserRecordStore.setState({ activePoints: [first.id, duplicate.id] }));
            for (const count of Object.values(result.current)) expect(count.collected).toBe(1);
        } finally {
            unmount();
            useRegion.setState({ currentRegionKey: prevRegion });
            useUserRecordStore.setState({ activePoints: prevRecord });
        }
    });
});
