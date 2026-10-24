import L from 'leaflet';
import { afterEach, expect, it, vi } from 'vitest';
import useViewState from '@/store/viewState';
import { useLayerStore } from '@/store/layer';
import { MapCore } from '@/services/map/core/map';

vi.mock('@/data/map', () => ({
    REGION_DICT: {
        A: { maxZoom: 6, dimensions: [20000, 20000], boundsOffset: { x: 0, y: 0 }, initialOffset: { x: 0, y: 0 }, initialZoom: 4, tileSize: 256, subregions: [], layers: ['M', 'B1'] },
        B: { maxZoom: 2, dimensions: [20000, 20000], boundsOffset: { x: 50000, y: 50000 }, initialOffset: { x: 0, y: 0 }, initialZoom: 2, tileSize: 256, subregions: [], layers: ['M', 'B1'] },
    }, SUBREGION_DICT: {},
}));
vi.mock('@/services/map/tileCoverage', () => ({ getRegionTileCoverage: () => undefined }));
vi.mock('@/services/map/core/marker/markerLayer', () => ({ MarkerLayer: class {
    changeRegion = vi.fn(() => Promise.resolve()); updateLayerTier = vi.fn(); destroy = vi.fn();
} }));
vi.mock('@/services/map/core/smoothTileLayer', async () => {
    const { default: Leaflet } = await import('leaflet');
    return { SmoothTileLayer: class extends Leaflet.Layer {
        override onAdd() { return this; }
        override onRemove() { return this; }
        getContainer() { return undefined; }
    } };
});

const cleanups: Array<() => void> = [];
afterEach(() => { cleanups.splice(0).forEach((fn) => fn()); });
function fixture() {
    const host = document.createElement('div');
    Object.defineProperties(host, { clientWidth: { value: 800 }, clientHeight: { value: 600 } });
    document.body.appendChild(host);
    useViewState.setState({ viewStates: { A: { lat: -100, lng: 100, zoom: 6 }, B: { lat: -14000, lng: 14000, zoom: 2 } } });
    useLayerStore.setState({ currentLayer: 'B1' });
    const core = new MapCore(host);
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
