// @vitest-environment jsdom
import L from 'leaflet';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canvasSurface } from '@/services/map/core/canvas/canvasMarkerSurface';
import { canvasPadding } from '@/services/map/core/canvas/canvasViewport';
import { ViewportMarker } from '@/services/map/core/canvas/markerViewport';
import { SceneIcon, setMarkerState } from '@/services/map/core/canvas/markerModel';
const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); history.replaceState(null, '', '/'); });
function fixture() {
  vi.stubGlobal('devicePixelRatio', 2);
  vi.stubGlobal('requestAnimationFrame', () => 0); vi.stubGlobal('cancelAnimationFrame', () => {});
  const host = document.createElement('div'); document.body.append(host);
  Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
  const map = L.map(host, { crs: L.CRS.Simple, zoomAnimation: false }).setView([0, 0], 2);
  const point = new ViewportMarker([0, 0], { icon: new SceneIcon({ image: '', subImage: '', tier: '', noFrame: false }, 'point') }).addTo(map);
  map.fire('move');
  const surface = canvasSurface(map), canvas = host.querySelector('canvas')!, clear = vi.fn();
  canvas.getContext('2d')!.clearRect = clear;
  cleanups.push(() => { map.remove(); host.remove(); });
  return { host, map, point, surface, canvas, clear };
}
describe('Retained camera surface', () => {
  it('does not repaint unchanged explicit state, but still paints changed opacity', () => {
    const { point, map, clear } = fixture();
    setMarkerState(point, { selected: false, checked: false });
    map.fire('move');
    expect(clear).not.toHaveBeenCalled();
    point.setOpacity(0.5);
    map.fire('move');
    expect(clear).toHaveBeenCalled();
  });
  it('reuses small camera moves and repaints after exhausting coverage', () => {
    const { map, canvas, clear } = fixture();
    expect(canvas.width * canvas.height).toBeLessThanOrEqual(800 * 600 * 4 * 1.5);
    map.panBy([12, 7], { animate: false }); expect(clear).not.toHaveBeenCalled();
    map.panBy([180, 0], { animate: false }); expect(clear).toHaveBeenCalled();
  });
  it('preserves point coordinates and click ownership through retained pans', () => {
    const { map, host, point, surface } = fixture(), clicked = vi.fn();
    point.on('click', clicked); map.panBy([15, 8], { animate: false });
    expect(surface.visualPosition(point)?.equals(point.getLatLng())).toBe(true);
    expect(map.hasLayer(point)).toBe(true);
    const p = map.latLngToContainerPoint(point.getLatLng());
    host.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: p.x, clientY: p.y - 16 }));
    expect(clicked).toHaveBeenCalledOnce();
  });
  it('routes a canvas context menu event to the exact marker', () => {
    const { map, host, point } = fixture(), opened = vi.fn((event: L.LeafletMouseEvent) => event.originalEvent.preventDefault());
    point.on('contextmenu', opened);
    const p = map.latLngToContainerPoint(point.getLatLng());
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y - 16 });
    host.dispatchEvent(event);
    expect(opened).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });
  it('preserves the original click event, modifiers and logical coordinates through FeatureGroup propagation', () => {
    const { map, host, point } = fixture(), clicked = vi.fn<(event: L.LeafletMouseEvent) => void>(), grouped = vi.fn<(event: L.LeafletMouseEvent) => void>();
    point.on('click', clicked); L.featureGroup([point]).addTo(map).on('click', grouped);
    const p = map.latLngToContainerPoint(point.getLatLng());
    const event = new MouseEvent('click', { bubbles: true, cancelable: true,
      clientX: p.x, clientY: p.y - 16, ctrlKey: true, metaKey: true, shiftKey: true, altKey: true });
    host.dispatchEvent(event);
    expect(clicked).toHaveBeenCalledOnce(); expect(grouped).toHaveBeenCalledOnce();
    const emitted = clicked.mock.calls[0][0];
    expect(emitted.originalEvent).toBe(event);
    expect(emitted.latlng).toEqual(point.getLatLng());
    expect(emitted.containerPoint).toEqual(p);
    expect(grouped.mock.calls[0][0].layer).toBe(point);
  });
  it.each([false, true])('honors bubblingMouseEvents=%s for a directly hit point', bubbling => {
    const { map, host, point } = fixture(), clicked = vi.fn(), mapClicked = vi.fn();
    point.options.bubblingMouseEvents = bubbling;
    point.on('click', clicked); map.on('click', mapClicked);
    const p = map.latLngToContainerPoint(point.getLatLng());
    host.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: p.x, clientY: p.y - 16 }));
    expect(clicked).toHaveBeenCalledOnce();
    expect(mapClicked).toHaveBeenCalledTimes(bubbling ? 1 : 0);
  });
  it('suppresses a click after a map drag even when its final position matches the pointer press', () => {
    const { map, host, point } = fixture(), clicked = vi.fn();
    point.on('click', clicked);
    const p = map.latLngToContainerPoint(point.getLatLng());
    host.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, clientX: p.x, clientY: p.y - 16 }));
    vi.spyOn(map.dragging as L.Handler & { moved(): boolean }, 'moved').mockReturnValue(true);
    host.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: p.x, clientY: p.y - 16 }));
    expect(clicked).not.toHaveBeenCalled();
  });
  it('leaves Alt context menus native and preserves the original ordinary context event', () => {
    const { map, host, point } = fixture(), opened = vi.fn<(event: L.LeafletMouseEvent) => void>();
    point.on('contextmenu', opened);
    const p = map.latLngToContainerPoint(point.getLatLng());
    const init = { bubbles: true, cancelable: true, clientX: p.x, clientY: p.y - 16, button: 2 };
    const native = new MouseEvent('contextmenu', { ...init, altKey: true });
    host.dispatchEvent(native);
    expect(opened).not.toHaveBeenCalled(); expect(native.defaultPrevented).toBe(false);
    const ordinary = new MouseEvent('contextmenu', init); host.dispatchEvent(ordinary);
    expect(opened).toHaveBeenCalledOnce();
    expect(opened.mock.calls[0][0].originalEvent).toBe(ordinary);
  });
  it('updates stationary-pointer hover and emits viewport exit only once', () => {
    vi.stubGlobal('PointerEvent', MouseEvent);
    const { map, host, point } = fixture(), leave = vi.fn(), hidden = vi.fn();
    point.on('mouseout', leave); point.on('viewporthide', hidden);
    const p = map.latLngToContainerPoint(point.getLatLng());
    host.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: p.x, clientY: p.y - 16 }));
    map.panBy([24, 0], { animate: false }); expect(leave).toHaveBeenCalledOnce();
    map.panBy([600, 0], { animate: false }); expect(hidden).toHaveBeenCalledOnce();
  });
  it('repaints zoom and density changes without changing point identity', () => {
    const { map, point, canvas, clear } = fixture();
    map.setZoom(3); expect(clear).toHaveBeenCalled(); clear.mockClear();
    vi.stubGlobal('devicePixelRatio', 3); map.fire('move');
    expect(canvas.width).toBe(2862); expect(clear).toHaveBeenCalled(); expect(map.hasLayer(point)).toBe(true);
  });
  it('ignores obsolete experiment URL parameters', () => {
    history.replaceState(null, '', '/?canvasMode=baseline&canvasPadding=64');
    const { map, clear } = fixture();
    map.panBy([20, 10], { animate: false }); expect(clear).not.toHaveBeenCalled();
  });
  it.each([[1440, 900], [800, 600], [320, 200], [0, 0]])('caps backing pixels for %s × %s', (width, height) => {
    const padding = canvasPadding(width, height);
    expect(padding).toBeLessThanOrEqual(128);
    expect((width + 2 * padding) * (height + 2 * padding)).toBeLessThanOrEqual(width * height * 1.5);
  });
});
