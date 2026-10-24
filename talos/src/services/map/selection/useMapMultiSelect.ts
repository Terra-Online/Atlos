/**
 * useMapMultiSelect — Cmd/Ctrl + drag to lasso-select markers on the map.
 *
 * Gesture layer only — fires lightweight Leaflet events:
 *   talos:lassoHighlight  – on every pointer-move with current bounds
 *   talos:lassoSelect     – on pointer-up with final bounds + collected ids
 *   talos:lassoClear      – on cancel (mod key released mid-drag)
 *
 * The marker-side logic (filtering and scene state) lives in
 * `registerLassoHandler`, which is called once from MarkerLayer.
 *
 * Shift + Mod + Drag enters *deselect* mode (removes markers from selection).
 */

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { useMarkerStore } from '@/store/marker';
import { commitPointProgress } from '@/store/history';
import { isModKeyPressed } from '@/platform/shortcuts';
import type { IMarkerData } from '@/data/marker';
import { getActivePoints } from '@/store/userRecord';
import { useUiPrefsStore } from '@/store/uiPrefs';
import lassoStyles from '@/services/map/selection/lasso.module.scss';
import { setMarkerState } from '@/services/map/core/canvas/markerModel';

// ─── Lasso-selected ID tracking ──────────────────────────────
// Module-level set that records which marker IDs were added to
// selectedPoints via lasso (not via manual click). Only these
// markers participate in batch-check when one of them is clicked.
const _lassoSelectedIds = new Set<string>();

/** Returns true if the given marker was selected via lasso multi-select. */
export function isLassoSelected(id: string): boolean {
    return _lassoSelectedIds.has(id);
}

// ─── Lasso context for marker-side handler ───────────────────

export interface LassoContext {
    markerDataDict: Record<string, IMarkerData>;
    markerDict: Record<string, L.Layer>;
    getActiveFilterKeys: () => string[];
    getMarkerVersion?: () => number;
    isSubregionVisible: (subregionId: string) => boolean;
}

// ─── Marker-side handler (call once from MarkerLayer) ────────

/**
 * Registers map-level event listeners that resolve which markers fall inside
 * a lasso rectangle and update their scene state in real time.
 */
