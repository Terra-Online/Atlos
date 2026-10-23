import L from 'leaflet';
import { describe, expect, it, vi } from 'vitest';
import { createBehaviorCanvasLayer } from './BehaviorCanvasLayer';
import { emptyBehaviorScene, wallScene } from './behaviorScene';

describe('wall hover', () => {
    it('hits the expanded segment and clears on interactions, scene replacement and removal', () => {
        vi.useFakeTimers();
        const palette = document.createElement('style');
        palette.textContent = '.behaviorOverlayPane { --behavior-wall-color: rgb(255, 196, 40); --behavior-wall-hover-color: rgb(255, 229, 36); }';
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
