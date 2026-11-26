import { AccountCard, SidebarFooter } from '@/component/shared/siteShell/sideBar.frame';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { animate } from 'motion';
import { motion, useMotionValue, useMotionValueEvent, useTransform } from 'motion/react';
import AdaptiveLinearBlur from '@/component/effects/AdaptiveLinearBlur';
import mobileStyles from '@/component/shared/siteShell/sideBar.mobile.module.scss';

import SearchMobile from '@/pages/search/search.mobile';
import FilterListMobile from '@/pages/filterList/filterList.mobile';
import Drawer from '@/component/drawer/drawer';
import { Trigger } from '@/component/trigger/trigger';
import { SidebarWindow } from './sidebarWindow';
import { SidebarFilters, categoryCount } from './sidebarFilters';
import Detail from '@/pages/detail/detail';

import { MARKER_TYPE_DICT } from '@/data/marker';
import { useTranslateUI } from '@/locale';
import { useFilter, useMarkerStore } from '@/store/marker';
import { useTriggerCluster, useTriggerBoundary, useTriggerlabelName, useSetTriggerCluster, useSetTriggerBoundary, useSetTriggerlabelName, useSetMobileDrawerSnapIndex, useMobileDrawerSnapIndex, useUiPrefsHydrated } from '@/store/uiPrefs';
import { useAppViewport } from '@/platform/device';
import { useDividerDrag } from './useDividerDrag';
import { useSidebarPreparation } from './useSidebarPreparation';

interface SideBarProps {
  currentRegion: null;
  onToggle: (isOpen: boolean) => void;
  visible?: boolean;
}

const SNAP0_FALLBACK = 64; // px
const SNAP0_COLLAPSED_EXTRA = 16; // px
const TOP_ROW_MIN_SEARCH_PX = 48;

