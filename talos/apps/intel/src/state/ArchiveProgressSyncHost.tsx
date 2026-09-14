import { useCallback, useEffect, useRef, useState } from 'react';
import SyncConflictModal, { type SyncConflictChoice } from '@main/component/sync/conflict';
import { addProgressSyncRequestHandler } from '@main/component/progressSync/progressSyncController';
import { useAuthStore } from '@main/store/auth';
import { useUserRecordStore } from '@main/store/userRecord';
import {
  fetchCloudArchiveProgress,
  ProgressSyncError,
  registerArchiveProgressManifest,
  syncCloudArchiveProgress,
  type ArchiveProgressManifestPayload,
  type ArchiveProgressSyncRequestPayload,
  type CloudArchiveProgress,
} from '@main/services/progress';
import { useTranslateUI } from '@intel/locale';
import {
  areArchiveSetsEqual,
  buildArchivePatch,
  getArchiveProgressIndex,
  normalizeArchiveIds,
  splitArchiveIds,
} from './archiveProgress';

const AUTO_SYNC_DELAY_MS = 1_500;
const PENDING_MUTATION_STORAGE_PREFIX = 'talos-archive-progress-pending-mutation:';

type SyncReason = 'startup' | 'auto' | 'manual' | 'visibility' | 'online' | 'conflict';
type ArchiveProgressBase = Pick<CloudArchiveProgress, 'revision' | 'archiveIndexHash' | 'archiveIds'>;
type PendingArchiveMutation = {
  uid: string;
  payload: ArchiveProgressSyncRequestPayload;
  archiveIds: string[];
};
type ArchiveConflict = {
  localArchiveIds: string[];
  localUpdatedAt: number | null;
  remoteProgress: CloudArchiveProgress;
};
type SyncNow = (
  reason: SyncReason,
  options?: {
    keepalive?: boolean;
    forceBase?: ArchiveProgressBase;
    archiveIds?: string[];
    updatedAt?: number;
  },
) => Promise<void>;

const pendingMutationStorageKey = (uid: string): string => (
  `${PENDING_MUTATION_STORAGE_PREFIX}${uid}`
);

const readPendingMutation = (uid: string): PendingArchiveMutation | null => {
  try {
    const parsed = JSON.parse(localStorage.getItem(pendingMutationStorageKey(uid)) ?? 'null') as Partial<PendingArchiveMutation> | null;
    if (
      !parsed
      || parsed.uid !== uid
      || !parsed.payload
      || typeof parsed.payload.clientMutationId !== 'string'
      || typeof parsed.payload.archiveIndexHash !== 'string'
      || !Array.isArray(parsed.archiveIds)
    ) return null;
    return parsed as PendingArchiveMutation;
  } catch {
    return null;
  }
};

const persistPendingMutation = (uid: string, mutation: PendingArchiveMutation | null): void => {
  try {
    if (mutation) localStorage.setItem(pendingMutationStorageKey(uid), JSON.stringify(mutation));
    else localStorage.removeItem(pendingMutationStorageKey(uid));
  } catch {
    // The current page keeps an in-memory copy when storage is unavailable.
  }
};

const buildMutationId = (): string => (
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
);

const isRemoteEmpty = (progress: CloudArchiveProgress): boolean => (
  !progress.revision && progress.archiveIds.length === 0
);

const currentArchiveProgressFromError = (error: ProgressSyncError): CloudArchiveProgress | null => {
  if (!error.details || typeof error.details !== 'object' || !('current' in error.details)) return null;
  const current = (error.details as { current?: unknown }).current;
  if (!current || typeof current !== 'object') return null;
  const progress = current as Partial<CloudArchiveProgress>;
  if (
    typeof progress.revision !== 'string'
    || typeof progress.archiveIndexHash !== 'string'
    || !Array.isArray(progress.archiveIds)
  ) return null;
  return {
    revision: progress.revision,
    archiveIndexHash: progress.archiveIndexHash,
    updatedAt: typeof progress.updatedAt === 'number' ? progress.updatedAt : null,
    archiveIds: normalizeArchiveIds(progress.archiveIds),
  };
};

