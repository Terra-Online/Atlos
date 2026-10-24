import L from 'leaflet';
import { expect, it, vi } from 'vitest';
import * as data from '@/data/marker';
import { REGION_DICT } from '@/data/map';
import { MarkerLayer } from './markerLayer';

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
        expect(retired.getElement()).toBeNull();
        expect(layer.layerSubregionDict[point('Valley_4').subregId].getLayers()).toEqual([]);
        await layer.changeRegion('Valley_4');
        expect(Object.keys(dictionary)).toEqual(['Valley_4']);
        expect(dictionary.Valley_4).not.toBe(retired);
    } finally { load.mockRestore(); layer.destroy(); map.remove(); host.remove(); }
});
