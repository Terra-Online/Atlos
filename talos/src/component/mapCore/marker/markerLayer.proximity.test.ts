import L from 'leaflet';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarkerLayer } from './markerLayer';
import { REGION_DICT } from '@/data/map';
import type { IMarkerData } from '@/data/marker';
import { convertMapMarkerToEFGamePosition } from '@/services/endfield';
import { useMarkerStore } from '@/store/marker';

let map: L.Map | undefined;
let layer: MarkerLayer | undefined;
let host: HTMLDivElement;
afterEach(() => { layer?.destroy(); map?.remove(); host?.remove(); vi.restoreAllMocks(); });

describe('proximity reminder updates', () => {
    it('batches hits and keeps one pending reveal across position packets, discarding stale results', async () => {
        host = document.createElement('div'); document.body.append(host);
        map = L.map(host, { crs: L.CRS.Simple }).setView([0, 0], 0);
        layer = new MarkerLayer(map);
        const region = Object.keys(REGION_DICT)[0];
        const marker = { id: 'proximity-test', subregId: REGION_DICT[region].subregions[0],
            type: 'test', x: 0, y: 0, z: 0 } as IMarkerData;
        layer.markerDataDict = { [marker.id]: marker };
        useMarkerStore.setState({ selectedPoints: [], temporarySelectedPoints: [] });
        vi.spyOn(layer, 'updateSelectedMarkers').mockImplementation(() => {});
        let resolve!: (shown: boolean) => void;
        const reveal = vi.spyOn(layer, 'ensureMarkerVisible').mockImplementation(() => new Promise(done => { resolve = done; }));
        const pulse = vi.spyOn(layer, 'startMarkerPulse').mockReturnValue(true);
        const params = { currentRegion: region, typeKeys: ['test'],
            position: convertMapMarkerToEFGamePosition(marker, region) };
        const notifications = vi.fn(); const stop = useMarkerStore.subscribe(notifications);
        try {
            layer.updateProximityReminder(params);
            for (let i = 0; i < 20; i++) layer.updateProximityReminder(params);
            expect(reveal).toHaveBeenCalledTimes(1);
            expect(notifications).toHaveBeenCalledTimes(1);
            expect(useMarkerStore.getState().temporarySelectedPoints).toEqual([marker.id]);
            layer.updateProximityReminder({ ...params, position: { ...params.position, x: params.position.x + 100 } });
            resolve(true); await Promise.resolve();
            expect(pulse).not.toHaveBeenCalled();
            expect(useMarkerStore.getState().temporarySelectedPoints).toEqual([]);
            layer.updateProximityReminder(params);
            expect(reveal).toHaveBeenCalledTimes(2);
            resolve(true); await Promise.resolve();
            expect(pulse).toHaveBeenCalledTimes(1);
        } finally { stop(); }
    });
});