const SideBarMobile: React.FC<SideBarProps> = ({ onToggle, visible = true }) => {
  const t = useTranslateUI();
  const { height: vh } = useAppViewport();
  const filterList = useFilter();
  const searchString = useMarkerStore((s) => s.searchString);
  const drawerSnapIndex = useMobileDrawerSnapIndex();
  const uiPrefsHydrated = useUiPrefsHydrated();
  const trigCluster = useTriggerCluster();
  const trigBoundary = useTriggerBoundary();
  const trigOptimal = useTriggerlabelName();
  const setTrigCluster = useSetTriggerCluster();
  const setTrigBoundary = useSetTriggerBoundary();
  const setTrigOptimal = useSetTriggerlabelName();
  const setDrawerSnapIndex = useSetMobileDrawerSnapIndex();

  const rootRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const topRowRef = useRef<HTMLDivElement>(null);
  const [isScrolledTop, setIsScrolledTop] = useState(true);
  const [isScrolledBottom, setIsScrolledBottom] = useState(false);
  const [hasOpened, setHasOpened] = useState(() => (drawerSnapIndex ?? 0) > 0);
  const [topRowWidth, setTopRowWidth] = useState(0);
  const [topRowHeight, setTopRowHeight] = useState(0);
  const [topRowBaseHeight, setTopRowBaseHeight] = useState(0);
  const [rightContentWidth, setRightContentWidth] = useState(0);
  const prevHasSearchQueryRef = useRef(false);
  const hasSearchQuery = searchString.trim().length > 0;

  const snap0 = useMemo(() => {
    const base = topRowBaseHeight > 0 ? topRowBaseHeight : topRowHeight;
    if (base <= 0) return SNAP0_FALLBACK;
    return Math.max(40, Math.round(base + SNAP0_COLLAPSED_EXTRA));
  }, [topRowBaseHeight, topRowHeight]);

  const snaps = useMemo(() => {
    const s1 = Math.round(vh * 0.55);
    const s2 = Math.round(vh * 0.85);
    // Ensure ascending order and clamp
    const arr = [snap0, Math.max(snap0, s1), Math.max(snap0, s2)];
    const dedup = Array.from(new Set(arr)).sort((a, b) => a - b);
    return dedup;
  }, [vh, snap0]);

  const lastSnap = snaps.length - 1;
  const currentSnap = uiPrefsHydrated ? Math.min(drawerSnapIndex ?? 0, lastSnap) : 0;
  const previousSnap = useRef(currentSnap);

  useEffect(() => {
    if (currentSnap > 0) setHasOpened(true);
    if (previousSnap.current === currentSnap) return;
    previousSnap.current = currentSnap;
    if (currentSnap === lastSnap && currentSnap > 0) onToggle(true);
    if (currentSnap === 0) {
      onToggle(false);
      const scroller = contentRef.current;
      if (scroller?.scrollTop) scroller.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }, [currentSnap, lastSnap, onToggle]);

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

  useEffect(() => {
    if (!prevHasSearchQueryRef.current && hasSearchQuery && currentSnap === 0) {
      setDrawerSnapIndex(Math.min(1, lastSnap));
    }
    prevHasSearchQueryRef.current = hasSearchQuery;
  }, [currentSnap, hasSearchQuery, lastSnap, setDrawerSnapIndex]);

  const hasFilterList = useMemo(
    () => filterList.some((item) => MARKER_TYPE_DICT[item]?.category?.main !== 'files'),
    [filterList],
  );

  useEffect(() => {
    const row = topRowRef.current;
    if (!row) return;
    const update = () => {
      setTopRowWidth(row.clientWidth || 0);
      setTopRowHeight(row.offsetHeight || 0);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(row);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (hasSearchQuery) return;
    if (topRowHeight <= 0) return;
    if (Math.abs(topRowHeight - topRowBaseHeight) > 0.5) {
      setTopRowBaseHeight(topRowHeight);
    }
  }, [hasSearchQuery, topRowHeight, topRowBaseHeight]);

  const [leftRatio, setLeftRatio] = useState(1);
  const ratioMotion = useMotionValue(1);
  const [searchExpanded, setSearchExpanded] = useState(false);
  const leftRatioRef = useRef(1);
  const prevLeftBoundRef = useRef(1);

  const searchMinRatio = useMemo(() => {
    if (topRowWidth <= 0) return 0;
    return Math.min(0.98, TOP_ROW_MIN_SEARCH_PX / topRowWidth);
  }, [topRowWidth]);

  const filterNaturalLeftBound = useMemo(() => {
    if (!hasFilterList || topRowWidth <= 0) return 1;
    const clampedWidth = Math.min(rightContentWidth, topRowWidth);
    return 1 - clampedWidth / topRowWidth;
  }, [hasFilterList, rightContentWidth, topRowWidth]);

  const leftBound = hasFilterList ? Math.max(searchMinRatio, filterNaturalLeftBound) : 1;
  const rightBound = 1;
  const hasFilterPaneHost = hasFilterList && !hasSearchQuery;
  const showDivider = hasFilterPaneHost;
  const startDividerDrag = useDividerDrag(showDivider && visible);
  const { preparedCount, prepare } = useSidebarPreparation(hasOpened, categoryCount);
  const showFilterPane = hasFilterPaneHost && !searchExpanded && leftRatio < 0.999;

  const atLeftEdge = showDivider && !searchExpanded && leftRatio <= leftBound + 0.01;
  const atRightEdge = showDivider && (searchExpanded || leftRatio >= rightBound - 0.01);
  const resolvedTopRowBaseHeight = topRowBaseHeight > 0 ? topRowBaseHeight : topRowHeight;
  const topBlurExtraHeight = Math.max(0, topRowHeight - resolvedTopRowBaseHeight);
  const leftBasis = useTransform(ratioMotion, (value) => hasFilterPaneHost ? `${value * 100}%` : '100%');
  const rightBasis = useTransform(ratioMotion, (value) => `${(1 - value) * 100}%`);
  useMotionValueEvent(ratioMotion, 'change', (value) => {
    leftRatioRef.current = value;
    // React only needs edge/visibility transitions; Motion owns intermediate geometry.
    setLeftRatio(current => (current < 0.999) === (value < 0.999)
      && (current <= leftBound + 0.01) === (value <= leftBound + 0.01)
      && (current >= rightBound - 0.01) === (value >= rightBound - 0.01) ? current : value);
  });

  useEffect(() => {
    if (!hasSearchQuery) return;
    setSearchExpanded(true);
  }, [hasSearchQuery]);

  useEffect(() => {
    if (!hasFilterList) {
      setSearchExpanded(false);
      ratioMotion.set(1);
      prevLeftBoundRef.current = 1;
      setRightContentWidth(0);
      return undefined;
    }

    const current = leftRatioRef.current;
    const prevLeftBound = prevLeftBoundRef.current;
    const wasNearLeftEdge = current <= prevLeftBound + 0.01;

    let next = current;
    if (hasSearchQuery || searchExpanded) {
      next = rightBound;
    } else if (wasNearLeftEdge) {
      next = leftBound;
    } else {
      next = Math.min(rightBound, Math.max(leftBound, current));
    }

    prevLeftBoundRef.current = leftBound;

    if (Math.abs(next - current) > 0.001) {
      if (searchExpanded && !hasSearchQuery && visible) {
        const animation = animate(ratioMotion, next, {
          duration: 0.22,
          ease: (t) => 1 - Math.pow(1 - t, 3),
        });
        return () => animation.stop();
      }
      ratioMotion.set(next);
    }
    return undefined;
  }, [hasFilterList, hasSearchQuery, leftBound, rightBound, searchExpanded, visible, ratioMotion]);

  const handleDividerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!hasFilterList) return;
    const container = (e.currentTarget.parentElement as HTMLDivElement) || null;
    if (!container) return;
    e.preventDefault();
    setSearchExpanded(false);
    const rect = container.getBoundingClientRect();
    const rowWidth = rect.width || 1;
    const dynamicMinSearchRatio = Math.min(0.98, TOP_ROW_MIN_SEARCH_PX / rowWidth);
    const dynamicNaturalLeftBound = 1 - Math.min(1, (rightContentWidth || 0) / rowWidth);
    const dynamicLeftBound = Math.max(dynamicMinSearchRatio, dynamicNaturalLeftBound);

    const onMove = (ev: PointerEvent) => {
      const x = ev.clientX;
      const ratio = (x - rect.left) / rect.width;
      const clamped = Math.max(dynamicLeftBound, Math.min(1, ratio));
      ratioMotion.set(clamped);
    };
    startDividerDrag(e, onMove, () => setLeftRatio(ratioMotion.get()));
  };

  // Focus Search -> occupy full top row and hide filter pane
  const handleSearchFocus = () => {
    if (!hasFilterList) return;
    setSearchExpanded(true);
  };

  return (
    <SidebarWindow containerRef={rootRef}>
    <div
      className={`${mobileStyles.sidebarContainer} ${!visible ? mobileStyles.hidden : ''}`}
      data-sidebar-layout="mobile"
      aria-hidden={!visible}
      inert={!visible}
      ref={rootRef}
      onPointerDownCapture={prepare}
      onFocusCapture={prepare}
      style={{ '--top-blur-extra': `${topBlurExtraHeight}px` } as React.CSSProperties}
    >
      {/* Mobile places the whole sidebar into a bottom drawer */}
      <Drawer
        snapPoints={snaps}
        snapIndex={currentSnap}
        onSnapChange={setDrawerSnapIndex}
      >
        <div
          className={`${mobileStyles.contentWrapper} ${hasSearchQuery ? mobileStyles.searchMode : ''}`}
          data-sidebar-scroll="true"
          ref={contentRef}
        >
          <div className={mobileStyles.sidebarContent}>
            {/* Reserve the fixed control row inside the scrolling layout. The actual
                controls live outside the masked viewport so alpha masking cannot fade them. */}
            <div aria-hidden="true" style={{ height: topRowHeight || '3rem', flexShrink: 0 }} />

            <Detail inline className={mobileStyles.mobileDetail} />

            {preparedCount > 0 && <div className={mobileStyles.filters}>
              <SidebarFilters preparedCount={preparedCount} mobile />
            </div>}
            <AccountCard mobile />
          </div>
          <div className={mobileStyles.mobileTriggerBar}>
            <Trigger isActive={trigCluster} onToggle={(v) => setTrigCluster(v)} label={t('trigger.clusterMode')} />
            <Trigger isActive={trigBoundary} onToggle={(v) => setTrigBoundary(v)} label={t('trigger.boundaryMode')} />
            <Trigger isActive={trigOptimal} onToggle={(v) => setTrigOptimal(v)} label={t('trigger.labelName')} />
          </div>
          <SidebarFooter mobile />
        </div>

        {/* Top row: Search + FilterList with draggable divider */}
        <div className={mobileStyles.topRow} ref={topRowRef}>
          <motion.div
            className={mobileStyles.topRowPane}
            style={{ flexBasis: leftBasis }}
            onFocus={handleSearchFocus}
            onClick={handleSearchFocus}
          >
            <SearchMobile />
          </motion.div>
          {showDivider && (
            <div
              className={`${mobileStyles.divider} ${atLeftEdge ? mobileStyles.atLeft : ''} ${atRightEdge ? mobileStyles.atRight : ''}`}
              role="separator"
              aria-orientation="vertical"
              onPointerDown={handleDividerPointerDown}
            />
          )}
          {hasFilterPaneHost && (
            <motion.div
              className={mobileStyles.topRowPane}
              style={{
                flexBasis: rightBasis,
                maxWidth: rightContentWidth,
                visibility: showFilterPane ? 'visible' : 'hidden',
                pointerEvents: showFilterPane ? 'auto' : 'none',
              }}
            >
              <FilterListMobile width="100%" onContentWidthChange={setRightContentWidth} />
            </motion.div>
          )}
        </div>

        {/* Top blur: visible when not at snap-0 and not scrolled to top */}
        <AdaptiveLinearBlur
          targetRef={contentRef}
          visible={currentSnap > 0 && !isScrolledTop}
          side='top'
          strength={8}
          falloffPercentage={80}
          className={`${mobileStyles.topBlur} ${currentSnap > 0 && !isScrolledTop ? mobileStyles.visible : ''}`}
        />

        {/* Bottom blur: visible when not at snap-0 and not scrolled to bottom */}
        <AdaptiveLinearBlur
          targetRef={contentRef}
          visible={currentSnap > 0 && !isScrolledBottom}
          side='bottom'
          strength={2}
          falloffPercentage={100}
          className={`${mobileStyles.bottomBlur} ${currentSnap > 0 && !isScrolledBottom ? mobileStyles.visible : ''}`}
        />
      </Drawer>
    </div>
    </SidebarWindow>
  );
};

export default SideBarMobile;
