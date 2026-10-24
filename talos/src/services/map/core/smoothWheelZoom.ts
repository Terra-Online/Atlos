import L from 'leaflet';
import {
    WHEEL_GESTURE_IDLE_MS,
    WheelInputRouter,
    type WheelGestureMode,
} from 'trackpad-input';

const ZOOM_PER_WHEEL_PIXEL = 0.003;
const TRACKPAD_PINCH_ZOOM_PER_PIXEL = 0.01;
const INERTIA_INITIAL_FACTOR = 0.07;
const INERTIA_MAX_STEP = 0.008;
const INERTIA_FRICTION_PER_FRAME = 0.72;
const INERTIA_STOP_THRESHOLD = 0.00025;
const FRAME_DURATION = 1000 / 60;
const TRACKPAD_OVERDRAG_MAX_PX = 96;
const TRACKPAD_OVERDRAG_RESISTANCE = 0.65;
const TRACKPAD_OVERDRAG_SETTLE_THRESHOLD_PX = 80;
const TRACKPAD_OVERDRAG_SETTLE_MS = 48;

interface ContinuousZoomEventData {
    pinch: true;
    round: false;
}

const CONTINUOUS_ZOOM_EVENT_DATA: ContinuousZoomEventData = {
    pinch: true,
    round: false,
};

export interface SmoothWheelZoomOptions {
    enableInertia?: boolean;
}

interface ContinuousZoomMap extends L.Map {
    _animatingZoom?: boolean;
    _getMapPanePos(): L.Point;
    _getNewPixelOrigin(center: L.LatLng, zoom: number): L.Point;
    _latLngToNewLayerPoint(
        latLng: L.LatLng,
        zoom: number,
        center: L.LatLng,
    ): L.Point;
    _limitCenter(
        center: L.LatLng,
        zoom: number,
        bounds: L.LatLngBounds,
    ): L.LatLng;
    _limitZoom(zoom: number): number;
    _move(center: L.LatLng, zoom: number, data?: ContinuousZoomEventData): this;
    _moveEnd(zoomChanged: boolean): this;
    _moveStart(zoomChanged: boolean, noMoveStart: boolean): this;
    _onZoomTransitionEnd?(): void;
    _rawPanBy(offset: L.Point): void;
    _stop(): this;
}

interface SubpixelMarker {
    _icon?: HTMLElement;
    _latlng: L.LatLng;
    _map?: ContinuousZoomMap;
    _setPos(point: L.Point): void;
}

interface MarkerZoomAnimation {
    center: L.LatLng;
    zoom: number;
}

let subpixelMarkerPositioningInstalled = false;

const installSubpixelPixelOrigin = (map: ContinuousZoomMap) => {
    // Keep map coordinates and tile transforms in the same subpixel space.
    // Leaflet's default rounding is what makes a fixed zoom anchor wander.
    map._getNewPixelOrigin = function (center, zoom) {
        return this.project(center, zoom)
            .subtract(this.getSize().divideBy(2))
            .add(this._getMapPanePos());
    };

    // Leaflet rounds the projected LatLng before subtracting the pixel
    // origin. Markers, labels, tooltips, and cluster animations all use this
    // conversion, so that rounding makes every overlay jump independently of
    // the already-smooth tile layer during fractional zoom.
    map.latLngToLayerPoint = function (latLng) {
        return this.project(latLng, this.getZoom()).subtract(
            this.getPixelOrigin(),
        );
    };
};

const installSubpixelMarkerPositioning = () => {
    if (subpixelMarkerPositioningInstalled) return;
    subpixelMarkerPositioningInstalled = true;

    const markerPrototype = L.Marker.prototype as unknown as SubpixelMarker & {
        _animateZoom(event: MarkerZoomAnimation): void;
        update(): SubpixelMarker;
    };

    markerPrototype.update = function () {
        if (this._icon && this._map) {
            this._setPos(this._map.latLngToLayerPoint(this._latlng));
        }
        return this;
    };
    markerPrototype._animateZoom = function (event) {
        if (!this._map) return;
        this._setPos(
            this._map._latLngToNewLayerPoint(
                this._latlng,
                event.zoom,
                event.center,
            ),
        );
    };
};

