/**
 * History-aware wrappers for marker filter operations.
 *
 * These functions call the underlying store actions AND push
 * corresponding undo/redo entries to the history store.
 */

import { useMarkerStore } from '@/store/marker';
import { useHistoryStore } from '@/store/history';

/**
 * Toggle a single filter key with undo tracking.
 */
export function trackedSwitchFilter(typeKey: string) {
    const store = useMarkerStore.getState();
    const wasActive = store.filter.includes(typeKey);

    store.switchFilter(typeKey);

    useHistoryStore.getState().push({
        label: wasActive ? `Deselect filter ${typeKey}` : `Select filter ${typeKey}`,
        undo: () => useMarkerStore.getState().switchFilter(typeKey),
        redo: () => useMarkerStore.getState().switchFilter(typeKey),
    });
}

/**
 * Batch-toggle filter keys with undo tracking (counts as one step).
 */
export function trackedBatchToggleFilter(typeKeys: string[]) {
    const store = useMarkerStore.getState();
    store.batchToggleFilter(typeKeys);

    useHistoryStore.getState().push({
        label: `Batch toggle ${typeKeys.length} filters`,
        undo: () => useMarkerStore.getState().batchToggleFilter(typeKeys),
        redo: () => useMarkerStore.getState().batchToggleFilter(typeKeys),
    });
}

/**
 * Explicitly select or deselect a set of filter keys as one undo step.
 * active=true  → ensure all keys are in the filter
 * active=false → remove all keys from the filter
 */
export function trackedSetFilterKeys(typeKeys: string[], active: boolean) {
    const prevFilter = [...useMarkerStore.getState().filter];
    useMarkerStore.getState().setFilterKeys(typeKeys, active);
    const nextFilter = [...useMarkerStore.getState().filter];

    useHistoryStore.getState().push({
        label: active ? `Select ${typeKeys.length} filters` : `Deselect ${typeKeys.length} filters`,
        undo: () => useMarkerStore.getState().setFilter(prevFilter),
        redo: () => useMarkerStore.getState().setFilter(nextFilter),
    });
}
