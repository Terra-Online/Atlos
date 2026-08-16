import React, { lazy, Suspense, useCallback, useEffect, useMemo, useRef as useReactRef, useState } from 'react';
import styles from './sideBar.module.scss';
import drawerStyles from './triggerDrawer.module.scss';

import Icon from '../../assets/images/UI/observator_6.webp';
import SidebarIcon from '../../assets/logos/sideCollap.svg?react';

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
import ArchivesIcon from '../../assets/images/category/archives.svg?react';

import SearchDesktop from '../search/search.desktop';
import Drawer from '../drawer/drawer';
import { Trigger, TriggerBar } from '../trigger/trigger';
import MarkFilter from '../markFilter/markFilter';
import { MarkFilterDragProvider } from '../markFilter/reorderContext';
import MarkSelector from '../markSelector/markSelector';
import SupportModal from '../support/support';

// Social media icons
import GithubIcon from '../../assets/images/UI/media/ghicon.svg?react';
import DiscordIcon from '../../assets/images/UI/media/discordicon.svg?react';
import QQIcon from '../../assets/images/UI/media/qqicon.svg?react';
import BskyIcon from '../../assets/images/UI/media/bluesky.svg?react';
import XIcon from '../../assets/images/UI/media/x.svg?react';

import { DEFAULT_SUBCATEGORY_ORDER, MARKER_TYPE_TREE, REGION_TYPE_COUNT_MAP, type IMarkerType } from '@/data/marker';
import { VERSION_NEW_FILTER_GROUPS, useVersionNewMarkerCounts } from '@/data/marker/versionNew';
import useRegion from '@/store/region';
import { BINDER_GROUPS_BY_SUB } from '@/data/marker/binder';
import MarkBinder from '../markBinder/markBinder';
import { useTranslateGame, useTranslateUI } from '@/locale';
import {
    SIDEBAR_MIN_WIDTH,
    SIDEBAR_THREE_COLUMN_MIN_WIDTH,
    clampSidebarWidth,
    getSidebarMaxWidth,
    useDesktopDrawerSnapIndex,
    useIncrementLayoutVersion,
    useSetSidebarOpen,
    useSetSidebarWidth,
    useSetTriggerBoundary,
    useSetTriggerCluster,
    useSetTriggerlabelName,
    useSidebarOpen,
    useSidebarWidth,
    useTriggerBoundary,
    useTriggerCluster,
    useTriggerlabelName,
} from '@/store/uiPrefs';
import { useMultiRegionMarkerCount, useSearchString } from '@/store/marker';
import { SelectionLayer } from './selectionLayer';
import { computeBinderColumns } from './binderMasonry';
import { useDevice } from '@/platform/device';

//console.log('[MARKER]', MARKER_TYPE_TREE);

const DEFAULT_SUBCATEGORY_ORDER_LIST = DEFAULT_SUBCATEGORY_ORDER as readonly string[];
const DEFAULT_SUBCATEGORY_ORDER_SET = new Set<string>(DEFAULT_SUBCATEGORY_ORDER_LIST);
const IDCard = lazy(() => import('../login/idcard'));

const CATEGORY_ICON_MAP: Record<string, React.FC<React.SVGProps<SVGSVGElement>>> = {
    boss: BossIcon,
    mob: MobIcon,
    natural: NaturalIcon,
    valuable: ValuableIcon,
    collection: CollectionIcon,
    archives: ArchivesIcon,
    combat: CombatIcon,
    npc: NpcIcon,
    facility: FacilityIcon,
    exploration: ExplorationIcon
};

interface SideBarProps {
    // TODO: fix this after region is nonNull
    currentRegion: null;
    onToggle: (isOpen: boolean) => void;
    visible?: boolean;
}

const FOUR_COLUMN_THRESHOLD = 700;

