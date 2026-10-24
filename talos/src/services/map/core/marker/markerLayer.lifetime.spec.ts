import L from 'leaflet';
import { expect, it, vi } from 'vitest';
import * as data from '@/data/marker';
import { REGION_DICT } from '@/data/map';
import { MarkerLayer } from './markerLayer';
import { getMarkerState, setMarkerState } from '../canvas/markerModel';

it('releases retired render objects while keeping dictionary identities used by selection', async () => {
    const host = document.createElement('div'); document.body.append(host);
    const map = L.map(host, { crs: L.CRS.Simple }).setView([0, 0], 2);
    const layer = new MarkerLayer(map);
    const point = (region: string): data.IMarkerData => ({ id: region, subregId: REGION_DICT[region].subregions[0],
        type: 'crate_ii', pos: [0, 0], x: 0, y: 0, z: 0, tier: 0 });
    const load = vi.spyOn(data, 'loadRegionMarkers').mockImplementation(region => Promise.resolve([point(region)]));
    try {
        const dictionary = layer.markerDict, records = layer.markerDataDict;
        await layer.changeRegion('Valley_4');
        layer.filterMarker(['crate_ii']);
        const retired = dictionary.Valley_4 as L.Marker;
        expect(layer.startMarkerPulse('Valley_4')).toBe(true);
        await layer.changeRegion('Wuling');
        expect(layer.markerDict).toBe(dictionary);
        expect(layer.markerDataDict).toBe(records);
        expect(Object.keys(dictionary)).toEqual(['Wuling']);
        expect(map.hasLayer(retired)).toBe(false);
        expect(retired.getElement()).toBeUndefined();
        expect(layer.layerSubregionDict[point('Valley_4').subregId].getLayers()).toEqual([]);
        await layer.changeRegion('Valley_4');
        expect(Object.keys(dictionary)).toEqual(['Valley_4']);
        expect(dictionary.Valley_4).not.toBe(retired);
    } finally { load.mockRestore(); layer.destroy(); map.remove(); host.remove(); }
});

it('keeps selection and collection state off-map and releases pulse listeners on state changes and removal', async () => {
    const host = document.createElement('div'); document.body.append(host);
    const map = L.map(host, { crs: L.CRS.Simple }).setView([0, 0], 2);
    const layer = new MarkerLayer(map);
    const point: data.IMarkerData = { id: 'state', subregId: REGION_DICT.Valley_4.subregions[0],
        type: 'crate_ii', pos: [0, 0], x: 0, y: 0, z: 0, tier: 0 };
    const load = vi.spyOn(data, 'loadRegionMarkers').mockResolvedValue([point]);
    try {
        await layer.changeRegion('Valley_4');
        const marker = layer.markerDict.state as L.Marker;
        expect(map.hasLayer(marker)).toBe(false);
        layer.updateSelectedMarkers([{ id: 'state', selected: true }]);
        layer.updateCollectedPoints(['state']);
        expect(getMarkerState(marker)).toMatchObject({ selected: true, checked: true, completed: true });
        layer.updateCollectedPoints([]);
        layer.filterMarker(['crate_ii']);
        layer.updateSelectedMarkers([{ id: 'state', selected: true }]);
        expect(layer.startMarkerPulse('state')).toBe(true);
        setMarkerState(marker, { hover: true });
        expect(getMarkerState(marker).pulsing).toBe(true);
        layer.updateSelectedMarkers([{ id: 'state', selected: false }]);
        expect(getMarkerState(marker).pulsing).toBe(false);
        expect(layer.startMarkerPulse('state')).toBe(true);
        marker.remove();
        expect(getMarkerState(marker).pulsing).toBe(false);
        expect(marker.hasEventListeners('visualchange')).toBe(false);
    } finally { load.mockRestore(); layer.destroy(); map.remove(); host.remove(); }
});

it('does not register superseded region data and commits the latest filter before resolving', async () => {
    const host = document.createElement('div'); document.body.append(host);
    const map = L.map(host, { crs: L.CRS.Simple }).setView([0, 0], 2);
    const layer = new MarkerLayer(map);
    let deliver: (points: data.IMarkerData[]) => void = () => {};
    const rows = (region: string): data.IMarkerData[] => [0, 1].map(index => ({
        id: `${region}-${index}`, subregId: REGION_DICT[region].subregions[0], type: 'crate_ii',
        pos: [index, index], x: index, y: 0, z: index, tier: 0,
    }));
    const load = vi.spyOn(data, 'loadRegionMarkers').mockImplementation(region => region === 'Wuling'
        ? new Promise(resolve => { deliver = resolve; }) : Promise.resolve(rows(region)));
    try {
        layer.enableClustering();
        layer.filterMarker(['crate_ii']);
        let current = true;
        const obsolete = layer.changeRegion('Wuling', () => current);
        current = false;
        deliver(rows('Wuling'));
        await obsolete;
        expect(Object.keys(layer.markerDict)).toEqual([]);

        const latest = layer.changeRegion('Valley_4');
        layer.filterMarker([]);
        await latest;
        expect(Object.keys(layer.markerDict)).toEqual(['Valley_4-0', 'Valley_4-1']);
        expect(Object.values(layer.markerDict).every(marker => !map.hasLayer(marker))).toBe(true);
        layer.filterMarker(['crate_ii']);
        expect(Object.values(layer.markerDict).every(marker => map.hasLayer(marker))).toBe(true);
    } finally { load.mockRestore(); layer.destroy(); map.remove(); host.remove(); }
});
