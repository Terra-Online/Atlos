import L from 'leaflet';
import { afterEach, expect, it, vi } from 'vitest';
import { ClusterLayer } from './clusterLayer';
import { CanvasClusterGroup, CanvasClusterMarker } from '../canvas/clusterGroup';
import { ViewportMarker } from '../canvas/markerViewport';
import { MarkerMotion } from '../canvas/canvasMarkerMotion';
import type { IMarkerData, IMarkerType } from '@/data/marker';
import { SceneIcon, getMarkerState, setMarkerState } from '../canvas/markerModel';
import { useUiPrefsStore } from '@/store/uiPrefs';
import * as records from '@/store/userRecord';

const cleanup: (() => void)[] = [];
afterEach(() => {
  for (const run of cleanup.splice(0)) run();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
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
  const parents: Record<string, L.LayerGroup> = { fixture: L.layerGroup().addTo(map) };
  const markers: Record<string, L.Marker> = {}, data: Record<string, IMarkerData> = {}, types: Record<string, string[]> = {};
  const layer = new ClusterLayer({ map, getMarkerDict: () => markers, getMarkerDataDict: () => data,
    getMarkerTypeMap: () => types, getLayerSubregionDict: () => parents });
  const add = (type: string, id: string, lng: number, subregId = 'fixture') => {
    markers[id] = new ViewportMarker([0, lng], { icon: new SceneIcon({
      image: '', subImage: '', noFrame: false, tier: '',
    }, id) });
    data[id] = { id, type, subregId, pos: [0, lng], x: lng, y: 0, z: 0, tier: 0 };
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
  return { layer, add, visible, map, flush, markers, parents };
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
  const { layer, add, visible, flush } = fixture();
  add('first', 'a', 0); add('first', 'b', 1);
  layer.applyFilter(['first']);
  flush();
  const retained = visible()[0];
  setMarkerState(retained, { appearing: false });
  add('first', 'far', 300);
  layer.applyFilter(['first']);
  flush();
  expect(visible()).toContain(retained);
  expect(retained.getElement()).toBeUndefined();
  expect(getMarkerState(retained).appearing).toBe(false);
  const introduced = visible().find(marker => marker !== retained)!;
  expect(getMarkerState(introduced).appearing).toBe(true);
});

it('clears an outgoing child fade when a filtered aggregate expands back into individual points', () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const { layer, add, visible, map } = fixture();
  add('first', 'a', 0); add('first', 'b', 1);
  map.setZoom(2);
  layer.applyFilter(['first']);
  const children = visible();
  expect(children).toHaveLength(2);
  expect(children.every(marker => !(marker instanceof CanvasClusterMarker))).toBe(true);
  setMarkerState(children[0], { selected: true, checked: true });

  layer.applyFilter([]);
  expect(children.every(marker => getMarkerState(marker).disappearing)).toBe(true);
  vi.advanceTimersByTime(160);
  expect(children.every(marker => !map.hasLayer(marker))).toBe(true);

  map.setZoom(0);
  layer.applyFilter(['first']);
  expect(visible()).toHaveLength(1);
  expect(visible()[0]).toBeInstanceOf(CanvasClusterMarker);
  expect(children.every(marker => !map.hasLayer(marker))).toBe(true);

  map.setZoom(2);
  expect(new Set(visible())).toEqual(new Set(children));
  expect(children.every(marker => map.hasLayer(marker) && !getMarkerState(marker).disappearing)).toBe(true);
  expect(getMarkerState(children[0])).toMatchObject({ selected: true, checked: true });
});

it('partitions a mixed import without duplicating members or admitting inactive, hidden or completed points', () => {
  const prefs = useUiPrefsStore.getState();
  useUiPrefsStore.setState({ prefsHideCompletedMarkers: true });
  vi.spyOn(records, 'getActivePoints').mockReturnValue(['completed']);
  const { layer, add, visible, map, flush, markers, parents } = fixture();
  try {
    layer.applyFilter(['first', 'second']);
    add('first', 'a', 0); add('first', 'a-near', 1); add('second', 'b', 0);
    add('second', 'completed', 2); add('second', 'hidden', 3, 'other'); add('unmanaged', 'inactive', 4);
    parents.fixture.addLayer(markers.a);
    const ids = ['a', 'b', 'a-near', 'completed', 'hidden', 'inactive', 'missing', 'a'];
    layer.notifyMarkersAdded(ids);
    const representatives = visible();
    const cluster = representatives.find(marker => marker instanceof CanvasClusterMarker);
    expect(cluster?.getAllChildMarkers()).toEqual([markers.a, markers['a-near']]);
    expect(representatives).toHaveLength(2);
    expect(representatives).toContain(markers.b);
    expect(parents.fixture.hasLayer(markers.a)).toBe(false);
    expect(map.hasLayer(markers.completed)).toBe(false);
    expect(map.hasLayer(markers.hidden)).toBe(false);
    expect(map.hasLayer(markers.inactive)).toBe(false);

    flush();
    representatives.forEach(marker => setMarkerState(marker, { appearing: false }));
    layer.notifyMarkersAdded(ids);
    expect(new Set(visible())).toEqual(new Set(representatives));
    expect(cluster?.getChildCount()).toBe(2);
    expect(visible().every(marker => !getMarkerState(marker).appearing)).toBe(true);
  } finally { useUiPrefsStore.setState(prefs); }
});

it('preserves temporary and completed visibility while cancelling only the restored type fade', () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const prefs = useUiPrefsStore.getState();
  useUiPrefsStore.setState({ prefsHideCompletedMarkers: true });
  vi.spyOn(records, 'getActivePoints').mockReturnValue(['completed']);
  const { layer, add, visible, map, markers } = fixture();
  try {
    map.setZoom(2);
    add('first', 'a', 0); add('second', 'temporary', 30); add('second', 'completed', 60);
    layer.applyFilter(['first']);
    layer.setTemporaryVisibleIds(['temporary']);
    layer.setCheckedVisibleOverrideIds(['completed']);
    expect(new Set(visible())).toEqual(new Set([markers.a, markers.temporary, markers.completed]));

    layer.applyFilter([]);
    expect(getMarkerState(markers.a).disappearing).toBe(true);
    expect(getMarkerState(markers.temporary).disappearing).toBe(false);
    layer.applyFilter(['first']);
    vi.advanceTimersByTime(160);
    expect(new Set(visible())).toEqual(new Set([markers.a, markers.temporary, markers.completed]));
    expect(getMarkerState(markers.a).disappearing).toBe(false);

    layer.setTemporaryVisibleIds([]);
    layer.setCheckedVisibleOverrideIds([]);
    vi.advanceTimersByTime(160);
    expect(visible()).toEqual([markers.a]);
  } finally { useUiPrefsStore.setState(prefs); }
});

it('does not restart an outgoing fade when equal visibility sets are republished', () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const { layer, add, visible } = fixture();
  add('first', 'a', 0); add('first', 'b', 1);
  layer.applyFilter(['first']);
  layer.applyFilter([]);
  vi.advanceTimersByTime(80);
  layer.setActiveSubregions(['fixture']);
  layer.setTemporaryVisibleIds([]);
  layer.setCheckedVisibleOverrideIds([]);
  vi.advanceTimersByTime(80);
  expect(visible()).toEqual([]);
});
