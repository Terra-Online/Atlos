import { useEffect } from 'react';
import { MAP_CONFIGS, DEFAULT_CONFIG } from '../map_config';
import useIni from '../store/initial';
import useRegion from '../store/region';
import useContinuity from '../store/continuity';
import useVisual from '../store/visual';

// Assmeble all stores to useMap
export function useMap(elementId) {
  const {
    map, isInitialized, initMap, addTileLayer,
    setMapView, isChangingView
  } = useIni();

  const {
    currentRegion, previousRegion, subregions,
    currentSubregion, setCurrentRegion,
    setCurrentSubregion, findSubregionById, initialize
  } = useRegion();

  const {
    saveViewState, getViewState, clearAllViewStates
  } = useContinuity();

  const {
    createHighlight, removeHighlight
  } = useVisual();

  // initMap
  useEffect(() => {
    if (!isInitialized && elementId) {
      const config = MAP_CONFIGS[currentRegion] || DEFAULT_CONFIG;
      const newMap = initMap(elementId, currentRegion, config);

      const viewState = getViewState(currentRegion);

      if (viewState) {
        setMapView([viewState.lat, viewState.lng], viewState.zoom);
      } else {
        const initialCenter = [
          (config.dimensions[0] / 2) + config.initialOffset.x,
          (config.dimensions[1] / 2) + config.initialOffset.y
        ];
        const center = newMap.unproject(initialCenter, config.maxZoom);
        setMapView(center, config.initialZoom);
      }

      addTileLayer(currentRegion, config);

      initialize();

      newMap.on('moveend', () => {
        if (!isChangingView) {
          saveViewState(currentRegion, newMap);
        }
      });

      newMap.on('zoomend', () => {
        if (!isChangingView) {
          saveViewState(currentRegion, newMap);
        }
      });
    }
  }, [elementId, isInitialized]);

  // alterMap
  useEffect(() => {
    if (isInitialized && map && previousRegion !== currentRegion) {
      saveViewState(previousRegion, map);

      const config = MAP_CONFIGS[currentRegion] || DEFAULT_CONFIG;
      map.options.maxZoom = config.maxZoom;

      addTileLayer(currentRegion, config);

      const viewState = getViewState(currentRegion);

      if (viewState) {
        setMapView([viewState.lat, viewState.lng], viewState.zoom, {
          animate: false, reset: true
        });
      } else {
        const initialCenter = [
          (config.dimensions[0] / 2) + config.initialOffset.x,
          (config.dimensions[1] / 2) + config.initialOffset.y
        ];
        const center = map.unproject(initialCenter, config.maxZoom);
        setMapView(center, config.initialZoom, {
          animate: false, reset: true
        });
      }
    }
  }, [currentRegion, isInitialized]);

  const selectSubregion = (subregionId) => {
    if (!map) return;

    const subregion = findSubregionById(subregionId);
    if (!subregion) return;

    setCurrentSubregion(subregion);

    if (subregion.bounds && subregion.bounds.length >= 2) {
      const [[x1, y1], [x2, y2]] = subregion.bounds;
      const centerX = (x1 + x2) / 2;
      const centerY = (y1 + y2) / 2;

      const config = MAP_CONFIGS[currentRegion] || DEFAULT_CONFIG;
      const center = map.unproject([centerX, centerY], config.maxZoom);

      map.once('moveend', () => {
        createHighlight(map, subregion, config);
      });

      setMapView(center, 1, {
        animate: true,
        duration: 0.5
      });
    }
  };

  const resetAll = () => {
    clearAllViewStates();

    if (map) {
      const config = MAP_CONFIGS[currentRegion] || DEFAULT_CONFIG;
      const initialCenter = [
        (config.dimensions[0] / 2) + config.initialOffset.x,
        (config.dimensions[1] / 2) + config.initialOffset.y
      ];
      const center = map.unproject(initialCenter, config.maxZoom);

      setMapView(center, config.initialZoom, { animate: true });
      setCurrentSubregion(null);
    }
  };
  // continMap(Unmount)
  useEffect(() => {
    return () => {
      if (map) {
        saveViewState(currentRegion, map);
      }
    };
  }, [map, currentRegion]);
  // continMap(Close/Refresh)
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (map) {
        saveViewState(currentRegion, map);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [map, currentRegion]);

  return {
    map,
    currentRegion,
    subregions,
    currentSubregion,
    setCurrentRegion,
    selectSubregion,
    resetAll
  };
}