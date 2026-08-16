import type { SessionUser } from '@/services/auth';
import type { EFBindingSummary } from '@/services/endfield/backendClient';

const CACHE_KEY = 'talos:backendCache';
const CACHE_VER = 1;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type SessionSnap = {
    ts: number;
    value: SessionUser | null;
};

type BindingSnap = {
    ts: number;
    uid: string;
    value: EFBindingSummary | null;
};

type BackendCache = {
    ver: number;
    session?: SessionSnap;
    binding?: BindingSnap;
};

type CacheHit<T> = {
    hit: boolean;
    value: T;
};

let sessionMemory: SessionUser | null = null;
let sessionMemoryHit = false;

const isFresh = (ts: number): boolean => (Date.now() - ts) <= CACHE_TTL_MS;

const readCache = (): BackendCache => {
    if (typeof window === 'undefined' || !('localStorage' in window)) {
        return { ver: CACHE_VER };
    }
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return { ver: CACHE_VER };

    try {
        const parsed = JSON.parse(raw) as Partial<BackendCache>;
        if (parsed.ver !== CACHE_VER) {
            return { ver: CACHE_VER };
        }
        return {
            ver: CACHE_VER,
            session: parsed.session,
            binding: parsed.binding,
        };
    } catch {
        return { ver: CACHE_VER };
    }
};

const writeCache = (cache: BackendCache): void => {
    if (typeof window === 'undefined' || !('localStorage' in window)) {
        return;
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
};

export const getCachedSession = (): CacheHit<SessionUser | null> => {
    return sessionMemoryHit ? { hit: true, value: sessionMemory } : { hit: false, value: null };
};

export const setCachedSession = (value: SessionUser | null): void => {
    sessionMemory = value;
    sessionMemoryHit = true;
};

export const getCachedBinding = (uid?: string | null): CacheHit<EFBindingSummary | null> => {
    const cache = readCache();
    if (!uid || !cache.binding || !isFresh(cache.binding.ts) || cache.binding.uid !== uid) {
        return { hit: false, value: null };
    }
    return { hit: true, value: cache.binding.value };
};

export const setCachedBinding = (uid: string, value: EFBindingSummary | null): void => {
    const cache = readCache();
    writeCache({
        ...cache,
        binding: {
            ts: Date.now(),
            uid,
            value,
        },
    });
};
