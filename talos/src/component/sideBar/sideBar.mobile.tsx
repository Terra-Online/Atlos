import React, { useEffect, useMemo, useState } from 'react';
import styles from './sideBar.module.scss';
import drawerStyles from './sideBar.mobile.module.scss';

import Search from '../search/search';
import Drawer from '../drawer/drawer';
import { Trigger, TriggerBar } from '../trigger/trigger';
import MarkFilter from '../markFilter/markFilter';
import { MarkFilterDragProvider } from '../markFilter/reorderContext';
import MarkSelector from '../markSelector/markSelector';

import { MARKER_TYPE_TREE } from '@/data/marker';
import { useTranslateGame, useTranslateUI } from '@/locale';

interface SideBarProps {
  currentRegion: null;
  onToggle: (isOpen: boolean) => void;
}

const SNAP0 = 72; // px

const SideBarMobile: React.FC<SideBarProps> = ({ onToggle }) => {
  const t = useTranslateUI();
  const tGame = useTranslateGame();

  const [vh, setVh] = useState<number>(typeof window !== 'undefined' ? window.innerHeight : 800);

  useEffect(() => {
    const onResize = () => setVh(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const snaps = useMemo(() => {
    const s1 = Math.round(vh * 0.5);
    const s2 = Math.round(vh * 0.85);
    // Ensure ascending order and clamp
    const arr = [SNAP0, Math.max(SNAP0, s1), Math.max(SNAP0, s2)];
    const dedup = Array.from(new Set(arr)).sort((a, b) => a - b);
    return dedup;
  }, [vh]);

  // We notify onToggle when we've reached fully opened (last snap) or closed (first snap)
  const handleProgress = (p: number) => {
    if (p >= 0.999) onToggle?.(true);
    else if (p <= 0.001) onToggle?.(false);
  };

  return (
    <div className={styles.sidebarContainer}>
      {/* Mobile places the whole sidebar into a bottom drawer */}
      <Drawer
        side="bottom"
        initialSize={SNAP0}
        snap={snaps}
        snapThreshold={[50, 50, 50]}
        fullWidth={false}
        className={drawerStyles.MobileDrawer}
        handleClassName={drawerStyles.MobileDrawerHandle}
        contentClassName={drawerStyles.MobileDrawerContent}
        backdropClassName={drawerStyles.MobileDrawerBackdrop}
        onProgressChange={handleProgress}
        style={{ bottom: 0 }}
        debug={true}
      >
  <div className={styles.sidebarContent}>
          <Search />
          <div className={styles.filters}>
            <MarkFilterDragProvider>
              {Object.entries(MARKER_TYPE_TREE).map(([key, value]) => (
                <MarkFilter idKey={key} title={String(tGame(`markerType.types.${key}`))} key={key}>
                  {Object.values(value)
                    .flat()
                    .map((typeInfo) => (
                      <MarkSelector key={typeInfo.key} typeInfo={typeInfo} />
                    ))}
                </MarkFilter>
              ))}
            </MarkFilterDragProvider>
          </div>
        </div>
        <TriggerBar>
          <Trigger isActive={false} onToggle={() => {}} label={t('trigger.clusterMode')} />
          <Trigger isActive={false} onToggle={() => {}} label={t('trigger.boundaryMode')} />
          <Trigger isActive={false} onToggle={() => {}} label={t('trigger.optimalPath')} />
        </TriggerBar>
      </Drawer>
    </div>
  );
};

export default SideBarMobile;
