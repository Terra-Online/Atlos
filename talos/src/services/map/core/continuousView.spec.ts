import L from 'leaflet';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
    prepareContinuousMap,
    setContinuousView,
    type ContinuousMap,
} from './continuousView';

let host: HTMLDivElement;
let map: ContinuousMap;
let layer: PendingLayer;
let pending: (() => void)[];
let create: PendingLayer['created'];
class PendingLayer extends L.GridLayer {
    created = vi.fn((_coords: L.Coords, done: L.DoneCallback) => {
        const tile = document.createElement('div');
        pending.push(() => done(undefined, tile));
        return tile;
    });
    override createTile(coords: L.Coords, done: L.DoneCallback): HTMLElement {
        return this.created(coords, done);
    }
}
beforeEach(() => {
    host = document.createElement('div');
    Object.defineProperties(host, {
        clientWidth: { value: 300 },
        clientHeight: { value: 200 },
    });
    document.body.append(host);
    map = prepareContinuousMap(
        L.map(host, {
            crs: L.CRS.Simple,
            minZoom: 0,
            maxZoom: 4,
            zoomSnap: 0,
            zoomAnimation: false,
            fadeAnimation: false,
        }),
    );
    pending = [];
    layer = new PendingLayer({ tileSize: 200, maxZoom: 4, maxNativeZoom: 3 });
    create = layer.created;
    layer.addTo(map);
});
afterEach(() => {
    map.remove();
    host.remove();
});

it('keeps pending tiles through fractional camera updates instead of restarting every frame', () => {
    setContinuousView(map, L.latLng(-500, 500), 2.1);
    const tiles = [...host.querySelectorAll('.leaflet-tile')];
    const count = create.mock.calls.length;
    expect(count).toBeGreaterThan(0);
    const reset = vi.fn();
    map.on('viewprereset', reset);
    for (let n = 1; n <= 70; n++)
        setContinuousView(
            map,
            L.latLng(-500 + n * 0.002, 500 + n * 0.002),
            2.1 + n * 0.001,
        );
    expect(create).toHaveBeenCalledTimes(count);
    expect(tiles.every((tile) => tile.isConnected)).toBe(true);
    expect(reset).not.toHaveBeenCalled();
    pending.splice(0).forEach((done) => done());
    expect(host.querySelectorAll('.leaflet-tile-loaded')).toHaveLength(count);
});

it('retains loaded parent tiles until the next native level finishes loading', () => {
    const center = L.latLng(-500, 500);
    setContinuousView(map, center, 2.49);
    pending.splice(0).forEach((done) => done());
    const tiles = [...host.querySelectorAll('.leaflet-tile-loaded')];
    const count = create.mock.calls.length;
    setContinuousView(map, center, 2.51);
    expect(create.mock.calls.length).toBeGreaterThan(count);
    expect(tiles.some((tile) => tile.isConnected)).toBe(true);
    pending.splice(0).forEach((done) => done());
    expect(
        host.querySelectorAll('.leaflet-tile-loaded').length,
    ).toBeGreaterThan(0);
});
