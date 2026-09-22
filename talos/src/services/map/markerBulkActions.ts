import {
    getLoadedRegionMarkers,
    getLoadedSubregionMarkers,
    type IMarkerData,
} from '@/data/marker';
import { commitMarkerSelection, commitPointProgress } from '@/store/history';
import { useMarkerStore } from '@/store/marker';
import { getActivePoints } from '@/store/userRecord';

export type MarkerBulkScope =
    | { kind: 'subregion'; id: string }
    | { kind: 'region'; id: string };

export type MarkerBulkTargets = {
    allIds: string[];
    incompleteIds: string[];
    completedIds: string[];
    selectedIds: string[];
    selectableIds: string[];
};

const getScopeMarkers = (scope: MarkerBulkScope): IMarkerData[] => (
    scope.kind === 'subregion'
        ? getLoadedSubregionMarkers(scope.id)
        : getLoadedRegionMarkers(scope.id)
);

export const resolveMarkerBulkTargets = (
    point: Pick<IMarkerData, 'type'>,
    scope: MarkerBulkScope,
): MarkerBulkTargets => {
    const allIds = getScopeMarkers(scope)
        .filter((marker) => marker.type === point.type)
        .map((marker) => marker.id);
    const completed = new Set(getActivePoints());
    const selected = new Set(useMarkerStore.getState().selectedPoints);
    const incompleteIds = allIds.filter((id) => !completed.has(id));
    const completedIds = allIds.filter((id) => completed.has(id));
    const selectedIds = allIds.filter((id) => selected.has(id));
    const selectableIds = incompleteIds.filter((id) => !selected.has(id));
    return { allIds, incompleteIds, completedIds, selectedIds, selectableIds };
};

export const highlightSameType = (
    point: Pick<IMarkerData, 'type'>,
    scope: MarkerBulkScope,
): number => {
    const markerStore = useMarkerStore.getState();
    if (!markerStore.filter.includes(point.type)) {
        markerStore.setFilter([...markerStore.filter, point.type]);
    }
    const { selectableIds } = resolveMarkerBulkTargets(point, scope);
    return commitMarkerSelection(
        `Highlight ${selectableIds.length} markers of type ${point.type}`,
        { select: selectableIds },
    ) ? selectableIds.length : 0;
};

export const clearSameTypeHighlight = (
    point: Pick<IMarkerData, 'type'>,
    scope: MarkerBulkScope,
): number => {
    const { selectedIds } = resolveMarkerBulkTargets(point, scope);
    return commitMarkerSelection(
        `Clear ${selectedIds.length} highlighted markers of type ${point.type}`,
        { deselect: selectedIds },
    ) ? selectedIds.length : 0;
};

export const setSameTypeCompleted = (
    point: Pick<IMarkerData, 'type'>,
    scope: MarkerBulkScope,
    completed: boolean,
): number => {
    const targets = resolveMarkerBulkTargets(point, scope);
    const ids = completed ? targets.incompleteIds : targets.completedIds;
    if (ids.length === 0) return 0;

    const verb = completed ? 'Collect' : 'Uncollect';
    const changed = commitPointProgress(
        `${verb} ${ids.length} markers of type ${point.type}`,
        completed ? { collect: ids } : { uncollect: ids },
    );
    if (!changed) return 0;
    if (completed) useMarkerStore.getState().setSelectedBatch(ids, false);
    return ids.length;
};
