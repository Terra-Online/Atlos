import L from 'leaflet';
import { afterEach, expect, it, vi } from 'vitest';
import { ClusterLayer } from './clusterLayer';
import { CanvasClusterGroup, CanvasClusterMarker } from '../canvas/clusterGroup';
import { ViewportMarker } from '../canvas/markerViewport';
import { MarkerMotion } from '../canvas/canvasMarkerMotion';
import type { IMarkerData, IMarkerType } from '@/data/marker';
import styles from './marker.module.scss';

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const run of cleanup.splice(0)) run();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

function fixture() {
  const frames = new Map<number, FrameRequestCallback>();
  let frame = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++frame, callback); return frame; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id); });
  vi.spyOn(performance, 'now').mockReturnValue(1000);
  const flush = () => {
    const pending = [...frames]; frames.clear();
    for (const [, callback] of pending) callback(performance.now());
  };
  const host = document.createElement('div'); document.body.append(host);
  Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
  const map = L.map(host, { crs: L.CRS.Simple, zoomAnimation: false }).setView([0, 0], 0);
  const markers: Record<string, L.Marker> = {}, data: Record<string, IMarkerData> = {}, types: Record<string, string[]> = {};
  const layer = new ClusterLayer({ map, getMarkerDict: () => markers, getMarkerDataDict: () => data,
    getMarkerTypeMap: () => types, getLayerSubregionDict: () => ({}) });
  const add = (type: string, id: string, lng: number) => {
    markers[id] = new ViewportMarker([0, lng], { icon: L.divIcon({
      html: `<div class="${styles.markerInner}"></div>`, iconSize: [32, 32], iconAnchor: [16, 32],
    }) });
    data[id] = { id, type, subregId: 'fixture', pos: [0, lng], x: lng, y: 0, z: 0, tier: 0 };
    (types[type] ??= []).push(id);
  };
  for (const key of ['first', 'second']) layer.registerType({ key, category: { main: 'general', sub: 'collection' } } as IMarkerType);
  layer.setActiveSubregions(['fixture']); layer.enable();
  cleanup.push(() => { layer.destroy(); map.remove(); host.remove(); });
  const visible = () => {
    const groups: CanvasClusterGroup[] = [];
    map.eachLayer(candidate => { if (candidate instanceof CanvasClusterGroup) groups.push(candidate); });
    return groups.flatMap(group => group.getVisibleLayers());
  };
  const inner = (marker: L.Marker) => marker.getElement()!.querySelector<HTMLElement>(`.${styles.markerInner}`)!;
  return { layer, add, visible, inner, map, flush };
}

it('starts new filter clusters at zero opacity on their first canvas paint', () => {
  const { layer, add, visible, map } = fixture();
  add('first', 'a', 0); add('first', 'b', 1);
  layer.applyFilter(['first']);
  expect(visible()[0]).toBeInstanceOf(CanvasClusterMarker);
  const set = vi.spyOn(MarkerMotion.prototype, 'set');
  map.fire('move');
  expect(set.mock.calls.length).toBeGreaterThan(0);
  expect(set.mock.contexts.every((motion, index) => motion instanceof MarkerMotion
    && motion.opacity(set.mock.calls[index][1]) === 0)).toBe(true);
});

it('does not restart the appearance of retained clusters when members are added', () => {
  const { layer, add, visible, inner, flush } = fixture();
  add('first', 'a', 0); add('first', 'b', 1);
  layer.applyFilter(['first']);
  flush();
  const retained = visible()[0], node = retained.getElement();
  inner(retained).classList.remove(styles.appearing);
  add('first', 'far', 300);
  layer.applyFilter(['first']);
  flush();
  expect(visible()).toContain(retained);
  expect(retained.getElement()).toBe(node);
  expect(inner(retained).classList.contains(styles.appearing)).toBe(false);
  const introduced = visible().find(marker => marker !== retained)!;
  expect(inner(introduced).classList.contains(styles.appearing)).toBe(true);
});
