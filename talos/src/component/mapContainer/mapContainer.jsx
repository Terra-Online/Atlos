import React, { useMemo, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import styles from './mapContainer.module.scss';


import { useMap } from './useMap';

import Scale from '../scale/scale';
import { Trigger, TriggerBar } from '../trigger/trigger';
import { Headbar, Headitem } from '../headBar/headbar';
import { RegionContainer } from '../regSwitch/regSwitch';
import { Detail } from '../detail/detail';

import ToS from '../../asset/logos/tos.svg?react';
import hideUI from '../../asset/logos/hideUI.svg?react';
import Group from '../../asset/logos/group.svg?react';
import i18n from '../../asset/logos/i18n.svg?react';
import Guide from '../../asset/logos/guide.svg?react';

import Valley4 from '../../asset/logos/_Valley_4.svg?react';
import Jinlong from '../../asset/logos/_Jinlong.svg?react';
import Dijiang from '../../asset/logos/_Dijiang.svg?react';
import Æther from '../../asset/logos/Æther.svg?react';
import FilterList from '../filterList/filterList';
import { REGION_DICT } from '@/data/map';

const MapContainer = ({ isSidebarOpen }) => {
  // useMap
  const {
    map,
    currentRegion,
    currentSubregion,
    setCurrentRegion,
    setCurrentSubregion,
  } = useMap('map');
  const subregions = useMemo(() => REGION_DICT[currentRegion].subregions, [currentRegion]);
  // useExternalUI
  const [triggers, setTrigger] = useState({ t1: false, t2: false });

  const handleRegionChange = (region) => setCurrentRegion(region);
  const handleSubregionChange = (subregionId) => setCurrentSubregion(subregionId);

  const handleTrigger1 = (isActive) => setTrigger({ ...triggers, t1: isActive });
  const handleTrigger2 = (isActive) => setTrigger({ ...triggers, t2: isActive });

  // temprarily not store headBar
  const handleReset = () => console.log('Reset');
  const handleHideUI = () => console.log('HideUI');
  const handleGroup = () => console.log('Join related group');
  const handleLanguage = () => console.log('Choose language');
  const handleHelp = () => console.log('Reach out for help');

  return (
    <div>
      <div className={styles.mainMapContainer} id="map"></div>
      {map && <Scale map={map} />}

      {/* Headbar */}
      <Headbar isSidebarOpen={isSidebarOpen}>
        <Headitem
          icon={ToS}
          onClick={handleReset}
          tooltip="Terms of Service"
        />
        <Headitem
          icon={hideUI}
          onClick={handleHideUI}
          tooltip="Hide UI"
        />
        <Headitem
          icon={Group}
          onClick={handleGroup}
          tooltip="Join related group"
        />
        <Headitem
          icon={i18n}
          onClick={handleLanguage}
          tooltip="Choose language"
        />
        <Headitem
          icon={Guide}
          onClick={handleHelp}
          tooltip="Reach out for help"
        />
      </Headbar>

      {/* Region Switch */}
      <RegionContainer isSidebarOpen={isSidebarOpen} />

      {/* Triggerbar */}
      <TriggerBar isSidebarOpen={isSidebarOpen}>
        <Trigger
          isActive={triggers.t1}
          onToggle={handleTrigger1}
          label="Complex Select"
        />
        <Trigger
          isActive={triggers.t2}
          onToggle={handleTrigger2}
          label="Regional POI"
        />
      </TriggerBar>

      <Detail />
      <FilterList isSidebarOpen={isSidebarOpen} />
    </div>
  );
};

export default MapContainer;