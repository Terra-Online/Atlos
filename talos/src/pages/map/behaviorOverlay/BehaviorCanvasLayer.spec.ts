import L from 'leaflet';
import { describe, expect, it, vi } from 'vitest';
import { createBehaviorCanvasLayer } from '@/pages/map/behaviorOverlay/BehaviorCanvasLayer';
import { emptyBehaviorScene, wallScene } from '@/pages/map/behaviorOverlay/behaviorScene';
import * as spline from './cubicSpline';

describe('wall hover', () => {
    it('hits the expanded segment and clears on interactions, scene replacement and removal', () => {
        vi.useFakeTimers();
        const palette = document.createElement('style');
        palette.textContent = 'canvas { --behavior-wall-color: rgb(255, 196, 40); --behavior-wall-hover-color: rgb(255, 229, 36); }';
        document.head.appendChild(palette);
        const container = document.createElement('div');
        Object.defineProperties(container, {
            clientWidth: { value: 800 }, clientHeight: { value: 600 },
        });
        document.body.appendChild(container);
        const map = L.map(container, { crs: L.CRS.Simple, zoomAnimation: false }).setView([0, 0], 0);
        const onHover = vi.fn();
        const layer = createBehaviorCanvasLayer(onHover).addTo(map);
        const scene = wallScene([{ segment: [[0, 0], [0, 1]] }]);
        const hover = (offset: number, buttons = 0) => map.fire('mousemove', {
            layerPoint: map.latLngToLayerPoint([0, 0.5]).add([offset, 0]),
            originalEvent: { buttons },
        });
        try {
            layer.setScene(scene, false, false);
            // A 1px source segment expands to 6px on screen.
            hover(2);
            expect(onHover.mock.lastCall?.[0]).toBeInstanceOf(L.Point);
            expect(container.classList.contains('mapSupplementHover')).toBe(true);
            vi.advanceTimersByTime(96);
            const context = container.querySelector('canvas')!.getContext('2d')!;
            expect(context.strokeStyle).not.toBe('rgb(255, 196, 40)');
            expect(context.strokeStyle).not.toBe('rgb(255, 229, 36)');
            vi.advanceTimersByTime(120);
            expect(context.strokeStyle).toBe('rgb(255, 229, 36)');
            const calls = onHover.mock.calls.length;
            hover(1);
            expect(onHover).toHaveBeenCalledTimes(calls);
            hover(20);
            expect(container.classList.contains('mapSupplementHover')).toBe(false);
            vi.advanceTimersByTime(200);
            expect(context.strokeStyle).toBe('rgb(255, 196, 40)');
            expect(onHover).toHaveBeenLastCalledWith(null);
            hover(0);
            hover(0, 1);
            expect(onHover).toHaveBeenLastCalledWith(null);
            for (const event of ['movestart', 'zoomstart', 'click', 'contextmenu']) {
                hover(0);
                map.fire(event);
                expect(onHover).toHaveBeenLastCalledWith(null);
            }
            hover(0);
            container.dispatchEvent(new MouseEvent('mouseleave'));
            expect(onHover).toHaveBeenLastCalledWith(null);
            hover(0);
            layer.setScene(emptyBehaviorScene(), false, false);
            expect(onHover).toHaveBeenLastCalledWith(null);
            layer.setScene(scene, false, false);
            hover(0);
            layer.remove();
            expect(onHover).toHaveBeenLastCalledWith(null);
            const removedCalls = onHover.mock.calls.length;
            hover(0);
            expect(onHover).toHaveBeenCalledTimes(removedCalls);
        } finally {
            map.remove();
            container.remove();
            palette.remove();
            vi.useRealTimers();
        }
    });
});

