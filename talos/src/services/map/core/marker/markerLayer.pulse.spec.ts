import L from 'leaflet';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { MarkerLayer } from './markerLayer';
import { getMarkerState, setMarkerState, type SceneState } from '../canvas/markerModel';

let host: HTMLDivElement;
let map: L.Map;
let layer: MarkerLayer;
let marker: L.Marker;
beforeEach(() => {
    host = document.createElement('div'); document.body.append(host);
    map = L.map(host, { crs: L.CRS.Simple }).setView([0, 0], 0);
    layer = new MarkerLayer(map);
    marker = L.marker([0, 0], { icon: L.divIcon() }).addTo(map);
    layer.markerDict.target = marker;
});
afterEach(() => { layer.destroy(); map.remove(); host.remove(); });

it('keeps a pulse after arrival while the entry fade finishes, including hover and focus', () => {
    setMarkerState(marker, { appearing: true });
    expect(layer.startMarkerPulse('target')).toBe(true);
    setMarkerState(marker, { appearing: false });
    expect(getMarkerState(marker).pulsing).toBe(true);
    setMarkerState(marker, { hover: true, focus: true });
    expect(getMarkerState(marker).pulsing).toBe(true);
    marker.remove();
    expect(getMarkerState(marker).pulsing).toBe(false);
});

it.each(['selected', 'checked', 'offLayer', 'disappearing'] as const)('ends a pulse when %s changes', (key: keyof SceneState) => {
    layer.startMarkerPulse('target');
    setMarkerState(marker, { [key]: true });
    expect(getMarkerState(marker).pulsing).toBe(false);
});
