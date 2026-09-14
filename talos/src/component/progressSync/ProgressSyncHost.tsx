import { useCallback, useEffect, useRef, useState } from 'react';
import SyncConflictModal, { type SyncConflictChoice } from '@/component/sync/conflict';
import { setProgressSyncRequestHandler } from '@/component/progressSync/progressSyncController';
import { useAuthStore } from '@/store/auth';
import { useProgressSyncStore, type CloudProgress, type ProgressConflictState } from '@/store/progressSync';
import { useUserRecordStore } from '@/store/userRecord';
import { replacePointProgressFromExternal } from '@/store/history';
import { getProgressManifestPayload, getProgressMarkerIndex, type ProgressManifestPayload } from '@/services/progress';
import {
    fetchCloudProgress,
    ProgressSyncError,
    registerProgressManifest,
    syncCloudProgress,
    type ProgressSyncRequestPayload,
} from '@/services/progress';
import {
    acknowledgeRetainedPointIds,
    areLocalPointsSynced,
    arePointSetsEqual,
    buildPointPatch,
    getUnacknowledgedRetainedPointIds,
    normalizePointIds,
    splitByKnownPointIds,
} from '@/services/progress/pointState';

const MAX_DIRTY_MS = 60_000;
const COUNT_FLUSH_THRESHOLD = 10;
const MODAL_EXIT_DURATION_MS = 325;
const PENDING_MUTATION_STORAGE_PREFIX = 'talos-progress-pending-mutation:';

type SyncReason = 'startup' | 'auto' | 'manual' | 'visibility' | 'online' | 'conflict';
type ProgressBase = Pick<CloudProgress, 'revision' | 'markerIndexHash' | 'pointIds' | 'retainedPointIds'>;
type PendingProgressMutation = {
    uid: string;
    payload: ProgressSyncRequestPayload;
    pointIds: string[];
};
type SyncNow = (
    reason: SyncReason,
    options?: { keepalive?: boolean; forceBase?: ProgressBase; pointIds?: string[]; updatedAt?: number },
) => Promise<void>;

const pendingMutationStorageKey = (uid: string): string => `${PENDING_MUTATION_STORAGE_PREFIX}${uid}`;

const readPendingMutation = (uid: string): PendingProgressMutation | null => {
    if (typeof window === 'undefined') return null;
    try {
        const parsed = JSON.parse(window.localStorage.getItem(pendingMutationStorageKey(uid)) ?? 'null') as Partial<PendingProgressMutation> | null;
        if (
            !parsed
            || parsed.uid !== uid
            || !parsed.payload
            || typeof parsed.payload.clientMutationId !== 'string'
            || typeof parsed.payload.markerIndexHash !== 'string'
            || !Array.isArray(parsed.pointIds)
        ) {
            return null;
        }
        return parsed as PendingProgressMutation;
    } catch {
        return null;
    }
};

const persistPendingMutation = (uid: string, pending: PendingProgressMutation | null): void => {
    if (typeof window === 'undefined') return;
    try {
        if (pending) {
            window.localStorage.setItem(pendingMutationStorageKey(pending.uid), JSON.stringify(pending));
        } else {
            window.localStorage.removeItem(pendingMutationStorageKey(uid));
        }
    } catch {
        // The in-memory copy still provides idempotency for the current page session.
    }
};

const isRemoteEmpty = (progress: CloudProgress): boolean =>
    !progress.revision && progress.pointIds.length === 0;

const mergeVisibleWithLocalUnknown = (
    visiblePointIds: string[],
    localPointIds: string[],
    knownPointIds: Set<string>,
): string[] => {
    const localUnknownPointIds = splitByKnownPointIds(localPointIds, knownPointIds).unknown;
    return normalizePointIds([...visiblePointIds, ...localUnknownPointIds]);
};

const countPointDelta = (before: string[], after: string[]): number => {
    const patch = buildPointPatch(before, after);
    return patch.setPointIds.length + patch.clearPointIds.length;
};

