import { UserGuideTooltip } from '@/component/userGuide/tooltip/UserGuideTooltip.tsx';
import Joyride, { Step, StoreHelpers, CallBackProps, EVENTS } from 'react-joyride';
import { useTranslateUI, useLocale } from '@/locale';
import parse from 'html-react-parser';
import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useIsUserGuideOpen } from '@/store/uiPrefs';
import { useGuideActions } from './useGuideActions';
import { UserGuideSpotlight } from './spotlight/UserGuideSpotlight';

const UserGuide = () => {
    const t = useTranslateUI();
    const locale = useLocale();
    const isUserGuideOpen = useIsUserGuideOpen();
    const { handleJoyrideCallback } = useGuideActions();
    const helpersRef = useRef<StoreHelpers | null>(null);
    const steps = useMemo<Array<Step>>(() => [
        {
            target: '[class*="sidebarToggle"]',
            content: parse(t('guide.sidebarToggle') || ''),
            placement: 'right',
            disableBeacon: true,
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
        },
        {
            target: '[class*="markItem"]',
            content: parse(t('guide.selectorComplete') || ''),
            placement: 'right',
            disableBeacon: true,
        },
        {
            target: '[class*="triggerDrawerHandle"]',
            content: parse(t('guide.triggerHandle') || ''),
            placement: 'top',
            disableBeacon: true,
        },
        {
            target: '[class*="triggerButton"]',
            content: parse(t('guide.triggerSwitch') || ''),
            placement: 'top',
            disableBeacon: true,
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
        },
        {
            target: '[class*="subregionSwitch"]',
            content: parse(t('guide.subregionSwitch') || ''),
            placement: 'right',
            disableBeacon: true,
        },
        {
            target: '.leaflet-marker-icon',
            content: parse(t('guide.pointSelect') || ''),
            placement: 'top',
            disableBeacon: true,
        },
        {
            target: '.leaflet-marker-icon',
            content: parse(t('guide.pointMark') || ''),
            placement: 'top',
            disableBeacon: true,
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
        },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    ], [locale]);

    // Custom spotlight tracking
    const [currentTarget, setCurrentTarget] = useState<Element | null>(null);
    const [currentIndex, setCurrentIndex] = useState<number>(0);

    useEffect(() => {
        if (!isUserGuideOpen) {
            setCurrentTarget(null);
            return;
        }
        const step = steps[currentIndex];
        if (!step) {
            setCurrentTarget(null);
            return;
        }
        const targetSel = step.target;
        let el: Element | null = null;
        if (typeof targetSel === 'string') {
            el = document.querySelector(targetSel);
        } else if (targetSel instanceof HTMLElement) {
            el = targetSel;
        }
        setCurrentTarget(el);
    }, [isUserGuideOpen, currentIndex, steps]);


    const wrappedCallback = useCallback((data: CallBackProps) => {
        handleJoyrideCallback(data);
        if (
            data.type === EVENTS.STEP_AFTER ||
            data.type === EVENTS.STEP_BEFORE ||
            data.type === EVENTS.TARGET_NOT_FOUND
        ) {
            if (typeof data.index === 'number') setCurrentIndex(data.index);
        }
    }, [handleJoyrideCallback]);

    return (
        <>
            <UserGuideSpotlight
                active={isUserGuideOpen}
                getCurrentTarget={() => currentTarget}
                padding={10}
                onAdvance={() => helpersRef.current?.next()}
            />
            <Joyride
                steps={steps}
                run={isUserGuideOpen}
                continuous={true}
                debug={true}
                tooltipComponent={UserGuideTooltip}
                callback={wrappedCallback}
                getHelpers={(helpers) => {
                    helpersRef.current = helpers;
                }}
                disableOverlay
                disableOverlayClose={true}
                disableScrolling={true}
                spotlightPadding={10}
                floaterProps={{
                    disableAnimation: false,
                }}
                styles={{
                    options: {
                        arrowColor: 'transparent',
                        zIndex: 100000,
                    },
                }}
            />
        </>
    );
};

export default UserGuide;
