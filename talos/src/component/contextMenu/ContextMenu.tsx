import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    type KeyboardEvent as ReactKeyboardEvent,
    type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { motion, useIsPresent, useReducedMotion } from 'motion/react';
import styles from './contextMenu.module.scss';

export type ContextMenuItem = {
    id: string;
    label: ReactNode;
    disabled?: boolean;
    danger?: boolean;
    closeOnSelect?: boolean;
    onSelect: () => void;
};

export type ContextMenuGroup = {
    id: string;
    layout?: 'row';
    items: ContextMenuItem[];
};

type Props = {
    ownerDocument: Document;
    position: { x: number; y: number };
    groups: ContextMenuGroup[];
    header?: ReactNode;
    onDismiss: () => void;
};

const VIEWPORT_MARGIN = 8;

type PopoverMenuElement = HTMLDivElement & {
    showPopover?: () => void;
    hidePopover?: () => void;
};

const ContextMenu = ({
    ownerDocument,
    position,
    groups,
    header,
    onDismiss,
}: Props) => {
    const menuRef = useRef<PopoverMenuElement | null>(null);
    const didFocusRef = useRef(false);
    const isPresent = useIsPresent();
    const reducedMotion = useReducedMotion();
    const elementPrototype = ownerDocument.defaultView?.HTMLElement.prototype as (
        HTMLElement & { showPopover?: () => void; hidePopover?: () => void }
    ) | undefined;
    const supportsPopover = typeof elementPrototype?.showPopover === 'function'
        && typeof elementPrototype.hidePopover === 'function';
    const [popoverMode, setPopoverMode] = useState<'native' | 'fallback'>(
        supportsPopover ? 'native' : 'fallback',
    );

    const positionMenu = useCallback(() => {
        const menu = menuRef.current;
        const view = ownerDocument.defaultView;
        if (!menu || !view) return;
        const maxLeft = Math.max(VIEWPORT_MARGIN, view.innerWidth - menu.offsetWidth - VIEWPORT_MARGIN);
        const maxTop = Math.max(VIEWPORT_MARGIN, view.innerHeight - menu.offsetHeight - VIEWPORT_MARGIN);
        const left = Math.min(Math.max(position.x, VIEWPORT_MARGIN), maxLeft);
        const top = Math.min(Math.max(position.y, VIEWPORT_MARGIN), maxTop);
        menu.style.left = `${left}px`;
        menu.style.top = `${top}px`;
        menu.style.transformOrigin = `${position.x - left}px ${position.y - top}px`;
    }, [ownerDocument, position.x, position.y]);

    useLayoutEffect(() => {
        const menu = menuRef.current;
        if (!menu || popoverMode !== 'native') return undefined;
        try {
            menu.showPopover?.();
        } catch {
            // A detached/inactive document cannot enter the top layer.
            menu.removeAttribute('popover');
            menu.dataset.popoverMode = 'fallback';
            setPopoverMode('fallback');
            return undefined;
        }
        return () => {
            try {
                menu.hidePopover?.();
            } catch {
                // It may already have left the top layer during teardown.
            }
        };
    }, [popoverMode]);

    useLayoutEffect(() => {
        positionMenu();
        const menu = menuRef.current;
        if (!didFocusRef.current) {
            didFocusRef.current = true;
            const firstItem = menu?.querySelector<HTMLButtonElement>('button:not(:disabled)');
            firstItem?.focus({ preventScroll: true });
        }
    }, [groups, header, positionMenu]);

    useEffect(() => {
        if (!isPresent) return undefined;
        const view = ownerDocument.defaultView;
        const onPointerDown = (event: PointerEvent) => {
            if (!(event.target instanceof Node) || !menuRef.current?.contains(event.target)) {
                onDismiss();
            }
        };
        const onResize = () => onDismiss();
        ownerDocument.addEventListener('pointerdown', onPointerDown, true);
        view?.addEventListener('resize', onResize);
        return () => {
            ownerDocument.removeEventListener('pointerdown', onPointerDown, true);
            view?.removeEventListener('resize', onResize);
        };
    }, [isPresent, onDismiss, ownerDocument]);

    const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
        if (event.key === 'Escape' || event.key === 'Tab') {
            event.preventDefault();
            onDismiss();
            return;
        }
        if (!['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const items = [...(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
        if (items.length === 0) return;
        if (event.key === 'Home') {
            items[0].focus();
            return;
        }
        if (event.key === 'End') {
            items[items.length - 1].focus();
            return;
        }
        const current = Math.max(0, items.indexOf(ownerDocument.activeElement as HTMLButtonElement));
        const offset = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1;
        items[(current + offset + items.length) % items.length].focus();
    };

    return createPortal(
        <motion.div
            ref={menuRef}
            initial="closed"
            animate="open"
            exit="exit"
            variants={{
                closed: { opacity: 0, scale: reducedMotion ? 1 : 0.82, y: reducedMotion ? 0 : -6 },
                open: {
                    opacity: 1, scale: 1, y: 0,
                    transition: {
                        type: 'tween', duration: reducedMotion ? 0 : 0.2, ease: [0.16, 1, 0.3, 1],
                        opacity: { duration: reducedMotion ? 0 : 0.1 },
                        staggerChildren: reducedMotion ? 0 : 0.018,
                    },
                },
                exit: {
                    opacity: 0, scale: reducedMotion ? 1 : 0.9, y: reducedMotion ? 0 : -4,
                    transition: { duration: reducedMotion ? 0 : 0.14, ease: [0.4, 0, 1, 1] },
                },
            }}
            style={{ pointerEvents: isPresent ? 'auto' : 'none' }}
            inert={!isPresent}
            popover={popoverMode === 'native' ? 'manual' : undefined}
            data-popover-mode={popoverMode}
            className={styles.menu}
            role="menu"
            aria-label="Context menu"
            onKeyDown={handleKeyDown}
            onContextMenu={(event) => {
                if (!event.altKey) event.preventDefault();
            }}
        >
            {header && <div className={styles.header}>{header}</div>}
            {groups.map((group) => (
                <motion.div
                    className={styles.group} data-layout={group.layout} role="group" key={group.id}
                    variants={{
                        closed: { opacity: reducedMotion ? 1 : 0, y: reducedMotion ? 0 : -5 },
                        open: { opacity: 1, y: 0, transition: {
                            type: 'tween', duration: reducedMotion ? 0 : 0.16, ease: [0.16, 1, 0.3, 1],
                        } },
                    }}
                >
                    {group.items.map((item) => (
                        <motion.button
                            type="button"
                            role="menuitem"
                            key={item.id}
                            className={item.danger ? styles.danger : undefined}
                            disabled={item.disabled}
                            whileTap={item.disabled || reducedMotion ? undefined : { scale: 0.97 }}
                            transition={{ type: 'tween', duration: reducedMotion ? 0 : 0.12, ease: 'easeOut' }}
                            onClick={() => {
                                item.onSelect();
                                if (item.closeOnSelect !== false) onDismiss();
                            }}
                        >
                            {item.label}
                        </motion.button>
                    ))}
                </motion.div>
            ))}
        </motion.div>,
        ownerDocument.body,
    );
};

export default ContextMenu;
