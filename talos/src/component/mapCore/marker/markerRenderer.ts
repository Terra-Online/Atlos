import L, { divIcon } from 'leaflet';
import { IMarkerData, MARKER_TYPE_DICT } from '@/data/marker';

import { getItemIconUrl, getMarkerSubIconUrl } from '@/utils/resource';
import LOGGER from '@/utils/log';

import styles from './marker.module.scss';

export const MARKER_ICON_DICT = Object.values(MARKER_TYPE_DICT).reduce<
    Record<string, L.Icon | L.DivIcon>
>((acc, type) => {
    // Now, getItemIconUrl will return marker icon if key ends with _spot automatically
    const iconUrl = getItemIconUrl(type.key);
    if (type.noFrame) {
        acc[type.key] = divIcon({
            iconSize: [50, 50],
            iconAnchor: [25, 25],
            popupAnchor: [0, 0],
            tooltipAnchor: [0, 0],
            className: styles.noFrameMarkerIcon,
            html: `<div class="${styles.noFrameInner}"><img src="${iconUrl}" class="${styles.noFrameImage}" alt="${type.key}" /></div>`,
        });
    } else
        acc[type.key] = divIcon({
            // iconUrl,
            iconSize: [32, 32],
            iconAnchor: [16, 16],
            popupAnchor: [0, 0],
            tooltipAnchor: [0, 0],
            className: styles.FrameMarkerIcon,
            html: `<div class="${styles.markerInner}"><div class="${styles.FrameImage}" style="background-image: url(${iconUrl})"></div></div>`,
        });
    // Keep a shared class for outer and inner hierarchy should originally be a bug; but for the reason that leaflet will occupy the outer div's transform style when creating location index, I intentionally keep it this way therefore we can use a shared fall-back animation for inner div only.
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
        
        layer.addEventListener('click', (e) => {
            e.originalEvent.stopPropagation();
            
            // 获取 marker 的 DOM 元素
            const markerRoot = layer.getElement?.() as HTMLElement | null;
            const inner = markerRoot?.querySelector(`.${styles.markerInner}, .${styles.noFrameInner}`);
            if (inner) {
                const isSelected = inner.classList.contains(styles.selected);
                if (isSelected) {
                    // 已选中 → 取消选中
                    inner.classList.remove(styles.selected);
                } else {
                    // 未选中 → 添加选中状态
                    inner.classList.add(styles.selected);
                }
            }
            
            LOGGER.debug('marker clicked', markerData);
            onClick?.(markerData);
        });
        
        return layer;
    },
    sub_icon: (markerData, onClick) => {
        const layer = new L.Marker(markerData.position, {
            icon: MARKER_ICON_DICT[markerData.type],
            alt: markerData.type,
        });
        const sub = MARKER_TYPE_DICT[markerData.type].subIcon;
        layer
            .bindTooltip(
                `<div class="${styles.tooltipInner}" style="background-image:  url(${getMarkerSubIconUrl(sub)})"></div></div>`,
                {
                    permanent: true,
                    className: styles.customTooltip,
                    direction: 'right',
                },
            )
            .openTooltip();
            
        layer.addEventListener('click', (e) => {
            e.originalEvent.stopPropagation();
            
            // 获取 marker 的 DOM 元素
            const markerRoot = layer.getElement?.() as HTMLElement | null;
            const inner = markerRoot?.querySelector(`.${styles.markerInner}, .${styles.noFrameInner}`);
            if (inner) {
                const isSelected = inner.classList.contains(styles.selected);
                if (isSelected) {
                    // 已选中 → 取消选中
                    inner.classList.remove(styles.selected);
                } else {
                    // 未选中 → 添加选中状态
                    inner.classList.add(styles.selected);
                }
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
    
    // 添加 checked 类（如果已收集）
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
