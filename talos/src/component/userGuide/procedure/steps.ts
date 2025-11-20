import { Step } from 'react-joyride';
import { useTranslateUI } from '@/locale';
import parse from 'html-react-parser';
import { useMemo } from 'react';
import {
    useSetSidebarOpen,
    useToggleMarkFilterExpanded,
    useUiPrefsStore,
    useSetDrawerSnapIndex,
    useSetForceSubregionOpen,
    useSetForceDetailOpen,
} from '@/store/uiPrefs';
import { useMarkerStore, useSwitchFilter } from '@/store/marker';
import { useAddPoint } from '@/store/userRecord';
import { MARKER_TYPE_TREE, WORLD_MARKS } from '@/data/marker';

export type GuideStep = Step & {
    onNext?: () => void | Promise<void>;
    delay?: number;
};

export const useGuideSteps = () => {
    const t = useTranslateUI();
    const setSidebarOpen = useSetSidebarOpen();
    const toggleMarkFilterExpanded = useToggleMarkFilterExpanded();
    const switchFilter = useSwitchFilter();
    const addPoint = useAddPoint();
    const setCurrentActivePoint = useMarkerStore((s) => s.setCurrentActivePoint);
    const setDrawerSnapIndex = useSetDrawerSnapIndex();
    const setForceSubregionOpen = useSetForceSubregionOpen();
    const setForceDetailOpen = useSetForceDetailOpen();

    const steps: GuideStep[] = useMemo(() => [
        {
            target: '[class*="sidebarToggle"]',
            content: parse(t('guide.sidebarToggle') || ''),
            placement: 'right',
            disableBeacon: true,
            onNext: () => setSidebarOpen(true),
            delay: 300,
        },
        {
            target: '[class*="searchContainer"]',
            content: parse(t('guide.search') || ''),
            placement: 'right',
            disableBeacon: true,
        },
        {
            target: '[class*="markFilterContainer"]',
            content: parse(t('guide.filterContainer') || ''),
            placement: 'right',
            disableBeacon: true,
            onNext: () => {
                const firstKey = Object.keys(MARKER_TYPE_TREE)[0];
                const isExpanded =
                    useUiPrefsStore.getState().markFilterExpanded[firstKey];
                if (!isExpanded) {
                    toggleMarkFilterExpanded(firstKey);
                }
            },
            delay: 300,
        },
        {
            target: '[class*="filterIcon"]',
            content: parse(t('guide.filterSort') || ''),
            placement: 'right',
            disableBeacon: true,
        },
        {
            target: '[class*="markItem"]',
            content: parse(t('guide.selectorSelect') || ''),
            placement: 'right',
            disableBeacon: true,
            onNext: () => {
                const firstKey = Object.keys(MARKER_TYPE_TREE)[0];
                const firstType = Object.values(
                    MARKER_TYPE_TREE[firstKey],
                )[0][0].key;
                const currentFilter = useMarkerStore.getState().filter;
                if (!currentFilter.includes(firstType)) {
                    switchFilter(firstType);
                }
            },
        },
        {
            target: '[class*="markItem"]',
            content: parse(t('guide.selectorComplete') || ''),
            placement: 'right',
            disableBeacon: true,
            onNext: () => {
                const firstKey = Object.keys(MARKER_TYPE_TREE)[0];
                const firstType = Object.values(
                    MARKER_TYPE_TREE[firstKey],
                )[0][0].key;
                const points = WORLD_MARKS.filter(
                    (m) => m.type === firstType,
                );
                points.forEach((p) => addPoint(p.id));
            },
        },
        {
            target: '[class*="triggerDrawerHandle"]',
            content: parse(t('guide.triggerHandle') || ''),
            placement: 'top',
            disableBeacon: true,
            onNext: () => setDrawerSnapIndex(1),
            delay: 300,
        },
        {
            target: '[class*="triggerButton"]',
            content: parse(t('guide.triggerSwitch') || ''),
            placement: 'top',
            disableBeacon: true,
            onNext: () => {
                setSidebarOpen(false);
                setDrawerSnapIndex(0);
            },
            delay: 300,
        },
        {
            target: '[class*="scaleContainer"]',
            content: parse(t('guide.scale') || ''),
            placement: 'left',
            disableBeacon: true,
        },
        {
            target: '[class*="mainFilterList"]',
            content: parse(t('guide.filterList') || ''),
            placement: 'top',
            disableBeacon: true,
        },
        {
            target: '[class*="headbar"]',
            content: parse(t('guide.headbar') || ''),
            placement: 'bottom',
            disableBeacon: true,
        },
        {
            target: '[class*="headbarItem"]:nth-child(1)',
            content: parse(t('guide.tos') || ''),
            placement: 'bottom',
            disableBeacon: true,
        },
        {
            target: '[class*="headbarItem"]:nth-child(2)',
            content: parse(t('guide.hideUI') || ''),
            placement: 'bottom',
            disableBeacon: true,
        },
        {
            target: '[class*="headbarItem"]:nth-child(3)',
            content: parse(t('guide.group') || ''),
            placement: 'bottom',
            disableBeacon: true,
        },
        {
            target: '[class*="headbarItem"]:nth-child(4)',
            content: parse(t('guide.darkMode') || ''),
            placement: 'bottom',
            disableBeacon: true,
        },
        {
            target: '[class*="headbarItem"]:nth-child(5)',
            content: parse(t('guide.language') || ''),
            placement: 'bottom',
            disableBeacon: true,
        },
        {
            target: '[class*="headbarItem"]:nth-child(6)',
            content: parse(t('guide.help') || ''),
            placement: 'bottom',
            disableBeacon: true,
        },
        {
            target: '[class*="regswitch"]',
            content: parse(t('guide.regionSwitch') || ''),
            placement: 'right',
            disableBeacon: true,
            onNext: () => setForceSubregionOpen(true),
            delay: 300,
        },
        {
            target: '[class*="subregionSwitch"]',
            content: parse(t('guide.subregionSwitch') || ''),
            placement: 'right',
            disableBeacon: true,
            onNext: () => setForceSubregionOpen(false),
            delay: 300,
        },
        {
            target: '.leaflet-marker-icon',
            content: parse(t('guide.pointSelect') || ''),
            placement: 'top',
            disableBeacon: true,
            onNext: () => {
                const p = WORLD_MARKS[0];
                if (p) setCurrentActivePoint(p);
                setForceDetailOpen(true);
            },
            delay: 300,
        },
        {
            target: '.leaflet-marker-icon',
            content: parse(t('guide.pointMark') || ''),
            placement: 'top',
            disableBeacon: true,
            onNext: () => {
                const p = useMarkerStore.getState().currentActivePoint;
                if (p) addPoint(p.id);
            },
        },
        {
            target: '[class*="detailContainer"]',
            content: parse(t('guide.detail') || ''),
            placement: 'left',
            disableBeacon: true,
        },
        {
            target: '[class*="pointIcon"]',
            content: parse(t('guide.pointIcon') || ''),
            placement: 'left',
            disableBeacon: true,
            onNext: () => setForceDetailOpen(false),
        },
    ], [
        t,
        setSidebarOpen,
        toggleMarkFilterExpanded,
        switchFilter,
        addPoint,
        setDrawerSnapIndex,
        setForceSubregionOpen,
        setCurrentActivePoint,
        setForceDetailOpen,
    ]);

    return steps;
};