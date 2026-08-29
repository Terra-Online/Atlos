/**
 * TalosMap — MapLibre-backed map whose public API speaks the game's
 * CRS.Simple coordinate semantics (see coords.ts). Replaces L.Map for all
 * consumers: same lat/lng values, same (fractional) zoom numbers, same event
 * names, so persisted view states and game data stay valid.
 */
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import './talos-map.scss';

import {
    TILE_ZOOM_OFFSET,
    createRegionTransform,
    createTileUrlRewriter,
    gameToLngLat,
    lngLatToGame,
    pxBoundsToLngLatBounds,
    zoomFromMapLibre,
    zoomToMapLibre,
    type RegionTransform,
} from './coords';
import { LatLng, LatLngBounds, toLatLng, toLatLngBounds, type LatLngBoundsExpression, type LatLngExpression } from './latlng';
import { Point, toPoint } from './point';
import type { CompatLayer, OverlayHost } from './overlay';

const TILE_SOURCE_MAIN = 'talos-tiles-main';
const TILE_SOURCE_LAYER = 'talos-tiles-layer';
const TILE_LAYER_MAIN = 'talos-tiles-main';
const TILE_LAYER_OVERLAY = 'talos-tiles-layer';

/** 1x1 transparent webp, used to silence 404s for tiles outside coverage. */
const EMPTY_TILE_DATA_URL =
    'data:image/webp;base64,UklGRhYAAABXRUJQVlA4TAoAAAAvAAAAAP8B/wE=';

const BLANK_STYLE: maplibregl.StyleSpecification = {
    version: 8,
    sources: {},
    layers: [],
};

export interface TalosMapOptions {
    /** Game zoom units. */
    minZoom?: number;
    maxZoom?: number;
}
/** Mouse event payload emitted by TalosMap (game-unit coordinates). */
export interface TalosMouseEvent {
    originalEvent: MouseEvent;
    latlng: LatLng;
    containerPoint: Point;
}

interface SetViewOptions {
    animate?: boolean;
    duration?: number;
}

export class TalosMap implements OverlayHost {
    readonly ml: maplibregl.Map;

    /** Leaflet-compatible mutable options bag (maxBounds in game units). */
    readonly options: { maxBounds: LatLngBounds | null } = {
        maxBounds: null,
    };

    private transform: RegionTransform | null = null;
    private readonly regionTransforms = new Map<string, RegionTransform>();

    private readonly container: HTMLElement;
    private readonly overlayRoot: HTMLElement;
    private readonly panes = new Map<string, HTMLElement>();
    private readonly renderCallbacks = new Set<() => void>();
    private readonly attachedLayers = new Set<CompatLayer>();
    private readonly listeners = new Map<string, Set<(event?: unknown) => void>>();

    /** Custom-gesture suppression: raw start/end camera events are coalesced
     *  into one pair per gesture (see gestures.ts). */
    private gestureDepth = 0;
    private gestureZoomStarted = false;

    /** Game-unit zoom constraints queued before the first region activation. */
    private pendingMinZoom: number | null = null;
    private pendingMaxZoom: number | null = null;

    readonly dragging = {
        enable: () => this.dragController?.setEnabled(true),
        disable: () => this.dragController?.setEnabled(false),
        isEnabled: () => this.dragController?.isEnabled() ?? false,
    };

    /** Custom drag pan controller, installed by enableSmoothGestures. */
    private dragController?: {
        setEnabled(enabled: boolean): void;
        isEnabled(): boolean;
    };

    setDragController(controller: {
        setEnabled(enabled: boolean): void;
        isEnabled(): boolean;
    }): void {
        this.dragController = controller;
    }

    /** Present for API parity; box zoom is always disabled. */
    readonly boxZoom = { disable: () => undefined, enable: () => undefined };
    /** Scroll wheel zoom is owned by gestures.ts; keep disable() as no-op. */
    readonly scrollWheelZoom = { disable: () => undefined, enable: () => undefined };

