import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import classNames from 'classnames';
import IconButton from '@/component/button/IconButton';
import { registerOverlay } from '@/lib/dom/overlay';
import { useAppDocument } from '@/platform/pictureInPicture';
import PopoverTooltip from '@/component/popover/popover';
import styles from './ActionBar.module.scss';

export type ActionBarItem = {
    id: string;
    label: string;
    icon: ReactNode;
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
    ariaLabel?: string;
};

type FloatingProps = Props & { onDismiss?: () => void } & (
    | { targetRef: RefObject<HTMLElement | null>; selection?: never }
    | { targetRef?: never; selection: DOMRect | null }
);

const stopPropagation = (event: { stopPropagation(): void }) => event.stopPropagation();

function Actions({ items, onPointerDown }: Pick<Props, 'items'> & {
    onPointerDown?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
}) {
    return items.map((item) => (
        <PopoverTooltip key={item.tooltipKey ?? item.id} content={item.label} placement="top" gap={4} visible={item.tooltipVisible}>
            <IconButton
                label={item.label}
                className={styles.shortActionButton}
                data-action={item.id}
                data-active={item.active ? 'true' : 'false'}
                data-confirming={item.confirming ? 'true' : 'false'}
                disabled={item.disabled}
                pressed={item.active}
                onPointerDown={onPointerDown}
                onClick={(event) => {
                    event.stopPropagation();
                    item.onClick?.();
                }}
            >
                <span className={classNames(styles.shortActionIcon, item.iconClassName)}>{item.icon}</span>
            </IconButton>
        </PopoverTooltip>
    ));
}

const ActionBar = memo(function ActionBar({ items, className, ariaLabel = 'Actions' }: Props) {
    if (items.length === 0) return null;

    return (
        <div
            className={classNames(styles.shortActions, className)}
            role="toolbar"
            aria-label={ariaLabel}
            onClick={stopPropagation}
            onPointerDown={stopPropagation}
        >
            <Actions items={items} />
        </div>
    );
});

const VIEWPORT_MARGIN = 4;
const CLOSE_MS = 120;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const contains = (element: Element | null | undefined, target: EventTarget | null | undefined): boolean => (
    Boolean(target && 'nodeType' in target && element?.contains(target as Node))
);
const isTouch = (event: Pick<PointerEvent, 'pointerType'>, view: Window) => (
    event.pointerType === 'touch' || event.pointerType === 'pen'
    || (event.pointerType === '' && Boolean(view.matchMedia?.('(hover: none)')?.matches))
);

const idle = () => ({ targetHover: false, layerHover: false, targetFocus: false, layerFocus: false, pinned: false });

