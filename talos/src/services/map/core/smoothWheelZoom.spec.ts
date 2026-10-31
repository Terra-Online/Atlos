import L from 'leaflet';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SmoothWheelZoom } from '@/services/map/core/smoothWheelZoom';
import { CoverageBounds } from './coverageBounds';
import { WHEEL_GESTURE_IDLE_MS } from 'trackpad-input';

let container: HTMLDivElement;
let map: L.Map;
let smoothWheel: SmoothWheelZoom;
let nextFrameId: number;
let animationFrames: Map<number, FrameRequestCallback>;
let coverage: CoverageBounds | undefined;

const constrainToCoverage = () => {
    smoothWheel.dispose();
    const controller = new CoverageBounds(map);
    controller.setCoverage({
        coverage: { zooms: { '0': { '': Object.fromEntries(Array.from({ length: 6 }, (_, i) => [i - 3, [-4, 3]])) } } },
        suffixes: [''], tileSize: 25, maxNativeZoom: 0,
    });
    coverage = controller;
    smoothWheel = new SmoothWheelZoom(map, {
        enableInertia: false,
        constrainPan: (center, zoom) => controller.pan(center, zoom),
        constrainZoom: (center, zoom) => controller.zoom(center, zoom),
    });
    return controller;
};

interface LegacyWheelFields {
    wheelDelta: number;
    wheelDeltaX: number;
    wheelDeltaY: number;
}

const flushAnimationFrames = () => {
    while (animationFrames.size > 0) {
        const frames = [...animationFrames.values()];
        animationFrames.clear();
        frames.forEach((frame) => frame(performance.now()));
    }
};

const dispatchWheel = (
    init: WheelEventInit,
    extraFields: Partial<LegacyWheelFields> & { timeStamp?: number } = {},
    flushFrames = true,
) => {
    const event = new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        clientX: 400,
        clientY: 300,
        deltaMode: WheelEvent.DOM_DELTA_PIXEL,
        ...init,
    });
    Object.entries(extraFields).forEach(([key, value]) => {
        Object.defineProperty(event, key, { value });
    });
    container.dispatchEvent(event);
    if (flushFrames) flushAnimationFrames();
    return event;
};

beforeEach(() => {
    vi.useFakeTimers();
    nextFrameId = 1;
    animationFrames = new Map();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
        const frameId = nextFrameId;
        nextFrameId += 1;
        animationFrames.set(frameId, callback);
        return frameId;
    });
    vi.stubGlobal('cancelAnimationFrame', (frameId: number) => {
        animationFrames.delete(frameId);
    });

    container = document.createElement('div');
    Object.defineProperties(container, {
        clientHeight: { value: 600 },
        clientWidth: { value: 800 },
        offsetHeight: { value: 600 },
        offsetWidth: { value: 800 },
    });
    container.getBoundingClientRect = () =>
        ({
            bottom: 600,
            height: 600,
            left: 0,
            right: 800,
            top: 0,
            width: 800,
            x: 0,
            y: 0,
            toJSON: () => ({}),
        }) as DOMRect;
    document.body.append(container);

    map = L.map(container, {
        crs: L.CRS.Simple,
        maxZoom: 4,
        minZoom: 0,
        scrollWheelZoom: false,
        zoomAnimation: false,
        zoomSnap: 0,
    }).setView([0, 0], 2);
    smoothWheel = new SmoothWheelZoom(map, { enableInertia: false });
});