    constructor(element: HTMLDivElement, options: TalosMapOptions = {}) {
        this.container = element;
        element.classList.add('leaflet-container');

        this.ml = new maplibregl.Map({
            container: element,
            style: BLANK_STYLE,
            attributionControl: false,
            // Camera starts detached from any region; MapCore positions it on
            // the first region switch.
            center: [0, 0],
            zoom: 0,
            minZoom: 0,
            maxZoom: 22,
            renderWorldCopies: false,
            dragRotate: false,
            dragPan: false, // DragPanController (gestures.ts) owns drag panning
            boxZoom: false,
            doubleClickZoom: false,
            keyboard: false,
            scrollZoom: false, // gestures.ts owns the wheel
            maxPitch: 0,
            minPitch: 0,
            transformRequest: (url) => ({
                url: this.tileUrlRewriter(url) ?? url,
            }),
        });
        this.ml.touchZoomRotate.disableRotation();

        this.tileUrlRewriter = createTileUrlRewriter(() =>
            Object.fromEntries(this.regionTransforms),
        );

        this.overlayRoot = document.createElement('div');
        this.overlayRoot.classList.add('talos-overlay-root');
        this.overlayRoot.style.position = 'absolute';
        this.overlayRoot.style.inset = '0';
        this.overlayRoot.style.overflow = 'hidden';
        this.overlayRoot.style.pointerEvents = 'none';
        // Stacking contract: container ::before grid (z1) < canvas (z2) < overlay (z3).
        this.overlayRoot.style.zIndex = '3';
        element.appendChild(this.overlayRoot);

        // maplibre v6 leaves the canvas container position:static, which voids
        // z-index — set it inline so the grid pattern never paints above tiles.
        const canvasContainer = element.querySelector<HTMLElement>(
            '.maplibregl-canvas-container',
        );
        if (canvasContainer) {
            canvasContainer.style.position = 'absolute';
            canvasContainer.style.inset = '0';
            canvasContainer.style.zIndex = '2';
        }

        // Leaflet-equivalent default panes.
        this.createPane('tilePane', 200);
        this.createPane('overlayPane', 400);
        this.createPane('markerPane', 600);
        this.createPane('tooltipPane', 650);

        this.wireEvents();

        this.ml.on('render', () => {
            this.renderCallbacks.forEach((callback) => callback());
        });

        if (options.minZoom !== undefined) this.pendingMinZoom = options.minZoom;
        if (options.maxZoom !== undefined) this.pendingMaxZoom = options.maxZoom;
    }

    private readonly tileUrlRewriter: (url: string) => string;

    // -- regions / tiles ------------------------------------------------------

    /** Register (idempotently) the coordinate transform of a region. */
    registerRegion(regionId: string, config: Parameters<typeof createRegionTransform>[0]): RegionTransform {
        let transform = this.regionTransforms.get(regionId);
        if (!transform) {
            transform = createRegionTransform(config);
            this.regionTransforms.set(regionId, transform);
        }
        return transform;
    }

    /** Activate a region transform. All subsequent coordinate conversions use it. */
    activateRegion(regionId: string): RegionTransform {
        const transform = this.regionTransforms.get(regionId);
        if (!transform) {
            throw new Error(`Region not registered: ${regionId}`);
        }
        this.transform = transform;
        if (this.pendingMinZoom !== null) {
            this.ml.setMinZoom(zoomToMapLibre(transform, this.pendingMinZoom));
        }
        if (this.pendingMaxZoom !== null) {
            this.ml.setMaxZoom(zoomToMapLibre(transform, this.pendingMaxZoom));
        }
        return transform;
    }

    getRegionTransform(): RegionTransform {
        if (!this.transform) {
            throw new Error('No active region transform; call activateRegion first');
        }
        return this.transform;
    }

    /** Style-load gate: addSource/addLayer throw before the style is ready.
     *  Region switches can race page load, so tile ops are queued. */
    private styleReadyQueue: Array<() => void> = [];
    private styleReady = false;

