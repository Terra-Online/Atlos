import React, { useEffect, useMemo, useRef, useState } from 'react';
import mobileStyles from './sideBar.mobile.module.scss';

import Search from '../search/search';
import FilterListMobile from '../filterList/filterList.mobile';
import Drawer from '../drawer/drawer';
import { Trigger } from '../trigger/trigger';
import MarkFilter from '../markFilter/markFilter';
import { MarkFilterDragProvider } from '../markFilter/reorderContext';
import MarkSelector from '../markSelector/markSelector';
import Detail from '../detail/detail';

import { MARKER_TYPE_TREE } from '@/data/marker';
import { useTranslateGame, useTranslateUI } from '@/locale';
import { useMarkerStore } from '@/store/marker';
import { useTriggerCluster, useTriggerBoundary, useTriggerOptimalPath, useSetTriggerCluster, useSetTriggerBoundary, useSetTriggerOptimalPath } from '@/store/uiPrefs';

interface SideBarProps {
  currentRegion: null;
  onToggle: (isOpen: boolean) => void;
}

const SNAP0 = 64; // px

const SideBarMobile: React.FC<SideBarProps> = ({ onToggle }) => {
  const t = useTranslateUI();
  const tGame = useTranslateGame();

  const [vh, setVh] = useState<number>(typeof window !== 'undefined' ? window.innerHeight : 800);
  const currentPoint = useMarkerStore((s) => s.currentActivePoint);
  const [snapToIndex, setSnapToIndex] = useState<number | null>(null);
  const trigCluster = useTriggerCluster();
  const trigBoundary = useTriggerBoundary();
  const trigOptimal = useTriggerOptimalPath();
  const setTrigCluster = useSetTriggerCluster();
  const setTrigBoundary = useSetTriggerBoundary();
  const setTrigOptimal = useSetTriggerOptimalPath();

  useEffect(() => {
    const onResize = () => setVh(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const snaps = useMemo(() => {
    const s1 = Math.round(vh * 0.5);
    const s2 = Math.round(vh * 0.82);
    // Ensure ascending order and clamp
    const arr = [SNAP0, Math.max(SNAP0, s1), Math.max(SNAP0, s2)];
    const dedup = Array.from(new Set(arr)).sort((a, b) => a - b);
    return dedup;
  }, [vh]);

  const rootRef = useRef<HTMLDivElement>(null);

  // We notify onToggle when we've reached fully opened (last snap) or closed (first snap)
  const handleProgress = (p: number) => {
    if (p >= 0.999) onToggle?.(true);
    else if (p <= 0.001) onToggle?.(false);

    // When collapsed (snap-0), ensure content scrolls back to top
    if (p <= 0.02) {
      const scroller = rootRef.current?.querySelector(`.${mobileStyles.mobileDrawerContent}`) as HTMLElement | null;
      if (scroller && scroller.scrollTop !== 0) {
        scroller.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }
  };

  // When a point is activated, snap to middle (index 1)
  useEffect(() => {
    if (currentPoint) {
      setSnapToIndex(1);
    }
  }, [currentPoint]);

  const [leftRatio, setLeftRatio] = useState(0.6); // Search pane width ratio in TopRow

  const handleDividerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const container = (e.currentTarget.parentElement as HTMLDivElement) || null;
    if (!container) return;
    const rect = container.getBoundingClientRect();

    const onMove = (ev: PointerEvent) => {
      const x = ev.clientX;
      const ratio = (x - rect.left) / rect.width;
      const clamped = Math.max(0.12, Math.min(0.8, ratio));
      setLeftRatio(clamped);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  };

  return (
    <div className={mobileStyles.sidebarContainer} ref={rootRef}>
      {/* Mobile places the whole sidebar into a bottom drawer */}
      <Drawer
        side="bottom"
        initialSize={SNAP0}
        snap={snaps}
        snapThreshold={[50, 50, 50]}
        handleSize={16}
        fullWidth={false}
        className={mobileStyles.mobileDrawer}
        handleClassName={mobileStyles.mobileDrawerHandle}
        contentClassName={mobileStyles.mobileDrawerContent}
        backdropClassName={mobileStyles.mobileDrawerBackdrop}
        onProgressChange={handleProgress}
        style={{ bottom: 0 }}
        snapToIndex={snapToIndex}
        debug={true}
      >
  <div className={mobileStyles.sidebarContent}>
          {/* Top row: Search + FilterList with draggable divider */}
          <div className={mobileStyles.topRow}>
            <div className={mobileStyles.topRowPane} style={{ flexBasis: `${leftRatio * 100}%` }}>
              <Search />
            </div>
            <div
              className={mobileStyles.divider}
              role="separator"
              aria-orientation="vertical"
              onPointerDown={handleDividerPointerDown}
            />
            <div className={mobileStyles.topRowPane} style={{ flexBasis: `${(1 - leftRatio) * 100}%` }}>
              <FilterListMobile width="100%" />
            </div>
          </div>

          {/* Detail slot between top row and filters */}
          <div className={mobileStyles.detailSlot}><Detail inline /></div>

          <div className={mobileStyles.filters}>
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
        {/* Mobile in-flow trigger bar with 2-column layout */}
        <div className={mobileStyles.mobileTriggerBar}>
          <Trigger isActive={trigCluster} onToggle={(v) => setTrigCluster(v)} label={t('trigger.clusterMode')} />
          <Trigger isActive={trigBoundary} onToggle={(v) => setTrigBoundary(v)} label={t('trigger.boundaryMode')} />
          <Trigger isActive={trigOptimal} onToggle={(v) => setTrigOptimal(v)} label={t('trigger.optimalPath')} />
        </div>
      </Drawer>
    </div>
  );
};

export default SideBarMobile;