// @vitest-environment jsdom
import L from 'leaflet';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canvasSurface } from './canvasMarkerSurface';
import { canvasPadding } from './canvasViewport';
import { ViewportMarker } from './markerViewport';
import styles from '../marker/marker.module.scss';
const cleanups: (() => void)[] = [];
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); history.replaceState(null, '', '/'); });
function fixture() {
  vi.stubGlobal('devicePixelRatio', 2);
  vi.stubGlobal('requestAnimationFrame', () => 0); vi.stubGlobal('cancelAnimationFrame', () => {});
  const host = document.createElement('div'); document.body.append(host);
  Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
  const map = L.map(host, { crs: L.CRS.Simple, zoomAnimation: false }).setView([0, 0], 2);
  const point = new ViewportMarker([0, 0], { icon: L.divIcon({ className: styles.incompleteMarker,
    html: `<span class="${styles.markerInner}">point</span>`, iconSize: [32, 32], iconAnchor: [16, 32] }) }).addTo(map);
  map.fire('move');
  const surface = canvasSurface(map), canvas = host.querySelector('canvas')!, clear = vi.fn();
  canvas.getContext('2d')!.clearRect = clear;
  cleanups.push(() => { map.remove(); host.remove(); });
  return { host, map, point, surface, canvas, clear };
}
describe('Retained camera surface', () => {
  it('reuses small camera moves and repaints after exhausting coverage', () => {
    const { map, canvas, clear } = fixture();
    expect(canvas.width * canvas.height).toBeLessThanOrEqual(800 * 600 * 4 * 1.5);
    map.panBy([12, 7], { animate: false }); expect(clear).not.toHaveBeenCalled();
    map.panBy([180, 0], { animate: false }); expect(clear).toHaveBeenCalled();
  });
  it('preserves point coordinates, node identity and click ownership', () => {
    const { map, host, point, surface } = fixture(), node = point.getElement(), clicked = vi.fn();
    point.on('click', clicked); map.panBy([15, 8], { animate: false });
    expect(surface.visualPosition(point)?.equals(point.getLatLng())).toBe(true);
    expect(point.getElement()).toBe(node);
    const p = map.latLngToContainerPoint(point.getLatLng());
    host.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: p.x, clientY: p.y - 16 }));
    expect(clicked).toHaveBeenCalledOnce();
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
    const { map, point, canvas, clear } = fixture(), node = point.getElement();
    map.setZoom(3); expect(clear).toHaveBeenCalled(); clear.mockClear();
    vi.stubGlobal('devicePixelRatio', 3); map.fire('move');
    expect(canvas.width).toBe(2862); expect(clear).toHaveBeenCalled(); expect(point.getElement()).toBe(node);
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
