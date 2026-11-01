import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { REGION_DICT } from '@/data/map';
import { findMarkerById, MARKER_TYPE_DICT } from '@/data/marker';
import { createMapTileLayer } from '@/services/map/core/tileLayer';
import { resolveTileSource } from '@/services/map/tileCoverage';
import type { TileSource } from '@/services/assets/resource';
import {
    prepareContinuousMap,
    setContinuousView,
} from '@/services/map/core/continuousView';
import { createMarkerIcon } from '@/services/map/core/marker/markerIcon';
import { MarkerPainter } from '@/services/map/core/canvas/canvasMarkerPaint';
import { MarkerMotionPool } from '@/services/map/core/canvas/canvasMarkerMotion';
import { scheduleMinimap } from './minimap-scheduler';
import { MinimapZoom, ZoomTransition } from './minimap-zoom';
import {
    createTrackerMarker,
    setTrackerBearing,
    stopTrackerPulse,
} from '@/services/map/locatorMarker';
import { convertEFPosition } from '@/services/endfield/locatorTransform';
import {
    getLayerByTier,
    getLayerTileSuffix,
    useLayerStore,
} from '@/store/layer';
import { type Point, type CameraSample } from '@/services/noclip/types';
import {
    minimapZoom,
    minimapBearing,
    targetEdge,
} from '@/services/noclip/view';

