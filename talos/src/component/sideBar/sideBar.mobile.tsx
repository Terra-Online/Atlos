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
import Notice from '../notice/notice';
import Detail from '../detail/detail';

// Category icons
import BossIcon from '../../assets/images/category/boss.svg?react';
import MobIcon from '../../assets/images/category/mob.svg?react';
import NaturalIcon from '../../assets/images/category/natural.svg?react';
import ValuableIcon from '../../assets/images/category/valuable.svg?react';
import CollectionIcon from '../../assets/images/category/collection.svg?react';
import CombatIcon from '../../assets/images/category/combat.svg?react';
import NpcIcon from '../../assets/images/category/npc.svg?react';
import FacilityIcon from '../../assets/images/category/facility.svg?react';

import { DEFAULT_SUBCATEGORY_ORDER, MARKER_TYPE_TREE, type IMarkerType } from '@/data/marker';
import { useTranslateGame, useTranslateUI } from '@/locale';
import { useMarkerStore } from '@/store/marker';
import { useTriggerCluster, useTriggerBoundary, useTriggerlabelName, useSetTriggerCluster, useSetTriggerBoundary, useSetTriggerlabelName, useSetMobileDrawerSnapIndex, useMobileDrawerSnapIndex } from '@/store/uiPrefs';

const CATEGORY_ICON_MAP: Record<string, React.FC<React.SVGProps<SVGSVGElement>>> = {
    boss: BossIcon,
    mob: MobIcon,
    natural: NaturalIcon,
    valuable: ValuableIcon,
    collection: CollectionIcon,
    combat: CombatIcon,
    npc: NpcIcon,
    facility: FacilityIcon,
};

const DEFAULT_SUBCATEGORY_ORDER_LIST = DEFAULT_SUBCATEGORY_ORDER as readonly string[];
const DEFAULT_SUBCATEGORY_ORDER_SET = new Set<string>(DEFAULT_SUBCATEGORY_ORDER_LIST);

interface SideBarProps {
  currentRegion: null;
  onToggle: (isOpen: boolean) => void;
  visible?: boolean;
}

const SNAP0 = 64; // px