export function registerLassoHandler(map: L.Map, ctx: LassoContext) {
    let dataVersion = -1;
    let records: [string, IMarkerData][] = [];
    /** Set of marker IDs currently highlighted by the lasso */
    let currentHighlighted = new Set<string>();

    /** Pre-existing state captured at lasso start */
    let preExistingSelected = new Set<string>();
    let preExistingChecked = new Set<string>();
    let lassoActive = false;

    const setVisualSelected = (id: string, selected: boolean) => {
        const marker = ctx.markerDict[id];
        if (marker instanceof L.Marker) setMarkerState(marker, { selected });
    };
    const resetToNormal = (id: string) => {
        const marker = ctx.markerDict[id];
        if (marker instanceof L.Marker) setMarkerState(marker, {
            selected: false, checked: false, appearing: false, disappearing: false,
        });
    };
    const restore = (id: string, selected: ReadonlySet<string>, checked: ReadonlySet<string>) => {
        const marker = ctx.markerDict[id];
        if (marker instanceof L.Marker) setMarkerState(marker, {
            selected: selected.has(id), checked: checked.has(id),
        });
    };

    /** Determine visible markers in bounds, respecting filter + subregion + hidden state */
    const getMarkersInBounds = (bounds: L.LatLngBounds): string[] => {
        const activeKeys = new Set(ctx.getActiveFilterKeys());
        const shouldHideCompleted = useUiPrefsStore.getState().prefsHideCompletedMarkers;
        const completedIds = shouldHideCompleted ? new Set(getActivePoints()) : new Set<string>();
        const result: string[] = [];
        const version = ctx.getMarkerVersion?.();
        if (version === undefined || version !== dataVersion) { records = Object.entries(ctx.markerDataDict); dataVersion = version ?? -1; }
        const south = bounds.getSouth(), north = bounds.getNorth(), west = bounds.getWest(), east = bounds.getEast();
        const visibleRegions = new Map<string, boolean>();
        for (const [id, data] of records) {
            if (!activeKeys.has(data.type)) continue;
            let visible = visibleRegions.get(data.subregId);
            if (visible === undefined) { visible = ctx.isSubregionVisible(data.subregId); visibleRegions.set(data.subregId, visible); }
            if (!visible) continue;
            if (completedIds.has(id)) continue;
            if (data.pos[0] >= south && data.pos[0] <= north && data.pos[1] >= west && data.pos[1] <= east) result.push(id);
        }
        return result;
    };

    /** Capture pre-existing state on first highlight of a lasso gesture */
    const ensureLassoStarted = () => {
        if (lassoActive) return;
        preExistingSelected = new Set(useMarkerStore.getState().selectedPoints);
        preExistingChecked = new Set(getActivePoints());
        lassoActive = true;
    };

    // ── Event handlers (named so they can be removed on teardown) ──

    // ── talos:lassoHighlight — live visual feedback during drag ──
    const onLassoHighlight = (evt: unknown) => {
        const { bounds, deselect } = evt as { bounds: L.LatLngBounds; deselect: boolean };
        ensureLassoStarted();

        const idsInBounds = getMarkersInBounds(bounds);
        const newHighlighted = new Set(idsInBounds);

        if (deselect) {
            // Deselect mode: preview the normal appearance on markers entering the lasso
            for (const id of newHighlighted) {
                if (!currentHighlighted.has(id)) {
                    resetToNormal(id);
                }
            }
            // Restore markers leaving the lasso to their store-truth state
            for (const id of currentHighlighted) {
                if (!newHighlighted.has(id)) {
                    restore(id, preExistingSelected, preExistingChecked);
                }
            }
        } else {
            // Select mode: highlight only markers in normal state
            for (const id of newHighlighted) {
                if (!currentHighlighted.has(id)) {
                    // Only affect markers that were neither selected nor checked before lasso
                    if (!preExistingSelected.has(id) && !preExistingChecked.has(id)) {
                        setVisualSelected(id, true);
                    }
                }
            }
            // Remove highlights from markers leaving the lasso (only if we added them)
            for (const id of currentHighlighted) {
                if (!newHighlighted.has(id)) {
                    // Only remove if the marker was NOT already selected before lasso
                    if (!preExistingSelected.has(id)) {
                        setVisualSelected(id, false);
                    }
                }
            }
        }

        currentHighlighted = newHighlighted;
    };

    // ── talos:lassoSelect — final selection on pointer-up ──
    const onLassoSelect = (evt: unknown) => {
        const { bounds, collected, deselect } = evt as {
            bounds: L.LatLngBounds;
            collected: string[];
            deselect: boolean;
        };
        const ids = getMarkersInBounds(bounds);
        collected.push(...ids);
        // Clear tracking (visual state is now managed by the hook's store update)
        currentHighlighted = new Set();
        lassoActive = false;
        // The `deselect` flag is forwarded so the hook knows the mode
        (evt as Record<string, unknown>).deselect = deselect;
    };

    // ── talos:lassoClear — cancel / abort ──
    const onLassoClear = () => {
        // Revert all highlighted markers to their store-truth state
        const selectedSet = new Set(useMarkerStore.getState().selectedPoints);
        const checkedSet = new Set(getActivePoints());
        for (const id of currentHighlighted) restore(id, selectedSet, checkedSet);
        currentHighlighted = new Set();
        lassoActive = false;
    };

    map.on('talos:lassoHighlight' as string, onLassoHighlight);
    map.on('talos:lassoSelect' as string, onLassoSelect);
    map.on('talos:lassoClear' as string, onLassoClear);

    /** Call this to remove all listeners (e.g. when MarkerLayer is destroyed). */
    return () => {
        map.off('talos:lassoHighlight' as string, onLassoHighlight);
        map.off('talos:lassoSelect' as string, onLassoSelect);
        map.off('talos:lassoClear' as string, onLassoClear);
    };
}

// ─── Hook ────────────────────────────────────────────────────

