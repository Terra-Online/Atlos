import L, { DivOverlay } from 'leaflet';

let activeHighlight: L.LayerGroup | null = null;

export const removeHighlight = () => {
    if (activeHighlight) {
        activeHighlight.eachLayer((layer) => {
            layer.remove();
        });
        activeHighlight = null;
    }
};

export const createHighlight = (map, subregion, config) => {
    removeHighlight();

    let highlight: L.LayerGroup | null = null;

    if (subregion.polygon && subregion.polygon.length > 0) {
        highlight = createPolygonHighlight(map, subregion.polygon, config);
    } else if (subregion.bounds && subregion.bounds.length >= 2) {
        highlight = createRectangleHighlight(map, subregion.bounds, config);
    }
    if (highlight) {
        highlight.eachLayer((layer) => {
            if ((layer as DivOverlay).bringToFront) {
                (layer as DivOverlay).bringToFront();
            }
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

export const createPolygonHighlight = (map, polygonData, config) => {
    try {
        const polygonPoints = polygonData.map((polygon) => {
            return polygon.map(([x, y]) => {
                return map.unproject([x, y], config.maxZoom);
            });
        });

        const fillLayer = L.polygon(polygonPoints, {
            color: 'transparent',
            fillOpacity: 0.3,
            className: 'subregion-highlight-fill',
        });

        const strokeLayer = L.polygon(polygonPoints, {
            weight: 3,
            opacity: 0.9,
            fill: false,
            className: 'subregion-highlight-stroke',
        });

        fillLayer.addTo(map);
        strokeLayer.addTo(map);

        return L.layerGroup([fillLayer, strokeLayer]);
    } catch (error) {
        console.error('Error creating polygon highlight:', error);
        return null;
    }
};

export const createRectangleHighlight = (map, bounds, config) => {
    try {
        const [[x1, y1], [x2, y2]] = bounds;
        const sw = map.unproject([x1, y2], config.maxZoom);
        const ne = map.unproject([x2, y1], config.maxZoom);

        const fillLayer = L.rectangle(L.latLngBounds(sw, ne), {
            color: 'transparent',
            fillOpacity: 0.3,
            className: 'subregion-highlight-fill',
        });

        const strokeLayer = L.rectangle(L.latLngBounds(sw, ne), {
            weight: 3,
            opacity: 0.9,
            fill: false,
            className: 'subregion-highlight-stroke',
        });

        fillLayer.addTo(map);
        strokeLayer.addTo(map);

        return L.layerGroup([fillLayer, strokeLayer]);
    } catch (error) {
        //console.error('Failed to create rectangle highlight:', error);
        return null;
    }
};
