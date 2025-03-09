import React, { useEffect, useState } from 'react';
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

const MapContainer = ({ isSidebarOpen }) => {
  const [map, setMap] = useState(null);
  const [t1, t_1] = useState(true);
  const [t2, t_2] = useState(false);
  const [currentRegion, setCurrentRegion] = useState('Valley_4');

  const currentConfig = MAP_CONFIGS[currentRegion] || DEFAULT_CONFIG;
  const {
    dimensions: MAP_DIMENSIONS,
    maxZoom: MAX_ZOOM,
    tileSize: TILE_SIZE,
    initialOffset: INITIAL_OFFSET,
    initialZoom
  } = currentConfig;

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
        wheelPxPerZoomLevel: 10 // will cause sub-pixel issue
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
      initialMap.setView(center, initialZoom);

      setMap(initialMap);
    } else {
      map.eachLayer(layer => map.removeLayer(layer));

      L.tileLayer(getTileResourceUrl(`/clips/${currentRegion}/{z}/{x}_{y}.webp`), {
        tileSize: TILE_SIZE,
        noWrap: true,
        bounds: L.latLngBounds(
          map.unproject([0, MAP_DIMENSIONS[1]], MAX_ZOOM),
          map.unproject([MAP_DIMENSIONS[0], 0], MAX_ZOOM)
        )
      }).addTo(map);
    }
  }, [map, currentRegion]);

  // will import encapsulated controller
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

  const handleRegionChange = (region) => {
    console.log('Region changed:', region);
    setCurrentRegion(region);
  };

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