import { ViewportMarker } from '@/services/map/core/canvas/markerViewport';
import L from 'leaflet';
import { SceneIcon, setMarkerState } from '@/services/map/core/canvas/markerModel';
import { IMarkerData, type IMarkerType, MARKER_TYPE_DICT } from '@/data/marker';

import { getItemIconUrl, getMarkerSubIconUrl } from '@/services/assets/resource';
import LOGGER from '@/lib/logging/logger';
import {
    MARKER_PREVIEW_ENTER_EVENT,
    MARKER_PREVIEW_LEAVE_EVENT,
} from '@/services/map/events/PreviewEvents';

import { useMarkerStore } from '@/store/marker';
import { getDisplayedPointProgress } from '@/store/guideProgress';
import { getActivePoints } from '@/store/userRecord';
import { useUiPrefsStore } from '@/store/uiPrefs';
import { commitPointProgress } from '@/store/history';
import { batchCheckSelectedPoints, isLassoSelected } from '@/services/map/selection/useMapMultiSelect';
import { getLayerByTier, getLayerTier, useLayerStore, type LayerType } from '@/store/layer';
import { REGION_DICT } from '@/data/map';
import useRegion from '@/store/region';

interface MarkerStateHandlers {
    beforeCheck?: (markerData: IMarkerData, context: { filterWasActive: boolean }) => boolean;
    onContextMenu?: (markerData: IMarkerData, originalEvent: MouseEvent) => void;
}

export const MARKER_ICON_DICT = Object.values(MARKER_TYPE_DICT).reduce<Record<string, SceneIcon>>(
    (icons, type: IMarkerType) => {
        const noFrame = !!type.noFrame && !type.subIcon;
        icons[type.key] = new SceneIcon({
            image: getItemIconUrl(type.subIcon ? type.key : type.icon ?? type.key, 'webp'),
            subImage: type.subIcon ? getMarkerSubIconUrl(type.subIcon) : '',
            noFrame,
            tier: '',
        }, type.key, {
            iconSize: noFrame ? [50, 50] : [32, 32],
            iconAnchor: noFrame ? [25, 25] : [16, 32],
            popupAnchor: [0, 0],
            tooltipAnchor: [0, 0],
        });
        return icons;
    }, {},
);

// Store arrays are immutable snapshots. Cache membership once per snapshot,
// avoiding an O(markers × selected/collected) scan when layers are attached.
const membership = new WeakMap<readonly string[], ReadonlySet<string>>();
const hasId = (ids: readonly string[], id: string): boolean => {
    if (ids.length < 32) return ids.includes(id);
    let index = membership.get(ids);
    if (!index) { index = new Set(ids); membership.set(ids, index); }
    return index.has(id);
};

const ensureMarkerTypeFilterSelected = (typeKey: string): void => {
    const markerStore = useMarkerStore.getState();
    if (markerStore.filter.includes(typeKey)) return;
    markerStore.setFilter([...markerStore.filter, typeKey]);
};

const getMarkerTierLabel = (tier: number): string | null => {
    const normalizedTier = Math.trunc(tier);
    if (normalizedTier === 0) return null;
    return `${normalizedTier < 0 ? 'B' : 'L'}${Math.abs(normalizedTier)}`;
};

export const getMarkerRelativeTier = (markerData: IMarkerData, currentLayer: LayerType): number =>
    markerData.tier - getLayerTier(currentLayer);

export const syncMarkerTierAttribute = (
    layer: L.Layer,
    markerData: IMarkerData,
    currentLayer: LayerType = useLayerStore.getState().currentLayer,
): void => {
    if (!(layer instanceof L.Marker)) return;
    setMarkerState(layer, {
        tier: getMarkerTierLabel(markerData.tier) ?? '',
        offLayer: markerData.tier !== getLayerTier(currentLayer),
    });
};

const switchToMarkerLayer = (markerData: IMarkerData): void => {
    const targetLayer = getLayerByTier(markerData.tier);
    if (!targetLayer) return;

    const currentRegion = useRegion.getState().currentRegionKey;
    const availableLayers = REGION_DICT[currentRegion]?.layers;
    if (targetLayer !== 'M' && !availableLayers?.includes(targetLayer)) return;

    const layerStore = useLayerStore.getState();
    if (layerStore.currentLayer === targetLayer) return;
    layerStore.setCurrentLayer(targetLayer);
};

export const syncMarkerCollectedStacking = (layer: L.Marker, collected: boolean): void => {
    setMarkerState(layer, { completed: collected });
};

