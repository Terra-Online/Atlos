import L, { divIcon } from 'leaflet';
import { IMarkerData, type IMarkerType, MARKER_TYPE_DICT } from '@/data/marker';

import { getItemIconUrl, getMarkerSubIconUrl } from '@/services/assets/resource';
import LOGGER from '@/lib/logging/logger';
import {
    MARKER_PREVIEW_ENTER_EVENT,
    MARKER_PREVIEW_LEAVE_EVENT,
} from '@/component/map/PreviewEvents';

import styles from './marker.module.scss';
import { useMarkerStore } from '@/store/marker';
import { getActivePoints } from '@/store/userRecord';
import { useUiPrefsStore } from '@/store/uiPrefs';
import { commitPointProgress } from '@/store/history';
import { batchCheckSelectedPoints, isLassoSelected } from '@/component/settings/useMapMultiSelect';
import { getLayerByTier, getLayerTier, useLayerStore, type LayerType } from '@/store/layer';
import { REGION_DICT } from '@/data/map';
import useRegion from '@/store/region';

interface MarkerStateHandlers {
    beforeCheck?: (markerData: IMarkerData, context: { filterWasActive: boolean }) => boolean;
}

export const MARKER_ICON_DICT = Object.values(MARKER_TYPE_DICT).reduce<
    Record<string, L.Icon | L.DivIcon>
>((acc, typeInfo: IMarkerType) => {
    // Prefer explicit icon field (files dataset maps icon names, not type keys)
    const iconUrl = getItemIconUrl(typeInfo.icon ?? typeInfo.key, 'webp');
    if (typeInfo.noFrame) {
        acc[typeInfo.key] = divIcon({
            iconSize: [50, 50],
            iconAnchor: [25, 25],
            popupAnchor: [0, 0],
            tooltipAnchor: [0, 0],
            className: styles.noFrameMarkerIcon,
            html: `<div class="${styles.noFrameInner}"><img src="${iconUrl}" class="${styles.noFrameImage}" alt="${typeInfo.key}" /></div>`,
        });
    } else
        acc[typeInfo.key] = divIcon({
            // iconUrl,
            iconSize: [32, 32],
            iconAnchor: [16, 32],
            popupAnchor: [0, 0],
            tooltipAnchor: [0, 0],
            className: styles.FrameMarkerIcon,
            html: `<div class="${styles.markerInner}"><div class="${styles.FrameImage}"><img src="${iconUrl}" alt="${typeInfo.key}" /></div></div>`,
        });
    return acc;
}, {});

const ensureMarkerTypeFilterSelected = (typeKey: string): void => {
    const markerStore = useMarkerStore.getState();
    if (markerStore.filter.includes(typeKey)) return;
    markerStore.setFilter([...markerStore.filter, typeKey]);
};

const getMarkerInnerElement = (layer: L.Marker): HTMLElement | null => {
    const markerRoot = layer.getElement?.() as HTMLElement | null;
    return markerRoot?.querySelector(`.${styles.markerInner}, .${styles.noFrameInner}`) ?? null;
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
    const inner = getMarkerInnerElement(layer);
    if (!inner) return;

    const markerTierLabel = getMarkerTierLabel(markerData.tier);
    if (!markerTierLabel) {
        delete inner.dataset.tier;
    } else {
        inner.dataset.tier = markerTierLabel;
    }

    const isCurrentTier = markerData.tier === getLayerTier(currentLayer);
    inner.classList.toggle(styles.currentTier, isCurrentTier);
    inner.classList.toggle(styles.offLayer, !isCurrentTier);
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
    const markerRoot = layer.getElement?.() as HTMLElement | null;
    if (!markerRoot) return;
    markerRoot.classList.toggle(styles.completedMarker, collected);
    markerRoot.classList.toggle(styles.incompleteMarker, !collected);
};

const syncMarkerStateClasses = (layer: L.Marker, markerId: string): void => {
    const inner = getMarkerInnerElement(layer);
    if (!inner) return;
    const markerStore = useMarkerStore.getState();
    const selectedAfter = markerStore.selectedPoints.includes(markerId)
        || markerStore.temporarySelectedPoints.includes(markerId);
    const checkedAfter = getActivePoints().includes(markerId);
    inner.classList.toggle(styles.selected, selectedAfter);
    inner.classList.toggle(styles.checked, checkedAfter);
    syncMarkerCollectedStacking(layer, checkedAfter);
};

const checkSingleMarker = (id: string): void => {
    commitPointProgress(`Collect ${id}`, { collect: [id] });
    useMarkerStore.getState().setSelected(id, false);
    useMarkerStore.getState().setTemporarySelected(id, false);
};

const handleMarkerClickState = (markerData: IMarkerData, layer: L.Marker, handlers?: MarkerStateHandlers): void => {
    const filterWasActive = useMarkerStore.getState().filter.includes(markerData.type);
    ensureMarkerTypeFilterSelected(markerData.type);

    const inner = getMarkerInnerElement(layer);
    if (!inner) return;

    const markerStore = useMarkerStore.getState();
    const selectedNow = markerStore.selectedPoints.includes(markerData.id)
        || markerStore.temporarySelectedPoints.includes(markerData.id);
    const checkedNow = getActivePoints().includes(markerData.id);

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
        if (shouldHideCompleted && !keepVisibleAfterCheck) {
            inner.classList.add(styles.disappearing);
        } else {
            inner.classList.remove(styles.disappearing);
        }
    } else {
        const id = markerData.id;
        commitPointProgress(`Uncollect ${id}`, { uncollect: [id] });
        useMarkerStore.getState().setSelected(id, false);
        useMarkerStore.getState().setTemporarySelected(id, false);
    }

    syncMarkerStateClasses(layer, markerData.id);
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
};

