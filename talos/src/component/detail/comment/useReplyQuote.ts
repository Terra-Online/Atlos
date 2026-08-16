import { useCallback, useEffect, useRef, useState } from 'react';
import type { UGCComment } from '@/services/ugc/client';

export const useReplyQuote = (duration: number) => {
    const timerRef = useRef<number | undefined>(undefined);
    const [target, setTarget] = useState<UGCComment | null>(null);
    const [rendered, setRendered] = useState<UGCComment | null>(null);
    const [visible, setVisible] = useState(false);

    useEffect(() => {
        if (timerRef.current) {
            window.clearTimeout(timerRef.current);
            timerRef.current = undefined;
        }

        if (target) {
            setRendered(target);
            const frameId = window.requestAnimationFrame(() => setVisible(true));
            return () => window.cancelAnimationFrame(frameId);
        }

        setVisible(false);
        timerRef.current = window.setTimeout(() => {
            setRendered(null);
            timerRef.current = undefined;
        }, duration);

        return () => {
            if (timerRef.current) {
                window.clearTimeout(timerRef.current);
                timerRef.current = undefined;
            }
        };
    }, [duration, target]);

    const clear = useCallback(() => setTarget(null), []);

    return {
        target,
        setTarget,
        clear,
        rendered,
        setRendered,
        visible,
    };
};
