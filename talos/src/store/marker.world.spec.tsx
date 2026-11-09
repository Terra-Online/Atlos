import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import * as markers from '@/data/marker';
import lookup from '@/data/marker/lookup.json';
import { useUserRecordStore } from './userRecord';
import { useWorldMarkerCount } from './marker';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('does not load the world count index for an empty progress record', () => {
    useUserRecordStore.setState({ activePoints: [] });
    const load = vi.spyOn(markers, 'getWorldMarkerTypes');
    const type = Object.keys(lookup.representatives)[0];
    const { result } = renderHook(() => useWorldMarkerCount(type));
    expect(result.current).toEqual({ total: markers.WORLD_TYPE_COUNT_MAP[type], collected: 0 });
    expect(load).not.toHaveBeenCalled();
    expect(Object.keys(markers.SUBREGION_MARKS_MAP)).toEqual([]);
});

it('counts complete and changing progress from compact representatives without fetching any point shard', async () => {
    const [type, ids] = Object.entries(lookup.representatives)[0];
    useUserRecordStore.setState({ activePoints: Object.keys(lookup.points) });
    const { result } = renderHook(() => useWorldMarkerCount(type));
    await waitFor(() => expect(result.current.collected).toBe(result.current.total));
    expect(Object.keys(markers.SUBREGION_MARKS_MAP)).toEqual([]);
    act(() => useUserRecordStore.setState({ activePoints: [ids[0], ids[0], 'missing'] }));
    expect(result.current.collected).toBe(1);
    act(() => useUserRecordStore.setState({ activePoints: [] }));
    expect(result.current.collected).toBe(0);
});
