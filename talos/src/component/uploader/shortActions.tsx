import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import classNames from 'classnames';
import PopoverTooltip from '@/component/popover/popover';
import styles from './shortActions.module.scss';

export type ShortActionItem = {
    id: string;
    label: string;
    icon: React.ReactNode;
    onClick?: () => void;
    disabled?: boolean;
    active?: boolean;
    confirming?: boolean;
    iconClassName?: string;
    tooltipKey?: string;
    tooltipVisible?: boolean;
};

type Props = {
    items: ShortActionItem[];
    className?: string;
    anchorClassName?: string;
    ariaLabel?: string;
    variant?: 'separate' | 'grouped' | 'floating';
    onFloatingDismiss?: () => void;
};

type PopoverElement = HTMLDivElement & {
    showPopover?: () => void;
    hidePopover?: () => void;
};

const VIEWPORT_MARGIN = 4;
const CLOSE_MS = 120;

const clamp = (value: number, min: number, max: number): number => (
    Math.min(Math.max(value, min), max)
);

const isTouchLikePointer = (event: Pick<PointerEvent, 'pointerType'> | Pick<React.PointerEvent, 'pointerType'>): boolean => (
    event.pointerType === 'touch'
    || event.pointerType === 'pen'
    || (event.pointerType === '' && Boolean(window.matchMedia?.('(hover: none)')?.matches))
);

const isPopoverOpen = (popover: HTMLElement): boolean => {
    try {
        return popover.matches(':popover-open');
    } catch {
        return false;
    }
};

const containsNode = (container: Element | null | undefined, target: EventTarget | null | undefined): boolean => (
    target instanceof Node && Boolean(container?.contains(target))
);

