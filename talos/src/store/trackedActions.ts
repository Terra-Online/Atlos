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
