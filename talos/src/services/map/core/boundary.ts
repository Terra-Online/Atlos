import L from 'leaflet';
import { REGION_DICT, SUBREGION_DICT, IMapRegion } from '@/data/map';

export class SubregionBoundaryManager {
    private map: L.Map;
    private boundariesLayer?: L.LayerGroup;
    private cancelEnter?: () => void;
    private retiring = new Map<L.LayerGroup, number>();

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
            const view = this.map.getContainer().ownerDocument.defaultView ?? window;
            let frame = view.requestAnimationFrame(() => {
                frame = view.requestAnimationFrame(() => this.toggleBoundaryVisibility(boundaryLayers, false));
            });
            this.cancelEnter = () => view.cancelAnimationFrame(frame);
        }
    }

    hideBoundaries() {
        if (!this.boundariesLayer) return;
        
        const boundariesLayerToBeRemoved = this.boundariesLayer;
        this.boundariesLayer = undefined;
        this.cancelEnter?.();
        
        const layers: L.Layer[] = [];
        boundariesLayerToBeRemoved.eachLayer(layer => layers.push(layer));
        
        this.toggleBoundaryVisibility(layers, true);
        
        const timer = window.setTimeout(() => {
            this.retiring.delete(boundariesLayerToBeRemoved);
            this.map.removeLayer(boundariesLayerToBeRemoved);
        }, 300); // equal to the CSS transition duration
        this.retiring.set(boundariesLayerToBeRemoved, timer);
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
                return this.map.unproject([x, y], config.coordZoom);
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
        const sw = this.map.unproject([x1, y2], config.coordZoom);
        const ne = this.map.unproject([x2, y1], config.coordZoom);

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

    clear() {
        this.cancelEnter?.();
        this.retiring.forEach((timer, layer) => { window.clearTimeout(timer); layer.remove(); });
        this.retiring.clear();
        this.boundariesLayer?.remove();
        this.boundariesLayer = undefined;
    }

    destroy() { this.clear(); }
}
