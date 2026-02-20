/**
 * useMapMultiSelect — Cmd/Ctrl + drag to lasso-select markers on the map.
 *
 * Gesture layer only — fires lightweight Leaflet events:
 *   talos:lassoHighlight  – on every pointer-move with current bounds
 *   talos:lassoSelect     – on pointer-up with final bounds + collected ids
 *   talos:lassoClear      – on cancel (mod key released mid-drag)
 *
 * The marker-side logic (filtering, visual CSS classes) lives in
 * `registerLassoHandler`, which is called once from MarkerLayer.
 *
 * Shift + Mod + Drag enters *deselect* mode (removes markers from selection).
 */

import { useEffect, useRef } from 'react';
import L from 'leaflet';
import { useMarkerStore } from '@/store/marker';
import { useUserRecordStore } from '@/store/userRecord';
import { useHistoryStore } from '@/store/history';
import { isModKeyPressed } from './shortcuts';
import type { IMarkerData } from '@/data/marker';
import { getActivePoints } from '@/store/userRecord';
import { useUiPrefsStore } from '@/store/uiPrefs';
import lassoStyles from './lasso.module.scss';

// ─── Lasso context for marker-side handler ───────────────────

export interface LassoContext {
    markerDataDict: Record<string, IMarkerData>;
    markerDict: Record<string, L.Layer>;
    /** CSS selector to find the inner wrapper element (e.g. `.markerInner, .noFrameInner`) */
    innerSelector: string;
    /** Hashed CSS class name for the `selected` state (toggled on/off) */
    selectedClassName: string;
    /** All state CSS class names that should be cleared when resetting to normal */
    stateClassNames: string[];
    getActiveFilterKeys: () => string[];
    isSubregionVisible: (subregionId: string) => boolean;
}

// ─── Marker-side handler (call once from MarkerLayer) ────────

/**
 * Registers map-level event listeners that resolve which markers fall inside
 * a lasso rectangle and apply / remove the `.selected` CSS class in real time.
 */
