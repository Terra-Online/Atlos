import L from 'leaflet';
import { afterEach, expect, it, vi } from 'vitest';
import useViewState from '@/store/viewState';
import { useLayerStore } from '@/store/layer';
import { MapCore, type IMapOptions } from '@/services/map/core/map';

vi.mock('@/data/map', () => ({
    REGION_DICT: {
        A: { coordZoom: 6, initialCenter: { lat: -156, lng: 156 }, initialZoom: 4, subregions: [] },
        B: { coordZoom: 2, initialCenter: { lat: -15000, lng: 15000 }, initialZoom: 2, subregions: [] },
        D: { coordZoom: 2, initialCenter: { lat: -500, lng: 500 }, initialZoom: 0, subregions: [] },
    }, SUBREGION_DICT: {},
}));
vi.mock('@/services/map/tileCoverage', async (importOriginal) => ({
    ...await importOriginal<typeof import('@/services/map/tileCoverage')>(),
    getRegionTileCoverage: (region: string, source = 'clips') => {
    const zooms: Record<string, Record<string, Record<string, number[]>>> = {};
    const reference = region === 'A' ? 6 : 2;
    for (let z = 0; z <= (region === 'A' ? (source === 'satellite' ? 7 : 6) : 3); z++) {
        const scale = 2 ** (z - reference);
        const size = 200;
        const expanded = region === 'A' && source === 'satellite';
        const min = Math.floor((region === 'B' ? 50000 : expanded ? -2000 : 0) * scale / size);
        const max = Math.ceil((region === 'B' ? 70000 : expanded ? 25000 : 20000) * scale / size) - 1;
        const rows = Object.fromEntries(Array.from({ length: max - min + 1 }, (_, i) => [String(min + i), [min, max]]));
        zooms[String(z)] = { '': rows, _b1: rows };
    }
    return { zooms };
}, getAvailableLayers: (region: string) => region === 'D' ? ['M'] : ['M', 'B1'], hasSatelliteTiles: (region: string) => region === 'A' }));
vi.mock('@/services/map/core/marker/markerLayer', () => ({ MarkerLayer: class {
    changeRegion = vi.fn(() => Promise.resolve()); updateLayerTier = vi.fn(); destroy = vi.fn();
} }));
vi.mock('@/services/map/core/smoothTileLayer', async () => {
    const { default: Leaflet } = await import('leaflet');
    return { SmoothTileLayer: class extends Leaflet.Layer {
        constructor(public url: string, options: L.TileLayerOptions) { super(); Leaflet.Util.setOptions(this, options); }
        override onAdd() { return this; }
        override onRemove() { return this; }
        getContainer() { return undefined; }
    } };
});

const cleanups: Array<() => void> = [];
afterEach(() => { cleanups.splice(0).forEach((fn) => fn()); });
function fixture(options?: IMapOptions) {
    const host = document.createElement('div');
    Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
    document.body.appendChild(host);
    useViewState.setState({ viewStates: { A: { lat: -100, lng: 100, zoom: 6 }, B: { lat: -14000, lng: 14000, zoom: 2 } } });
    useLayerStore.setState({ currentLayer: 'B1', satellite: false });
    const core = new MapCore(host, options);
    cleanups.push(() => { core.destroy(); host.remove(); });
    return core;
}

it('restores each region without saving old bounds or zoom-transition coordinates into its viewport', async () => {
    const core = fixture();
    await core.switchRegion('A');
    expect(core.map.getCenter().equals([-100, 100])).toBe(true);
    const external = L.layerGroup().addTo(core.map);
    await core.switchRegion('B');
    expect(core.map.getCenter().equals([-14000, 14000])).toBe(true);
    expect(core.map.hasLayer(external)).toBe(true);
    await core.switchRegion('A');
    expect(core.map.getCenter().equals([-100, 100])).toBe(true);
    expect(core.map.getZoom()).toBe(6);
    await core.switchLayer('B1');
    await core.switchLayer('B1');
    expect(useLayerStore.getState().currentLayer).toBe('B1');
});

it('settles repeated and superseded region requests and stops a destroyed map from accepting work', async () => {
    const core = fixture();
    const first = core.switchRegion('A');
    const second = core.switchRegion('B');
    expect(await first).toBe(false);
    expect(await second).toBe(true);
    expect(await core.switchRegion('B')).toBe(true);
    core.destroy();
    expect(await core.switchRegion('A')).toBe(false);
});

it('marks an in-flight region import obsolete before admitting a newer request', async () => {
    const core = fixture();
    const checks: (() => boolean)[] = [];
    vi.spyOn(core.markerLayer, 'changeRegion').mockImplementation((_region, current) => {
        if (current) checks.push(current);
        return Promise.resolve();
    });
    const previous = core.switchRegion('A');
    const latest = core.switchRegion('B');
    expect(checks).toHaveLength(1);
    expect(checks[0]()).toBe(false);
    expect(await previous).toBe(false);
    expect(await latest).toBe(true);
    expect(checks).toHaveLength(2);
    expect(checks[1]()).toBe(true);
    core.destroy();
    expect(checks[1]()).toBe(false);
});