/**
 * Leaflet's built-in wheel handler debounces input and starts a fixed CSS
 * transition. This handler applies zoom on the next paint, routes precise
 * two-axis trackpad scrolling to pan, and can add a short zoom inertia tail.
 */
export class SmoothWheelZoom {
    private readonly map: ContinuousZoomMap;
    private readonly container: HTMLElement;
    private readonly inertiaEnabled: boolean;
    private readonly wheelInputRouter: WheelInputRouter<WheelEvent>;
    private zoomFrame: number | null = null;
    private panFrame: number | null = null;
    private endTimer: number | null = null;
    private panTailTimer: number | null = null;
    private targetZoom: number | null = null;
    private anchorPoint: L.Point | null = null;
    private anchorLatLng: L.LatLng | null = null;
    private zoomVelocity = 0;
    private lastZoomInputTime: number | null = null;
    private inertiaStep = 0;
    private lastFrameTime: number | null = null;
    private pendingPanOffset = L.point(0, 0);
    private panRawCenterPoint: L.Point | null = null;
    private gestureMode: WheelGestureMode | null = null;
    private gestureActive = false;
    private trackpadDragging = false;
    private overdragSettling = false;
    private disposed = false;

    constructor(map: L.Map, options: SmoothWheelZoomOptions = {}) {
        this.map = map as ContinuousZoomMap;
        this.container = map.getContainer();
        this.inertiaEnabled = options.enableInertia ?? true;
        this.wheelInputRouter = new WheelInputRouter<WheelEvent>({
            onPan: (event) => this.handleRoutedWheel('pan', event),
            onZoom: (event) => this.handleRoutedWheel('zoom', event),
        });

        installSubpixelPixelOrigin(this.map);
        installSubpixelMarkerPositioning();

        map.scrollWheelZoom.disable();
        this.container.addEventListener('wheel', this.handleWheel, {
            passive: false,
        });
        map.once('unload', this.dispose);
    }

    cancel() {
        this.clearOverdragSettlement();
        this.finishGesture();
        this.wheelInputRouter.reset();
    }

    dispose = () => {
        if (this.disposed) return;
        this.disposed = true;

        this.container.removeEventListener('wheel', this.handleWheel);
        this.map.off('unload', this.dispose);
        this.clearScheduledWork();
    };

    private handleWheel = (event: WheelEvent) => {
        event.preventDefault();
        event.stopPropagation();

        this.finishLeafletZoomAnimation();
        const gestureMode = this.wheelInputRouter.route(event);
        if (gestureMode === 'pending' && this.overdragSettling) {
            this.clearOverdragSettlement();
        }
    };

    private handleRoutedWheel(
        gestureMode: WheelGestureMode,
        event: WheelEvent,
    ) {
        if (this.overdragSettling && gestureMode === 'pan') {
            this.schedulePanTailRelease();
            return;
        }
        if (this.overdragSettling) this.clearOverdragSettlement();
        this.routeWheelEvent(gestureMode, event);
    }

    private routeWheelEvent(gestureMode: WheelGestureMode, event: WheelEvent) {
        if (
            this.gestureActive &&
            this.gestureMode !== null &&
            this.gestureMode !== gestureMode
        ) {
            this.finishGesture();
        }

        this.gestureMode = gestureMode;

        if (gestureMode === 'pan') {
            this.handleTrackpadPan(event);
            return;
        }

        this.handleZoom(event);
    }

