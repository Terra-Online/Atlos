import L from 'leaflet';
import { REGION_DICT, SUBREGION_DICT, IMapRegion } from '@/data/map';

export class SubregionBoundaryManager {
    private map: L.Map;
    private boundariesLayer?: L.LayerGroup;

    constructor(map: L.Map) {
        this.map = map;
    }

    showBoundaries(regionId: string) {
        if (this.boundariesLayer) {
            this.hideBoundaries();
        }

        const config = REGION_DICT[regionId];
        if (!config || !config.subregions || config.subregions.length === 0) {
            return; // 没有子地区配置文件，不显示任何边界
        }

        const boundaryLayers: L.Layer[] = [];

        config.subregions.forEach(subregionId => {
            const subregion = SUBREGION_DICT[subregionId];
            if (!subregion) return;

            if (subregion.polygon && subregion.polygon.length > 0) {
                // 创建多边形边界
                const polygonLayers = this.createPolygonBoundary(subregion.polygon, config);
                boundaryLayers.push(...polygonLayers);
            } else if (subregion.bounds && subregion.bounds.length >= 2) {
                // 创建矩形边界
                const rectangleLayers = this.createRectangleBoundary(subregion.bounds, config);
                boundaryLayers.push(...rectangleLayers);
            }
        });

        if (boundaryLayers.length > 0) {
            this.boundariesLayer = L.layerGroup(boundaryLayers);
            this.boundariesLayer.addTo(this.map);
        }
    }

    hideBoundaries() {
        if (this.boundariesLayer) {
            this.map.removeLayer(this.boundariesLayer);
            this.boundariesLayer = undefined;
        }
    }

    private createPolygonBoundary(polygonData: number[][][], config: IMapRegion): L.Layer[] {
        const polygonPoints = polygonData.map((polygon) => {
            return polygon.map(([x, y]) => {
                return this.map.unproject([x, y], config.maxZoom);
            });
        });

        const fillLayer = L.polygon(polygonPoints, {
            color: 'transparent',
            fillOpacity: 0.2,
            className: 'subregion-boundary-fill',
        });

        const strokeLayer = L.polygon(polygonPoints, {
            weight: 2,
            opacity: 0.8,
            fill: false,
            className: 'subregion-boundary-stroke',
        });

        return [fillLayer, strokeLayer];
    }

    private createRectangleBoundary(bounds: number[][], config: IMapRegion): L.Layer[] {
        const [[x1, y1], [x2, y2]] = bounds;
        const sw = this.map.unproject([x1, y2], config.maxZoom);
        const ne = this.map.unproject([x2, y1], config.maxZoom);

        const fillLayer = L.rectangle(L.latLngBounds(sw, ne), {
            color: 'transparent',
            fillOpacity: 0.2,
            className: 'subregion-boundary-fill',
        });

        const strokeLayer = L.rectangle(L.latLngBounds(sw, ne), {
            weight: 2,
            opacity: 0.8,
            fill: false,
            className: 'subregion-boundary-stroke',
        });

        return [fillLayer, strokeLayer];
    }

    destroy() {
        this.hideBoundaries();
    }
}