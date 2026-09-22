import { create } from 'zustand';
import { useMarkerStore } from '@/store/marker';
import { useUserRecordStore } from '@/store/userRecord';

export type PointProgressDelta = {
    collect?: Iterable<string>;
    uncollect?: Iterable<string>;
};

export type PointProgressHistoryEntry = {
    label: string;
    collectedIds: string[];
    uncollectedIds: string[];
};

export type MarkerSelectionDelta = {
    select?: Iterable<string>;
    deselect?: Iterable<string>;
};

export type MarkerSelectionHistoryEntry = {
    kind: 'marker-selection';
    label: string;
    selectedIds: string[];
    deselectedIds: string[];
};

export type MarkerFilterDelta = {
    activate?: Iterable<string>;
    deactivate?: Iterable<string>;
};

export type MarkerFilterHistoryEntry = {
    kind: 'marker-filter';
    label: string;
    activatedKeys: string[];
    deactivatedKeys: string[];
};

export type HistoryEntry =
    | PointProgressHistoryEntry
    | MarkerSelectionHistoryEntry
    | MarkerFilterHistoryEntry;

interface IHistoryStore {
    past: HistoryEntry[];
    future: HistoryEntry[];
    undo: () => void;
    redo: () => void;
    canUndo: () => boolean;
    canRedo: () => boolean;
    clear: () => void;
}

const UNDO_LIMIT = 25;

const normalizePointIds = (ids?: Iterable<string>): string[] => (
    ids ? [...new Set([...ids].map((id) => String(id)).filter(Boolean))] : []
);

const pushHistoryEntry = (entry: HistoryEntry): void => {
    useHistoryStore.setState((state) => ({
        past: [...state.past, entry].slice(-UNDO_LIMIT),
        future: [],
    }));
};

const replaceActivePoints = (ids: Iterable<string>): boolean => {
    const next = normalizePointIds(ids);
    const current = useUserRecordStore.getState().activePoints;
    if (current.length === next.length && current.every((id, index) => id === next[index])) {
        return false;
    }
    useUserRecordStore.setState({ activePoints: next, updatedAt: Date.now() });
    return true;
};

const applyPointProgressDelta = (delta: PointProgressDelta): PointProgressHistoryEntry | null => {
    const current = useUserRecordStore.getState().activePoints;
    const currentSet = new Set(current);
    const uncollectSet = new Set(normalizePointIds(delta.uncollect));
    const collectIds = normalizePointIds(delta.collect);
    const next = current.filter((id) => !uncollectSet.has(id));
    const nextSet = new Set(next);

    for (const id of collectIds) {
        if (nextSet.has(id)) continue;
        nextSet.add(id);
        next.push(id);
    }

    const collectedIds = next.filter((id) => !currentSet.has(id));
    const uncollectedIds = current.filter((id) => !nextSet.has(id));
    if (collectedIds.length === 0 && uncollectedIds.length === 0) return null;

    replaceActivePoints(next);
    return { label: '', collectedIds, uncollectedIds };
};

const applyMarkerSelectionDelta = (delta: MarkerSelectionDelta): MarkerSelectionHistoryEntry | null => {
    const markerStore = useMarkerStore.getState();
    const current = markerStore.selectedPoints;
    const currentSet = new Set(current);
    const deselectSet = new Set(normalizePointIds(delta.deselect));
    const selectIds = normalizePointIds(delta.select);
    const next = current.filter((id) => !deselectSet.has(id));
    const nextSet = new Set(next);

    for (const id of selectIds) {
        if (nextSet.has(id)) continue;
        nextSet.add(id);
        next.push(id);
    }

    const selectedIds = next.filter((id) => !currentSet.has(id));
    const deselectedIds = current.filter((id) => !nextSet.has(id));
    if (selectedIds.length === 0 && deselectedIds.length === 0) return null;

    useMarkerStore.setState({ selectedPoints: next });
    return { kind: 'marker-selection', label: '', selectedIds, deselectedIds };
};