const SideBarMobile: React.FC<SideBarProps> = ({ onToggle, visible = true }) => {
  const t = useTranslateUI();
  const tGame = useTranslateGame();

  const [vh, setVh] = useState<number>(typeof window !== 'undefined' ? window.innerHeight : 800);
  const currentPoint = useMarkerStore((s) => s.currentActivePoint);
  const drawerSnapIndex = useMobileDrawerSnapIndex();
  const trigCluster = useTriggerCluster();
  const trigBoundary = useTriggerBoundary();
  const trigOptimal = useTriggerlabelName();
  const setTrigCluster = useSetTriggerCluster();
  const setTrigBoundary = useSetTriggerBoundary();
  const setTrigOptimal = useSetTriggerlabelName();
  const setDrawerSnapIndex = useSetMobileDrawerSnapIndex();

  useEffect(() => {
    const onResize = () => setVh(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const snaps = useMemo(() => {
    const s1 = Math.round(vh * 0.55);
    const s2 = Math.round(vh * 0.85);
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

  // Sync currentSnap to store for UIOverlay to use
  useEffect(() => {
    setDrawerSnapIndex(currentSnap);
  }, [currentSnap, setDrawerSnapIndex]);

  const snapsNormalized = snaps;
  const minSnap = snaps[0] ?? 0;
  const maxSnap = snaps[snaps.length - 1] ?? 0;
  const safeRange = (maxSnap - minSnap) || 1;

  // When a point is activated, snap to middle (index 1)
  useEffect(() => {
    if (currentPoint) {
      setDrawerSnapIndex(1);
    }
  }, [currentPoint, setDrawerSnapIndex]);

  const [leftRatio, setLeftRatio] = useState(0.6); // Search pane width ratio in TopRow
  const [atLeftEdge, setAtLeftEdge] = useState(false);
  const [atRightEdge, setAtRightEdge] = useState(false);
  const leftRatioRef = useRef(0.6); // Track current value without triggering re-renders

  // Update ref when state changes
  useEffect(() => {
    leftRatioRef.current = leftRatio;
  }, [leftRatio]);

  // Smooth animate helper - stable, no dependency on leftRatio state
  const animateLeftRatio = React.useCallback((to: number, duration = 220) => {
    const from = leftRatioRef.current; // Use ref to get current value
    const start = performance.now();
    const ease = (t: number) => 1 - Math.pow(1 - t, 3); // easeOutCubic
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const v = from + (to - from) * ease(t);
      setLeftRatio(v);
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, []); // No dependencies - stable reference

  const handleDividerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    const container = (e.currentTarget.parentElement as HTMLDivElement) || null;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    // 左侧最小 50px，右侧不超过内容宽度
    const minLeftPx = 50;
    const minLeftBound = Math.max(minLeftPx / rect.width, 1 - Math.min(1, (rightContentWidth || 0) / rect.width));
    const maxLeftBound = 0.98; // allow near-full width when right content is tiny
    const snapPoint = 0.6;
    const snapBand = 0.1; // 10% snapping
    let latestRatio = leftRatioRef.current; // Use ref for initial value

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
  const prevRightContentWidthRef = useRef(rightContentWidth);

  useEffect(() => {
    const row = rootRef.current?.querySelector(`.${mobileStyles.topRow}`) as HTMLElement | null;
    if (!row) return;
    const rowWidth = row.clientWidth || 1;
    const minLeftPx = 48; // 3rem

    // Only trigger adjustment when right content width actually changes
    const widthChanged = Math.abs(rightContentWidth - prevRightContentWidthRef.current) > 2;
    prevRightContentWidthRef.current = rightContentWidth;

    if (!hasRightContent) {
      // 右侧无内容时，左侧占满（接近 100%）
      setRightMaxWidth(0);
      setAtRightEdge(true); // 右侧空内容时标记为在右边缘（隐藏右箭头）
      if (widthChanged && leftRatio < 0.98) {
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
      
      // 只在内容宽度变化且 leftRatio 明显大于目标时才自动调整（避免循环触发）
      if (widthChanged && leftRatio > minLeftBound + 0.02) {
        // 自动收缩左侧以容纳右侧内容（直到 divider 到 0.6）
        animateLeftRatio(minLeftBound);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rightContentWidth, hasRightContent]); // Remove leftRatio and animateLeftRatio from deps

  return (
    <div className={`${mobileStyles.sidebarContainer} ${!visible ? mobileStyles.hidden : ''}`} ref={rootRef}>
      {/* Mobile places the whole sidebar into a bottom drawer */}
      <Drawer
        side="bottom"
        initialSize={SNAP0}
        snap={snaps}
        snapThreshold={[50, 50, 50]}
        handleSize={16}
        fullWidth={true}
        className={mobileStyles.mobileDrawer}
        handleClassName={mobileStyles.mobileDrawerHandle}
        contentClassName={mobileStyles.mobileDrawerContent}
        backdropClassName={mobileStyles.mobileDrawerBackdrop}
        onProgressChange={handleProgress}
        style={{ bottom: 0 }}
        snapToIndex={drawerSnapIndex}
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
                {DEFAULT_SUBCATEGORY_ORDER_LIST.filter((k) =>
                  Object.prototype.hasOwnProperty.call(MARKER_TYPE_TREE, k),
                )
                  .concat(
                    Object.keys(MARKER_TYPE_TREE).filter(
                      (k) => !DEFAULT_SUBCATEGORY_ORDER_SET.has(k),
                    ),
                  )
                  .map((subCategory) => {
                    const types: IMarkerType[] = MARKER_TYPE_TREE[subCategory] ?? [];
                    const CategoryIcon = CATEGORY_ICON_MAP[subCategory];
                    return (
                      <MarkFilter
                        idKey={subCategory}
                        title={String(tGame(`markerType.category.${subCategory}`))}
                        icon={CategoryIcon}
                        dataCategory={subCategory}
                        key={subCategory}
                      >
                        {types.map((typeInfo) => (
                          <MarkSelector key={typeInfo.key} typeInfo={typeInfo} />
                        ))}
                      </MarkFilter>
                    );
                  })}
              </MarkFilterDragProvider>
            </div>
            <Notice />
          </div>
          <div className={mobileStyles.mobileTriggerBar}>
            <Trigger isActive={trigCluster} onToggle={(v) => setTrigCluster(v)} label={t('trigger.clusterMode')} />
            <Trigger isActive={trigBoundary} onToggle={(v) => setTrigBoundary(v)} label={t('trigger.boundaryMode')} />
            <Trigger isActive={trigOptimal} onToggle={(v) => setTrigOptimal(v)} label={t('trigger.labelName')} />
          </div>
          <div className={mobileStyles.copyright}>
            <a href='https://beian.miit.gov.cn/'>
                {t('footer.icp')}
            </a>
          </div>
        </div>

        {/* Top blur: visible when not at snap-0 and not scrolled to top */}
        <LinearBlur
          side='top'
          strength={32}
          falloffPercentage={80}
          className={`${mobileStyles.topBlur} ${currentSnap > 0 && !isScrolledTop ? mobileStyles.visible : ''}`}
        />

        {/* Bottom blur: visible when not at snap-0 and not scrolled to bottom */}
        <LinearBlur
          side='bottom'
          strength={16}
          falloffPercentage={100}
          className={`${mobileStyles.bottomBlur} ${currentSnap > 0 && !isScrolledBottom ? mobileStyles.visible : ''}`}
        />
      </Drawer>
    </div>
  );
};

export default SideBarMobile;