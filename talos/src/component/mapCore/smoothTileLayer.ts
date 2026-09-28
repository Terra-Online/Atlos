import L from 'leaflet';
import {
    hasTileInCoverage,
    type RegionTileCoverage,
} from '@/services/map/tileCoverage';

interface TileLevel {
    el: HTMLElement;
    origin: L.Point;
    zoom: number;
}

interface ContinuousPixelMap extends L.Map {
    _getNewPixelOrigin(center: L.LatLng, zoom: number): L.Point;
}

interface GridLayerInternals {
    _isValidTile(this: L.GridLayer, coords: L.Coords): boolean;
}

const isLeafletValidTile = (layer: L.GridLayer, coords: L.Coords) => {
    // Leaflet does not expose this method in its public typings, but calls it
    // before creating a tile element and therefore before starting a request.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const validator = (L.GridLayer.prototype as unknown as GridLayerInternals)
        ._isValidTile;
    return validator.call(layer, coords);
};

/**
 * Leaflet rounds GridLayer translations to whole pixels. That is useful for
 * static maps, but the rounding becomes visible as random subpixel jumps when
 * the map zoom is driven continuously.
 */
export class SmoothTileLayer extends L.TileLayer {
    private readonly coverage: RegionTileCoverage;
    private readonly suffix: string;

    constructor(
        urlTemplate: string,
        options: L.TileLayerOptions,
        coverage: RegionTileCoverage,
        suffix = '',
    ) {
        super(urlTemplate, options);
        this.coverage = coverage;
        this.suffix = suffix;
    }

    _isValidTile(coords: L.Coords): boolean {
        return (
            isLeafletValidTile(this, coords) &&
            hasTileInCoverage(
                this.coverage,
                coords.z,
                coords.x,
                coords.y,
                this.suffix,
            )
        );
    }

    _setZoomTransform(level: TileLevel, center: L.LatLng, zoom: number) {
        const map = (this as unknown as { _map?: ContinuousPixelMap })._map;
        if (!map) return;

        const scale = map.getZoomScale(zoom, level.zoom);
        const translate = level.origin
            .multiplyBy(scale)
            .subtract(map._getNewPixelOrigin(center, zoom));

        if (L.Browser.any3d) {
            L.DomUtil.setTransform(level.el, translate, scale);
        } else {
            L.DomUtil.setPosition(level.el, translate);
        }
    }
}
