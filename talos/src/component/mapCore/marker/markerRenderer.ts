import L, { divIcon } from 'leaflet';
import { IMarkerData, type IMarkerType, MARKER_TYPE_DICT } from '@/data/marker';

import { getItemIconUrl, getMarkerSubIconUrl } from '@/utils/resource';
import LOGGER from '@/utils/log';

import styles from './marker.module.scss';
import { useMarkerStore } from '@/store/marker';
import { getActivePoints, useUserRecordStore } from '@/store/userRecord';

export const MARKER_ICON_DICT = Object.values(MARKER_TYPE_DICT).reduce<
    Record<string, L.Icon | L.DivIcon>
>((acc, typeInfo: IMarkerType) => {
    // Now, getItemIconUrl will return marker icon if key ends with _spot automatically
    const iconUrl = getItemIconUrl(typeInfo.key, 'webp');
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
            iconAnchor: [16, 16],
            popupAnchor: [0, 0],
            tooltipAnchor: [0, 0],
            className: styles.FrameMarkerIcon,
            html: `<div class="${styles.markerInner}"><div class="${styles.FrameImage}" style="background-image: url(${iconUrl})"></div></div>`,
        });
    return acc;
}, {});

const RENDERER_DICT: Record<
    string,
    (
        markerData: IMarkerData,
        onClick?: (markerData: IMarkerData) => void,
    ) => L.Marker
