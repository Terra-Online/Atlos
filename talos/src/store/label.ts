import { create } from 'zustand';
import type { UseBoundStore, StoreApi } from 'zustand';
import { getLabelData, mergeLabelData, tryParseLabelData } from '@/data/map/label';
import type { AnyLabel, LabelDataV1 } from '@/data/map/label/types';

const STORAGE_KEY = 'talos:labelData:v1';
const UNDO_LIMIT = 50;

const safeParseStored = (): LabelDataV1 | null => {
    try {
        if (typeof window === 'undefined' || !('localStorage' in window)) return null;
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        return tryParseLabelData(raw);
    } catch {
        return null;
    }
};

const safePersist = (data: LabelDataV1) => {
    try {
        if (typeof window === 'undefined' || !('localStorage' in window)) return;
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
        // ignore storage errors
    }
};

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export type LabelState = {
    base: LabelDataV1;
    current: LabelDataV1;
    past: LabelDataV1[];
    future: LabelDataV1[];

    upsertLabel: (label: AnyLabel) => void;
    removeLabel: (region: string, id: string) => void;
    importMerge: (text: string) => boolean;
    resetToBase: () => void;

    undo: () => void;
    redo: () => void;
};

export const useLabelStore: UseBoundStore<StoreApi<LabelState>> = create<LabelState>((set, get) => {
    const base = getLabelData();
    const stored = safeParseStored();
    const current = stored ? mergeLabelData(base, stored) : base;

    return {
        base,
        current,
        past: [],
        future: [],

        upsertLabel: (label) => {
            set((state) => {
                const next = clone(state.current);
                next.regions[label.region] = next.regions[label.region] ?? { labels: {} };
                next.regions[label.region].labels[label.id] = label;

                const past = [...state.past, state.current].slice(-UNDO_LIMIT);
                safePersist(next);
                return { current: next, past, future: [] };
            });
        },

        removeLabel: (region, id) => {
            set((state) => {
                const bucket = state.current.regions[region];
                if (!bucket?.labels || !(id in bucket.labels)) return state;
                const next = clone(state.current);
                delete next.regions[region].labels[id];

                const past = [...state.past, state.current].slice(-UNDO_LIMIT);
                safePersist(next);
                return { current: next, past, future: [] };
            });
        },

        importMerge: (text) => {
            const incoming = tryParseLabelData(text);
            if (!incoming) return false;
            set((state) => {
                const next = mergeLabelData(state.current, incoming);
                const past = [...state.past, state.current].slice(-UNDO_LIMIT);
                safePersist(next);
                return { current: next, past, future: [] };
            });
            return true;
        },

        resetToBase: () => {
            set((state) => {
                safePersist(state.base);
                return { current: state.base, past: [...state.past, state.current].slice(-UNDO_LIMIT), future: [] };
            });
        },

        undo: () => {
            const { past, current, future } = get();
            const prev = past[past.length - 1];
            if (!prev) return;
            const nextPast = past.slice(0, -1);
            const nextFuture = [current, ...future].slice(0, UNDO_LIMIT);
            safePersist(prev);
            set({ current: prev, past: nextPast, future: nextFuture });
        },

        redo: () => {
            const { past, current, future } = get();
            const next = future[0];
            if (!next) return;
            const nextFuture = future.slice(1);
            const nextPast = [...past, current].slice(-UNDO_LIMIT);
            safePersist(next);
            set({ current: next, past: nextPast, future: nextFuture });
        },
    };
});

// IMPORTANT: selectors must return referentially-stable values when state is unchanged.
// Returning a freshly-created array each time can trigger React "Maximum update depth" via useSyncExternalStore.
export const selectLabelMapForRegion = (region: string) => (s: LabelState): Record<string, AnyLabel> | undefined => {
    return s.current.regions[region]?.labels;
};

export const selectHasLabelId = (region: string, id: string) => (s: LabelState): boolean => {
    const bucket = s.current.regions[region];
    return Boolean(bucket?.labels && id in bucket.labels);
};
