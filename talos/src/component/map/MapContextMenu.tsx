import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { AnimatePresence } from 'motion/react';
import useRegion from '@/store/region';
import { resolveSubregionAtLocation } from '@/services/map/subregionArea';
import ContextMenu, {
    type ContextMenuGroup,
} from '@/component/contextMenu/ContextMenu';
import { useTranslateGame, useTranslateUI } from '@/locale';
import { copyTextToClipboard } from '@/platform/clipboard';
import {
    generateLocationShareUrl,
    generatePointShareUrl,
} from '@/services/routing';
import {
    clearSameTypeHighlight,
    highlightSameType,
    resolveMarkerBulkTargets,
    setSameTypeCompleted,
    type MarkerBulkOptions,
} from '@/services/map/markerBulkActions';
import { commitMarkerSelection, useHistoryStore } from '@/store/history';
import { useMarkerStore } from '@/store/marker';
import { useUserRecord } from '@/store/userRecord';
import { useHideCompletedMarkers, useSetHideCompletedMarkers } from '@/store/uiPrefs';
import {
    MARKER_CONTEXT_MENU_EVENT,
    type MarkerContextMenuPayload,
} from './ContextMenuEvents';
import { emitPreviewLeave } from '@/component/mapCore/marker/markerRenderer';
import { getSubregionLabel } from '@/services/map/subregionLabel';
import styles from './MapContextMenu.module.scss';

type MenuTarget = { subregionKey: string | null } & (
    | {
        kind: 'marker';
        marker: MarkerContextMenuPayload['marker'];
        position: { x: number; y: number };
        restoreFocus: HTMLElement | null;
    }
    | {
        kind: 'map';
        latLng: L.LatLng;
        position: { x: number; y: number };
        shareable: boolean;
        restoreFocus: HTMLElement | null;
    });

type CopyState = 'idle' | 'copied' | 'failed';

const formatText = (template: string, values: Record<string, string | number>): string => (
    Object.entries(values).reduce(
        (text, [key, value]) => text.split(`{${key}}`).join(String(value)),
        template,
    )
);

const eventPosition = (
    map: L.Map,
    event: MouseEvent,
    fallback?: L.LatLngExpression,
): { x: number; y: number } => {
    if (event.clientX !== 0 || event.clientY !== 0 || !fallback) {
        return { x: event.clientX, y: event.clientY };
    }
    const rect = map.getContainer().getBoundingClientRect();
    const point = map.latLngToContainerPoint(fallback);
    return { x: rect.left + point.x, y: rect.top + point.y };
};

