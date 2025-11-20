/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call */
import { UserGuideTooltip } from '@/component/userGuide/tooltip/UserGuideTooltip.tsx';
import Joyride, { CallBackProps, EVENTS, Step, STATUS } from 'react-joyride';
import { useTranslateUI, useLocale } from '@/locale';
import parse from 'html-react-parser';
import { useCallback, useMemo } from 'react';
import { useSetSidebarOpen, useToggleMarkFilterExpanded, useUiPrefsStore, useSetDrawerSnapIndex, useSetForceSubregionOpen, useSetForceDetailOpen } from '@/store/uiPrefs';
import { useMarkerStore, useSwitchFilter } from '@/store/marker';
import { useAddPoint } from '@/store/userRecord';
import { MARKER_TYPE_TREE, WORLD_MARKS } from '@/data/marker';

const UserGuide = () => {
    const t = useTranslateUI();
    const locale = useLocale();

    const setSidebarOpen = useSetSidebarOpen();
    const toggleMarkFilterExpanded = useToggleMarkFilterExpanded();
    const switchFilter = useSwitchFilter();
    const addPoint = useAddPoint();
    const setCurrentActivePoint = useMarkerStore((s) => s.setCurrentActivePoint);
    const setDrawerSnapIndex = useSetDrawerSnapIndex();
    const setForceSubregionOpen = useSetForceSubregionOpen();
    const setForceDetailOpen = useSetForceDetailOpen();

    const handleJoyrideCallback = useCallback((data: CallBackProps) => {
        const { action, index, type, status } = data;

        if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
             setForceDetailOpen(false);
             setForceSubregionOpen(false);
             setDrawerSnapIndex(null);
             return;
        }

        if (type === EVENTS.STEP_AFTER && action === 'next') {
            // 1. Sidebar Toggle (Index 0) -> Open Sidebar
            if (index === 0) {
                setSidebarOpen(true);
            }

            // 3. Filter Container (Index 2) -> Expand Filter
            if (index === 2) {
                const firstKey = Object.keys(MARKER_TYPE_TREE)[0];
                const isExpanded = useUiPrefsStore.getState().markFilterExpanded[firstKey];
                if (!isExpanded) {
                    toggleMarkFilterExpanded(firstKey);
                }
            }

            // 5. Selector Select (Index 4) -> Select Filter
            if (index === 4) {
                const firstKey = Object.keys(MARKER_TYPE_TREE)[0];
                const firstType = Object.values(MARKER_TYPE_TREE[firstKey])[0][0].key;
                const currentFilter = useMarkerStore.getState().filter;
                if (!currentFilter.includes(firstType)) {
                    switchFilter(firstType);
                }
            }

            // 6. Selector Complete (Index 5) -> Mark Complete
            if (index === 5) {
                const firstKey = Object.keys(MARKER_TYPE_TREE)[0];
                const firstType = Object.values(MARKER_TYPE_TREE[firstKey])[0][0].key;
                const points = WORLD_MARKS.filter((m) => m.type === firstType);
                points.forEach((p) => addPoint(p.id));
            }

            // 7. Trigger Handle (Index 6) -> Open Drawer
            if (index === 6) {
                setDrawerSnapIndex(1);
            }

            // 8. Trigger Switch (Index 7) -> Close Sidebar & Drawer
            if (index === 7) {
                setSidebarOpen(false);
                setDrawerSnapIndex(0);
            }

            // 18. Region Switch (Index 17) -> Open Subregion
            if (index === 17) {
                setForceSubregionOpen(true);
            }

            // 19. Subregion Switch (Index 18) -> Close Subregion
            if (index === 18) {
                setForceSubregionOpen(false);
            }

            // 21. Point Select (Index 19) -> Select Point & Force Detail Open
            if (index === 19) {
                const p = WORLD_MARKS[0];
                if (p) setCurrentActivePoint(p);
                setForceDetailOpen(true);
            }

            // 22. Point Mark (Index 20) -> Mark Point (Check)
            if (index === 20) {
                const p = useMarkerStore.getState().currentActivePoint;
                if (p) addPoint(p.id);
            }

            // 23. Point Icon (Index 22) -> Close Detail Force (allow close)
            if (index === 22) {
                setForceDetailOpen(false);
            }
        }
    }, [setSidebarOpen, toggleMarkFilterExpanded, switchFilter, addPoint, setCurrentActivePoint, setDrawerSnapIndex, setForceSubregionOpen, setForceDetailOpen]);

    const steps = useMemo<Array<Step>>(() => [
        {
            target: '[class*="sidebarToggle"]',
            content: parse(t('guide.sidebarToggle') || ''),
            placement: 'right',
            disableBeacon: false,
            spotlightClicks: true,
        },
        {
            target: '[class*="searchContainer"]',
            content: parse(t('guide.search') || ''),
            placement: 'right',
            floaterProps: { disableAnimation: true },
        },
        {
            target: '[class*="markFilterContainer"]',
            content: parse(t('guide.filterContainer') || ''),
            placement: 'right',
            floaterProps: { disableAnimation: true },
        },
        {
            target: '[class*="filterIcon"]',
            content: parse(t('guide.filterSort') || ''),
            placement: 'right',
        },
        {
            target: '[class*="markItem"]',
            content: parse(t('guide.selectorSelect') || ''),
            placement: 'right',
        },
        {
            target: '[class*="markItem"]',
            content: parse(t('guide.selectorComplete') || ''),
            placement: 'right',
        },
        {
            target: '[class*="triggerDrawerHandle"]',
            content: parse(t('guide.triggerHandle') || ''),
            placement: 'top',
        },
        {
            target: '[class*="triggerButton"]',
            content: parse(t('guide.triggerSwitch') || ''),
            placement: 'top',
        },
        {
            target: '[class*="scaleContainer"]',
            content: parse(t('guide.scale') || ''),
            placement: 'left',
        },
        {
            target: '[class*="mainFilterList"]',
            content: parse(t('guide.filterList') || ''),
            placement: 'top',
        },
        {
            target: '[class*="headbar"]',
            content: parse(t('guide.headbar') || ''),
            placement: 'bottom',
        },
        {
            target: '[class*="headbarItem"]:nth-child(1)',
            content: parse(t('guide.tos') || ''),
            placement: 'bottom',
        },
        {
            target: '[class*="headbarItem"]:nth-child(2)',
            content: parse(t('guide.hideUI') || ''),
            placement: 'bottom',
        },
        {
            target: '[class*="headbarItem"]:nth-child(3)',
            content: parse(t('guide.group') || ''),
            placement: 'bottom',
        },
        {
            target: '[class*="headbarItem"]:nth-child(4)',
            content: parse(t('guide.darkMode') || ''),
            placement: 'bottom',
        },
        {
            target: '[class*="headbarItem"]:nth-child(5)',
            content: parse(t('guide.language') || ''),
            placement: 'bottom',
        },
        {
            target: '[class*="headbarItem"]:nth-child(6)',
            content: parse(t('guide.help') || ''),
            placement: 'bottom',
        },
        {
            target: '[class*="regswitch"]',
            content: parse(t('guide.regionSwitch') || ''),
            placement: 'right',
        },
        {
            target: '[class*="subregionSwitch"]',
            content: parse(t('guide.subregionSwitch') || ''),
            placement: 'right',
        },
        {
            target: '.leaflet-marker-icon',
            content: parse(t('guide.pointSelect') || ''),
            placement: 'top',
        },
        {
            target: '.leaflet-marker-icon',
            content: parse(t('guide.pointMark') || ''),
            placement: 'top',
        },
        {
            target: '[class*="detailContainer"]',
            content: parse(t('guide.detail') || ''),
            placement: 'left',
        },
        {
            target: '[class*="pointIcon"]',
            content: parse(t('guide.pointIcon') || ''),
            placement: 'left',
        },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    ], [locale]);

    return (
        <Joyride
            steps={steps}
            run={true}
            continuous={true}
            debug={true}
            tooltipComponent={UserGuideTooltip}
            callback={handleJoyrideCallback}
            styles={{
                options: {
                    arrowColor: 'rgba(0,0,0,0)',
                    zIndex: 100000,
                },
            }}
        />
    );
};

export default UserGuide;
