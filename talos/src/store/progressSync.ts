import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ProgressSyncStatus =
    | 'idle'
    | 'checking'
    | 'dirty'
    | 'syncing'
    | 'synced'
    | 'conflict'
    | 'offline'
    | 'error';

export type CloudProgress = {
    revision: string;
    markerIndexHash: string;
    updatedAt: number | null;
    pointIds: string[];
    retainedPointIds?: string[];
};

export type ProgressConflictState = {
    localPointIds: string[];
    remotePointIds: string[];
    localUpdatedAt: number | null;
    remoteUpdatedAt: number | null;
    remoteProgress: CloudProgress;
};

interface ProgressSyncStore {
    status: ProgressSyncStatus;
    baseline: Pick<CloudProgress, 'revision' | 'markerIndexHash' | 'pointIds' | 'retainedPointIds'> | null;
    lastSyncedAt: number | null;
    error: string | null;
    localPointCount: number;
    remotePointCount: number;
    conflict: ProgressConflictState | null;
    setStatus: (status: ProgressSyncStatus) => void;
    setBaseline: (progress: CloudProgress | null) => void;
    setCounts: (counts: { localPointCount?: number; remotePointCount?: number }) => void;
    setError: (error: string | null) => void;
    setConflict: (conflict: ProgressConflictState | null) => void;
}

export const useProgressSyncStore = create<ProgressSyncStore>()(
    persist(
        (set) => ({
            status: 'idle',
            baseline: null,
            lastSyncedAt: null,
            error: null,
            localPointCount: 0,
            remotePointCount: 0,
            conflict: null,
            setStatus: (status) => set({ status }),
            setBaseline: (progress) => set({
                baseline: progress
                    ? {
                        revision: progress.revision,
                        markerIndexHash: progress.markerIndexHash,
                        pointIds: progress.pointIds,
                        retainedPointIds: progress.retainedPointIds,
                    }
                    : null,
                lastSyncedAt: progress ? progress.updatedAt ?? Date.now() : null,
            }),
            setCounts: ({ localPointCount, remotePointCount }) => set((state) => ({
                localPointCount: localPointCount ?? state.localPointCount,
                remotePointCount: remotePointCount ?? state.remotePointCount,
            })),
            setError: (error) => set({ error }),
            setConflict: (conflict) => set((state) => ({
                conflict,
                status: conflict ? 'conflict' : state.status,
            })),
        }),
        {
            name: 'talos-progress-sync',
            version: 4,
            migrate: (persistedState) => {
                const state = persistedState as Partial<ProgressSyncStore> | undefined;
                return {
                    status: 'idle',
                    baseline: null,
                    lastSyncedAt: typeof state?.lastSyncedAt === 'number' ? state.lastSyncedAt : null,
                    error: null,
                    localPointCount: 0,
                    remotePointCount: 0,
                    conflict: null,
                };
            },
            partialize: (state) => ({
                baseline: state.baseline,
                lastSyncedAt: state.lastSyncedAt,
            }),
        },
    ),
);
