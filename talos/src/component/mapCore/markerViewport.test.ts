// @vitest-environment jsdom
import L from 'leaflet';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ViewportMarker } from './markerViewport';

let map: L.Map;
let host: HTMLDivElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.append(host);
  Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
  map = L.map(host, { crs: L.CRS.Simple, zoomAnimation: false }).setView([0, 0], 2);
});
afterEach(() => {
  map.remove();
  host.remove();
});
const marker = (position: L.LatLngExpression) =>
  new ViewportMarker(position, {
    icon: L.divIcon({ html: '<span>point</span>', iconSize: [32, 32], iconAnchor: [16, 32] }),
  });

describe('viewport DOM attachment', () => {
  it('parks only offscreen DOM while preserving logical layers, node identity and handlers', () => {
    const near = marker([0, 0]),
      far = marker([1000, 1000]);
    const add = vi.fn(),
      remove = vi.fn(),
      click = vi.fn();
    far.on('add', add).on('remove', remove).on('click', click);
    const group = L.layerGroup([near, far]).addTo(map);
    const original = far.getElement()!;
    expect(original.isConnected).toBe(false);
    expect(map.hasLayer(far)).toBe(true);
    expect(group.hasLayer(far)).toBe(true);
    original.classList.add('selected', 'checked');
    map.setView([1000, 1000], 2, { animate: false });
    expect(far.getElement()).toBe(original);
    expect(original.isConnected).toBe(true);
    expect(original.classList.contains('selected')).toBe(true);
    expect(original.classList.contains('checked')).toBe(true);
    original.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(click).toHaveBeenCalledOnce();
    expect(near.getElement()!.isConnected).toBe(false);
    expect(add).toHaveBeenCalledOnce();
    expect(remove).not.toHaveBeenCalled();
    group.remove();
    expect(remove).toHaveBeenCalledOnce();
    group.addTo(map);
    expect(far.getElement()!.isConnected).toBe(true);
  });
  it('adds and removes multiple filter groups without requiring a bound tooltip', () => {
    const groups = Array.from({ length: 3 }, (_, type) =>
      L.layerGroup([marker([type, type]), marker([1000 + type, 1000 + type])]),
    );
    for (let cycle = 0; cycle < 3; cycle++) {
      for (const group of groups) expect(() => group.addTo(map)).not.toThrow();
      for (const group of groups)
        for (const point of group.getLayers()) expect(map.hasLayer(point)).toBe(true);
      expect(map.getPane('markerPane')!.childElementCount).toBe(3);
      for (const group of [...groups].reverse()) expect(() => group.remove()).not.toThrow();
      expect(map.getPane('markerPane')!.childElementCount).toBe(0);
    }
  });
  it('pins an open tooltip and resumes parking after it closes', () => {
    const point = marker([0, 0]).addTo(map).bindTooltip('details').openTooltip();
    map.setView([1000, 1000], 2, { animate: false });
    expect(point.getElement()!.isConnected).toBe(true);
    point.closeTooltip();
    map.fire('move');
    expect(point.getElement()!.isConnected).toBe(false);
  });
  it('updates position and restores parked points without requiring a view change', () => {
    const point = marker([1000, 1000]).addTo(map);
    const node = point.getElement();
    point.setLatLng([0, 0]);
    expect(point.getElement()).toBe(node);
    expect(node!.isConnected).toBe(true);
    point.setLatLng([1000, 1000]);
    expect(node!.isConnected).toBe(false);
  });
  it('keeps keyboard focus during a pan and releases the node once focus moves', () => {
    const point = marker([0, 0]).addTo(map);
    const node = point.getElement()!;
    node.focus();
    map.setView([1000, 1000], 2, { animate: false });
    expect(document.activeElement).toBe(node);
    expect(node.isConnected).toBe(true);
    node.blur();
    map.fire('move');
    expect(node.isConnected).toBe(false);
  });
  it('does not impose a point cap or change dense viewport content', () => {
    const markers = Array.from({ length: 1200 }, () => marker([0, 0]));
    L.layerGroup(markers).addTo(map);
    expect(markers.every((point) => point.getElement()!.isConnected)).toBe(true);
  });
  it('keeps popup ownership and visible marker styling during a pan', () => {
    const point = marker([0, 0]).addTo(map).bindPopup('details', { autoPan: false }).openPopup();
    map.setView([1000, 1000], 2, { animate: false });
    expect(point.isPopupOpen()).toBe(true);
    expect(point.getElement()!.isConnected).toBe(true);
    point.closePopup();
    map.fire('move');
    expect(point.getElement()!.isConnected).toBe(false);
  });
});
