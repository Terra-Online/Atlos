import { useAuthStore } from '@/store/auth';
import { fetchSessionUser } from './client';
import type { SessionUser } from './types';
import { SESSION_REVALIDATE_EVENT } from './sessionEvents';

const SESSION_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const SESSION_RETRY_INTERVAL_MS = 60 * 1000;

let inFlight: { version: number; promise: Promise<SessionUser | null> } | null = null;
let lastAttemptAt = Number.NEGATIVE_INFINITY;
let lastAttemptSucceeded = false;
let revalidationRequested = false;

export const refreshSessionUser = (): Promise<SessionUser | null> => {
    const version = useAuthStore.getState().sessionVersion;
    if (inFlight?.version === version) return inFlight.promise;

    lastAttemptAt = Date.now();
    const promise = fetchSessionUser()
        .then((user) => {
            const state = useAuthStore.getState();
            if (state.sessionVersion !== version) return state.sessionUser;
            state.setSessionUser(user);
            lastAttemptSucceeded = true;
            revalidationRequested = false;
            return user;
        })
        .catch((error: unknown) => {
            if (useAuthStore.getState().sessionVersion === version) {
                lastAttemptSucceeded = false;
            }
            throw error;
        })
        .finally(() => {
            if (inFlight?.promise === promise) inFlight = null;
        });
    inFlight = { version, promise };
    return promise;
};

export const revalidateSession = (): void => {
    if (typeof document === 'undefined' || document.visibilityState === 'hidden') return;
    if (lastAttemptSucceeded && !useAuthStore.getState().sessionUser) return;
    const minIntervalMs = lastAttemptSucceeded && !revalidationRequested
        ? SESSION_CHECK_INTERVAL_MS
        : SESSION_RETRY_INTERVAL_MS;
    if (!navigator.onLine || Date.now() - lastAttemptAt < minIntervalMs) return;
    if (new URL(window.location.href).searchParams.get('auth_code')?.trim()) return;
    void refreshSessionUser().catch(() => undefined);
};

export const startSessionRefresh = (): (() => void) => {
    const onResume = () => revalidateSession();
    const onUnauthorized = () => {
        if (!useAuthStore.getState().sessionUser) return;
        revalidationRequested = true;
        revalidateSession();
    };
    window.addEventListener('focus', onResume);
    window.addEventListener('online', onResume);
    window.addEventListener(SESSION_REVALIDATE_EVENT, onUnauthorized);
    document.addEventListener('visibilitychange', onResume);
    window.addEventListener('pointerdown', onResume, { capture: true, passive: true });
    window.addEventListener('keydown', onResume, { capture: true, passive: true });
    window.addEventListener('wheel', onResume, { capture: true, passive: true });

    return () => {
        window.removeEventListener('focus', onResume);
        window.removeEventListener('online', onResume);
        window.removeEventListener(SESSION_REVALIDATE_EVENT, onUnauthorized);
        document.removeEventListener('visibilitychange', onResume);
        window.removeEventListener('pointerdown', onResume, true);
        window.removeEventListener('keydown', onResume, true);
        window.removeEventListener('wheel', onResume, true);
    };
};