export function useMapMultiSelect(map: L.Map | undefined) {
    const overlayRef = useRef<HTMLDivElement | null>(null);
    const startPx = useRef<{ x: number; y: number } | null>(null);
    const startLatLng = useRef<L.LatLng | null>(null);
    const dragging = useRef(false);
    /** Whether the current drag is in deselect mode (shift held) */
    const deselectMode = useRef(false);
    /** Timer for fadeout cleanup */
    const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        if (!map) return;

        const container = map.getContainer();
        const keyupWindows = new Set<Window>();

        // Create persistent overlay element
        const overlay = container.ownerDocument.createElement('div');
        overlay.className = lassoStyles.lassoOverlay;
        overlay.style.display = 'none';
        container.appendChild(overlay);
        overlayRef.current = overlay;

        /** Show the overlay with the appropriate mode class */
        const showOverlay = (deselect: boolean) => {
            // Cancel any pending fadeout
            if (fadeTimerRef.current) {
                clearTimeout(fadeTimerRef.current);
                fadeTimerRef.current = null;
            }
            overlay.style.display = '';
            overlay.classList.remove(lassoStyles.fadeOut);
            overlay.classList.toggle(lassoStyles.selectMode, !deselect);
            overlay.classList.toggle(lassoStyles.deselectMode, deselect);
        };

        /** Trigger fadeout animation then hide */
        const fadeOutOverlay = () => {
            overlay.classList.add(lassoStyles.fadeOut);
            fadeTimerRef.current = setTimeout(() => {
                overlay.style.display = 'none';
                overlay.classList.remove(
                    lassoStyles.fadeOut,
                    lassoStyles.selectMode,
                    lassoStyles.deselectMode,
                );
                fadeTimerRef.current = null;
            }, 250); // match CSS transition duration
        };

        /** Update overlay position from pixel coords */
        const updateOverlayRect = (x1: number, y1: number, x2: number, y2: number) => {
            overlay.style.left = `${Math.min(x1, x2)}px`;
            overlay.style.top = `${Math.min(y1, y2)}px`;
            overlay.style.width = `${Math.abs(x2 - x1)}px`;
            overlay.style.height = `${Math.abs(y2 - y1)}px`;
        };

        // ── pointer down ──
        const onPointerDown = (e: PointerEvent) => {
            if (!isModKeyPressed(e)) return;
            bindKeyupWindow(container.ownerDocument.defaultView ?? window);
            // Disable map dragging & box zoom while lasso is active
            map.dragging.disable();
            if (map.boxZoom) map.boxZoom.disable();

            const rect = container.getBoundingClientRect();
            const px = e.clientX - rect.left;
            const py = e.clientY - rect.top;

            startPx.current = { x: px, y: py };
            startLatLng.current = map.containerPointToLatLng(L.point(px, py));
            dragging.current = true;
            deselectMode.current = e.shiftKey;

            showOverlay(e.shiftKey);
            updateOverlayRect(px, py, px, py);

            container.style.cursor = 'crosshair';
        };

        // ── pointer move ──
        const onPointerMove = (e: PointerEvent) => {
            if (!dragging.current || !startPx.current || !startLatLng.current) return;

            const rect = container.getBoundingClientRect();
            const curX = e.clientX - rect.left;
            const curY = e.clientY - rect.top;

            // Update CSS overlay
            updateOverlayRect(startPx.current.x, startPx.current.y, curX, curY);

            // Compute geographic bounds for marker hit-testing
            const currentLatLng = map.containerPointToLatLng(L.point(curX, curY));
            const bounds = L.latLngBounds(startLatLng.current, currentLatLng);

            // Fire live highlight event so markers get visual feedback
            map.fire('talos:lassoHighlight', { bounds, deselect: deselectMode.current });
        };

        // ── pointer up ──
        const onPointerUp = (e: PointerEvent) => {
            if (!dragging.current || !startPx.current || !startLatLng.current) return;
            dragging.current = false;
            unbindKeyupWindows();
            container.style.cursor = '';
            map.dragging.enable();
            if (map.boxZoom) map.boxZoom.enable();

            const rect = container.getBoundingClientRect();
            const endX = e.clientX - rect.left;
            const endY = e.clientY - rect.top;

            const endLatLng = map.containerPointToLatLng(L.point(endX, endY));
            const bounds = L.latLngBounds(startLatLng.current, endLatLng);

            // Fadeout overlay
            fadeOutOverlay();
            startPx.current = null;
            startLatLng.current = null;

            // Ignore tiny drags (likely accidental)
            const size = map.latLngToContainerPoint(bounds.getNorthEast())
                .subtract(map.latLngToContainerPoint(bounds.getSouthWest()));
            if (Math.abs(size.x) < 10 && Math.abs(size.y) < 10) {
                map.fire('talos:lassoClear');
                return;
            }

            // Query marker layer for ids in bounds
            const collected: string[] = [];
            const isDeselect = deselectMode.current;
            map.fire('talos:lassoSelect', { bounds, collected, deselect: isDeselect });

            if (collected.length === 0) return;

            const markerState = useMarkerStore.getState();

            if (isDeselect) {
                // ── Deselect mode — reset ALL state back to normal ──
                const prevSelected = new Set(markerState.selectedPoints);
                const toRemoveSelected = collected.filter((id) => prevSelected.has(id));

                const activePoints = new Set(getActivePoints());
                const toRemoveChecked = collected.filter((id) =>
                    activePoints.has(id),
                );

                if (toRemoveSelected.length === 0 && toRemoveChecked.length === 0) return;

                markerState.setSelectedBatch(toRemoveSelected, false);
                toRemoveSelected.forEach((id) => _lassoSelectedIds.delete(id));
                commitPointProgress(`Uncollect ${toRemoveChecked.length} markers`, {
                    uncollect: toRemoveChecked,
                });
            } else {
                // ── Select mode — only add normal-state markers ──
                const prevSelected = new Set(markerState.selectedPoints);
                const checkedIds = new Set(getActivePoints());
                // Only select markers that were in normal state (not already selected or checked)
                const normalIds = collected.filter(
                    (id) => !prevSelected.has(id) && !checkedIds.has(id),
                );

                markerState.setSelectedBatch(normalIds, true);
                normalIds.forEach((id) => _lassoSelectedIds.add(id));

            }
        };

        // ── Cancel on key up ──
        const onKeyUp = (e: KeyboardEvent) => {
            if (dragging.current && !isModKeyPressed(e)) {
                dragging.current = false;
                unbindKeyupWindows();
                container.style.cursor = '';
                map.dragging.enable();
                if (map.boxZoom) map.boxZoom.enable();
                fadeOutOverlay();
                startPx.current = null;
                startLatLng.current = null;
                map.fire('talos:lassoClear');
            }
        };

        const bindKeyupWindow = (targetWindow: Window) => {
            if (keyupWindows.has(targetWindow)) return;
            targetWindow.addEventListener('keyup', onKeyUp);
            keyupWindows.add(targetWindow);
        };

        const unbindKeyupWindows = () => {
            keyupWindows.forEach((targetWindow) => {
                targetWindow.removeEventListener('keyup', onKeyUp);
            });
            keyupWindows.clear();
        };

        container.addEventListener('pointerdown', onPointerDown);
        container.addEventListener('pointermove', onPointerMove);
        container.addEventListener('pointerup', onPointerUp);

        return () => {
            container.removeEventListener('pointerdown', onPointerDown);
            container.removeEventListener('pointermove', onPointerMove);
            container.removeEventListener('pointerup', onPointerUp);
            unbindKeyupWindows();
            if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            overlayRef.current = null;
        };
    }, [map]);
}

/**
 * Batch-check handler: when any of the lasso-selected markers is clicked,
 * mark ALL of them as checked (activePoints) in one undoable step.
 *
 * This should be called from the marker click handler when the clicked
 * marker is in the current lasso selection.
 */
export function batchCheckSelectedPoints(selectedIds: string[]) {
    // Only batch-check markers that were selected via lasso, not manual clicks
    const lassoIds = selectedIds.filter((id) => _lassoSelectedIds.has(id));
    if (lassoIds.length === 0) return false;

    const markerStore = useMarkerStore.getState();
    const activePoints = new Set(getActivePoints());

    // Find ids that are lasso-selected but not yet checked
    const unchecked = lassoIds.filter(
        (id) => !activePoints.has(id),
    );

    if (unchecked.length === 0) return false;

    if (!commitPointProgress(`Collect ${unchecked.length} markers`, { collect: unchecked })) {
        return false;
    }

    markerStore.setSelectedBatch(unchecked, false);

    // Clear lasso tracking — they are now checked, batch-select lifecycle ends
    lassoIds.forEach((id) => _lassoSelectedIds.delete(id));

    return true;
}
