import L from 'leaflet';
import { REGION_DICT } from '@/data/map';
import { TILE_SIZE } from '@/data/map/tiles';
import useViewState from '@/store/viewState';
import { useLayerStore, getLayerTileSuffix } from '@/store/layer';
import { getTileResourceUrl } from '@/services/assets/resource';
import { getAvailableLayers, getMaxTileZoom, getRegionTileCoverage, hasTileInCoverage, hasSatelliteTiles } from './tileCoverage';
import type { IMapView } from './types';

/** Warm only a few original-resolution tiles at the expected view center.
 * Requests use the same URL/cache as the eventual layer. Intent can be revoked
 * without keeping queued work for a region the user did not choose. */
export function preloadMapTiles(regionId: string, view?: IMapView): () => void {
    const config = REGION_DICT[regionId];
    if (!config || typeof document === 'undefined') return () => {};
    const stored = view ?? useViewState.getState().getViewState(regionId);
    const configured = useLayerStore.getState().currentLayer;
    const layer = getAvailableLayers(regionId).includes(configured) ? configured : 'M';
    const source = layer === 'M' && useLayerStore.getState().satellite && hasSatelliteTiles(regionId) ? 'satellite' : 'clips';
    const coverage = getRegionTileCoverage(regionId, source);
    const suffixes = layer === 'M' ? [''] : ['', getLayerTileSuffix(layer)];
    const zoom = Math.min(getMaxTileZoom(coverage, suffixes), Math.max(0, Math.round(stored?.zoom ?? config.initialZoom)));
    const location = stored ?? config.initialCenter;
    const center = L.CRS.Simple.latLngToPoint(L.latLng(location.lat, location.lng), zoom);
    const x = Math.floor(center.x / TILE_SIZE), y = Math.floor(center.y / TILE_SIZE);
    const neighborX = center.x / TILE_SIZE - x < 0.5 ? -1 : 1;
    const neighborY = center.y / TILE_SIZE - y < 0.5 ? -1 : 1;
    const pending: HTMLImageElement[] = [];
    for (const suffix of suffixes) {
        for (const [dx, dy] of [[0, 0], [neighborX, 0], [0, neighborY], [neighborX, neighborY]]) {
            if (!hasTileInCoverage(coverage, zoom, x + dx, y + dy, suffix)) continue;
            const url = getTileResourceUrl(`${regionId}/${zoom}/${x + dx}_${y + dy}${suffix}.webp`, source);
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
