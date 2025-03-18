import { create } from 'zustand';
import L from 'leaflet';

// 专注于高亮显示功能的store
const useVisual = create((set, get) => ({
  // 高亮状态
  activeHighlight: null,
  
  // 创建高亮
  createHighlight: (map, subregion, config) => {
    // 移除现有高亮
    const { removeHighlight } = get();
    removeHighlight();
    
    let highlight = null;
    
    if (subregion.polygon && subregion.polygon.length > 0) {
      highlight = get().createPolygonHighlight(map, subregion.polygon, config);
    } else if (subregion.bounds && subregion.bounds.length >= 2) {
      highlight = get().createRectangleHighlight(map, subregion.bounds, config);
    }
    
    if (highlight) {
      // 确保每个图层都显示在前面
      highlight.eachLayer(layer => {
        if (layer.bringToFront) {
          layer.bringToFront();
        }
      });
      
      set({ activeHighlight: highlight });
      
      // 自动移除高亮
      setTimeout(() => {
        if (map && highlight && map.hasLayer(highlight)) {
          map.removeLayer(highlight);
          set({ activeHighlight: null });
        }
      }, 1500);
    }
    
    return highlight;
  },
  
  // 移除高亮
  removeHighlight: () => {
    const { activeHighlight } = get();
    if (activeHighlight) {
      // 获取map实例
      activeHighlight.eachLayer(layer => {
        if (layer._map) {
          layer._map.removeLayer(layer);
        }
      });
      set({ activeHighlight: null });
    }
  },
  
  // 创建多边形高亮
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
  
  // 创建矩形高亮
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
      console.error('Failed to create rectangle highlight:', error);
      return null;
    }
  }
}));

export default useVisual;