import { useCallback, useEffect, useRef } from 'react';
import { useAuthStore } from '@/store/auth';

/** A UI request belongs to both this mount and the exact authentication session. */
export function useRequestOwner() {
    const version = useAuthStore((state) => state.sessionVersion);
    const lifetime = useRef<object | null>(null);
    useEffect(() => {
        lifetime.current = {};
        return () => { lifetime.current = null; };
    }, []);
    return useCallback(() => {
        const owner = lifetime.current;
        return () => owner !== null && lifetime.current === owner
            && useAuthStore.getState().sessionVersion === version;
    }, [version]);
}
