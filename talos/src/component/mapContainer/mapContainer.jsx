import React, { useEffect, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './mapContainer.scss';

const MapContainer = () => {
  const [map, setMap] = useState(null);

  // For Valley4 Only !!! The switch of map should be done in the future and these should be provided when mounting as map_config.
  const MAP_DIMENSIONS = [8000, 10000]; // Adjust when change map
  const MAX_ZOOM = 3;
  const TILE_SIZE = 200;
  const INITIAL_OFFSET = {
    x: 750,  // Minor to left
    y: 250   // Minor to top
  };

  useEffect(() => {
    if (!map) {
      // Create new map instance
      const initialMap = L.map('map', {
        crs: L.CRS.Simple,
        minZoom: 0,
        maxZoom: MAX_ZOOM,
        zoomControl: false,
        attributionControl: false
      });

      // Set bounds
      const southWest = initialMap.unproject([0, MAP_DIMENSIONS[1]], MAX_ZOOM);
      const northEast = initialMap.unproject([MAP_DIMENSIONS[0], 0], MAX_ZOOM);
      initialMap.setMaxBounds(new L.LatLngBounds(southWest, northEast));

      // unproject to find center
      const initialCenter = [
        (MAP_DIMENSIONS[0] / 2) + INITIAL_OFFSET.x,  // x 坐标
        (MAP_DIMENSIONS[1] / 2) + INITIAL_OFFSET.y   // y 坐标
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

  return (
    <div id="map"></div>
  );
};

export default MapContainer;