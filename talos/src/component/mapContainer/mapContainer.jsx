import React, { useEffect, useState, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './mapContainer.scss';

import { getTileResourceUrl } from "../../utils/resource"

import Scale from '../scale/scale';
import { Trigger, TriggerBar } from '../trigger/trigger';
import { Headbar, Headitem } from '../headBar/headbar';
import { RegSwitch, Reg } from '../regSwitch/regSwitch';

import { MAP_CONFIGS, DEFAULT_CONFIG } from './map_config';

import ToS from '../../asset/logos/tos.svg?react';
import hideUI from '../../asset/logos/hideUI.svg?react';
import Group from '../../asset/logos/group.svg?react';
import i18n from '../../asset/logos/i18n.svg?react';
import Guide from '../../asset/logos/guide.svg?react';


import Valley4 from '../../asset/logos/_Valley_4.svg?react';
import Jinlong from '../../asset/logos/_Jinlong.svg?react';
import Dijiang from '../../asset/logos/_Dijiang.svg?react';
import Æther from '../../asset/logos/Æther.svg?react';

// will be bundled with other possible universal funcs
function debounce(func, wait) {
  let timeout;
  return function(...args) {
    const context = this;
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(context, args), wait);
  };
}

// Declare for localStorage keys
const VIEWFIELD_STORAGE_KEY = 'map_view_states';
const REGION_STORAGE_KEY = 'map_reg_states';

const saveViewState = (region, map) => {
  if (!map) return;

  const center = map.getCenter();
  const zoom = map.getZoom();
  const viewState = {
    lat: center.lat,
    lng: center.lng,
    zoom: zoom
  };

  // Get existing states or create a new object
  const storedStates = JSON.parse(localStorage.getItem(VIEWFIELD_STORAGE_KEY) || '{}');
  storedStates[region] = viewState;
  localStorage.setItem(VIEWFIELD_STORAGE_KEY, JSON.stringify(storedStates));
  //console.log(`Saved view state for ${region}:`, viewState);
};

const debouncedSaveViewState = debounce(saveViewState, 300);

// Load last view state for a region
const loadViewState = (region) => {
  const storedStates = JSON.parse(localStorage.getItem(VIEWFIELD_STORAGE_KEY) || '{}');
  return storedStates[region] || null;
};