    private whenStyleReady(fn: () => void): void {
        if (this.styleReady || this.ml.isStyleLoaded()) {
            this.styleReady = true;
            fn();
            return;
        }
        this.styleReadyQueue.push(fn);
        this.ml.once('load', () => {
            this.styleReady = true;
            this.styleReadyQueue.splice(0).forEach((queued) => queued());
        });
    }

    /**
     * Install the tile pyramid of a region as the base raster layer, and
     * optionally a floor-layer variant on top of it.
     */
    setTiles(options: {
        mainUrlTemplate: string;
        layerUrlTemplate?: string | null;
        boundsPx: { min: [number, number]; max: [number, number] };
    }): void {
        this.whenStyleReady(() => this.installTiles(options));
    }

    private installTiles(options: {
        mainUrlTemplate: string;
        layerUrlTemplate?: string | null;
        boundsPx: { min: [number, number]; max: [number, number] };
    }): void {
        this.removeTiles();
        const transform = this.getRegionTransform();
        const bounds = pxBoundsToLngLatBounds(
            transform,
            options.boundsPx.min[0],
            options.boundsPx.min[1],
            options.boundsPx.max[0],
            options.boundsPx.max[1],
        );
        const tileZoom = transform.maxZoom + TILE_ZOOM_OFFSET;

        this.ml.addSource(TILE_SOURCE_MAIN, {
            type: 'raster',
            tiles: [options.mainUrlTemplate],
            tileSize: transform.tileSize,
            minzoom: TILE_ZOOM_OFFSET,
            maxzoom: tileZoom,
            bounds,
        });
        this.ml.addLayer({
            id: TILE_LAYER_MAIN,
            type: 'raster',
            source: TILE_SOURCE_MAIN,
            paint: {
                // Smooth the floor-layer dimming (was a CSS filter transition).
                'raster-brightness-max-transition': { duration: 300 },
            },
        });

        if (options.layerUrlTemplate) {
            this.ml.addSource(TILE_SOURCE_LAYER, {
                type: 'raster',
                tiles: [options.layerUrlTemplate],
                tileSize: transform.tileSize,
                minzoom: TILE_ZOOM_OFFSET,
                maxzoom: tileZoom,
                bounds,
            });
            this.ml.addLayer({
                id: TILE_LAYER_OVERLAY,
                type: 'raster',
                source: TILE_SOURCE_LAYER,
            });
        }
    }

    /** Add/replace/remove the floor-variant raster layer (main tiles untouched). */
    setLayerTiles(
        urlTemplate: string | null,
        boundsPx: { min: [number, number]; max: [number, number] },
    ): void {
        this.whenStyleReady(() => {
            if (this.ml.getLayer(TILE_LAYER_OVERLAY)) this.ml.removeLayer(TILE_LAYER_OVERLAY);
            if (this.ml.getSource(TILE_SOURCE_LAYER)) this.ml.removeSource(TILE_SOURCE_LAYER);
            if (!urlTemplate) return;
            this.installLayerTiles(urlTemplate, boundsPx);
        });
    }

    private installLayerTiles(
        urlTemplate: string,
        boundsPx: { min: [number, number]; max: [number, number] },
    ): void {
        const transform = this.getRegionTransform();
        const bounds = pxBoundsToLngLatBounds(
            transform,
            boundsPx.min[0],
            boundsPx.min[1],
            boundsPx.max[0],
            boundsPx.max[1],
        );
        this.ml.addSource(TILE_SOURCE_LAYER, {
            type: 'raster',
            tiles: [urlTemplate],
            tileSize: transform.tileSize,
            minzoom: TILE_ZOOM_OFFSET,
            maxzoom: transform.maxZoom + TILE_ZOOM_OFFSET,
            bounds,
        });
        this.ml.addLayer({
            id: TILE_LAYER_OVERLAY,
            type: 'raster',
            source: TILE_SOURCE_LAYER,
        });
    }

