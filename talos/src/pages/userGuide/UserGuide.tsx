import { GuideTooltip } from '@/pages/userGuide/tooltip/tooltip';
import Joyride, { StoreHelpers, CallBackProps, EVENTS, STATUS } from 'react-joyride';
import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from 'react';
import L from 'leaflet';
import { i18nInitPromise } from '@/locale';
import {
    useIsUserGuideOpen,
    useSetIsUserGuideOpen,
    useSetForceDetailOpen,
    useSetForceRegionSubOpen,
    useSetForceLayerSubOpen,
    useSetForceHeadbarExpanded,
    useSetDesktopDrawerSnapIndex,
    useSetMobileDrawerSnapIndex,
    useUiPrefsStore,
} from '@/store/uiPrefs';
import { beginGuideProgress, endGuideProgress } from '@/store/guideProgress';
import {
    useUserGuideStepCompleted,
    useSetUserGuideStepCompleted,
    useSetUserGuideStepCompletedBulk,
    useReplaceUserGuideStepCompleted,
} from '@/store/userGuide';
import { GuideSpotlight } from '@/pages/userGuide/spotlight/spotlight';
import { useDesktopGuideSteps } from '@/pages/userGuide/procedure/steps.desktop';
import { useMobileGuideSteps } from '@/pages/userGuide/procedure/steps.mobile';
import { DEFAULT_REGION } from '@/data/map';
import { useAppViewport, useDevice } from '@/platform/device';
import useRegion from '@/store/region';
import { GuideTasks } from './tasks';

interface UserGuideProps {
    map?: L.Map;
    visible?: boolean;
    onReady?: () => void;
}