export type Sample = CameraSample & { tracking: boolean; target: Point | null };
export function createMinimap(element: HTMLElement) {
    const map = prepareContinuousMap(
        L.map(element, {
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
            zoomSnap: 0,
            minZoom: 0,
        }),
    );
    map.createPane('locator').style.zIndex = '900';
    const tileLayer = (region: string, source: TileSource, suffix: string) =>
        createMapTileLayer(region, source, suffix, 5).addTo(map);
    const zoomBands = new MinimapZoom();
    const zoomTransition = new ZoomTransition();
    const tracker = createTrackerMarker('locator', L.latLng(0, 0));
    let target: L.Marker | null = null,
        targetPoint: Point | null = null,
        targetPosition: L.LatLng | null = null;
    let targetOffset = L.point(0, 0);
    let disposeArtwork: (() => void) | null = null;
    const placeTarget = (center = map.getCenter(), zoom = map.getZoom()) => {
        if (!target || !targetPosition) return;
        const half = map.getSize().divideBy(2);
        const origin = map.project(center, zoom).subtract(half);
        const point = map
            .project(targetPosition, zoom)
            .subtract(origin)
            .add(targetOffset);
        const edge = targetEdge(point, map.getSize());
        const location = edge
            ? map.unproject(
                  L.point(edge.x, edge.y).subtract(targetOffset).add(origin),
                  zoom,
              )
            : targetPosition;
        if (!target.getLatLng().equals(location)) target.setLatLng(location);
    };
    let tiles: L.TileLayer[] = [],
        sceneKey = '';
    let readCamera: (() => Sample | null) | null = null,
        previousCamera: CameraSample | null = null,
        cursorMoved = false,
        unitsPerMeter = 1;
    let scalePoint: Point | null = null;
    const position = (point: Point, v: readonly number[]) =>
        convertEFPosition({
            mapId: point.scene,
            levelId: point.level,
            pos: { x: v[0], y: v[1], z: v[2] },
            isOnline: true,
        });
    const draw = () => {
        const d = readCamera?.();
        if (!d || !Object.hasOwn(REGION_DICT, d.point.region)) return;
        const point = d.point,
            forwardVector = d.forward,
            region = REGION_DICT[point.region];
        if (!region) return;
        const p = position(point, d.position);
        const floor = getLayerByTier(point.tier) ?? 'M';
        const source = resolveTileSource(
            point.region,
            floor,
            useLayerStore.getState().satellite,
        );
        const key = `${point.region}/${point.tier}/${source}`;
        if (sceneKey !== key) {
            tiles.forEach((tile) => tile.remove());
            tiles = [tileLayer(point.region, source, '')];
            if (floor && floor !== 'M')
                tiles.push(
                    tileLayer(point.region, 'clips', getLayerTileSuffix(floor)),
                );
            sceneKey = key;
        }
        if (scalePoint !== point) {
            const t = position(point, point.position),
                x = position(point, [
                    point.position[0] + 1,
                    point.position[1],
                    point.position[2],
                ]),
                z = position(point, [
                    point.position[0],
                    point.position[1],
                    point.position[2] + 1,
                ]);
            unitsPerMeter = Math.max(
                Math.hypot(x.mapX - t.mapX, x.mapZ - t.mapZ),
                Math.hypot(z.mapX - t.mapX, z.mapZ - t.mapZ),
            );
            scalePoint = point;
        }
        if (!d.target) {
            target?.remove();
            disposeArtwork?.();
            disposeArtwork = null;
            target = null;
            targetPoint = null;
        } else if (targetPoint?.id !== d.target.id) {
            const goal = d.target;
            const t = position(goal, goal.position);
            targetPosition = L.latLng(t.mapZ, t.mapX);
            targetPoint = goal;
            target?.remove();
            disposeArtwork?.();
            disposeArtwork = null;
            target = null;
            void findMarkerById(goal.id)
                .then((marker) => {
                    // A newer target or page teardown may arrive while its data loads.
                    if (targetPoint !== goal || !marker) return;
                    const type = MARKER_TYPE_DICT[marker.type];
                    if (!type) return;
                    const icon = createMarkerIcon(type);
                    const size = L.point(icon.options.iconSize ?? [32, 32]);
                    const anchor = L.point(
                        icon.options.iconAnchor ?? size.divideBy(2),
                    );
                    targetOffset = size.divideBy(2).subtract(anchor);
                    // One passive icon does not need the main map's full-viewport
                    // WebGL surface, hit index, animation loop or font observers.
                    const holder = document.createElement('div');
                    const pool = new MarkerMotionPool();
                    const motion = pool.transition(
                        pool.initial,
                        0,
                        0,
                        icon.art.noFrame,
                        false,
                    );
                    const painter = new MarkerPainter(
                        Math.ceil(Math.max(2, window.devicePixelRatio || 1)),
                        () => paint(),
                    );
                    const paint = () => {
                        const sprite = painter.sprite(icon.art, motion, 0);
                        sprite.canvas.style.cssText = `position:absolute;left:${sprite.x}px;top:${sprite.y}px;width:${sprite.width}px;height:${sprite.height}px;`;
                        holder.replaceChildren(sprite.canvas);
                    };
                    disposeArtwork = () => painter.dispose();
                    paint();
                    target = L.marker([t.mapZ, t.mapX], {
                        icon: L.divIcon({
                            className: 'oem-minimap-target',
                            html: holder,
                            iconSize: [0, 0],
                            iconAnchor: [0, 0],
                        }),
                        interactive: false,
                        keyboard: false,
                    }).addTo(map);
                    placeTarget();
                })
                .catch((error: unknown) => {
                    console.error('Unable to load preview target icon', error);
                });
        }
        const size = map.getSize();
        const idealZoom = d.view
            ? minimapZoom({
                  altitude: d.position[1] - d.view.groundY,
                  down: -forwardVector[1],
                  fovY: d.view.fovY,
                  aspect: d.view.aspect,
                  width: size.x,
                  height: size.y,
                  unitsPerMeter,
              })
            : 3;
        const context = `${point.scene}/${point.level}/${point.tier}`;
        const zoom = zoomTransition.update(
            zoomBands.update(idealZoom, context),
            context,
            performance.now(),
        );
        const center = L.latLng(p.mapZ, p.mapX);
        // Position the pin and map from the same sample before the browser paints.
        placeTarget(center, zoom);
        setContinuousView(map, center, zoom);
        if (!d.tracking) {
            tracker.remove();
            previousCamera = null;
            return zoomTransition.active;
        }
        if (!map.hasLayer(tracker)) {
            tracker.addTo(map);
            if (cursorMoved) stopTrackerPulse(tracker);
        }
        const cameraPosition = L.latLng(p.mapZ, p.mapX);
        if (!tracker.getLatLng().equals(cameraPosition))
            tracker.setLatLng(cameraPosition);
        const previous = previousCamera;
        if (
            !cursorMoved &&
            previous &&
            (d.position.some(
                (v, i) => Math.abs(v - previous.position[i]) > 1e-5,
            ) ||
                d.forward.some(
                    (v, i) => Math.abs(v - previous.forward[i]) > 1e-5,
                ))
        ) {
            stopTrackerPulse(tracker);
            cursorMoved = true;
        }
        previousCamera = d;
        const horizontal = Math.hypot(forwardVector[0], forwardVector[2]);
        if (horizontal > 1e-6) {
            const forward = position(point, [
                d.position[0] + forwardVector[0] / horizontal,
                d.position[1],
                d.position[2] + forwardVector[2] / horizontal,
            ]);
            const bearing = minimapBearing(p, forward);
            if (bearing !== null) setTrackerBearing(tracker, bearing);
        }
        return zoomTransition.active;
    };
    const scheduler = scheduleMinimap(draw);
    const schedule = scheduler.request;
    const stopLayer = useLayerStore.subscribe((state, previous) => {
        if (state.satellite !== previous.satellite) schedule();
    });
    const syncLayer = (event: StorageEvent) => {
        if (event.key === 'atlos-layer-storage')
            void useLayerStore.persist.rehydrate();
    };
    window.addEventListener('storage', syncLayer);
    const resize = new ResizeObserver(() => {
        map.invalidateSize({ animate: false });
        if (readCamera) schedule();
    });
    resize.observe(element);
    return {
        update(read: () => Sample | null) {
            readCamera = read;
            schedule();
        },
        destroy() {
            stopLayer();
            window.removeEventListener('storage', syncLayer);
            targetPoint = null;
            scheduler.destroy();
            disposeArtwork?.();
            resize.disconnect();
            map.remove();
        },
    };
}
