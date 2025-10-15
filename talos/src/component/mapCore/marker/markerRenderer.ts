import L, { divIcon, icon } from 'leaflet';
import { IMarkerData, MARKER_TYPE_DICT } from '@/data/marker';

import { getItemIconUrl, getMarkerSubIconUrl } from '@/utils/resource';
import LOGGER from '@/utils/log';

import styles from './marker.module.scss';

// const DEFAULT_ICON = divIcon({
//     iconSize: [50, 50],
//     iconAnchor: [25, 25],
//     popupAnchor: [0, 0],
//     className: styles.customMarkerIcon,
//     html: `<div class=\"${styles.defaultMarkerIcon}\"></div>`
// })

export const MARKER_ICON_DICT = Object.values(MARKER_TYPE_DICT).reduce<
    Record<string, L.Icon | L.DivIcon>
>((acc, type) => {
    // change this to remove default icon
    // if (!type.key.endsWith("spot")) {
    //     acc[type.key] = DEFAULT_ICON
    //     return acc
    // }
    // Now, getItemIconUrl will return marker icon if key ends with _spot automatically
    const iconUrl = getItemIconUrl(type.key);
    if (type.noFrame) {
        acc[type.key] = icon({
            iconUrl,
            iconSize: [60, 60],
            iconAnchor: [30, 30],
            popupAnchor: [0, 0],
            tooltipAnchor: [0, 0],
        });
    } else
        acc[type.key] = divIcon({
            // iconUrl,
            iconSize: [32, 32],
            iconAnchor: [16, 16],
            popupAnchor: [0, 0],
            tooltipAnchor: [0, 0],
            className: styles.customMarkerIcon,
            html: `<div class="${styles.markerInner}"><div class="${styles.customMarkerIcon}" style="background-image: url(${iconUrl})"></div></div>`,
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
        layer.addEventListener('click', (e) => {
            e.originalEvent.stopPropagation();
            // TODO 实现切换当前marker功能
            // useMarkerStore.setState({currentActivePoint: markerData})
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
                `<div class="${styles.tooltipInner}"><div class="${styles.bg}"></div><div class="${styles.image}"  style="background-image:  url(${getMarkerSubIconUrl(sub)})"></div></div>`,
                {
                    permanent: true,
                    className: styles.customTooltip,
                    direction: 'right',
                },
            )
            .openTooltip();
        layer.addEventListener('click', (e) => {
            e.originalEvent.stopPropagation();
            // TODO 实现切换当前marker功能
            // useMarkerStore.setState({currentActivePoint: markerData})
            LOGGER.debug('marker clicked', markerData);
            onClick?.(markerData);
        });

        return layer;
    },
};

export function getMarkerLayer(
    markerData: IMarkerData,
    onClick?: (markerData: IMarkerData) => void,
) {
    const type = MARKER_TYPE_DICT[markerData.type];
    if (!type) {
        LOGGER.warn('marker type not found', markerData.type);
        return RENDERER_DICT['__DEFAULT'](markerData, onClick);
    }
    if (type.subIcon) {
        return RENDERER_DICT['sub_icon'](markerData, onClick);
    } else {
        return RENDERER_DICT['__DEFAULT'](markerData, onClick);
    }
}
