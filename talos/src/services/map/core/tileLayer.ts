import L from 'leaflet';
import { TILE_SIZE } from '@/data/map/tiles';
import {
    getTileResourceUrl,
    type TileSource,
} from '@/services/assets/resource';
import {
    getMaxTileZoom,
    getRegionTileCoverage,
} from '@/services/map/tileCoverage';
import { SmoothTileLayer } from './smoothTileLayer';

/** Shared tile rules for the main map and the passive preview minimap. */
export const createMapTileLayer = (
    region: string,
    source: TileSource,
    suffix: string,
    maxZoom: number,
): L.TileLayer => {
    const coverage = getRegionTileCoverage(region, source);
    return new SmoothTileLayer(
        getTileResourceUrl(`${region}/{z}/{x}_{y}${suffix}.webp`, source),
        {
            tileSize: TILE_SIZE,
            noWrap: true,
            pane: 'tilePane',
            zIndex: suffix ? 2 : 1,
            maxNativeZoom: getMaxTileZoom(coverage, [suffix]),
            maxZoom: Math.ceil(maxZoom),
            errorTileUrl:
                'data:image/webp;base64,UklGRhYAAABXRUJQVlA4TAoAAAAvAAAAAP8B/wE=',
        },
        coverage,
        suffix,
    );
};
