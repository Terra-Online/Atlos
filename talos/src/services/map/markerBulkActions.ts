import {
    getLoadedRegionMarkers,
    getLoadedSubregionMarkers,
    type IMarkerData,
} from '@/data/marker';
import { commitMarkerSelection, commitPointProgress } from '@/store/history';
import { useMarkerStore } from '@/store/marker';
import { getActivePoints } from '@/store/userRecord';
import { MARKER_TYPE_DICT } from '@/data/marker';

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

export type MarkerBulkOptions = {
    treatArchivesAsSameType?: boolean;
};

const isArchiveType = (typeKey: string): boolean => MARKER_TYPE_DICT[typeKey]?.category?.main === 'files';

const matchesBulkType = (
    markerType: string,
    targetType: string,
    options?: MarkerBulkOptions,
): boolean => (
    markerType === targetType
    || Boolean(options?.treatArchivesAsSameType && isArchiveType(targetType) && isArchiveType(markerType))
);

const getScopeMarkers = (scope: MarkerBulkScope): IMarkerData[] => (
    scope.kind === 'subregion'
        ? getLoadedSubregionMarkers(scope.id)
        : getLoadedRegionMarkers(scope.id)
);

export const resolveMarkerBulkTargets = (
    point: Pick<IMarkerData, 'type'>,
    scope: MarkerBulkScope,
    options?: MarkerBulkOptions,
): MarkerBulkTargets => {
    const allIds = getScopeMarkers(scope)
        .filter((marker) => matchesBulkType(marker.type, point.type, options))
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
    options?: MarkerBulkOptions,
): number => {
    const markerStore = useMarkerStore.getState();
    const scopeMarkers = getScopeMarkers(scope);
    const filterTypes = options?.treatArchivesAsSameType && isArchiveType(point.type)
        ? [...new Set(scopeMarkers.filter((marker) => isArchiveType(marker.type)).map((marker) => marker.type))]
        : [point.type];
    const missingFilterTypes = filterTypes.filter((typeKey) => !markerStore.filter.includes(typeKey));
    if (missingFilterTypes.length > 0) {
        markerStore.setFilter([...markerStore.filter, ...missingFilterTypes]);
    }
    const { selectableIds } = resolveMarkerBulkTargets(point, scope, options);
    return commitMarkerSelection(
        `Highlight ${selectableIds.length} markers of type ${point.type}`,
        { select: selectableIds },
    ) ? selectableIds.length : 0;
};

export const clearSameTypeHighlight = (
    point: Pick<IMarkerData, 'type'>,
    scope: MarkerBulkScope,
    options?: MarkerBulkOptions,
): number => {
    const { selectedIds } = resolveMarkerBulkTargets(point, scope, options);
    return commitMarkerSelection(
        `Clear ${selectedIds.length} highlighted markers of type ${point.type}`,
        { deselect: selectedIds },
    ) ? selectedIds.length : 0;
};

export const setSameTypeCompleted = (
    point: Pick<IMarkerData, 'type'>,
    scope: MarkerBulkScope,
    completed: boolean,
    options?: MarkerBulkOptions,
): number => {
    const targets = resolveMarkerBulkTargets(point, scope, options);
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