function FloatingLayer({ items, className, ariaLabel = 'Actions', targetRef, selection, onDismiss, doc }: FloatingProps & { doc: Document }) {
    const view = doc.defaultView ?? window;
    const anchor = useRef<HTMLSpanElement>(null);
    const layer = useRef<HTMLDivElement>(null);
    const shown = useRef<HTMLDivElement | null>(null);
    const overlay = useRef<ReturnType<typeof registerOverlay> | null>(null);
    const timers = useRef<{ exit?: number; focus?: number; frame?: number }>({});
    const interaction = useRef(idle());
    const [open, setOpen] = useState(false);
    const current = useRef({ selection, onDismiss });
    useLayoutEffect(() => {
        current.current = { selection, onDismiss };
    }, [selection, onDismiss]);

    const clearPending = useCallback(() => {
        view.clearTimeout(timers.current.exit);
        view.clearTimeout(timers.current.focus);
        if (timers.current.frame !== undefined) view.cancelAnimationFrame(timers.current.frame);
        timers.current = {};
    }, [view]);

    const position = useCallback(() => {
        const element = layer.current;
        if (!element || element.dataset.open !== 'true') return;
        const selection = current.current.selection;
        const rect = selection ?? anchor.current?.getBoundingClientRect();
        if (!rect) return;
        const width = element.offsetWidth, height = element.offsetHeight;
        const left = selection ? rect.left + (rect.width - width) / 2 : rect.right - width;
        const top = selection ? (rect.top >= height + 8 ? rect.top - height - 8 : rect.bottom + 8) : rect.top;
        element.style.left = `${clamp(left, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, view.innerWidth - width - VIEWPORT_MARGIN))}px`;
        element.style.top = `${clamp(top, VIEWPORT_MARGIN, Math.max(VIEWPORT_MARGIN, view.innerHeight - height - VIEWPORT_MARGIN))}px`;
    }, [view]);

    const schedulePosition = useCallback(() => {
        if (timers.current.frame !== undefined) view.cancelAnimationFrame(timers.current.frame);
        timers.current.frame = view.requestAnimationFrame(() => {
            timers.current.frame = undefined;
            position();
        });
    }, [position, view]);

    const hide = useCallback((immediate = false, notify = true) => {
        const element = shown.current;
        if (!element) return;
        const wasOpen = element.dataset.open === 'true';
        if (!wasOpen && !immediate) return;
        clearPending();
        element.dataset.open = 'false';
        overlay.current?.dispose();
        overlay.current = null;
        element.setAttribute('inert', '');
        if (wasOpen) setOpen(false);

        const finish = () => {
            element.hidePopover?.();
            element.classList.remove(styles.floatingLayerClosing);
            interaction.current = idle();
            shown.current = null;
        };
        if (immediate || !element.matches(':popover-open')) {
            finish();
        } else {
            element.classList.add(styles.floatingLayerClosing);
            timers.current.exit = view.setTimeout(finish, CLOSE_MS);
        }
        if (wasOpen && notify) current.current.onDismiss?.();
    }, [clearPending, view]);

    const show = useCallback(() => {
        const element = layer.current;
        if (!element?.showPopover || !element.isConnected) return;
        if (!targetRef && !current.current.selection) return;
        clearPending();
        element.removeAttribute('inert');
        element.classList.remove(styles.floatingLayerClosing);
        if (!element.matches(':popover-open')) element.showPopover();
        element.dataset.open = 'true';
        shown.current = element;
        if (!overlay.current) overlay.current = registerOverlay({
            element, trigger: targetRef?.current, onDismiss: () => hide(true),
        });
        setOpen(true);
        position();
        schedulePosition();
    }, [clearPending, hide, position, schedulePosition, targetRef]);

    useLayoutEffect(() => () => {
        // The captured layer owns its registration even after React clears its ref.
        hide(true, false);
    }, [doc, hide]);

    useLayoutEffect(() => {
        if (targetRef) return;
        if (selection) show();
        else hide(false, false);
    }, [hide, selection, show, targetRef, doc]);

    const closeWhenIdle = useCallback(() => {
        if (!Object.values(interaction.current).some(Boolean)) hide();
    }, [hide]);

    const checkFocus = useCallback(() => {
        view.clearTimeout(timers.current.focus);
        timers.current.focus = view.setTimeout(() => {
            const active = doc.activeElement;
            interaction.current.targetFocus = contains(targetRef?.current, active);
            interaction.current.layerFocus = contains(layer.current, active);
            closeWhenIdle();
        }, 0);
    }, [closeWhenIdle, doc, targetRef, view]);

    useEffect(() => {
        const target = targetRef?.current;
        if (!target) return;
        const pin = (event: PointerEvent) => {
            if (!isTouch(event, view)) return;
            interaction.current = { ...idle(), pinned: true, targetHover: true };
            show();
        };
        const enter = (event: PointerEvent) => {
            if (isTouch(event, view)) return;
            interaction.current.targetHover = true;
            show();
        };
        const leave = (event: PointerEvent) => {
            if (isTouch(event, view)) return;
            interaction.current.targetHover = false;
            if (!contains(layer.current, event.relatedTarget)) closeWhenIdle();
        };
        const focus = () => {
            interaction.current.targetFocus = true;
            show();
        };
        target.addEventListener('pointerdown', pin);
        target.addEventListener('pointerenter', enter);
        target.addEventListener('pointerleave', leave);
        target.addEventListener('focusin', focus);
        target.addEventListener('focusout', checkFocus);
        return () => {
            target.removeEventListener('pointerdown', pin);
            target.removeEventListener('pointerenter', enter);
            target.removeEventListener('pointerleave', leave);
            target.removeEventListener('focusin', focus);
            target.removeEventListener('focusout', checkFocus);
            view.clearTimeout(timers.current.focus);
        };
    }, [checkFocus, closeWhenIdle, show, targetRef, doc, view]);

    useEffect(() => {
        if (!open) return;
        const hit = (event: PointerEvent) => {
            const realTarget = doc.elementFromPoint?.(event.clientX, event.clientY);
            const over = (element?: Element | null) => contains(element, event.target) || contains(element, realTarget);
            return { targetHover: over(targetRef?.current), layerHover: over(layer.current) };
        };
        const pointerMove = (event: PointerEvent) => {
            if (!targetRef || (interaction.current.pinned && isTouch(event, view))) return;
            Object.assign(interaction.current, hit(event));
            closeWhenIdle();
        };
        const pointerDown = (event: PointerEvent) => {
            const { targetHover, layerHover } = hit(event);
            if (!targetHover && !layerHover) hide(true);
        };
        const scroll = () => {
            schedulePosition();
            if (!targetRef) return;
            interaction.current.targetHover = Boolean(targetRef.current?.matches(':hover'));
            interaction.current.layerHover = Boolean(layer.current?.matches(':hover'));
            closeWhenIdle();
        };
        const blur = () => hide(true);
        const visibility = () => { if (doc.visibilityState !== 'visible') blur(); };
        doc.addEventListener('pointermove', pointerMove, true);
        doc.addEventListener('pointerdown', pointerDown, true);
        doc.addEventListener('visibilitychange', visibility);
        view.addEventListener('blur', blur);
        view.addEventListener('resize', schedulePosition);
        view.addEventListener('scroll', scroll, true);
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedulePosition);
        if (layer.current) observer?.observe(layer.current);
        if (targetRef?.current) observer?.observe(targetRef.current);
        return () => {
            doc.removeEventListener('pointermove', pointerMove, true);
            doc.removeEventListener('pointerdown', pointerDown, true);
            doc.removeEventListener('visibilitychange', visibility);
            view.removeEventListener('blur', blur);
            view.removeEventListener('resize', schedulePosition);
            view.removeEventListener('scroll', scroll, true);
            observer?.disconnect();
        };
    }, [closeWhenIdle, doc, hide, open, schedulePosition, targetRef, view]);

    return (
        <>
            {targetRef && <span ref={anchor} className={styles.floatingAnchor} aria-hidden="true" />}
            {createPortal(
                <div
                    ref={layer}
                    className={classNames(styles.shortActions, styles.floatingLayer, className)}
                    role="toolbar"
                    aria-label={ariaLabel}
                    popover="manual"
                    onClick={stopPropagation}
                    onPointerDown={stopPropagation}
                    onPointerEnter={(event) => {
                        if (!targetRef || isTouch(event, view)) return;
                        interaction.current.pinned = false;
                        interaction.current.layerHover = true;
                        show();
                    }}
                    onPointerLeave={(event) => {
                        if (!targetRef || isTouch(event, view)) return;
                        interaction.current.layerHover = false;
                        if (!contains(targetRef.current, event.relatedTarget)) closeWhenIdle();
                    }}
                    onFocus={() => {
                        interaction.current.layerFocus = true;
                        show();
                    }}
                    onBlur={targetRef ? checkFocus : undefined}
                >
                    <Actions items={items} onPointerDown={(event) => {
                        event.stopPropagation();
                        if (!targetRef || event.pointerType !== 'touch') event.preventDefault();
                        interaction.current.targetFocus = false;
                        interaction.current.layerFocus = false;
                    }} />
                </div>,
                doc.body,
            )}
        </>
    );
}

export function FloatingActionBar(props: FloatingProps) {
    const doc = useAppDocument();
    if (!doc || props.items.length === 0) return null;
    return <FloatingLayer {...props} doc={doc} />;
}

export default ActionBar;
