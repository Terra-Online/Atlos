import { Step } from 'react-joyride';
import { useTranslateUI } from '@/locale';
import parse from 'html-react-parser';
import { useCallback, useMemo } from 'react';
import L from 'leaflet';
import {
    useToggleMarkFilterExpanded,
    useUiPrefsStore,
    useSetMobileDrawerSnapIndex,
    useSetForceDetailOpen,
    useSetForceRegionSubOpen,
    useSetForceLayerSubOpen,
    useSetForceHeadbarExpanded,
} from '@/store/uiPrefs';
import { useMarkerStore, useSwitchFilter } from '@/store/marker';
import { useAddPoint, useDeletePoint } from '@/store/userRecord';
import { MARKER_TYPE_TREE, WORLD_MARKS, type IMarkerType } from '@/data/marker';

export type GuideStep = Step & {
    id: string;
    onBefore?: () => void | Promise<void>;
    onNext?: () => void | Promise<void>;
    delay?: number;
    disableAutoScroll?: boolean;
};

export const useMobileGuideSteps = (map?: L.Map) => {
    const t = useTranslateUI();
    const toggleMarkFilterExpanded = useToggleMarkFilterExpanded();
    const switchFilter = useSwitchFilter();
    const addPoint = useAddPoint();
    const deletePoint = useDeletePoint();
    const setCurrentActivePoint = useMarkerStore((s) => s.setCurrentActivePoint);
    const setDrawerSnapIndex = useSetMobileDrawerSnapIndex();
    const setForceDetailOpen = useSetForceDetailOpen();
    const setForceRegionSubOpen = useSetForceRegionSubOpen();
    const setForceLayerSubOpen = useSetForceLayerSubOpen();
    const setForceHeadbarExpanded = useSetForceHeadbarExpanded();

    const targetSubCategory = 'boss';
    const firstSubCategory = MARKER_TYPE_TREE[targetSubCategory]?.length 
        ? targetSubCategory 
        : Object.keys(MARKER_TYPE_TREE)[0];
    const firstType = (MARKER_TYPE_TREE[firstSubCategory]?.[0] as IMarkerType | undefined)?.key ?? '';

    const targetPoint = useMemo(() => {
        return WORLD_MARKS.find((m) => m.type === firstType);
    }, [firstType]);

    const waitForElement = useCallback((selector: string, timeoutMs = 1200) => {
        return new Promise<Element | null>((resolve) => {
            const start = Date.now();
            const tick = () => {
                const el = document.querySelector(selector);
                if (el) return resolve(el);
                if (Date.now() - start >= timeoutMs) return resolve(null);
                setTimeout(tick, 60);
            };
            tick();
        });
    }, []);

    const scrollTypeIntoView = useCallback(async () => {
        const el = await waitForElement(`[data-key="${firstType}"]`, 1200);
        if (el instanceof HTMLElement) {
            try {
                el.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
            } catch {
                // no-op
            }
        }
    }, [firstType, waitForElement]);

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
                // Force expand mobile headbar
                setForceHeadbarExpanded(true);
            },
            delay: 350,
        },
        {
            id: 'MSTEP-2_tos',
            target: '[class*="headbarGrid"] > button[class*="headbarItem"]:nth-child(2)',
            content: parse(t('guide.tos') || ''),
            placement: 'bottom',
            disableBeacon: true,
        },
        {
            id: 'MSTEP-3_hide-ui',
            target: '[class*="headbarGrid"] > button[class*="headbarItem"]:nth-child(4)',
            content: parse(t('guide.hideUI') || ''),
            placement: 'bottom',
            disableBeacon: true,
        },
        {
            id: 'MSTEP-4_group',
            target: '[class*="headbarGrid"] > button[class*="headbarItem"]:nth-child(6)',
            content: parse(t('guide.group') || ''),
            placement: 'bottom',
            disableBeacon: true,
        },
        {
            id: 'MSTEP-5_dark-mode',
            target: '[class*="headbarGrid"] > button[class*="headbarItem"]:nth-child(8)',
            content: parse(t('guide.darkMode') || ''),
            placement: 'bottom',
            disableBeacon: true,
        },
        {
            id: 'MSTEP-6_language',
            target: '[class*="headbarGrid"] > button[class*="headbarItem"]:nth-child(10)',
            content: parse(t('guide.language') || ''),
            placement: 'bottom',
            disableBeacon: true,
        },
        {
            id: 'MSTEP-7_help',
            target: '[class*="headbarGrid"] > button[class*="headbarItem"]:nth-child(12)',
            content: parse(t('guide.help') || ''),
            placement: 'bottom',
            disableBeacon: true,
        },
        {
            id: 'MSTEP-8_settings',
            target: '[class*="headbarGrid"] > button[class*="headbarItem"]:nth-child(14)',
            content: parse(t('guide.settings') || ''),
            placement: 'bottom',
            disableBeacon: true,
            onNext: () => {
                // Close headbar forced expansion
                setForceHeadbarExpanded(null);
            },
            delay: 300,
        },
        {
            id: 'MSTEP-9_region-switch',
            target: '[class*="regswitch"]',
            content: parse(t('guide.regionSwitch') || ''),
            placement: 'right',
            disableBeacon: true,
            onNext: () => {
                setForceLayerSubOpen(false);
                setForceRegionSubOpen(true);
            },
            delay: 300,
        },
        {
            id: 'MSTEP-10_subregion-switch',
            target: '[class*="subregionSwitch"]',
            content: parse(t('guide.subregionSwitch') || ''),
            placement: 'right',
            disableBeacon: true,
            onNext: () => {
                setForceRegionSubOpen(false);
                map?.setZoom(map.getMinZoom(), { animate: true });
            },
            delay: 300,
        },
        {
            id: 'MSTEP-11_layer-main',
            target: '[class*="layerswitch"] > [class*="regItem"]',
            content: parse(t('guide.layerMain') || ''),
            placement: 'right',
            disableBeacon: true,
            onNext: () => {
                setForceRegionSubOpen(false);
                setForceLayerSubOpen(true);
            },
            delay: 200,
        },
        {
            id: 'MSTEP-12_layer-switch',
            target: '[class*="layerswitch"] [class*="subregionSwitch"]',
            content: parse(t('guide.layerSwitch') || ''),
            placement: 'right',
            disableBeacon: true,
            disableAutoScroll: true,
            onNext: () => {
                setForceLayerSubOpen(false);
            },
        },
        {
            id: 'MSTEP-13_search',
            target: '[class*="searchContainer"]',
            content: parse(t('guide.search') || ''),
            placement: 'bottom',
            disableBeacon: true,
            disableAutoScroll: true,
        },
        {
            id: 'MSTEP-14_divider',
            target: '[class*="divider"]',
            content: parse(t('guide.mobile.divider') || ''),
            placement: 'left',
            disableBeacon: true,
            disableAutoScroll: true,
        },
        {
            id: 'MSTEP-15_filter-list',
            target: '[class*="topRowPane"]:nth-child(3)',
            content: parse(t('guide.filterList') || ''),
            placement: 'bottom',
            disableBeacon: true,
            disableAutoScroll: true,
        },
        {
            id: 'MSTEP-16_drawer',
            target: '[class*="mobileDrawer"]',
            content: parse(t('guide.mobile.drawer') || ''),
            placement: 'top',
            disableBeacon: true,
            disableAutoScroll: true,
            onNext: () => {
                // Pull up drawer to snap index 1 (55% height)
                setDrawerSnapIndex(1);
            },
            delay: 300,
        },
        {
            id: 'MSTEP-17_filter-container',
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
                    const container =
                        document.querySelector<HTMLElement>('[class*="contentWrapper"]') ??
                        document.querySelector<HTMLElement>('[class*="mobileDrawerContent"]');
                    if (targetItem instanceof HTMLElement && container instanceof HTMLElement) {
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
            id: 'MSTEP-18_filter-icon',
            target: `[data-category="${firstSubCategory}"] [class*="filterIcon"]`,
            content: parse(t('guide.filterSort') || ''),
            placement: 'right',
            disableBeacon: true,
        },
        {
            id: 'MSTEP-19_selector-select',
            target: `[data-key="${firstType}"]`,
            content: parse(t('guide.mobile.selectorSelect') || ''),
            placement: 'right',
            disableBeacon: true,
            onBefore: async () => {
                // Ensure drawer is visible and the markFilter section is expanded, then scroll to the first type.
                setDrawerSnapIndex(1);
                const isExpanded = useUiPrefsStore.getState().markFilterExpanded[firstSubCategory];
                if (!isExpanded) {
                    toggleMarkFilterExpanded(firstSubCategory);
                }
                await scrollTypeIntoView();
            },
            onNext: () => {
                const currentFilter = useMarkerStore.getState().filter;
                if (!currentFilter.includes(firstType)) {
                    switchFilter(firstType);
                }
            },
        },
        {
            id: 'MSTEP-20_selector-complete',
            target: `[data-key="${firstType}"]`,
            content: parse(t('guide.selectorComplete') || ''),
            placement: 'right',
            disableBeacon: true,
            onBefore: async () => {
                // Ensure drawer is visible and the markFilter section is expanded, then scroll to the first type.
                setDrawerSnapIndex(1);
                const isExpanded = useUiPrefsStore.getState().markFilterExpanded[firstSubCategory];
                if (!isExpanded) {
                    toggleMarkFilterExpanded(firstSubCategory);
                }
                await scrollTypeIntoView();
            },
            onNext: () => {
                const points = WORLD_MARKS.filter((m) => m.type === firstType);
                points.forEach((p) => addPoint(p.id));
            },
        },
        {
            onBefore: async () => {
                setDrawerSnapIndex(1);
                await scrollTypeIntoView();
            },
            id: 'MSTEP-21_trigger-switch',
            target: '[class*="mobileTriggerBar"]',
            content: parse(t('guide.triggerSwitch') || ''),
            placement: 'top',
            disableBeacon: true,
            disableAutoScroll: true,
            onNext: () => {
                // Pull down drawer to snap index 0
                setDrawerSnapIndex(0);
                const points = WORLD_MARKS.filter((m) => m.type === firstType);
                points.forEach((p) => deletePoint(p.id));
            },
            delay: 300,
        },
        {
            id: 'MSTEP-22_point-select',
            target: '.leaflet-marker-icon',
            content: parse(t('guide.pointSelect') || ''),
            placement: 'top',
            disableBeacon: true,
            disableAutoScroll: true,
            onNext: () => {
                if (targetPoint) {
                    setCurrentActivePoint(targetPoint);
                    setForceDetailOpen(true);
                }
            },
            delay: 300,
        },
        {
            id: 'MSTEP-23_point-check',
            target: '.leaflet-marker-icon',
            content: parse(t('guide.pointMark') || ''),
            placement: 'top',
            disableBeacon: true,
            disableAutoScroll: true,
            onNext: () => {
                setForceDetailOpen(false);
            },
        },
    ], [
        t,
        map,
        toggleMarkFilterExpanded,
        switchFilter,
        addPoint,
        deletePoint,
        setDrawerSnapIndex,
        setCurrentActivePoint,
        setForceDetailOpen,
        setForceRegionSubOpen,
        setForceLayerSubOpen,
        setForceHeadbarExpanded,
        firstSubCategory,
        firstType,
        targetPoint,
        scrollTypeIntoView,
    ]);

    return steps;
};
