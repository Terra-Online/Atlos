import {
    TalosMap,
    CompatLayer,
    CompatLayerGroup,
    layerGroup,
    polygon,
    rectangle,
    latLngBounds,
} from '@/component/mapCore/engine';
import { REGION_DICT, SUBREGION_DICT, IMapRegion } from '@/data/map';

export class SubregionBoundaryManager {
    private map: TalosMap;
    private boundariesLayer?: CompatLayerGroup;

    constructor(map: TalosMap) {
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

        const boundaryLayers: CompatLayer[] = [];

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
            this.boundariesLayer = layerGroup(boundaryLayers);
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
        
        const layers: CompatLayer[] = [];
        this.boundariesLayer.eachLayer(layer => layers.push(layer));
        
        this.toggleBoundaryVisibility(layers, true);
        
        setTimeout(() => {
            this.map.removeLayer(boundariesLayerToBeRemoved);
            if (this.boundariesLayer === boundariesLayerToBeRemoved) 
                this.boundariesLayer = undefined;
        }, 300); // equal to the CSS transition duration
    }

    private toggleBoundaryVisibility(layers: CompatLayer[], hidden: boolean) {
        layers.forEach(layer => {
            const element = layer.getElement();
            element?.classList.toggle('boundary-hidden', hidden);
        });
    }

    private createPolygonBoundary(polygonData: number[][][], config: IMapRegion): CompatLayer[] {
        const boundaryLayers: CompatLayer[] = [];

        // 引擎的 polygon() 只接受单环（flat）坐标数组；逐环创建 fill+stroke 以保持多环渲染
        polygonData.forEach((ring) => {
            const polygonPoints = ring.map(([x, y]) => {
                return this.map.unproject([x, y], config.maxZoom);
            });

            const fillLayer = polygon(polygonPoints, {
                color: 'transparent',
                fillOpacity: 0.2,
                className: 'subregion-boundary-fill',
            });

            const strokeLayer = polygon(polygonPoints, {
                weight: 2,
                opacity: 0.8,
                fill: false,
                className: 'subregion-boundary-stroke',
            });

            boundaryLayers.push(fillLayer, strokeLayer);
        });

        return boundaryLayers;
    }

    private createRectangleBoundary(bounds: number[][], config: IMapRegion): CompatLayer[] {
        const [[x1, y1], [x2, y2]] = bounds;
        const sw = this.map.unproject([x1, y2], config.maxZoom);
        const ne = this.map.unproject([x2, y1], config.maxZoom);

        const fillLayer = rectangle(latLngBounds(sw, ne), {
            color: 'transparent',
            fillOpacity: 0.2,
            className: 'subregion-boundary-fill',
        });

        const strokeLayer = rectangle(latLngBounds(sw, ne), {
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