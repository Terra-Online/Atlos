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
    restoreFocus?: boolean;
    closeOnEscape?: boolean;
    closeOnOutside?: boolean;
    onDismiss: () => void;
}

export function useOverlayLayer({ present, ownerDocument, active = true, elementRef, focusRef, triggerRef, modal, restoreFocus, closeOnEscape, closeOnOutside, onDismiss }: Options) {
    const current = useRef({ onDismiss, active });
    const layer = useRef<ReturnType<typeof registerOverlay> | null>(null);
    current.current = { onDismiss, active };
    useLayoutEffect(() => {
        const element = elementRef.current;
        if (!present || !element) return undefined;
        const registration = registerOverlay({
            element, focusElement: focusRef?.current, trigger: triggerRef?.current, modal, active: current.current.active, restoreFocus, closeOnEscape, closeOnOutside,
            onDismiss: () => current.current.onDismiss(),
        });
        layer.current = registration;
        return () => { registration.dispose(); layer.current = null; };
    }, [present, ownerDocument, elementRef, focusRef, triggerRef, modal, restoreFocus, closeOnEscape, closeOnOutside]);
    useLayoutEffect(() => { layer.current?.setActive(active); }, [active, present, ownerDocument]);
    return { isTop: () => layer.current?.isTop() ?? false };
}