const MapContextMenu = ({ map }: { map: L.Map }) => {
    const tUI = useTranslateUI();
    const tGame = useTranslateGame();
    const [target, setTarget] = useState<MenuTarget | null>(null);
    const [confirmingComplete, setConfirmingComplete] = useState(false);
    const [copyState, setCopyState] = useState<CopyState>('idle');
    const copyTimerRef = useRef<number | null>(null);
    const visibleSubregionKey = useMarkerStore((state) => state.visibleSubregionKey);
    const selectedPoints = useMarkerStore((state) => state.selectedPoints);
    const activePoints = useUserRecord();
    const hideCompletedMarkers = useHideCompletedMarkers();
    const setHideCompletedMarkers = useSetHideCompletedMarkers();
    const canUndo = useHistoryStore((state) => state.past.length > 0);
    const canRedo = useHistoryStore((state) => state.future.length > 0);

    const closeMenu = useCallback(() => {
        setTarget((current) => {
            current?.restoreFocus?.focus({ preventScroll: true });
            return null;
        });
        setConfirmingComplete(false);
        setCopyState('idle');
    }, []);

    useEffect(() => {
        const close = () => closeMenu();
        const mapContainer = map.getContainer();
        const preserveNativeContextMenu = (event: MouseEvent) => {
            if (event.altKey) event.stopImmediatePropagation();
        };
        const onMarkerContext = (leafletEvent: L.LeafletEvent) => {
            const event = leafletEvent as L.LeafletEvent & MarkerContextMenuPayload;
            if (event.originalEvent.altKey) return;
            event.originalEvent.preventDefault();
            emitPreviewLeave(event.marker.id);
            setConfirmingComplete(false);
            setCopyState('idle');
            setTarget({
                kind: 'marker',
                subregionKey: resolveSubregionAtLocation(map, useRegion.getState().currentRegionKey, event.marker.pos),
                marker: event.marker,
                position: eventPosition(map, event.originalEvent, event.marker.pos),
                restoreFocus: event.originalEvent.target instanceof HTMLElement
                    ? event.originalEvent.target
                    : null,
            });
        };
        const onMapContext = (event: L.LeafletMouseEvent) => {
            if (event.originalEvent.altKey) return;
            event.originalEvent.preventDefault();
            const configuredBounds = map.options.maxBounds;
            setConfirmingComplete(false);
            setCopyState('idle');
            setTarget({
                kind: 'map',
                subregionKey: resolveSubregionAtLocation(map, useRegion.getState().currentRegionKey, event.latlng),
                latLng: event.latlng,
                position: eventPosition(map, event.originalEvent),
                shareable: !configuredBounds
                    || typeof (configuredBounds as L.LatLngBounds).contains !== 'function'
                    || (configuredBounds as L.LatLngBounds).contains(event.latlng),
                restoreFocus: event.originalEvent.target instanceof HTMLElement
                    ? event.originalEvent.target
                    : null,
            });
        };

        // Leaflet prevents the browser menu before firing its contextmenu event.
        // Capture Alt/Option first so the native menu remains reachable.
        mapContainer.addEventListener('contextmenu', preserveNativeContextMenu, true);
        map.on(MARKER_CONTEXT_MENU_EVENT, onMarkerContext);
        map.on('contextmenu', onMapContext);
        map.on('click movestart zoomstart', close);
        map.on('talos:regionSwitched' as string, close);
        return () => {
            mapContainer.removeEventListener('contextmenu', preserveNativeContextMenu, true);
            map.off(MARKER_CONTEXT_MENU_EVENT, onMarkerContext);
            map.off('contextmenu', onMapContext);
            map.off('click movestart zoomstart', close);
            map.off('talos:regionSwitched' as string, close);
        };
    }, [closeMenu, map]);

    useEffect(() => {
        if (!confirmingComplete) return undefined;
        const timer = window.setTimeout(() => setConfirmingComplete(false), 2_000);
        return () => window.clearTimeout(timer);
    }, [confirmingComplete]);

    useEffect(() => () => {
        if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    }, []);

    const markerScope = useMemo(() => target?.kind === 'marker' && target.subregionKey
        ? { kind: 'subregion' as const, id: target.subregionKey }
        : null, [target]);
    const markerBulkOptions: MarkerBulkOptions = useMemo(() => ({ treatArchivesAsSameType: true }), []);
    const bulkTargets = useMemo(() => {
        void activePoints;
        void selectedPoints;
        return target?.kind === 'marker' && markerScope
            ? resolveMarkerBulkTargets(target.marker, markerScope, markerBulkOptions)
            : null;
    }, [activePoints, markerBulkOptions, markerScope, selectedPoints, target]);

    const translate = useCallback((key: string, values: Record<string, string | number> = {}) => {
        const value = String(tUI(`contextMenu.${key}`) || key);
        return formatText(value, values);
    }, [tUI]);

    const copyLink = useCallback(async (url: string) => {
        const copied = await copyTextToClipboard(url);
        setCopyState(copied ? 'copied' : 'failed');
        if (!copied) return;
        if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
        copyTimerRef.current = window.setTimeout(closeMenu, 900);
    }, [closeMenu]);

    if (!target) return <AnimatePresence />;

    const copyLabel = copyState === 'copied'
        ? String(tUI('common.copied') || 'Link copied')
        : copyState === 'failed'
            ? String(tUI('common.copyFailed') || 'Copy failed, try again')
            : target.kind === 'marker'
                ? translate('sharePoint')
                : translate('shareLocation');

    const scopeItem = {
        id: 'scope-toggle',
        label: visibleSubregionKey
            ? translate('showAllSubregions')
            : target.subregionKey
                ? translate('onlySubregion', {
                    region: getSubregionLabel(target.subregionKey, (key) => String(tGame(key))),
                })
                : translate('showAllSubregions'),
        disabled: !visibleSubregionKey && !target.subregionKey,
        onSelect: () => useMarkerStore.getState().setVisibleSubregionKey(
            visibleSubregionKey ? null : target.subregionKey,
        ),
    };

    const groups: ContextMenuGroup[] = target.kind === 'marker'
        ? [
            {
                id: 'scope',
                items: [scopeItem],
            },
            {
                id: 'highlight',
                items: [
                    {
                        id: 'highlight-same',
                        label: translate('highlightSameType', { count: bulkTargets?.selectableIds.length ?? 0 }),
                        disabled: !bulkTargets?.selectableIds.length,
                        onSelect: () => { if (markerScope) highlightSameType(target.marker, markerScope, markerBulkOptions); },
                    },
                    {
                        id: 'clear-same-highlight',
                        label: translate('clearSameTypeHighlight', { count: bulkTargets?.selectedIds.length ?? 0 }),
                        disabled: !bulkTargets?.selectedIds.length,
                        onSelect: () => { if (markerScope) clearSameTypeHighlight(target.marker, markerScope, markerBulkOptions); },
                    },
                ],
            },
            {
                id: 'progress',
                items: [
                    {
                        id: 'complete-same',
                        label: confirmingComplete
                            ? translate('confirmComplete', { count: bulkTargets?.incompleteIds.length ?? 0 })
                            : translate('completeSameType', { count: bulkTargets?.incompleteIds.length ?? 0 }),
                        disabled: !bulkTargets?.incompleteIds.length,
                        danger: confirmingComplete,
                        closeOnSelect: confirmingComplete,
                        onSelect: () => {
                            if (!confirmingComplete) {
                                setConfirmingComplete(true);
                                return;
                            }
                            if (markerScope) setSameTypeCompleted(target.marker, markerScope, true, markerBulkOptions);
                        },
                    },
                    {
                        id: 'uncomplete-same',
                        label: translate('uncompleteSameType', { count: bulkTargets?.completedIds.length ?? 0 }),
                        disabled: !bulkTargets?.completedIds.length,
                        onSelect: () => { if (markerScope) setSameTypeCompleted(target.marker, markerScope, false, markerBulkOptions); },
                    },
                ],
            },
            {
                id: 'share',
                items: [{
                    id: 'share-point',
                    label: copyLabel,
                    closeOnSelect: false,
                    onSelect: () => void copyLink(generatePointShareUrl(target.marker)),
                }],
            },
        ]
        : [
            {
                id: 'share',
                items: [{
                    id: 'share-location',
                    label: copyLabel,
                    disabled: target.kind !== 'map' || !target.shareable,
                    closeOnSelect: false,
                    onSelect: () => {
                        if (target.kind !== 'map') return;
                        void copyLink(generateLocationShareUrl({
                            lat: target.latLng.lat,
                            lng: target.latLng.lng,
                            zoom: map.getZoom(),
                        }));
                    },
                }],
            },
            {
                id: 'view',
                items: [
                    scopeItem,
                    {
                        id: 'clear-highlight',
                        label: translate('clearAllHighlights'),
                        disabled: selectedPoints.length === 0,
                        onSelect: () => {
                            commitMarkerSelection(
                                `Clear ${selectedPoints.length} highlighted markers`,
                                { deselect: selectedPoints },
                            );
                        },
                    },
                    {
                        id: 'toggle-hide-completed',
                        label: translate(hideCompletedMarkers ? 'showCompletedMarkers' : 'hideCompletedMarkers'),
                        onSelect: () => setHideCompletedMarkers(!hideCompletedMarkers),
                    },
                ],
            },
            {
                id: 'history',
                layout: 'row',
                items: [
                    {
                        id: 'undo',
                        label: translate('undo'),
                        disabled: !canUndo,
                        onSelect: () => useHistoryStore.getState().undo(),
                    },
                    {
                        id: 'redo',
                        label: translate('redo'),
                        disabled: !canRedo,
                        onSelect: () => useHistoryStore.getState().redo(),
                    },
                ],
            },
        ];

    const header = target.kind === 'marker' ? (
        <div className={styles.markerHeader}>
            <strong>{String(tGame(`markerType.key.${target.marker.type}`) || target.marker.type)}</strong>
            {target.subregionKey && <span>{getSubregionLabel(target.subregionKey, (key) => String(tGame(key)))}</span>}
        </div>
    ) : undefined;

    return (
        <AnimatePresence>
        <ContextMenu
            key={`${target.position.x}:${target.position.y}`}
            ownerDocument={map.getContainer().ownerDocument}
            position={target.position}
            groups={groups}
            header={header}
            onDismiss={closeMenu}
        />
        </AnimatePresence>
    );
};

export default MapContextMenu;