    removeTiles(): void {
        this.whenStyleReady(() => {
            if (this.ml.getLayer(TILE_LAYER_OVERLAY)) this.ml.removeLayer(TILE_LAYER_OVERLAY);
            if (this.ml.getLayer(TILE_LAYER_MAIN)) this.ml.removeLayer(TILE_LAYER_MAIN);
            if (this.ml.getSource(TILE_SOURCE_LAYER)) this.ml.removeSource(TILE_SOURCE_LAYER);
            if (this.ml.getSource(TILE_SOURCE_MAIN)) this.ml.removeSource(TILE_SOURCE_MAIN);
        });
    }

    /** Dim the base tiles when a floor layer is active (Leaflet CSS filter parity). */
    setMainTilesDimmed(dimmed: boolean): void {
        this.whenStyleReady(() => {
            if (!this.ml.getLayer(TILE_LAYER_MAIN)) return;
            this.ml.setPaintProperty(
                TILE_LAYER_MAIN,
                'raster-brightness-max',
                dimmed ? 0.5 : 1,
            );
        });
    }

    /** Resolves once all currently-visible tiles finished loading. */
    waitForTilesLoaded(): Promise<void> {
        // Executor form: tsconfig lib predates Promise.withResolvers (es2024).
        return new Promise((resolve) => {
            let resolved = false;
            const done = () => {
                if (resolved) return;
                resolved = true;
                this.ml.off('idle', done);
                window.clearTimeout(safetyTimer);
                resolve();
            };
            const safetyTimer = window.setTimeout(done, 3000);
            this.ml.once('idle', done);
            // No tiles may be needed at all (empty viewport coverage); resolve
            // immediately in that case, mirroring the Leaflet microtask fallback.
            queueMicrotask(() => {
                if (this.ml.loaded() && !this.ml.isMoving()) done();
            });
        });
    }

    // -- coordinate conversion (game semantics) --------------------------------

    project(value: LatLngExpression, zoom: number): Point {
        const latlng = toLatLng(value);
        const scale = 2 ** zoom;
        return new Point(latlng.lng * scale, -latlng.lat * scale);
    }

    unproject(pointValue: Point | [number, number], zoom: number): LatLng {
        const point = toPoint(pointValue as [number, number]);
        const scale = 2 ** zoom;
        return new LatLng(-point.y / scale, point.x / scale);
    }

    latLngToContainerPoint(value: LatLngExpression): Point {
        const latlng = toLatLng(value);
        const lngLat = gameToLngLat(this.getRegionTransform(), latlng.lat, latlng.lng);
        const point = this.ml.project([lngLat.lng, lngLat.lat]);
        return new Point(point.x, point.y);
    }

    containerPointToLatLng(pointValue: Point | [number, number]): LatLng {
        const point = toPoint(pointValue as [number, number]);
        const lngLat = this.ml.unproject([point.x, point.y]);
        const game = lngLatToGame(this.getRegionTransform(), lngLat.lng, lngLat.lat);
        return new LatLng(game.lat, game.lng);
    }

    /** Overlay panes sit at the container origin, so layer == container space. */
    latLngToLayerPoint(value: LatLngExpression): Point {
        return this.latLngToContainerPoint(value);
    }

    mouseEventToContainerPoint(event: MouseEvent | WheelEvent): Point {
        const rect = this.container.getBoundingClientRect();
        return new Point(event.clientX - rect.left, event.clientY - rect.top);
    }

    mouseEventToLatLng(event: MouseEvent | WheelEvent): LatLng {
        return this.containerPointToLatLng(this.mouseEventToContainerPoint(event));
    }

    // -- camera -----------------------------------------------------------------

    getCenter(): LatLng {
        const center = this.ml.getCenter();
        const game = lngLatToGame(this.getRegionTransform(), center.lng, center.lat);
        return new LatLng(game.lat, game.lng);
    }

    getZoom(): number {
        return zoomFromMapLibre(this.getRegionTransform(), this.ml.getZoom());
    }

