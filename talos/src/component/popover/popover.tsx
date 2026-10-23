import { registerOverlay } from '@/lib/dom/overlay';
import { registerFontRegion } from '@/locale/fontLoader';
import React, { useRef, useEffect, useCallback, useId, useLayoutEffect } from 'react';
import styles from './popover.module.scss';

interface PopoverTooltipProps {
    content: React.ReactNode;
    fontText?: string;
    children: React.ReactElement;
    anchor?: 'element' | 'first-line';
    placement?: 'top' | 'bottom' | 'left' | 'right';
    disabled?: boolean;
    visible?: boolean;
    gap?: number;
    variant?: 'text' | 'image';
}

const hasRenderableContent = (content: React.ReactNode): boolean => {
    if (typeof content === 'string') return content.trim().length > 0;
    return content !== null && content !== undefined;
};

const VIEWPORT_MARGIN = 4;
const CLOSE_TRANSITION_MS = 120;

type PopoverElement = HTMLSpanElement & {
    showPopover?: () => void;
    hidePopover?: () => void;
};

type ElementWithRef = React.ReactElement & {
    ref?: React.Ref<HTMLElement>;
};

type Placement = NonNullable<PopoverTooltipProps['placement']>;

type PositionedRect = {
    bottom?: number;
    left?: number;
    right?: number;
    top?: number;
};

const clamp = (value: number, min: number, max: number): number => (
    Math.min(Math.max(value, min), max)
);

const setMergedRef = <T,>(ref: React.Ref<T> | undefined, value: T | null): void => {
    if (!ref) return;
    if (typeof ref === 'function') {
        ref(value);
        return;
    }
    (ref as React.MutableRefObject<T | null>).current = value;
};

const computeCoordinates = (
    placement: Placement,
    triggerRect: DOMRect,
    popoverRect: DOMRect,
    gap: number,
    viewportWidth: number,
    viewportHeight: number,
): PositionedRect => {
    switch (placement) {
        case 'right':
            return {
                left: triggerRect.right + gap,
                top: triggerRect.top + triggerRect.height / 2 - popoverRect.height / 2,
            };
        case 'left':
            return {
                right: viewportWidth - triggerRect.left + gap,
                top: triggerRect.top + triggerRect.height / 2 - popoverRect.height / 2,
            };
        case 'bottom':
            return {
                left: triggerRect.left + triggerRect.width / 2 - popoverRect.width / 2,
                top: triggerRect.bottom + gap,
            };
        case 'top':
            return {
                left: triggerRect.left + triggerRect.width / 2 - popoverRect.width / 2,
                bottom: viewportHeight - triggerRect.top + gap,
            };
    }
};

const computePopoverPosition = (
    placement: Placement,
    triggerRect: DOMRect,
    popoverRect: DOMRect,
    gap: number,
    viewportWidth: number,
    viewportHeight: number,
): PositionedRect => {
    const coordinates = computeCoordinates(
        placement,
        triggerRect,
        popoverRect,
        gap,
        viewportWidth,
        viewportHeight,
    );
    const maxLeft = Math.max(VIEWPORT_MARGIN, viewportWidth - popoverRect.width - VIEWPORT_MARGIN);
    const maxTop = Math.max(VIEWPORT_MARGIN, viewportHeight - popoverRect.height - VIEWPORT_MARGIN);
    const maxRight = Math.max(VIEWPORT_MARGIN, viewportWidth - popoverRect.width - VIEWPORT_MARGIN);
    const maxBottom = Math.max(VIEWPORT_MARGIN, viewportHeight - popoverRect.height - VIEWPORT_MARGIN);

    if (placement === 'left') {
        return {
            right: clamp(coordinates.right ?? VIEWPORT_MARGIN, VIEWPORT_MARGIN, maxRight),
            top: clamp(coordinates.top ?? VIEWPORT_MARGIN, VIEWPORT_MARGIN, maxTop),
        };
    }

    if (placement === 'top') {
        return {
            bottom: clamp(coordinates.bottom ?? VIEWPORT_MARGIN, VIEWPORT_MARGIN, maxBottom),
            left: clamp(coordinates.left ?? VIEWPORT_MARGIN, VIEWPORT_MARGIN, maxLeft),
        };
    }

    return {
        left: clamp(coordinates.left ?? VIEWPORT_MARGIN, VIEWPORT_MARGIN, maxLeft),
        top: clamp(coordinates.top ?? VIEWPORT_MARGIN, VIEWPORT_MARGIN, maxTop),
    };
};

