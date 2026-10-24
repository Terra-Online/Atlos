// @vitest-environment jsdom
import L from 'leaflet';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ViewportMarker } from '@/services/map/core/canvas/markerViewport';
import { SceneIcon, getMarkerState, setMarkerState } from '@/services/map/core/canvas/markerModel';
import { canvasSurface } from '@/services/map/core/canvas/canvasMarkerSurface';
import { MarkerPainter } from '@/services/map/core/canvas/canvasMarkerPaint';

let map: L.Map;
let host: HTMLDivElement;
let removed: boolean;
beforeEach(() => {
  removed = false;
  host = document.createElement('div'); document.body.append(host);
  Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
  map = L.map(host, { crs: L.CRS.Simple, zoomAnimation: false }).setView([0, 0], 2);
});
afterEach(() => { if (!removed) map.remove(); host.remove(); });
const marker = (position: L.LatLngExpression) => new ViewportMarker(position, {
  icon: new SceneIcon({ image: '', subImage: '', tier: '', noFrame: false }, 'point'),
});
describe('Canvas marker lifecycle', () => {
  it('consumes scheduled frames without cancelling them and coalesces synchronous camera draws', () => {
    const pending = new Map<number, FrameRequestCallback>();
    let sequence = 0;
    const cancel = vi.fn((id: number) => { pending.delete(id); });
    const clock = vi.spyOn(performance, 'now').mockReturnValue(1000);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      pending.set(++sequence, callback); return sequence;
    });
    vi.stubGlobal('cancelAnimationFrame', cancel);
    try {
      const point = marker([0, 0]).addTo(map);
      expect(pending.size).toBe(1);
      const [id, callback] = [...pending][0];
      pending.delete(id); callback(performance.now());
      expect(cancel).not.toHaveBeenCalled();
      // Initial state reconciliation may schedule the next animation frame.
      expect(pending.size).toBe(1);
      const [nextId, nextCallback] = [...pending][0];
      clock.mockReturnValue(2000);
      pending.delete(nextId); nextCallback(performance.now());
      expect(cancel).not.toHaveBeenCalled();
      expect(pending.size).toBe(0);
      point.setLatLng([1, 1]);
      const queued = sequence;
      expect(pending.size).toBe(1);
      map.fire('move');
      expect(cancel).toHaveBeenCalledExactlyOnceWith(queued);
      expect(pending.size).toBe(0);
    } finally { clock.mockRestore(); vi.unstubAllGlobals(); }
  });
  it.each([1, 1.25, 1.5, 1.75, 2])('uses a 2x backing store at DPR %s without scaling CSS coordinates', ratio => {
    vi.stubGlobal('devicePixelRatio', ratio);
    try {
      marker([0, 0]).addTo(map); map.fire('move');
      const canvas = host.querySelector<HTMLCanvasElement>('.oem-canvas-markers')!;
      expect([canvas.width, canvas.height]).toEqual([1908, 1508]);
      expect([canvas.style.width, canvas.style.height]).toEqual(['954px', '754px']);
      expect(map.latLngToContainerPoint([0, 0])).toEqual(L.point(400, 300));
    } finally { vi.unstubAllGlobals(); }
  });
  it('refreshes physical resolution after a display change without replacing markers', () => {
    let changed: (() => void) | undefined;
    const remove = vi.fn();
    vi.stubGlobal('matchMedia', vi.fn(() => ({
      addEventListener: (_: string, fn: () => void) => { changed = fn; }, removeEventListener: remove,
    })));
    vi.stubGlobal('devicePixelRatio', 1.25);
    try {
      const point = marker([0, 0]).addTo(map);
      map.fire('move');
      const canvas = host.querySelector<HTMLCanvasElement>('.oem-canvas-markers')!;
      expect(canvas.width).toBe(1908);
      expect(canvas.style.width).toBe('954px');
      vi.stubGlobal('devicePixelRatio', 3);
      changed!(); map.fire('move');
      expect(canvas.width).toBe(2862);
      expect(map.hasLayer(point)).toBe(true);
      vi.stubGlobal('devicePixelRatio', 1.5);
      map.fire('move');
      expect(canvas.width).toBe(1908);
      map.remove(); removed = true;
      expect(remove).toHaveBeenCalledTimes(3);
    } finally { vi.unstubAllGlobals(); }
  });
  it('preserves logical members and click ownership while browsing without point nodes', () => {
    const near = marker([0, 0]), far = marker([1000, 1000]), clicked = vi.fn<(event: L.LeafletEvent) => void>();
    far.on('click', clicked);
    const group = L.layerGroup([near, far]).addTo(map);
    expect(map.hasLayer(far)).toBe(true); expect(group.hasLayer(far)).toBe(true);
    expect(far.getElement()).toBeUndefined();
    map.setView([1000, 1000], 2, { animate: false });
    const point = map.latLngToContainerPoint(far.getLatLng());
    host.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: point.x, clientY: point.y - 16 }));
    expect(clicked).toHaveBeenCalledOnce();
    expect(clicked.mock.calls[0][0].target).toBe(far);
    expect(group.getLayers()).toEqual([near, far]);
  });
  it('keeps the shared keyboard proxy outside the moving pane and activates its logical point', () => {
    const point = marker([0, 0]).addTo(map), clicked = vi.fn();
    point.on('click', clicked);
    const semantic = host.querySelector('.oem-canvas-semantics')!;
    const proxy = semantic.querySelector('button')!;
    expect(semantic.parentElement).toBe(host);
    expect(map.getPane('mapPane')!.contains(semantic)).toBe(false);
    expect(host.querySelector('.oem-canvas-markers')!.parentElement).toBe(map.getPane('markerPane'));
    expect(proxy.tabIndex).toBe(0);
    proxy.click();
    expect(clicked).toHaveBeenCalledOnce();
    point.remove(); expect(proxy.tabIndex).toBe(-1);
    point.addTo(map);
    expect(host.querySelector('.oem-canvas-semantics button')).toBe(proxy);
    expect(proxy.tabIndex).toBe(0);
  });
  it('adds and removes filter groups without losing members or leaking surfaces', () => {
    const groups = Array.from({ length: 3 }, (_, i) => L.layerGroup([marker([i, i]), marker([1000, 1000])]));
    for (let cycle = 0; cycle < 3; cycle++) {
      for (const group of groups) group.addTo(map);
      expect(host.querySelectorAll('.oem-canvas-markers')).toHaveLength(1);
      for (const group of groups) for (const point of group.getLayers()) expect(map.hasLayer(point)).toBe(true);
      for (const group of groups) group.remove();
      expect(host.querySelectorAll('.oem-canvas-semantics .leaflet-marker-icon')).toHaveLength(0);
    }
  });
  it('keeps popup and tooltip ownership on their authored points', () => {
    const point = marker([0, 0]).addTo(map).bindTooltip('details').bindPopup('popup', { autoPan: false });
    point.openTooltip(); point.openPopup();
    map.setView([1000, 1000], 2, { animate: false });
    expect(point.getTooltip()?.isOpen()).toBe(true); expect(point.isPopupOpen()).toBe(true);
  });
  it('updates a logical position and retains state without an icon element', () => {
    const point = marker([1000, 1000]).addTo(map);
    setMarkerState(point, { checked: true, selected: true, tier: 'B1' });
    point.setLatLng([0, 0]); map.fire('move');
    expect(point.getLatLng()).toEqual(L.latLng(0, 0));
    expect(canvasSurface(map).visualPosition(point)?.equals(point.getLatLng())).toBe(true);
    expect(getMarkerState(point)).toMatchObject({ checked: true, selected: true, tier: 'B1' });
    expect(point.getElement()).toBeUndefined();
  });
  it('updates painter artwork through setIcon without replacing the logical point or creating icon elements', () => {
    const point = marker([0, 0]).addTo(map), identity = L.stamp(point);
    setMarkerState(point, { checked: true, selected: true }); map.fire('move');
    const state = getMarkerState(point);
    const art = { image: '/point.webp', subImage: '/sub.webp', noFrame: true, tier: 'L2', count: '12' };
    const icon = new SceneIcon(art, 'Updated group');
    const createIcon = vi.spyOn(icon, 'createIcon');
    const ready = vi.spyOn(MarkerPainter.prototype, 'isArtReady');
    try {
      expect(point.setIcon(icon)).toBe(point); map.fire('move');
      expect(ready).toHaveBeenCalledWith(art);
      expect(point.getIcon()).toBe(icon); expect(L.stamp(point)).toBe(identity);
      expect(map.hasLayer(point)).toBe(true); expect(getMarkerState(point)).toBe(state);
      expect(getMarkerState(point)).toMatchObject({ checked: true, selected: true });
      expect(createIcon).not.toHaveBeenCalled(); expect(point.getElement()).toBeUndefined();
      expect(host.querySelectorAll('.leaflet-marker-icon')).toHaveLength(0);
      expect(host.querySelector('.oem-canvas-semantics button')?.getAttribute('aria-label')).toBe('Updated group');
    } finally { ready.mockRestore(); createIcon.mockRestore(); }
  });
  it('preserves shared proxy focus when the camera moves and cycles to an offscreen point', () => {
    const near = marker([0, 0]), far = marker([1000, 1000]), clicked = vi.fn<(event: L.LeafletEvent) => void>();
    far.on('click', clicked);
    L.layerGroup([near, far]).addTo(map); map.fire('move');
    const proxy = host.querySelector<HTMLButtonElement>('.oem-canvas-semantics button')!;
    proxy.focus(); map.setView([-1000, -1000], 2, { animate: false });
    expect(document.activeElement).toBe(proxy); expect(proxy.isConnected).toBe(true);
    proxy.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowRight' }));
    expect(map.getBounds().contains(far.getLatLng())).toBe(true);
    proxy.click(); expect(clicked).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(proxy);
  });
  it('uses one scene and one semantic proxy for 1200 points, including after reattachment', () => {
    const points = Array.from({ length: 1200 }, () => marker([0, 0]));
    const group = L.layerGroup(points).addTo(map);
    const proxy = host.querySelector('.oem-canvas-semantics button');
    expect(host.querySelectorAll('.oem-canvas-markers')).toHaveLength(1);
    expect(host.querySelectorAll('.oem-canvas-semantics *')).toHaveLength(1);
    expect(host.querySelectorAll('.leaflet-marker-icon')).toHaveLength(0);
    expect(points.every(point => point.getElement() === undefined && map.hasLayer(point))).toBe(true);
    group.remove(); group.addTo(map);
    expect(host.querySelector('.oem-canvas-semantics button')).toBe(proxy);
    expect(host.querySelectorAll('.oem-canvas-semantics *')).toHaveLength(1);
    expect(points.every(point => point.getElement() === undefined && map.hasLayer(point))).toBe(true);
  });
  it('releases the scene and semantic nodes on map destruction', () => {
    marker([0, 0]).addTo(map); map.remove(); removed = true;
    expect(host.querySelector('.oem-canvas-markers')).toBeNull();
    expect(host.querySelector('.oem-canvas-semantics')).toBeNull();
  });
});
