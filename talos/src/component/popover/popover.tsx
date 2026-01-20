import React, { useRef, useEffect } from 'react';
import styles from './popover.module.scss';

interface PopoverTooltipProps {
    content: string;
    children: React.ReactElement;
    placement?: 'top' | 'bottom' | 'left' | 'right';
    disabled?: boolean;
}

/**
 * Using native Popover API to avoid overflow issues
 */
const PopoverTooltip: React.FC<PopoverTooltipProps> = ({
    content,
    children,
    placement = 'right',
    disabled = false,
}) => {
    const hoverTimeoutRef = useRef<number | undefined>(undefined);
    const popoverIdRef = useRef<string>(`tooltip-${Math.random().toString(36).substr(2, 9)}`);

    // Cleanup function: ensure popover is closed
    useEffect(() => {
        const popoverId = popoverIdRef.current;
        return () => {
            // Clear timeout and popover on component unmount
            if (hoverTimeoutRef.current) {
                clearTimeout(hoverTimeoutRef.current);
            }
            const popover = document.getElementById(popoverId) as HTMLElement & { hidePopover?: () => void };
            if (popover?.hidePopover) {
                try {
                    popover.hidePopover();
                } catch (_e) {
                    // Ignore if already hidden
                }
            }
        };
    }, []);

    const positionPopover = (button: HTMLElement, popover: HTMLElement) => {
        const buttonRect = button.getBoundingClientRect();
        popover.style.position = 'fixed';

        switch (placement) {
            case 'right':
                popover.style.left = `${buttonRect.right + 12}px`;
                popover.style.top = `${buttonRect.top + buttonRect.height / 2}px`;
                popover.style.transform = 'translateY(-50%)';
                break;
            case 'left':
                popover.style.right = `${window.innerWidth - buttonRect.left + 12}px`;
                popover.style.top = `${buttonRect.top + buttonRect.height / 2}px`;
                popover.style.transform = 'translateY(-50%)';
                popover.style.left = 'auto';
                break;
            case 'bottom':
                popover.style.left = `${buttonRect.left + buttonRect.width / 2}px`;
                popover.style.top = `${buttonRect.bottom + 12}px`;
                popover.style.transform = 'translateX(-50%)';
                break;
            case 'top':
                popover.style.left = `${buttonRect.left + buttonRect.width / 2}px`;
                popover.style.bottom = `${window.innerHeight - buttonRect.top + 8}px`;
                popover.style.transform = 'translateX(-50%)';
                popover.style.top = 'auto';
                break;
        }
    };

    const handleMouseEnter = (event: React.MouseEvent<HTMLElement>) => {
        if (disabled || !content) return;

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
        if (disabled || !content) return;

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

    if (!content) {
        return children;
    }

    // Clone children and add event handlers
    const childProps = children.props as Record<string, unknown>;
    const originalOnMouseEnter = childProps.onMouseEnter as ((e: React.MouseEvent<HTMLElement>) => void) | undefined;
    const originalOnMouseLeave = childProps.onMouseLeave as ((e: React.MouseEvent<HTMLElement>) => void) | undefined;

    const childWithHandlers = React.cloneElement(children, {
        onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
            handleMouseEnter(e);
            // Call original onMouseEnter if exists
            if (originalOnMouseEnter) {
                originalOnMouseEnter(e);
            }
        },
        onMouseLeave: (e: React.MouseEvent<HTMLElement>) => {
            handleMouseLeave();
            // Call original onMouseLeave if exists
            if (originalOnMouseLeave) {
                originalOnMouseLeave(e);
            }
        },
    } as Partial<React.HTMLAttributes<HTMLElement>>);

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
