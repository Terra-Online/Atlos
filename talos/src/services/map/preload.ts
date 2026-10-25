import L from 'leaflet';
import { REGION_DICT } from '@/data/map';
import useViewState from '@/store/viewState';
import { useLayerStore, getLayerTileSuffix } from '@/store/layer';
import { getTileResourceUrl } from '@/services/assets/resource';
import { getRegionTileCoverage, hasTileInCoverage } from './tileCoverage';
import type { IMapView } from './types';

/** Warm only a few original-resolution tiles at the expected view center.
 * Requests use the same URL/cache as the eventual layer. Intent can be revoked
 * without keeping queued work for a region the user did not choose. */
export function preloadMapTiles(regionId: string, view?: IMapView): () => void {
    const config = REGION_DICT[regionId];
    if (!config || typeof document === 'undefined') return () => {};
    const stored = view ?? useViewState.getState().getViewState(regionId);
    const zoom = Math.min(config.maxZoom, Math.max(0, Math.round(stored?.zoom ?? config.initialZoom)));
    const center = stored
        ? L.CRS.Simple.latLngToPoint(L.latLng(stored.lat, stored.lng), zoom)
        : L.point(
            (config.boundsOffset?.x ?? 0) + config.dimensions[0] / 2 + config.initialOffset.x,
            (config.boundsOffset?.y ?? 0) + config.dimensions[1] / 2 + config.initialOffset.y,
        ).multiplyBy(2 ** (zoom - config.maxZoom));
    const x = Math.floor(center.x / config.tileSize), y = Math.floor(center.y / config.tileSize);
    const neighborX = center.x / config.tileSize - x < 0.5 ? -1 : 1;
    const neighborY = center.y / config.tileSize - y < 0.5 ? -1 : 1;
    const coverage = getRegionTileCoverage(regionId);
    const configured = useLayerStore.getState().currentLayer;
    const layer = config.layers?.includes(configured) ? configured : 'M';
    const suffixes = layer === 'M' ? [''] : ['', getLayerTileSuffix(layer)];
    const pending: HTMLImageElement[] = [];
    for (const suffix of suffixes) {
        for (const [dx, dy] of [[0, 0], [neighborX, 0], [0, neighborY], [neighborX, neighborY]]) {
            if (!hasTileInCoverage(coverage, zoom, x + dx, y + dy, suffix)) continue;
            const url = getTileResourceUrl(`/clips/${regionId}/${zoom}/${x + dx}_${y + dy}${suffix}.webp`);
            const image = document.createElement('img');
            image.decoding = 'async';
            image.fetchPriority = 'low';
            image.onload = () => {
                image.onload = image.onerror = null;
            };
            image.onerror = () => { image.onload = image.onerror = null; };
            pending.push(image);
            image.src = url;
        }
    }
    return () => {
        for (const image of pending) {
            image.onload = image.onerror = null;
            if (!image.complete) image.src = L.Util.emptyImageUrl;
        }
    };
}