    getMinZoom(): number {
        return zoomFromMapLibre(this.getRegionTransform(), this.ml.getMinZoom());
    }

    getMaxZoom(): number {
        return zoomFromMapLibre(this.getRegionTransform(), this.ml.getMaxZoom());
    }

    setMinZoom(zoom: number): this {
        this.pendingMinZoom = zoom;
        if (this.transform) {
            this.ml.setMinZoom(zoomToMapLibre(this.transform, zoom));
        }
        return this;
    }

    setMaxZoom(zoom: number): this {
        this.pendingMaxZoom = zoom;
        if (this.transform) {
            this.ml.setMaxZoom(zoomToMapLibre(this.transform, zoom));
        }
        return this;
    }

    setView(center: LatLngExpression, zoom: number, options?: SetViewOptions): this {
        const latlng = toLatLng(center);
        const lngLat = gameToLngLat(this.getRegionTransform(), latlng.lat, latlng.lng);
        const camera = {
            center: [lngLat.lng, lngLat.lat] as [number, number],
            zoom: zoomToMapLibre(this.getRegionTransform(), zoom),
        };
        if (options?.animate === false) {
            this.ml.jumpTo(camera);
            this.enforceCenterBounds();
        } else {
            this.cameraAnimating = true;
            this.ml.easeTo({ ...camera, duration: options?.duration ?? 300 });
        }
        return this;
    }

    setZoom(zoom: number, options?: SetViewOptions): this {
        const target = zoomToMapLibre(this.getRegionTransform(), zoom);
        if (options?.animate === false) {
            this.ml.jumpTo({ zoom: target });
            this.enforceCenterBounds();
        } else {
            this.cameraAnimating = true;
            this.ml.easeTo({ zoom: target, duration: options?.duration ?? 300 });
        }
        return this;
    }

    zoomIn(delta = 1, options?: SetViewOptions): this {
        return this.setZoom(this.getZoom() + delta, options);
    }

    zoomOut(delta = 1, options?: SetViewOptions): this {
        return this.setZoom(this.getZoom() - delta, options);
    }

    flyTo(
        center: LatLngExpression,
        zoom?: number,
        options?: { animate?: boolean; duration?: number },
    ): this {
        const latlng = toLatLng(center);
        const lngLat = gameToLngLat(this.getRegionTransform(), latlng.lat, latlng.lng);
        this.cameraAnimating = true;
        this.ml.flyTo({
            center: [lngLat.lng, lngLat.lat],
            zoom:
                zoom !== undefined
                    ? zoomToMapLibre(this.getRegionTransform(), zoom)
                    : this.ml.getZoom(),
            duration: (options?.duration ?? 1) * 1000,
        });
        return this;
    }

    panTo(center: LatLngExpression, options?: SetViewOptions): this {
        const latlng = toLatLng(center);
        const lngLat = gameToLngLat(this.getRegionTransform(), latlng.lat, latlng.lng);
        if (options?.animate === false) {
            this.ml.jumpTo({ center: [lngLat.lng, lngLat.lat] });
            this.enforceCenterBounds();
        } else {
            this.cameraAnimating = true;
            this.ml.easeTo({
                center: [lngLat.lng, lngLat.lat],
                duration: (options?.duration ?? 0.3) * 1000,
            });
        }
        return this;
    }

    panBy(offset: [number, number] | Point, options?: SetViewOptions): this {
        const point = toPoint(offset as [number, number]);
        if (options?.animate === false) {
            this.ml.panBy([point.x, point.y], { duration: 0 });
            this.enforceCenterBounds();
        } else {
            this.cameraAnimating = true;
            this.ml.panBy([point.x, point.y], {
                duration: (options?.duration ?? 0.3) * 1000,
            });
        }
        return this;
    }

    /** Direct camera write used by gestures.ts (game units). */
    jumpToGame(center: LatLng, zoom: number): void {
        const lngLat = gameToLngLat(this.getRegionTransform(), center.lat, center.lng);
        this.ml.jumpTo({
            center: [lngLat.lng, lngLat.lat],
            zoom: zoomToMapLibre(this.getRegionTransform(), zoom),
        });
    }

