import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { useAppDocument } from '@/platform/pictureInPicture';

/** A drag can outlive its separator when a breakpoint, PiP or filter changes. */
export function useDividerDrag(enabled: boolean) {
    const ownerDocument = useAppDocument();
    const cleanup = useRef<(() => void) | undefined>(undefined);
    const stop = useCallback(() => { cleanup.current?.(); cleanup.current = undefined; }, []);
    useEffect(() => stop, [enabled, ownerDocument, stop]);

    return (event: ReactPointerEvent, move: (event: PointerEvent) => void, finish: () => void) => {
        stop();
        const view = event.currentTarget.ownerDocument.defaultView;
        if (!enabled || !view) return;
        const pointerId = event.pointerId;
        const onMove = (next: PointerEvent) => { if (next.pointerId === pointerId) move(next); };
        const onEnd = (next: PointerEvent) => { if (next.pointerId === pointerId) end(); };
        const end = () => { stop(); finish(); };
        cleanup.current = () => {
            view.removeEventListener('pointermove', onMove);
            view.removeEventListener('pointerup', onEnd);
            view.removeEventListener('pointercancel', onEnd);
            view.removeEventListener('blur', end);
        };
        view.addEventListener('pointermove', onMove);
        view.addEventListener('pointerup', onEnd);
        view.addEventListener('pointercancel', onEnd);
        view.addEventListener('blur', end);
    };
}
