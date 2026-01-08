import { Step } from 'react-joyride';
import { useTranslateUI } from '@/locale';
import parse from 'html-react-parser';
import { useMemo } from 'react';
import L from 'leaflet';
import {
    useSetSidebarOpen,
    useToggleMarkFilterExpanded,
    useUiPrefsStore,
    useSetDrawerSnapIndex,
    useSetForceSubregionOpen,
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

export const useGuideSteps = (map?: L.Map) => {
    const t = useTranslateUI();
    const setSidebarOpen = useSetSidebarOpen();
    const toggleMarkFilterExpanded = useToggleMarkFilterExpanded();
    const switchFilter = useSwitchFilter();
    const addPoint = useAddPoint();
    const deletePoint = useDeletePoint();
    const setCurrentActivePoint = useMarkerStore((s) => s.setCurrentActivePoint);
    const setDrawerSnapIndex = useSetDrawerSnapIndex();
    const setForceSubregionOpen = useSetForceSubregionOpen();
    const setForceDetailOpen = useSetForceDetailOpen();

    const targetSubCategory = 'boss';
    // Fallback to first available if boss is missing/empty, though unlikely
    const firstSubCategory = MARKER_TYPE_TREE[targetSubCategory]?.length 
        ? targetSubCategory 
        : Object.keys(MARKER_TYPE_TREE)[0];
        
    const firstType = (MARKER_TYPE_TREE[firstSubCategory]?.[0] as IMarkerType | undefined)?.key ?? '';

    const targetPoint = useMemo(() => {
        return WORLD_MARKS.find((m) => m.type === firstType);
    }, [firstType]);

    const steps: GuideStep[] = useMemo(() => [
        {
            id: 'STEP-0_welcome',
            target: 'body',
            content: parse(t('guide.welcome') || ''),
            placement: 'center',
            disableBeacon: true,
        },
        {
            id: 'STEP-1_sidebar-toggle',
            target: '[class*="sidebarToggle"]',
            content: parse(t('guide.sidebarToggle') || ''),
            placement: 'right',
            disableBeacon: true,
            onNext: () => setSidebarOpen(true),
            delay: 300,
        },
        {
            id: 'STEP-2_search-container',
            target: '[class*="searchContainer"]',
            content: parse(t('guide.search') || ''),
            placement: 'right',
            disableBeacon: true,
            onNext: () => {
                 // Scroll target filter category into view BEFORE step 3 highlights it
                 const el = document.querySelector(`[data-category="${firstSubCategory}"]`);
                 const container = document.querySelector('[class*="sidebarContent"]');

                 if (el && container) {
                     const containerRect = container.getBoundingClientRect();
                     const elRect = el.getBoundingClientRect();
                     
                     // Calculate target scroll position manually to avoid 'scrollIntoView' affecting parent containers
                     const relativeTop = elRect.top - containerRect.top; // Distance from container top to element top
                     const currentScroll = container.scrollTop;
                     
                     // Target: Center the element in the container
                     // newScroll = currentScroll + relativeTop - (containerHeight / 2) + (elHeight / 2)
                     const targetScroll = currentScroll + relativeTop - (containerRect.height / 2) + (elRect.height / 2);

                     container.scrollTo({
                         top: targetScroll,
                         behavior: 'smooth'
                     });
                 }
            },
            delay: 300, // Wait for scroll
        },
        {
            id: 'STEP-3_filter-container',
            target: `[data-category="${firstSubCategory}"]`,
            content: parse(t('guide.filterContainer') || ''),
            placement: 'right',
            disableBeacon: true,
            onNext: () => {
                // Ensure the target subcategory is expanded
                const isExpanded =
                    useUiPrefsStore.getState().markFilterExpanded[firstSubCategory];
                if (!isExpanded) {
                    toggleMarkFilterExpanded(firstSubCategory);
                }
                
                // Scroll target item (inside the category) into view if needed
                setTimeout(() => {
                    const el = document.querySelector(`[data-key="${firstType}"]`);
                    const container = document.querySelector('[class*="sidebarContent"]');
                    
                    if (el && container) {
                         const containerRect = container.getBoundingClientRect();
                         const elRect = el.getBoundingClientRect();
                         const relativeTop = elRect.top - containerRect.top;
                         const currentScroll = container.scrollTop;
                         
                         const targetScroll = currentScroll + relativeTop - (containerRect.height / 2) + (elRect.height / 2);
    
                         container.scrollTo({
                             top: targetScroll,
                             behavior: 'smooth'
                         });
                    }
                }, 100);
            },
            delay: 400,
        },
        {
            id: 'STEP-4_filter-icon',
            target: `[data-category="${firstSubCategory}"] [class*="filterIcon"]`, // Use specific category icon
            content: parse(t('guide.filterSort') || ''),
            placement: 'right',
            disableBeacon: true,
        },
        {
            id: 'STEP-5_selector-select',
            target: `[data-key="${firstType}"]`,
            content: parse(t('guide.selectorSelect') || ''),
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
            id: 'STEP-6_selector-complete',
            target: `[data-key="${firstType}"]`,
            content: parse(t('guide.selectorComplete') || ''),
            placement: 'right',
            disableBeacon: true,
            onNext: () => {
                const points = WORLD_MARKS.filter(
                    (m) => m.type === firstType,
                );
                points.forEach((p) => addPoint(p.id));
            },
        },
        {
            id: 'STEP-7_trigger-handle',
            target: '[class*="triggerDrawerHandle"]',
            content: parse(t('guide.triggerHandle') || ''),
            placement: 'top',
            disableBeacon: true,
            onNext: () => {
                setDrawerSnapIndex(1);
                const points = WORLD_MARKS.filter(
                    (m) => m.type === firstType,
                );
                points.forEach((p) => deletePoint(p.id));
            },
            delay: 300,
        },
        {
            id: 'STEP-8_trigger-switch',
            target: '[class*="triggerButton"]',
            content: parse(t('guide.triggerSwitch') || ''),
            placement: 'top',
            disableBeacon: true,
        },
        {
            id: 'STEP-9_scale-container',
            target: '[class*="scaleContainer"]',
            content: parse(t('guide.scale') || ''),
            placement: 'left',
            disableBeacon: true,
        },
        {
            id: 'STEP-10_filter-list',
            target: '[class*="mainFilterList"]',
            content: parse(t('guide.filterList') || ''),
            placement: 'top',
            disableBeacon: true,
        },
        {
            id: 'STEP-11_headbar',
            target: '[class*="headbar"]',
            content: parse(t('guide.headbar') || ''),
            placement: 'bottom',
            disableBeacon: true,
        },
        {
            id: 'STEP-12_tos',
            target: '[class*="headbarItem"]:nth-child(1)',
            content: parse(t('guide.tos') || ''),
            placement: 'bottom',
            disableBeacon: true,
        },
        {
            id: 'STEP-13_hide-ui',
            target: '[class*="headbarItem"]:nth-child(2)',
            content: parse(t('guide.hideUI') || ''),
            placement: 'bottom',
            disableBeacon: true,
        },
        {
            id: 'STEP-14_group',
            target: '[class*="headbarItem"]:nth-child(3)',
            content: parse(t('guide.group') || ''),
            placement: 'bottom',
            disableBeacon: true,
        },
        {
            id: 'STEP-15_dark-mode',
            target: '[class*="headbarItem"]:nth-child(4)',
            content: parse(t('guide.darkMode') || ''),
            placement: 'bottom',
            disableBeacon: true,
        },
        {
            id: 'STEP-16_language',
            target: '[class*="headbarItem"]:nth-child(5)',
            content: parse(t('guide.language') || ''),
            placement: 'bottom',
            disableBeacon: true,
        },
        {
            id: 'STEP-17_help',
            target: '[class*="headbarItem"]:nth-child(6)',
            content: parse(t('guide.help') || ''),
            placement: 'bottom',
            disableBeacon: true,
        },
        {
            id: 'STEP-18_region-switch',
            target: '[class*="regswitch"]',
            content: parse(t('guide.regionSwitch') || ''),
            placement: 'right',
            disableBeacon: true,
            onNext: () => setForceSubregionOpen(true),
            delay: 300,
        },
        {
            id: 'STEP-19_subregion-switch',
            target: '[class*="subregionSwitch"]',
            content: parse(t('guide.subregionSwitch') || ''),
            placement: 'right',
            disableBeacon: true,
            onNext: () => {
                setForceSubregionOpen(false);
                map?.setZoom(map.getMinZoom(), { animate: true });
            },
            delay: 300,
        },
        {
            id: 'STEP-20_point-select',
            target: '.leaflet-marker-icon',
            content: parse(t('guide.pointSelect') || ''),
            placement: 'top',
            disableBeacon: true,
            onNext: () => {
                if (targetPoint) setCurrentActivePoint(targetPoint);
                setForceDetailOpen(true);
            },
            delay: 300,
        },
        {
            id: 'STEP-21_point-check',
            target: '.leaflet-marker-icon',
            content: parse(t('guide.pointMark') || ''),
            placement: 'top',
            disableBeacon: true,
            onNext: () => {
                if (targetPoint) addPoint(targetPoint.id);
            },
        },
        {
            id: 'STEP-22_detail-container',
            target: '[class*="detailContainer"]',
            content: parse(t('guide.detail') || ''),
            placement: 'top',
            disableBeacon: true,
        },
        {
            id: 'STEP-23_point-icon',
            target: '[class*="pointIcon"]',
            content: parse(t('guide.pointIcon') || ''),
            placement: 'top',
            disableBeacon: true,
            onNext: () => setForceDetailOpen(false),
        },
    ], [
        t,
        setSidebarOpen,
        toggleMarkFilterExpanded,
        switchFilter,
        addPoint,
        deletePoint,
        setDrawerSnapIndex,
        setForceSubregionOpen,
        setCurrentActivePoint,
        setForceDetailOpen,
        map,
        firstType,
        targetPoint,
    ]);

    return steps;
};