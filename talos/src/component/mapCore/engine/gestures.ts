/**
 * Port of the Leaflet SmoothWheelZoom gesture router onto TalosMap/MapLibre.
 *
 * Semantics preserved from the Leaflet implementation:
 * - wheel scroll zooms continuously around the cursor anchor (0.003 zoom/px),
 *   trackpad pinch (ctrl+wheel) zooms faster (0.01 zoom/px),
 * - two-axis trackpad scroll pans instead of zooming (routed by
 *   `trackpad-input`), with rubber-band overdrag resistance beyond maxBounds,
 * - optional zoom inertia tail,
 * - one movestart/zoomstart ... zoomend/moveend event pair per gesture,
 * - trackpad pan synthesizes dragstart/drag/dragend like a mouse drag.
 *
 * What changed vs Leaflet: the camera is written per frame with
 * TalosMap.jumpToGame (MapLibre natively renders fractional zooms without
 * tile rebuilds), and visual overdrag beyond maxBounds is applied as a CSS
 * translate on the map container (MapLibre hard-clamps the camera itself).
 */
import {
    WHEEL_GESTURE_IDLE_MS,
    WheelInputRouter,
    type WheelGestureMode,
} from 'trackpad-input';

import { Point } from './point';
import { LatLng, toLatLngBounds } from './latlng';
import type { TalosMap } from './talosMap';

const ZOOM_PER_WHEEL_PIXEL = 0.003;
const TRACKPAD_PINCH_ZOOM_PER_PIXEL = 0.01;
const INERTIA_INITIAL_FACTOR = 0.07;
const INERTIA_MAX_STEP = 0.008;
const INERTIA_FRICTION_PER_FRAME = 0.72;
const INERTIA_STOP_THRESHOLD = 0.00025;
const FRAME_DURATION = 1000 / 60;
const OVERDRAG_MAX_PX = 96;
const OVERDRAG_RESISTANCE = 0.65;
const OVERDRAG_SETTLE_THRESHOLD_PX = 80;
const OVERDRAG_SETTLE_MS = 48;
const OVERDRAG_SETTLE_ANIMATION_MS = 120;

/** Leaflet DomEvent.getWheelDelta equivalent. */
const getWheelDelta = (event: WheelEvent): number => {
    const delta =
        event.deltaMode === 1
            ? event.deltaY * 20
            : event.deltaMode === 2
              ? event.deltaY * 60
              : event.deltaY;
    return -delta;
};

export interface SmoothGesturesOptions {
    enableInertia?: boolean;
}

export class SmoothGestures {
    private readonly map: TalosMap;
    private readonly container: HTMLElement;
    private readonly inertiaEnabled: boolean;
    private readonly wheelInputRouter: WheelInputRouter<WheelEvent>;
    private zoomFrame: number | null = null;
    private panFrame: number | null = null;
    private endTimer: number | null = null;
    private panTailTimer: number | null = null;
    private targetZoom: number | null = null;
    private anchorPoint: Point | null = null;
    private anchorLatLng: LatLng | null = null;
    private zoomVelocity = 0;
    private lastZoomInputTime: number | null = null;
    private inertiaStep = 0;
    private lastFrameTime: number | null = null;
    private pendingPanOffset = new Point(0, 0);
    private panRawCenterPoint: Point | null = null;
    private gestureMode: WheelGestureMode | null = null;
    private gestureActive = false;
    private trackpadDragging = false;
    private overdragSettling = false;
    private disposed = false;

    constructor(map: TalosMap, options: SmoothGesturesOptions = {}) {
        this.map = map;
        this.container = map.getContainer();
        this.inertiaEnabled = options.enableInertia ?? true;
        this.wheelInputRouter = new WheelInputRouter<WheelEvent>({
            onPan: (event) => this.handleRoutedWheel('pan', event),
            onZoom: (event) => this.handleRoutedWheel('zoom', event),
        });

        this.container.addEventListener('wheel', this.handleWheel, {
            passive: false,
        });
    }

    dispose = () => {
        if (this.disposed) return;
        this.disposed = true;
        this.container.removeEventListener('wheel', this.handleWheel);
        this.clearScheduledWork();
    };

