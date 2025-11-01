import React, { useEffect, useMemo, useRef, useState } from 'react';
import { LinearBlur } from "progressive-blur";
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
  const contentRef = useRef<HTMLDivElement>(null);
  const [isScrolledTop, setIsScrolledTop] = useState(true);
  const [isScrolledBottom, setIsScrolledBottom] = useState(false);
  const [currentSnap, setCurrentSnap] = useState(0);
  const [rightContentWidth, setRightContentWidth] = useState(0);

  // We notify onToggle when we've reached fully opened (last snap) or closed (first snap)
  const handleProgress = (p: number) => {
    if (p >= 0.999) onToggle?.(true);
    else if (p <= 0.001) onToggle?.(false);

    // When collapsed (snap-0), ensure content scrolls back to top
    if (p <= 0.02) {
      setCurrentSnap(0);
      const scroller = contentRef.current;
      if (scroller && scroller.scrollTop !== 0) {
        scroller.scrollTo({ top: 0, behavior: 'smooth' });
      }
    } else {
      // Determine current snap index based on progress
      const snapIndex = snapsNormalized.findIndex((s, i) => {
        if (i === snapsNormalized.length - 1) return true;
        const nextSnap = snapsNormalized[i + 1];
        const snapProgress = (s - minSnap) / safeRange;
        const nextProgress = (nextSnap - minSnap) / safeRange;
        return p >= snapProgress && p < nextProgress;
      });
      setCurrentSnap(Math.max(0, snapIndex));
    }
  };

  // Track scroll position for blur effects
  useEffect(() => {
    const scroller = contentRef.current;
    if (!scroller) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = scroller;
      setIsScrolledTop(scrollTop <= 1);
      setIsScrolledBottom(scrollTop + clientHeight >= scrollHeight - 1);
    };

    handleScroll(); // Initial check
    scroller.addEventListener('scroll', handleScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', handleScroll);
  }, []);

  const snapsNormalized = snaps;
  const minSnap = snaps[0] ?? 0;
  const maxSnap = snaps[snaps.length - 1] ?? 0;
  const safeRange = (maxSnap - minSnap) || 1;

  // When a point is activated, snap to middle (index 1)
  useEffect(() => {
    if (currentPoint) {
      setSnapToIndex(1);
    }
  }, [currentPoint]);

  const [leftRatio, setLeftRatio] = useState(0.6); // Search pane width ratio in TopRow
  const [atLeftEdge, setAtLeftEdge] = useState(false);
  const [atRightEdge, setAtRightEdge] = useState(false);

  // Smooth animate helper
  const animateLeftRatio = React.useCallback((to: number, duration = 220) => {
    const from = leftRatio;
    const start = performance.now();
    const ease = (t: number) => 1 - Math.pow(1 - t, 3); // easeOutCubic
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const v = from + (to - from) * ease(t);
      setLeftRatio(v);
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [leftRatio]);

  const handleDividerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const container = (e.currentTarget.parentElement as HTMLDivElement) || null;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    // 左侧最小 3rem，右侧不超过内容宽度
    const minLeftPx = 50;
    const minLeftBound = Math.max(minLeftPx / rect.width, 1 - Math.min(1, (rightContentWidth || 0) / rect.width));
    const maxLeftBound = 0.98; // allow near-full width when right content is tiny
    const snapPoint = 0.6;
    const snapBand = 0.1; // 10% snapping
    let latestRatio = leftRatio;

    const onMove = (ev: PointerEvent) => {
      const x = ev.clientX;
      const ratio = (x - rect.left) / rect.width;
      // No snap during move; snap on release for smoothness
      const clamped = Math.max(minLeftBound, Math.min(maxLeftBound, ratio));
      latestRatio = clamped;
      setLeftRatio(clamped);
      const eps = 0.005;
      setAtLeftEdge(clamped <= minLeftBound + eps);
      setAtRightEdge(clamped >= maxLeftBound - eps);
    };
    const onUp = () => {
      // Snap on release if within band
      if (Math.abs(latestRatio - snapPoint) <= snapBand) {
        animateLeftRatio(snapPoint);
      }
      window.removeEventListener('pointermove', onMove);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  };

  // Expand Search to 0.6 when focused/clicked
  const handleSearchFocus = () => {
    if (leftRatio < 0.6) animateLeftRatio(0.6);
  };

  // Constrain right pane to its content width by capping max-width
  const [rightMaxWidth, setRightMaxWidth] = useState<string | number>('auto');
  const hasRightContent = rightContentWidth > 1;

  useEffect(() => {
    const row = rootRef.current?.querySelector(`.${mobileStyles.topRow}`) as HTMLElement | null;
    if (!row) return;
    const rowWidth = row.clientWidth || 1;
    const minLeftPx = 48; // 3rem

    if (!hasRightContent) {
      // 右侧无内容时，左侧占满（接近 100%）
      setRightMaxWidth(0);
      setAtRightEdge(true); // 右侧空内容时标记为在右边缘（隐藏右箭头）
      if (leftRatio < 0.98) {
        animateLeftRatio(0.98, 260);
      }
    } else {
      // 右侧有内容：按内容宽度弹出，最多到 divider 在 0.6 处
      setAtRightEdge(false);
      const targetRatio = Math.max(0.6, 1 - Math.min(rightContentWidth / rowWidth, 1));
      // 限定左侧最小 3rem
      const minLeftBound = Math.max(minLeftPx / rowWidth, targetRatio);
      const dynMaxWidth = Math.min(rightContentWidth, rowWidth * (1 - leftRatio));
      setRightMaxWidth(dynMaxWidth);
      
      // 只在 leftRatio 明显大于目标时才自动调整（避免循环触发）
      if (leftRatio > minLeftBound + 0.01) {
        // 自动收缩左侧以容纳右侧内容（直到 divider 到 0.6）
        animateLeftRatio(minLeftBound);
      }
    }
  }, [rightContentWidth, leftRatio, animateLeftRatio, hasRightContent]);

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
        <div className={mobileStyles.contentWrapper} ref={contentRef}>
          <div className={mobileStyles.sidebarContent}>
            {/* Top row: Search + FilterList with draggable divider */}
            <div className={mobileStyles.topRow}>
              <div className={mobileStyles.topRowPane} style={{ flexBasis: `${leftRatio * 100}%` }} onFocus={handleSearchFocus} onClick={handleSearchFocus}>
                <Search />
              </div>
              <div
                className={`${mobileStyles.divider} ${atLeftEdge ? mobileStyles.atLeft : ''} ${atRightEdge ? mobileStyles.atRight : ''}`}
                role="separator"
                aria-orientation="vertical"
                onPointerDown={handleDividerPointerDown}
              />
              <div 
                className={mobileStyles.topRowPane} 
                style={{ 
                  flexBasis: `${(1 - leftRatio) * 100}%`, 
                  maxWidth: rightMaxWidth,
                  visibility: hasRightContent ? 'visible' : 'hidden',
                  position: hasRightContent ? 'relative' : 'absolute',
                  pointerEvents: hasRightContent ? 'auto' : 'none',
                }}
              >
                <FilterListMobile width="100%" onContentWidthChange={setRightContentWidth} />
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
          <div className={mobileStyles.mobileTriggerBar}>
            <Trigger isActive={trigCluster} onToggle={(v) => setTrigCluster(v)} label={t('trigger.clusterMode')} />
            <Trigger isActive={trigBoundary} onToggle={(v) => setTrigBoundary(v)} label={t('trigger.boundaryMode')} />
            <Trigger isActive={trigOptimal} onToggle={(v) => setTrigOptimal(v)} label={t('trigger.optimalPath')} />
          </div>
        </div>

        {/* Top blur: visible when not at snap-0 and not scrolled to top */}
        {currentSnap > 0 && !isScrolledTop && (
          <LinearBlur
            side='top'
            strength={24}
            falloffPercentage={100}
            style={{
              position: "absolute",
              top: '-1rem',
              left: 0,
              right: 0,
              zIndex: 15,
              height: '3.5rem',
              pointerEvents: 'none'
            }}
          />
        )}

        {/* Bottom blur: visible when not at snap-0 and not scrolled to bottom */}
        {currentSnap > 0 && !isScrolledBottom && (
          <LinearBlur
            side='bottom'
            strength={16}
            falloffPercentage={100}
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              zIndex: 10,
              height: '3rem',
              pointerEvents: 'none'
            }}
          />
        )}
      </Drawer>
    </div>
  );
};

export default SideBarMobile;