export function registerLassoHandler(map: L.Map, ctx: LassoContext) {
    /** Set of marker IDs currently highlighted by the lasso */
    let currentHighlighted = new Set<string>();

    /** Pre-existing state captured at lasso start */
    let preExistingSelected = new Set<string>();
    let preExistingChecked = new Set<string>();
    let lassoActive = false;

    /** Helper: toggle the selected CSS class on a marker's DOM element */
    const setVisualSelected = (id: string, selected: boolean) => {
        const layer = ctx.markerDict[id];
        if (!layer) return;
        const el = (layer as L.Marker).getElement?.() as HTMLElement | null;
        if (!el) return;
        const inner = el.querySelector(ctx.innerSelector);
        if (inner) inner.classList.toggle(ctx.selectedClassName, selected);
    };

    /** Helper: strip ALL state classes from a marker, returning it to normal appearance */
    const resetToNormal = (id: string) => {
        const layer = ctx.markerDict[id];
        if (!layer) return;
        const el = (layer as L.Marker).getElement?.() as HTMLElement | null;
        if (!el) return;
        const inner = el.querySelector(ctx.innerSelector);
        if (inner) {
            ctx.stateClassNames.forEach((cls) => inner.classList.remove(cls));
        }
    };

    /** Determine visible markers in bounds, respecting filter + subregion + hidden state */
    const getMarkersInBounds = (bounds: L.LatLngBounds): string[] => {
        const activeKeys = new Set(ctx.getActiveFilterKeys());
        const shouldHideCompleted = useUiPrefsStore.getState().prefsHideCompletedMarkers;
        const completedIds = shouldHideCompleted ? new Set(getActivePoints()) : new Set<string>();
        const result: string[] = [];

        for (const [id, data] of Object.entries(ctx.markerDataDict)) {
            if (!activeKeys.has(data.type)) continue;
            if (!ctx.isSubregionVisible(data.subregionId)) continue;
            if (completedIds.has(id)) continue;

            const latLng = L.latLng(data.position[0], data.position[1]);
            if (bounds.contains(latLng)) result.push(id);
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
            // Deselect mode: reset ALL state classes on markers entering the lasso
            for (const id of newHighlighted) {
                if (!currentHighlighted.has(id)) {
                    resetToNormal(id);
                }
            }
            // Restore markers leaving the lasso to their store-truth state
            for (const id of currentHighlighted) {
                if (!newHighlighted.has(id)) {
                    const wasSelected = preExistingSelected.has(id);
                    const wasChecked = preExistingChecked.has(id);
                    if (wasSelected) setVisualSelected(id, true);
                    if (wasChecked) {
                        const layer = ctx.markerDict[id];
                        if (layer) {
                            const el = (layer as L.Marker).getElement?.() as HTMLElement | null;
                            const inner = el?.querySelector(ctx.innerSelector);
                            if (inner) {
                                inner.classList.toggle(ctx.selectedClassName, wasSelected);
                                // Re-add checked class (stateClassNames[1] = checked)
                                inner.classList.add(ctx.stateClassNames[1]);
                            }
                        }
                    }
                }
            }
        } else {
            // Select mode: add .selected only to markers in normal state
            for (const id of newHighlighted) {
                if (!currentHighlighted.has(id)) {
                    // Only affect markers that were neither selected nor checked before lasso
                    if (!preExistingSelected.has(id) && !preExistingChecked.has(id)) {
                        setVisualSelected(id, true);
                    }
                }
            }
            // Remove .selected from markers leaving the lasso (only if we added it)
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
        for (const id of currentHighlighted) {
            setVisualSelected(id, selectedSet.has(id));
        }
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

        // Create persistent overlay element
        const overlay = document.createElement('div');
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
                const prevSelected = [...markerState.selectedPoints];
                const toRemoveSelected = collected.filter((id) => prevSelected.includes(id));

                const userRecord = useUserRecordStore.getState();
                const toRemoveChecked = collected.filter((id) =>
                    userRecord.activePoints.includes(id),
                );

                if (toRemoveSelected.length === 0 && toRemoveChecked.length === 0) return;

                toRemoveSelected.forEach((id) => markerState.setSelected(id, false));
                toRemoveChecked.forEach((id) => userRecord.deletePoint(id));

                useHistoryStore.getState().push({
                    label: `Deselect ${collected.length} markers`,
                    undo: () => {
                        toRemoveSelected.forEach((id) =>
                            useMarkerStore.getState().setSelected(id, true),
                        );
                        toRemoveChecked.forEach((id) =>
                            useUserRecordStore.getState().addPoint(id),
                        );
                    },
                    redo: () => {
                        toRemoveSelected.forEach((id) =>
                            useMarkerStore.getState().setSelected(id, false),
                        );
                        toRemoveChecked.forEach((id) =>
                            useUserRecordStore.getState().deletePoint(id),
                        );
                    },
                });
            } else {
                // ── Select mode — only add normal-state markers ──
                const prevSelected = new Set(markerState.selectedPoints);
                const checkedIds = new Set(getActivePoints());
                // Only select markers that were in normal state (not already selected or checked)
                const normalIds = collected.filter(
                    (id) => !prevSelected.has(id) && !checkedIds.has(id),
                );

                normalIds.forEach((id) => markerState.setSelected(id, true));

                if (normalIds.length > 0) {
                    useHistoryStore.getState().push({
                        label: `Multi-select ${normalIds.length} markers`,
                        undo: () => {
                            normalIds.forEach((id) =>
                                useMarkerStore.getState().setSelected(id, false),
                            );
                        },
                        redo: () => {
                            normalIds.forEach((id) =>
                                useMarkerStore.getState().setSelected(id, true),
                            );
                        },
                    });
                }
            }
        };

        // ── Cancel on key up ──
        const onKeyUp = (e: KeyboardEvent) => {
            if (dragging.current && !isModKeyPressed(e)) {
                dragging.current = false;
                container.style.cursor = '';
                map.dragging.enable();
                if (map.boxZoom) map.boxZoom.enable();
                fadeOutOverlay();
                startPx.current = null;
                startLatLng.current = null;
                map.fire('talos:lassoClear');
            }
        };

        container.addEventListener('pointerdown', onPointerDown);
        container.addEventListener('pointermove', onPointerMove);
        container.addEventListener('pointerup', onPointerUp);
        window.addEventListener('keyup', onKeyUp);

        return () => {
            container.removeEventListener('pointerdown', onPointerDown);
            container.removeEventListener('pointermove', onPointerMove);
            container.removeEventListener('pointerup', onPointerUp);
            window.removeEventListener('keyup', onKeyUp);
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
    const userRecord = useUserRecordStore.getState();

    // Find ids that are selected but not yet checked
    const unchecked = selectedIds.filter(
        (id) => !userRecord.activePoints.includes(id),
    );

    if (unchecked.length === 0) return false;

    // Mark all as checked
    unchecked.forEach((id) => userRecord.addPoint(id));

    // Push as single undo step
    useHistoryStore.getState().push({
        label: `Batch check ${unchecked.length} markers`,
        undo: () => {
            unchecked.forEach((id) => useUserRecordStore.getState().deletePoint(id));
        },
        redo: () => {
            unchecked.forEach((id) => useUserRecordStore.getState().addPoint(id));
        },
    });

    return true;
}