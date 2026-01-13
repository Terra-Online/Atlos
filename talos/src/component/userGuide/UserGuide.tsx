import { GuideTooltip } from '@/component/userGuide/tooltip/tooltip';
import Joyride, { StoreHelpers, CallBackProps, EVENTS, STATUS } from 'react-joyride';
import { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import { i18nInitPromise } from '@/locale';
import {
    useIsUserGuideOpen,
    useSetIsUserGuideOpen,
    useSetForceDetailOpen,
    useSetForceRegionSubOpen,
    useSetForceLayerSubOpen,
    useSetDrawerSnapIndex,
} from '@/store/uiPrefs';
import {
    useUserGuideVersion,
    useSetUserGuideVersion,
    useUserGuideStepCompleted,
    useSetUserGuideStepCompleted,
    useSetUserGuideStepCompletedBulk,
    useReplaceUserGuideStepCompleted,
} from '@/store/userGuide';
import { GuideSpotlight } from './spotlight/spotlight';
import { useGuideSteps, type GuideStep } from './procedure/steps';

const CURRENT_GUIDE_VERSION = '1.0.0';

interface UserGuideProps {
    map?: L.Map;
}

const UserGuide = ({ map }: UserGuideProps) => {
    const isUserGuideOpen = useIsUserGuideOpen();
    const setIsUserGuideOpen = useSetIsUserGuideOpen();
    const setForceDetailOpen = useSetForceDetailOpen();
    const setForceRegionSubOpen = useSetForceRegionSubOpen();
    const setForceLayerSubOpen = useSetForceLayerSubOpen();
    const setDrawerSnapIndex = useSetDrawerSnapIndex();
    const userGuideVersion = useUserGuideVersion();
    const setUserGuideVersion = useSetUserGuideVersion();
    const stepCompleted = useUserGuideStepCompleted();
    const setUserGuideStepCompleted = useSetUserGuideStepCompleted();
    const setUserGuideStepCompletedBulk = useSetUserGuideStepCompletedBulk();
    const replaceUserGuideStepCompleted = useReplaceUserGuideStepCompleted();

    const steps: GuideStep[] = useGuideSteps(map);
    const helpersRef = useRef<StoreHelpers | null>(null);

    // Track i18n loading status
    const [i18nReady, setI18nReady] = useState(false);

    // Track transition state to prevent rapid clicks/race conditions
    const isTransitioningRef = useRef(false);

    // Wait for i18n to be ready before starting guide
    useEffect(() => {
        i18nInitPromise.then(() => {
            setI18nReady(true);
        }).catch((err) => {
            console.error('Failed to load i18n:', err);
            setI18nReady(true); // Still allow guide to proceed
        });
    }, []);

    // Controlled step index
    const [stepIndex, setStepIndex] = useState(0);

    const didAutoOpenRef = useRef(false);
    const wasOpenRef = useRef(false);

    const firstIncompleteIndex = useCallback((): number => {
        for (let i = 0; i < steps.length; i++) {
            const id = steps[i]?.id;
            if (!id) continue;
            if (stepCompleted[id] !== true) return i;
        }
        return 0;
    }, [steps, stepCompleted]);

    const buildAllStepsCompletionMap = useCallback(
        (completed: boolean): Record<string, boolean> => {
            const map: Record<string, boolean> = {};
            for (const step of steps) {
                map[step.id] = completed;
            }
            return map;
        },
        [steps],
    );

    // Initialize/upgrade guide state.
    // - On version bump: reset all steps to incomplete and open guide.
    // - Otherwise: ensure missing step keys default to incomplete.
    // - Auto-open guide until all steps are completed.
    useEffect(() => {
        if (!i18nReady) return;

        if (userGuideVersion !== CURRENT_GUIDE_VERSION) {
            // Atomic reset to avoid race that can cause STEP-0 to be treated as completed.
            replaceUserGuideStepCompleted(buildAllStepsCompletionMap(false));
            setUserGuideVersion(CURRENT_GUIDE_VERSION);
            didAutoOpenRef.current = true;
            wasOpenRef.current = true; // Mark as already opened
            setStepIndex(0);
            setIsUserGuideOpen(true);
            return;
        }

        // Ensure new steps appear as incomplete for existing users.
        const missingUpdates: Record<string, boolean> = {};
        for (const step of steps) {
            if (stepCompleted[step.id] === undefined) missingUpdates[step.id] = false;
        }
        if (Object.keys(missingUpdates).length > 0) {
            setUserGuideStepCompletedBulk(missingUpdates);
        }

        const hasIncomplete = steps.some((s) => stepCompleted[s.id] !== true);
        if (!didAutoOpenRef.current && hasIncomplete) {
            didAutoOpenRef.current = true;
            wasOpenRef.current = true; // Mark as already opened to prevent the second effect from resetting stepIndex
            const resumeIndex = firstIncompleteIndex();
            setStepIndex(resumeIndex);
            setIsUserGuideOpen(true);
        }
    }, [
        i18nReady,
        userGuideVersion,
        steps,
        stepCompleted,
        setIsUserGuideOpen,
        setUserGuideVersion,
        setUserGuideStepCompleted,
        setUserGuideStepCompletedBulk,
        replaceUserGuideStepCompleted,
        buildAllStepsCompletionMap,
        firstIncompleteIndex,
    ]);

    // Custom spotlight tracking
    const [currentTarget, setCurrentTarget] = useState<Element | null>(null);

    useEffect(() => {
        if (!isUserGuideOpen) {
            setCurrentTarget(null);
            setStepIndex(0);
            wasOpenRef.current = false;
            return;
        }

        // When opening (including via the help button), resume from the first incomplete step.
        if (!wasOpenRef.current) {
            wasOpenRef.current = true;
            const resumeAt = firstIncompleteIndex();
            if (stepIndex !== resumeAt) {
                setStepIndex(resumeAt);
                return;
            }
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
    }, [isUserGuideOpen, stepIndex, steps, firstIncompleteIndex]);

    const handleJoyrideCallback = useCallback(
        (data: CallBackProps) => {
            const { action, index, type, status } = data;

            if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
                // FINISHED / SKIPPED: treat as fully completed so it won't auto-run again.
                // Reset transition state
                isTransitioningRef.current = false;
                
                replaceUserGuideStepCompleted(buildAllStepsCompletionMap(true));
                setForceDetailOpen(false);
                setForceRegionSubOpen(false);
                setForceLayerSubOpen(false);
                setDrawerSnapIndex(null);
                setIsUserGuideOpen(false);
                setStepIndex(0);
                
                // FORCE CLEANUP: React Joyride might leave body overflow hidden if unmounted abruptly
                // especially when disableScrolling is true.
                document.body.style.overflow = '';
                return;
            }

            if (type === EVENTS.STEP_AFTER) {
                if (action === 'next') {
                    // Mark starts of transition
                    isTransitioningRef.current = true;

                    // Mark current step as completed
                    const currentStep = steps[index];
                    setUserGuideStepCompleted(currentStep.id, true);
                    
                    const proceed = () => {
                         if (currentStep.delay) {
                            setTimeout(() => {
                                setStepIndex(index + 1);
                                isTransitioningRef.current = false;
                            }, currentStep.delay);
                        } else {
                            setStepIndex(index + 1);
                            isTransitioningRef.current = false;
                        }
                    };

                    if (currentStep && currentStep.onNext) {
                        const result = currentStep.onNext();
                        if (result instanceof Promise) {
                            void result.then(proceed).catch((err) => {
                                console.error('Step action failed', err);
                                proceed();
                            });
                        } else {
                            proceed();
                        }
                    } else {
                        proceed();
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
            setForceRegionSubOpen,
            setForceLayerSubOpen,
            setDrawerSnapIndex,
            setIsUserGuideOpen,
            setUserGuideStepCompleted,
            replaceUserGuideStepCompleted,
            buildAllStepsCompletionMap,
        ],
    );

    return (
        <>
            <GuideSpotlight
                active={isUserGuideOpen}
                getCurrentTarget={() => currentTarget}
                padding={10}
                onAdvance={() => {
                     // Block advance if already transitioning
                     if (isTransitioningRef.current) return;
                     helpersRef.current?.next();
                }}
            />
            <Joyride
                steps={steps}
                run={isUserGuideOpen && i18nReady}
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
