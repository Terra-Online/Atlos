import { afterEach, expect, it } from 'vitest';
import L from 'leaflet';
import { CoverageBounds } from './coverageBounds';
import { isMapOverdragged } from './mapOverdrag';

const cleanups: Array<() => void> = [];
afterEach(() => cleanups.splice(0).forEach((cleanup) => cleanup()));

it('reflects the coverage rebound state without rectangular map bounds', () => {
    const host = document.createElement('div');
    Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
    document.body.append(host);
    const map = L.map(host, { crs: L.CRS.Simple, zoomAnimation: false });
    const controller = new CoverageBounds(map);
    controller.setCoverage({
        coverage: { zooms: { '0': { '': { '-2': [40, 44], '-1': [40, 44], '0': [40, 44] } } } },
        suffixes: [''], tileSize: 200, maxNativeZoom: 0,
    });
    cleanups.push(() => { controller.dispose(); map.remove(); host.remove(); });
    map.setView([100, 8500], 0);
    expect(map.options.maxBounds).toBeUndefined();
    expect(isMapOverdragged(map)).toBe(false);
    (map as L.Map & { _rawPanBy(offset: L.Point): void })._rawPanBy(L.point(10000, 0));
    expect(controller.isVisible()).toBe(true);
    expect(isMapOverdragged(map)).toBe(true);
    map.setView(controller.limitCenter(map.getCenter(), map.getZoom()), map.getZoom(), { animate: false });
    expect(isMapOverdragged(map)).toBe(false);
});