    private handleZoom(event: WheelEvent) {
        const wheelDelta = L.DomEvent.getWheelDelta(event);
        if (!wheelDelta) return;

        const zoomDelta =
            event.ctrlKey && event.deltaMode === 0
                ? -event.deltaY * TRACKPAD_PINCH_ZOOM_PER_PIXEL
                : wheelDelta * ZOOM_PER_WHEEL_PIXEL;
        const currentTarget = this.targetZoom ?? this.map.getZoom();
        const nextTarget = this.map._limitZoom(currentTarget + zoomDelta);

        this.updateAnchor(event);
        this.targetZoom = nextTarget;
        if (this.inertiaEnabled) {
            this.updateZoomVelocity(
                nextTarget - currentTarget,
                performance.now(),
            );
            this.inertiaStep = Math.max(
                -INERTIA_MAX_STEP,
                Math.min(
                    INERTIA_MAX_STEP,
                    this.zoomVelocity * INERTIA_INITIAL_FACTOR,
                ),
            );
        } else {
            this.inertiaStep = 0;
        }

        if (nextTarget !== this.map.getZoom()) this.startGesture(true);

        if (
            this.gestureActive &&
            nextTarget !== this.map.getZoom() &&
            this.zoomFrame === null
        ) {
            this.zoomFrame = requestAnimationFrame(this.applyZoomFrame);
        }

        this.scheduleGestureEnd();
    }

    private handleTrackpadPan(event: WheelEvent) {
        const offset = L.point(event.deltaX, event.deltaY);
        if (offset.x === 0 && offset.y === 0) {
            if (this.gestureActive && !this.overdragSettling) {
                this.scheduleGestureEnd();
            }
            return;
        }

        const wasActive = this.gestureActive;
        this.startGesture(false);
        if (!wasActive) {
            this.trackpadDragging = true;
            this.map.fire('dragstart');
        }
        this.pendingPanOffset = this.pendingPanOffset.add(offset);

        if (this.panFrame === null) {
            this.panFrame = requestAnimationFrame(this.applyPanFrame);
        }
        if (!this.overdragSettling) this.scheduleGestureEnd();
    }

    private startGesture(zoomChanged: boolean) {
        if (this.gestureActive) return;

        this.map._stop();
        this.map._moveStart(zoomChanged, false);
        this.gestureActive = true;
    }

    private updateAnchor(event: WheelEvent) {
        const point = this.map.mouseEventToContainerPoint(event);
        if (this.anchorPoint?.equals(point) && this.anchorLatLng !== null) {
            return;
        }

        this.anchorPoint = point;
        this.anchorLatLng = this.continuousContainerPointToLatLng(point);
    }

    private continuousContainerPointToLatLng(point: L.Point) {
        const centerPoint = this.map.getSize().divideBy(2);
        const center = this.map.getCenter();
        const zoom = this.map.getZoom();
        return this.map.unproject(
            this.map.project(center, zoom).add(point.subtract(centerPoint)),
            zoom,
        );
    }

    private updateZoomVelocity(delta: number, timestamp: number) {
        if (
            this.lastZoomInputTime === null ||
            delta * this.zoomVelocity <= 0 ||
            timestamp - this.lastZoomInputTime > WHEEL_GESTURE_IDLE_MS
        ) {
            this.zoomVelocity = delta;
        } else {
            const elapsed = Math.max(
                8,
                Math.min(40, timestamp - this.lastZoomInputTime),
            );
            const frameDelta = delta * (FRAME_DURATION / elapsed);
            this.zoomVelocity = this.zoomVelocity * 0.65 + frameDelta * 0.35;
        }
        this.lastZoomInputTime = timestamp;
    }

    private applyZoomFrame = (timestamp: number) => {
        this.zoomFrame = null;
        if (!this.gestureActive) return;

        const elapsed =
            this.lastFrameTime === null
                ? FRAME_DURATION
                : Math.max(8, Math.min(34, timestamp - this.lastFrameTime));
        this.lastFrameTime = timestamp;

        const currentZoom = this.map.getZoom();
        const directTarget = this.targetZoom;
        let zoom = directTarget ?? currentZoom;
        this.targetZoom = null;

        if (this.inertiaEnabled && directTarget === null) {
            if (Math.abs(this.inertiaStep) < INERTIA_STOP_THRESHOLD) {
                this.inertiaStep = 0;
            } else {
                const zoomBeforeInertia = zoom;
                zoom = this.map._limitZoom(
                    zoom + this.inertiaStep * (elapsed / FRAME_DURATION),
                );

                if (zoom === zoomBeforeInertia) {
                    this.inertiaStep = 0;
                } else {
                    this.inertiaStep *= Math.pow(
                        INERTIA_FRICTION_PER_FRAME,
                        elapsed / FRAME_DURATION,
                    );
                }
            }
        }

        if (zoom !== currentZoom) {
            this.moveToZoom(zoom);
        }

        if (
            this.targetZoom !== null ||
            (this.inertiaEnabled &&
                Math.abs(this.inertiaStep) >= INERTIA_STOP_THRESHOLD)
        ) {
            this.zoomFrame = requestAnimationFrame(this.applyZoomFrame);
            return;
        }

        this.lastFrameTime = null;
        if (this.endTimer === null) {
            this.finishGesture();
        }
    };

