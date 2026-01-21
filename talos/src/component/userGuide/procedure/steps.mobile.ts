import { Step } from 'react-joyride';
import { useTranslateUI } from '@/locale';
import parse from 'html-react-parser';
import { useMemo } from 'react';
import L from 'leaflet';
import {
    useToggleMarkFilterExpanded,
    useUiPrefsStore,
    useSetDrawerSnapIndex,
    useSetForceDetailOpen,
} from '@/store/uiPrefs';
import { useMarkerStore, useSwitchFilter } from '@/store/marker';
import { useAddPoint, useDeletePoint } from '@/store/userRecord';
import { MARKER_TYPE_TREE, WORLD_MARKS, type IMarkerType } from '@/data/marker';

export type GuideStep = Step & {
    id: string;
    onNext?: () => void | Promise<void>;
    delay?: number;
};

export const useMobileGuideSteps = (_map?: L.Map) => {
    const t = useTranslateUI();
    const toggleMarkFilterExpanded = useToggleMarkFilterExpanded();
    const switchFilter = useSwitchFilter();
    const addPoint = useAddPoint();
    const deletePoint = useDeletePoint();
    const setCurrentActivePoint = useMarkerStore((s) => s.setCurrentActivePoint);
    const setDrawerSnapIndex = useSetDrawerSnapIndex();
    const setForceDetailOpen = useSetForceDetailOpen();

    const targetSubCategory = 'boss';
    const firstSubCategory = MARKER_TYPE_TREE[targetSubCategory]?.length 
        ? targetSubCategory 
        : Object.keys(MARKER_TYPE_TREE)[0];
    const firstType = (MARKER_TYPE_TREE[firstSubCategory]?.[0] as IMarkerType | undefined)?.key ?? '';

    const targetPoint = useMemo(() => {
        return WORLD_MARKS.find((m) => m.type === firstType);
    }, [firstType]);

    const steps: GuideStep[] = useMemo(() => [
        {
            id: 'MSTEP-0_welcome',
            target: 'body',
            content: parse(t('guide.welcome') || ''),
            placement: 'center',
            disableBeacon: true,
        },
        {
            id: 'MSTEP-1_headbar',
            target: '[class*="headbar"]',
            content: parse(t('guide.mobile.headbar') || ''),
            placement: 'bottom',
            disableBeacon: true,
            onNext: () => {
                // Expand mobile headbar - find the toggleIcon button
                const toggleBtn = document.querySelector('[class*="headbar"] [class*="toggleIcon"]') as HTMLElement;
                if (toggleBtn) {
                    toggleBtn.click();
                }
            },
            delay: 300,
        },
        {
            id: 'MSTEP-2_tos',
            target: '[class*="headbarItem"]:nth-child(1)',
            content: parse(t('guide.tos') || ''),
            placement: 'bottom',
            disableBeacon: true,
        },
        {
            id: 'MSTEP-3_hide-ui',
            target: '[class*="headbarItem"]:nth-child(2)',
            content: parse(t('guide.hideUI') || ''),
            placement: 'bottom',
            disableBeacon: true,
        },
        {
            id: 'MSTEP-4_group',
            target: '[class*="headbarItem"]:nth-child(3)',
            content: parse(t('guide.group') || ''),
            placement: 'bottom',
            disableBeacon: true,
        },
        {
            id: 'MSTEP-5_dark-mode',
            target: '[class*="headbarItem"]:nth-child(4)',
            content: parse(t('guide.darkMode') || ''),
            placement: 'bottom',
            disableBeacon: true,
        },
        {
            id: 'MSTEP-6_language',
            target: '[class*="headbarItem"]:nth-child(5)',
            content: parse(t('guide.language') || ''),
            placement: 'bottom',
            disableBeacon: true,
        },
        {
            id: 'MSTEP-7_help',
            target: '[class*="headbarItem"]:nth-child(6)',
            content: parse(t('guide.help') || ''),
            placement: 'bottom',
            disableBeacon: true,
        },
        {
            id: 'MSTEP-8_settings',
            target: '[class*="headbarItem"]:nth-child(7)',
            content: parse(t('guide.settings') || ''),
            placement: 'bottom',
            disableBeacon: true,
            onNext: () => {
                // Collapse mobile headbar
                const toggleBtn = document.querySelector('[class*="headbar"] [class*="toggleIcon"]') as HTMLElement;
                if (toggleBtn) {
                    toggleBtn.click();
                }
            },
            delay: 300,
        },
        {
            id: 'MSTEP-9_region-layer-switch',
            target: '[class*="regswitch"]',
            content: parse(t('guide.mobile.regionLayerSwitch') || ''),
            placement: 'right',
            disableBeacon: true,
        },
        {
            id: 'MSTEP-10_search',
            target: '[class*="searchContainer"]',
            content: parse(t('guide.search') || ''),
            placement: 'bottom',
            disableBeacon: true,
        },
        {
            id: 'MSTEP-11_divider',
            target: '[class*="divider"]',
            content: parse(t('guide.mobile.divider') || ''),
            placement: 'left',
            disableBeacon: true,
        },
        {
            id: 'MSTEP-12_filter-list',
            target: '[class*="topRowPane"] [class*="filterList"]',
            content: parse(t('guide.filterList') || ''),
            placement: 'bottom',
            disableBeacon: true,
        },
        {
            id: 'MSTEP-13_drawer',
            target: '[class*="drawerContainer"]',
            content: parse(t('guide.mobile.drawer') || ''),
            placement: 'top',
            disableBeacon: true,
            onNext: () => {
                // Pull up drawer to snap index 1
                setDrawerSnapIndex(1);
            },
            delay: 300,
        },
        {
            id: 'MSTEP-14_filter-container',
            target: `[data-category="${firstSubCategory}"]`,
            content: parse(t('guide.filterContainer') || ''),
            placement: 'right',
            disableBeacon: true,
            onNext: () => {
                const isExpanded = useUiPrefsStore.getState().markFilterExpanded[firstSubCategory];
                if (!isExpanded) {
                    toggleMarkFilterExpanded(firstSubCategory);
                }
                setTimeout(() => {
                    const targetItem = document.querySelector(`[data-key="${firstType}"]`);
                    const container = document.querySelector('[class*="drawerContent"]');
                    if (targetItem && container) {
                        const containerRect = container.getBoundingClientRect();
                        const itemRect = targetItem.getBoundingClientRect();
                        const scrollTop = container.scrollTop;
                        const itemTop = itemRect.top - containerRect.top + scrollTop;
                        const itemBottom = itemTop + itemRect.height;
                        const viewportTop = scrollTop;
                        const viewportBottom = scrollTop + containerRect.height;
                        if (itemTop < viewportTop || itemBottom > viewportBottom) {
                            container.scrollTo({
                                top: itemTop - containerRect.height / 2 + itemRect.height / 2,
                                behavior: 'smooth',
                            });
                        }
                    }
                }, 100);
            },
            delay: 400,
        },
        {
            id: 'MSTEP-15_filter-icon',
            target: `[data-category="${firstSubCategory}"] [class*="filterIcon"]`,
            content: parse(t('guide.filterSort') || ''),
            placement: 'right',
            disableBeacon: true,
        },
        {
            id: 'MSTEP-16_selector-select',
            target: `[data-key="${firstType}"]`,
            content: parse(t('guide.mobile.selectorSelect') || ''),
            placement: 'right',
            disableBeacon: true,
            onNext: () => {
                const currentFilter = useMarkerStore.getState().filter;
                if (!currentFilter.includes(firstType)) {
                    switchFilter(firstType);
                }
            },
        },
        {
            id: 'MSTEP-17_selector-complete',
            target: `[data-key="${firstType}"]`,
            content: parse(t('guide.selectorComplete') || ''),
            placement: 'right',
            disableBeacon: true,
            onNext: () => {
                const points = WORLD_MARKS.filter((m) => m.type === firstType);
                points.forEach((p) => addPoint(p.id));
            },
        },
        {
            id: 'MSTEP-18_trigger-handle',
            target: '[class*="triggerDrawerHandle"]',
            content: parse(t('guide.triggerHandle') || ''),
            placement: 'top',
            disableBeacon: true,
        },
        {
            id: 'MSTEP-19_trigger-switch',
            target: '[class*="triggerButton"]',
            content: parse(t('guide.triggerSwitch') || ''),
            placement: 'top',
            disableBeacon: true,
            onNext: () => {
                // Pull down drawer to snap index 0
                setDrawerSnapIndex(0);
                const points = WORLD_MARKS.filter((m) => m.type === firstType);
                points.forEach((p) => deletePoint(p.id));
            },
            delay: 300,
        },
        {
            id: 'MSTEP-20_point-select',
            target: '.leaflet-marker-icon',
            content: parse(t('guide.pointSelect') || ''),
            placement: 'top',
            disableBeacon: true,
            onNext: () => {
                if (targetPoint) {
                    setCurrentActivePoint(targetPoint);
                    setForceDetailOpen(true);
                }
            },
            delay: 300,
        },
        {
            id: 'MSTEP-21_point-check',
            target: '.leaflet-marker-icon',
            content: parse(t('guide.pointMark') || ''),
            placement: 'top',
            disableBeacon: true,
            onNext: () => {
                setForceDetailOpen(false);
            },
        },
    ], [
        t,
        toggleMarkFilterExpanded,
        switchFilter,
        addPoint,
        deletePoint,
        setDrawerSnapIndex,
        setCurrentActivePoint,
        setForceDetailOpen,
        firstSubCategory,
        firstType,
        targetPoint,
    ]);

    return steps;
};
