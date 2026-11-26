import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { useAppDocument } from '@/platform/pictureInPicture';

type BarRef = RefObject<HTMLDivElement | null>;
type IndicatorRef = RefObject<HTMLSpanElement | null>;

type Center = { key: string; x: number };
type Gesture = {
    id: number;
    x: number;
    y: number;
    drag?: { centers: Center[]; start: number; current: number; min: number; max: number };
};

const buttons = (bar: HTMLDivElement) =>
    Array.from(bar.querySelectorAll<HTMLButtonElement>(':scope > [data-tab]'));

// Measure in the scroll content's local coordinates. Scrolling or scaling the
// ancestor moves the indicator and buttons together without changing the center.
const centerOf = (button: HTMLButtonElement) => button.offsetLeft + button.offsetWidth / 2;

function moveIndicator(indicator: HTMLSpanElement | null, position: number) {
    if (!indicator) return;
    const value = `${position}px`;
    if (indicator.style.getPropertyValue('--tab-center') !== value)
        indicator.style.setProperty('--tab-center', value);
    if (!indicator.hasAttribute('data-positioned')) indicator.setAttribute('data-positioned', '');
}

function align(bar: HTMLDivElement, indicator: HTMLSpanElement | null, key: string) {
    const button = buttons(bar).find((tab) => tab.dataset.tab === key);
    if (button) moveIndicator(indicator, centerOf(button));
}

function touchById(touches: TouchList, id: number) {
    for (let index = 0; index < touches.length; index += 1) {
        const touch = touches.item(index);
        if (touch?.identifier === id) return touch;
    }
    return null;
}

export function useTabIndicator(
    barRef: BarRef,
    indicatorRef: IndicatorRef,
    layout: string,
    activeKey: string,
    onChange: (key: string) => void,
    swipeTargetRef?: RefObject<HTMLElement | null>,
) {
    const doc = useAppDocument();
    const selected = useRef(activeKey);
    const change = useRef(onChange);
    const gesture = useRef<Gesture | null>(null);

    useLayoutEffect(() => { change.current = onChange; }, [onChange]);

    useLayoutEffect(() => {
        const bar = barRef.current;
        selected.current = activeKey;
        gesture.current = null;
        bar?.removeAttribute('data-swiping');
        if (bar) align(bar, indicatorRef.current, activeKey);
    }, [activeKey, barRef, doc, indicatorRef, layout]);

    useLayoutEffect(() => {
        const bar = barRef.current;
        if (!bar) return;
        const view = bar.ownerDocument.defaultView ?? window;
        let frame: number | undefined;
        const schedule = () => {
            if (frame !== undefined || gesture.current?.drag) return;
            frame = view.requestAnimationFrame(() => {
                frame = undefined;
                if (!gesture.current?.drag) align(bar, indicatorRef.current, selected.current);
            });
        };
        // A preceding tab's width can move the selection even if the selected
        // tab and the scroll viewport keep their own sizes.
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
        observer?.observe(bar);
        for (const tab of buttons(bar)) observer?.observe(tab);
        if (!observer) view.addEventListener('resize', schedule);
        return () => {
            if (frame !== undefined) view.cancelAnimationFrame(frame);
            observer?.disconnect();
            if (!observer) view.removeEventListener('resize', schedule);
        };
    }, [barRef, doc, indicatorRef, layout]);

    useEffect(() => {
        const target = swipeTargetRef?.current;
        const bar = barRef.current;
        if (!target || !bar) return;

        const start = (event: TouchEvent) => {
            const touch = event.touches.length === 1 ? event.touches.item(0) : null;
            if (touch && !gesture.current?.drag)
                gesture.current = { id: touch.identifier, x: touch.clientX, y: touch.clientY };
        };
        const move = (event: TouchEvent) => {
            const current = gesture.current;
            if (!current) return;
            const touch = touchById(event.touches, current.id);
            if (!touch) return;
            const x = touch.clientX - current.x;
            const y = touch.clientY - current.y;
            if (!current.drag) {
                if (Math.max(Math.abs(x), Math.abs(y)) < 10) return;
                if (Math.abs(x) <= Math.abs(y) * 1.15) {
                    gesture.current = null;
                    return;
                }
                const centers = buttons(bar).filter((tab) => !tab.disabled).map((tab) => ({
                    key: tab.dataset.tab!,
                    x: centerOf(tab),
                }));
                const start = centers.find((tab) => tab.key === selected.current);
                if (!start || centers.length < 2) {
                    gesture.current = null;
                    return;
                }
                const offsets = centers.map((tab) => tab.x);
                current.drag = { centers, start: start.x, current: start.x, min: Math.min(...offsets), max: Math.max(...offsets) };
                bar.setAttribute('data-swiping', '');
            }
            const drag = current.drag;
            drag.current = Math.max(drag.min, Math.min(drag.max, drag.start - x));
            moveIndicator(indicatorRef.current, drag.current);
        };
        const finish = (event: TouchEvent) => {
            const current = gesture.current;
            if (!current || !touchById(event.changedTouches, current.id)) return;
            gesture.current = null;
            const drag = current.drag;
            if (!drag) return;
            bar.removeAttribute('data-swiping');
            const activeKey = selected.current;
            align(bar, indicatorRef.current, activeKey);
            if (event.type === 'touchcancel' || Math.abs(drag.current - drag.start) < 24) return;
            const closest = drag.centers.reduce((best, tab) =>
                Math.abs(tab.x - drag.current) < Math.abs(best.x - drag.current) ? tab : best);
            if (closest.key !== activeKey && buttons(bar).some((tab) => tab.dataset.tab === closest.key && !tab.disabled))
                change.current(closest.key);
        };
        const options = { capture: true, passive: true };
        target.addEventListener('touchstart', start, options);
        target.addEventListener('touchmove', move, options);
        target.addEventListener('touchend', finish, options);
        target.addEventListener('touchcancel', finish, options);
        return () => {
            target.removeEventListener('touchstart', start, true);
            target.removeEventListener('touchmove', move, true);
            target.removeEventListener('touchend', finish, true);
            target.removeEventListener('touchcancel', finish, true);
            gesture.current = null;
            bar.removeAttribute('data-swiping');
        };
    }, [barRef, doc, indicatorRef, layout, swipeTargetRef]);
}
