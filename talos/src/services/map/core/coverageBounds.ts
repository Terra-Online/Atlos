import L from 'leaflet';
import type { RegionTileCoverage } from '@/services/map/tileCoverage';
import { cameraRects, contains, coverageRects, coverageRows, nearest, slide, sweep, visiblePatch, type Rect } from './coverageGeometry';

interface Options {
    coverage: RegionTileCoverage;
    suffixes: string[];
    tileSize: number;
    maxNativeZoom: number;
}

interface Draggable extends L.Evented {
    _newPos: L.Point;
}

interface CameraMap extends L.Map {
    _loaded?: boolean;
    _panAnim?: { _inProgress?: boolean };
    _animatingZoom?: boolean;
    _animateToZoom?: number;
    _stop(): this;
    _moveEnd(zoomChanged: boolean): this;
    _onZoomTransitionEnd(): void;
    touchZoom: L.Handler & {
        _zooming?: boolean;
        _center?: L.LatLng;
        _pinchStartLatLng?: L.LatLng;
        _startLatLng?: L.LatLng;
    };
    _limitCenter(center: L.LatLng, zoom: number, bounds?: L.LatLngBounds): L.LatLng;
    _limitOffset(offset: L.Point, bounds?: L.LatLngBounds): L.Point;
    _move(center: L.LatLng, zoom?: number, data?: object, suppressEvent?: boolean): this;
    _animateZoom(center: L.LatLng, zoom: number, start?: boolean, noUpdate?: boolean): void;
    _rawPanBy(offset: L.Point): void;
    _onPanTransitionStep(): void;
    _getMapPanePos(): L.Point;
    dragging: L.Handler & { _draggable?: Draggable };
}

const controllers = new WeakMap<L.Map, CoverageBounds>();
export const getCoverageBounds = (map: L.Map) => controllers.get(map);
const REBOUND_PX = 96;

/** Instance-local camera admission shared by Leaflet and the wheel handler. */
export class CoverageBounds {
    private readonly map: CameraMap;
    private options?: Options;
    private levels = new Map<number, Rect[]>();
    private frame?: { key: string; scale: number; patch: L.Point; hard: Rect[]; soft: Rect[] };
    private panCenter?: L.LatLng;
    private zoomFrame?: number;
    private zoomEnd?: () => void;
    private readonly restore: () => void;
    private readonly view: Window | null;
    private readonly resizeObserver?: ResizeObserver;