const MapContainer = ({ isSidebarOpen }) => {
  const [map, setMap] = useState(null);
  const [t1, t_1] = useState(true);
  const [t2, t_2] = useState(false);
  // Initialize from localStorage or default(Valley_4)
  const [currentRegion, setCurrentRegion] = useState(() => {
    const savedRegion = localStorage.getItem(REGION_STORAGE_KEY);
    return savedRegion || 'Valley_4';
  });
  const [isMapInitialized, setIsMapInitialized] = useState(false);
  const previousRegion = useRef(currentRegion);
  // Flag to prevent saving during programmatic view changes
  const isChangingView = useRef(false);

  // Save region to localStorage
  useEffect(() => {
    localStorage.setItem(REGION_STORAGE_KEY, currentRegion);
  }, [currentRegion]);

  useEffect(() => {
    if (!map) {
      // Get the map_config for the current region
      const config = MAP_CONFIGS[currentRegion] || DEFAULT_CONFIG;
      const initialMap = L.map('map', {
        crs: L.CRS.Simple,
        minZoom: 0,
        maxZoom: config.maxZoom,
        zoomControl: false,
        attributionControl: false,
        zoomSnap: 0.25,
        zoomDelta: 0.25,
        wheelPxPerZoomLevel: 10 // may cause sub-pixel issue
      });
      // unproject([x, y], zoom) -> LatLng and initialize for first time
      const southWest = initialMap.unproject([0, config.dimensions[1]], config.maxZoom);
      const northEast = initialMap.unproject([config.dimensions[0], 0], config.maxZoom);
      initialMap.setMaxBounds(new L.LatLngBounds(southWest, northEast));
      L.tileLayer(getTileResourceUrl(`/clips/${currentRegion}/{z}/{x}_{y}.webp`), {
        tileSize: config.tileSize,
        noWrap: true,
        bounds: L.latLngBounds(southWest, northEast)
      }).addTo(initialMap);

      // Load saved view state or use default
      const savedState = loadViewState(currentRegion);
      if (savedState) {
        isChangingView.current = true;
        initialMap.setView([savedState.lat, savedState.lng], savedState.zoom);
        isChangingView.current = false;
      } else {
        // inherit default map_config
        const initialCenter = [
          (config.dimensions[0] / 2) + config.initialOffset.x,
          (config.dimensions[1] / 2) + config.initialOffset.y
        ];
        const center = initialMap.unproject(initialCenter, config.maxZoom);
        isChangingView.current = true;
        initialMap.setView(center, config.initialZoom);
        isChangingView.current = false;
      }

      // Add event listeners to save view state when user interacts with the map
      // NOTE: will cause performance issues due to frequent writes, debonced but may not finally used
      initialMap.on('moveend', () => {
        if (!isChangingView.current) {
          debouncedSaveViewState(currentRegion, initialMap);
        }
      });
      initialMap.on('zoomend', () => {
        if (!isChangingView.current) {
          debouncedSaveViewState(currentRegion, initialMap);
        }
      });

      setMap(initialMap);
      setIsMapInitialized(true);
    }
  }, []); // Only run once onmount

  // Handle ndependent view states
  useEffect(() => {
    if (!map || !isMapInitialized) return;
    // Save the view state of the region we're leaving
    // Use direct save here (not debounced) since this is an important state transition
    if (previousRegion.current !== currentRegion) {
      saveViewState(previousRegion.current, map);
      // Get the new region's configuration
      const config = MAP_CONFIGS[currentRegion] || DEFAULT_CONFIG;
      // Remove all existing layers
      map.eachLayer(layer => map.removeLayer(layer));
      // Update map configuration for the new region
      map.options.maxZoom = config.maxZoom;
      // Reset the view bounds for the new region
      const southWest = map.unproject([0, config.dimensions[1]], config.maxZoom);
      const northEast = map.unproject([config.dimensions[0], 0], config.maxZoom);
      map.setMaxBounds(new L.LatLngBounds(southWest, northEast));
      // Add the new region's tile layer
      L.tileLayer(getTileResourceUrl(`/clips/${currentRegion}/{z}/{x}_{y}.webp`), {
        tileSize: config.tileSize,
        noWrap: true,
        bounds: L.latLngBounds(southWest, northEast)
      }).addTo(map);
      // Load the saved view state for this region or use default
      const savedState = loadViewState(currentRegion);
      isChangingView.current = true;
      if (savedState) {
        // Apply the saved view state
        map.setView([savedState.lat, savedState.lng], savedState.zoom, {
          animate: false,  // Disable animation for immediate switch
          reset: true      // Reset the view
        });
      } else {
        // Default config for first-time visitor to a region
        const initialCenter = [
          (config.dimensions[0] / 2) + config.initialOffset.x,
          (config.dimensions[1] / 2) + config.initialOffset.y
        ];
        const center = map.unproject(initialCenter, config.maxZoom);
        map.setView(center, config.initialZoom, {
          animate: false,
          reset: true
        });
      }
      isChangingView.current = false;
      // Update the previous region reference
      previousRegion.current = currentRegion;
    }
  }, [currentRegion, map, isMapInitialized]);

  // Handle region change from UI
  const handleRegionChange = (region) => {
    //console.log('Region changed:', region);
    setCurrentRegion(region);
  };

  const trigger1 = (isActive) => {
    t_1(isActive);
    console.log('T1', isActive);
  };
  const trigger2 = (isActive) => {
    t_2(isActive);
    console.log('T2', isActive);
  };

  const h1 = () => {
    console.log('ToS');
    //temporarily for purging
    localStorage.removeItem(VIEWFIELD_STORAGE_KEY);
    localStorage.removeItem(REGION_STORAGE_KEY);
    console.log('Purged!');
    // fallback to default view
    if (map) {
      const config = MAP_CONFIGS[currentRegion] || DEFAULT_CONFIG;
      const initialCenter = [
        (config.dimensions[0] / 2) + config.initialOffset.x,
        (config.dimensions[1] / 2) + config.initialOffset.y
      ];
      const center = map.unproject(initialCenter, config.maxZoom);
      isChangingView.current = true;
      map.setView(center, config.initialZoom, { animate: true });
      isChangingView.current = false;
      console.log(`Reset view for ${currentRegion} to default`);
    }
  };
  const h2 = () => {
    console.log('HideUI');
  };
  const h3 = () => {
    console.log('Join related group');
  };
  const h4 = () => {
    console.log('Choose language');
  };
  const h5 = () => {
    console.log('Reach out for help');
  };

  // Save view state when unmounting - use direct save (not debounced)
  useEffect(() => {
    return () => {
      if (map) {
        saveViewState(currentRegion, map);
      }
    };
  }, [currentRegion, map]);

  // Add a window beforeunload event listener to save state on refresh/close
  // Use direct save (not debounced) for critical operations
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
  }, [currentRegion, map]);

  return (
    <div>
      <div id="map"></div>
      {map && <Scale map={map} />}

      {/* Headbar */}
      <Headbar isSidebarOpen={isSidebarOpen}>
        <Headitem
          icon={ToS}
          onClick={h1}
          tooltip="Terms of Service"
        />
        <Headitem
          icon={hideUI}
          onClick={h2}
          tooltip="Hide UI"
        />
        <Headitem
          icon={Group}
          onClick={h3}
          tooltip="Join related group"
        />
        <Headitem
          icon={i18n}
          onClick={h4}
          tooltip="Choose language"
        />
        <Headitem
          icon={Guide}
          onClick={h5}
          tooltip="Reach out for help"
        />
      </Headbar>

      {/* RegSwitch */}
      <RegSwitch
        value={currentRegion}
        onChange={handleRegionChange}
        position="right"
        isSidebarOpen={isSidebarOpen}
      >
        <Reg
          icon={Valley4}
          value="Valley_4"
          tooltip="4號谷地"
        />
        <Reg
          icon={Jinlong}
          value="Jinlong"
          tooltip="錦隴"
        />
        <Reg
          icon={Dijiang}
          value="Dijiang"
          tooltip="帝江"
        />
        <Reg
          icon={Æther}
          value="Æther"
          tooltip="超域"
          disabled={true}
        />
      </RegSwitch>

      {/* Triggerbar */}
      <TriggerBar isSidebarOpen={isSidebarOpen}>
        <Trigger
          isActive={t1}
          onToggle={trigger1}
          label="Complex Select"
        />
        <Trigger
          isActive={t2}
          onToggle={trigger2}
          label="Regional POI"
        />
      </TriggerBar>
    </div>
  );
};

export default MapContainer;