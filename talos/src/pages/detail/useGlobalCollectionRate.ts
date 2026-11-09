import { useEffect, useState } from 'react';
import {
    decodeProgressStatsCounts,
    getProgressMarkerIndex,
    type ProgressMarkerIndex,
} from '@/services/progress';
import { fetchProgressStats } from '@/services/progress';

const STATS_CACHE_TTL_MS = 60_000;

type GlobalStatsSnapshot = {
    markerIndex: ProgressMarkerIndex;
    counts: Uint32Array;
    sampleSize: number;
};

export type GlobalCollectionRateState = {
    loading: boolean;
    rate: number | null;
    sampleSize: number;
};

const EMPTY_STATE: GlobalCollectionRateState = {
    loading: false,
    rate: null,
    sampleSize: 0,
};

let cachedStats: { expiresAt: number; snapshot: GlobalStatsSnapshot } | null = null;
let statsRequest: Promise<GlobalStatsSnapshot> | null = null;

const loadGlobalStats = async (): Promise<GlobalStatsSnapshot> => {
    if (cachedStats && cachedStats.expiresAt > Date.now()) {
        return cachedStats.snapshot;
    }
    if (statsRequest) return statsRequest;

    statsRequest = getProgressMarkerIndex().then(async (markerIndex) => {
        const payload = await fetchProgressStats(markerIndex.markerIndexHash);
        if (payload.markerIndexHash !== markerIndex.markerIndexHash) {
            throw new Error('Progress stats manifest does not match the active marker index.');
        }

        const pointCount = Math.floor(payload.pointCount ?? 0);
        if (pointCount !== markerIndex.pointIds.length) {
            throw new Error('Progress stats point count does not match the active marker index.');
        }
        const counts = decodeProgressStatsCounts(payload.counts, pointCount);
        if (counts.length !== pointCount) {
            throw new Error('Progress stats counts are incomplete.');
        }
        const snapshot = {
            markerIndex,
            counts,
            sampleSize: Math.max(0, Math.floor(payload.sampleSize || payload.totalSyncedUsers || 0)),
        };
        cachedStats = {
            expiresAt: Date.now() + STATS_CACHE_TTL_MS,
            snapshot,
        };
        return snapshot;
    }).finally(() => {
        statsRequest = null;
    });

    return statsRequest;
};

export const useGlobalCollectionRate = (
    pointId: string | undefined,
    enabled: boolean,
): GlobalCollectionRateState => {
    const [state, setState] = useState<GlobalCollectionRateState>(EMPTY_STATE);

    useEffect(() => {
        if (!enabled || !pointId) {
            setState(EMPTY_STATE);
            return undefined;
        }

        let disposed = false;
        setState((current) => ({ ...current, loading: true }));
        void loadGlobalStats()
            .then(({ markerIndex, counts, sampleSize }) => {
                if (disposed) return;
                const pointIndex = markerIndex.indexById.get(pointId);
                if (pointIndex === undefined || sampleSize <= 0) {
                    setState(EMPTY_STATE);
                    return;
                }

                const collectedUsers = counts[pointIndex] ?? 0;
                setState({
                    loading: false,
                    rate: Math.min(1, Math.max(0, collectedUsers / sampleSize)),
                    sampleSize,
                });
            })
            .catch(() => {
                if (!disposed) setState(EMPTY_STATE);
            });

        return () => {
            disposed = true;
        };
    }, [enabled, pointId]);

    return state;
};