    private applyPanFrame = () => {
        this.panFrame = null;
        if (!this.gestureActive || this.gestureMode !== 'pan') return;

        const offset = this.pendingPanOffset;
        this.pendingPanOffset = L.point(0, 0);

        if (offset.x !== 0 || offset.y !== 0) {
            const overdragAmount = this.applyConstrainedPan(offset);
            this.map.fire('move').fire('drag');

            if (overdragAmount >= TRACKPAD_OVERDRAG_SETTLE_THRESHOLD_PX) {
                this.beginOverdragSettlement();
            }
        }

        if (this.pendingPanOffset.x !== 0 || this.pendingPanOffset.y !== 0) {
            this.panFrame = requestAnimationFrame(this.applyPanFrame);
            return;
        }

        if (this.endTimer === null) {
            this.finishGesture();
        }
    };

    private applyConstrainedPan(offset: L.Point) {
        const zoom = this.map.getZoom();
        const currentCenterPoint = this.map.project(this.map.getCenter(), zoom);
        this.panRawCenterPoint ??= currentCenterPoint;
        this.panRawCenterPoint = this.panRawCenterPoint.add(offset);

        const configuredBounds = this.map.options.maxBounds;
        if (!configuredBounds) {
            this.map._rawPanBy(offset);
            return 0;
        }

        const maxBounds =
            configuredBounds instanceof L.LatLngBounds
                ? configuredBounds
                : L.latLngBounds(configuredBounds);
        const rawCenter = this.map.unproject(this.panRawCenterPoint, zoom);
        const limitedCenter = this.map._limitCenter(rawCenter, zoom, maxBounds);
        const limitedCenterPoint = this.map.project(limitedCenter, zoom);
        const rawOverdrag = this.panRawCenterPoint.subtract(limitedCenterPoint);
        const visualOverdrag = L.point(
            this.resistOverdrag(rawOverdrag.x),
            this.resistOverdrag(rawOverdrag.y),
        );
        const visualCenterPoint = limitedCenterPoint.add(visualOverdrag);
        const visualOffset = visualCenterPoint.subtract(currentCenterPoint);

        if (visualOffset.x !== 0 || visualOffset.y !== 0) {
            this.map._rawPanBy(visualOffset);
        }

        return Math.max(Math.abs(visualOverdrag.x), Math.abs(visualOverdrag.y));
    }

    private resistOverdrag(value: number) {
        if (value === 0) return 0;

        const magnitude =
            TRACKPAD_OVERDRAG_MAX_PX *
            (1 -
                Math.exp(
                    (-Math.abs(value) * TRACKPAD_OVERDRAG_RESISTANCE) /
                        TRACKPAD_OVERDRAG_MAX_PX,
                ));
        return Math.sign(value) * magnitude;
    }

    private beginOverdragSettlement() {
        if (this.overdragSettling) return;

        this.overdragSettling = true;
        this.schedulePanTailRelease();
        if (this.endTimer !== null) window.clearTimeout(this.endTimer);
        this.endTimer = window.setTimeout(
            this.handleGestureEnd,
            TRACKPAD_OVERDRAG_SETTLE_MS,
        );
    }

    private schedulePanTailRelease() {
        if (this.panTailTimer !== null) {
            window.clearTimeout(this.panTailTimer);
        }
        this.panTailTimer = window.setTimeout(() => {
            this.panTailTimer = null;
            this.overdragSettling = false;
        }, WHEEL_GESTURE_IDLE_MS);
    }

