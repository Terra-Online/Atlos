import { useLayoutEffect, useRef, type RefObject } from 'react';
import { registerOverlay } from './overlay';

interface Options {
    present: boolean;
    ownerDocument: Document | null;
    active?: boolean;
    elementRef: RefObject<HTMLElement | null>;
    focusRef?: RefObject<HTMLElement | null>;
    triggerRef?: RefObject<HTMLElement | null>;
    modal?: boolean;
    closeOnEscape?: boolean;
    closeOnOutside?: boolean;
    onDismiss: () => void;
}

export function useOverlayLayer({ present, ownerDocument, active = true, elementRef, focusRef, triggerRef, modal, closeOnEscape, closeOnOutside, onDismiss }: Options) {
    const callback = useRef(onDismiss);
    const enabled = useRef(active);
    const dismissed = useRef(false);
    const layer = useRef<ReturnType<typeof registerOverlay> | null>(null);
    callback.current = onDismiss;
    enabled.current = active;
    useLayoutEffect(() => { if (active) dismissed.current = false; }, [active]);
    useLayoutEffect(() => {
        const element = elementRef.current;
        if (!present || !element) return undefined;
        const registration = registerOverlay({
            element, focusElement: focusRef?.current, trigger: triggerRef?.current, modal, closeOnEscape, closeOnOutside,
            onDismiss: () => {
                if (!enabled.current || dismissed.current) return;
                dismissed.current = true;
                callback.current();
            },
        });
        layer.current = registration;
        return () => { registration.dispose(); layer.current = null; };
    }, [present, ownerDocument, elementRef, focusRef, triggerRef, modal, closeOnEscape, closeOnOutside]);
    return { isTop: () => layer.current?.isTop() ?? false };
}
