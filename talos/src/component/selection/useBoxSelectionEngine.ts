import { useEffect, useRef, useState, type RefObject } from 'react';

type Point = { x: number; y: number };
type SelectionBox = { startX: number; startY: number; endX: number; endY: number };
export type BoxSelectionContentRect = { left: number; right: number; top: number; bottom: number };

export interface BoxSelectionTarget {
    keys: string[];
    rect: BoxSelectionContentRect;
    element: HTMLElement;
    mode?: 'toggle' | 'activate';
}

interface ScrollGeometry {
    clientLeft: number;
    clientTop: number;
    clientBottom: number;
    offsetLeft: number;
    offsetTop: number;
    viewportTop: number;
    viewportBottom: number;
}

interface CollectTargetsContext {
    container: HTMLElement;
    scrollContainer: HTMLElement;
    elementToContentRect: (element: Element) => BoxSelectionContentRect;
}

interface BoxSelectionEngineOptions<TContainer extends HTMLElement> {
    containerRef: RefObject<TContainer | null>;
    selectionBoxRef: RefObject<HTMLDivElement | null>;
    getInitialKeys: () => Iterable<string>;
    onChange: (keys: string[]) => void;
    collectTargets: (context: CollectTargetsContext) => BoxSelectionTarget[];
    canStart: (target: HTMLElement) => boolean;
    syncTarget: (target: BoxSelectionTarget, active: boolean) => void;
    immediate?: boolean;
    selectionBoxCoordinates?: 'container' | 'auto';
}

const DRAG_START_THRESHOLD_SQ = 24;
const AUTO_SCROLL_EDGE_SIZE = 32;
const AUTO_SCROLL_MIN_SPEED = 120;
const AUTO_SCROLL_MAX_SPEED = 2200;
const AUTO_SCROLL_ACCELERATION = 16;
const UPDATE_BATCH_SIZE = 5;

const isIntersecting = (rect: BoxSelectionContentRect, box: BoxSelectionContentRect) => !(
    rect.left > box.right
    || rect.right < box.left
    || rect.top > box.bottom
    || rect.bottom < box.top
);

