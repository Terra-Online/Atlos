import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { animate, useMotionValue, useMotionValueEvent } from 'motion/react';
import { useDrag } from '@use-gesture/react';
import { useAppDocument } from '@/platform/pictureInPicture';
import styles from './drawer.module.scss';

type Length = number | `${number}px` | `${number}rem`;

interface Props {
    snapPoints: readonly Length[];
    snapIndex?: number;
    defaultSnapIndex?: number;
    /** Called when the user chooses a stop. Controlled callers update snapIndex. */
    onSnapChange?: (index: number) => void;
    appearance?: 'panel' | 'tools';
    handleSize?: Length;
    bottomOffset?: CSSProperties['bottom'];
    disabled?: boolean;
    children?: ReactNode;
}

const IGNORED_TARGET = 'button, a, input, textarea, select, label, [role="button"], [role="link"], [contenteditable="true"], [data-drag-handle], [data-drawer-drag-ignore="true"]';
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function useRemPx(needed: boolean, doc: Document | null) {
    const [rem, setRem] = useState(16);
    useLayoutEffect(() => {
        const view = doc?.defaultView;
        if (!needed || !doc || !view) return;

        const probe = doc.createElement('span');
        probe.setAttribute('aria-hidden', 'true');
        probe.style.cssText = 'position:absolute;width:1rem;height:1rem;visibility:hidden;pointer-events:none';
        doc.documentElement.appendChild(probe);
        const measure = () => setRem(probe.getBoundingClientRect().height || parseFloat(view.getComputedStyle(doc.documentElement).fontSize) || 16);
        measure();
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
        observer?.observe(probe);
        view.addEventListener('resize', measure);
        return () => {
            observer?.disconnect();
            view.removeEventListener('resize', measure);
            probe.remove();
        };
    }, [doc, needed]);
    return rem;
}

