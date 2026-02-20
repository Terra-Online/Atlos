/**
 * useKeyboardShortcuts — binds shortcut config to actual application logic.
 *
 * Consumes the data-driven config from `./shortcuts` and wires each
 * entry to its handler. The hook should be mounted once near the app root.
 *
 * Separation of concerns:
 *   settings/shortcuts.ts      → WHAT shortcuts exist (data)
 *   settings/useShortcuts.ts   → HOW they behave (logic)
 */

import { useHotkeys } from 'react-hotkeys-hook';
import { useCallback, useRef } from 'react';
import { getShortcutConfig } from './shortcuts';
import { useHistoryStore } from '@/store/history';
import { useMarkerStore } from '@/store/marker';
import { useUserRecordStore } from '@/store/userRecord';
import { exportMarkerData, importMarkerData } from '@/utils/storage';
import L from 'leaflet';

// ─── Helpers ─────────────────────────────────────────────────

/** Build a map of id → hotkey string from config (only entries with a hotkey) */
function hotkeyFor(id: string): string {
    const cfg = getShortcutConfig().find((s) => s.id === id);
    return cfg?.hotkey ?? '';
}

// ─── Hook ────────────────────────────────────────────────────

export function useKeyboardShortcuts(mapInstance: L.Map | undefined) {
    const fileInputRef = useRef<HTMLInputElement | null>(null);

    // ── Export ──
    const handleExport = useCallback(() => {
        const activePoints = useUserRecordStore.getState().activePoints;
        const { filter, selectedPoints } = useMarkerStore.getState();
        exportMarkerData(activePoints, filter, selectedPoints);
    }, []);

    useHotkeys(hotkeyFor('exportData'), (e) => {
        e.preventDefault();
        handleExport();
    }, { enableOnFormTags: false });

    // ── Import ──
    const handleImportFile = useCallback(async (file: File) => {
        const content = await file.text();
        const success = await importMarkerData(content, {
            clearPoints: useUserRecordStore.getState().clearPoints,
            addPoint: useUserRecordStore.getState().addPoint,
            setFilter: useMarkerStore.getState().setFilter,
            getSelectedPoints: () => useMarkerStore.getState().selectedPoints,
            setSelected: useMarkerStore.getState().setSelected,
            getActivePoints: () => useUserRecordStore.getState().activePoints,
            getFilter: () => useMarkerStore.getState().filter,
        });
        if (success) {
            window.location.reload();
        }
    }, []);

    useHotkeys(hotkeyFor('importData'), (e) => {
        e.preventDefault();
        // Create or re-use hidden file input
        if (!fileInputRef.current) {
            const input = document.createElement('input');
            input.type = 'file';
            input.accept = '.json';
            input.style.display = 'none';
            input.addEventListener('change', () => {
                const file = input.files?.[0];
                if (file) void handleImportFile(file);
                input.value = '';
            });
            document.body.appendChild(input);
            fileInputRef.current = input;
        }
        fileInputRef.current.click();
    }, { enableOnFormTags: false });

    // ── Undo / Redo ──
    useHotkeys(hotkeyFor('undo'), (e) => {
        e.preventDefault();
        useHistoryStore.getState().undo();
    }, { enableOnFormTags: false });

    useHotkeys(hotkeyFor('redo'), (e) => {
        e.preventDefault();
        useHistoryStore.getState().redo();
    }, { enableOnFormTags: false });

    // ── Zoom ──
    useHotkeys(hotkeyFor('zoomIn'), (e) => {
        e.preventDefault();
        if (mapInstance) {
            mapInstance.zoomIn(0.5);
        }
    }, { enableOnFormTags: false }, [mapInstance]);

    useHotkeys(hotkeyFor('zoomOut'), (e) => {
        e.preventDefault();
        if (mapInstance) {
            mapInstance.zoomOut(0.5);
        }
    }, { enableOnFormTags: false }, [mapInstance]);

    // multiSelect / multiDeselect are handled separately via pointer events (useMapMultiSelect)
}
