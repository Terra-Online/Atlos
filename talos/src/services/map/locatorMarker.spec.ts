import L from 'leaflet';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createTrackerMarker, setTrackerBearing } from './locatorMarker';

let host: HTMLDivElement;
let map: L.Map;
let marker: L.Marker;
beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    map = L.map(host, { crs: L.CRS.Simple }).setView([0, 0], 1);
    marker = createTrackerMarker('markerPane', L.latLng(0, 0)).addTo(map);
});
afterEach(() => {
    map.remove();
    host.remove();
});
const angle = () =>
    Number(
        marker
            .getElement()!
            .querySelector('img')!
            .style.transform.match(/rotate\(([-\d.]+)deg\)/)?.[1],
    );

it('rotates across the heading boundary by the shortest arc, in both directions', () => {
    setTrackerBearing(marker, 269);
    setTrackerBearing(marker, -89);
    expect(angle()).toBeCloseTo(271);
    setTrackerBearing(marker, 269);
    expect(angle()).toBeCloseTo(269);
});

it('keeps a stationary heading stable and ignores invalid measurements', () => {
    setTrackerBearing(marker, 25.8);
    for (let n = 0; n < 60; n++) setTrackerBearing(marker, 25.8);
    expect(angle()).toBeCloseTo(25.8);
    setTrackerBearing(marker, NaN);
    expect(angle()).toBeCloseTo(25.8);
});