const SideBarDesktop = ({ currentRegion, onToggle, visible = true }: SideBarProps) => {
    const t = useTranslateUI();
    const tGame = useTranslateGame();
    const searchString = useSearchString();
    const versionNewCounts = useVersionNewMarkerCounts();
    const isOpen = useSidebarOpen();
    const setIsOpen = useSetSidebarOpen();
    const sidebarWidth = useSidebarWidth();
    const setSidebarWidth = useSetSidebarWidth();
    const incrementLayoutVersion = useIncrementLayoutVersion();
    const { width: viewportWidth } = useDevice();
    const maxWidth = getSidebarMaxWidth(viewportWidth);
    // Persistent trigger states
    const trigCluster = useTriggerCluster();
    const trigBoundary = useTriggerBoundary();
    const trigOptimal = useTriggerlabelName();
    const setTrigCluster = useSetTriggerCluster();
    const setTrigBoundary = useSetTriggerBoundary();
    const setTrigOptimal = useSetTriggerlabelName();
    const drawerSnapIndex = useDesktopDrawerSnapIndex();

    const [supportOpen, setSupportOpen] = useState(false);
    const [isResizing, setIsResizing] = useState(false);

    const sidebarRef = React.useRef<HTMLDivElement>(null);
    const resizeStartX = useReactRef(0);
    const resizeStartW = useReactRef(SIDEBAR_MIN_WIDTH);

    const clampWidth = useCallback((startW: number, dx: number) =>
        clampSidebarWidth(startW + dx, maxWidth), [maxWidth]);

    const setAppCssVar = (w: number, source?: HTMLElement | null) => {
        const ownerDocument = source?.ownerDocument ?? document;
        const el = ownerDocument.querySelector<HTMLElement>('.app');
        el?.style.setProperty('--sidebar-width', `${w}px`);
    };

    useEffect(() => {
        const clampedWidth = clampSidebarWidth(sidebarWidth, maxWidth);
        if (clampedWidth !== sidebarWidth) {
            setSidebarWidth(clampedWidth, maxWidth);
        }
    }, [maxWidth, setSidebarWidth, sidebarWidth]);

    const onResizeStart = useCallback((e: React.PointerEvent) => {
        if (!isOpen) return;
        e.preventDefault();
        e.stopPropagation();
        setIsResizing(true);
        resizeStartX.current = e.clientX;
        resizeStartW.current = sidebarWidth;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }, [isOpen, resizeStartW, resizeStartX, sidebarWidth]);

    const onResizeMove = useCallback((e: React.PointerEvent) => {
        if (!isResizing) return;
        const newW = clampWidth(resizeStartW.current, e.clientX - resizeStartX.current);
        setAppCssVar(newW, e.currentTarget as HTMLElement);
    }, [clampWidth, isResizing, resizeStartW, resizeStartX]);

    const onResizeEnd = useCallback((e: React.PointerEvent) => {
        if (!isResizing) return;
        setIsResizing(false);
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
        const newW = clampWidth(resizeStartW.current, e.clientX - resizeStartX.current);
        setSidebarWidth(newW, maxWidth);
        requestAnimationFrame(() => incrementLayoutVersion());
    }, [clampWidth, incrementLayoutVersion, isResizing, maxWidth, resizeStartW, resizeStartX, setSidebarWidth]);

    const filterColumns: 2 | 3 | 4 =
        sidebarWidth >= FOUR_COLUMN_THRESHOLD ? 4 :
        sidebarWidth >= SIDEBAR_THREE_COLUMN_MIN_WIDTH ? 3 :
        2;

    const binderTypeKeys = useMemo(
        () => Object.values(BINDER_GROUPS_BY_SUB)
            .flatMap((binderData) => binderData.groups)
            .flatMap((group) => group.types.map((typeInfo) => typeInfo.key)),
        [],
    );
    const binderTypeCounts = useMultiRegionMarkerCount(binderTypeKeys);
    const binderTypeCountMap = useMemo(() => {
        const map = new Map<string, { collected: number; total: number }>();
        binderTypeKeys.forEach((key, index) => {
            const count = binderTypeCounts[index];
            if (count) map.set(key, count);
        });
        return map;
    }, [binderTypeKeys, binderTypeCounts]);

    const currentRegionKey = useRegion((s) => s.currentRegionKey);
    const lowerSearch = searchString.toLowerCase();
    const isTypeVisibleInSearch = useCallback((typeKey: string) => {
        if (!lowerSearch) return true;
        const typeDisplayName = String(tGame(`markerType.key.${typeKey}`) ?? '').toLowerCase();
        return typeKey.toLowerCase().includes(lowerSearch) || typeDisplayName.includes(lowerSearch);
    }, [lowerSearch, tGame]);
    const emptyCategories = useMemo(() => {
        const regionTypeCounts = REGION_TYPE_COUNT_MAP[currentRegionKey] ?? {};
        return new Set(
            Object.keys(MARKER_TYPE_TREE).filter((subCat) =>
                MARKER_TYPE_TREE[subCat].every(
                    (typeInfo) => (regionTypeCounts[typeInfo.key] ?? 0) === 0,
                ),
            ),
        );
    }, [currentRegionKey]);
    useMemo(() => {
        if (!currentRegion) return null;
        return {
            // @ts-expect-error TODO: fix this after region is nonNull
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            main: currentRegion.main,
            // @ts-expect-error TODO: fix this after region is nonNull
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            sub: currentRegion.sub,
        };
    }, [currentRegion]);

    const toggleSidebar = () => {
        const newState = !isOpen;
        setIsOpen(newState);
        if (onToggle) {
            onToggle(newState);
        }
    };

    return (
        <div
            className={`${styles.sidebarContainer} ${isOpen ? styles.open : ''} ${!visible ? styles.hidden : ''}`}
            data-sidebar-layout="desktop"
            aria-hidden={!visible}
            inert={!visible}
        >
            <button
                className={`${styles.sidebarToggle} ${isOpen ? styles.open : ''} ${!visible ? styles.hidden : ''}`}
                onClick={toggleSidebar}
                aria-label={isOpen ? t('common.collapse') : t('common.expand')}
            >
                <SidebarIcon />
            </button>

            <div ref={sidebarRef} className={`${styles.sidebar} ${isOpen ? styles.open : ''}`}>
                {isOpen && (
                    <div
                        className={`${styles.resizeHandle} ${isResizing ? styles.dragging : ''}`}
                        onPointerDown={onResizeStart}
                        onPointerMove={onResizeMove}
                        onPointerUp={onResizeEnd}
                        onPointerCancel={onResizeEnd}
                    />
                )}
                <SelectionLayer containerRef={sidebarRef} />
                <div className={styles.headIcon}>
                    <img
                        src={Icon}
                        alt={t('sidebar.alt.supportedBy')}
                        draggable={'false'}
                    />
                </div>
                <div className={styles.sidebarContent} data-sidescroll="true" data-sidebar-scroll="true">
                    <SearchDesktop />
                    <div className={styles.filters}>
                        <MarkFilterDragProvider>
                            {VERSION_NEW_FILTER_GROUPS.map((group) => (
                                <MarkFilter
                                    idKey={group.key}
                                    title={t(group.titleKey)}
                                    dataCategory="versionNew"
                                    key={group.key}
                                    columns={filterColumns}
                                    initialEmpty={false}
                                    variant="versionNew"
                                    reorderable={false}
                                >
                                    {group.types.map((typeInfo) => (
                                        <MarkSelector
                                            key={typeInfo.key}
                                            typeInfo={typeInfo}
                                            countOverride={versionNewCounts[typeInfo.key]}
                                        />
                                    ))}
                                </MarkFilter>
                            ))}
                            {(
                                DEFAULT_SUBCATEGORY_ORDER_LIST.filter(
                                    (k) => Object.prototype.hasOwnProperty.call(MARKER_TYPE_TREE, k),
                                )
                            )
                                .concat(
                                    Object.keys(MARKER_TYPE_TREE).filter(
                                        (k) => !DEFAULT_SUBCATEGORY_ORDER_SET.has(k),
                                    ),
                                )
                                .map((subCategory) => {
                                    const types: IMarkerType[] = MARKER_TYPE_TREE[subCategory] ?? [];
                                    const CategoryIcon = CATEGORY_ICON_MAP[subCategory];
                                    const binderData = BINDER_GROUPS_BY_SUB[subCategory];
                                    const showBinder = filterColumns >= 3 && Boolean(binderData);
                                    const binderColumns = binderData
                                        ? computeBinderColumns(
                                            binderData.groups,
                                            binderTypeCountMap,
                                            isTypeVisibleInSearch,
                                        )
                                        : { left: [], right: [] };
                                    return (
                        <MarkFilter
                            idKey={subCategory}
                            title={String(tGame(`markerType.category.${subCategory}`))}
                            icon={CategoryIcon}
                            dataCategory={subCategory}
                            key={subCategory}
                            columns={filterColumns}
                            binderMode={!!showBinder}
                            initialEmpty={emptyCategories.has(subCategory)}
                        >
                                            {showBinder && binderData ? (
                                                <>
                                                    <div className={styles.binderSection}>
                                                        <div className={styles.binderColumn}>
                                                            {binderColumns.left.map((group) => (
                                                                <MarkBinder key={group.id} group={group} />
                                                            ))}
                                                        </div>
                                                        <div className={styles.binderColumn}>
                                                            {binderColumns.right.map((group) => (
                                                                <MarkBinder key={group.id} group={group} />
                                                            ))}
                                                        </div>
                                                    </div>
                                                    {binderData.remaining.length > 0 && (
                                                        <div
                                                            className={styles.remainingSection}
                                                            style={{ gridTemplateColumns: `repeat(${filterColumns}, minmax(0, 1fr))` }}
                                                        >
                                                            {binderData.remaining.map((typeInfo) => (
                                                                <MarkSelector key={typeInfo.key} typeInfo={typeInfo} />
                                                            ))}
                                                        </div>
                                                    )}
                                                </>
                                            ) : (
                                                types.map((typeInfo) => (
                                                    <MarkSelector key={typeInfo.key} typeInfo={typeInfo} />
                                                ))
                                            )}
                                        </MarkFilter>
                                    );
                                })}
                        </MarkFilterDragProvider>
                    </div>
                    <div className={styles.idCardContainer}>
                        <Suspense fallback={null}>
                            <IDCard />
                        </Suspense>
                    </div>
                </div>
                <div className={styles.copyright}>
                    <a href='https://beian.miit.gov.cn/'>
                        {t('footer.icp')}
                    </a>
                </div>
                <div className={styles.socialBar}>
                    <a
                        href="https://github.com/Terra-Online/Atlos"
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.socialLink}
                        data-platform="github"
                        aria-label="GitHub"
                    >
                        <GithubIcon />
                    </a>
                    <a
                        href="https://discord.gg/SJCEjH9hmr"
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.socialLink}
                        data-platform="discord"
                        aria-label="Discord"
                    >
                        <DiscordIcon />
                    </a>
                    <a
                        href="https://bsky.app/profile/opendfieldmap.bsky.social"
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.socialLink}
                        data-platform="bluesky"
                        aria-label="Bluesky"
                    >
                        <BskyIcon />
                    </a>
                    <a
                        href="https://x.com/OpenEndfieldMap"
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.socialLink}
                        data-platform="X/Twitter"
                        aria-label="X/Twitter"
                    >
                        <XIcon />
                    </a>
                    <a
                        href="https://qm.qq.com/q/BVsCJgzBL2"
                        target="_blank"
                        rel="noopener noreferrer"
                        className={styles.socialLink}
                        data-platform="qq"
                        aria-label="QQ"
                    >
                        <QQIcon />
                    </a>
                    <span className={styles.divide}></span>
                    <button className={styles.supportBtn} type="button" onClick={() => setSupportOpen(true)}>
                        {t('support.title')}
                    </button>
                </div>

                <SupportModal
                    open={supportOpen}
                    onClose={() => setSupportOpen(false)}
                    onChange={(open) => setSupportOpen(open)}
                />
                {/* Drawer placed above footer */}
                <Drawer
                    side='bottom'
                    initialSize={0}
                    snap={[0, 150]}
                    snapThreshold={[50, 50]}
                    snapToIndex={drawerSnapIndex}
                    handleSize={28}
                    className={drawerStyles.triggerDrawer}
                    handleClassName={drawerStyles.triggerDrawerHandle}
                    contentClassName={drawerStyles.triggerDrawerContent}
                    backdropClassName={drawerStyles.triggerDrawerBackdrop}
                    style={{ bottom: 'var(--drawer-bottom)', left: 0, right: 0 }}
                    debug={false}
                >
                    <TriggerBar>
                        <Trigger isActive={trigCluster} onToggle={(v) => setTrigCluster(v)} label={t('trigger.clusterMode')} />
                        <Trigger isActive={trigBoundary} onToggle={(v) => setTrigBoundary(v)} label={t('trigger.boundaryMode')} />
                        <Trigger isActive={trigOptimal} onToggle={(v) => setTrigOptimal(v)} label={t('trigger.labelName')} />
                    </TriggerBar>
                </Drawer>
            </div>
        </div>
    );
};

export default SideBarDesktop;
