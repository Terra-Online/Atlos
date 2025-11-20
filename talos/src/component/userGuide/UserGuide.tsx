import { GuideTooltip } from '@/component/userGuide/tooltip/tooltip';
import Joyride, { StoreHelpers, CallBackProps, EVENTS, STATUS } from 'react-joyride';
import { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import {
    useIsUserGuideOpen,
    useSetIsUserGuideOpen,
    useSetForceDetailOpen,
    useSetForceSubregionOpen,
    useSetDrawerSnapIndex,
} from '@/store/uiPrefs';
import { GuideSpotlight } from './spotlight/spotlight';
import { useGuideSteps } from './procedure/steps';

interface UserGuideProps {
    map?: L.Map;
}

const UserGuide = ({ map }: UserGuideProps) => {
    const isUserGuideOpen = useIsUserGuideOpen();
    const setIsUserGuideOpen = useSetIsUserGuideOpen();
    const setForceDetailOpen = useSetForceDetailOpen();
    const setForceSubregionOpen = useSetForceSubregionOpen();
    const setDrawerSnapIndex = useSetDrawerSnapIndex();

    const steps = useGuideSteps(map);
    const helpersRef = useRef<StoreHelpers | null>(null);

    // Controlled step index
    const [stepIndex, setStepIndex] = useState(0);

    // Custom spotlight tracking
    const [currentTarget, setCurrentTarget] = useState<Element | null>(null);

    useEffect(() => {
        if (!isUserGuideOpen) {
            setCurrentTarget(null);
            setStepIndex(0);
            return;
        }
        const step = steps[stepIndex];
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
    }, [isUserGuideOpen, stepIndex, steps]);

    const handleJoyrideCallback = useCallback(
        (data: CallBackProps) => {
            const { action, index, type, status } = data;

            if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
                setForceDetailOpen(false);
                setForceSubregionOpen(false);
                setDrawerSnapIndex(null);
                setIsUserGuideOpen(false);
                setStepIndex(0);
                return;
            }

            if (type === EVENTS.STEP_AFTER) {
                if (action === 'next') {
                    const currentStep = steps[index];
                    if (currentStep && currentStep.onNext) {
                        const result = currentStep.onNext();
                        if (result instanceof Promise) {
                            void result.then(() => {
                                if (currentStep.delay) {
                                    setTimeout(() => {
                                        setStepIndex(index + 1);
                                    }, currentStep.delay);
                                } else {
                                    setStepIndex(index + 1);
                                }
                            }).catch((err) => {
                                console.error('Step action failed', err);
                                setStepIndex(index + 1);
                            });
                        } else {
                            if (currentStep.delay) {
                                setTimeout(() => {
                                    setStepIndex(index + 1);
                                }, currentStep.delay);
                            } else {
                                setStepIndex(index + 1);
                            }
                        }
                    } else {
                        setStepIndex(index + 1);
                    }
                } else if (action === 'prev') {
                    setStepIndex(index - 1);
                }
            } else if (type === EVENTS.TARGET_NOT_FOUND) {
                // If target not found, we might want to retry or skip.
                // For now, let's skip to avoid getting stuck.
                // But if we are waiting for an element to appear, this might be premature.
                // However, Joyride usually retries a bit.
                console.warn('Target not found for step', index);
                setStepIndex(index + 1);
            }
        },
        [
            steps,
            setForceDetailOpen,
            setForceSubregionOpen,
            setDrawerSnapIndex,
            setIsUserGuideOpen,
        ],
    );

    return (
        <>
            <GuideSpotlight
                active={isUserGuideOpen}
                getCurrentTarget={() => currentTarget}
                padding={10}
                onAdvance={() => helpersRef.current?.next()}
            />
            <Joyride
                steps={steps}
                run={isUserGuideOpen}
                stepIndex={stepIndex}
                continuous={true}
                debug={true}
                tooltipComponent={GuideTooltip}
                callback={handleJoyrideCallback}
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