const ArchiveProgressSyncHost = () => {
  const tUI = useTranslateUI();
  const sessionUser = useAuthStore((state) => state.sessionUser);
  const sessionUidRef = useRef<string | null>(sessionUser?.uid ?? null);
  const baselineRef = useRef<ArchiveProgressBase | null>(null);
  const manifestRef = useRef<ArchiveProgressManifestPayload | null>(null);
  const knownArchiveIdsRef = useRef<Set<string>>(new Set());
  const pendingMutationRef = useRef<PendingArchiveMutation | null>(null);
  const inFlightRef = useRef(false);
  const rerunRequestedRef = useRef(false);
  const syncNowRef = useRef<SyncNow>(async () => {});
  const suppressLocalChangeRef = useRef(false);
  const autoSyncTimerRef = useRef<number | null>(null);
  const [conflict, setConflict] = useState<ArchiveConflict | null>(null);

  const clearAutoSyncTimer = useCallback(() => {
    if (autoSyncTimerRef.current === null) return;
    window.clearTimeout(autoSyncTimerRef.current);
    autoSyncTimerRef.current = null;
  }, []);

  const ensureManifest = useCallback(async (): Promise<ArchiveProgressManifestPayload> => {
    const index = await getArchiveProgressIndex();
    knownArchiveIdsRef.current = new Set(index.archiveIds);
    const manifest = {
      archiveIndexHash: index.archiveIndexHash,
      archiveIds: index.archiveIds,
    };
    if (manifestRef.current?.archiveIndexHash !== manifest.archiveIndexHash) {
      await registerArchiveProgressManifest(manifest);
      manifestRef.current = manifest;
    }
    return manifest;
  }, []);

  const withManifestRetry = useCallback(async <T,>(
    manifest: ArchiveProgressManifestPayload,
    operation: () => Promise<T>,
  ): Promise<T> => {
    try {
      return await operation();
    } catch (error) {
      if (!(error instanceof ProgressSyncError) || error.code !== 'ARCHIVE_PROGRESS_MANIFEST_NOT_REGISTERED') {
        throw error;
      }
      await registerArchiveProgressManifest(manifest);
      manifestRef.current = manifest;
      return operation();
    }
  }, []);

  const openConflict = useCallback((localArchiveIds: string[], remoteProgress: CloudArchiveProgress) => {
    setConflict({
      localArchiveIds,
      localUpdatedAt: useUserRecordStore.getState().updatedAt,
      remoteProgress: {
        ...remoteProgress,
        archiveIds: normalizeArchiveIds(remoteProgress.archiveIds),
      },
    });
  }, []);

  const replaceKnownArchives = useCallback((archiveIds: string[]) => {
    const current = useUserRecordStore.getState();
    const { unknown } = splitArchiveIds(current.activeArchives, knownArchiveIdsRef.current);
    suppressLocalChangeRef.current = true;
    useUserRecordStore.setState({
      activeArchives: normalizeArchiveIds([...archiveIds, ...unknown]),
      updatedAt: Date.now(),
    });
    queueMicrotask(() => {
      suppressLocalChangeRef.current = false;
    });
  }, []);

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
    if (navigator.onLine === false && !options.keepalive) return;

    inFlightRef.current = true;
    clearAutoSyncTimer();
    try {
      const manifest = await ensureManifest();
      if (sessionUidRef.current !== uid) return;
      const localState = useUserRecordStore.getState();
      const localArchiveIds = normalizeArchiveIds(options.archiveIds ?? localState.activeArchives);
      const { known: activeArchiveIds, unknown: retainedLocalArchiveIds } = splitArchiveIds(
        localArchiveIds,
        knownArchiveIdsRef.current,
      );
      let base = options.forceBase ?? baselineRef.current;
      if (base?.archiveIndexHash !== manifest.archiveIndexHash) base = null;

      const pendingMutation = pendingMutationRef.current;
      if (pendingMutation?.uid === uid) {
        if (pendingMutation.payload.archiveIndexHash === manifest.archiveIndexHash) {
          const pendingResponse = await withManifestRetry(
            manifest,
            () => syncCloudArchiveProgress(pendingMutation.payload),
          );
          if (sessionUidRef.current !== uid) return;
          base = {
            ...pendingResponse.progress,
            archiveIds: pendingMutation.archiveIds,
          };
          baselineRef.current = base;
        } else {
          base = null;
        }
        pendingMutationRef.current = null;
        persistPendingMutation(uid, null);
      }

      if (!base) {
        const { progress } = await withManifestRetry(
          manifest,
          () => fetchCloudArchiveProgress(manifest.archiveIndexHash),
        );
        if (sessionUidRef.current !== uid) return;
        const remote = {
          ...progress,
          archiveIds: splitArchiveIds(progress.archiveIds, knownArchiveIdsRef.current).known,
        };
        if (!isRemoteEmpty(remote) && !areArchiveSetsEqual(remote.archiveIds, activeArchiveIds)) {
          rerunRequestedRef.current = false;
          openConflict(activeArchiveIds, remote);
          return;
        }
        base = remote;
        baselineRef.current = remote;
      }

      const baseArchiveIds = splitArchiveIds(base.archiveIds, knownArchiveIdsRef.current).known;
      const patch = buildArchivePatch(baseArchiveIds, activeArchiveIds);
      const setArchiveIds = normalizeArchiveIds([...patch.setArchiveIds, ...retainedLocalArchiveIds]);
      if (setArchiveIds.length === 0 && patch.clearArchiveIds.length === 0) {
        baselineRef.current = { ...base, archiveIds: activeArchiveIds };
        return;
      }

      const payload: ArchiveProgressSyncRequestPayload = {
        baseRevision: base.revision,
        clientMutationId: buildMutationId(),
        archiveIndexHash: manifest.archiveIndexHash,
        setArchiveIds,
        clearArchiveIds: patch.clearArchiveIds,
        updatedAt: options.updatedAt ?? localState.updatedAt,
      };
      const pending: PendingArchiveMutation = {
        uid,
        payload,
        archiveIds: activeArchiveIds,
      };
      pendingMutationRef.current = pending;
      persistPendingMutation(uid, pending);
      const response = await withManifestRetry(
        manifest,
        () => syncCloudArchiveProgress(payload, { keepalive: options.keepalive }),
      );
      if (sessionUidRef.current !== uid) return;
      pendingMutationRef.current = null;
      persistPendingMutation(uid, null);
      baselineRef.current = {
        ...response.progress,
        archiveIds: activeArchiveIds,
      };
      void reason;
    } catch (error) {
      if (sessionUidRef.current !== uid) return;
      if (error instanceof ProgressSyncError) {
        const current = currentArchiveProgressFromError(error);
        if (error.status === 409 && current) {
          const local = splitArchiveIds(
            useUserRecordStore.getState().activeArchives,
            knownArchiveIdsRef.current,
          );
          const remote = {
            ...current,
            archiveIds: splitArchiveIds(current.archiveIds, knownArchiveIdsRef.current).known,
          };
          const pendingAtConflict = pendingMutationRef.current;
          pendingMutationRef.current = null;
          if (sessionUidRef.current) persistPendingMutation(sessionUidRef.current, null);
          const remoteMatchesLocal = areArchiveSetsEqual(local.known, remote.archiveIds);
          const remoteAcknowledgesPending = pendingAtConflict?.uid === uid
            && areArchiveSetsEqual(pendingAtConflict.archiveIds, remote.archiveIds);
          if (remoteMatchesLocal || remoteAcknowledgesPending) {
            baselineRef.current = remote;
            rerunRequestedRef.current = !remoteMatchesLocal || local.unknown.length > 0;
            return;
          }
          rerunRequestedRef.current = false;
          openConflict(local.known, remote);
          return;
        }
        if (error.code === 'IDEMPOTENCY_KEY_REUSED') {
          pendingMutationRef.current = null;
          if (sessionUidRef.current) persistPendingMutation(sessionUidRef.current, null);
        }
      }
      console.warn('[intel][archive-sync] failed', error);
    } finally {
      inFlightRef.current = false;
      if (rerunRequestedRef.current) {
        rerunRequestedRef.current = false;
        queueMicrotask(() => { void syncNowRef.current('auto'); });
      }
    }
  }, [clearAutoSyncTimer, ensureManifest, openConflict, withManifestRetry]);
  syncNowRef.current = syncNow;

  useEffect(() => {
    const uid = sessionUser?.uid ?? null;
    sessionUidRef.current = uid;
    baselineRef.current = null;
    rerunRequestedRef.current = false;
    pendingMutationRef.current = uid ? readPendingMutation(uid) : null;
    clearAutoSyncTimer();
    setConflict(null);
    if (!uid) return;
    void Promise.resolve(useUserRecordStore.persist.rehydrate()).then(() => {
      if (sessionUidRef.current === uid) void syncNow('startup');
    });
  }, [clearAutoSyncTimer, sessionUser?.uid, syncNow]);

  useEffect(() => useUserRecordStore.subscribe((state, previousState) => {
    if (suppressLocalChangeRef.current) return;
    if (areArchiveSetsEqual(state.activeArchives, previousState.activeArchives)) return;
    if (!sessionUidRef.current) return;
    clearAutoSyncTimer();
    autoSyncTimerRef.current = window.setTimeout(() => {
      autoSyncTimerRef.current = null;
      void syncNow('auto');
    }, AUTO_SYNC_DELAY_MS);
  }), [clearAutoSyncTimer, syncNow]);

  useEffect(() => addProgressSyncRequestHandler(() => syncNow('manual')), [syncNow]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') void syncNow('visibility', { keepalive: true });
      else if (document.visibilityState === 'visible') void syncNow('visibility');
    };
    const handlePageHide = () => { void syncNow('visibility', { keepalive: true }); };
    const handleOnline = () => { void syncNow('online'); };
    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('online', handleOnline);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('online', handleOnline);
      clearAutoSyncTimer();
    };
  }, [clearAutoSyncTimer, syncNow]);

  const handleConflictResolve = useCallback((choice: SyncConflictChoice) => {
    if (!conflict) return;
    const remoteBase = conflict.remoteProgress;
    const resolvedArchiveIds = choice === 'a'
      ? conflict.localArchiveIds
      : choice === 'b'
        ? remoteBase.archiveIds
        : normalizeArchiveIds([...conflict.localArchiveIds, ...remoteBase.archiveIds]);
    setConflict(null);
    baselineRef.current = remoteBase;
    if (choice === 'b') {
      replaceKnownArchives(resolvedArchiveIds);
      return;
    }
    if (choice === 'merge') replaceKnownArchives(resolvedArchiveIds);
    void syncNow('conflict', {
      forceBase: remoteBase,
      archiveIds: resolvedArchiveIds,
      updatedAt: Date.now(),
    });
  }, [conflict, replaceKnownArchives, syncNow]);

  if (!conflict) return null;
  return (
    <SyncConflictModal
      open
      sourceA={{
        side: 'local',
        updatedAt: conflict.localUpdatedAt,
        pointIds: [],
        archiveIds: conflict.localArchiveIds,
      }}
      sourceB={{
        side: 'remote',
        remoteSource: 'oemDb',
        updatedAt: conflict.remoteProgress.updatedAt,
        pointIds: [],
        archiveIds: conflict.remoteProgress.archiveIds,
      }}
      archiveLabel={tUI('intel.nonMapArchives')}
      totalLabel={tUI('intel.nonMapArchives')}
      onClose={() => setConflict(null)}
      onResolve={handleConflictResolve}
    />
  );
};

export default ArchiveProgressSyncHost;