const isPopoverOpen = (popover: HTMLElement): boolean => {
    try {
        return popover.matches(':popover-open');
    } catch {
        return false;
    }
};

/**
 * Using native Popover API to avoid overflow issues
 */
const PopoverTooltip: React.FC<PopoverTooltipProps> = ({
    content,
    fontText,
    children,
    placement = 'right',
    anchor = 'element',
    disabled = false,
    visible,
    gap = 12,
    variant = 'text',
}) => {
    const closeTimeoutRef = useRef<number | undefined>(undefined);
    const positionFrameRef = useRef<(() => void) | undefined>(undefined);
    const viewportCleanupRef = useRef<(() => void) | undefined>(undefined);
    const scheduleLatest = useRef<() => void>(() => {});
    const isOpenRef = useRef(false);
    const layerRef = useRef<ReturnType<typeof registerOverlay> | null>(null);
    const fontOwner = useRef<ReturnType<typeof registerFontRegion>>(undefined);
    const text = fontText ?? (typeof content === 'string' || typeof content === 'number' ? String(content) : '');
    useLayoutEffect(() => {
        fontOwner.current?.update([{ faces: ['h', 'r'], text }]);
    }, [text]);
    const triggerRef = useRef<HTMLElement | null>(null);
    const popoverRef = useRef<PopoverElement | null>(null);
    const popoverId = useId();
    const hasContent = hasRenderableContent(content);
    const childProps = children.props as Record<string, unknown> & {
        ref?: React.Ref<HTMLElement>;
        'aria-describedby'?: string;
    };
    const childRef = childProps.ref ?? (children as ElementWithRef).ref;

    const clearCloseTimeout = useCallback(() => {
        if (closeTimeoutRef.current) {
            window.clearTimeout(closeTimeoutRef.current);
            closeTimeoutRef.current = undefined;
        }
    }, []);

    const positionPopover = useCallback(() => {
        const trigger = triggerRef.current;
        const popover = popoverRef.current;
        if (!trigger || !popover || !isOpenRef.current) return;

        const ownerWindow = trigger.ownerDocument.defaultView ?? window;
        const popoverRect = popover.getBoundingClientRect();
        const position = computePopoverPosition(
            placement,
            anchor === 'first-line'
                ? trigger.getClientRects()[0] ?? trigger.getBoundingClientRect()
                : trigger.getBoundingClientRect(),
            popoverRect,
            gap,
            ownerWindow.innerWidth,
            ownerWindow.innerHeight,
        );

        popover.style.position = 'fixed';
        popover.style.left = position.left === undefined ? 'auto' : `${position.left}px`;
        popover.style.top = position.top === undefined ? 'auto' : `${position.top}px`;
        popover.style.right = position.right === undefined ? 'auto' : `${position.right}px`;
        popover.style.bottom = position.bottom === undefined ? 'auto' : `${position.bottom}px`;
        popover.style.transform = 'none';
        popover.dataset.placement = placement;
    }, [anchor, gap, placement]);

    const schedulePosition = useCallback(() => {
        positionFrameRef.current?.();
        const ownerWindow = triggerRef.current?.ownerDocument.defaultView ?? window;
        const frame = ownerWindow.requestAnimationFrame(() => {
            positionFrameRef.current = undefined;
            positionPopover();
        });
        positionFrameRef.current = () => ownerWindow.cancelAnimationFrame(frame);
    }, [positionPopover]);
    scheduleLatest.current = schedulePosition;

    const hidePopover = useCallback((immediate = false) => {
        clearCloseTimeout();
        positionFrameRef.current?.();
        positionFrameRef.current = undefined;
        viewportCleanupRef.current?.();
        viewportCleanupRef.current = undefined;
        isOpenRef.current = false;

        const popover = popoverRef.current;
        if (!popover) return;

        layerRef.current?.setActive(false);
        const finishClose = () => {
            try {
                popover.hidePopover?.();
            } catch {
                // Ignore if already hidden
            }
            popover.classList.remove(styles.popoverClose);
            layerRef.current?.dispose();
            layerRef.current = null;
            fontOwner.current?.stop();
            fontOwner.current = undefined;
        };

        if (immediate || !isPopoverOpen(popover)) {
            finishClose();
            return;
        }

        popover.classList.add(styles.popoverClose);
        closeTimeoutRef.current = window.setTimeout(finishClose, CLOSE_TRANSITION_MS);
    }, [clearCloseTimeout]);

    const showPopover = useCallback(() => {
        if (disabled || !hasContent) return;
        clearCloseTimeout();

        const popover = popoverRef.current;
        if (!popover) return;

        if (!fontOwner.current) fontOwner.current = registerFontRegion(popover, [{ faces: ['h', 'r'], text }]);
        popover.classList.remove(styles.popoverClose);
        try {
            if (!isPopoverOpen(popover)) {
                popover.showPopover?.();
            }
        } catch {
            // Ignore if already shown
        }

        if (!layerRef.current) layerRef.current = registerOverlay({
            element: popover, trigger: triggerRef.current, onDismiss: () => hidePopover(true),
        });
        layerRef.current.setActive(true);
        if (!viewportCleanupRef.current) {
            const ownerWindow = popover.ownerDocument.defaultView ?? window;
            const update = () => scheduleLatest.current();
            ownerWindow.addEventListener('resize', update);
            ownerWindow.addEventListener('scroll', update, true);
            viewportCleanupRef.current = () => {
                ownerWindow.removeEventListener('resize', update);
                ownerWindow.removeEventListener('scroll', update, true);
            };
        }
        isOpenRef.current = true;
        positionPopover();
        schedulePosition();
    }, [clearCloseTimeout, disabled, hasContent, hidePopover, positionPopover, schedulePosition, text]);

    // Cleanup function: ensure popover is closed
    useEffect(() => {
        return () => {
            clearCloseTimeout();
            hidePopover(true);
            fontOwner.current?.stop();
            fontOwner.current = undefined;
        };
    }, [clearCloseTimeout, hidePopover]);

    useEffect(() => {
        if (disabled || !hasContent) {
            hidePopover(true);
        }
    }, [disabled, hasContent, hidePopover]);

    useEffect(() => {
        if (visible === undefined) return;
        if (visible) {
            showPopover();
            return;
        }
        hidePopover();
    }, [hidePopover, showPopover, visible]);

    useEffect(() => {
        if (isOpenRef.current) schedulePosition();
    }, [content, schedulePosition]);

    const handleMouseEnter = () => {
        if (visible !== undefined) return;
        showPopover();
    };

    const handleMouseLeave = () => {
        if (visible !== undefined) return;
        hidePopover();
    };

    const setTriggerRef = useCallback((node: HTMLElement | null) => {
        triggerRef.current = node;
        setMergedRef(childRef, node);
    }, [childRef]);

    if (!hasContent) {
        return children;
    }

    // Clone children and add event handlers
    const originalOnMouseEnter = childProps.onMouseEnter as ((e: React.MouseEvent<HTMLElement>) => void) | undefined;
    const originalOnMouseLeave = childProps.onMouseLeave as ((e: React.MouseEvent<HTMLElement>) => void) | undefined;
    const describedBy = disabled
        ? childProps['aria-describedby']
        : [childProps['aria-describedby'], popoverId].filter(Boolean).join(' ') || undefined;

    const childWithHandlers = React.cloneElement(children, {
        ref: setTriggerRef,
        'aria-describedby': describedBy,
        onFocus: (e: React.FocusEvent<HTMLElement>) => {
            handleMouseEnter();
            (childProps.onFocus as ((event: React.FocusEvent<HTMLElement>) => void) | undefined)?.(e);
        },
        onBlur: (e: React.FocusEvent<HTMLElement>) => {
            handleMouseLeave();
            (childProps.onBlur as ((event: React.FocusEvent<HTMLElement>) => void) | undefined)?.(e);
        },
        onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
            handleMouseEnter();
            if (originalOnMouseEnter) {
                originalOnMouseEnter(e);
            }
        },
        onMouseLeave: (e: React.MouseEvent<HTMLElement>) => {
            handleMouseLeave();
            if (originalOnMouseLeave) {
                originalOnMouseLeave(e);
            }
        },
    } as Partial<React.HTMLAttributes<HTMLElement>> & { ref: React.Ref<HTMLElement> });

    return (
        <>
            {childWithHandlers}
            <span
                ref={popoverRef}
                id={popoverId}
                role="tooltip"
                popover="manual"
                className={`${styles.popoverTooltip} ${variant === 'image' ? styles.imgInner : styles.txtInner}`}
            >
                {content}
            </span>
        </>
    );
};

export default PopoverTooltip;
