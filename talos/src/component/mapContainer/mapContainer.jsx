import React from 'react';
import 'leaflet/dist/leaflet.css';
import './mapContainer.scss';

import { useMap } from './hook/useMap';
import useUI from './store/ui';

import Scale from '../scale/scale';
import { Trigger, TriggerBar } from '../trigger/trigger';
import { Headbar, Headitem } from '../headBar/headbar';
import { RegSwitch, Reg, SubRegSwitch, SubReg, RegionContainer } from '../regSwitch/regSwitch';

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
  // useMap
  const {
    map,
    currentRegion,
    subregions,
    currentSubregion,
    setCurrentRegion,
    selectSubregion,
    resetAll
  } = useMap('map');
  // useExternalUI
  const { triggers, setTrigger } = useUI();

  const handleRegionChange = (region) => setCurrentRegion(region);
  const handleSubregionChange = (subregionId) => selectSubregion(subregionId);

  const handleTrigger1 = (isActive) => setTrigger('t1', isActive);
  const handleTrigger2 = (isActive) => setTrigger('t2', isActive);

  // temprarily not store headBar
  const handleReset = () => resetAll();
  const handleHideUI = () => console.log('HideUI');
  const handleGroup = () => console.log('Join related group');
  const handleLanguage = () => console.log('Choose language');
  const handleHelp = () => console.log('Reach out for help');

  return (
    <div>
      <div id="map"></div>
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
      <RegionContainer isSidebarOpen={isSidebarOpen}>
        <RegSwitch
          value={currentRegion}
          onChange={handleRegionChange}
        >
          <Reg icon={Valley4} value="Valley_4" tooltip="4號谷地" />
          <Reg icon={Jinlong} value="Jinlong" tooltip="錦隴" />
          <Reg icon={Dijiang} value="Dijiang" tooltip="帝江" />
          <Reg icon={Æther} value="Æther" tooltip="超域" disabled={true} />
        </RegSwitch>

        {/* Subregion Switch */}
        {subregions.length > 0 && (
          <SubRegSwitch
            value={currentSubregion?.id}
            onChange={handleSubregionChange}
          >
            {subregions.map(subregion => (
              <SubReg
                key={subregion.id}
                value={subregion.id}
                tooltip={subregion.name}
                color={subregion.color}
              />
            ))}
          </SubRegSwitch>
        )}
      </RegionContainer>

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
    </div>
  );
};

export default MapContainer;