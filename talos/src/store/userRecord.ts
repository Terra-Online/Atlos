import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { useUiPrefsStore } from './uiPrefs';
import { createConditionalStorage } from '@/platform/storage';

interface IUserRecordStore {
    activePoints: string[];
    activeArchives: string[];
    updatedAt: number;
}

const STORAGE_KEY = 'points-storage';
const CHANNEL_NAME = 'atlos-intel-progress';
const normalizeIds = (value: unknown): string[] | undefined => Array.isArray(value)
    && value.every((id: unknown) => typeof id === 'string' || typeof id === 'number' && Number.isFinite(id))
    ? value.map(String) : undefined;

const mergeProgress = (value: unknown, current: IUserRecordStore): IUserRecordStore => {
    if (!value || typeof value !== 'object') return current;
    const persisted = value as Partial<IUserRecordStore>;
    const points = normalizeIds(persisted.activePoints), archives = normalizeIds(persisted.activeArchives);
    if (!points && !archives) return current;
    const keepSnapshot = (next: string[] | undefined, previous: string[]) => !next
        || next.length === previous.length && next.every((id, index) => id === previous[index]) ? previous : next;
    const activePoints = keepSnapshot(points, current.activePoints);
    const activeArchives = keepSnapshot(archives, current.activeArchives);
    const updatedAt = typeof persisted.updatedAt === 'number' && Number.isFinite(persisted.updatedAt) ? persisted.updatedAt : current.updatedAt;
    return activePoints === current.activePoints && activeArchives === current.activeArchives && updatedAt === current.updatedAt
        ? current : { ...current, activePoints, activeArchives, updatedAt };
};

export const useUserRecordStore = create<IUserRecordStore>()(
    persist<IUserRecordStore, [], [], Partial<IUserRecordStore>>(
        () => ({
            activePoints: [],
            activeArchives: [],
            updatedAt: Date.now(),
        }),
        {
            name: STORAGE_KEY,
            storage: createJSONStorage(() => createConditionalStorage(
                localStorage,
                () => useUiPrefsStore.getState().prefsMarkerProgressEnabled,
            )),
            partialize: (state) => ({
                activePoints: state.activePoints,
                activeArchives: state.activeArchives,
                updatedAt: state.updatedAt,
            }),
            // The preference controls new writes, not restoring existing progress.
            merge: mergeProgress,
        },
    ),
);

export function publishProgressChange(): void {
    try {
        const channel = new BroadcastChannel(CHANNEL_NAME);
        channel.postMessage({ updatedAt: Date.now() });
        channel.close();
    } catch {
        // Native storage events cover browsers without BroadcastChannel.
    }
}

/** Both apps read the persisted owner; duplicate notifications must not echo writes. */
export function observeProgressStorage(onPointChange?: () => void): () => void {
    let active = true;
    const refresh = () => {
        if (!active) return;
        let decoded: unknown;
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            if (!raw) return;
            decoded = JSON.parse(raw);
        } catch {
            // An invalid/blocked storage read must preserve live progress.
            return;
        }
        if (!decoded || typeof decoded !== 'object' || !('state' in decoded)) return;
        const previous = useUserRecordStore.getState();
        const next = mergeProgress(decoded.state, previous);
        if (next === previous) return;
        useUserRecordStore.setState(next);
        if (next.activePoints !== previous.activePoints) onPointChange?.();
    };
    const onStorage = (event: StorageEvent) => {
        if (event.key === STORAGE_KEY && (!event.storageArea || event.storageArea === localStorage)) refresh();
    };
    let channel: BroadcastChannel | null = null;
    try { channel = new BroadcastChannel(CHANNEL_NAME); channel.onmessage = refresh; } catch { /* Storage event fallback. */ }
    window.addEventListener('storage', onStorage);
    // Another tab may have written while startup was waiting for fonts/map data.
    refresh();
    return () => { active = false; window.removeEventListener('storage', onStorage); channel?.close(); };
}

// Auto-restore when preference is enabled
useUiPrefsStore.subscribe((state, prevState) => {
    if (state.prefsMarkerProgressEnabled && !prevState.prefsMarkerProgressEnabled) {
        void useUserRecordStore.persist.rehydrate();
    }
});

export const useUserRecord = () => useUserRecordStore((state) => state.activePoints);

// Non-hook accessors for non-React modules (e.g., Leaflet renderer)
// Returns empty array if preference is disabled
export const getActivePoints = () => {
    if (!useUiPrefsStore.getState().prefsMarkerProgressEnabled) return [];
    return useUserRecordStore.getState().activePoints;
};
