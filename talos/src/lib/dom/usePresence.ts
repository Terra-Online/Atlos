import { useCallback, useEffect, useRef, useState } from 'react';

type Phase = 'unmounted' | 'entering' | 'open' | 'exiting';
interface Options {
    open: boolean;
    exitDuration: number;
    animateOnOpen?: boolean;
    retainOnExit?: boolean;
    onAfterClose?: () => void;
}

/** Retain exiting DOM while keeping interrupted exits and their callbacks cancellable. */
export function usePresence({ open, exitDuration, animateOnOpen = true, retainOnExit = true, onAfterClose }: Options) {
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
            if (!animateOnOpen) return undefined;
            const frame = requestAnimationFrame(() => setPhase('open'));
            return () => cancelAnimationFrame(frame);
        }
        if (!mounted.current) return undefined;
        if (!retainOnExit || exitDuration <= 0) {
            finishExit();
            return undefined;
        }
        setPhase('exiting');
        const timer = window.setTimeout(finishExit, exitDuration);
        return () => window.clearTimeout(timer);
    }, [open, animateOnOpen, retainOnExit, exitDuration, finishExit]);

    return { phase, present: phase !== 'unmounted', visible: phase === 'open', finishExit };
}