    constructor(map: L.Map) {
        this.map = map as CameraMap;
        const camera = this.map;
        const original = {
            limitCenter: camera._limitCenter.bind(camera),
            limitOffset: camera._limitOffset.bind(camera),
            move: camera._move.bind(camera),
            animateZoom: camera._animateZoom.bind(camera),
            rawPanBy: camera._rawPanBy.bind(camera),
            panStep: camera._onPanTransitionStep.bind(camera),
            stop: camera._stop.bind(camera),
            zoomEnd: camera._onZoomTransitionEnd.bind(camera),
        };
        camera._limitCenter = (center, zoom, bounds) => this.active(zoom)
            ? this.limitCenter(center, zoom) : original.limitCenter(center, zoom, bounds);
        camera._limitOffset = (offset, bounds) => {
            if (!this.active(camera.getZoom())) return original.limitOffset(offset, bounds);
            const zoom = camera.getZoom(), from = camera.getCenter();
            const to = camera.unproject(camera.project(from, zoom).add(offset), zoom);
            const result = this.pan(to, zoom, false);
            return camera.project(result.center, zoom).subtract(camera.project(from, zoom));
        };
        camera._move = (center, zoom = camera.getZoom(), data, suppress) => {
            const continuous = (data as { pinch?: boolean; flyTo?: boolean } | undefined);
            const target = continuous?.pinch || continuous?.flyTo
                ? this.zoom(center, zoom) : this.limitCenter(center, zoom, true);
            // Leaflet retains its original pinch anchor between touch events.
            // Rebase after a wall contact so reversing direction responds at once.
            const touch = camera.touchZoom;
            if (continuous?.pinch && touch._zooming && !target.equals(center)) {
                const offset = camera.project(target, zoom).subtract(camera.project(center, zoom));
                for (const key of ['_pinchStartLatLng', '_startLatLng'] as const) {
                    const anchor = touch[key];
                    if (anchor) touch[key] = camera.unproject(camera.project(anchor, zoom).add(offset), zoom);
                }
                touch._center = target;
            }
            this.panCenter = target;
            return original.move(target, zoom, data, suppress);
        };
        // CSS zoom only admits the endpoint: its interpolated transforms can
        // cross a coverage hole. Drive these animations through the same per-frame
        // camera admission as wheel/pinch zoom, without enabling tile transitions.
        camera._animateZoom = (center, zoom, start, noUpdate) => {
            if (!this.active(zoom)) { original.animateZoom(center, zoom, start, noUpdate); return; }
            this.animateZoom(center, zoom);
        };
        camera._onZoomTransitionEnd = () => {
            if (this.zoomEnd) this.zoomEnd(); else original.zoomEnd();
        };
        camera._stop = () => {
            this.zoomEnd?.();
            return original.stop();
        };
        camera._rawPanBy = (offset) => {
            const zoom = camera.getZoom();
            if (!this.active(zoom)) { original.rawPanBy(offset); return; }
            const from = camera.project(camera.getCenter(), zoom);
            const frame = this.active(zoom)!;
            const target = sweep(from.divideBy(frame.scale), from.add(offset).divideBy(frame.scale), frame.hard)
                .multiplyBy(frame.scale);
            original.rawPanBy(target.subtract(from));
            this.panCenter = camera.getCenter();
        };
        // PosAnimation moves the pane before firing its step event. Correct it
        // in the same JS turn, before Leaflet notifies layers or a frame paints.
        camera._onPanTransitionStep = () => {
            const zoom = camera.getZoom(), frame = this.active(zoom);
            if (frame && this.panCenter) {
                const from = camera.project(this.panCenter, zoom).divideBy(frame.scale);
                const raw = camera.project(camera.getCenter(), zoom).divideBy(frame.scale);
                const target = sweep(nearest(from, frame.hard), raw, frame.hard);
                this.correctPane(raw.subtract(target).multiplyBy(frame.scale));
            }
            this.panCenter = camera.getCenter();
            original.panStep();
        };
        camera.dragging._draggable?.on('predrag', this.onPreDrag);
        camera.on('resize', this.refresh);
        camera.on('movestart', this.onMoveStart);
        camera.on('moveend', this.settle);
        this.view = camera.getContainer().ownerDocument.defaultView;
        // Leaflet's window resize handler waits for rAF. Update synchronously
        // so a newly exposed strip cannot paint against the old viewport size.
        this.view?.addEventListener('resize', this.onResize);
        if (typeof ResizeObserver !== 'undefined') {
            this.resizeObserver = new ResizeObserver(this.onResize);
            this.resizeObserver.observe(camera.getContainer());
        }
        controllers.set(map, this);
        this.restore = () => {
            camera._limitCenter = original.limitCenter;
            camera._limitOffset = original.limitOffset;
            camera._move = original.move;
            camera._animateZoom = original.animateZoom;
            camera._rawPanBy = original.rawPanBy;
            camera._onPanTransitionStep = original.panStep;
            camera._stop = original.stop;
            camera._onZoomTransitionEnd = original.zoomEnd;
        };
    }

