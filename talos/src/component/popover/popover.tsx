import { registerOverlay } from '@/lib/dom/overlay';
import { registerFontRegion } from '@/locale/fontLoader';
import { cloneElement, useCallback, useId, useLayoutEffect, useRef, useState } from 'react';
import type { HTMLAttributes, ReactElement, ReactNode, Ref } from 'react';
import styles from './popover.module.scss';

interface Position {
    anchor?: 'element' | 'first-line';
    placement?: 'top' | 'bottom' | 'left' | 'right';
    gap?: number;
}

interface Props extends Position {
    content: ReactNode;
    fontText?: string;
    children: ReactElement;
    disabled?: boolean;
    visible?: boolean;
    trigger?: 'hover' | 'press';
    variant?: 'text' | 'image';
}

type TriggerProps = HTMLAttributes<HTMLElement> & { ref?: Ref<HTMLElement> };

interface Session {
    anchor: HTMLElement;
    element: HTMLSpanElement;
    view: Window;
    position: Position;
    font?: ReturnType<typeof registerFontRegion>;
    text: string;
    frame?: number;
    closeTimer?: number;
    stopTracking?: () => void;
}

const VIEWPORT_MARGIN = 4;
const CLOSE_TRANSITION_MS = 120;

function positionPopover({ anchor, element, view, position }: Session) {
    const { anchor: anchorMode, placement = 'right', gap = 12 } = position;
    const target = (anchorMode === 'first-line' && anchor.getClientRects()[0]) || anchor.getBoundingClientRect();
    const { width, height } = element.getBoundingClientRect();
    let left = target.left + (target.width - width) / 2;
    let top = target.top + (target.height - height) / 2;
    switch (placement) {
        case 'left': left = target.left - width - gap; break;
        case 'right': left = target.right + gap; break;
        case 'top': top = target.top - height - gap; break;
        case 'bottom': top = target.bottom + gap; break;
    }

    const x = `${Math.max(VIEWPORT_MARGIN, Math.min(left, view.innerWidth - width - VIEWPORT_MARGIN))}px`;
    const y = `${Math.max(VIEWPORT_MARGIN, Math.min(top, view.innerHeight - height - VIEWPORT_MARGIN))}px`;
    if (element.style.left !== x) element.style.left = x;
    if (element.style.top !== y) element.style.top = y;
}

function schedulePosition(session: Session) {
    if (session.frame !== undefined) return;
    session.frame = session.view.requestAnimationFrame(() => {
        session.frame = undefined;
        positionPopover(session);
    });
}

function stopTracking(session: Session) {
    if (session.frame !== undefined) session.view.cancelAnimationFrame(session.frame);
    session.frame = undefined;
    session.stopTracking?.();
    session.stopTracking = undefined;
}

function trackPosition(session: Session, onDismiss: () => void) {
    const { anchor, element, view } = session;
    const doc = element.ownerDocument;
    const overlay = registerOverlay({ element, trigger: anchor, closeOnOutside: true, onDismiss });
    const update = () => schedulePosition(session);
    // Late fonts and images can change geometry without a viewport event.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(element);
    observer?.observe(anchor);
    const onFontChange = (event: Event) => {
        const region = event.target as Element | null;
        if (region?.contains(anchor) || region?.contains(element)) update();
    };
    view.addEventListener('resize', update);
    view.addEventListener('scroll', update, true);
    doc.addEventListener('fontregionchange', onFontChange);
    session.stopTracking = () => {
        observer?.disconnect();
        view.removeEventListener('resize', update);
        view.removeEventListener('scroll', update, true);
        doc.removeEventListener('fontregionchange', onFontChange);
        overlay.dispose();
    };
}

function dispose(session: Session) {
    stopTracking(session);
    session.view.clearTimeout(session.closeTimer);
    session.font?.stop();
    if (session.element.matches(':popover-open')) session.element.hidePopover();
}