    /**
     * Bounds stay in game units (options.maxBounds); enforcement is custom
     * (enforceCenterBounds on move + gestures' limitCenter), NOT
     * maplibre's native maxBounds — which additionally raises the effective
     * min zoom so the viewport is always covered, breaking the Leaflet
     * semantics this map relies on (zoom out to 0 with a small map).
     */
    setMaxBounds(bounds: LatLngBoundsExpression | null): this {
        this.options.maxBounds = bounds ? toLatLngBounds(bounds) : null;
        return this;
    }

    /** True while an easeTo/flyTo/panBy animation runs (jumpTo would cancel it,
     *  so mid-flight clamping is deferred to moveend). */
    private cameraAnimating = false;
    /** Reentrancy guard: clamping jumps the camera, which fires 'move' again. */
    private enforcingBounds = false;

    /** Hard-clamp the camera center into maxBounds when it strays outside
     *  (drag pan, animated camera ops). No-op while custom gestures run —
     *  they clamp themselves with rubber-band resistance. */
    private enforceCenterBounds = (): void => {
        const bounds = this.options.maxBounds;
        if (
            !bounds ||
            this.gestureDepth > 0 ||
            this.cameraAnimating ||
            this.enforcingBounds ||
            !this.transform
        ) {
            return;
        }
        const center = this.getCenter();
        const zoom = this.getZoom();
        const limited = this.limitCenter(center, zoom, bounds);
        const drift = this.project(center, zoom).distanceTo(
            this.project(limited, zoom),
        );
        if (drift > 0.5) {
            this.enforcingBounds = true;
            try {
                this.jumpToGame(limited, zoom);
            } finally {
                this.enforcingBounds = false;
            }
        }
    };

    /**
     * Leaflet _limitCenter port: clamp center so the viewport stays within
     * maxBounds (game px math). Used by gestures + overdrag indicator.
     */
    limitCenter(center: LatLng, zoom: number, bounds: LatLngBounds): LatLng {
        const centerPoint = this.project(center, zoom);
        const viewHalf = this.getSize().divideBy(2);
        const viewBounds = {
            min: centerPoint.subtract(viewHalf),
            max: centerPoint.add(viewHalf),
        };
        const sw = this.project(bounds.getSouthWest(), zoom);
        const ne = this.project(bounds.getNorthEast(), zoom);
        const pxBounds = {
            min: new Point(Math.min(sw.x, ne.x), Math.min(sw.y, ne.y)),
            max: new Point(Math.max(sw.x, ne.x), Math.max(sw.y, ne.y)),
        };
        const offset = this.getBoundsOffset(viewBounds, pxBounds);
        if (offset.x === 0 && offset.y === 0) return center;
        return this.unproject(centerPoint.add(offset), zoom);
    }

    /**
     * Leaflet _getBoundsOffset/_rebound port (unrounded): per axis,
     * left = px.min − view.min (view extends past the left edge),
     * right = view.max − px.max (view extends past the right edge).
     * left+right > 0 means the viewport is WIDER than the bounds → center on
     * the bounds; otherwise edge-clamp (only one edge can be violated, so the
     * result converges in one step).
     */
    private getBoundsOffset(
        viewBounds: { min: Point; max: Point },
        pxBounds: { min: Point; max: Point },
    ): Point {
        const offset = new Point(0, 0);
        for (const axis of ['x', 'y'] as const) {
            const left = pxBounds.min[axis] - viewBounds.min[axis];
            const right = viewBounds.max[axis] - pxBounds.max[axis];
            if (left + right > 0) {
                offset[axis] = (left - right) / 2;
            } else {
                offset[axis] = Math.max(0, left) - Math.max(0, right);
            }
        }
        return offset;
    }

    // -- container / panes -------------------------------------------------------

    getContainer(): HTMLElement {
        return this.container;
    }