    private animateZoom(center: L.LatLng, zoom: number) {
        this.zoomEnd?.();
        const camera = this.map;
        const startZoom = camera.getZoom();
        const from = camera.project(camera.getCenter(), startZoom);
        const to = camera.project(center, startZoom);
        const denominator = 1 - 2 ** (startZoom - zoom);
        const started = performance.now();
        camera._animatingZoom = true;
        camera._animateToZoom = startZoom;
        const finish = () => {
            if (this.zoomFrame !== undefined) cancelAnimationFrame(this.zoomFrame);
            this.zoomFrame = undefined;
            this.zoomEnd = undefined;
            camera._animatingZoom = false;
            camera._moveEnd(true);
        };
        this.zoomEnd = finish;
        const step = (time: number) => {
            const t = Math.min(1, (time - started) / 250);
            const eased = 1 - (1 - t) ** 3;
            const nextZoom = startZoom + (zoom - startZoom) * eased;
            const fraction = Math.abs(denominator) < 1e-8 ? eased : (1 - 2 ** (startZoom - nextZoom)) / denominator;
            const requested = camera.unproject(from.add(to.subtract(from).multiplyBy(fraction)), startZoom);
            camera._animateToZoom = nextZoom;
            camera._move(requested, nextZoom, { pinch: true, round: false });
            if (t < 1) this.zoomFrame = requestAnimationFrame(step);
            else finish();
        };
        this.zoomFrame = requestAnimationFrame(step);
    }

    setCoverage(options: Options) {
        this.options = options;
        this.levels.clear();
        this.frame = undefined;
    }

    clear() {
        this.zoomEnd?.();
        this.options = undefined;
        this.frame = undefined;
        this.levels.clear();
        this.panCenter = undefined;
    }

    private active(zoom: number) {
        const options = this.options;
        const size = this.map.getSize();
        if (!options || size.x <= 0 || size.y <= 0) return undefined;
        const level = Math.max(0, Math.min(options.maxNativeZoom, Math.round(zoom)));
        const scale = options.tileSize * 2 ** (zoom - level);
        const key = `${level}/${scale}/${size.x}/${size.y}`;
        if (this.frame?.key === key) return this.frame;
        let rows = this.levels.get(level);
        if (!rows) {
            rows = coverageRects(coverageRows(options.coverage.zooms[String(level)] ?? {}, options.suffixes));
            this.levels.set(level, rows);
        }
        const viewport = size.divideBy(scale);
        const patch = visiblePatch(rows, viewport);
        const hard = cameraRects(rows, viewport, 0, patch);
        if (!hard.length) return undefined;
        const soft = cameraRects(rows, viewport, REBOUND_PX / scale, patch);
        this.frame = { key, scale, patch, hard, soft: soft.length ? soft : hard };
        return this.frame;
    }

    /** Choose a reachable resting point; a rebound must never cross a hole. */
    private rest(point: L.Point, frame: NonNullable<CoverageBounds['frame']>): L.Point {
        if (frame.soft.some((rect) => contains(rect, point))) return point;
        let closest = point, distance = Infinity;
        for (const rect of frame.soft) {
            const candidate = nearest(point, [rect]);
            const d = candidate.distanceTo(point);
            if (d < distance && sweep(point, candidate, frame.hard).distanceTo(candidate) < 1e-7) {
                closest = candidate; distance = d;
            }
        }
        return closest;
    }

    limitCenter(center: L.LatLng, zoom: number, hard = false): L.LatLng {
        const frame = this.active(zoom);
        if (!frame) return center;
        const point = this.map.project(center, zoom).divideBy(frame.scale);
        const target = hard ? nearest(point, frame.hard) : this.rest(nearest(point, frame.hard), frame);
        return this.map.unproject(target.multiplyBy(frame.scale), zoom);
    }

    /** Follow the requested zoom anchor until the visible patch reaches an edge. */
    zoom(center: L.LatLng, zoom: number): L.LatLng {
        const frame = this.active(zoom);
        if (!frame || !this.map._loaded || !this.map.getPixelOrigin()) return this.limitCenter(center, zoom, true);
        const from = nearest(this.map.project(this.map.getCenter(), zoom).divideBy(frame.scale), frame.hard);
        const requested = this.map.project(center, zoom).divideBy(frame.scale);
        return this.map.unproject(slide(from, requested, frame.hard).multiplyBy(frame.scale), zoom);
    }