> = {
    __DEFAULT: (markerData, onClick) => {
        const layer = new L.Marker(markerData.position, {
            icon: MARKER_ICON_DICT[markerData.type],
            alt: markerData.type,
        });

        // 初次添加到地图时，按存储状态渲染 selected/checked
        layer.on('add', () => {
            const markerRoot = layer.getElement?.() as HTMLElement | null;
            const inner = markerRoot?.querySelector(`.${styles.markerInner}, .${styles.noFrameInner}`);
            if (!inner) return;
            // entry fade-in
            inner.classList.add(styles.appearing);
            const { selectedPoints } = useMarkerStore.getState();
            const isSelected = selectedPoints.includes(markerData.id);
            if (isSelected) inner.classList.add(styles.selected);
            const collected = getActivePoints();
            if (collected.includes(markerData.id)) inner.classList.add(styles.checked);
            // next frame remove to trigger transition to final opacity (1 or 0.3 when checked)
            requestAnimationFrame(() => {
                inner.classList.remove(styles.appearing);
            });
        });
        
        layer.addEventListener('click', (e) => {
            e.originalEvent.stopPropagation();
            
            // 获取 marker 的 DOM 
            const markerRoot = layer.getElement?.() as HTMLElement | null;
            const inner = markerRoot?.querySelector(`.${styles.markerInner}, .${styles.noFrameInner}`);
            if (inner) {
                // 当前状态
                const selectedNow = useMarkerStore.getState().selectedPoints.includes(markerData.id);
                const checkedNow = getActivePoints().includes(markerData.id);
                
                // 目标状态：none -> selected -> selected+checked -> none
                if (!selectedNow && !checkedNow) {
                    // none -> selected
                    useMarkerStore.getState().setSelected(markerData.id, true);
                } else if (selectedNow && !checkedNow) {
                    // selected -> selected+checked
                    useUserRecordStore.getState().addPoint(markerData.id);
                } else {
                    // selected+checked 或日后其他组合 -> none
                    useUserRecordStore.getState().deletePoint(markerData.id);
                    useMarkerStore.getState().setSelected(markerData.id, false);
                }
                
                // 同步类名
                const selectedAfter = useMarkerStore.getState().selectedPoints.includes(markerData.id);
                const checkedAfter = getActivePoints().includes(markerData.id);
                inner.classList.toggle(styles.selected, selectedAfter);
                inner.classList.toggle(styles.checked, checkedAfter);
            }
            
            LOGGER.debug('marker clicked', markerData);
            onClick?.(markerData);
        });
        
        return layer;
    },
    sub_icon: (markerData, onClick) => {
        const sub = MARKER_TYPE_DICT[markerData.type].subIcon;
        const iconUrl = getItemIconUrl(markerData.type);
        const subIconUrl = getMarkerSubIconUrl(sub);
        
        // 将 subIcon 改为直接嵌入到 marker HTML 中，取消使用 Leaflet tooltip
        // + DOM 联动，CSS选择器控制样式
        // - 失去tooltip的高z轴，在点密集场景下会被覆盖
        // - 需要pointer-events: none 使 subIcon 不接收鼠标事件
        const markerIcon = divIcon({
            iconSize: [32, 32],
            iconAnchor: [16, 16],
            popupAnchor: [0, 0],
            tooltipAnchor: [0, 0],
            className: styles.FrameMarkerIcon,
            html: `<div class="${styles.markerInner}">
                       <div class="${styles.FrameImage}" style="background-image: url(${iconUrl})"></div>
                       <div class="${styles.subIconContainer}">
                           <div class="${styles.subIcon}" style="background-image: url(${subIconUrl})"></div>
                       </div>
                   </div>`,
        });
        
        const layer = new L.Marker(markerData.position, {
            icon: markerIcon,
            alt: markerData.type,
        });
        // 初次添加到地图时，按存储状态渲染 selected/checked（sub_icon）
        layer.on('add', () => {
            const markerRoot = layer.getElement?.() as HTMLElement | null;
            const inner = markerRoot?.querySelector(`.${styles.markerInner}, .${styles.noFrameInner}`);
            if (!inner) return;
            // entry fade-in
            inner.classList.add(styles.appearing);
            const { selectedPoints } = useMarkerStore.getState();
            const isSelected = selectedPoints.includes(markerData.id);
            if (isSelected) inner.classList.add(styles.selected);
            const collected = getActivePoints();
            if (collected.includes(markerData.id)) inner.classList.add(styles.checked);
            requestAnimationFrame(() => {
                inner.classList.remove(styles.appearing);
            });
        });
            
        layer.addEventListener('click', (e) => {
            e.originalEvent.stopPropagation();
            
            // 获取 marker 的 DOM 元素
            const markerRoot = layer.getElement?.() as HTMLElement | null;
            const inner = markerRoot?.querySelector(`.${styles.markerInner}, .${styles.noFrameInner}`);
            if (inner) {
                const selectedNow = useMarkerStore.getState().selectedPoints.includes(markerData.id);
                const checkedNow = getActivePoints().includes(markerData.id);
                
                if (!selectedNow && !checkedNow) {
                    useMarkerStore.getState().setSelected(markerData.id, true);
                } else if (selectedNow && !checkedNow) {
                    useUserRecordStore.getState().addPoint(markerData.id);
                } else {
                    useUserRecordStore.getState().deletePoint(markerData.id);
                    useMarkerStore.getState().setSelected(markerData.id, false);
                }
                const selectedAfter = useMarkerStore.getState().selectedPoints.includes(markerData.id);
                const checkedAfter = getActivePoints().includes(markerData.id);
                inner.classList.toggle(styles.selected, selectedAfter);
                inner.classList.toggle(styles.checked, checkedAfter);
            }
            
            LOGGER.debug('marker clicked', markerData);
            onClick?.(markerData);
        });

        return layer;
    },
};

export function getMarkerLayer(
    markerData: IMarkerData,
    onClick?: (markerData: IMarkerData) => void,
    collectedPoints?: string[],
) {
    const type = MARKER_TYPE_DICT[markerData.type];
    const layer = (() => {
        if (!type) {
            LOGGER.warn('marker type not found', markerData.type);
            return RENDERER_DICT['__DEFAULT'](markerData, onClick);
        }
        if (type.subIcon) {
            return RENDERER_DICT['sub_icon'](markerData, onClick);
        } else {
            return RENDERER_DICT['__DEFAULT'](markerData, onClick);
        }
    })();
    
    // add checked class (if collected)
    if (collectedPoints?.includes(markerData.id)) {
        setTimeout(() => {
            const markerRoot = layer.getElement?.() as HTMLElement | null;
            const inner = markerRoot?.querySelector(`.${styles.markerInner}, .${styles.noFrameInner}`);
            if (inner) {
                inner.classList.add(styles.checked);
            }
        }, 0);
    }
    
    return layer;
}