export const useBoxSelectionEngine = <TContainer extends HTMLElement>({
    containerRef,
    selectionBoxRef,
    getInitialKeys,
    onChange,
    collectTargets,
    canStart,
    syncTarget,
    immediate = false,
    selectionBoxCoordinates = 'container',
}: BoxSelectionEngineOptions<TContainer>) => {
    const [isSelecting, setIsSelecting] = useState(false);
    const optionsRef = useRef({ getInitialKeys, onChange, collectTargets, canStart, syncTarget });
    optionsRef.current = { getInitialKeys, onChange, collectTargets, canStart, syncTarget };

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        let startPoint: Point | null = null;
        let lastClientPoint: Point | null = null;
        let activeScrollContainer: HTMLElement | null = null;
        let activeScrollGeometry: ScrollGeometry | null = null;
        let activePointerId: number | null = null;
        let isDragging = false;
        let initialKeys: string[] = [];
        let currentOptimisticSet = new Set<string>();
        let targets: BoxSelectionTarget[] = [];
        let lastChangeSignature = '';
        let pendingKeys: Set<string> | null = null;
        let pendingChangeCount = 0;
        let previousBodyUserSelect = '';
        let previousScrollBehavior = '';
        let hasPointerCapture = false;
        let autoScrollRaf: number | null = null;
        let autoScrollLastTimestamp = 0;
        let selectionUpdateRaf: number | null = null;
        let pendingSelectionClientPoint: Point | null = null;
        let pendingSelectionScrollContainer: HTMLElement | null = null;
        let activateTargets: BoxSelectionTarget[] = [];
        let toggleTargets: BoxSelectionTarget[] = [];

        const getScrollContainer = () => (
            container.querySelector<HTMLElement>('[data-sidescroll="true"]') ?? container
        );

        const measureScrollGeometry = (scrollContainer: HTMLElement): ScrollGeometry => {
            const scrollRect = scrollContainer.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            const offsetLeft = scrollRect.left - containerRect.left;
            const offsetTop = scrollRect.top - containerRect.top;
            return {
                clientLeft: scrollRect.left,
                clientTop: scrollRect.top,
                clientBottom: scrollRect.bottom,
                offsetLeft,
                offsetTop,
                viewportTop: offsetTop,
                viewportBottom: offsetTop + scrollRect.height,
            };
        };

        const getScrollGeometry = (scrollContainer: HTMLElement) => (
            activeScrollGeometry ?? measureScrollGeometry(scrollContainer)
        );

        const toContentPoint = (scrollContainer: HTMLElement, clientPoint: Point): Point => {
            const geometry = getScrollGeometry(scrollContainer);
            return {
                x: clientPoint.x - geometry.clientLeft + scrollContainer.scrollLeft,
                y: clientPoint.y - geometry.clientTop + scrollContainer.scrollTop,
            };
        };

        const selectionBoxUsesContentCoordinates = (scrollContainer: HTMLElement) => (
            selectionBoxCoordinates === 'auto'
            && selectionBoxRef.current?.offsetParent === scrollContainer
        );

        const contentToContainerPoint = (scrollContainer: HTMLElement, point: Point): Point => {
            if (selectionBoxUsesContentCoordinates(scrollContainer)) return point;
            const geometry = getScrollGeometry(scrollContainer);
            return {
                x: point.x - scrollContainer.scrollLeft + geometry.offsetLeft,
                y: point.y - scrollContainer.scrollTop + geometry.offsetTop,
            };
        };

        const elementToContentRect = (
            scrollContainer: HTMLElement,
            element: Element,
        ): BoxSelectionContentRect => {
            const rect = element.getBoundingClientRect();
            const geometry = getScrollGeometry(scrollContainer);
            return {
                left: rect.left - geometry.clientLeft + scrollContainer.scrollLeft,
                right: rect.right - geometry.clientLeft + scrollContainer.scrollLeft,
                top: rect.top - geometry.clientTop + scrollContainer.scrollTop,
                bottom: rect.bottom - geometry.clientTop + scrollContainer.scrollTop,
            };
        };

        const getAutoScrollVelocity = (scrollContainer: HTMLElement, clientY: number) => {
            const geometry = getScrollGeometry(scrollContainer);
            const topOverflow = geometry.clientTop + AUTO_SCROLL_EDGE_SIZE - clientY;
            const bottomOverflow = clientY - (geometry.clientBottom - AUTO_SCROLL_EDGE_SIZE);
            const overflow = bottomOverflow > 0 ? bottomOverflow : topOverflow > 0 ? -topOverflow : 0;
            if (overflow === 0) return 0;
            return Math.sign(overflow) * Math.min(
                AUTO_SCROLL_MAX_SPEED,
                AUTO_SCROLL_MIN_SPEED + Math.abs(overflow) * AUTO_SCROLL_ACCELERATION,
            );
        };

        const applySelectionBoxStyle = (box: SelectionBox) => {
            const element = selectionBoxRef.current;
            if (!element) return;
            const left = Math.min(box.startX, box.endX);
            const top = Math.min(box.startY, box.endY);
            element.style.transform = `translate3d(${left}px, ${top}px, 0)`;
            element.style.width = `${Math.abs(box.endX - box.startX)}px`;
            element.style.height = `${Math.abs(box.endY - box.startY)}px`;
        };

        const applyKeys = (nextSet: Set<string>) => {
            const nextKeys = Array.from(nextSet);
            const signature = nextKeys.join('\0');
            if (signature === lastChangeSignature) return;
            lastChangeSignature = signature;
            optionsRef.current.onChange(nextKeys);
        };

        const syncOptimisticState = (nextSet: Set<string>) => {
            targets.forEach((target) => {
                const active = target.keys.length > 0 && target.keys.every((key) => nextSet.has(key));
                optionsRef.current.syncTarget(target, active);
            });
        };

        const flushPendingKeys = () => {
            if (!pendingKeys) return;
            applyKeys(pendingKeys);
            pendingKeys = null;
            pendingChangeCount = 0;
        };

        const queueKeysUpdate = (nextSet: Set<string>) => {
            const nextSignature = Array.from(nextSet).join('\0');
            const currentSignature = Array.from(currentOptimisticSet).join('\0');
            if (nextSignature === currentSignature) return;
            currentOptimisticSet = new Set(nextSet);
            syncOptimisticState(currentOptimisticSet);
            if (immediate) {
                applyKeys(nextSet);
                return;
            }
            pendingKeys = new Set(nextSet);
            pendingChangeCount += 1;
            if (pendingChangeCount >= UPDATE_BATCH_SIZE) flushPendingKeys();
        };

        const updateSelection = (clientPoint: Point, scrollContainer: HTMLElement) => {
            if (!startPoint) return;
            const currentPoint = toContentPoint(scrollContainer, clientPoint);
            const startViewPoint = contentToContainerPoint(scrollContainer, startPoint);
            const endViewPoint = contentToContainerPoint(scrollContainer, currentPoint);
            const geometry = getScrollGeometry(scrollContainer);
            const contentCoordinates = selectionBoxUsesContentCoordinates(scrollContainer);
            const viewportTop = contentCoordinates ? scrollContainer.scrollTop : geometry.viewportTop;
            const viewportBottom = contentCoordinates
                ? scrollContainer.scrollTop + scrollContainer.clientHeight
                : geometry.viewportBottom;
            const clampViewportY = (value: number) => Math.max(viewportTop, Math.min(viewportBottom, value));
            applySelectionBoxStyle({
                startX: startViewPoint.x,
                startY: clampViewportY(startViewPoint.y),
                endX: endViewPoint.x,
                endY: clampViewportY(endViewPoint.y),
            });

            const box: BoxSelectionContentRect = {
                left: Math.min(startPoint.x, currentPoint.x),
                right: Math.max(startPoint.x, currentPoint.x),
                top: Math.min(startPoint.y, currentPoint.y),
                bottom: Math.max(startPoint.y, currentPoint.y),
            };
            const nextSet = new Set(initialKeys);
            const activatedKeys = new Set<string>();

            activateTargets.forEach((target) => {
                if (!isIntersecting(target.rect, box)) return;
                target.keys.forEach((key) => {
                    nextSet.add(key);
                    activatedKeys.add(key);
                });
            });
            toggleTargets.forEach((target) => {
                if (!isIntersecting(target.rect, box)) return;
                target.keys.forEach((key) => {
                    if (activatedKeys.has(key)) return;
                    if (nextSet.has(key)) nextSet.delete(key);
                    else nextSet.add(key);
                });
            });
            queueKeysUpdate(nextSet);
        };

        const cancelSelectionUpdate = () => {
            if (selectionUpdateRaf !== null) cancelAnimationFrame(selectionUpdateRaf);
            selectionUpdateRaf = null;
            pendingSelectionClientPoint = null;
            pendingSelectionScrollContainer = null;
        };

        const flushSelectionUpdate = () => {
            if (immediate) {
                if (lastClientPoint && activeScrollContainer) {
                    updateSelection(lastClientPoint, activeScrollContainer);
                }
                return;
            }
            if (selectionUpdateRaf !== null) cancelAnimationFrame(selectionUpdateRaf);
            selectionUpdateRaf = null;
            if (pendingSelectionClientPoint && pendingSelectionScrollContainer) {
                updateSelection(pendingSelectionClientPoint, pendingSelectionScrollContainer);
            }
            pendingSelectionClientPoint = null;
            pendingSelectionScrollContainer = null;
            flushPendingKeys();
        };

        const requestSelectionUpdate = (clientPoint: Point, scrollContainer: HTMLElement) => {
            if (immediate) {
                updateSelection(clientPoint, scrollContainer);
                return;
            }
            pendingSelectionClientPoint = clientPoint;
            pendingSelectionScrollContainer = scrollContainer;
            if (selectionUpdateRaf !== null) return;
            selectionUpdateRaf = requestAnimationFrame(() => {
                selectionUpdateRaf = null;
                if (pendingSelectionClientPoint && pendingSelectionScrollContainer) {
                    updateSelection(pendingSelectionClientPoint, pendingSelectionScrollContainer);
                }
                pendingSelectionClientPoint = null;
                pendingSelectionScrollContainer = null;
            });
        };

        const stopAutoScroll = () => {
            if (autoScrollRaf !== null) cancelAnimationFrame(autoScrollRaf);
            autoScrollRaf = null;
            autoScrollLastTimestamp = 0;
        };

        const runAutoScroll = (timestamp: number) => {
            autoScrollRaf = null;
            if (!isDragging || !lastClientPoint || !activeScrollContainer) {
                autoScrollLastTimestamp = 0;
                return;
            }
            const velocity = getAutoScrollVelocity(activeScrollContainer, lastClientPoint.y);
            if (velocity === 0) {
                autoScrollLastTimestamp = 0;
                return;
            }
            if (!autoScrollLastTimestamp) {
                autoScrollLastTimestamp = timestamp;
                autoScrollRaf = requestAnimationFrame(runAutoScroll);
                return;
            }
            const deltaSeconds = Math.min(0.05, (timestamp - autoScrollLastTimestamp) / 1000);
            autoScrollLastTimestamp = timestamp;
            const maxScrollTop = activeScrollContainer.scrollHeight - activeScrollContainer.clientHeight;
            const before = activeScrollContainer.scrollTop;
            const atLimit = (velocity < 0 && before <= 0) || (velocity > 0 && before >= maxScrollTop);
            if (atLimit) {
                autoScrollLastTimestamp = 0;
                return;
            }
            activeScrollContainer.scrollTop = before + velocity * deltaSeconds;
            if (activeScrollContainer.scrollTop !== before) {
                if (!immediate) cancelSelectionUpdate();
                updateSelection(lastClientPoint, activeScrollContainer);
            }
            autoScrollRaf = requestAnimationFrame(runAutoScroll);
        };

        const updateAutoScroll = () => {
            if (
                !isDragging
                || !lastClientPoint
                || !activeScrollContainer
                || getAutoScrollVelocity(activeScrollContainer, lastClientPoint.y) === 0
            ) {
                stopAutoScroll();
                return;
            }
            if (autoScrollRaf === null) autoScrollRaf = requestAnimationFrame(runAutoScroll);
        };

        const cleanupSelection = () => {
            stopAutoScroll();
            cancelSelectionUpdate();
            window.removeEventListener('pointermove', onPointerMove);
            window.removeEventListener('pointerup', finishSelection);
            window.removeEventListener('pointercancel', finishSelection);
            activeScrollContainer?.removeEventListener('scroll', onScroll);
            if (
                activePointerId !== null
                && hasPointerCapture
                && container.hasPointerCapture(activePointerId)
            ) {
                container.releasePointerCapture(activePointerId);
            }
            if (isDragging) {
                document.body.style.userSelect = previousBodyUserSelect;
                if (activeScrollContainer) activeScrollContainer.style.scrollBehavior = previousScrollBehavior;
            }
            startPoint = null;
            lastClientPoint = null;
            activeScrollContainer = null;
            activeScrollGeometry = null;
            activePointerId = null;
            hasPointerCapture = false;
            isDragging = false;
            initialKeys = [];
            currentOptimisticSet = new Set<string>();
            targets = [];
            activateTargets = [];
            toggleTargets = [];
            lastChangeSignature = '';
            pendingKeys = null;
            pendingChangeCount = 0;
            previousScrollBehavior = '';
            setIsSelecting(false);
        };

        const onPointerDown = (event: PointerEvent) => {
            if (activePointerId !== null || !event.isPrimary) return;
            if ((event.pointerType === 'mouse' && event.button !== 0) || event.defaultPrevented) return;
            const target = event.target as HTMLElement;
            if (!optionsRef.current.canStart(target)) return;
            const scrollContainer = getScrollContainer();
            if (!scrollContainer.contains(target)) return;

            activeScrollContainer = scrollContainer;
            activeScrollGeometry = measureScrollGeometry(scrollContainer);
            activePointerId = event.pointerId;
            lastClientPoint = { x: event.clientX, y: event.clientY };
            startPoint = toContentPoint(scrollContainer, lastClientPoint);
            initialKeys = Array.from(optionsRef.current.getInitialKeys());
            currentOptimisticSet = new Set(initialKeys);
            lastChangeSignature = initialKeys.join('\0');
            targets = optionsRef.current.collectTargets({
                container,
                scrollContainer,
                elementToContentRect: (element) => elementToContentRect(scrollContainer, element),
            });
            activateTargets = targets.filter((target) => target.mode === 'activate');
            toggleTargets = targets.filter((target) => target.mode !== 'activate');
            previousBodyUserSelect = document.body.style.userSelect;
            previousScrollBehavior = scrollContainer.style.scrollBehavior;
            window.addEventListener('pointermove', onPointerMove);
            window.addEventListener('pointerup', finishSelection);
            window.addEventListener('pointercancel', finishSelection);
            scrollContainer.addEventListener('scroll', onScroll, { passive: true });
        };

        const onPointerMove = (event: PointerEvent) => {
            if (event.pointerId !== activePointerId || !startPoint || !activeScrollContainer) return;
            lastClientPoint = { x: event.clientX, y: event.clientY };
            const currentPoint = toContentPoint(activeScrollContainer, lastClientPoint);
            if (!isDragging) {
                const dx = currentPoint.x - startPoint.x;
                const dy = currentPoint.y - startPoint.y;
                if (dx * dx + dy * dy > DRAG_START_THRESHOLD_SQ) {
                    isDragging = true;
                    document.body.style.userSelect = 'none';
                    activeScrollContainer.style.scrollBehavior = 'auto';
                    container.setPointerCapture(event.pointerId);
                    hasPointerCapture = true;
                    setIsSelecting(true);
                }
            }
            if (!isDragging) return;
            requestSelectionUpdate(lastClientPoint, activeScrollContainer);
            updateAutoScroll();
        };

        const onScroll = () => {
            if (!isDragging || !lastClientPoint || !activeScrollContainer || autoScrollRaf !== null) return;
            requestSelectionUpdate(lastClientPoint, activeScrollContainer);
        };

        function finishSelection(event: PointerEvent) {
            if (event.pointerId !== activePointerId) return;
            flushSelectionUpdate();
            cleanupSelection();
        }

        container.addEventListener('pointerdown', onPointerDown);
        return () => {
            container.removeEventListener('pointerdown', onPointerDown);
            cleanupSelection();
        };
    }, [containerRef, immediate, selectionBoxCoordinates, selectionBoxRef]);

    return { isSelecting };
};
