import { create } from 'zustand';
import type { UseBoundStore, StoreApi } from 'zustand';
import { getLinkData, mergeLinkData, tryParseLinkData } from '@/data/map/link';
import type { MapLink, LinkDataV1, GlobalLinkConfig } from '@/data/map/link';

const STORAGE_KEY = 'talos:linkData';
const UNDO_LIMIT = 50;

const safeParseStored = (): LinkDataV1 | null => {
    try {
        if (typeof window === 'undefined' || !('localStorage' in window)) return null;
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        return tryParseLinkData(raw);
    } catch {
        return null;
    }
};

const safePersist = (data: LinkDataV1) => {
    try {
        if (typeof window === 'undefined' || !('localStorage' in window)) return;
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch {
        // ignore storage errors
    }
};

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

export type LinkState = {
    base: LinkDataV1;
    current: LinkDataV1;
    past: LinkDataV1[];
    future: LinkDataV1[];

    upsertLink: (link: MapLink) => void;
    removeLink: (region: string, id: string) => void;
    updateConfig: (config: GlobalLinkConfig) => void;
    importMerge: (text: string) => boolean;
    resetToBase: () => void;

    undo: () => void;
    redo: () => void;
};

export const useLinkStore: UseBoundStore<StoreApi<LinkState>> = create<LinkState>((set) => {
    const base = getLinkData();
    const stored = safeParseStored();
    const current = stored ? mergeLinkData(base, stored) : base;

    return {
        base,
        current,
        past: [],
        future: [],

        upsertLink: (link) => {
            set((state) => {
                const next = clone(state.current);
                next.regions[link.region] = next.regions[link.region] ?? { links: {} };
                next.regions[link.region].links[link.id] = link;

                const past = [...state.past, state.current].slice(-UNDO_LIMIT);
                safePersist(next);
                return { current: next, past, future: [] };
            });
        },

        removeLink: (region, id) => {
            set((state) => {
                const bucket = state.current.regions[region];
                if (!bucket?.links || !(id in bucket.links)) return state;
                const next = clone(state.current);
                delete next.regions[region].links[id];

                const past = [...state.past, state.current].slice(-UNDO_LIMIT);
                safePersist(next);
                return { current: next, past, future: [] };
            });
        },

        updateConfig: (config) => {
            set((state) => {
                const next = clone(state.current);
                next.config = config;

                const past = [...state.past, state.current].slice(-UNDO_LIMIT);
                safePersist(next);
                return { current: next, past, future: [] };
            });
        },

        importMerge: (text) => {
            const incoming = tryParseLinkData(text);
            if (!incoming) return false;
            set((state) => {
                const next = mergeLinkData(state.current, incoming);
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
            set((state) => {
                if (state.past.length === 0) return state;
                const prev = state.past[state.past.length - 1];
                const past = state.past.slice(0, -1);
                safePersist(prev);
                return { current: prev, past, future: [state.current, ...state.future] };
            });
        },

        redo: () => {
            set((state) => {
                if (state.future.length === 0) return state;
                const next = state.future[0];
                const future = state.future.slice(1);
                safePersist(next);
                return { current: next, past: [...state.past, state.current], future };
            });
        },
    };
});

// Selector: get links map for a specific region
export const selectLinkMapForRegion = (regionCode: string) => (state: LinkState) =>
    state.current.regions[regionCode]?.links;

// Selector: get global config
export const selectGlobalConfig = (state: LinkState) => state.current.config;

// Hook: get all links for a region as array
export const useLinksForRegion = (regionCode: string | null) => {
    return useLinkStore((state) => {
        if (!regionCode) return [];
        const linkMap = state.current.regions[regionCode]?.links;
        return linkMap ? Object.values(linkMap) : [];
    });
};
