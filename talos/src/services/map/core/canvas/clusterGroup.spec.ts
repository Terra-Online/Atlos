import L from 'leaflet';
import { afterEach, expect, it, vi } from 'vitest';
import { CanvasClusterGroup, CanvasClusterMarker } from './clusterGroup';
import { ViewportMarker } from './markerViewport';
import { SceneIcon } from './markerModel';
import { canvasSurface } from './canvasMarkerSurface';
import { SpatialClusterCache } from './spatialClusters';

const cleanups: (() => void)[] = [];
afterEach(() => { cleanups.splice(0).forEach(cleanup => cleanup()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const icon = (label = 'point', count?: string) => new SceneIcon({ image: '', subImage: '', tier: '', noFrame: false, count }, label);
const markers = () => [0, 30, 200].map(x => new ViewportMarker([0, x], { icon: icon() }));
function fixture() {
  const frames = new Map<number, FrameRequestCallback>(); let sequence = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { frames.set(++sequence, callback); return sequence; });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const flush = () => { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(performance.now())); };
  const host = document.createElement('div'); document.body.append(host);
  Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
  const map = L.map(host, { crs: L.CRS.Simple, zoomAnimation: false, zoomSnap: 0 }).setView([0, 0], 0);
  const members = markers(), group = new CanvasClusterGroup({ iconCreateFunction: cluster => icon('cluster', String(cluster.getChildCount())) });
  group.addLayers(members).addTo(map);
  const zoom = (level: number) => {
    // Match the continuous wheel path; jsdom's non-3D setZoom rounds to integers.
    const camera = map as L.Map & {
      _moveStart(changed: boolean, noMoveStart: boolean): L.Map;
      _move(center: L.LatLng, zoom: number, data: { pinch: boolean; round: boolean }): L.Map;
      _moveEnd(changed: boolean): L.Map;
    };
    camera._moveStart(true, false); camera._move(map.getCenter(), level, { pinch: true, round: false }); camera._moveEnd(true);
  };
  cleanups.push(() => { map.remove(); host.remove(); });
  return { map, group, members, flush, zoom };
}

it('rehydrates a prior region geometry with fresh logical markers after clearing the group', () => {
  const geometry = vi.spyOn(SpatialClusterCache.prototype, 'get');
  const { map, group, members } = fixture();
  const first: unknown = geometry.mock.results[0].value;
  group.remove(); group.clearLayers();
  const replacements = markers(); group.addLayers(replacements).addTo(map);
  expect(geometry.mock.results.at(-1)?.value).toBe(first);
  const cluster = group.getVisibleParent(replacements[0]);
  expect(cluster).toBeInstanceOf(CanvasClusterMarker);
  expect((cluster as CanvasClusterMarker).getAllChildMarkers()).toEqual(replacements.slice(0, 2));
  expect(group.getVisibleParent(replacements[2])).toBe(replacements[2]);
  expect(members.every(marker => !map.hasLayer(marker) && !group.hasLayer(marker))).toBe(true);
});

it('skips unchanged fractional levels but closes expanded clusters and restores a pending expansion', () => {
  const { map, group, members, flush, zoom } = fixture(), surface = canvasSurface(map);
  const transition = vi.spyOn(surface, 'beginClusterTransition');
  const cluster = group.getVisibleParent(members[0]) as CanvasClusterMarker;
  zoom(0.2);
  expect(transition).not.toHaveBeenCalled();
  expect(group.getVisibleParent(members[0])).toBe(cluster);
  group.expand(cluster); expect(group.getVisibleParent(members[0])).toBe(members[0]);
  transition.mockClear(); zoom(0.3);
  expect(transition).toHaveBeenCalledOnce();
  expect(group.getVisibleParent(members[0])).toBe(cluster);

  const animatedMap = map as L.Map & { _animatingZoom: boolean };
  animatedMap._animatingZoom = true; group.expand(cluster);
  animatedMap._animatingZoom = false; map.fire('zoomend'); flush();
  expect(group.getVisibleParent(members[0])).toBe(members[0]);
  expect(group.getVisibleParent(members[1])).toBe(members[1]);
});

it('refreshes centers and custom layout options instead of reusing stale displayed representatives', () => {
  const { map, group, members } = fixture();
  const cluster = group.getVisibleParent(members[0]) as CanvasClusterMarker;
  members[0].setLatLng([0, 10]);
  expect(group.getVisibleParent(members[0])).toBe(cluster);
  expect(cluster.getLatLng().equals([0, 20])).toBe(true);
  L.setOptions(group, { maxClusterRadius: 5 }); map.fire('zoomend');
  expect(group.getVisibleLayers()).toEqual(members);
  L.setOptions(group, { maxClusterRadius: 60, disableClusteringAtZoom: 0 }); map.fire('zoomend');
  expect(group.getVisibleLayers()).toEqual(members);
  L.setOptions(group, { disableClusteringAtZoom: 2 }); map.fire('zoomend');
  const updated = group.getVisibleParent(members[0]) as CanvasClusterMarker;
  L.setOptions(group, { iconCreateFunction: function(this: unknown) {
    expect(this).toBe(group.options); return icon('new appearance', 'custom');
  } }); map.fire('zoomend');
  expect(group.getVisibleParent(members[0])).toBe(updated);
  expect(updated.getIcon()).toMatchObject({ label: 'new appearance', art: { count: 'custom' } });
});
