// visual effects store for generating subregion highlights
import { create } from 'zustand';
import L from 'leaflet';

const useVisual = create((set, get) => ({
  activeHighlight: null,

  createHighlight: (map, subregion, config) => {

    const { removeHighlight } = get();
    removeHighlight();

    let highlight = null;

    if (subregion.polygon && subregion.polygon.length > 0) {
      highlight = get().createPolygonHighlight(map, subregion.polygon, config);
    } else if (subregion.bounds && subregion.bounds.length >= 2) {
      highlight = get().createRectangleHighlight(map, subregion.bounds, config);
    }
    if (highlight) {
      highlight.eachLayer(layer => {
        if (layer.bringToFront) {
          layer.bringToFront();
        }
      });
      set({ activeHighlight: highlight });

      // remove highlight after 1500ms
      setTimeout(() => {
        if (map && highlight && map.hasLayer(highlight)) {
          map.removeLayer(highlight);
          set({ activeHighlight: null });
        }
      }, 1500);
    }

    return highlight;
  },

  removeHighlight: () => {
    const { activeHighlight } = get();
    if (activeHighlight) {
      activeHighlight.eachLayer(layer => {
        if (layer._map) {
          layer._map.removeLayer(layer);
        }
      });
      set({ activeHighlight: null });
    }
  },

  createPolygonHighlight: (map, polygonData, config) => {
    try {
      const polygonPoints = polygonData.map(polygon => {
        return polygon.map(([x, y]) => {
          return map.unproject([x, y], config.maxZoom);
        });
      });

      const fillLayer = L.polygon(polygonPoints, {
        color: 'transparent',
        fillOpacity: 0.3,
        className: 'subregion-highlight-fill'
      });

      const strokeLayer = L.polygon(polygonPoints, {
        weight: 3,
        opacity: 0.9,
        fill: false,
        className: 'subregion-highlight-stroke'
      });

      fillLayer.addTo(map);
      strokeLayer.addTo(map);

      return L.layerGroup([fillLayer, strokeLayer]);
    } catch (error) {
      console.error('Error creating polygon highlight:', error);
      return null;
    }
  },

  createRectangleHighlight: (map, bounds, config) => {
    try {
      const [[x1, y1], [x2, y2]] = bounds;
      const sw = map.unproject([x1, y2], config.maxZoom);
      const ne = map.unproject([x2, y1], config.maxZoom);

      const fillLayer = L.rectangle(L.latLngBounds(sw, ne), {
        color: 'transparent',
        fillOpacity: 0.3,
        className: 'subregion-highlight-fill'
      });

      const strokeLayer = L.rectangle(L.latLngBounds(sw, ne), {
        weight: 3,
        opacity: 0.9,
        fill: false,
        className: 'subregion-highlight-stroke'
      });

      fillLayer.addTo(map);
      strokeLayer.addTo(map);

      return L.layerGroup([fillLayer, strokeLayer]);
    } catch (error) {
      //console.error('Failed to create rectangle highlight:', error);
      return null;
    }
  }
}));

export default useVisual;