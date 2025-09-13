import React, { useState } from 'react';
import styles from './UIOverlay.module.scss';

import Scale from '../scale/scale';
import { Trigger, TriggerBar } from '../trigger/trigger';
import { Headbar, Headitem } from '../headBar/headbar';
import { RegionContainer } from '../regSwitch/regSwitch';
import { Detail } from '../detail/detail';
import FilterList from '../filterList/filterList';

import ToS from '../../asset/logos/tos.svg?react';
import hideUI from '../../asset/logos/hideUI.svg?react';
import Group from '../../asset/logos/group.svg?react';
import i18n from '../../asset/logos/i18n.svg?react';
import Guide from '../../asset/logos/guide.svg?react';

interface UIOverlayProps {
  map?: L.Map;
  isSidebarOpen: boolean; // 保留用于某些需要的组件
}

interface TriggerState {
  t1: boolean;
  t2: boolean;
}

const UIOverlay: React.FC<UIOverlayProps> = ({ map, isSidebarOpen }) => {
  const [triggers, setTrigger] = useState<TriggerState>({ t1: false, t2: false });

  const handleTrigger1 = (isActive: boolean) => setTrigger({ ...triggers, t1: isActive });
  const handleTrigger2 = (isActive: boolean) => setTrigger({ ...triggers, t2: isActive });

  // 临时处理函数，可以根据需要实现具体功能
  const handleReset = () => console.log('Reset');
  const handleHideUI = () => console.log('HideUI');
  const handleGroup = () => console.log('Join related group');
  const handleLanguage = () => console.log('Choose language');
  const handleHelp = () => console.log('Reach out for help');

  return (
    <div className={`${styles.uiOverlay} ${isSidebarOpen ? styles.sidebarOpen : ''}`}>
      {/* Scale Component */}
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
      <RegionContainer isSidebarOpen={false} />

      {/* Triggerbar */}
      <TriggerBar isSidebarOpen={false}>
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

      {/* Detail Panel */}
      <Detail />

      {/* Filter List */}
      <FilterList isSidebarOpen={false} />
    </div>
  );
};

export default UIOverlay;
