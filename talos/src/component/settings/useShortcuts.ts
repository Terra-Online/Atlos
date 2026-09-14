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

import { useHotkeys, type Options } from 'react-hotkeys-hook';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { getShortcutConfig } from './shortcuts';
import { replacePointProgressFromExternal, useHistoryStore } from '@/store/history';
import { useMarkerStore } from '@/store/marker';
import { useUserRecordStore } from '@/store/userRecord';
import { useUiPrefsStore } from '@/store/uiPrefs';
import { exportMarkerData, importMarkerData } from '@/services/markerDataTransfer';
import L from 'leaflet';
/** Build a map of id → hotkey string from config (only entries with a hotkey) */
function hotkeyFor(id: string): string {
    const cfg = getShortcutConfig().find((s) => s.id === id);
    return cfg?.hotkey ?? '';
}

interface UIShortcutActions {
    showUI: () => void;
}

export function useKeyboardShortcuts(
    mapInstance: L.Map | undefined,
    shortcutDocument: Document,
    { showUI }: UIShortcutActions,
) {
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const hotkeyOptions = useMemo<Options>(() => ({
        document: shortcutDocument,
        enableOnFormTags: false,
    }), [shortcutDocument]);

    // ── Quick search ──
    useHotkeys(hotkeyFor('quickSearch'), (e) => {
        e.preventDefault();
        showUI();

        const sidebar = shortcutDocument.querySelector<HTMLElement>('[data-sidebar-layout]');
        const prefs = useUiPrefsStore.getState();
        if (sidebar?.dataset.sidebarLayout === 'desktop' && !prefs.sidebarOpen) {
            prefs.setSidebarOpen(true);
        } else if (sidebar?.dataset.sidebarLayout === 'mobile') {
            const snapIndex = prefs.mobileDrawerSnapIndex ?? 0;
            if (snapIndex < 1) prefs.setMobileDrawerSnapIndex(1);
        }

        const focusSearch = () => {
            const scroller = shortcutDocument.querySelector<HTMLElement>('[data-sidebar-scroll="true"]');
            if (scroller && scroller.scrollTop > 1) {
                scroller.scrollTo({ top: 0, behavior: 'smooth' });
            }
            shortcutDocument
                .querySelector<HTMLInputElement>('[data-search-input="true"]')
                ?.focus({ preventScroll: true });
        };

        const requestFrame = shortcutDocument.defaultView?.requestAnimationFrame;
        if (requestFrame) requestFrame(focusSearch);
        else focusSearch();
    }, { ...hotkeyOptions, enableOnFormTags: true }, [shortcutDocument, showUI]);

    // ── Export ──
    const handleExport = useCallback(() => {
        const activePoints = useUserRecordStore.getState().activePoints;
        const { filter, selectedPoints } = useMarkerStore.getState();
        exportMarkerData(activePoints, filter, selectedPoints);
    }, []);

    useHotkeys(hotkeyFor('exportData'), (e) => {
        e.preventDefault();
        handleExport();
    }, hotkeyOptions);

    // ── Import ──
    const handleImportFile = useCallback(async (file: File) => {
        const content = await file.text();
        const success = importMarkerData(content, {
            replacePoints: replacePointProgressFromExternal,
            setFilter: useMarkerStore.getState().setFilter,
            setSelected: useMarkerStore.getState().setSelected,
            getActivePoints: () => useUserRecordStore.getState().activePoints,
            getFilter: () => useMarkerStore.getState().filter,
        });
        if (success) {
            window.location.reload();
        }
    }, []);

    // Create the hidden file input once and clean it up on unmount.
    useEffect(() => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.style.display = 'none';
        input.addEventListener('change', () => {
            const file = input.files?.[0];
            if (file) void handleImportFile(file);
            input.value = '';
        });
        shortcutDocument.body.appendChild(input);
        fileInputRef.current = input;

        return () => {
            input.remove();
            fileInputRef.current = null;
        };
    }, [handleImportFile, shortcutDocument]);

    useHotkeys(hotkeyFor('importData'), (e) => {
        e.preventDefault();
        fileInputRef.current?.click();
    }, hotkeyOptions);

    // ── Undo / Redo ──
    useHotkeys(hotkeyFor('undo'), (e) => {
        e.preventDefault();
        useHistoryStore.getState().undo();
    }, hotkeyOptions);

    useHotkeys(hotkeyFor('redo'), (e) => {
        e.preventDefault();
        useHistoryStore.getState().redo();
    }, hotkeyOptions);

    // ── Zoom ──
    useHotkeys(hotkeyFor('zoomIn'), (e) => {
        e.preventDefault();
        if (mapInstance) {
            mapInstance.zoomIn(0.5);
        }
    }, hotkeyOptions, [mapInstance]);

    useHotkeys(hotkeyFor('zoomOut'), (e) => {
        e.preventDefault();
        if (mapInstance) {
            mapInstance.zoomOut(0.5);
        }
    }, hotkeyOptions, [mapInstance]);

    // multiSelect / multiDeselect are handled separately via pointer events (useMapMultiSelect)
}