it('uses the URL destination only for the first view and clamps its zoom without altering saved views early', async () => {
    const core = fixture({ initialView: { regionId: 'A', view: { lat: -150, lng: 150, zoom: 100 } } });
    const setView = vi.spyOn(core.map, 'setView');
    await core.switchRegion('A');
    expect(setView.mock.calls[0]).toEqual([[-150, 150], 7, { animate: false }]);
    expect(useViewState.getState().getViewState('A')).toEqual({ lat: -100, lng: 100, zoom: 6 });
    await core.switchRegion('B');
    await core.switchRegion('A');
    expect(core.map.getCenter().equals([-150, 150])).toBe(true);
    expect(core.map.getZoom()).toBe(7);
});

it.each([
    { lat: NaN, lng: 100, zoom: 2 },
    { lat: -100, lng: 100, zoom: Infinity },
])('ignores an invalid initial URL view instead of requesting tiles outside the region: %j', async (view) => {
    const core = fixture({ initialView: { regionId: 'A', view } });
    await core.switchRegion('A');
    expect(core.map.getCenter().equals([-100, 100])).toBe(true);
    expect(core.map.getZoom()).toBe(6);
});

function tileUrls(core: MapCore) {
    const urls: string[] = [];
    core.map.eachLayer((layer) => { if ('url' in layer) urls.push(String(layer.url)); });
    return urls;
}

it('replaces only the base tiles and restores the satellite preference after floors and unsupported regions', async () => {
    const core = fixture();
    await core.switchRegion('A');
    useLayerStore.getState().setSatellite(true);
    await core.switchLayer('M');
    expect(tileUrls(core)).toEqual([expect.stringContaining('/satellite/A/')]);
    core.map.eachLayer((layer) => {
        if ('url' in layer) {
            expect(layer.options).toMatchObject({ maxNativeZoom: 7 });
            expect(layer.options).not.toHaveProperty('minNativeZoom');
        }
    });
    expect(core.map.getMaxZoom()).toBe(8);
    core.map.setZoom(8, { animate: false });
    const center = core.map.getCenter();
    const external = L.layerGroup().addTo(core.map);
    await core.switchLayer('B1');
    expect(core.map.getMaxZoom()).toBe(7);
    expect(core.map.getZoom()).toBe(7);
    expect(tileUrls(core)).toEqual([expect.stringContaining('/clips/A/'), expect.stringContaining('_b1.webp')]);
    await core.switchLayer('M');
    expect(core.map.getMaxZoom()).toBe(8);
    expect(tileUrls(core)).toEqual([expect.stringContaining('/satellite/A/')]);
    expect(core.map.getCenter().equals(center)).toBe(true);
    expect(core.map.hasLayer(external)).toBe(true);
    useLayerStore.getState().setCurrentLayer('M');
    await core.switchRegion('B');
    expect(tileUrls(core)).toEqual([expect.stringContaining('/clips/B/')]);
    expect(useLayerStore.getState().satellite).toBe(true);
    await core.switchRegion('A');
    expect(tileUrls(core)).toEqual([expect.stringContaining('/satellite/A/')]);
    useLayerStore.getState().setSatellite(false);
    await core.switchLayer('M');
    expect(tileUrls(core)).toEqual([expect.stringContaining('/clips/A/')]);
});

it('allows native level-three detail while preserving level-two pixel coordinates', async () => {
    const core = fixture();
    await core.switchRegion('D');
    expect(core.map.getMaxZoom()).toBe(4);
    expect(core.map.getCenter().equals([-500, 500])).toBe(true);
    expect(core.map.options.maxBounds).toBeUndefined();
    const layers: L.Layer[] = [];
    core.map.eachLayer((layer) => layers.push(layer));
    expect(layers.find((layer) => 'url' in layer)?.options).toMatchObject({ maxNativeZoom: 3 });
});

it('opens expanded satellite coverage above and to the right of the former region rectangle', async () => {
    const view = { lat: 1000 / 64, lng: 24000 / 64, zoom: 6 };
    const core = fixture({ initialView: { regionId: 'A', view } });
    useLayerStore.getState().setSatellite(true);
    await core.switchRegion('A');
    expect(core.map.getCenter().equals([view.lat, view.lng])).toBe(true);
    expect(core.map.options.maxBounds).toBeUndefined();
    core.map.eachLayer((layer) => {
        if ('url' in layer) expect(layer.options).not.toHaveProperty('bounds');
    });
    await core.switchLayer('B1');
    expect(core.map.getCenter().lat).toBeLessThan(view.lat);
    await core.switchLayer('M');
    core.map.setView([view.lat, view.lng], view.zoom, { animate: false });
    expect(core.map.getCenter().equals([view.lat, view.lng])).toBe(true);
});