const syncMarkerState = (layer: L.Marker, markerId: string): void => {
    const markerStore = useMarkerStore.getState();
    const selected = hasId(markerStore.selectedPoints, markerId)
        || hasId(markerStore.temporarySelectedPoints, markerId);
    const checked = hasId(getDisplayedPointProgress(), markerId);
    setMarkerState(layer, { selected, checked, completed: checked });
};

const checkSingleMarker = (id: string): void => {
    commitPointProgress(`Collect ${id}`, { collect: [id] });
    useMarkerStore.getState().setSelected(id, false);
    useMarkerStore.getState().setTemporarySelected(id, false);
};

const handleMarkerClickState = (markerData: IMarkerData, layer: L.Marker, handlers?: MarkerStateHandlers): void => {
    const filterWasActive = useMarkerStore.getState().filter.includes(markerData.type);
    ensureMarkerTypeFilterSelected(markerData.type);

    const markerStore = useMarkerStore.getState();
    const selectedNow = hasId(markerStore.selectedPoints, markerData.id)
        || hasId(markerStore.temporarySelectedPoints, markerData.id);
    const checkedNow = hasId(getActivePoints(), markerData.id);

    if (!selectedNow && !checkedNow) {
        useMarkerStore.getState().setSelected(markerData.id, true);
    } else if (selectedNow && !checkedNow) {
        const keepVisibleAfterCheck = handlers?.beforeCheck?.(markerData, { filterWasActive }) ?? false;
        const allSelected = useMarkerStore.getState().selectedPoints;
        if (isLassoSelected(markerData.id) && allSelected.length > 1 && batchCheckSelectedPoints(allSelected)) {
            // batch check handled
        } else {
            checkSingleMarker(markerData.id);
        }

        const shouldHideCompleted = useUiPrefsStore.getState().prefsHideCompletedMarkers;
        setMarkerState(layer, { disappearing: shouldHideCompleted && !keepVisibleAfterCheck });
    } else {
        const id = markerData.id;
        commitPointProgress(`Uncollect ${id}`, { uncollect: [id] });
        useMarkerStore.getState().setSelected(id, false);
        useMarkerStore.getState().setTemporarySelected(id, false);
    }

    syncMarkerState(layer, markerData.id);
};

const emitPreviewEnter = (markerData: IMarkerData): void => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(MARKER_PREVIEW_ENTER_EVENT, {
        detail: { marker: markerData },
    }));
};

export const emitPreviewLeave = (markerId: string): void => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(MARKER_PREVIEW_LEAVE_EVENT, {
        detail: { markerId },
    }));
};

const attachPreviewLifecycle = (layer: L.Marker, markerData: IMarkerData): void => {
    layer.on('mouseover', () => {
        emitPreviewEnter(markerData);
    });

    layer.on('mouseout', () => {
        emitPreviewLeave(markerData.id);
    });
    layer.on('viewporthide', () => {
        emitPreviewLeave(markerData.id);
        setMarkerState(layer, { appearing: false });
    });
};

export function getMarkerLayer(
    markerData: IMarkerData,
    onClick?: (markerData: IMarkerData) => void,
    collectedPoints?: string[],
    handlers?: MarkerStateHandlers,
): ViewportMarker {
    const icon = MARKER_ICON_DICT[markerData.type];
    if (!icon) LOGGER.warn('marker type not found', markerData.type);
    const layer = new ViewportMarker(markerData.pos, {
        icon,
        alt: markerData.type,
    });

    if (collectedPoints && hasId(collectedPoints, markerData.id)) {
        setMarkerState(layer, { checked: true, completed: true });
    }
    layer.on('add', () => {
        syncMarkerTierAttribute(layer, markerData);
        syncMarkerState(layer, markerData.id);
        setMarkerState(layer, { appearing: true });
    });
    layer.on('click', (event: L.LeafletMouseEvent) => {
        event.originalEvent.stopPropagation();
        switchToMarkerLayer(markerData);
        handleMarkerClickState(markerData, layer, handlers);
        LOGGER.debug('marker clicked', markerData);
        onClick?.(markerData);
    });
    layer.on('contextmenu', (event: L.LeafletMouseEvent) => {
        if (event.originalEvent.altKey) return;
        L.DomEvent.stop(event.originalEvent);
        handlers?.onContextMenu?.(markerData, event.originalEvent);
    });
    attachPreviewLifecycle(layer, markerData);
    return layer;
}
