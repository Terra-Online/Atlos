import {
    TalosMap,
    CompatLayer,
    CompatLayerGroup,
    CompatPolygon,
    CompatRectangle,
    layerGroup,
    polygon,
    rectangle,
    latLngBounds,
} from '@/component/mapCore/engine';
import { IMapRegion, IMapSubregionAreaData } from '@/data/map';

let activeHighlight: CompatLayerGroup | null = null;

export const removeHighlight = () => {
    if (activeHighlight) {
        activeHighlight.eachLayer((layer) => {
            layer.remove();
        });
        activeHighlight = null;
    }
};

export const createHighlight = (map: TalosMap | undefined, subregion: IMapSubregionAreaData, config: IMapRegion) => {
    removeHighlight();

    let highlight: CompatLayerGroup | null = null;

    if (subregion.polygon && subregion.polygon.length > 0) {
        highlight = createPolygonHighlight(map, subregion.polygon, config);
    } else if (subregion.bounds && subregion.bounds.length >= 2) {
        highlight = createRectangleHighlight(map, subregion.bounds, config);
    }
    if (highlight) {
        highlight.eachLayer((layer) => {
            (layer as CompatPolygon | CompatRectangle).bringToFront();
        });
        activeHighlight = highlight;

        // remove highlight after 1500ms
        setTimeout(() => {
            if (map && highlight && map.hasLayer(highlight)) {
                map.removeLayer(highlight);
                activeHighlight = null;
            }
        }, 1500);
    }

    return highlight;
};

export const createPolygonHighlight = (map: TalosMap | undefined, polygonData: number[][][], config:IMapRegion) => {
    try {
        if (!map) {
            throw new Error('Map is not defined.');
        }
        const highlightLayers: CompatLayer[] = [];

        // 引擎的 polygon() 只接受单环（flat）坐标数组；逐环创建 fill+stroke 以保持多环渲染
        polygonData.forEach((ring) => {
            const polygonPoints = ring.map(([x, y]) => {
                return map.unproject([x, y], config.maxZoom);
            });

            const fillLayer = polygon(polygonPoints, {
                color: 'transparent',
                fillOpacity: 0.3,
                className: 'subregion-highlight-fill',
            });

            const strokeLayer = polygon(polygonPoints, {
                weight: 3,
                opacity: 0.9,
                fill: false,
                className: 'subregion-highlight-stroke',
            });

            fillLayer.addTo(map);
            strokeLayer.addTo(map);
            highlightLayers.push(fillLayer, strokeLayer);
        });

        return layerGroup(highlightLayers);
    } catch (error) {
        console.error('Error creating polygon highlight:', error);
        return null;
    }
};

export const createRectangleHighlight = (map:TalosMap | undefined, bounds: number[][], config: IMapRegion) => {
    try {
        if (!map) {
            throw new Error('Map is not defined.');
        }
        const [[x1, y1], [x2, y2]] = bounds;
        const sw = map.unproject([x1, y2], config.maxZoom);
        const ne = map.unproject([x2, y1], config.maxZoom);

        const fillLayer = rectangle(latLngBounds(sw, ne), {
            color: 'transparent',
            fillOpacity: 0.3,
            className: 'subregion-highlight-fill',
        });

        const strokeLayer = rectangle(latLngBounds(sw, ne), {
            weight: 3,
            opacity: 0.9,
            fill: false,
            className: 'subregion-highlight-stroke',
        });

        fillLayer.addTo(map);
        strokeLayer.addTo(map);

        return layerGroup([fillLayer, strokeLayer]);
    } catch (_) {
        //console.error('Failed to create rectangle highlight:', error);
        return null;
    }
};