afterEach(() => {
    smoothWheel.dispose();
    coverage?.dispose();
    coverage = undefined;
    map.remove();
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('SmoothWheelZoom wheel routing', () => {
    it('keeps marker and label positions in subpixel map space', () => {
        const marker = L.marker([0.123, 0.456]).addTo(map);
        const markerElement = marker.getElement();
        expect(markerElement).not.toBeNull();

        const position = L.DomUtil.getPosition(markerElement!);
        const expected = map
            .project(marker.getLatLng(), map.getZoom())
            .subtract(map.getPixelOrigin());

        expect(position.x).toBeCloseTo(expected.x, 10);
        expect(position.y).toBeCloseTo(expected.y, 10);
        expect(position.x).not.toBe(Math.round(position.x));
        expect(position.y).not.toBe(Math.round(position.y));
    });

    it('uses a mouse wheel only for continuous zoom', () => {
        const initialCenter = map.getCenter();
        const events: string[] = [];
        map.on('movestart zoomstart move zoom zoomend moveend', (event) => {
            events.push(event.type);
        });

        const event = dispatchWheel(
            { deltaY: -400 },
            { wheelDelta: 120, wheelDeltaY: 120 },
        );

        expect(event.defaultPrevented).toBe(true);
        expect(map.getZoom()).toBeGreaterThan(2);
        expect(map.getCenter().distanceTo(initialCenter)).toBeLessThan(1e-9);
        expect(events.slice(0, 4)).toEqual([
            'zoomstart',
            'movestart',
            'zoom',
            'move',
        ]);

        vi.advanceTimersByTime(WHEEL_GESTURE_IDLE_MS);
        expect(events.slice(-2)).toEqual(['zoomend', 'moveend']);
    });

    it('zooms a fast pure vertical mouse stream immediately', () => {
        const initialCenter = map.getCenter();
        const events: string[] = [];
        const continuousMap = map as L.Map & {
            _limitZoom(zoom: number): number;
        };
        continuousMap._limitZoom = (zoom) => zoom;
        map.on('movestart zoomstart move zoom zoomend moveend', (event) => {
            events.push(event.type);
        });

        dispatchWheel({ deltaY: 3 }, { wheelDelta: -120, wheelDeltaY: -120 });
        dispatchWheel({ deltaY: 5 }, { wheelDelta: -120, wheelDeltaY: -120 });

        expect(map.getZoom()).not.toBe(2);
        expect(map.getCenter().equals(initialCenter)).toBe(true);
        expect(events).not.toContain('drag');

        vi.advanceTimersByTime(WHEEL_GESTURE_IDLE_MS);
        expect(events.slice(-2)).toEqual(['zoomend', 'moveend']);
    });

    it('promotes buffered input to pan on horizontal evidence with legacy fields', () => {
        const initialCenter = map.getCenter();
        const events: string[] = [];
        map.on('dragstart drag dragend', (event) => events.push(event.type));

        dispatchWheel({ deltaY: 3 });
        dispatchWheel(
            { deltaX: 0.01, deltaY: 5 },
            { wheelDelta: -120, wheelDeltaY: -120 },
        );

        expect(map.getZoom()).toBe(2);
        expect(map.getCenter().equals(initialCenter)).toBe(false);
        expect(events[0]).toBe('dragstart');
        expect(events).toContain('drag');

        vi.advanceTimersByTime(WHEEL_GESTURE_IDLE_MS);
        expect(events.at(-1)).toBe('dragend');
    });

    it('limits trackpad overdrag and starts an early coverage rebound', () => {
        const controller = constrainToCoverage();
        const rebound = vi.spyOn(map, 'panBy');

        for (let index = 0; index < 40; index += 1) {
            dispatchWheel({ deltaX: 20, deltaY: 0 });
        }

        const visualOffset = map
            .project(map.getCenter(), map.getZoom())
            .distanceTo(map.project(controller.limitCenter(map.getCenter(), map.getZoom()), map.getZoom()));
        expect(visualOffset).toBeGreaterThanOrEqual(80);
        expect(visualOffset).toBeLessThanOrEqual(96);

        vi.advanceTimersByTime(50);
        expect(controller.isVisible()).toBe(true);
        expect(rebound).toHaveBeenCalled();
    });

    it('never pans a pure vertical legacy mouse stream', () => {
        const initialCenter = map.getCenter();
        const continuousMap = map as L.Map & {
            _limitZoom(zoom: number): number;
        };
        continuousMap._limitZoom = (zoom) => zoom;
        const rawPanBy = vi.spyOn(
            map as L.Map & { _rawPanBy(offset: L.Point): void },
            '_rawPanBy',
        );

        dispatchWheel({ deltaY: 5 }, { wheelDelta: -120, wheelDeltaY: -120 });
        dispatchWheel({ deltaY: 4 }, { wheelDelta: -120, wheelDeltaY: -120 });

        expect(rawPanBy).not.toHaveBeenCalled();
        expect(map.getCenter().equals(initialCenter)).toBe(true);
        expect(map.getZoom()).not.toBe(2);
    });

    it('keeps a vertical legacy momentum frame in the active trackpad pan', () => {
        const continuousMap = map as L.Map & {
            _limitZoom(zoom: number): number;
        };
        continuousMap._limitZoom = (zoom) => zoom;

        dispatchWheel({ deltaX: 0.01, deltaY: 5 });
        const centerAfterPan = map.getCenter();
        const zoomAfterPan = map.getZoom();

        dispatchWheel({ deltaY: 3 }, { wheelDelta: -120, wheelDeltaY: -120 });

        expect(map.getCenter().equals(centerAfterPan)).toBe(false);
        expect(map.getZoom()).toBe(zoomAfterPan);
    });

    it('keeps a decaying diagonal gesture in pan through its vertical momentum tail', () => {
        const initialZoom = map.getZoom();
        const rawPanBy = vi.spyOn(
            map as L.Map & { _rawPanBy(offset: L.Point): void },
            '_rawPanBy',
        );
        const trace = [
            { deltaX: 8, deltaY: 8, timeStamp: 1000, wait: 0 },
            { deltaX: 5.2, deltaY: 5.4, timeStamp: 1008, wait: 5 },
            { deltaX: 2.1, deltaY: 2.4, timeStamp: 0, wait: 27 },
            { deltaX: 0.25, deltaY: 1.1, timeStamp: 1019, wait: 11 },
            { deltaX: 0, deltaY: 0.55, timeStamp: 1016, wait: 74 },
            { deltaX: 0, deltaY: 0.18, timeStamp: 1091, wait: 119 },
        ];

        trace.forEach(({ timeStamp, wait, ...init }, index) => {
            vi.advanceTimersByTime(wait);
            dispatchWheel(
                init,
                index >= 4
                    ? { timeStamp, wheelDelta: -120, wheelDeltaY: -120 }
                    : { timeStamp },
            );
        });

        expect(map.getZoom()).toBe(initialZoom);
        expect(rawPanBy).toHaveBeenCalledTimes(trace.length);
    });

    it('preserves a new pan intent while an old zoom frame is being ended', () => {
        const continuousMap = map as L.Map & {
            _limitZoom(zoom: number): number;
        };
        continuousMap._limitZoom = (zoom) => zoom;

        // Leave the zoom RAF pending so its visual gesture outlives the input
        // session. The first diagonal frame must be able to replace it.
        dispatchWheel(
            { deltaY: -20 },
            { wheelDelta: 120, wheelDeltaY: 120 },
            false,
        );
        vi.advanceTimersByTime(WHEEL_GESTURE_IDLE_MS);

        dispatchWheel({ deltaX: 4, deltaY: 4 });
        const centerAfterDiagonalFrame = map.getCenter();
        const zoomAfterDiagonalFrame = map.getZoom();
        dispatchWheel({ deltaY: 1 }, { wheelDelta: -120, wheelDeltaY: -120 });

        expect(map.getCenter().equals(centerAfterDiagonalFrame)).toBe(false);
        expect(map.getZoom()).toBe(zoomAfterDiagonalFrame);
    });

    it('lets zero-delta momentum frames keep an active pan session alive', () => {
        const continuousMap = map as L.Map & {
            _limitZoom(zoom: number): number;
        };
        continuousMap._limitZoom = (zoom) => zoom;

        dispatchWheel({ deltaX: 4, deltaY: 4 });
        vi.advanceTimersByTime(80);
        dispatchWheel({ deltaX: 0, deltaY: 0 });
        vi.advanceTimersByTime(80);
        const centerBeforeTail = map.getCenter();
        const zoomBeforeTail = map.getZoom();
        dispatchWheel({ deltaY: 0.5 }, { wheelDelta: -120, wheelDeltaY: -120 });

        expect(map.getCenter().equals(centerBeforeTail)).toBe(false);
        expect(map.getZoom()).toBe(zoomBeforeTail);
    });

    it('keeps overdrag momentum in pan after the early visual rebound', () => {
        constrainToCoverage();
        const continuousMap = map as L.Map & {
            _limitZoom(zoom: number): number;
        };
        continuousMap._limitZoom = (zoom) => zoom;

        for (let index = 0; index < 40; index += 1) {
            dispatchWheel({ deltaX: 20, deltaY: 0 });
        }
        vi.advanceTimersByTime(50);
        const zoomBeforeTail = map.getZoom();

        dispatchWheel({ deltaY: 0.5 }, { wheelDelta: -120, wheelDeltaY: -120 });

        expect(map.getZoom()).toBe(zoomBeforeTail);

        vi.advanceTimersByTime(WHEEL_GESTURE_IDLE_MS + 1);
        dispatchWheel({ deltaY: -120 }, { wheelDelta: 120, wheelDeltaY: 120 });
        expect(map.getZoom()).toBeGreaterThan(zoomBeforeTail);
    });

    it('zooms a vertical mouse wheel after the trackpad pan becomes idle', () => {
        const continuousMap = map as L.Map & {
            _limitZoom(zoom: number): number;
        };
        continuousMap._limitZoom = (zoom) => zoom;

        dispatchWheel({ deltaX: 2, deltaY: 5 });
        vi.advanceTimersByTime(WHEEL_GESTURE_IDLE_MS);
        const centerAfterPan = map.getCenter();
        const zoomAfterPan = map.getZoom();

        dispatchWheel({ deltaY: -120 }, { wheelDelta: 120, wheelDeltaY: 120 });

        expect(map.getCenter().equals(centerAfterPan)).toBe(true);
        expect(map.getZoom()).toBeGreaterThan(zoomAfterPan);
    });

    it('routes ctrl-wheel trackpad pinch to zoom', () => {
        const initialCenter = map.getCenter();
        const continuousMap = map as L.Map & {
            _limitZoom(zoom: number): number;
        };
        continuousMap._limitZoom = (zoom) => zoom;

        dispatchWheel({ ctrlKey: true, deltaX: 1, deltaY: -10 });

        expect(map.getZoom()).toBeCloseTo(2.1, 10);
        expect(map.getCenter().distanceTo(initialCenter)).toBeLessThan(1e-9);
    });

    it('adds a short zoom tail when inertia is enabled', () => {
        smoothWheel.dispose();
        smoothWheel = new SmoothWheelZoom(map, { enableInertia: true });
        const continuousMap = map as L.Map & {
            _limitZoom(zoom: number): number;
        };
        continuousMap._limitZoom = (zoom) => zoom;

        dispatchWheel({ ctrlKey: true, deltaY: -10 });

        expect(map.getZoom()).toBeGreaterThan(2.1);
        expect(map.getZoom()).toBeLessThan(2.15);
    });
});