export default function PopoverTooltip({
    content,
    fontText,
    children,
    anchor,
    placement,
    gap,
    disabled = false,
    visible,
    trigger = 'hover',
    variant = 'text',
}: Props) {
    const id = useId();
    const triggerRef = useRef<HTMLElement | null>(null);
    const popoverRef = useRef<HTMLSpanElement | null>(null);
    const sessionRef = useRef<Session | null>(null);
    const pendingOpen = useRef(false);
    const [mounted, setMounted] = useState(false);
    const enabled = !disabled && (typeof content === 'string' ? content.trim().length > 0 : content != null);
    const plainText = typeof content === 'string' || typeof content === 'number' ? String(content) : undefined;
    const text = fontText ?? plainText ?? '';
    const needsFont = variant === 'text' || Boolean(text);
    const child = children as ReactElement<TriggerProps>;
    const childRef = child.props.ref;

    const setTriggerRef = useCallback((node: HTMLElement | null) => {
        triggerRef.current = node;
        if (typeof childRef === 'function') {
            const cleanup = childRef(node);
            if (typeof cleanup === 'function') {
                return () => {
                    triggerRef.current = null;
                    cleanup();
                };
            }
        } else if (childRef) {
            childRef.current = node;
        }
        return undefined;
    }, [childRef]);

    const hide = useCallback((immediate = false) => {
        pendingOpen.current = false;
        const session = sessionRef.current;
        if (!session) {
            setMounted(false);
            return;
        }
        const finish = () => {
            sessionRef.current = null;
            dispose(session);
            setMounted(false);
        };
        if (immediate) {
            finish();
        } else if (session.closeTimer === undefined) {
            stopTracking(session);
            session.element.setAttribute('inert', '');
            session.element.classList.add(styles.popoverClose);
            session.closeTimer = session.view.setTimeout(finish, CLOSE_TRANSITION_MS);
        }
    }, []);

    const open = useCallback((session: Session) => {
        if (session.stopTracking) return;
        const { element, view } = session;
        view.clearTimeout(session.closeTimer);
        session.closeTimer = undefined;
        element.classList.remove(styles.popoverClose);
        element.removeAttribute('inert');
        try {
            if (!element.matches(':popover-open')) element.showPopover();
        } catch {
            // The document can go away while a tooltip is being opened.
            hide(true);
            return;
        }
        positionPopover(session);
        trackPosition(session, () => hide(true));
    }, [hide]);

    const show = useCallback(() => {
        const session = sessionRef.current;
        if (session) {
            open(session);
        } else if (!pendingOpen.current) {
            pendingOpen.current = true;
            setMounted(true);
        }
    }, [open]);

    useLayoutEffect(() => () => {
        const session = sessionRef.current;
        if (session) dispose(session);
        sessionRef.current = null;
    }, []);

    useLayoutEffect(() => {
        if (!enabled) hide(true);
        else if (visible === true) show();
        else if (visible === false) hide();
    }, [enabled, visible, hide, show]);

    useLayoutEffect(() => {
        if (!enabled || !mounted) return;
        const target = triggerRef.current;
        const element = popoverRef.current;
        const view = element?.ownerDocument.defaultView;
        if (!target || !element?.showPopover || !view) {
            hide(true);
            return;
        }

        let session = sessionRef.current;
        if (session && (session.anchor !== target || session.element !== element || session.view !== view)) {
            const wasOpen = Boolean(session.stopTracking);
            dispose(session);
            sessionRef.current = session = null;
            pendingOpen.current = wasOpen;
            if (!wasOpen) hide(true);
        }

        const position = { anchor, placement, gap };
        if (!session) {
            if (!pendingOpen.current) return;
            pendingOpen.current = false;
            session = { anchor: target, element, view, position, text };
            if (needsFont) session.font = registerFontRegion(element, [{ faces: ['h', 'r'], text }]);
            sessionRef.current = session;
            open(session);
        } else {
            session.position = position;
            if (!needsFont) {
                session.font?.stop();
                session.font = undefined;
            } else if (!session.font) {
                session.font = registerFontRegion(element, [{ faces: ['h', 'r'], text }]);
            } else if (session.text !== text) {
                session.font.update([{ faces: ['h', 'r'], text }]);
            }
            session.text = text;
            if (session.stopTracking) schedulePosition(session);
        }
    }, [anchor, children, content, enabled, gap, hide, mounted, needsFont, open, placement, text]);

    if (!enabled) return children;

    const describedBy = child.props['aria-describedby'];
    const props: TriggerProps = {
        ref: setTriggerRef,
        'aria-describedby': mounted ? [describedBy, id].filter(Boolean).join(' ') : describedBy,
        'aria-description': child.props['aria-description'] ?? (mounted || describedBy ? undefined : plainText),
    };

    if (visible === undefined) {
        const press = trigger === 'press';
        props.onFocus = (event) => {
            if (event.target.matches(':focus-visible')) show();
            child.props.onFocus?.(event);
        };
        props.onBlur = (event) => {
            hide();
            child.props.onBlur?.(event);
        };
        props.onPointerEnter = (event) => {
            if (event.pointerType !== 'touch') show();
            child.props.onPointerEnter?.(event);
        };
        props.onPointerLeave = (event) => {
            // Touch may leave before the click that opens help.
            if (!press || event.pointerType !== 'touch') hide();
            child.props.onPointerLeave?.(event);
        };
        if (!press) {
            props.onPointerDown = (event) => {
                hide(true);
                child.props.onPointerDown?.(event);
            };
        }
        props.onClick = (event) => {
            if (press && !sessionRef.current?.stopTracking) show();
            else hide(true);
            child.props.onClick?.(event);
        };
    }

    return (
        <>
            {cloneElement(child, props)}
            {mounted && (
                <span
                    ref={popoverRef}
                    id={id}
                    role="tooltip"
                    popover="manual"
                    className={`${styles.popoverTooltip} ${variant === 'image' ? styles.imgInner : styles.txtInner}`}
                >
                    {content}
                </span>
            )}
        </>
    );
}
