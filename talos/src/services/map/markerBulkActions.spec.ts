import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IMarkerData } from '@/data/marker';

const markers = [
    { id: 'a', type: 'type-a', subregId: 'sub-a' },
    { id: 'b', type: 'type-a', subregId: 'sub-a' },
    { id: 'c', type: 'type-a', subregId: 'sub-a' },
    { id: 'other-type', type: 'type-b', subregId: 'sub-a' },
    { id: 'other-subregion', type: 'type-a', subregId: 'sub-b' },
] as IMarkerData[];

vi.mock('@/data/marker', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/data/marker')>(),
    getLoadedSubregionMarkers: (id: string) => markers.filter((marker) => marker.subregId === id),
    getLoadedRegionMarkers: () => markers,
}));

import { useHistoryStore } from '@/store/history';
import { useMarkerStore } from '@/store/marker';
import { useUserRecordStore } from '@/store/userRecord';
import {
    clearSameTypeHighlight,
    highlightSameType,
    resolveMarkerBulkTargets,
    setSameTypeCompleted,
} from './markerBulkActions';

const point = markers[0];
const scope = { kind: 'subregion' as const, id: 'sub-a' };

describe('marker bulk actions', () => {
    beforeEach(() => {
        useMarkerStore.setState({ filter: ['type-b'], selectedPoints: ['a', 'unrelated'] });
        useUserRecordStore.setState({ activePoints: ['b'], updatedAt: 0 });
        useHistoryStore.setState({ past: [], future: [] });
    });

    it('resolves one type inside one subregion', () => {
        expect(resolveMarkerBulkTargets(point, scope)).toEqual({
            allIds: ['a', 'b', 'c'],
            incompleteIds: ['a', 'c'],
            completedIds: ['b'],
            selectedIds: ['a'],
            selectableIds: ['c'],
        });
    });

    it('adds and clears highlights without disturbing unrelated selections', () => {
        expect(highlightSameType(point, scope)).toBe(1);
        expect(useMarkerStore.getState().filter).toEqual(['type-b', 'type-a']);
        expect(useMarkerStore.getState().selectedPoints).toEqual(['a', 'unrelated', 'c']);
        expect(clearSameTypeHighlight(point, scope)).toBe(2);
        expect(useMarkerStore.getState().selectedPoints).toEqual(['unrelated']);
    });

    it('commits each progress change as one undoable transaction', () => {
        expect(setSameTypeCompleted(point, scope, true)).toBe(2);
        expect(useUserRecordStore.getState().activePoints).toEqual(['b', 'a', 'c']);
        expect(useMarkerStore.getState().selectedPoints).toEqual(['unrelated']);
        expect(useHistoryStore.getState().past).toHaveLength(1);

        useHistoryStore.getState().undo();
        expect(useUserRecordStore.getState().activePoints).toEqual(['b']);
        expect(setSameTypeCompleted(point, scope, false)).toBe(1);
        expect(useUserRecordStore.getState().activePoints).toEqual([]);
    });
});