const applyMarkerFilterDelta = (delta: MarkerFilterDelta): MarkerFilterHistoryEntry | null => {
    const markerStore = useMarkerStore.getState();
    const current = markerStore.filter;
    const currentSet = new Set(current);
    const deactivateSet = new Set(normalizePointIds(delta.deactivate));
    const activateKeys = normalizePointIds(delta.activate);
    const next = current.filter((key) => !deactivateSet.has(key));
    const nextSet = new Set(next);

    for (const key of activateKeys) {
        if (nextSet.has(key)) continue;
        nextSet.add(key);
        next.push(key);
    }

    const activatedKeys = next.filter((key) => !currentSet.has(key));
    const deactivatedKeys = current.filter((key) => !nextSet.has(key));
    if (activatedKeys.length === 0 && deactivatedKeys.length === 0) return null;

    markerStore.setFilter(next);
    return { kind: 'marker-filter', label: '', activatedKeys, deactivatedKeys };
};

const applyHistoryEntry = (entry: HistoryEntry, reverse: boolean): void => {
    if ('kind' in entry && entry.kind === 'marker-selection') {
        applyMarkerSelectionDelta(reverse
            ? { select: entry.deselectedIds, deselect: entry.selectedIds }
            : { select: entry.selectedIds, deselect: entry.deselectedIds });
        return;
    }
    if ('kind' in entry && entry.kind === 'marker-filter') {
        applyMarkerFilterDelta(reverse
            ? { activate: entry.deactivatedKeys, deactivate: entry.activatedKeys }
            : { activate: entry.activatedKeys, deactivate: entry.deactivatedKeys });
        return;
    }
    applyPointProgressDelta(reverse
        ? { collect: entry.uncollectedIds, uncollect: entry.collectedIds }
        : { collect: entry.collectedIds, uncollect: entry.uncollectedIds });
};

export const useHistoryStore = create<IHistoryStore>()((set, get) => ({
    past: [],
    future: [],

    undo: () => {
        const { past, future } = get();
        const entry = past[past.length - 1];
        if (!entry) return;
        applyHistoryEntry(entry, true);
        set({ past: past.slice(0, -1), future: [entry, ...future] });
    },

    redo: () => {
        const { past, future } = get();
        const entry = future[0];
        if (!entry) return;
        applyHistoryEntry(entry, false);
        set({
            past: [...past, entry].slice(-UNDO_LIMIT),
            future: future.slice(1),
        });
    },

    canUndo: () => get().past.length > 0,
    canRedo: () => get().future.length > 0,
    clear: () => set({ past: [], future: [] }),
}));

export const commitPointProgress = (label: string, delta: PointProgressDelta): boolean => {
    const applied = applyPointProgressDelta(delta);
    if (!applied) return false;
    const entry = { ...applied, label };
    pushHistoryEntry(entry);
    return true;
};

export const commitMarkerSelection = (label: string, delta: MarkerSelectionDelta): boolean => {
    const applied = applyMarkerSelectionDelta(delta);
    if (!applied) return false;
    pushHistoryEntry({ ...applied, label });
    return true;
};

export const commitMarkerFilter = (label: string, delta: MarkerFilterDelta): boolean => {
    const applied = applyMarkerFilterDelta(delta);
    if (!applied) return false;
    pushHistoryEntry({ ...applied, label });
    return true;
};

export const replacePointProgressFromExternal = (ids: Iterable<string>): void => {
    replaceActivePoints(ids);
    useHistoryStore.getState().clear();
};

export const applyPointProgressSilently = (delta: PointProgressDelta): boolean => (
    applyPointProgressDelta(delta) !== null
);

export const useCanUndo = () => useHistoryStore((state) => state.past.length > 0);
export const useCanRedo = () => useHistoryStore((state) => state.future.length > 0);
