import L from 'leaflet';
import trackerIconUrl from '@/assets/images/UI/icon_char.png';
import styles from './locatorMarker.module.scss';

export const createTrackerMarker = (pane: string, latLng: L.LatLng): L.Marker =>
    L.marker(latLng, {
        icon: L.divIcon({
            className: styles.trackerMarkerIcon,
            iconSize: [28, 28],
            iconAnchor: [14, 14],
            html: `<div class="${styles.trackerMarkerInner} ${styles.pulsing}"><img class="${styles.trackerMarkerImage}" src="${trackerIconUrl}" width="28" height="28" alt="" decoding="async" /></div>`,
        }),
        pane,
        keyboard: false,
        interactive: false,
        zIndexOffset: 900,
    });

export const setTrackerBearing = (marker: L.Marker, angleDeg: number): void => {
    const image = marker
        .getElement()
        ?.querySelector<HTMLElement>(`.${styles.trackerMarkerImage}`);
    if (image) image.style.transform = `rotate(${angleDeg}deg)`;
};
