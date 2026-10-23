import { usePresence } from '@/lib/dom/usePresence';
import { useCallback, useEffect, useState } from 'react';
import type { UGCComment } from '@/services/ugc/client';

export const useReplyQuote = (duration: number) => {
    const [target, setTarget] = useState<UGCComment | null>(null);
    const [rendered, setRendered] = useState<UGCComment | null>(null);
    const { visible } = usePresence({ open: target !== null, exitDuration: duration, onAfterClose: () => setRendered(null) });
    useEffect(() => {
        if (target) setRendered(target);
    }, [target]);

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
