import L from 'leaflet';
import { afterEach, expect, it, vi } from 'vitest';
import { CoverageBounds } from './coverageBounds';
import { SmoothWheelZoom } from './smoothWheelZoom';
import { isMapOverdragged } from './mapOverdrag';

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

function fixture() {
    const host = document.createElement('div');
    Object.defineProperties(host, { clientWidth: { value: 800, configurable: true }, clientHeight: { value: 600, configurable: true } });
    document.body.appendChild(host);
    const map = L.map(host, { crs: L.CRS.Simple, zoomAnimation: false, zoomSnap: 0, maxZoom: 4 });
    const constraint = new CoverageBounds(map);
    constraint.setCoverage({ coverage: { zooms: { '0': { '': { '0': [0, 4], '1': [0, 0], '2': [0, 0], '3': [0, 0] } } } },
        suffixes: [''], tileSize: 200, maxNativeZoom: 0 });
    map.setView([-100, 100], 0);
    cleanups.push(() => { constraint.dispose(); map.remove(); host.remove(); });
    return { map, constraint, host };
}

it('keeps rebound visible and constrains movement even with maxBounds removed', () => {
    const { map, constraint } = fixture();
    map.setMaxBounds(null as unknown as L.LatLngBoundsExpression);
    const result = constraint.pan(L.latLng(10000, -10000), 0);
    expect(result.overdrag).toBeGreaterThan(0);
    expect(constraint.isVisible(result.center, 0)).toBe(true);
    const resting = constraint.limitCenter(result.center, 0);
    expect(map.project(resting).distanceTo(map.project(result.center))).toBeGreaterThan(0);
    map.panBy([-10000, -10000], { animate: false });
    expect(constraint.isVisible()).toBe(true);
    map.setView(resting, 0, { animate: false });
    expect(isMapOverdragged(map)).toBe(false);
});

it('admits raw native dragging before the pane position changes', () => {
    const { map, constraint } = fixture();
    const dragging = map.dragging as L.Handler & { _draggable: L.Evented & { _newPos: L.Point } };
    const pane = map.getPane('mapPane')!;
    const previous = L.DomUtil.getPosition(pane);
    dragging._draggable._newPos = previous.add([10000, 10000]);
    dragging._draggable.fire('predrag');
    const target = map.unproject(map.project(map.getCenter()).add(previous).subtract(dragging._draggable._newPos));
    expect(constraint.isVisible(target)).toBe(true);
    expect(L.DomUtil.getPosition(pane)).toEqual(previous);
});

it('projects restored or navigation views and overzoomed viewports back into coverage', () => {
    const { map, constraint } = fixture();
    for (const zoom of [0, 0.37, 2, 3.5]) {
        map.setView([10000, -10000], zoom, { animate: false });
        expect(constraint.isVisible()).toBe(true);
    }
});

it('updates the viewport in the resize event instead of leaving a stale-size frame', () => {
    const { map, constraint, host } = fixture();
    map.setZoom(3.5, { animate: false });
    Object.defineProperties(host, { clientWidth: { value: 300 }, clientHeight: { value: 900 } });
    window.dispatchEvent(new Event('resize'));
    expect(map.getSize()).toEqual(L.point(300, 900));
    expect(constraint.isVisible()).toBe(true);
});

it('checks every frame of animated zoom and never enables unchecked CSS interpolation', () => {
    const { map, constraint } = fixture();
    const any3d = L.Browser.any3d;
    Object.defineProperty(L.Browser, 'any3d', { value: true, configurable: true });
    cleanups.push(() => { Object.defineProperty(L.Browser, 'any3d', { value: any3d, configurable: true }); });
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    cleanups.push(() => vi.unstubAllGlobals());
    let samples = 0;
    map.on('zoom', () => {
        samples++;
        expect(constraint.isVisible()).toBe(true);
        expect(map.getPane('mapPane')!.classList.contains('leaflet-zoom-anim')).toBe(false);
    });
    const start = performance.now();
    (map as L.Map & { _animateZoom(center: L.LatLng, zoom: number, start: boolean): void })
        ._animateZoom(L.latLng(1000, -1000), 3.5, true);
    for (let elapsed = 16; elapsed <= 272 && frames.length; elapsed += 16) frames.shift()!(start + elapsed);
    expect(map.getZoom()).toBe(3.5);
    expect(samples).toBeGreaterThan(10);
});

it('rebases pinch and mouse anchors at a coverage wall, including without maxBounds', () => {
    const { map, constraint, host } = fixture();
    map.setMaxBounds(null as unknown as L.LatLngBoundsExpression);
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.push(callback); return frames.length; });
    vi.stubGlobal('cancelAnimationFrame', () => {});
    cleanups.push(() => vi.unstubAllGlobals());
    const wheel = new SmoothWheelZoom(map, { enableInertia: false, constrainZoom: (center, zoom) => constraint.zoom(center, zoom) });
    cleanups.push(() => wheel.dispose());
    host.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect;
    Object.defineProperties(host, { offsetWidth: { value: 800 }, offsetHeight: { value: 600 } });
    for (let i = 0; i < 15; i++) {
        host.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -12, clientX: 30, clientY: 30 }));
        while (frames.length) frames.shift()!(performance.now());
        expect(constraint.isVisible()).toBe(true);
    }
    const internal = wheel as unknown as { anchorLatLng: L.LatLng; anchorPoint: L.Point };
    const expected = map.project(map.getCenter()).add(internal.anchorPoint.subtract(map.getSize().divideBy(2)));
    expect(map.project(internal.anchorLatLng).distanceTo(expected)).toBeLessThan(1e-6);
    const touch = map.touchZoom as L.Handler & { _zooming: boolean; _pinchStartLatLng: L.LatLng; _center: L.LatLng };
    touch._zooming = true;
    touch._pinchStartLatLng = map.getCenter();
    const before = touch._pinchStartLatLng;
    const raw = L.latLng(10000, -10000);
    (map as L.Map & { _move(center: L.LatLng, zoom: number, data: object): void })._move(raw, 2.37, { pinch: true });
    expect(constraint.isVisible()).toBe(true);
    expect(touch._pinchStartLatLng.equals(before)).toBe(false);
    expect(touch._center.equals(map.getCenter())).toBe(true);
    touch._zooming = false;
});

it('does not repeatedly rebound a subpixel diagonal that Leaflet truncates to zero', () => {
    const { map, constraint } = fixture();
    const wheel = new SmoothWheelZoom(map, { enableInertia: false });
    cleanups.push(() => wheel.dispose());
    const rest = constraint.limitCenter(L.latLng(10000, -10000), 0);
    map.setView(rest, 0, { animate: false });
    const delta = map.project(rest).subtract(map.project(map.getCenter())).subtract(L.point(0.8, 0.8));
    (map as L.Map & { _rawPanBy(offset: L.Point): void })._rawPanBy(delta);
    const offset = map.project(map.getCenter()).subtract(map.project(constraint.limitCenter(map.getCenter(), 0)));
    expect(offset.distanceTo(L.point(0, 0))).toBeGreaterThan(1);
    expect(constraint.isOverdragged()).toBe(false);
    expect(() => map.fire('moveend')).not.toThrow();
});
