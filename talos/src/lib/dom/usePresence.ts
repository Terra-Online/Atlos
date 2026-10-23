import { useCallback, useEffect, useRef, useState } from 'react';

type Phase = 'unmounted' | 'entering' | 'open' | 'exiting';
interface Options {
    open: boolean;
    exitDuration: number;
    animateOnOpen?: boolean;
    retainOnExit?: boolean;
    onAfterClose?: () => void;
    ownerDocument?: Document | null;
}

/** Retain exiting DOM while keeping interrupted exits and their callbacks cancellable. */
export function usePresence({ open, exitDuration, animateOnOpen = true, retainOnExit = true, onAfterClose, ownerDocument }: Options) {
    const [phase, setPhase] = useState<Phase>(() => open ? (animateOnOpen ? 'entering' : 'open') : 'unmounted');
    const mounted = useRef(open);
    const requestedOpen = useRef(open);
    const afterClose = useRef(onAfterClose);
    requestedOpen.current = open;
    afterClose.current = onAfterClose;

    const finishExit = useCallback(() => {
        if (requestedOpen.current || !mounted.current) return;
        mounted.current = false;
        setPhase('unmounted');
        afterClose.current?.();
    }, []);

    useEffect(() => {
        if (open) {
            mounted.current = true;
            setPhase(animateOnOpen ? 'entering' : 'open');
            return undefined;
        }
        if (!mounted.current) return undefined;
        if (!retainOnExit || exitDuration <= 0) {
            finishExit();
            return undefined;
        }
        setPhase('exiting');
        return undefined;
    }, [open, animateOnOpen, retainOnExit, exitDuration, finishExit]);

    useEffect(() => {
        if (!open && phase === 'exiting') {
            const timer = window.setTimeout(finishExit, exitDuration);
            return () => window.clearTimeout(timer);
        }
        if (!open || phase !== 'entering') return undefined;
        // Start only after the entering DOM commits; leave a rendered start frame
        // so React batching cannot collapse mounting and the CSS transition target.
        const view = ownerDocument?.defaultView ?? window;
        let frame = view.requestAnimationFrame(() => {
            frame = view.requestAnimationFrame(() => setPhase('open'));
        });
        return () => view.cancelAnimationFrame(frame);
    }, [open, phase, ownerDocument, exitDuration, finishExit]);

    return { phase, present: phase !== 'unmounted', visible: phase === 'open', finishExit };
}
