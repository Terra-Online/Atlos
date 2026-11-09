import { useEffect, useState } from 'react';
import { retryLoad } from '../async/retryLoad';

/** Load on intent, retry transport failures, and abandon work when its owner closes. */
export function useRetryImport<T>(load: () => Promise<T>, active: boolean, delay = 800): T | null {
    const [loaded, setLoaded] = useState<{ value: T } | null>(null);
    useEffect(() => {
        if (!active || loaded) return undefined;
        const controller = new AbortController();
        void retryLoad(load, { signal: controller.signal, delay }).then((value) => {
            if (!controller.signal.aborted) setLoaded({ value });
        }).catch(() => {
            // Cancellation belongs to this owner; transport failures retry inside retryLoad.
        });
        return () => controller.abort();
    }, [active, delay, load, loaded]);
    return loaded ? loaded.value : null;
}