const RENDERER_DICT: Record<
    string,
    (
        markerData: IMarkerData,
        onClick?: (markerData: IMarkerData) => void,
        handlers?: MarkerStateHandlers,
    ) => L.Marker
> = {
    __DEFAULT: (markerData, onClick, handlers) => {
        const layer = new L.Marker(markerData.pos, {
            icon: MARKER_ICON_DICT[markerData.type],
            alt: markerData.type,
        });

        // 初次添加到地图时，按存储状态渲染 selected/checked
        layer.on('add', () => {
            const markerRoot = layer.getElement?.() as HTMLElement | null;
            const inner = markerRoot?.querySelector(`.${styles.markerInner}, .${styles.noFrameInner}`);
            if (!inner) return;
            syncMarkerTierAttribute(layer, markerData);
            // entry fade-in
            inner.classList.add(styles.appearing);
            syncMarkerStateClasses(layer, markerData.id);
            // 等待动画完成后移除 appearing class
            const onAnimationEnd = () => {
                inner.classList.remove(styles.appearing);
                inner.removeEventListener('animationend', onAnimationEnd);
            };
            inner.addEventListener('animationend', onAnimationEnd);
        });
        
        layer.addEventListener('click', (e) => {
            e.originalEvent.stopPropagation();
            switchToMarkerLayer(markerData);
            handleMarkerClickState(markerData, layer, handlers);
            
            LOGGER.debug('marker clicked', markerData);
            onClick?.(markerData);
        });

        attachPreviewLifecycle(layer, markerData);
        
        return layer;
    },
    sub_icon: (markerData, onClick, handlers) => {
        const sub = MARKER_TYPE_DICT[markerData.type].subIcon;
        const iconUrl = getItemIconUrl(markerData.type);
        const subIconUrl = getMarkerSubIconUrl(sub);
        
        // 将 subIcon 改为直接嵌入到 marker HTML 中，取消使用 Leaflet tooltip
        // + DOM 联动，CSS选择器控制样式
        // - 失去tooltip的高z轴，在点密集场景下会被覆盖
        // - 需要pointer-events: none 使 subIcon 不接收鼠标事件
        const markerIcon = divIcon({
            iconSize: [32, 32],
            iconAnchor: [16, 32],
            popupAnchor: [0, 0],
            tooltipAnchor: [0, 0],
            className: styles.FrameMarkerIcon,
            html: `<div class="${styles.markerInner}">
                       <div class="${styles.FrameImage}"><img src="${iconUrl}" alt="${markerData.type}" /></div>
                       <div class="${styles.subIconContainer}">
                           <img src="${subIconUrl}" class="${styles.subIcon}" />
                       </div>
                   </div>`,
        });
        
        const layer = new L.Marker(markerData.pos, {
            icon: markerIcon,
            alt: markerData.type,
        });
        // 初次添加到地图时，按存储状态渲染 selected/checked（sub_icon）
        layer.on('add', () => {
            const markerRoot = layer.getElement?.() as HTMLElement | null;
            const inner = markerRoot?.querySelector(`.${styles.markerInner}, .${styles.noFrameInner}`);
            if (!inner) return;
            syncMarkerTierAttribute(layer, markerData);
            // entry fade-in
            inner.classList.add(styles.appearing);
            syncMarkerStateClasses(layer, markerData.id);
            // 等待动画完成后移除 appearing class
            const onAnimationEnd = () => {
                inner.classList.remove(styles.appearing);
                inner.removeEventListener('animationend', onAnimationEnd);
            };
            inner.addEventListener('animationend', onAnimationEnd);
        });
            
        layer.addEventListener('click', (e) => {
            e.originalEvent.stopPropagation();
            switchToMarkerLayer(markerData);
            handleMarkerClickState(markerData, layer, handlers);
            
            LOGGER.debug('marker clicked', markerData);
            onClick?.(markerData);
        });

        attachPreviewLifecycle(layer, markerData);

        return layer;
    },
};

export function getMarkerLayer(
    markerData: IMarkerData,
    onClick?: (markerData: IMarkerData) => void,
    collectedPoints?: string[],
    handlers?: MarkerStateHandlers,
) {
    const type = MARKER_TYPE_DICT[markerData.type];
    const layer = (() => {
        if (!type) {
            LOGGER.warn('marker type not found', markerData.type);
            return RENDERER_DICT['__DEFAULT'](markerData, onClick, handlers);
        }
        if (type.subIcon) {
            return RENDERER_DICT['sub_icon'](markerData, onClick, handlers);
        } else {
            return RENDERER_DICT['__DEFAULT'](markerData, onClick, handlers);
        }
    })();
    
    // add checked class (if collected)
    if (collectedPoints?.includes(markerData.id)) {
        setTimeout(() => {
            const markerRoot = layer.getElement?.() as HTMLElement | null;
            const inner = markerRoot?.querySelector(`.${styles.markerInner}, .${styles.noFrameInner}`);
            if (inner) {
                syncMarkerTierAttribute(layer, markerData);
                inner.classList.add(styles.checked);
                syncMarkerCollectedStacking(layer, true);
            }
        }, 0);
    }
    
    return layer;
}
