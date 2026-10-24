import IconButton from '@/component/button/IconButton';
import { registerOverlay } from '@/lib/dom/overlay';
import { getAppDocument, subscribePictureInPictureState } from '@/platform/pictureInPicture';
import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import classNames from 'classnames';
import PopoverTooltip from '@/component/popover/popover';
import styles from '@/component/actionBar/ActionBar.module.scss';

export type ActionBarItem = {
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
    items: ActionBarItem[];
    className?: string;
    anchorClassName?: string;
    ariaLabel?: string;
    variant?: 'separate' | 'grouped' | 'floating';
    onFloatingDismiss?: () => void;
    // A supplied selection rect controls visibility; null closes the floating toolbar.
    anchorRect?: DOMRect | null;
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
    Boolean(target && 'nodeType' in target && container?.contains(target as Node))
);

const ActionBar = memo(({
    items,
    className,
    anchorClassName,
    ariaLabel = 'Actions',
    variant = 'separate',
    onFloatingDismiss,
    anchorRect,
}: Props) => {
    const [mounted, setMounted] = useState(false);
    const [ownerDocument, setOwnerDocument] = useState(getAppDocument);
    const ownerWindow = ownerDocument.defaultView ?? window;
    const registration = useRef<ReturnType<typeof registerOverlay> | null>(null);
    useEffect(() => subscribePictureInPictureState(() => setOwnerDocument(getAppDocument())), []);
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
    const controlled = anchorRect !== undefined;

    const getRootElement = useCallback(() => (
        anchorRef.current?.closest('[data-short-actions-root="true"]') as HTMLElement | null
    ), []);

    const clearTimers = useCallback(() => {
        if (closeTimerRef.current) {
            ownerWindow.clearTimeout(closeTimerRef.current);
            closeTimerRef.current = undefined;
        }
    }, [ownerWindow]);

    const positionLayer = useCallback(() => {
        const anchor = anchorRef.current;
        const layer = layerRef.current;
        if (!anchor || !layer || layer.dataset.open !== 'true' || !isPopoverOpen(layer)) return;

        const rect = anchorRect ?? anchor.getBoundingClientRect();
        const layerWidth = layer.offsetWidth;
        const layerHeight = layer.offsetHeight;
        layer.style.position = 'fixed';
        layer.style.left = `${clamp(
            anchorRect ? rect.left + rect.width / 2 - layerWidth / 2 : rect.right - layerWidth,
            VIEWPORT_MARGIN,
            Math.max(VIEWPORT_MARGIN, ownerWindow.innerWidth - layerWidth - VIEWPORT_MARGIN),
        )}px`;
        layer.style.top = `${clamp(
            anchorRect
                ? (rect.top >= layerHeight + 8 ? rect.top - layerHeight - 8 : rect.bottom + 8)
                : rect.top,
            VIEWPORT_MARGIN,
            Math.max(VIEWPORT_MARGIN, ownerWindow.innerHeight - layerHeight - VIEWPORT_MARGIN),
        )}px`;
        layer.style.right = 'auto';
        layer.style.bottom = 'auto';
    }, [anchorRect, ownerWindow]);

    const schedulePosition = useCallback(() => {
        if (frameRef.current) ownerWindow.cancelAnimationFrame(frameRef.current);
        frameRef.current = ownerWindow.requestAnimationFrame(() => {
            frameRef.current = undefined;
            positionLayer();
        });
    }, [ownerWindow, positionLayer]);

    const hideLayer = useCallback((immediate = false, notifyDismiss = true) => {
        clearTimers();
        if (frameRef.current) ownerWindow.cancelAnimationFrame(frameRef.current);
        frameRef.current = undefined;
        const layer = layerRef.current;
        if (!layer) return;
        layer.inert = true;
        registration.current?.setActive(false);
        if (notifyDismiss && layer.dataset.open === 'true') {
            onFloatingDismiss?.();
        }

        const finish = () => {
            try {
                layer.hidePopover?.();
            } catch {
                // Already hidden.
            }
            registration.current?.dispose();
            registration.current = null;
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
        closeTimerRef.current = ownerWindow.setTimeout(finish, CLOSE_MS);
    }, [clearTimers, onFloatingDismiss, ownerWindow]);

    const shouldKeepLayerOpen = useCallback(() => (
        touchPinnedRef.current || rootHoverRef.current || layerHoverRef.current || rootFocusRef.current || layerFocusRef.current
    ), []);

    const syncHoverState = useCallback((target?: EventTarget | null, point?: { x: number; y: number }) => {
        const root = getRootElement();
        const layer = layerRef.current;
        const pointTarget = point ? ownerDocument.elementFromPoint(point.x, point.y) : null;
        const rootHovered = containsNode(root, target) || containsNode(root, pointTarget);
        const layerHovered = containsNode(layer, target) || containsNode(layer, pointTarget);
        rootHoverRef.current = rootHovered;
        layerHoverRef.current = layerHovered;
        return rootHovered || layerHovered;
    }, [getRootElement, ownerDocument]);

    const showLayer = useCallback(() => {
        if (!isFloating || items.length === 0) return;
        clearTimers();

        const layer = layerRef.current;
        if (!layer) return;

        layer.inert = false;
        registration.current?.setActive(true);
        layer.dataset.open = 'true';
        layer.classList.remove(styles.floatingLayerClosing);
        try {
            if (!isPopoverOpen(layer)) layer.showPopover?.();
        } catch {
            // Already shown.
        }
        if (!registration.current) registration.current = registerOverlay({
            element: layer, trigger: getRootElement(), onDismiss: () => hideLayer(true),
        });
        positionLayer();
        schedulePosition();
    }, [clearTimers, getRootElement, hideLayer, isFloating, items.length, positionLayer, schedulePosition]);

    useEffect(() => {
        if (!isFloating || !controlled || !mounted) return;
        if (anchorRect) showLayer();
        else hideLayer();
    }, [anchorRect, controlled, hideLayer, isFloating, mounted, showLayer]);

    const scheduleHideLayer = useCallback(() => {
        if (!shouldKeepLayerOpen()) hideLayer();
    }, [hideLayer, shouldKeepLayerOpen]);

    useEffect(() => {
        setMounted(true);
        return () => {
            clearTimers();
            hideLayer(true, false);
        };
    }, [clearTimers, hideLayer, ownerWindow]);

    useEffect(() => {
        if (!isFloating || controlled) return undefined;

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
            if (containsNode(layerRef.current, nextTarget)) return;
            scheduleHideLayer();
        };
        const handleFocusIn = () => {
            rootFocusRef.current = true;
            showLayer();
        };
        const handleFocusOut = () => {
            ownerWindow.setTimeout(() => {
                const activeElement = ownerDocument.activeElement;
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
    }, [controlled, getRootElement, isFloating, ownerDocument, ownerWindow, scheduleHideLayer, showLayer]);

    useEffect(() => {
        if (!isFloating) return undefined;

        const closeIfPointerOutside = (event: PointerEvent) => {
            if (controlled) return;
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
            if (controlled) return;
            const layer = layerRef.current;
            if (!layer || !isPopoverOpen(layer)) return;
            const root = getRootElement();
            rootHoverRef.current = Boolean(root?.matches(':hover'));
            layerHoverRef.current = Boolean(layer.matches(':hover'));
            if (!shouldKeepLayerOpen()) scheduleHideLayer();
        };
        const handleWindowBlur = () => hideLayer(true);
        const handleVisibilityChange = () => {
            if (ownerDocument.visibilityState !== 'visible') hideLayer(true);
        };

        ownerDocument.addEventListener('pointermove', closeIfPointerOutside, true);
        ownerDocument.addEventListener('pointerdown', closeImmediatelyIfPointerOutside, true);
        ownerDocument.addEventListener('visibilitychange', handleVisibilityChange);
        ownerWindow.addEventListener('blur', handleWindowBlur);
        ownerWindow.addEventListener('resize', schedulePosition);
        ownerWindow.addEventListener('scroll', handleScroll, true);
        return () => {
            ownerDocument.removeEventListener('pointermove', closeIfPointerOutside, true);
            ownerDocument.removeEventListener('pointerdown', closeImmediatelyIfPointerOutside, true);
            ownerDocument.removeEventListener('visibilitychange', handleVisibilityChange);
            ownerWindow.removeEventListener('blur', handleWindowBlur);
            ownerWindow.removeEventListener('resize', schedulePosition);
            ownerWindow.removeEventListener('scroll', handleScroll, true);
        };
    }, [
        ownerDocument,
        ownerWindow,
        controlled,
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
                if (controlled || isTouchLikePointer(event)) return;
                touchPinnedRef.current = false;
                layerHoverRef.current = true;
                showLayer();
            } : undefined}
            onPointerLeave={isFloating ? (event) => {
                if (controlled || isTouchLikePointer(event)) return;
                layerHoverRef.current = false;
                const root = anchorRef.current?.closest('[data-short-actions-root="true"]');
                const nextTarget = event.relatedTarget;
                if (containsNode(root, nextTarget)) return;
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
                ownerWindow.setTimeout(() => {
                    const activeElement = ownerDocument.activeElement;
                    const root = anchorRef.current?.closest('[data-short-actions-root="true"]');
                    rootFocusRef.current = Boolean(activeElement && root?.contains(activeElement));
                    layerFocusRef.current = Boolean(activeElement && layerRef.current?.contains(activeElement));
                    if (!controlled && !shouldKeepLayerOpen()) scheduleHideLayer();
                }, 0);
            } : undefined}
            role="toolbar"
            aria-label={ariaLabel}
            aria-hidden={controlled ? !anchorRect : undefined}
        >
            {items.map((item) => (
                <PopoverTooltip key={item.tooltipKey ?? item.id} content={item.label} placement="top" gap={4} visible={item.tooltipVisible}>
                    <IconButton
                        label={item.label}
                        className={styles.shortActionButton}
                        data-action={item.id}
                        data-label={item.id}
                        data-active={item.active ? 'true' : 'false'}
                        data-confirming={item.confirming ? 'true' : 'false'}
                        disabled={item.disabled}
                        onPointerDown={isFloating ? (event) => {
                            event.stopPropagation();
                            if (controlled || event.pointerType !== 'touch') {
                                event.preventDefault();
                            }
                            rootFocusRef.current = false;
                            layerFocusRef.current = false;
                        } : undefined}
                        onClick={(event) => {
                            event.stopPropagation();
                            item.onClick?.();
                        }}
                        pressed={item.active}
                    >
                        <span className={classNames(styles.shortActionIcon, item.iconClassName)}>{item.icon}</span>
                    </IconButton>
                </PopoverTooltip>
            ))}
        </div>
    );

    if (isFloating) {
        return (
            <>
                <span ref={anchorRef} className={classNames(styles.floatingAnchor, anchorClassName)} aria-hidden="true"></span>
                {mounted && createPortal(actionLayer, ownerDocument.body)}
            </>
        );
    }

    return actionLayer;
});

ActionBar.displayName = 'ActionBar';

export default ActionBar;