    /** Keep elastic movement inside the hard visibility domain. */
    pan(center: L.LatLng, zoom: number, elastic = true) {
        const frame = this.active(zoom);
        if (!frame) return { center, overdrag: 0 };
        const from = nearest(this.map.project(this.map.getCenter(), zoom).divideBy(frame.scale), frame.hard);
        const raw = this.map.project(center, zoom).divideBy(frame.scale);
        const start = this.rest(from, frame);
        const soft = frame.soft.some((rect) => contains(rect, start)) ? frame.soft : frame.hard;
        const resting = slide(start, raw, soft);
        const resist = (value: number) => Math.sign(value) * REBOUND_PX / frame.scale
            * (1 - Math.exp(-Math.abs(value) * frame.scale * 0.65 / REBOUND_PX));
        const over = raw.subtract(resting);
        const requested = elastic ? resting.add(L.point(resist(over.x), resist(over.y))) : resting;
        const visual = slide(from, requested, frame.hard);
        const displacement = visual.subtract(resting);
        return { center: this.map.unproject(visual.multiplyBy(frame.scale), zoom),
            overdrag: Math.max(Math.abs(displacement.x), Math.abs(displacement.y)) * frame.scale };
    }

    isVisible(center = this.map.getCenter(), zoom = this.map.getZoom()): boolean {
        const frame = this.active(zoom);
        if (!frame) return true;
        const point = this.map.project(center, zoom).divideBy(frame.scale);
        return frame.hard.some((rect) => contains(rect, point));
    }

    isOverdragged(): boolean {
        const offset = this.map.project(this.map.getCenter()).subtract(this.map.project(
            this.limitCenter(this.map.getCenter(), this.map.getZoom()),
        ));
        // Leaflet truncates each pan axis to integer pixels. A diagonal with
        // both axes below one pixel cannot settle via panTo, even if its length
        // exceeds one pixel; treating it as overdrag would recurse on moveend.
        return Math.max(Math.abs(offset.x), Math.abs(offset.y)) > 1;
    }

    private correctPane(offset: L.Point) {
        const pane = this.map.getPane('mapPane');
        if (pane) L.DomUtil.setPosition(pane, this.map._getMapPanePos().add(offset));
    }

    private onPreDrag = () => {
        const draggable = this.map.dragging._draggable;
        if (!draggable || !this.options) return;
        const zoom = this.map.getZoom();
        const current = this.map.project(this.map.getCenter(), zoom);
        const desired = current.add(this.map._getMapPanePos()).subtract(draggable._newPos);
        const target = this.pan(this.map.unproject(desired, zoom), zoom).center;
        draggable._newPos = this.map._getMapPanePos().add(current.subtract(this.map.project(target, zoom)));
    };

    private onMoveStart = () => {
        // Leaflet marks the first reset loaded before installing its pixel origin.
        if (this.map._loaded && this.map.getPixelOrigin()) this.panCenter = this.map.getCenter();
    };

    private onResize = () => {
        if (!this.map._loaded) return;
        this.map.invalidateSize({ animate: false });
        this.refresh();
    };

    refresh = () => {
        this.frame = undefined;
        if (!this.options || !this.map._loaded) return;
        if (this.isVisible()) return;
        const center = this.limitCenter(this.map.getCenter(), this.map.getZoom(), true);
        this.map.setView(center, this.map.getZoom(), { animate: false });
    };

    private settle = () => {
        if (!this.options || !this.map._loaded || this.map._panAnim?._inProgress || !this.isOverdragged()) return;
        this.map.panTo(this.limitCenter(this.map.getCenter(), this.map.getZoom()), { animate: true, duration: 0.2 });
    };

    dispose() {
        this.map.dragging._draggable?.off('predrag', this.onPreDrag);
        this.map.off('resize', this.refresh);
        this.map.off('movestart', this.onMoveStart);
        this.map.off('moveend', this.settle);
        this.view?.removeEventListener('resize', this.onResize);
        this.resizeObserver?.disconnect();
        this.clear();
        this.restore();
        controllers.delete(this.map);
    }
}
