// @vitest-environment jsdom
import L from 'leaflet';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ViewportMarker } from './markerViewport';
import styles from './marker/marker.module.scss';

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
  icon: L.divIcon({ className: styles.incompleteMarker, html: `<span class="${styles.markerInner}">point</span>`, iconSize: [32, 32], iconAnchor: [16, 32] }),
});
describe('Canvas marker lifecycle', () => {
  it('preserves logical members, semantic node identity and handlers while browsing', () => {
    const near = marker([0, 0]), far = marker([1000, 1000]), clicked = vi.fn();
    far.on('click', clicked);
    const group = L.layerGroup([near, far]).addTo(map), node = far.getElement()!;
    expect(map.hasLayer(far)).toBe(true); expect(group.hasLayer(far)).toBe(true);
    expect(node.closest('.oem-canvas-semantics')).not.toBeNull();
    map.setView([1000, 1000], 2, { animate: false });
    expect(far.getElement()).toBe(node);
    node.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(clicked).toHaveBeenCalledOnce();
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
  it('updates positions without replacing a marker node', () => {
    const point = marker([1000, 1000]).addTo(map), node = point.getElement();
    point.setLatLng([0, 0]); expect(point.getElement()).toBe(node);
    expect(point.getLatLng()).toEqual(L.latLng(0, 0));
  });
  it('preserves keyboard focus when the camera moves', () => {
    const point = marker([0, 0]).addTo(map), node = point.getElement()!;
    node.focus(); map.setView([1000, 1000], 2, { animate: false });
    expect(document.activeElement).toBe(node); expect(node.isConnected).toBe(true);
  });
  it('uses one scene for dense points and retains all semantic nodes', () => {
    const points = Array.from({ length: 1200 }, () => marker([0, 0]));
    L.layerGroup(points).addTo(map);
    expect(host.querySelectorAll('.oem-canvas-markers')).toHaveLength(1);
    expect(points.every(point => point.getElement()?.isConnected)).toBe(true);
    expect(points.every(point => point.getElement()?.style.transform === '')).toBe(true);
  });
  it('releases the scene and semantic nodes on map destruction', () => {
    marker([0, 0]).addTo(map); map.remove(); removed = true;
    expect(host.querySelector('.oem-canvas-markers')).toBeNull();
    expect(host.querySelector('.oem-canvas-semantics')).toBeNull();
  });
});
