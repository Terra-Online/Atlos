import { useCallback, useEffect, useState } from 'react';
import { useAppDocument } from '@/platform/pictureInPicture';

/** Prepare closed sidebar categories in separate idle turns, ahead of the first animation. */
export function useSidebarPreparation(open: boolean, total: number) {
    const view = useAppDocument()?.defaultView;
    const [count, setCount] = useState(() => open ? total : 0);
    const [requested, setRequested] = useState(false);
    const prepare = useCallback(() => setRequested(true), []);
    useEffect(() => {
        if (!view || count >= total) return;
        // Intent shortens the initial delay, but each category still gets its own turn.
        const run = () => setCount(current => Math.min(total, current + 1));
        if (typeof view.requestIdleCallback === 'function') {
            const id = view.requestIdleCallback(run, { timeout: requested ? 100 : 1500 });
            return () => view.cancelIdleCallback(id);
        }
        const id = view.setTimeout(run, requested ? 16 : 100);
        return () => view.clearTimeout(id);
    }, [count, requested, total, view]);
    // An immediate click must still expose the complete controls and saved expansion state.
    return { preparedCount: open ? total : count, prepare };
}
