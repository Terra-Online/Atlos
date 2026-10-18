import { useEffect, useRef, type RefObject } from 'react';

interface Options {
    rootRef: RefObject<Element | null>;
    targetRef: RefObject<Element | null>;
    enabled: boolean;
    onNear: () => void;
    rootMargin?: string;
}

/**
 * Run a callback when a list sentinel approaches its scroll viewport.
 *
 * The callback is kept in a ref so pagination state changes do not require
 * tearing down the observer on every render. Consumers still own the
 * in-flight guard and decide whether the callback should do work.
 */
export function useNearViewport({
    rootRef,
    targetRef,
    enabled,
    onNear,
    rootMargin = '0px 0px 320px',
}: Options): void {
    const callbackRef = useRef(onNear);
    useEffect(() => {
        callbackRef.current = onNear;
    }, [onNear]);

    useEffect(() => {
        if (!enabled || typeof IntersectionObserver === 'undefined')
            return undefined;
        const target = targetRef.current;
        if (!target) return undefined;

        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    callbackRef.current();
                }
            },
            {
                root: rootRef.current,
                rootMargin,
                threshold: 0,
            },
        );
        observer.observe(target);
        return () => observer.disconnect();
    }, [enabled, rootMargin, rootRef, targetRef]);
}
