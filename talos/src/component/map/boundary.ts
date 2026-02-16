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
            return; // don't show any without subregion config
        }

        const boundaryLayers: L.Layer[] = [];

        config.subregions.forEach(subregionId => {
            const subregion = SUBREGION_DICT[subregionId];
            if (!subregion) return;

            if (subregion.polygon && subregion.polygon.length > 0) {
                const polygonLayers = this.createPolygonBoundary(subregion.polygon, config);
                boundaryLayers.push(...polygonLayers);
            } else if (subregion.bounds && subregion.bounds.length >= 2) {
                const rectangleLayers = this.createRectangleBoundary(subregion.bounds, config);
                boundaryLayers.push(...rectangleLayers);
            }
        });

        if (boundaryLayers.length > 0) {
            this.boundariesLayer = L.layerGroup(boundaryLayers);
            this.boundariesLayer.addTo(this.map);
            
            this.toggleBoundaryVisibility(boundaryLayers, true);
            requestAnimationFrame(() => {
                this.toggleBoundaryVisibility(boundaryLayers, false);
            });
        }
    }

    hideBoundaries() {
        if (!this.boundariesLayer) return;
        
        const boundariesLayerToBeRemoved = this.boundariesLayer;
        
        const layers: L.Layer[] = [];
        this.boundariesLayer.eachLayer(layer => layers.push(layer));
        
        this.toggleBoundaryVisibility(layers, true);
        
        setTimeout(() => {
            this.map.removeLayer(boundariesLayerToBeRemoved);
            if (this.boundariesLayer === boundariesLayerToBeRemoved) 
                this.boundariesLayer = undefined;
        }, 300); // equal to the CSS transition duration
    }

    private toggleBoundaryVisibility(layers: L.Layer[], hidden: boolean) {
        layers.forEach(layer => {
            const element = (layer as L.Polygon | L.Rectangle).getElement?.() as SVGElement | undefined;
            element?.classList.toggle('boundary-hidden', hidden);
        });
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