const UserGuide = ({ map, visible = true, onReady }: UserGuideProps) => {
    const { isMobile } = useDevice();
    const { width: viewportWidth, height: viewportHeight } = useAppViewport();
    const initialGuideDeviceRef = useRef<'mobile' | 'desktop'>(isMobile ? 'mobile' : 'desktop');
    const isUserGuideOpen = useIsUserGuideOpen();
    const setIsUserGuideOpen = useSetIsUserGuideOpen();
    const setForceDetailOpen = useSetForceDetailOpen();
    const setForceRegionSubOpen = useSetForceRegionSubOpen();
    const setForceLayerSubOpen = useSetForceLayerSubOpen();
    const setForceHeadbarExpanded = useSetForceHeadbarExpanded();
    const setDesktopDrawerSnapIndex = useSetDesktopDrawerSnapIndex();
    const setMobileDrawerSnapIndex = useSetMobileDrawerSnapIndex();
    const stepCompleted = useUserGuideStepCompleted();
    const setUserGuideStepCompleted = useSetUserGuideStepCompleted();
    const setUserGuideStepCompletedBulk = useSetUserGuideStepCompletedBulk();
    const replaceUserGuideStepCompleted = useReplaceUserGuideStepCompleted();

    useEffect(() => {
        if (!isUserGuideOpen) return;
        const regionState = useRegion.getState();
        if (regionState.currentRegionKey !== DEFAULT_REGION) {
            regionState.setCurrentRegion(DEFAULT_REGION);
        }
    }, [isUserGuideOpen]);

    const [showIntro, setShowIntro] = useState(true);
    const guideEpoch = useRef(0);
    const isTransitioningRef = useRef(false);
    const runTasksRef = useRef<GuideTasks | null>(null);
    const actionTasksRef = useRef<GuideTasks | null>(null);
    const retryTasksRef = useRef<GuideTasks | null>(null);
    useLayoutEffect(() => {
        let owner: symbol | null = null;
        const invalidate = () => {
            ++guideEpoch.current;
            isTransitioningRef.current = false;
        };
        const update = () => {
            if (!showIntro && useUiPrefsStore.getState().isUserGuideOpen) {
                if (!owner) {
                    invalidate();
                    owner = beginGuideProgress();
                }
            } else if (owner) {
                invalidate();
                endGuideProgress(owner);
                owner = null;
            }
        };
        update();
        // Observe the actual close/reopen boundaries, including both in one batch.
        const unsubscribe = useUiPrefsStore.subscribe((state, previous) => {
            if (state.isUserGuideOpen !== previous.isUserGuideOpen) update();
        });
        return () => {
            invalidate();
            unsubscribe();
            if (owner) endGuideProgress(owner);
        };
    }, [isMobile, showIntro]);
    useLayoutEffect(() => {
        let tasks: GuideTasks | null = null;
        const update = () => {
            if (visible && useUiPrefsStore.getState().isUserGuideOpen) {
                tasks ??= new GuideTasks();
                runTasksRef.current = tasks;
            } else {
                tasks?.cancel();
                tasks = null;
                runTasksRef.current = null;
                isTransitioningRef.current = false;
            }
        };
        update();
        const unsubscribe = useUiPrefsStore.subscribe((state, previous) => {
            if (state.isUserGuideOpen !== previous.isUserGuideOpen) update();
        });
        return () => {
            tasks?.cancel();
            unsubscribe();
        };
    }, [isMobile, showIntro, visible]);
    // Welcome and closed Help never need a demonstration point from another region.
    const desktopSteps = useDesktopGuideSteps(map, visible && isUserGuideOpen && !showIntro && !isMobile);
    const mobileSteps = useMobileGuideSteps(map);
    const steps = isMobile ? mobileSteps : desktopSteps;
    // The first entry is a lightweight first-time hint. Detailed guidance starts
    // at the second entry after the user opens the help control.
    const introStep = steps[0];
    const detailSteps = useMemo(() => steps.slice(1), [steps]);
    const helpersRef = useRef<StoreHelpers | null>(null);
    const readyNotifiedRef = useRef(false);

    const notifyReady = useCallback(() => {
        if (readyNotifiedRef.current) return;
        readyNotifiedRef.current = true;
        onReady?.();
    }, [onReady]);

    // Force Joyride remount for TARGET_NOT_FOUND retries
    const [joyrideKey, setJoyrideKey] = useState(0);

    // Track retries per-step (by step id) when target is temporarily missing
    const targetNotFoundRetriesRef = useRef<Record<string, number>>({});

    const isElementInViewport = useCallback((el: HTMLElement) => {
        const rect = el.getBoundingClientRect();
        const vw = viewportWidth || 0;
        const vh = viewportHeight || 0;
        const isVisible = rect.width > 0 && rect.height > 0;
        const inView = rect.bottom > 0 && rect.right > 0 && rect.top < vh && rect.left < vw;
        return { rect, isVisible, inView, vw, vh };
    }, [viewportHeight, viewportWidth]);

    // Track i18n loading status
    const [i18nReady, setI18nReady] = useState(false);

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
    const deviceMatchesInitialGuide = initialGuideDeviceRef.current === (isMobile ? 'mobile' : 'desktop');

    const firstIncompleteIndex = useCallback((candidateSteps = detailSteps): number => {
        for (let i = 0; i < candidateSteps.length; i++) {
            const id = candidateSteps[i]?.id;
            if (!id) continue;
            if (stepCompleted[id] !== true) return i;
        }
        return 0;
    }, [detailSteps, stepCompleted]);

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

    // Initialize guide state without version-based resets. The intro is the only
    // automatically opened step; detailed guidance is always user-initiated via help.
    useEffect(() => {
        if (!i18nReady || !visible) return;

        // Ensure new steps appear as incomplete for existing users.
        const missingUpdates: Record<string, boolean> = {};
        for (const step of steps) {
            if (stepCompleted[step.id] === undefined) missingUpdates[step.id] = false;
        }
        if (Object.keys(missingUpdates).length > 0) {
            setUserGuideStepCompletedBulk(missingUpdates);
        }

        if (!didAutoOpenRef.current && deviceMatchesInitialGuide) {
            didAutoOpenRef.current = true;
            wasOpenRef.current = true; // Mark as already opened to prevent the second effect from resetting stepIndex
            const introPending = introStep ? stepCompleted[introStep.id] !== true : false;
            if (introPending) {
                setShowIntro(true);
                setStepIndex(0);
                setIsUserGuideOpen(true);
            } else {
                setShowIntro(false);
                setStepIndex(firstIncompleteIndex(detailSteps));
            }
        }
        notifyReady();
    }, [
        i18nReady,
        steps,
        stepCompleted,
        setIsUserGuideOpen,
        setUserGuideStepCompleted,
        setUserGuideStepCompletedBulk,
        introStep,
        firstIncompleteIndex,
        detailSteps,
        notifyReady,
        deviceMatchesInitialGuide,
        visible,
    ]);

    // Custom spotlight tracking
    const [currentTarget, setCurrentTarget] = useState<Element | null>(null);

    useEffect(() => {
        if (!visible || !isUserGuideOpen) {
            setCurrentTarget(null);
            if (!isUserGuideOpen) {
                setStepIndex(0);
                wasOpenRef.current = false;
            }
            return;
        }

        // When opening (including via the help button), show the intro only until
        // it has been acknowledged; help then resumes the detailed steps.
        if (!wasOpenRef.current) {
            wasOpenRef.current = true;
            const introPending = introStep ? stepCompleted[introStep.id] !== true : false;
            const nextShowIntro = introPending;
            const resumeAt = nextShowIntro ? 0 : firstIncompleteIndex(detailSteps);
            // The help click can open Joyride in the same frame as the headbar
            // event. Remount once layout has settled so Popper measures the
            // first detailed target instead of the stale intro target.
            const refreshAfterLayout = () => {
                const tasks = runTasksRef.current;
                tasks?.frame(() => {
                    tasks.frame(() => setJoyrideKey((key) => key + 1));
                });
            };
            if (showIntro !== nextShowIntro) {
                setShowIntro(nextShowIntro);
                setStepIndex(resumeAt);
                refreshAfterLayout();
                return;
            }
            if (stepIndex !== resumeAt) {
                setStepIndex(resumeAt);
                refreshAfterLayout();
                return;
            }
            refreshAfterLayout();
        }
        const visibleSteps = showIntro && introStep ? [introStep] : detailSteps;
        const step = visibleSteps[stepIndex];
        if (!step) {
            setCurrentTarget(null);
            return;
        }

        const runTasks = runTasksRef.current;
        if (!runTasks) return;
        const tasks = new GuideTasks(runTasks.signal);
        const updateTarget = () => {
            if (tasks.signal.aborted) return;
            const targetSel = step.target;
            let el: Element | null = null;
            if (typeof targetSel === 'string') {
                el = document.querySelector(targetSel);
            } else if (targetSel instanceof HTMLElement) {
                el = targetSel;
            }
            setCurrentTarget(el);

            // Joyride has disableScrolling=true; manually try to reveal the target.
            // Skip auto-scroll if the step has disableAutoScroll set, or if element is already in viewport
            const stepWithOptions = step as unknown as { disableAutoScroll?: boolean };
            if (el instanceof HTMLElement && !stepWithOptions.disableAutoScroll) {
                const view = isElementInViewport(el);
                // Only scroll if element is not fully in viewport
                if (!view.inView) {
                    tasks.frame(() => {
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
                const r = step.onBefore?.(tasks);
                if (r instanceof Promise) await r;
            } catch (err) {
                if (tasks.signal.aborted) return;
                console.error('Step onBefore failed', err);
            }
            updateTarget();
        };

        void runBefore();
        return () => tasks.cancel();
    }, [visible, isUserGuideOpen, stepIndex, showIntro, introStep, detailSteps, stepCompleted, firstIncompleteIndex, isElementInViewport]);

    const activeSteps = useMemo(
        () => (showIntro && introStep ? [introStep] : detailSteps),
        [showIntro, introStep, detailSteps],
    );

    const handleJoyrideCallback = useCallback(
        (data: CallBackProps) => {
            const { action, index, type, status } = data;
            const runTasks = runTasksRef.current;
            if (!runTasks || runTasks.signal.aborted) return;
            if ((type === EVENTS.STEP_AFTER || type === EVENTS.TARGET_NOT_FOUND) && index !== stepIndex) return;
            const epoch = guideEpoch.current;
            const isCurrent = () => guideEpoch.current === epoch && useUiPrefsStore.getState().isUserGuideOpen;

            if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
                // A one-step intro finishes independently of the detailed guide.
                // Acknowledging it must not mark the full guide as completed.
                if (showIntro && status === STATUS.FINISHED) {
                    if (introStep?.id) setUserGuideStepCompleted(introStep.id, true);
                    void introStep?.onNext?.(runTasks);
                    setShowIntro(false);
                    setIsUserGuideOpen(false);
                    setStepIndex(0);
                    isTransitioningRef.current = false;
                    document.body.style.overflow = '';
                    return;
                }
                if (showIntro && status === STATUS.SKIPPED) {
                    void introStep?.onNext?.(runTasks);
                }
                // FINISHED / SKIPPED: treat as fully completed so it won't auto-run again.
                // Reset transition state
                isTransitioningRef.current = false;
                
                replaceUserGuideStepCompleted(buildAllStepsCompletionMap(true));
                setForceDetailOpen(false);
                setForceRegionSubOpen(false);
                setForceLayerSubOpen(false);
                setForceHeadbarExpanded(null);
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
                retryTasksRef.current?.cancel();
                if (action === 'next') {
                    if (isTransitioningRef.current) return;
                    actionTasksRef.current?.cancel();
                    const tasks = new GuideTasks(runTasks.signal);
                    actionTasksRef.current = tasks;
                    // Mark starts of transition
                    isTransitioningRef.current = true;

                    // Mark current step as completed
                    const currentStep = activeSteps[index];
                    if (!currentStep) { isTransitioningRef.current = false; tasks.cancel(); return; }
                    setUserGuideStepCompleted(currentStep.id, true);

                    if (currentStep.intro) {
                        void currentStep.onNext?.(tasks);
                        setShowIntro(false);
                        setIsUserGuideOpen(false);
                        setStepIndex(0);
                        isTransitioningRef.current = false;
                        return;
                    }
                    
                    const proceed = () => {
                         if (!isCurrent() || tasks.signal.aborted) return;
                         if (currentStep.delay) {
                            tasks.after(() => {
                                if (!isCurrent()) return;
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
                        const result = currentStep.onNext(tasks);
                        if (result instanceof Promise) {
                            void result.then(proceed).catch((err) => {
                                if (!isCurrent() || tasks.signal.aborted) return;
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
                    actionTasksRef.current?.cancel();
                    isTransitioningRef.current = false;
                    targetNotFoundRetriesRef.current = {};
                    setStepIndex(index - 1);
                }
            } else if (type === EVENTS.TARGET_NOT_FOUND) {
                if (isTransitioningRef.current) return;
                retryTasksRef.current?.cancel();
                const tasks = new GuideTasks(runTasks.signal);
                retryTasksRef.current = tasks;
                const step = activeSteps[index];
                const stepId = step?.id ?? String(index);
                const prev = targetNotFoundRetriesRef.current[stepId] ?? 0;
                const next = prev + 1;
                targetNotFoundRetriesRef.current[stepId] = next;

                const target = step?.target;
                const selector = typeof target === 'string' ? target : null;
                const nodeList = selector ? document.querySelectorAll(selector) : null;
                const el = nodeList && nodeList.length > 0 ? nodeList[0] as HTMLElement : null;
                const MAX_RETRIES = 8;

                // Case 1: selector完全找不到，才重試/跳步
                if (!el) {
                    if (next <= MAX_RETRIES) {
                        const waitMs = 120 + next * 120;
                        try {
                            const r = step?.onBefore?.(tasks);
                            if (r instanceof Promise) {
                                void r.then(() => {
                                    tasks.after(() => setJoyrideKey((k) => k + 1), waitMs);
                                }, (error: unknown) => {
                                    if (tasks.signal.aborted) return;
                                    console.error('Step retry failed', error);
                                    tasks.after(() => setJoyrideKey((k) => k + 1), waitMs);
                                });
                            } else {
                                tasks.after(() => setJoyrideKey((k) => k + 1), waitMs);
                            }
                        } catch {
                            tasks.after(() => setJoyrideKey((k) => k + 1), waitMs);
                        }
                        return;
                    }
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
                    tasks.after(() => setJoyrideKey((k) => k + 1), 250);
                    return;
                }

                // Case 3: selector有元素且已在視窗，直接觸發 Joyride update（不 remount，不跳步）
                tasks.after(() => setJoyrideKey((k) => k + 1));
            }
        },
        [
            activeSteps,
            stepIndex,
            showIntro,
            introStep,
            isElementInViewport,
            setForceDetailOpen,
            setForceRegionSubOpen,
            setForceLayerSubOpen,
            setForceHeadbarExpanded,
            setDesktopDrawerSnapIndex,
            setMobileDrawerSnapIndex,
            setIsUserGuideOpen,
            setShowIntro,
            setUserGuideStepCompleted,
            replaceUserGuideStepCompleted,
            buildAllStepsCompletionMap,
        ],
    );

    return (
        <>
            <GuideSpotlight
                active={isUserGuideOpen && visible}
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
                steps={activeSteps}
                run={isUserGuideOpen && i18nReady && visible}
                stepIndex={stepIndex}
                continuous={true}
                debug={false}
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
