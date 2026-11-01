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

const bearings = new WeakMap<L.Marker, number>();

export const setTrackerBearing = (marker: L.Marker, angleDeg: number): void => {
    const image = marker
        .getElement()
        ?.querySelector<HTMLElement>(`.${styles.trackerMarkerImage}`);
    if (!image || !Number.isFinite(angleDeg)) return;
    // CSS interpolates numeric angles, so unwrap the heading before crossing a full turn.
    const previous = bearings.get(marker) ?? angleDeg;
    const delta = ((angleDeg - previous) * Math.PI) / 180;
    const angle =
        previous +
        (Math.atan2(Math.sin(delta), Math.cos(delta)) * 180) / Math.PI;
    bearings.set(marker, angle);
    image.style.transform = `rotate(${angle}deg)`;
};
