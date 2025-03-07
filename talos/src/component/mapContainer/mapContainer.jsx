import React, { useEffect, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './mapContainer.scss';

import Scale from '../scale/scale';
import { Trigger, TriggerArea } from '../trigger/trigger';

const MapContainer = ({ isSidebarOpen }) => {
  const [map, setMap] = useState(null);
  const [t1, t_1] = useState(true);
  const [t2, t_2] = useState(false);

  // For Valley4 Only !!! The switch of map should be done in the future and these should be provided when mounting as map_config.
  const MAP_DIMENSIONS = [8000, 10000]; // Adjust when change map
  const MAX_ZOOM = 3;
  const TILE_SIZE = 200;
  const INITIAL_OFFSET = {
    x: 750,  // Minor to left
    y: 250   // Minor to top
  };

  /* debug
  useEffect(() => {
    console.log("MapContainer receive sideBar.jsx:", isSidebarOpen);
  }, [isSidebarOpen]);
  */

  useEffect(() => {
    if (!map) {
      const initialMap = L.map('map', {
        crs: L.CRS.Simple,
        minZoom: 0,
        maxZoom: MAX_ZOOM,
        zoomControl: false,
        attributionControl: false,
        zoomSnap: 0.25,
        zoomDelta: 0.25,
        wheelPxPerZoomLevel: 10
      });

      // Set bounds
      const southWest = initialMap.unproject([0, MAP_DIMENSIONS[1]], MAX_ZOOM);
      const northEast = initialMap.unproject([MAP_DIMENSIONS[0], 0], MAX_ZOOM);
      initialMap.setMaxBounds(new L.LatLngBounds(southWest, northEast));

      // unproject to find center
      const initialCenter = [
        (MAP_DIMENSIONS[0] / 2) + INITIAL_OFFSET.x,
        (MAP_DIMENSIONS[1] / 2) + INITIAL_OFFSET.y
      ];
      const center = initialMap.unproject(initialCenter, MAX_ZOOM);

      // Set onmount view
      initialMap.setView(center, 2);

      setMap(initialMap);
    } else {
      map.eachLayer(layer => map.removeLayer(layer));

      L.tileLayer(`/clips/Valley_4/{z}/{x}_{y}.webp`, {
        tileSize: TILE_SIZE,
        noWrap: true,
        bounds: L.latLngBounds(
          map.unproject([0, MAP_DIMENSIONS[1]], MAX_ZOOM),
          map.unproject([MAP_DIMENSIONS[0], 0], MAX_ZOOM)
        )
      }).addTo(map);
    }
  }, [map]);

  // will import encapsulated controller
  const trigger1 = (isActive) => {
    t_1(isActive);
    console.log('T1', isActive);
  };

  const trigger2 = (isActive) => {
    t_2(isActive);
    console.log('T2', isActive);
  };

  return (
    <div>
      <div id="map"></div>
      {map && <Scale map={map}/>}

      <TriggerArea isSidebarOpen={isSidebarOpen}>
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
      </TriggerArea>
    </div>
  );
};

export default MapContainer;