import { Step } from 'react-joyride';
import { useTranslateUI } from '@/locale';
import parse from 'html-react-parser';
import { useEffect, useMemo, useState } from 'react';
import L from 'leaflet';
import {
    useSetSidebarOpen,
    useToggleMarkFilterExpanded,
    useUiPrefsStore,
    useSetDesktopDrawerSnapIndex,
    useSetForceRegionSubOpen,
    useSetForceLayerSubOpen,
    useSetForceDetailOpen,
} from '@/store/uiPrefs';
import { useMarkerStore, useSwitchFilter } from '@/store/marker';
import { useAddPoint, useDeletePoint } from '@/store/userRecord';
import useRegion from '@/store/region';
import { loadAllMarkers, MARKER_TYPE_TREE, type IMarkerData, type IMarkerType } from '@/data/marker';

export type GuideStep = Step & {
    id: string;
    onBefore?: () => void | Promise<void>;
    onNext?: () => void | Promise<void>;
    delay?: number;
    disableAutoScroll?: boolean;
};

export const useDesktopGuideSteps = (map?: L.Map) => {
    const t = useTranslateUI();
    const setSidebarOpen = useSetSidebarOpen();
    const toggleMarkFilterExpanded = useToggleMarkFilterExpanded();
    const switchFilter = useSwitchFilter();
    const addPoint = useAddPoint();
    const deletePoint = useDeletePoint();
    const setCurrentActivePoint = useMarkerStore((s) => s.setCurrentActivePoint);
    const setDrawerSnapIndex = useSetDesktopDrawerSnapIndex();
    const setForceRegionSubOpen = useSetForceRegionSubOpen();
    const setForceLayerSubOpen = useSetForceLayerSubOpen();
    const setForceDetailOpen = useSetForceDetailOpen();
    const setCurrentRegion = useRegion((s) => s.setCurrentRegion);

    const targetSubCategory = 'boss';
    // Fallback to first available if boss is missing/empty, though unlikely
    const firstSubCategory = MARKER_TYPE_TREE[targetSubCategory]?.length 
        ? targetSubCategory 
        : Object.keys(MARKER_TYPE_TREE)[0];
        
    const firstType = (MARKER_TYPE_TREE[firstSubCategory]?.[0] as IMarkerType | undefined)?.key ?? '';

    const [targetPoint, setTargetPoint] = useState<IMarkerData | undefined>();

    useEffect(() => {
        let cancelled = false;
        void loadAllMarkers().then((markers) => {
            if (cancelled) return;
            setTargetPoint(markers.find((m) => m.type === firstType));
        });
        return () => {
            cancelled = true;
        };
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
            disableAutoScroll: true,
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
            disableAutoScroll: true,
            onNext: () => {
                void loadAllMarkers().then((markers) => {
                    markers
                        .filter((m) => m.type === firstType)
                        .forEach((p) => addPoint(p.id));
                });
            },
        },
        {
            id: 'STEP-7_trigger-handle',
            target: '[class*="triggerDrawerHandle"]',
            content: parse(t('guide.triggerHandle') || ''),
            placement: 'top',
            disableBeacon: true,
            disableAutoScroll: true,
            onNext: () => {
                setDrawerSnapIndex(1);
                void loadAllMarkers().then((markers) => {
                    markers
                        .filter((m) => m.type === firstType)
                        .forEach((p) => deletePoint(p.id));
                });
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
            disableAutoScroll: true,
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
            target: '[data-guide="headbar-tos"]',
            content: parse(t('guide.tos') || ''),
            placement: 'bottom',
            disableBeacon: true,
        },
        {
            id: 'STEP-13_hide-ui',
            target: '[data-guide="headbar-hide-ui"]',
            content: parse(t('guide.hideUI') || ''),
            placement: 'bottom',
            disableBeacon: true,
        },
        {
            id: 'STEP-14_group',
            target: '[data-guide="headbar-group"]',
            content: parse(t('guide.group') || ''),
            placement: 'bottom',
            disableBeacon: true,
        },
        {
            id: 'STEP-15_dark-mode',
            target: '[data-guide="headbar-dark-mode"]',
            content: parse(t('guide.darkMode') || ''),
            placement: 'bottom',
            disableBeacon: true,
        },
        {
            id: 'STEP-16_language',
            target: '[data-guide="headbar-language"]',
            content: parse(t('guide.language') || ''),
            placement: 'bottom',
            disableBeacon: true,
        },
        {
            id: 'STEP-17_help',
            target: '[data-guide="headbar-help"]',
            content: parse(t('guide.help') || ''),
            placement: 'bottom',
            disableBeacon: true,
        },
        {
            id: 'STEP-17_announcement',
            target: '[data-guide="headbar-announcement"]',
            content: parse(t('guide.announcement') || ''),
            placement: 'bottom',
            disableBeacon: true,
        },
        {
            id: 'STEP-18_settings',
            target: '[data-guide="headbar-settings"]',
            content: parse(t('guide.settings') || ''),
            placement: 'bottom',
            disableBeacon: true,
        },
        {
            id: 'STEP-19_region-switch',
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
            id: 'STEP-20_subregion-switch',
            target: '[class*="subregionSwitch"]',
            content: parse(t('guide.subregionSwitch') || ''),
            placement: 'right',
            disableBeacon: true,
            onNext: () => {
                setForceRegionSubOpen(false);
                // Ensure next layer steps always have a layer switch rendered.
                setCurrentRegion('Valley_4');
                map?.setZoom(map.getMinZoom(), { animate: true });
            },
            delay: 420,
        },
        {
            id: 'STEP-21_layer-main',
            target: '[data-guide="layer-main-toggle"]',
            content: parse(t('guide.layerMain') || ''),
            placement: 'right',
            disableBeacon: true,
            onNext: () => {
                setForceRegionSubOpen(false);
                setForceLayerSubOpen(true);
            },
            delay: 260,
        },
        {
            id: 'STEP-22_layer-switch',
            target: '[data-guide="layer-switch-item"]',
            content: parse(t('guide.layerSwitch') || ''),
            placement: 'right',
            disableBeacon: true,
            onNext: () => {
                setForceLayerSubOpen(false);
            },
        },
        {
            id: 'STEP-23_locator-button',
            target: '[data-guide="locator-button"]',
            content: parse(t('guide.locator') || ''),
            placement: 'right',
            disableBeacon: true,
            disableAutoScroll: true,
        },
        {
            id: 'STEP-24_point-select',
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
            id: 'STEP-25_point-check',
            target: '.leaflet-marker-icon',
            content: parse(t('guide.pointMark') || ''),
            placement: 'top',
            disableBeacon: true,
            onNext: () => {
                if (targetPoint) addPoint(targetPoint.id);
            },
        },
        {
            id: 'STEP-26_detail-container',
            target: '[class*="detailContainer"]',
            content: parse(t('guide.detail') || ''),
            placement: 'top',
            disableBeacon: true,
            disableAutoScroll: true,
        },
        {
            id: 'STEP-27_point-icon',
            target: '[class*="pointIcon"]',
            content: parse(t('guide.pointIcon') || ''),
            placement: 'top',
            disableBeacon: true,
            disableAutoScroll: true,
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
        setForceRegionSubOpen,
        setForceLayerSubOpen,
        setCurrentActivePoint,
        setForceDetailOpen,
        setCurrentRegion,
        map,
        firstSubCategory,
        firstType,
        targetPoint,
    ]);

    return steps;
};