function scrollableAncestors(target: Element, drawer: HTMLElement) {
    const view = drawer.ownerDocument.defaultView;
    const result: HTMLElement[] = [];
    for (let node: Element | null = target; node && node !== drawer; node = node.parentElement) {
        if (!(node instanceof (view?.HTMLElement ?? HTMLElement))) continue;
        const overflow = view?.getComputedStyle(node).overflowY;
        if ((overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay')
            && node.scrollHeight > node.clientHeight + 1) result.push(node);
    }
    return result;
}

function nearestStop(stops: number[], position: number) {
    return stops.reduce((best, height, index) => (
        Math.abs(height - position) < Math.abs(stops[best] - position) ? index : best
    ), 0);
}

interface Gesture {
    from: number;
    index: number;
    scrollables: HTMLElement[];
    restore?: () => void;
}

export default function Drawer({
    snapPoints,
    snapIndex,
    defaultSnapIndex = 0,
    onSnapChange,
    appearance = 'panel',
    handleSize = '1rem',
    bottomOffset = 0,
    disabled = false,
    children,
}: Props) {
    const doc = useAppDocument();
    const rem = useRemPx(snapPoints.some((point) => typeof point === 'string' && point.endsWith('rem')), doc);
    const stops = useMemo(() => {
        const px = snapPoints.map((point) => typeof point === 'number' ? point : parseFloat(point) * (point.endsWith('rem') ? rem : 1));
        const valid = px.filter(Number.isFinite).map((value) => Math.max(0, value));
        return [...new Set(valid.length ? valid : [0])].sort((a, b) => a - b);
    }, [rem, snapPoints]);
    const [localIndex, setLocalIndex] = useState(defaultSnapIndex);
    const index = clamp(Math.trunc(snapIndex ?? localIndex) || 0, 0, stops.length - 1);
    const min = stops[0];
    const max = stops[stops.length - 1];
    const height = stops[index];
    const size = useMotionValue(height);
    const drawerRef = useRef<HTMLDivElement>(null);
    const handleRef = useRef<HTMLButtonElement>(null);
    const contentId = useId();
    const gesture = useRef<Gesture | null>(null);
    const destination = useRef<{ index: number; height: number } | null>(null);

    const paint = useCallback((value: number) => {
        const drawer = drawerRef.current;
        if (!drawer) return;
        const progress = clamp((value - min) / Math.max(1, max - min), 0, 1);
        drawer.style.setProperty('--drawer-size', `${value}px`);
        drawer.style.setProperty('--drawer-progress', String(progress));
        drawer.dataset.expanded = String(value > min + 0.5);
    }, [min, max]);
    useMotionValueEvent(size, 'change', paint);

    const settle = useCallback((nextIndex: number, target: number) => {
        if (destination.current?.index === nextIndex && destination.current.height === target) return;
        const drawer = drawerRef.current;
        if (!drawer) return;
        const next = { index: nextIndex, height: target };
        destination.current = next;
        size.stop();
        const finish = () => {
            if (destination.current !== next) return;
            drawer.dataset.snap = String(nextIndex);
        };

        if (Math.abs(size.get() - target) <= 0.5
            || drawer.ownerDocument.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
            size.set(target);
            finish();
            return;
        }
        delete drawer.dataset.snap;
        animate(size, target, { duration: 0.22, ease: 'easeOut', onComplete: finish });
    }, [size]);

    const release = useCallback(() => {
        const current = gesture.current;
        gesture.current = null;
        current?.restore?.();
    }, []);

    useLayoutEffect(() => () => {
        release();
        size.stop();
        destination.current = null;
    }, [release, size]);

    useLayoutEffect(() => {
        if (disabled) release();
        paint(size.get());
        if (!gesture.current?.restore) settle(index, height);
    }, [disabled, height, index, paint, release, settle, size]);

    const choose = (next: number) => {
        if (next === index) {
            settle(index, height);
            return;
        }
        if (snapIndex === undefined) {
            setLocalIndex(next);
            settle(next, stops[next]);
        } else {
            // Restore the selected stop if the parent declines the request.
            settle(index, height);
        }
        onSnapChange?.(next);
    };

    useDrag(({ first, last, movement: [, y], cancel, canceled, intentional, event }) => {
        const drawer = drawerRef.current;
        const handle = handleRef.current;
        if (!drawer || !handle) return;

        if (first) {
            const target = event.target as Element | null;
            if (disabled || !target || (!handle.contains(target) && target.closest(IGNORED_TARGET))) {
                cancel();
                return;
            }
            gesture.current = { from: size.get(), index, scrollables: scrollableAncestors(target, drawer) };
        }

        const current = gesture.current;
        if (!current) return;
        if (last && (!intentional || canceled || event.type.endsWith('cancel'))) {
            release();
            settle(index, height);
            return;
        }
        if (!intentional) return;

        const canScroll = current.scrollables.some((node) => y > 0
            ? node.scrollTop > 1
            : y < 0 && node.scrollTop + node.clientHeight < node.scrollHeight - 1);
        if (canScroll) {
            release();
            settle(index, height);
            cancel();
            return;
        }

        if (!current.restore) {
            size.stop();
            destination.current = null;
            delete drawer.dataset.snap;
            handle.dataset.dragging = 'true';
            const { touchAction, overscrollBehavior } = drawer.style;
            drawer.style.touchAction = 'none';
            drawer.style.overscrollBehavior = 'contain';
            current.restore = () => {
                drawer.style.touchAction = touchAction;
                drawer.style.overscrollBehavior = overscrollBehavior;
                delete handle.dataset.dragging;
            };
        }

        const next = clamp(current.from - y, min, max);
        size.set(next);
        if (event.cancelable) event.preventDefault();
        if (!last) return;

        release();
        // A stop selected by the parent while dragging takes effect on release.
        choose(current.index === index ? nearestStop(stops, next) : index);
    }, {
        target: drawerRef,
        axis: 'y',
        filterTaps: true,
        threshold: 8,
        pointer: { touch: true },
        eventOptions: { passive: false },
    });

    const style = {
        bottom: bottomOffset,
        '--handle-size': typeof handleSize === 'number' ? `${handleSize}px` : handleSize,
    } as CSSProperties;

    return (
        <div ref={drawerRef} className={styles.drawer} data-drawer={appearance} data-font-region="drawer" style={style}>
            <button
                ref={handleRef}
                type="button"
                className={styles.handle}
                data-drawer-handle
                aria-label="Drawer drag handle"
                aria-controls={contentId}
                aria-expanded={index > 0}
                disabled={disabled}
                onClick={(event) => {
                    event.stopPropagation();
                    if (!gesture.current?.restore) choose((index + 1) % stops.length);
                }}
            />
            <div id={contentId} className={styles.content}>{children}</div>
            <div className={styles.backdrop} aria-hidden="true" />
        </div>
    );
}