    getSize(): Point {
        return new Point(this.container.clientWidth, this.container.clientHeight);
    }

    invalidateSize(): void {
        this.ml.resize();
    }

    getPane(name: string): HTMLElement | undefined {
        return this.panes.get(name);
    }

    createPane(name: string, zIndex?: number): HTMLElement {
        const existing = this.panes.get(name);
        if (existing) return existing;
        const pane = document.createElement('div');
        pane.classList.add('leaflet-pane', `leaflet-${name}-pane`);
        pane.style.position = 'absolute';
        pane.style.inset = '0';
        pane.style.overflow = 'hidden';
        pane.style.pointerEvents = 'none';
        if (zIndex !== undefined) pane.style.zIndex = String(zIndex);
        this.overlayRoot.appendChild(pane);
        this.panes.set(name, pane);
        return pane;
    }

    // -- overlay host --------------------------------------------------------------

    onRender(callback: () => void): () => void {
        this.renderCallbacks.add(callback);
        return () => this.renderCallbacks.delete(callback);
    }

    setMapDraggingEnabled(enabled: boolean): void {
        this.dragController?.setEnabled(enabled);
    }

    // -- layer registry --------------------------------------------------------------

    addLayer(layer: CompatLayer): this {
        layer.addTo(this);
        this.attachedLayers.add(layer);
        return this;
    }

    removeLayer(layer: CompatLayer): this {
        this.attachedLayers.delete(layer);
        layer.remove();
        return this;
    }

    hasLayer(layer: CompatLayer): boolean {
        return this.attachedLayers.has(layer);
    }

    eachLayer(callback: (layer: CompatLayer) => void): this {
        [...this.attachedLayers].forEach(callback);
        return this;
    }

    /** OverlayHost contract: layers attach directly via addTo(this). */
    _registerLayerAttachment(layer: CompatLayer, attached: boolean): void {
        if (attached) this.attachedLayers.add(layer);
        else this.attachedLayers.delete(layer);
    }

    // -- events ------------------------------------------------------------------------

    on<T = unknown>(type: string, handler: (event: T) => void): this {
        let set = this.listeners.get(type);
        if (!set) {
            set = new Set();
            this.listeners.set(type, set);
        }
        set.add(handler as (event?: unknown) => void);
        return this;
    }

    off<T = unknown>(type: string, handler: (event: T) => void): this {
        this.listeners.get(type)?.delete(handler as (event?: unknown) => void);
        return this;
    }

    once<T = unknown>(type: string, handler: (event: T) => void): this {
        const wrapped = (event?: unknown) => {
            this.off(type, wrapped);
            handler(event as T);
        };
        return this.on(type, wrapped);
    }

    fire(type: string, data?: unknown): this {
        this.listeners.get(type)?.forEach((handler) => handler(data));
        return this;
    }

    /** Begin a custom camera gesture; raw start/end camera events coalesce. */
    beginCameraGesture(zoomChanged: boolean): void {
        if (this.gestureDepth === 0) {
            this.gestureZoomStarted = zoomChanged;
            if (zoomChanged) {
                this.fire('zoomstart');
            }
            this.fire('movestart');
        }
        this.gestureDepth += 1;
    }

    /** End a custom camera gesture; emits coalesced end events. */
    endCameraGesture(zoomChanged: boolean): void {
        if (this.gestureDepth === 0) return;
        this.gestureDepth -= 1;
        if (this.gestureDepth > 0) return;
        if (zoomChanged || this.gestureZoomStarted) {
            this.fire('zoomend');
        }
        this.fire('moveend');
        this.gestureZoomStarted = false;
    }

    get inCameraGesture(): boolean {
        return this.gestureDepth > 0;
    }

