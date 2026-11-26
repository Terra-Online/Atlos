import { useLayoutEffect, useRef, useState, type RefObject } from 'react';

interface Options {
    targetRef: RefObject<HTMLElement | null>;
    contentRef?: RefObject<HTMLElement | null>;
    ownerDocument: Document | null;
    active?: boolean;
}

export function useScrollEdges({ targetRef, contentRef, ownerDocument, active = true }: Options) {
    const [edges, setEdges] = useState({ top: false, bottom: false });
    const previous = useRef(edges);

    useLayoutEffect(() => {
        const viewport = targetRef.current;
        if (!active || !viewport) return;
        const view = viewport.ownerDocument.defaultView ?? ownerDocument?.defaultView ?? window;
        let frame: number | undefined;
        const update = () => {
            const { scrollTop, scrollHeight, clientHeight } = viewport;
            const top = scrollTop > 1;
            const bottom = scrollTop + clientHeight < scrollHeight - 1;
            if (top === previous.current.top && bottom === previous.current.bottom) return;
            previous.current = { top, bottom };
            setEdges(previous.current);
        };
        const schedule = () => {
            if (frame !== undefined) return;
            frame = view.requestAnimationFrame(() => {
                frame = undefined;
                update();
            });
        };

        update();
        const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
        observer?.observe(viewport);
        // A scroller at a fixed height keeps the same box when its content grows.
        const content = contentRef?.current;
        if (content) observer?.observe(content);
        viewport.addEventListener('scroll', schedule, { passive: true });
        return () => {
            if (frame !== undefined) view.cancelAnimationFrame(frame);
            observer?.disconnect();
            viewport.removeEventListener('scroll', schedule);
        };
    }, [active, contentRef, ownerDocument, targetRef]);

    return edges;
}
