/**
 * Undo / Redo history store for user-facing actions.
 *
 * Tracked actions:
 *   1. MarkSelector filter toggle / batch-toggle
 *   2. Marker point status toggle (single or batch — a batch counts as one step)
 *
 * Design:
 *   - Generic command pattern with `undo()` / `redo()` callbacks per entry.
 *   - Max 25 steps (configurable via UNDO_LIMIT).
 *   - Batch operations (e.g. multi-select → mark all checked) are pushed as a
 *     single history entry.
 */

import { create } from 'zustand';

// ─── Types ───────────────────────────────────────────────────

export interface HistoryEntry {
    /** Human-readable label (for potential UI display) */
    label: string;
    /** Callback to reverse this action */
    undo: () => void;
    /** Callback to re-apply this action */
    redo: () => void;
}

interface IHistoryStore {
    past: HistoryEntry[];
    future: HistoryEntry[];

    /** Push a new undoable action (clears redo stack) */
    push: (entry: HistoryEntry) => void;
    /** Undo the most recent action */
    undo: () => void;
    /** Redo the most recently undone action */
    redo: () => void;
    /** Whether undo is available */
    canUndo: () => boolean;
    /** Whether redo is available */
    canRedo: () => boolean;
    /** Clear all history */
    clear: () => void;
}

const UNDO_LIMIT = 25;

export const useHistoryStore = create<IHistoryStore>()((set, get) => ({
    past: [],
    future: [],

    push: (entry) => {
        set((state) => ({
            past: [...state.past, entry].slice(-UNDO_LIMIT),
            future: [],
        }));
    },

    undo: () => {
        const { past, future } = get();
        if (past.length === 0) return;

        const entry = past[past.length - 1];
        entry.undo();

        set({
            past: past.slice(0, -1),
            future: [entry, ...future],
        });
    },

    redo: () => {
        const { past, future } = get();
        if (future.length === 0) return;

        const entry = future[0];
        entry.redo();

        set({
            past: [...past, entry].slice(-UNDO_LIMIT),
            future: future.slice(1),
        });
    },

    canUndo: () => get().past.length > 0,
    canRedo: () => get().future.length > 0,

    clear: () => set({ past: [], future: [] }),
}));

// ─── Convenience hooks ───────────────────────────────────────

export const useCanUndo = () => useHistoryStore((s) => s.past.length > 0);
export const useCanRedo = () => useHistoryStore((s) => s.future.length > 0);