it('retains static geometry for a small pan and gives empty scenes a minimal buffer', () => {
    const host = document.createElement('div'); document.body.append(host);
    Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
    const map = L.map(host, { crs: L.CRS.Simple, zoomAnimation: false }).setView([0, 0], 0);
    const layer = createBehaviorCanvasLayer().addTo(map);
    const canvas = host.querySelector('canvas')!;
    const clear = vi.fn();
    canvas.getContext('2d')!.clearRect = clear;
    try {
        expect([canvas.width, canvas.height]).toEqual([1, 1]);
        layer.setScene(wallScene([{ segment: [[0, 0], [0, 100]] }]), false, false);
        clear.mockClear();
        map.panBy([10, 0], { animate: false });
        expect(clear).not.toHaveBeenCalled();
        map.panBy([400, 0], { animate: false });
        expect(clear).toHaveBeenCalled();
        layer.setScene(emptyBehaviorScene(), false, false);
        expect([canvas.width, canvas.height]).toEqual([1, 1]);
    } finally { layer.remove(); map.remove(); host.remove(); }
});

it('moves its visibility listener with an adopted map and removes it from the owning document', () => {
    const frame = document.createElement('iframe'); document.body.append(frame);
    const target = frame.contentDocument!;
    const added = vi.spyOn(target, 'addEventListener'), removed = vi.spyOn(target, 'removeEventListener');
    const originalRemoved = vi.spyOn(document, 'removeEventListener');
    const host = document.createElement('div'); document.body.append(host);
    const map = L.map(host, { crs: L.CRS.Simple, zoomAnimation: false }).setView([0, 0], 0);
    const layer = createBehaviorCanvasLayer().addTo(map);
    try {
        target.body.append(host);
        map.fire('resize');
        const listener = added.mock.calls.find(([name]) => name === 'visibilitychange')?.[1];
        expect(listener).toBeTypeOf('function');
        expect(originalRemoved).toHaveBeenCalledWith('visibilitychange', listener);
        layer.remove();
        expect(removed).toHaveBeenCalledWith('visibilitychange', listener);
    } finally { map.remove(); host.remove(); frame.remove(); vi.restoreAllMocks(); }
});

it('reuses solved flow geometry, suspends offscreen motion and resumes when the route returns', () => {
    vi.useFakeTimers();
    const style = document.createElement('style');
    style.textContent = 'canvas { --behavior-relation-color: rgb(255, 196, 40); --behavior-flow-color: rgb(255, 255, 200); }';
    document.head.append(style);
    const host = document.createElement('div'); document.body.append(host);
    Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
    const map = L.map(host, { crs: L.CRS.Simple, zoomAnimation: false }).setView([0, 0], 0);
    const layer = createBehaviorCanvasLayer().addTo(map);
    const canvas = host.querySelector('canvas')!;
    const clear = vi.fn();
    canvas.getContext('2d')!.clearRect = clear;
    const solve = vi.spyOn(spline, 'buildProjectedCurves');
    // The shared jsdom canvas stub has no gradient object; supply that browser API locally.
    const addColorStop = vi.fn();
    canvas.getContext('2d')!.createLinearGradient = () => ({ addColorStop });
    try {
        layer.setScene({ lines: [{ points: [[0, 0], [50, 50], [0, 100]], colorRole: 'relation',
            weight: 2, opacity: 0.8, smooth: true, flow: true, delay: 0, duration: 100,
            cumulativeLengths: [0, 70, 140], totalLength: 140 }], circles: [], timelineDuration: 100 }, false, true);
        vi.advanceTimersByTime(100);
        expect(addColorStop).toHaveBeenCalled();
        expect(solve).toHaveBeenCalledTimes(1);
        clear.mockClear();
        vi.advanceTimersByTime(100);
        expect(clear).toHaveBeenCalled();
        map.panBy([5000, 0], { animate: false });
        vi.advanceTimersByTime(100);
        clear.mockClear();
        vi.advanceTimersByTime(100);
        expect(clear).not.toHaveBeenCalled();
        map.panBy([-5000, 0], { animate: false });
        clear.mockClear();
        vi.advanceTimersByTime(100);
        expect(clear).toHaveBeenCalled();
        expect(solve).toHaveBeenCalledTimes(3);
    } finally { layer.remove(); map.remove(); host.remove(); style.remove(); vi.restoreAllMocks(); vi.useRealTimers(); }
});
