import { useTranslateUI } from '@/locale';
import { AccountCard, SidebarFooter } from '@/component/shared/siteShell/sideBar.frame';
import React, { useCallback, useEffect, useRef as useReactRef, useState } from 'react';
import styles from '@/component/shared/siteShell/sideBar.module.scss';
import drawerStyles from '@/component/shared/siteShell/triggerDrawer.module.scss';

import Icon from '@/assets/images/UI/observator_6.webp';
import SidebarIcon from '@/assets/logos/sideCollap.svg?react';

import SearchDesktop from '@/pages/search/search.desktop';
import Drawer from '@/component/drawer/drawer';
import { Trigger, TriggerBar } from '@/component/trigger/trigger';
import { SidebarFilters, categoryCount } from './sidebarFilters';
import {
    SIDEBAR_MIN_WIDTH,
    SIDEBAR_THREE_COLUMN_MIN_WIDTH,
    clampSidebarWidth,
    getSidebarMaxWidth,
    useDesktopDrawerSnapIndex,
    useIncrementLayoutVersion,
    useUiPrefsHydrated,
    useSetDesktopDrawerSnapIndex,
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
import { SelectionLayer } from '@/pages/sideBar/selectionLayer';
import { useDevice } from '@/platform/device';
import { SidebarWindow } from './sidebarWindow';
import { useSidebarPreparation } from './useSidebarPreparation';

//console.log('[MARKER]', MARKER_TYPE_TREE);

interface SideBarProps {
    // TODO: fix this after region is nonNull
    currentRegion: null;
    onToggle: (isOpen: boolean) => void;
    visible?: boolean;
}

const FOUR_COLUMN_THRESHOLD = 700;

const SideBarDesktop = ({ onToggle, visible = true }: SideBarProps) => {
    const t = useTranslateUI();
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
    const setDrawerSnapIndex = useSetDesktopDrawerSnapIndex();
    const uiPrefsHydrated = useUiPrefsHydrated();

    const [isResizing, setIsResizing] = useState(false);
    const [hasOpened, setHasOpened] = useState(isOpen);

    const sidebarRef = React.useRef<HTMLDivElement>(null);
    const resizeStartX = useReactRef(0);
    const resizeStartW = useReactRef(SIDEBAR_MIN_WIDTH);

    useEffect(() => {
        if (isOpen) setHasOpened(true);
    }, [isOpen]);

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

    const { preparedCount, prepare } = useSidebarPreparation(hasOpened, categoryCount);

    const toggleSidebar = () => {
        const newState = !isOpen;
        if (newState) setHasOpened(true);
        setIsOpen(newState);
        if (onToggle) {
            onToggle(newState);
        }
    };

    return (
      <SidebarWindow containerRef={sidebarRef}>
        <div
            className={`${styles.sidebarContainer} ${isOpen ? styles.open : ''} ${!visible ? styles.hidden : ''}`}
            data-sidebar-layout="desktop"
            aria-hidden={!visible}
            inert={!visible}
        >
            <button
                className={`${styles.sidebarToggle} ${isOpen ? styles.open : ''} ${!visible ? styles.hidden : ''}`}
                onClick={toggleSidebar}
                onPointerEnter={prepare}
                onFocus={prepare}
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
                    {preparedCount > 0 && <>
                        <SearchDesktop />
                        <div className={styles.filters}>
                        <SidebarFilters preparedCount={preparedCount} columns={filterColumns} />
                        </div>
                    </>}
                    <AccountCard />
                </div>
                <SidebarFooter />
                {/* Drawer placed above footer */}
                <Drawer
                    side='bottom'
                    initialSize={0}
                    snap={['0rem', '9.375rem']}
                    snapThreshold={[50, 50]}
                    snapToIndex={uiPrefsHydrated ? drawerSnapIndex : null}
                    onSnapChange={setDrawerSnapIndex}
                    handleSize="1.75rem"
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
      </SidebarWindow>
    );
};

export default SideBarDesktop;