const buildMutationId = (): string => (
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`
);

const ProgressSyncHost = () => {
    const sessionUser = useAuthStore((state) => state.sessionUser);
    const baseline = useProgressSyncStore((state) => state.baseline);
    const conflict = useProgressSyncStore((state) => state.conflict);
    const setStatus = useProgressSyncStore((state) => state.setStatus);
    const setBaseline = useProgressSyncStore((state) => state.setBaseline);
    const setCounts = useProgressSyncStore((state) => state.setCounts);
    const setError = useProgressSyncStore((state) => state.setError);
    const setConflict = useProgressSyncStore((state) => state.setConflict);

    const maxTimerRef = useRef<number | null>(null);
    const conflictCleanupTimerRef = useRef<number | null>(null);
    const inFlightRef = useRef(false);
    const rerunRequestedRef = useRef(false);
    const syncNowRef = useRef<SyncNow>(async () => {});
    const suppressLocalChangeRef = useRef(false);
    const dirtyCountRef = useRef(0);
    const baselineRef = useRef<ProgressBase | null>(baseline);
    const manifestRef = useRef<ProgressManifestPayload | null>(null);
    const knownPointIdsRef = useRef<Set<string>>(new Set());
    const sessionUidRef = useRef(sessionUser?.uid ?? null);
    const pendingMutationRef = useRef<PendingProgressMutation | null>(null);
    const [renderedConflict, setRenderedConflict] = useState<ProgressConflictState | null>(conflict);
    const [conflictOpen, setConflictOpen] = useState(Boolean(conflict));

    useEffect(() => {
        baselineRef.current = baseline;
    }, [baseline]);

    useEffect(() => {
        const uid = sessionUser?.uid ?? null;
        sessionUidRef.current = uid;
        pendingMutationRef.current = uid ? readPendingMutation(uid) : null;
    }, [sessionUser?.uid]);

    useEffect(() => {
        if (conflictCleanupTimerRef.current !== null) {
            window.clearTimeout(conflictCleanupTimerRef.current);
            conflictCleanupTimerRef.current = null;
        }

        if (conflict) {
            setRenderedConflict(conflict);
            setConflictOpen(true);
            return;
        }

        setConflictOpen(false);
        conflictCleanupTimerRef.current = window.setTimeout(() => {
            setRenderedConflict(null);
            conflictCleanupTimerRef.current = null;
        }, MODAL_EXIT_DURATION_MS);
    }, [conflict]);

    useEffect(() => () => {
        if (conflictCleanupTimerRef.current !== null) {
            window.clearTimeout(conflictCleanupTimerRef.current);
        }
    }, []);

    const clearTimers = useCallback(() => {
        if (maxTimerRef.current !== null) {
            window.clearTimeout(maxTimerRef.current);
            maxTimerRef.current = null;
        }
    }, []);

    const ensureManifest = useCallback(async (): Promise<ProgressManifestPayload> => {
        const markerIndex = await getProgressMarkerIndex();
        knownPointIdsRef.current = new Set(markerIndex.pointIds);
        const manifest = await getProgressManifestPayload();
        if (manifestRef.current?.markerIndexHash !== manifest.markerIndexHash) {
            await registerProgressManifest(manifest);
            manifestRef.current = manifest;
        }
        return manifest;
    }, []);

    const withManifestRetry = useCallback(async <T,>(
        manifest: ProgressManifestPayload,
        operation: () => Promise<T>,
    ): Promise<T> => {
        try {
            return await operation();
        } catch (error) {
            if (!(error instanceof ProgressSyncError) || error.code !== 'PROGRESS_MANIFEST_NOT_REGISTERED') {
                throw error;
            }
            await registerProgressManifest(manifest);
            manifestRef.current = manifest;
            return operation();
        }
    }, []);

    const applyRemotePoints = useCallback((progress: CloudProgress) => {
        const remotePointIds = splitByKnownPointIds(progress.pointIds, knownPointIdsRef.current).known;
        const nextLocalPointIds = mergeVisibleWithLocalUnknown(
            remotePointIds,
            useUserRecordStore.getState().activePoints,
            knownPointIdsRef.current,
        );
        suppressLocalChangeRef.current = true;
        replacePointProgressFromExternal(nextLocalPointIds);
        queueMicrotask(() => {
            suppressLocalChangeRef.current = false;
        });
        setCounts({ localPointCount: remotePointIds.length, remotePointCount: remotePointIds.length });
        setBaseline({ ...progress, pointIds: remotePointIds });
        setStatus('synced');
        setError(null);
    }, [setBaseline, setCounts, setError, setStatus]);

    const openConflict = useCallback((
        localPointIds: string[],
        remoteProgress: CloudProgress,
    ) => {
        rerunRequestedRef.current = false;
        const remotePointIds = splitByKnownPointIds(remoteProgress.pointIds, knownPointIdsRef.current).known;
        setCounts({ localPointCount: localPointIds.length, remotePointCount: remotePointIds.length });
        setConflict({
            localPointIds,
            remotePointIds,
            localUpdatedAt: useUserRecordStore.getState().updatedAt,
            remoteUpdatedAt: remoteProgress.updatedAt,
            remoteProgress: { ...remoteProgress, pointIds: remotePointIds },
        });
    }, [setConflict, setCounts]);

    const syncNow: SyncNow = useCallback(async (
        reason: SyncReason,
        options = {},
    ) => {
        const uid = sessionUidRef.current;
        if (!uid) return;
        if (inFlightRef.current) {
            rerunRequestedRef.current = true;
            return;
        }
        if (typeof navigator !== 'undefined' && navigator.onLine === false && !options.keepalive) {
            setStatus('offline');
            return;
        }

        inFlightRef.current = true;
        setStatus('syncing');
        setError(null);

        try {
            const manifest = await ensureManifest();
            if (sessionUidRef.current !== uid) return;
            const localState = useUserRecordStore.getState();
            const knownPointIds = knownPointIdsRef.current;
            const localPointIds = normalizePointIds(options.pointIds ?? localState.activePoints);
            const { known: activePoints, unknown: retainedLocalPointIds } = splitByKnownPointIds(localPointIds, knownPointIds);
            let base = options.forceBase ?? baselineRef.current;
            const pendingMutation = pendingMutationRef.current;

            if (pendingMutation && pendingMutation.uid === sessionUidRef.current) {
                if (pendingMutation.payload.markerIndexHash === manifest.markerIndexHash) {
                    const pendingResponse = await withManifestRetry(
                        manifest,
                        () => syncCloudProgress(pendingMutation.payload),
                    );
                    if (sessionUidRef.current !== uid) return;
                    const acknowledgedProgress = {
                        ...pendingResponse.progress,
                        pointIds: pendingMutation.pointIds,
                        retainedPointIds: acknowledgeRetainedPointIds(
                            pendingResponse.progress.retainedPointIds,
                            base?.retainedPointIds ?? [],
                            splitByKnownPointIds(pendingMutation.payload.setPointIds, knownPointIds).unknown,
                        ),
                    };
                    pendingMutationRef.current = null;
                    persistPendingMutation(pendingMutation.uid, null);
                    setBaseline(acknowledgedProgress);
                    baselineRef.current = acknowledgedProgress;
                    base = acknowledgedProgress;
                } else {
                    pendingMutationRef.current = null;
                    persistPendingMutation(pendingMutation.uid, null);
                    base = null;
                }
            }

            if (!base) {
                const { progress: remoteProgress } = await withManifestRetry(
                    manifest,
                    () => fetchCloudProgress(manifest.markerIndexHash),
                );
                if (sessionUidRef.current !== uid) return;
                const remote = { ...remoteProgress, pointIds: splitByKnownPointIds(remoteProgress.pointIds, knownPointIds).known };
                if (!isRemoteEmpty(remote) && !arePointSetsEqual(remote.pointIds, activePoints)) {
                    openConflict(activePoints, remote);
                    return;
                }
                setBaseline(remote);
                baselineRef.current = remote;
                base = remote;
            }

            const basePointIds = splitByKnownPointIds(base.pointIds, knownPointIds).known;
            const markerIndexChanged = Boolean(base.markerIndexHash && base.markerIndexHash !== manifest.markerIndexHash);
            const unacknowledgedPointIds = getUnacknowledgedRetainedPointIds(retainedLocalPointIds, base.retainedPointIds);

            if (
                arePointSetsEqual(basePointIds, activePoints)
                && unacknowledgedPointIds.length === 0
                && !markerIndexChanged
                && (reason === 'visibility' || reason === 'online' || reason === 'manual')
            ) {
                setCounts({ localPointCount: activePoints.length, remotePointCount: activePoints.length });
                setStatus('synced');
                dirtyCountRef.current = 0;
                clearTimers();
                return;
            }

            const patch = buildPointPatch(basePointIds, activePoints);
            const setPointIds = normalizePointIds([...patch.setPointIds, ...unacknowledgedPointIds]);
            if (setPointIds.length === 0 && patch.clearPointIds.length === 0 && !markerIndexChanged) {
                setStatus('synced');
                dirtyCountRef.current = 0;
                clearTimers();
                return;
            }

            const syncPayload: ProgressSyncRequestPayload = {
                baseRevision: base.revision,
                setPointIds,
                clearPointIds: patch.clearPointIds,
                clientMutationId: buildMutationId(),
                markerIndexHash: manifest.markerIndexHash,
                updatedAt: options.updatedAt ?? localState.updatedAt,
            };
            const pending: PendingProgressMutation = {
                uid: sessionUidRef.current,
                payload: syncPayload,
                pointIds: activePoints,
            };
            pendingMutationRef.current = pending;
            persistPendingMutation(pending.uid, pending);
            const response = await withManifestRetry(
                manifest,
                () => syncCloudProgress(syncPayload, { keepalive: options.keepalive }),
            );
            if (sessionUidRef.current !== uid) return;
            pendingMutationRef.current = null;
            persistPendingMutation(pending.uid, null);

            const nextProgress = {
                ...response.progress,
                pointIds: activePoints,
                retainedPointIds: acknowledgeRetainedPointIds(
                    response.progress.retainedPointIds,
                    base.retainedPointIds ?? [],
                    unacknowledgedPointIds,
                ),
            };
            setBaseline(nextProgress);
            baselineRef.current = nextProgress;
            setCounts({ localPointCount: activePoints.length, remotePointCount: nextProgress.pointIds.length });
            const localStillMatches = areLocalPointsSynced(useUserRecordStore.getState().activePoints, nextProgress);
            setStatus(localStillMatches ? 'synced' : 'dirty');
            if (!localStillMatches) rerunRequestedRef.current = true;
            setError(null);
            dirtyCountRef.current = 0;
            clearTimers();
            void reason;
        } catch (error) {
            if (sessionUidRef.current !== uid) return;
            if (error instanceof ProgressSyncError && error.status === 409 && error.current) {
                const pendingAtConflict = pendingMutationRef.current;
                pendingMutationRef.current = null;
                if (pendingAtConflict?.uid) persistPendingMutation(pendingAtConflict.uid, null);
                const local = splitByKnownPointIds(
                    useUserRecordStore.getState().activePoints,
                    knownPointIdsRef.current,
                );
                const remote = {
                    ...error.current,
                    pointIds: splitByKnownPointIds(error.current.pointIds, knownPointIdsRef.current).known,
                };
                const remoteMatchesLocal = arePointSetsEqual(local.known, remote.pointIds);
                const remoteAcknowledgesPending = pendingAtConflict?.uid === uid
                    && arePointSetsEqual(pendingAtConflict.pointIds, remote.pointIds);
                if (remoteMatchesLocal || remoteAcknowledgesPending) {
                    setBaseline(remote);
                    baselineRef.current = remote;
                    setCounts({ localPointCount: local.known.length, remotePointCount: remote.pointIds.length });
                    setStatus('synced');
                    setError(null);
                    dirtyCountRef.current = 0;
                    clearTimers();
                    rerunRequestedRef.current = !remoteMatchesLocal
                        || getUnacknowledgedRetainedPointIds(local.unknown, remote.retainedPointIds).length > 0;
                    if (rerunRequestedRef.current) setStatus('dirty');
                    return;
                }
                openConflict(local.known, remote);
                return;
            }
            if (error instanceof ProgressSyncError && error.code === 'IDEMPOTENCY_KEY_REUSED') {
                const pendingUid = pendingMutationRef.current?.uid;
                pendingMutationRef.current = null;
                if (pendingUid) persistPendingMutation(pendingUid, null);
            }

            setStatus(typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'error');
            setError(error instanceof Error ? error.message : String(error));
        } finally {
            inFlightRef.current = false;
            if (rerunRequestedRef.current) {
                rerunRequestedRef.current = false;
                queueMicrotask(() => { void syncNowRef.current('auto'); });
            }
        }
    }, [clearTimers, ensureManifest, openConflict, setBaseline, setCounts, setError, setStatus, withManifestRetry]);
    syncNowRef.current = syncNow;

    const checkRemoteAndReconcile = useCallback(async () => {
        if (!sessionUidRef.current) return;
        if (inFlightRef.current) {
            rerunRequestedRef.current = true;
            return;
        }
        inFlightRef.current = true;
        setStatus('checking');
        setError(null);

        try {
            if (pendingMutationRef.current?.uid === sessionUidRef.current) {
                inFlightRef.current = false;
                await syncNow('startup');
                return;
            }
            const manifest = await ensureManifest();
            const { progress: remoteProgress } = await withManifestRetry(
                manifest,
                () => fetchCloudProgress(manifest.markerIndexHash),
            );
            const knownPointIds = knownPointIdsRef.current;
            const remote = { ...remoteProgress, pointIds: splitByKnownPointIds(remoteProgress.pointIds, knownPointIds).known };
            const localStatePointIds = normalizePointIds(useUserRecordStore.getState().activePoints);
            const { known: localPointIds, unknown: retainedLocalPointIds } = splitByKnownPointIds(localStatePointIds, knownPointIds);
            setCounts({ localPointCount: localPointIds.length, remotePointCount: remote.pointIds.length });

            if (isRemoteEmpty(remote)) {
                setBaseline(remote);
                baselineRef.current = remote;
                if (localPointIds.length > 0
                    || getUnacknowledgedRetainedPointIds(retainedLocalPointIds, remote.retainedPointIds).length > 0) {
                    inFlightRef.current = false;
                    await syncNow('startup', { forceBase: remote });
                    return;
                }
                setStatus('synced');
                return;
            }

            if (arePointSetsEqual(localPointIds, remote.pointIds)) {
                setBaseline(remote);
                baselineRef.current = remote;
                if (
                    (remote.markerIndexHash && remote.markerIndexHash !== manifestRef.current?.markerIndexHash)
                    || getUnacknowledgedRetainedPointIds(retainedLocalPointIds, remote.retainedPointIds).length > 0
                ) {
                    inFlightRef.current = false;
                    await syncNow('startup', { forceBase: remote });
                    return;
                }
                setStatus('synced');
                return;
            }

            const currentBaseline = baselineRef.current;
            if (currentBaseline && arePointSetsEqual(localPointIds, splitByKnownPointIds(currentBaseline.pointIds, knownPointIds).known)) {
                applyRemotePoints(remote);
                return;
            }

            if (
                currentBaseline
                && (
                    remote.revision === currentBaseline.revision
                    || arePointSetsEqual(remote.pointIds, splitByKnownPointIds(currentBaseline.pointIds, knownPointIds).known)
                )
            ) {
                setBaseline(remote);
                baselineRef.current = remote;
                inFlightRef.current = false;
                await syncNow('startup', { forceBase: remote });
                return;
            }

            openConflict(localPointIds, remote);
        } catch (error) {
            setStatus(typeof navigator !== 'undefined' && navigator.onLine === false ? 'offline' : 'error');
            setError(error instanceof Error ? error.message : String(error));
        } finally {
            inFlightRef.current = false;
            if (rerunRequestedRef.current) {
                rerunRequestedRef.current = false;
                queueMicrotask(() => { void syncNowRef.current('auto'); });
            }
        }
    }, [applyRemotePoints, ensureManifest, openConflict, setBaseline, setCounts, setError, setStatus, syncNow, withManifestRetry]);

    const scheduleSync = useCallback((changedPoints: number) => {
        if (!sessionUidRef.current) return;
        if (suppressLocalChangeRef.current) return;
        if (changedPoints <= 0) return;
        const currentBaseline = baselineRef.current;
        if (!inFlightRef.current && !pendingMutationRef.current && currentBaseline
            && !useProgressSyncStore.getState().conflict
            && currentBaseline.markerIndexHash === manifestRef.current?.markerIndexHash
            && areLocalPointsSynced(useUserRecordStore.getState().activePoints, currentBaseline)) {
            dirtyCountRef.current = 0;
            clearTimers();
            setStatus('synced');
            setCounts({ localPointCount: currentBaseline.pointIds.length });
            return;
        }
        dirtyCountRef.current += changedPoints;
        setStatus('dirty');
        setCounts({
            localPointCount: splitByKnownPointIds(
                useUserRecordStore.getState().activePoints,
                knownPointIdsRef.current,
            ).known.length,
        });

        if (inFlightRef.current) {
            rerunRequestedRef.current = true;
            return;
        }

        if (dirtyCountRef.current >= COUNT_FLUSH_THRESHOLD) {
            clearTimers();
            void syncNow('auto');
            return;
        }

        if (maxTimerRef.current === null) {
            maxTimerRef.current = window.setTimeout(() => {
                maxTimerRef.current = null;
                void syncNow('auto');
            }, MAX_DIRTY_MS);
        }
    }, [clearTimers, setCounts, setStatus, syncNow]);

    useEffect(() => {
        if (!sessionUser?.uid) return;
        void checkRemoteAndReconcile();
    }, [checkRemoteAndReconcile, sessionUser?.uid]);

    useEffect(() => {
        const unsubscribe = useUserRecordStore.subscribe((state, prevState) => {
            if (state.activePoints === prevState.activePoints) return;
            scheduleSync(countPointDelta(prevState.activePoints, state.activePoints));
        });
        return unsubscribe;
    }, [scheduleSync]);

    useEffect(() => {
        setProgressSyncRequestHandler(async () => {
            await syncNow('manual');
        });
        return () => {
            setProgressSyncRequestHandler(null);
        };
    }, [syncNow]);

    useEffect(() => {
        const handleVisibility = () => {
            if (document.visibilityState === 'hidden') {
                void syncNow('visibility', { keepalive: true });
            } else if (document.visibilityState === 'visible') {
                void syncNow('visibility');
            }
        };
        const handlePageHide = () => {
            void syncNow('visibility', { keepalive: true });
        };
        const handleOnline = () => {
            void syncNow('online');
        };

        document.addEventListener('visibilitychange', handleVisibility);
        window.addEventListener('pagehide', handlePageHide);
        window.addEventListener('online', handleOnline);
        return () => {
            document.removeEventListener('visibilitychange', handleVisibility);
            window.removeEventListener('pagehide', handlePageHide);
            window.removeEventListener('online', handleOnline);
        };
    }, [syncNow]);

    const handleConflictResolve = useCallback((choice: SyncConflictChoice) => {
        const activeConflict = conflict ?? renderedConflict;
        if (!activeConflict) return;
        const remoteBase = activeConflict.remoteProgress;
        const knownPointIds = knownPointIdsRef.current;
        const localUnknownPointIds = splitByKnownPointIds(
            useUserRecordStore.getState().activePoints,
            knownPointIds,
        ).unknown;
        const pointIds = choice === 'a'
            ? activeConflict.localPointIds
            : choice === 'b'
                ? activeConflict.remotePointIds
                : [...new Set([...activeConflict.localPointIds, ...activeConflict.remotePointIds])];

        if (choice === 'b') {
            applyRemotePoints(remoteBase);
            setConflict(null);
            return;
        }

        setBaseline(remoteBase);
        baselineRef.current = remoteBase;
        suppressLocalChangeRef.current = true;
        const resolvedPointIds = normalizePointIds([...pointIds, ...localUnknownPointIds]);
        replacePointProgressFromExternal(resolvedPointIds);
        const updatedAt = useUserRecordStore.getState().updatedAt;
        queueMicrotask(() => {
            suppressLocalChangeRef.current = false;
        });
        setConflict(null);
        void syncNow('conflict', {
            forceBase: remoteBase,
            pointIds: resolvedPointIds,
            updatedAt,
        });
    }, [applyRemotePoints, conflict, renderedConflict, setBaseline, setConflict, syncNow]);

    return renderedConflict ? (
        <SyncConflictModal
            open={conflictOpen}
            sourceA={{
                side: 'local',
                updatedAt: renderedConflict.localUpdatedAt,
                pointIds: renderedConflict.localPointIds,
            }}
            sourceB={{
                side: 'remote',
                remoteSource: 'oemDb',
                updatedAt: renderedConflict.remoteUpdatedAt,
                pointIds: renderedConflict.remotePointIds,
            }}
            onClose={() => setConflict(null)}
            onResolve={handleConflictResolve}
        />
    ) : null;
};

export default ProgressSyncHost;
