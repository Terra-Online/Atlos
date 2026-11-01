import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './style.css';
import { REGION_DICT } from '@/data/map';
import { findMarkerById, MARKER_TYPE_DICT } from '@/data/marker';
import { createMapTileLayer } from '@/services/map/core/tileLayer';
import { createMarkerIcon } from '@/services/map/core/marker/markerIcon';
import { ViewportMarker } from '@/services/map/core/canvas/markerViewport';
import { setMarkerState } from '@/services/map/core/canvas/markerModel';
import {
    createTrackerMarker,
    setTrackerBearing,
} from '@/services/map/locatorMarker';
import { convertEFPosition } from '@/services/endfield/locatorTransform';
import { getLayerByTier, getLayerTileSuffix } from '@/store/layer';
import {
    isPoint,
    isPreviewOrigin,
    record,
    vector,
    VERSION,
    type Point,
} from '@/services/noclip/types';

const parameters = new URL(location.href).searchParams;
const origin = parameters.get('previewOrigin') || '';
const session = parameters.get('session') || '';
const element = document.getElementById('map')!;
if (isPreviewOrigin(origin) && window.parent !== window) {
    const map = L.map(element, {
        crs: L.CRS.Simple,
        zoomControl: false,
        attributionControl: false,
        dragging: false,
        touchZoom: false,
        boxZoom: false,
        keyboard: false,
        doubleClickZoom: false,
        scrollWheelZoom: false,
        zoomAnimation: false,
        fadeAnimation: false,
    });
    map.createPane('locator').style.zIndex = '900';
    const tracker = createTrackerMarker('locator', L.latLng(0, 0));
    let target: ViewportMarker | null = null,
        targetPoint: Point | null = null;
    let tiles: L.TileLayer[] = [],
        sceneKey = '';
    const position = (point: Point, v: readonly number[]) =>
        convertEFPosition({
            mapId: point.scene,
            levelId: point.level,
            pos: { x: v[0], y: v[1], z: v[2] },
            isOnline: true,
        });
    const receive = (event: MessageEvent<unknown>) => {
        const d = event.data;
        if (
            event.origin !== origin ||
            event.source !== window.parent ||
            !record(d) ||
            d.version !== VERSION ||
            d.session !== session ||
            d.type !== 'camera' ||
            !isPoint(d.point) ||
            !vector(d.position) ||
            !vector(d.forward)
        )
            return;
        const point = d.point,
            forwardVector = d.forward,
            region = REGION_DICT[point.region];
        if (!region) return;
        const p = position(point, d.position),
            t = position(point, point.position);
        const key = `${point.region}/${point.tier}`;
        if (sceneKey !== key) {
            tiles.forEach((tile) => tile.remove());
            tiles = [
                createMapTileLayer(point.region, 'clips', '', 4).addTo(map),
            ];
            const floor = getLayerByTier(point.tier);
            if (floor && floor !== 'M')
                tiles.push(
                    createMapTileLayer(
                        point.region,
                        'clips',
                        getLayerTileSuffix(floor),
                        4,
                    ).addTo(map),
                );
            sceneKey = key;
        }
        map.setView([p.mapZ, p.mapX], 3, { animate: false });
        if (!map.hasLayer(tracker)) {
            tracker.addTo(map);
        }
        tracker.setLatLng([p.mapZ, p.mapX]);
        if (targetPoint?.id !== point.id) {
            targetPoint = point;
            target?.remove();
            target = null;
            void findMarkerById(point.id).then((marker) => {
                // A newer target or page teardown may arrive while its data loads.
                if (targetPoint !== point || !marker) return;
                const type = MARKER_TYPE_DICT[marker.type];
                if (!type) return;
                target = new ViewportMarker([t.mapZ, t.mapX], {
                    icon: createMarkerIcon(type),
                    interactive: false,
                    keyboard: false,
                }).addTo(map);
                setMarkerState(target, { pulsing: true });
            }).catch((error: unknown) => {
                console.error('Unable to load preview target icon', error);
            });
        }
        target?.setLatLng([t.mapZ, t.mapX]);
        const forward = position(
            point,
            d.position.map((v, i) => v + forwardVector[i]),
        );
        const a = map.latLngToLayerPoint([p.mapZ, p.mapX]),
            b = map.latLngToLayerPoint([forward.mapZ, forward.mapX]);
        setTrackerBearing(
            tracker,
            (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI + 90,
        );
    };
    window.addEventListener('message', receive);
    new ResizeObserver(() => map.invalidateSize({ animate: false })).observe(
        element,
    );
    window.parent.postMessage(
        { version: VERSION, session, type: 'minimap-ready' },
        origin,
    );
    window.addEventListener(
        'pagehide',
        () => {
            targetPoint = null;
            window.removeEventListener('message', receive);
            map.remove();
        },
        { once: true },
    );
}
