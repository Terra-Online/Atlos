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
//import IDCard from '../login/idcard';
import Detail from '../detail/detail';
import SupportModal from '../support/support';

// Social media icons
import GithubIcon from '../../assets/images/UI/media/ghicon.svg?react';
import DiscordIcon from '../../assets/images/UI/media/discordicon.svg?react';
import QQIcon from '../../assets/images/UI/media/qqicon.svg?react';
import BskyIcon from '../../assets/images/UI/media/bluesky.svg?react';

// Category icons
import BossIcon from '../../assets/images/category/boss.svg?react';
import MobIcon from '../../assets/images/category/mob.svg?react';
import NaturalIcon from '../../assets/images/category/natural.svg?react';
import ExplorationIcon from '@/assets/images/category/exploration.svg?react';
import ValuableIcon from '../../assets/images/category/valuable.svg?react';
import CollectionIcon from '../../assets/images/category/collection.svg?react';
import CombatIcon from '../../assets/images/category/combat.svg?react';
import NpcIcon from '../../assets/images/category/npc.svg?react';
import FacilityIcon from '../../assets/images/category/facility.svg?react';

import { DEFAULT_SUBCATEGORY_ORDER, MARKER_TYPE_DICT, MARKER_TYPE_TREE, REGION_TYPE_COUNT_MAP, type IMarkerType } from '@/data/marker';
import useRegion from '@/store/region';
import { useTranslateGame, useTranslateUI } from '@/locale';
import { useFilter, useMarkerStore } from '@/store/marker';
import { useTriggerCluster, useTriggerBoundary, useTriggerlabelName, useSetTriggerCluster, useSetTriggerBoundary, useSetTriggerlabelName, useSetMobileDrawerSnapIndex, useMobileDrawerSnapIndex } from '@/store/uiPrefs';

const CATEGORY_ICON_MAP: Record<string, React.FC<React.SVGProps<SVGSVGElement>>> = {
    boss: BossIcon,
    mob: MobIcon,
    natural: NaturalIcon,
    valuable: ValuableIcon,
    collection: CollectionIcon,
    archives: CollectionIcon,
    combat: CombatIcon,
    npc: NpcIcon,
    facility: FacilityIcon,
    exploration: ExplorationIcon,
};