    private clearOverdragSettlement() {
        this.overdragSettling = false;
        if (this.panTailTimer !== null) {
            window.clearTimeout(this.panTailTimer);
            this.panTailTimer = null;
        }
    }

    private moveToZoom(zoom: number) {
        if (this.anchorPoint === null || this.anchorLatLng === null) return;

        const centerPoint = this.map.getSize().divideBy(2);
        const cursorOffset = this.anchorPoint.subtract(centerPoint);
        let center = this.map.unproject(
            this.map.project(this.anchorLatLng, zoom).subtract(cursorOffset),
            zoom,
        );

        const configuredBounds = this.map.options.maxBounds;
        if (configuredBounds) {
            const maxBounds =
                configuredBounds instanceof L.LatLngBounds
                    ? configuredBounds
                    : L.latLngBounds(configuredBounds);
            center = this.map._limitCenter(center, zoom, maxBounds);
        }

        // This is the same signal Leaflet uses during pinch zoom. GridLayer
        // keeps the current tile level and updates its transform instead of
        // rebuilding and pruning the tile grid for every fractional step.
        this.map._move(center, zoom, CONTINUOUS_ZOOM_EVENT_DATA);
    }

    private scheduleGestureEnd() {
        if (this.endTimer !== null) {
            window.clearTimeout(this.endTimer);
        }
        this.endTimer = window.setTimeout(
            this.handleGestureEnd,
            WHEEL_GESTURE_IDLE_MS,
        );
    }

    private handleGestureEnd = () => {
        this.endTimer = null;
        if (
            this.zoomFrame === null &&
            this.panFrame === null &&
            this.targetZoom === null &&
            this.pendingPanOffset.x === 0 &&
            this.pendingPanOffset.y === 0 &&
            (!this.inertiaEnabled ||
                Math.abs(this.inertiaStep) < INERTIA_STOP_THRESHOLD)
        ) {
            this.finishGesture();
        }
    };

    private finishGesture() {
        if (this.endTimer !== null) {
            window.clearTimeout(this.endTimer);
            this.endTimer = null;
        }
        if (this.zoomFrame !== null) {
            cancelAnimationFrame(this.zoomFrame);
            this.zoomFrame = null;
        }
        if (this.panFrame !== null) {
            cancelAnimationFrame(this.panFrame);
            this.panFrame = null;
        }

        if (!this.gestureActive) {
            this.resetVisualState();
            return;
        }

        const wasTrackpadDrag = this.trackpadDragging;
        this.gestureActive = false;
        this.trackpadDragging = false;
        if (wasTrackpadDrag) this.map.fire('dragend');
        this.map._moveEnd(this.gestureMode === 'zoom');
        this.resetVisualState();
    }

    private finishLeafletZoomAnimation() {
        if (this.map._animatingZoom) {
            this.map._onZoomTransitionEnd?.();
        }
    }

    private resetVisualState() {
        this.targetZoom = null;
        this.anchorPoint = null;
        this.anchorLatLng = null;
        this.zoomVelocity = 0;
        this.lastZoomInputTime = null;
        this.inertiaStep = 0;
        this.lastFrameTime = null;
        this.pendingPanOffset = L.point(0, 0);
        this.panRawCenterPoint = null;
        this.gestureMode = null;
        this.trackpadDragging = false;
    }

    private clearScheduledWork() {
        if (this.zoomFrame !== null) {
            cancelAnimationFrame(this.zoomFrame);
            this.zoomFrame = null;
        }
        if (this.panFrame !== null) {
            cancelAnimationFrame(this.panFrame);
            this.panFrame = null;
        }
        if (this.endTimer !== null) {
            window.clearTimeout(this.endTimer);
            this.endTimer = null;
        }
        this.clearOverdragSettlement();
        this.gestureActive = false;
        this.resetVisualState();
        this.wheelInputRouter.dispose();
    }
}

export const enableSmoothWheelZoom = (
    map: L.Map,
    options?: SmoothWheelZoomOptions,
) => new SmoothWheelZoom(map, options);