    private wireEvents(): void {
        const forward = (type: string) => {
            this.ml.on(type as never, (event: unknown) => this.fire(type, event));
        };
        ['drag', 'mouseover', 'mouseout', 'resize', 'idle', 'load', 'error'].forEach(forward);

        // Mouse events are re-emitted with game-unit latlng/containerPoint so
        // consumers never see mercator coordinates.
        const forwardMouse = (type: string) => {
            this.ml.on(type as never, (event: unknown) => {
                const mouseEvent = event as {
                    originalEvent: MouseEvent;
                    point: { x: number; y: number };
                };
                this.fire(type, {
                    originalEvent: mouseEvent.originalEvent,
                    latlng: this.containerPointToLatLng(
                        new Point(mouseEvent.point.x, mouseEvent.point.y),
                    ),
                    containerPoint: new Point(
                        mouseEvent.point.x,
                        mouseEvent.point.y,
                    ),
                });
            });
        };
        ['click', 'mousedown', 'mousemove', 'mouseup', 'dblclick', 'contextmenu'].forEach(forwardMouse);

        this.ml.on('move', () => {
            this.enforceCenterBounds();
            this.fire('move');
        });
        this.ml.on('moveend', () => {
            this.cameraAnimating = false;
            this.enforceCenterBounds();
        });
        this.ml.on('zoom', () => this.fire('zoom'));

        this.ml.on('movestart', () => {
            if (this.gestureDepth > 0) return;
            this.fire('movestart');
        });
        this.ml.on('zoomstart', () => {
            this.container.classList.add('leaflet-zoom-anim');
            if (this.gestureDepth > 0) return;
            this.fire('zoomstart');
        });
        this.ml.on('moveend', () => {
            if (this.gestureDepth > 0) return; // coalesced at gesture end
            this.fire('moveend');
        });
        this.ml.on('zoomend', () => {
            this.container.classList.remove('leaflet-zoom-anim');
            if (this.gestureDepth > 0) return; // coalesced at gesture end
            this.fire('zoomend');
        });

        this.ml.on('dragstart', () => {
            this.container.classList.add('leaflet-dragging');
            this.fire('dragstart');
        });
        this.ml.on('dragend', () => {
            this.container.classList.remove('leaflet-dragging');
            this.fire('dragend');
        });
    }

    // -- overdrag (rubber-band visual offset; written by gestures.ts) -------------

    private overdragOffset = new Point(0, 0);
    private overdragElements: HTMLElement[] = [];

    getOverdragOffset(): Point {
        return this.overdragOffset;
    }

    /**
     * Apply the resisted overdrag as a translate on the canvas container +
     * overlay root ONLY — never the map container itself, whose ::before grid
     * pattern is the static background and must not move with the map.
     */
    setVisualOverdrag(offset: Point): void {
        this.overdragOffset = offset;
        if (this.overdragElements.length === 0) {
            const canvasContainer = this.container.querySelector<HTMLElement>(
                '.maplibregl-canvas-container',
            );
            this.overdragElements = [canvasContainer, this.overlayRoot].filter(
                (el): el is HTMLElement => Boolean(el),
            );
        }
        const transform =
            offset.x === 0 && offset.y === 0
                ? ''
                : `translate(${-offset.x}px, ${-offset.y}px)`;
        this.overdragElements.forEach((el) => {
            el.style.transform = transform;
        });
    }

    /** Animate the visual overdrag back to zero (bounce-back on release). */
    settleVisualOverdrag(): void {
        if (
            this.overdragOffset.x === 0 &&
            this.overdragOffset.y === 0 &&
            this.overdragElements.every((el) => el.style.transform === '')
        ) {
            return;
        }
        this.overdragElements.forEach((el) => {
            el.style.transition = 'transform 120ms ease-out';
            el.style.transform = '';
        });
        this.overdragOffset = new Point(0, 0);
        window.setTimeout(() => {
            this.overdragElements.forEach((el) => {
                el.style.transition = '';
            });
        }, 140);
    }

    // -- lifecycle -----------------------------------------------------------------

    remove(): void {
        this.renderCallbacks.clear();
        this.ml.remove();
        this.overlayRoot.remove();
        this.listeners.clear();
    }
}

export { EMPTY_TILE_DATA_URL };