    private handleWheel = (event: WheelEvent) => {
        event.preventDefault();
        event.stopPropagation();

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

    private limitZoom(zoom: number): number {
        return Math.max(
            this.map.getMinZoom(),
            Math.min(this.map.getMaxZoom(), zoom),
        );
    }

    private handleZoom(event: WheelEvent) {
        const wheelDelta = getWheelDelta(event);
        if (!wheelDelta) return;

        const zoomDelta =
            event.ctrlKey && event.deltaMode === 0
                ? -event.deltaY * TRACKPAD_PINCH_ZOOM_PER_PIXEL
                : wheelDelta * ZOOM_PER_WHEEL_PIXEL;
        const currentTarget = this.targetZoom ?? this.map.getZoom();
        const nextTarget = this.limitZoom(currentTarget + zoomDelta);

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
        const offset = new Point(event.deltaX, event.deltaY);
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
        this.map.ml.stop();
        this.map.beginCameraGesture(zoomChanged);
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

    private continuousContainerPointToLatLng(point: Point) {
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
                zoom = this.limitZoom(
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
        this.pendingPanOffset = new Point(0, 0);

        if (offset.x !== 0 || offset.y !== 0) {
            const overdragAmount = this.applyConstrainedPan(offset);
            this.map.fire('move').fire('drag');

            if (overdragAmount >= OVERDRAG_SETTLE_THRESHOLD_PX) {
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

    private applyConstrainedPan(offset: Point): number {
        const zoom = this.map.getZoom();
        const currentCenterPoint = this.map.project(this.map.getCenter(), zoom);
        this.panRawCenterPoint ??= currentCenterPoint;
        this.panRawCenterPoint = this.panRawCenterPoint.add(offset);

        const configuredBounds = this.map.options.maxBounds;
        if (!configuredBounds) {
            const center = this.map.unproject(this.panRawCenterPoint, zoom);
            this.map.jumpToGame(center, zoom);
            return 0;
        }

        const maxBounds = toLatLngBounds(configuredBounds);
        const rawCenter = this.map.unproject(this.panRawCenterPoint, zoom);
        const limitedCenter = this.map.limitCenter(rawCenter, zoom, maxBounds);
        const limitedCenterPoint = this.map.project(limitedCenter, zoom);
        const rawOverdrag = this.panRawCenterPoint.subtract(limitedCenterPoint);
        const visualOverdrag = new Point(
            this.resistOverdrag(rawOverdrag.x),
            this.resistOverdrag(rawOverdrag.y),
        );

        // Camera goes to the clamped center; the resisted overdrag is applied
        // visually as a container translate (MapLibre hard-clamps the camera).
        this.map.jumpToGame(limitedCenter, zoom);
        this.applyVisualOverdrag(visualOverdrag);
        return Math.max(Math.abs(visualOverdrag.x), Math.abs(visualOverdrag.y));
    }

    private applyVisualOverdrag(overdrag: Point) {
        this.map.setOverdragOffset(overdrag);
        if (overdrag.x === 0 && overdrag.y === 0) {
            this.container.style.transform = '';
        } else {
            this.container.style.transform = `translate(${-overdrag.x}px, ${-overdrag.y}px)`;
        }
    }

    private settleVisualOverdrag() {
        if (this.container.style.transform === '') return;
        this.container.style.transition = `transform ${OVERDRAG_SETTLE_ANIMATION_MS}ms ease-out`;
        this.container.style.transform = '';
        this.map.setOverdragOffset(new Point(0, 0));
        window.setTimeout(() => {
            this.container.style.transition = '';
        }, OVERDRAG_SETTLE_ANIMATION_MS + 20);
    }

    private resistOverdrag(value: number): number {
        if (value === 0) return 0;

        const magnitude =
            OVERDRAG_MAX_PX *
            (1 -
                Math.exp(
                    (-Math.abs(value) * OVERDRAG_RESISTANCE) / OVERDRAG_MAX_PX,
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
            OVERDRAG_SETTLE_MS,
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
            center = this.map.limitCenter(
                center,
                zoom,
                toLatLngBounds(configuredBounds),
            );
        }

        this.map.jumpToGame(center, zoom);
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

        this.settleVisualOverdrag();

        if (!this.gestureActive) {
            this.resetVisualState();
            return;
        }

        const wasTrackpadDrag = this.trackpadDragging;
        const zoomChanged = this.gestureMode === 'zoom';
        this.gestureActive = false;
        this.trackpadDragging = false;
        if (wasTrackpadDrag) this.map.fire('dragend');
        this.map.endCameraGesture(zoomChanged);
        this.resetVisualState();
    }

    private resetVisualState() {
        this.targetZoom = null;
        this.anchorPoint = null;
        this.anchorLatLng = null;
        this.zoomVelocity = 0;
        this.lastZoomInputTime = null;
        this.inertiaStep = 0;
        this.lastFrameTime = null;
        this.pendingPanOffset = new Point(0, 0);
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
        this.settleVisualOverdrag();
        this.clearOverdragSettlement();
        if (this.gestureActive) {
            this.gestureActive = false;
            this.map.endCameraGesture(this.gestureMode === 'zoom');
        }
        this.resetVisualState();
        this.wheelInputRouter.dispose();
    }
}

export const enableSmoothGestures = (
    map: TalosMap,
    options?: SmoothGesturesOptions,
): SmoothGestures => {
    const gestures = new SmoothGestures(map, options);
    map.setDragController(new DragPanController(map));
    return gestures;
};

// ---------------------------------------------------------------------------
// Mouse/touch drag pan (replaces maplibre dragPan)
// ---------------------------------------------------------------------------

const DRAG_CLICK_TOLERANCE_PX = 3;
const DRAG_INERTIA_MAX_SPEED = 1250; // px/s (Leaflet inertiaMaxSpeed)
const DRAG_INERTIA_DECELERATION = 3000; // px/s² (Leaflet inertiaDeceleration)
const DRAG_INERTIA_MIN_SPEED = 40; // px/s — below this, no inertia tail

/**
 * Why not maplibre dragPan: our maxBounds enforcement is custom (native
 * maxBounds would also force-cover the viewport at low zoom), and clamping a
 * native drag mid-flight via jumpTo cancels the gesture. Driving the camera
 * ourselves per frame gives exact Leaflet semantics: hard edge clamp while
 * dragging, dragstart/drag/dragend events, click suppression, inertia tail.
 */
export class DragPanController {
    private readonly map: TalosMap;
    private readonly container: HTMLElement;
    private enabled = true;
    private activePointerId: number | null = null;
    private dragging = false;
    private startClient = new Point(0, 0);
    private lastClient = new Point(0, 0);
    private rawCenterPoint: Point | null = null;
    private lastMoveTime = 0;
    private velocity = new Point(0, 0); // px/ms, content-following direction
    private inertiaFrame: number | null = null;
    private disposed = false;

    constructor(map: TalosMap) {
        this.map = map;
        this.container = map.getContainer();
        this.container.addEventListener('pointerdown', this.handlePointerDown);
    }

    dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.container.removeEventListener('pointerdown', this.handlePointerDown);
        this.detachMoveListeners();
        this.stopInertia();
    }

    setEnabled(enabled: boolean) {
        this.enabled = enabled;
        if (!enabled && this.dragging) this.finishDrag(true);
    }

    isEnabled(): boolean {
        return this.enabled;
    }

    private handlePointerDown = (down: PointerEvent) => {
        if (!this.enabled || this.activePointerId !== null) return;
        if (down.pointerType === 'mouse' && down.button !== 0) return;
        // Only primary touch; multi-touch belongs to pinch zoom.
        if (down.pointerType !== 'mouse' && !down.isPrimary) return;

        this.activePointerId = down.pointerId;
        this.startClient = new Point(down.clientX, down.clientY);
        this.lastClient = this.startClient;
        this.rawCenterPoint = null;
        this.velocity = new Point(0, 0);
        this.lastMoveTime = down.timeStamp;

        const target = this.container.ownerDocument;
        target.addEventListener('pointermove', this.handlePointerMove);
        target.addEventListener('pointerup', this.handlePointerUp);
        target.addEventListener('pointercancel', this.handlePointerUp);
    };

    private detachMoveListeners() {
        const target = this.container.ownerDocument;
        target.removeEventListener('pointermove', this.handlePointerMove);
        target.removeEventListener('pointerup', this.handlePointerUp);
        target.removeEventListener('pointercancel', this.handlePointerUp);
    }

    private handlePointerMove = (move: PointerEvent) => {
        if (move.pointerId !== this.activePointerId) return;

        // Block text selection / native image drag while panning (safe here:
        // canceling a pointermove never suppresses the trailing click).
        move.preventDefault();

        const current = new Point(move.clientX, move.clientY);
        const totalDelta = current.subtract(this.startClient);

        if (!this.dragging) {
            if (Math.max(Math.abs(totalDelta.x), Math.abs(totalDelta.y)) < DRAG_CLICK_TOLERANCE_PX) {
                return;
            }
            this.startDrag();
        }

        // Pointer delta moves the cursor; the content follows the pointer, so
        // the center moves the opposite way.
        const delta = current.subtract(this.lastClient);
        this.lastClient = current;

        const elapsed = Math.max(1, move.timeStamp - this.lastMoveTime);
        this.lastMoveTime = move.timeStamp;
        this.velocity = new Point(delta.x / elapsed, delta.y / elapsed);

        const zoom = this.map.getZoom();
        this.rawCenterPoint ??= this.map.project(this.map.getCenter(), zoom);
        this.rawCenterPoint = this.rawCenterPoint.subtract(delta);
        this.panToRawCenter(zoom);
        this.map.fire('drag');
    };

    private panToRawCenter(zoom: number) {
        if (this.rawCenterPoint === null) return;
        const bounds = this.map.options.maxBounds;
        const rawCenter = this.map.unproject(this.rawCenterPoint, zoom);
        const center = bounds
            ? this.map.limitCenter(rawCenter, zoom, toLatLngBounds(bounds))
            : rawCenter;
        this.map.jumpToGame(center, zoom);
    }

    private handlePointerUp = (up: PointerEvent) => {
        if (up.pointerId !== this.activePointerId) return;
        this.activePointerId = null;
        this.detachMoveListeners();
        if (this.dragging) this.finishDrag(false);
    };

    private startDrag() {
        this.dragging = true;
        this.map.ml.stop();
        this.stopInertia();
        this.container.classList.add('leaflet-dragging');
        this.map.beginCameraGesture(false);
        this.map.fire('dragstart');
    }

    private finishDrag(hard: boolean) {
        this.dragging = false;
        this.container.classList.remove('leaflet-dragging');

        const speed = this.velocity.distanceTo(new Point(0, 0)) * 1000; // px/s
        if (!hard && speed > DRAG_INERTIA_MIN_SPEED) {
            this.startInertia();
            // Gesture ends (moveend fires) when the inertia tail settles.
            return;
        }

        this.map.fire('dragend');
        this.map.endCameraGesture(false);
        if (!hard) this.suppressClickOnce();
    }

    /** Leaflet-style inertia tail: speed decays linearly at
     *  DRAG_INERTIA_DECELERATION until it hits zero. */
    private startInertia() {
        const startSpeed = Math.min(
            this.velocity.distanceTo(new Point(0, 0)) * 1000,
            DRAG_INERTIA_MAX_SPEED,
        );
        const speedLength = this.velocity.distanceTo(new Point(0, 0)) || 1;
        const direction = this.velocity.divideBy(speedLength);
        let startTime: number | null = null;
        let lastTime: number | null = null;

        const step = (timestamp: number) => {
            this.inertiaFrame = null;
            if (startTime === null) startTime = timestamp;
            const elapsed = lastTime === null ? FRAME_DURATION : Math.min(50, timestamp - lastTime);
            lastTime = timestamp;

            const speed = startSpeed - DRAG_INERTIA_DECELERATION * ((timestamp - startTime) / 1000);
            if (speed <= 0) {
                this.map.fire('dragend');
                this.map.endCameraGesture(false);
                this.suppressClickOnce();
                return;
            }

            const delta = direction.multiplyBy((speed * elapsed) / 1000);
            const zoom = this.map.getZoom();
            this.rawCenterPoint ??= this.map.project(this.map.getCenter(), zoom);
            this.rawCenterPoint = this.rawCenterPoint.subtract(delta);
            this.panToRawCenter(zoom);
            this.map.fire('drag');
            this.inertiaFrame = requestAnimationFrame(step);
        };
        this.inertiaFrame = requestAnimationFrame(step);
    }

    private stopInertia() {
        if (this.inertiaFrame !== null) {
            cancelAnimationFrame(this.inertiaFrame);
            this.inertiaFrame = null;
        }
    }

    private suppressClickOnce() {
        const suppress = (event: Event) => {
            event.stopImmediatePropagation();
            this.container.removeEventListener('click', suppress, true);
        };
        this.container.addEventListener('click', suppress, true);
        window.setTimeout(() => {
            this.container.removeEventListener('click', suppress, true);
        }, 0);
    }
}
