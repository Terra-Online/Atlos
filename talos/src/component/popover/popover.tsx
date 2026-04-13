import React, { useRef, useEffect, useCallback } from 'react';
import styles from './popover.module.scss';

interface PopoverTooltipProps {
    content: React.ReactNode;
    children: React.ReactElement;
    placement?: 'top' | 'bottom' | 'left' | 'right';
    disabled?: boolean;
    visible?: boolean;
    gap?: number;
}

const hasRenderableContent = (content: React.ReactNode): boolean => {
    if (typeof content === 'string') return content.trim().length > 0;
    return content !== null && content !== undefined;
};

/**
 * Using native Popover API to avoid overflow issues
 */
const PopoverTooltip: React.FC<PopoverTooltipProps> = ({
    content,
    children,
    placement = 'right',
    disabled = false,
    visible,
    gap = 12,
}) => {
    const hoverTimeoutRef = useRef<number | undefined>(undefined);
    const controlledCloseTimeoutRef = useRef<number | undefined>(undefined);
    const triggerRef = useRef<HTMLElement | null>(null);
    const popoverIdRef = useRef<string>(`tooltip-${Math.random().toString(36).substr(2, 9)}`);

    // Cleanup function: ensure popover is closed
    useEffect(() => {
        const popoverId = popoverIdRef.current;
        return () => {
            // Clear timeout and popover on component unmount
            if (hoverTimeoutRef.current) {
                clearTimeout(hoverTimeoutRef.current);
            }
            if (controlledCloseTimeoutRef.current) {
                clearTimeout(controlledCloseTimeoutRef.current);
            }
            const popover = document.getElementById(popoverId) as HTMLElement & { hidePopover?: () => void };
            if (popover?.hidePopover) {
                try {
                    popover.hidePopover();
                } catch (_e) {
                    // Ignore if already hidden
                }
                popover.classList.remove(styles.popoverClose);
            }
        };
    }, []);

    const positionPopover = useCallback((button: HTMLElement, popover: HTMLElement) => {
        const buttonRect = button.getBoundingClientRect();
        popover.style.position = 'fixed';

        switch (placement) {
            case 'right':
                popover.style.left = `${buttonRect.right + gap}px`;
                popover.style.top = `${buttonRect.top + buttonRect.height / 2}px`;
                popover.style.transform = 'translateY(-50%)';
                popover.style.right = 'auto';
                popover.style.bottom = 'auto';
                break;
            case 'left':
                popover.style.right = `${window.innerWidth - buttonRect.left + gap}px`;
                popover.style.top = `${buttonRect.top + buttonRect.height / 2}px`;
                popover.style.transform = 'translateY(-50%)';
                popover.style.left = 'auto';
                popover.style.bottom = 'auto';
                break;
            case 'bottom':
                popover.style.left = `${buttonRect.left + buttonRect.width / 2}px`;
                popover.style.top = `${buttonRect.bottom + gap}px`;
                popover.style.transform = 'translateX(-50%)';
                popover.style.right = 'auto';
                popover.style.bottom = 'auto';
                break;
            case 'top':
                popover.style.left = `${buttonRect.left + buttonRect.width / 2}px`;
                popover.style.bottom = `${window.innerHeight - buttonRect.top + gap}px`;
                popover.style.transform = 'translateX(-50%)';
                popover.style.top = 'auto';
                popover.style.right = 'auto';
                break;
        }
    }, [placement, gap]);

    const handleMouseEnter = (event: React.MouseEvent<HTMLElement>) => {
        if (visible !== undefined) return;
        if (disabled || !hasRenderableContent(content)) return;

        if (hoverTimeoutRef.current) {
            clearTimeout(hoverTimeoutRef.current);
        }

        const target = event.currentTarget;
        const popover = document.getElementById(popoverIdRef.current) as HTMLElement & { showPopover?: () => void };
        
        if (popover?.showPopover) {
            try {
                popover.showPopover();
                positionPopover(target, popover);
            } catch (_e) {
                // Ignore if already shown
            }
        }
    };

    const handleMouseLeave = () => {
        if (visible !== undefined) return;
        if (disabled || !hasRenderableContent(content)) return;

        const popover = document.getElementById(popoverIdRef.current) as HTMLElement & { hidePopover?: () => void };
        if (popover) {
            // Add fade-out class to trigger transition
            popover.classList.add(styles.popoverClose);
            
            hoverTimeoutRef.current = window.setTimeout(() => {
                if (popover?.hidePopover) {
                    try {
                        popover.hidePopover();
                        // Remove fade-out class for next show
                        popover.classList.remove(styles.popoverClose);
                    } catch (_e) {
                        // Ignore if already hidden
                    }
                }
            }, 220); // 100ms delay + 120ms transition
        }
    };

    useEffect(() => {
        if (visible === undefined || !hasRenderableContent(content)) return;

        const popover = document.getElementById(popoverIdRef.current) as HTMLElement & {
            showPopover?: () => void;
            hidePopover?: () => void;
        };
        const trigger = triggerRef.current;
        if (!popover || !trigger) return;

        if (controlledCloseTimeoutRef.current) {
            clearTimeout(controlledCloseTimeoutRef.current);
            controlledCloseTimeoutRef.current = undefined;
        }

        if (visible) {
            popover.classList.remove(styles.popoverClose);
            try {
                popover.showPopover?.();
                positionPopover(trigger, popover);
            } catch (_e) {
                // Ignore if already shown
            }
            return;
        }

        popover.classList.add(styles.popoverClose);
        controlledCloseTimeoutRef.current = window.setTimeout(() => {
            try {
                popover.hidePopover?.();
                popover.classList.remove(styles.popoverClose);
            } catch (_e) {
                // Ignore if already hidden
            }
        }, 120);
    }, [visible, content, positionPopover]);

    if (!hasRenderableContent(content)) {
        return children;
    }

    // Clone children and add event handlers
    const childProps = children.props as Record<string, unknown>;
    const originalOnMouseEnter = childProps.onMouseEnter as ((e: React.MouseEvent<HTMLElement>) => void) | undefined;
    const originalOnMouseLeave = childProps.onMouseLeave as ((e: React.MouseEvent<HTMLElement>) => void) | undefined;

    const childWithHandlers = React.cloneElement(children, {
        ref: triggerRef,
        onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
            handleMouseEnter(e);
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
            <div
                id={popoverIdRef.current}
                popover="manual"
                className={styles.popoverTooltip}
            >
                {content}
            </div>
        </>
    );
};

export default PopoverTooltip;