const DEFAULT_SUBCATEGORY_ORDER_LIST = DEFAULT_SUBCATEGORY_ORDER as readonly string[];
const DEFAULT_SUBCATEGORY_ORDER_SET = new Set<string>(DEFAULT_SUBCATEGORY_ORDER_LIST);

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
  const tGame = useTranslateGame();

  const [supportOpen, setSupportOpen] = useState(false);

  const [vh, setVh] = useState<number>(typeof window !== 'undefined' ? window.innerHeight : 800);
  const filterList = useFilter();
  const searchString = useMarkerStore((s) => s.searchString);
  const currentRegion = useRegion((s) => s.currentRegionKey);
  const emptyCategories = useMemo(() => {
    const regionTypeCounts = REGION_TYPE_COUNT_MAP[currentRegion] ?? {};
    return new Set(
      Object.keys(MARKER_TYPE_TREE).filter((subCat) =>
        MARKER_TYPE_TREE[subCat].every(
          (typeInfo) => (regionTypeCounts[typeInfo.key] ?? 0) === 0,
        ),
      ),
    );
  }, [currentRegion]);
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

  const rootRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const topRowRef = useRef<HTMLDivElement>(null);
  const [isScrolledTop, setIsScrolledTop] = useState(true);
  const [isScrolledBottom, setIsScrolledBottom] = useState(false);
  const [currentSnap, setCurrentSnap] = useState(0);
  const [topRowWidth, setTopRowWidth] = useState(0);
  const [topRowHeight, setTopRowHeight] = useState(0);
  const [topRowBaseHeight, setTopRowBaseHeight] = useState(0);
  const [rightContentWidth, setRightContentWidth] = useState(0);
  const prevHasSearchQueryRef = useRef(false);
  const preSearchSnapIndexRef = useRef<number | null>(null);
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
    if (hasSearchQuery) return;
    if (drawerSnapIndex !== currentSnap) {
      setDrawerSnapIndex(currentSnap);
    }
  }, [currentSnap, drawerSnapIndex, hasSearchQuery, setDrawerSnapIndex]);

  const snapsNormalized = snaps;
  const minSnap = snaps[0] ?? 0;
  const maxSnap = snaps[snaps.length - 1] ?? 0;
  const safeRange = (maxSnap - minSnap) || 1;

  useEffect(() => {
    const wasSearching = prevHasSearchQueryRef.current;
    const maxIndex = Math.max(0, snaps.length - 1);

    if (!wasSearching && hasSearchQuery) {
      preSearchSnapIndexRef.current = drawerSnapIndex;
      if (drawerSnapIndex !== maxIndex) {
        setDrawerSnapIndex(maxIndex);
      }
    }

    if (wasSearching && !hasSearchQuery) {
      const prevIndex = preSearchSnapIndexRef.current;
      if (typeof prevIndex === 'number') {
        const restored = Math.max(0, Math.min(maxIndex, prevIndex));
        if (drawerSnapIndex !== restored) {
          setDrawerSnapIndex(restored);
        }
      }
    }

    prevHasSearchQueryRef.current = hasSearchQuery;
  }, [hasSearchQuery, snaps.length, drawerSnapIndex, setDrawerSnapIndex]);

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
  const showFilterPane = hasFilterPaneHost && !searchExpanded && leftRatio < 0.999;

  const atLeftEdge = showDivider && !searchExpanded && leftRatio <= leftBound + 0.01;
  const atRightEdge = showDivider && (searchExpanded || leftRatio >= rightBound - 0.01);
  const resolvedTopRowBaseHeight = topRowBaseHeight > 0 ? topRowBaseHeight : topRowHeight;
  const topBlurExtraHeight = Math.max(0, topRowHeight - resolvedTopRowBaseHeight);

  // Update ref when state changes
  useEffect(() => {
    leftRatioRef.current = leftRatio;
  }, [leftRatio]);

  useEffect(() => {
    if (!hasSearchQuery) return;
    setSearchExpanded(true);
  }, [hasSearchQuery]);

  useEffect(() => {
    if (!hasFilterList) {
      setSearchExpanded(false);
      setLeftRatio(1);
      prevLeftBoundRef.current = 1;
      setRightContentWidth(0);
      return;
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
      setLeftRatio(next);
    }
  }, [hasFilterList, hasSearchQuery, leftBound, rightBound, searchExpanded]);

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
      setLeftRatio(clamped);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointercancel', onUp, { once: true });
    window.addEventListener('pointerup', onUp, { once: true });
  };

  // Focus Search -> occupy full top row and hide filter pane
  const handleSearchFocus = () => {
    if (!hasFilterList) return;
    setSearchExpanded(true);
    if (leftRatioRef.current < rightBound - 0.001) {
      animateLeftRatio(rightBound);
    }
  };

  return (
    <div
      className={`${mobileStyles.sidebarContainer} ${!visible ? mobileStyles.hidden : ''}`}
      ref={rootRef}
      style={{ '--top-blur-extra': `${topBlurExtraHeight}px` } as React.CSSProperties}
    >
      {/* Mobile places the whole sidebar into a bottom drawer */}
      <Drawer
        side="bottom"
        initialSize={snap0}
        snap={snaps}
        snapThreshold={[50, 50, 50]}
        handleSize={16}
        dragDisabled={hasSearchQuery}
        fullWidth={true}
        className={mobileStyles.mobileDrawer}
        handleClassName={mobileStyles.mobileDrawerHandle}
        contentClassName={mobileStyles.mobileDrawerContent}
        backdropClassName={mobileStyles.mobileDrawerBackdrop}
        onProgressChange={handleProgress}
        style={{ bottom: 0 }}
        snapToIndex={drawerSnapIndex}
      >
        <div className={`${mobileStyles.contentWrapper} ${hasSearchQuery ? mobileStyles.searchMode : ''}`} ref={contentRef}>
          <div className={mobileStyles.sidebarContent}>
            {/* Top row: Search + FilterList with draggable divider */}
            <div className={mobileStyles.topRow} ref={topRowRef}>
              <div
                className={mobileStyles.topRowPane}
                style={{ flexBasis: hasFilterPaneHost ? `${leftRatio * 100}%` : '100%' }}
                onFocus={handleSearchFocus}
                onClick={handleSearchFocus}
              >
                <Search />
              </div>
              {showDivider && (
                <div
                  className={`${mobileStyles.divider} ${atLeftEdge ? mobileStyles.atLeft : ''} ${atRightEdge ? mobileStyles.atRight : ''}`}
                  role="separator"
                  aria-orientation="vertical"
                  onPointerDown={handleDividerPointerDown}
                />
              )}
              {hasFilterPaneHost && (
                <div
                  className={mobileStyles.topRowPane}
                  style={{
                    flexBasis: `${(1 - leftRatio) * 100}%`,
                    maxWidth: rightContentWidth,
                    visibility: showFilterPane ? 'visible' : 'hidden',
                    pointerEvents: showFilterPane ? 'auto' : 'none',
                  }}
                >
                  <FilterListMobile width="100%" onContentWidthChange={setRightContentWidth} />
                </div>
              )}
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
                        initialEmpty={emptyCategories.has(subCategory)}
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
            {/* 
            <div className={styles.idCardContainer}>
                <IDCard />
            </div>
            */}
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
          <div className={mobileStyles.socialBar}>
            <a
              href="https://github.com/Terra-Online/Atlos"
              target="_blank"
              rel="noopener noreferrer"
              className={mobileStyles.socialLink}
              data-platform="github"
              aria-label="GitHub"
            >
              <GithubIcon />
            </a>
            <a
              href="https://discord.gg/SJCEjH9hmr"
              target="_blank"
              rel="noopener noreferrer"
              className={mobileStyles.socialLink}
              data-platform="discord"
              aria-label="Discord"
            >
              <DiscordIcon />
            </a>
            <a
              href="https://bsky.app/profile/opendfieldmap.bsky.social"
              target="_blank"
              rel="noopener noreferrer"
              className={mobileStyles.socialLink}
              data-platform="bluesky"
              aria-label="Bluesky"
            >
              <BskyIcon />
            </a>
            <a
              href="https://qm.qq.com/q/BVsCJgzBL2"
              target="_blank"
              rel="noopener noreferrer"
              className={mobileStyles.socialLink}
              data-platform="qq"
              aria-label="QQ"
            >
              <QQIcon />
            </a>
            <span className={mobileStyles.divide}></span>
            <button className={mobileStyles.supportBtn} type="button" onClick={() => setSupportOpen(true)}>
              {t('support.title')}
            </button>
          </div>

          <SupportModal
            open={supportOpen}
            onClose={() => setSupportOpen(false)}
            onChange={(open) => setSupportOpen(open)}
          />
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