const ShortActions = memo(({
    items,
    className,
    anchorClassName,
    ariaLabel = 'Actions',
    variant = 'separate',
    onFloatingDismiss,
}: Props) => {
    const [mounted, setMounted] = useState(false);
    const anchorRef = useRef<HTMLSpanElement | null>(null);
    const layerRef = useRef<PopoverElement | null>(null);
    const closeTimerRef = useRef<number | undefined>(undefined);
    const frameRef = useRef<number | undefined>(undefined);
    const rootHoverRef = useRef(false);
    const layerHoverRef = useRef(false);
    const rootFocusRef = useRef(false);
    const layerFocusRef = useRef(false);
    const touchPinnedRef = useRef(false);
    const isFloating = variant === 'floating';

    const getRootElement = useCallback(() => (
        anchorRef.current?.closest('[data-short-actions-root="true"]') as HTMLElement | null
    ), []);

    const clearTimers = useCallback(() => {
        if (closeTimerRef.current) {
            window.clearTimeout(closeTimerRef.current);
            closeTimerRef.current = undefined;
        }
    }, []);

    const positionLayer = useCallback(() => {
        const anchor = anchorRef.current;
        const layer = layerRef.current;
        if (!anchor || !layer || !isPopoverOpen(layer)) return;

        const anchorRect = anchor.getBoundingClientRect();
        const layerWidth = layer.offsetWidth;
        const layerHeight = layer.offsetHeight;
        layer.style.position = 'fixed';
        layer.style.left = `${clamp(
            anchorRect.right - layerWidth,
            VIEWPORT_MARGIN,
            Math.max(VIEWPORT_MARGIN, window.innerWidth - layerWidth - VIEWPORT_MARGIN),
        )}px`;
        layer.style.top = `${clamp(
            anchorRect.top,
            VIEWPORT_MARGIN,
            Math.max(VIEWPORT_MARGIN, window.innerHeight - layerHeight - VIEWPORT_MARGIN),
        )}px`;
        layer.style.right = 'auto';
        layer.style.bottom = 'auto';
    }, []);

    const schedulePosition = useCallback(() => {
        if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
        frameRef.current = window.requestAnimationFrame(() => {
            frameRef.current = undefined;
            positionLayer();
        });
    }, [positionLayer]);

    const hideLayer = useCallback((immediate = false, notifyDismiss = true) => {
        clearTimers();
        const layer = layerRef.current;
        if (!layer) return;
        if (notifyDismiss && layer.dataset.open === 'true') {
            onFloatingDismiss?.();
        }

        const finish = () => {
            try {
                layer.hidePopover?.();
            } catch {
                // Already hidden.
            }
            layer.dataset.open = 'false';
            layer.classList.remove(styles.floatingLayerClosing);
            rootHoverRef.current = false;
            layerHoverRef.current = false;
            rootFocusRef.current = false;
            layerFocusRef.current = false;
            touchPinnedRef.current = false;
        };

        if (immediate || !isPopoverOpen(layer)) {
            finish();
            return;
        }

        layer.dataset.open = 'false';
        layer.classList.add(styles.floatingLayerClosing);
        closeTimerRef.current = window.setTimeout(finish, CLOSE_MS);
    }, [clearTimers, onFloatingDismiss]);

    const shouldKeepLayerOpen = useCallback(() => (
        touchPinnedRef.current || rootHoverRef.current || layerHoverRef.current || rootFocusRef.current || layerFocusRef.current
    ), []);

    const syncHoverState = useCallback((target?: EventTarget | null, point?: { x: number; y: number }) => {
        const root = getRootElement();
        const layer = layerRef.current;
        const pointTarget = point ? document.elementFromPoint(point.x, point.y) : null;
        const rootHovered = containsNode(root, target) || containsNode(root, pointTarget);
        const layerHovered = containsNode(layer, target) || containsNode(layer, pointTarget);
        rootHoverRef.current = rootHovered;
        layerHoverRef.current = layerHovered;
        return rootHovered || layerHovered;
    }, [getRootElement]);

    const showLayer = useCallback(() => {
        if (!isFloating || items.length === 0) return;
        clearTimers();

        const layer = layerRef.current;
        if (!layer) return;

        layer.dataset.open = 'true';
        layer.classList.remove(styles.floatingLayerClosing);
        try {
            if (!isPopoverOpen(layer)) layer.showPopover?.();
        } catch {
            // Already shown.
        }
        positionLayer();
        schedulePosition();
    }, [clearTimers, isFloating, items.length, positionLayer, schedulePosition]);

    const scheduleHideLayer = useCallback(() => {
        if (!shouldKeepLayerOpen()) hideLayer();
    }, [hideLayer, shouldKeepLayerOpen]);

    useEffect(() => {
        setMounted(true);
        return () => {
            clearTimers();
            if (frameRef.current) window.cancelAnimationFrame(frameRef.current);
            hideLayer(true, false);
        };
    }, [clearTimers, hideLayer]);

    useEffect(() => {
        if (!isFloating) return undefined;

        const root = getRootElement();
        if (!root) return undefined;

        const handleRootPointerDown = (event: PointerEvent) => {
            if (!isTouchLikePointer(event)) return;
            touchPinnedRef.current = true;
            rootHoverRef.current = true;
            layerHoverRef.current = false;
            rootFocusRef.current = false;
            layerFocusRef.current = false;
            showLayer();
        };
        const handleRootEnter = (event: PointerEvent) => {
            if (isTouchLikePointer(event)) return;
            rootHoverRef.current = true;
            showLayer();
        };
        const handleRootLeave = (event: PointerEvent) => {
            if (isTouchLikePointer(event)) return;
            rootHoverRef.current = false;
            const nextTarget = event.relatedTarget;
            if (nextTarget instanceof Node && layerRef.current?.contains(nextTarget)) return;
            scheduleHideLayer();
        };
        const handleFocusIn = () => {
            rootFocusRef.current = true;
            showLayer();
        };
        const handleFocusOut = () => {
            window.setTimeout(() => {
                const activeElement = document.activeElement;
                rootFocusRef.current = Boolean(activeElement && root.contains(activeElement));
                layerFocusRef.current = Boolean(activeElement && layerRef.current?.contains(activeElement));
                if (!activeElement || (!root.contains(activeElement) && !layerRef.current?.contains(activeElement))) {
                    scheduleHideLayer();
                }
            }, 0);
        };

        root.addEventListener('pointerdown', handleRootPointerDown);
        root.addEventListener('pointerenter', handleRootEnter);
        root.addEventListener('pointerleave', handleRootLeave);
        root.addEventListener('focusin', handleFocusIn);
        root.addEventListener('focusout', handleFocusOut);

        return () => {
            root.removeEventListener('pointerdown', handleRootPointerDown);
            root.removeEventListener('pointerenter', handleRootEnter);
            root.removeEventListener('pointerleave', handleRootLeave);
            root.removeEventListener('focusin', handleFocusIn);
            root.removeEventListener('focusout', handleFocusOut);
        };
    }, [getRootElement, isFloating, scheduleHideLayer, showLayer]);

    useEffect(() => {
        if (!isFloating) return undefined;

        const closeIfPointerOutside = (event: PointerEvent) => {
            const layer = layerRef.current;
            if (!layer || !isPopoverOpen(layer)) return;
            if (touchPinnedRef.current && isTouchLikePointer(event)) return;
            const inside = syncHoverState(event.target, { x: event.clientX, y: event.clientY });
            if (!inside && !rootFocusRef.current && !layerFocusRef.current) {
                scheduleHideLayer();
            }
        };
        const closeImmediatelyIfPointerOutside = (event: PointerEvent) => {
            const layer = layerRef.current;
            if (!layer || !isPopoverOpen(layer)) return;
            const inside = syncHoverState(event.target, { x: event.clientX, y: event.clientY });
            if (!inside) hideLayer(true);
        };
        const handleScroll = () => {
            schedulePosition();
            const layer = layerRef.current;
            if (!layer || !isPopoverOpen(layer)) return;
            const root = getRootElement();
            rootHoverRef.current = Boolean(root?.matches(':hover'));
            layerHoverRef.current = Boolean(layer.matches(':hover'));
            if (!shouldKeepLayerOpen()) scheduleHideLayer();
        };
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') hideLayer(true);
        };
        const handleWindowBlur = () => hideLayer(true);
        const handleVisibilityChange = () => {
            if (document.visibilityState !== 'visible') hideLayer(true);
        };

        document.addEventListener('pointermove', closeIfPointerOutside, true);
        document.addEventListener('pointerdown', closeImmediatelyIfPointerOutside, true);
        document.addEventListener('keydown', handleKeyDown);
        document.addEventListener('visibilitychange', handleVisibilityChange);
        window.addEventListener('blur', handleWindowBlur);
        window.addEventListener('resize', schedulePosition);
        window.addEventListener('scroll', handleScroll, true);
        return () => {
            document.removeEventListener('pointermove', closeIfPointerOutside, true);
            document.removeEventListener('pointerdown', closeImmediatelyIfPointerOutside, true);
            document.removeEventListener('keydown', handleKeyDown);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            window.removeEventListener('blur', handleWindowBlur);
            window.removeEventListener('resize', schedulePosition);
            window.removeEventListener('scroll', handleScroll, true);
        };
    }, [
        getRootElement,
        hideLayer,
        isFloating,
        scheduleHideLayer,
        schedulePosition,
        shouldKeepLayerOpen,
        syncHoverState,
    ]);

    if (items.length === 0) return null;

    const actionLayer = (
        <div
            className={classNames(styles.shortActions, className, {
                [styles.grouped]: variant === 'grouped' || isFloating,
                [styles.floatingLayer]: isFloating,
            })}
            ref={isFloating ? layerRef : undefined}
            {...(isFloating ? { popover: 'manual' } : {})}
            onClick={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onPointerEnter={isFloating ? (event) => {
                if (isTouchLikePointer(event)) return;
                touchPinnedRef.current = false;
                layerHoverRef.current = true;
                showLayer();
            } : undefined}
            onPointerLeave={isFloating ? (event) => {
                if (isTouchLikePointer(event)) return;
                layerHoverRef.current = false;
                const root = anchorRef.current?.closest('[data-short-actions-root="true"]');
                const nextTarget = event.relatedTarget;
                if (nextTarget instanceof Node && root?.contains(nextTarget)) return;
                scheduleHideLayer();
            } : undefined}
            onPointerMove={isFloating ? (event) => {
                if (isTouchLikePointer(event)) return;
                layerHoverRef.current = true;
            } : undefined}
            onFocus={isFloating ? () => {
                layerFocusRef.current = true;
                showLayer();
            } : undefined}
            onBlur={isFloating ? () => {
                window.setTimeout(() => {
                    const activeElement = document.activeElement;
                    const root = anchorRef.current?.closest('[data-short-actions-root="true"]');
                    rootFocusRef.current = Boolean(activeElement && root?.contains(activeElement));
                    layerFocusRef.current = Boolean(activeElement && layerRef.current?.contains(activeElement));
                    if (!shouldKeepLayerOpen()) scheduleHideLayer();
                }, 0);
            } : undefined}
            role="toolbar"
            aria-label={ariaLabel}
        >
            {items.map((item) => (
                <PopoverTooltip key={item.tooltipKey ?? item.id} content={item.label} placement="top" gap={4} visible={item.tooltipVisible}>
                    <button
                        type="button"
                        className={styles.shortActionButton}
                        data-action={item.id}
                        data-label={item.id}
                        data-active={item.active ? 'true' : 'false'}
                        data-confirming={item.confirming ? 'true' : 'false'}
                        disabled={item.disabled}
                        onPointerDown={isFloating ? (event) => {
                            event.stopPropagation();
                            if (event.pointerType !== 'touch') {
                                event.preventDefault();
                            }
                            rootFocusRef.current = false;
                            layerFocusRef.current = false;
                        } : undefined}
                        onClick={(event) => {
                            event.stopPropagation();
                            item.onClick?.();
                        }}
                        aria-label={item.label}
                        aria-pressed={item.active || undefined}
                    >
                        <span className={classNames(styles.shortActionIcon, item.iconClassName)}>{item.icon}</span>
                    </button>
                </PopoverTooltip>
            ))}
        </div>
    );

    if (isFloating) {
        return (
            <>
                <span ref={anchorRef} className={classNames(styles.floatingAnchor, anchorClassName)} aria-hidden="true"></span>
                {mounted && createPortal(actionLayer, document.body)}
            </>
        );
    }

    return actionLayer;
});

ShortActions.displayName = 'ShortActions';

export default ShortActions;
