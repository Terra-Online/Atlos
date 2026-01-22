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
    useSetDesktopDrawerSnapIndex,
    useSetMobileDrawerSnapIndex,
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
import { useDesktopGuideSteps } from './procedure/steps.desktop';
import { useMobileGuideSteps } from './procedure/steps.mobile';
import { useDevice } from '@/utils/device';

const CURRENT_GUIDE_VERSION = '1.0.0';

interface UserGuideProps {
    map?: L.Map;
}

const UserGuide = ({ map }: UserGuideProps) => {
    const { isMobile } = useDevice();
    const isUserGuideOpen = useIsUserGuideOpen();
    const setIsUserGuideOpen = useSetIsUserGuideOpen();
    const setForceDetailOpen = useSetForceDetailOpen();
    const setForceRegionSubOpen = useSetForceRegionSubOpen();
    const setForceLayerSubOpen = useSetForceLayerSubOpen();
    const setDesktopDrawerSnapIndex = useSetDesktopDrawerSnapIndex();
    const setMobileDrawerSnapIndex = useSetMobileDrawerSnapIndex();
    const userGuideVersion = useUserGuideVersion();
    const setUserGuideVersion = useSetUserGuideVersion();
    const stepCompleted = useUserGuideStepCompleted();
    const setUserGuideStepCompleted = useSetUserGuideStepCompleted();
    const setUserGuideStepCompletedBulk = useSetUserGuideStepCompletedBulk();
    const replaceUserGuideStepCompleted = useReplaceUserGuideStepCompleted();

    // Load steps based on device type
    const desktopSteps = useDesktopGuideSteps(map);
    const mobileSteps = useMobileGuideSteps(map);
    const steps = isMobile ? mobileSteps : desktopSteps;
    const helpersRef = useRef<StoreHelpers | null>(null);

    // Force Joyride remount for TARGET_NOT_FOUND retries
    const [joyrideKey, setJoyrideKey] = useState(0);

    // Track retries per-step (by step id) when target is temporarily missing
    const targetNotFoundRetriesRef = useRef<Record<string, number>>({});

    const describeStepTarget = useCallback((step: unknown) => {
        const s = step as { id?: string; target?: unknown } | undefined;
        const id = s?.id ?? '(no-id)';
        const target = s?.target;
        if (typeof target === 'string') {
            return { id, targetType: 'selector', target: target };
        }
        if (target instanceof HTMLElement) {
            return { id, targetType: 'element', target: target.tagName.toLowerCase() };
        }
        return { id, targetType: typeof target, target: String(target) };
    }, []);

    const isElementInViewport = useCallback((el: HTMLElement) => {
        const rect = el.getBoundingClientRect();
        const vw = window.innerWidth || 0;
        const vh = window.innerHeight || 0;
        const isVisible = rect.width > 0 && rect.height > 0;
        const inView = rect.bottom > 0 && rect.right > 0 && rect.top < vh && rect.left < vw;
        return { rect, isVisible, inView, vw, vh };
    }, []);

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

        {
            const info = describeStepTarget(step);
            console.debug('[UserGuide] stepIndex change', {
                stepIndex,
                stepId: info.id,
                targetType: info.targetType,
                target: info.target,
            });
        }

        let cancelled = false;
        const updateTarget = () => {
            if (cancelled) return;
            const targetSel = step.target;
            let el: Element | null = null;
            if (typeof targetSel === 'string') {
                el = document.querySelector(targetSel);
            } else if (targetSel instanceof HTMLElement) {
                el = targetSel;
            }
            setCurrentTarget(el);

            if (!el) {
                const info = describeStepTarget(step);
                const matchCount = typeof targetSel === 'string' ? document.querySelectorAll(targetSel).length : 0;
                console.debug('[UserGuide] target resolved: NOT FOUND', {
                    stepIndex,
                    stepId: info.id,
                    targetType: info.targetType,
                    target: info.target,
                    matchCount,
                });
            } else if (el instanceof HTMLElement) {
                const info = describeStepTarget(step);
                const view = isElementInViewport(el);
                console.debug('[UserGuide] target resolved: FOUND', {
                    stepIndex,
                    stepId: info.id,
                    targetType: info.targetType,
                    target: info.target,
                    inView: view.inView,
                    isVisible: view.isVisible,
                    rect: {
                        top: Math.round(view.rect.top),
                        left: Math.round(view.rect.left),
                        width: Math.round(view.rect.width),
                        height: Math.round(view.rect.height),
                    },
                    viewport: { w: view.vw, h: view.vh },
                });
            }

            // Joyride has disableScrolling=true; manually try to reveal the target.
            // Skip auto-scroll if the step has disableAutoScroll set, or if element is already in viewport
            const stepWithOptions = step as unknown as { disableAutoScroll?: boolean };
            if (el instanceof HTMLElement && !stepWithOptions.disableAutoScroll) {
                const view = isElementInViewport(el);
                // Only scroll if element is not fully in viewport
                if (!view.inView) {
                    requestAnimationFrame(() => {
                        try {
                            el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
                        } catch {
                            // no-op
                        }
                    });
                }
            }
        };

        const runBefore = async () => {
            try {
                const anyStep = step as unknown as { onBefore?: () => void | Promise<void> };
                const r = anyStep.onBefore?.();
                if (r instanceof Promise) await r;
            } catch (err) {
                console.error('Step onBefore failed', err);
            }
            updateTarget();
        };

        void runBefore();
        return () => {
            cancelled = true;
        };
    }, [isUserGuideOpen, stepIndex, steps, firstIncompleteIndex, describeStepTarget, isElementInViewport]);

    const handleJoyrideCallback = useCallback(
        (data: CallBackProps) => {
            const { action, index, type, status } = data;

            if (type === EVENTS.STEP_AFTER || type === EVENTS.TARGET_NOT_FOUND) {
                const step = steps[index] as unknown;
                const info = describeStepTarget(step);
                console.debug('[UserGuide] joyride event', {
                    type,
                    action,
                    index,
                    status,
                    stepId: info.id,
                    targetType: info.targetType,
                    target: info.target,
                });
            }

            if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
                // FINISHED / SKIPPED: treat as fully completed so it won't auto-run again.
                // Reset transition state
                isTransitioningRef.current = false;
                
                replaceUserGuideStepCompleted(buildAllStepsCompletionMap(true));
                setForceDetailOpen(false);
                setForceRegionSubOpen(false);
                setForceLayerSubOpen(false);
                setDesktopDrawerSnapIndex(null);
                setMobileDrawerSnapIndex(null);
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
                                targetNotFoundRetriesRef.current = {};
                                setStepIndex(index + 1);
                                isTransitioningRef.current = false;
                            }, currentStep.delay);
                        } else {
                            targetNotFoundRetriesRef.current = {};
                            setStepIndex(index + 1);
                            isTransitioningRef.current = false;
                        }
                    };

                    if (currentStep && currentStep.onNext) {
                        console.debug('[UserGuide] onNext()', { stepId: currentStep.id, index });
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
                    targetNotFoundRetriesRef.current = {};
                    setStepIndex(index - 1);
                }
            } else if (type === EVENTS.TARGET_NOT_FOUND) {
                const step = steps[index] as unknown as { id?: string; onBefore?: () => void | Promise<void>; target?: unknown } | undefined;
                const stepId = step?.id ?? String(index);
                const prev = targetNotFoundRetriesRef.current[stepId] ?? 0;
                const next = prev + 1;
                targetNotFoundRetriesRef.current[stepId] = next;

                const target = step?.target;
                const selector = typeof target === 'string' ? target : null;
                const nodeList = selector ? document.querySelectorAll(selector) : null;
                const matchCount = nodeList ? nodeList.length : 0;
                const el = nodeList && nodeList.length > 0 ? nodeList[0] as HTMLElement : null;
                const MAX_RETRIES = 8;

                console.warn('[UserGuide] TARGET_NOT_FOUND', {
                    stepId,
                    index,
                    retry: next,
                    selector,
                    matchCount,
                });

                // Case 1: selector完全找不到，才重試/跳步
                if (!el) {
                    if (next <= MAX_RETRIES) {
                        const waitMs = 120 + next * 120;
                        console.warn(`Target not found for step ${stepId} (retry ${next}/${MAX_RETRIES}, wait ${waitMs}ms)`);
                        try {
                            const r = step?.onBefore?.();
                            if (r instanceof Promise) {
                                void r.finally(() => {
                                    setTimeout(() => setJoyrideKey((k) => k + 1), waitMs);
                                });
                            } else {
                                setTimeout(() => setJoyrideKey((k) => k + 1), waitMs);
                            }
                        } catch {
                            setTimeout(() => setJoyrideKey((k) => k + 1), waitMs);
                        }
                        return;
                    }
                    console.warn(`Target still not found for step ${stepId}; skipping.`);
                    delete targetNotFoundRetriesRef.current[stepId];
                    setStepIndex(index + 1);
                    return;
                }

                // Case 2: selector有元素但不在視窗，先 scrollIntoView，等它進入視窗再繼續
                const view = el instanceof HTMLElement ? isElementInViewport(el) : null;
                if (el instanceof HTMLElement && view && !view.inView) {
                    try {
                        el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
                    } catch (_err) {
                        // ignore scroll errors
                    }
                    // 等待元素進入視窗再觸發 Joyride update，不 remount，不跳步
                    setTimeout(() => setJoyrideKey((k) => k + 1), 250);
                    return;
                }

                // Case 3: selector有元素且已在視窗，直接觸發 Joyride update（不 remount，不跳步）
                setTimeout(() => setJoyrideKey((k) => k + 1), 0);
            }
        },
        [
            steps,
            describeStepTarget,
            isElementInViewport,
            setForceDetailOpen,
            setForceRegionSubOpen,
            setForceLayerSubOpen,
            setDesktopDrawerSnapIndex,
            setMobileDrawerSnapIndex,
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
                key={joyrideKey}
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
