import { useCallback, useEffect, useMemo, useState } from 'react';
import { useUserRecordStore } from '@main/store/userRecord';
import type { IntelArchive } from '@intel/data/types';

const CHANNEL_NAME = 'atlos-intel-progress';

const publishProgressChange = () => {
  try {
    const channel = new BroadcastChannel(CHANNEL_NAME);
    channel.postMessage({ updatedAt: Date.now() });
    channel.close();
  } catch {
    // Storage events still synchronize browsers without BroadcastChannel.
  }
};

const collectionId = (archive: IntelArchive) => (
  archive.acquisition.method === 'map'
    ? String(archive.acquisition.pointId)
    : archive.id
);

const rehydrateProgress = () => {
  const raw = localStorage.getItem('points-storage');
  if (!raw) return;
  try {
    const parsed = JSON.parse(raw) as {
      state?: { activePoints?: unknown; activeArchives?: unknown; updatedAt?: unknown };
    };
    const activePoints = Array.isArray(parsed.state?.activePoints)
      ? parsed.state.activePoints.map(String)
      : [];
    const activeArchives = Array.isArray(parsed.state?.activeArchives)
      ? parsed.state.activeArchives.map(String)
      : [];
    const updatedAt = typeof parsed.state?.updatedAt === 'number' ? parsed.state.updatedAt : Date.now();
    useUserRecordStore.setState({ activePoints, activeArchives, updatedAt });
  } catch {
    // Ignore malformed storage; the main store owns its persisted shape.
  }
};

export const useIntelCollection = (archives: IntelArchive[]) => {
  const mapPointIds = useUserRecordStore((state) => state.activePoints);
  const localArchiveIds = useUserRecordStore((state) => state.activeArchives);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let active = true;
    void Promise.resolve(useUserRecordStore.persist.rehydrate()).then(() => {
      if (active) setIsReady(true);
    });
    const onStorage = (event: StorageEvent) => {
      if (event.key === 'points-storage') rehydrateProgress();
    };
    let channel: BroadcastChannel | null = null;
    try {
      channel = new BroadcastChannel(CHANNEL_NAME);
      channel.onmessage = () => rehydrateProgress();
    } catch {
      channel = null;
    }
    window.addEventListener('storage', onStorage);
    return () => {
      active = false;
      window.removeEventListener('storage', onStorage);
      channel?.close();
    };
  }, []);

  const mapSet = useMemo(() => new Set(mapPointIds), [mapPointIds]);
  const localSet = useMemo(() => new Set(localArchiveIds), [localArchiveIds]);
  const collectedIds = useMemo(() => new Set(
    archives
      .filter((archive) => archive.acquisition.method === 'map'
        ? mapSet.has(collectionId(archive))
        : localSet.has(collectionId(archive)))
      .map((archive) => archive.id),
  ), [archives, localSet, mapSet]);

  const toggle = useCallback((archive: IntelArchive) => {
    const id = collectionId(archive);
    if (archive.acquisition.method !== 'map') {
      useUserRecordStore.setState((state) => ({
        activeArchives: state.activeArchives.includes(id)
          ? state.activeArchives.filter((archiveId) => archiveId !== id)
          : [...state.activeArchives, id],
        updatedAt: Date.now(),
      }));
      publishProgressChange();
      return;
    }
    useUserRecordStore.setState((state) => ({
      activePoints: state.activePoints.includes(id)
        ? state.activePoints.filter((pointId) => pointId !== id)
        : [...state.activePoints, id],
      updatedAt: Date.now(),
    }));
    publishProgressChange();
  }, []);

  const setCollected = useCallback((selectedArchives: IntelArchive[], collected: boolean) => {
    const localIds = selectedArchives.flatMap((archive) => archive.acquisition.method !== 'map'
      ? [collectionId(archive)]
      : []);
    const mapIds = selectedArchives.flatMap((archive) => archive.acquisition.method === 'map'
      ? [collectionId(archive)]
      : []);
    if (localIds.length === 0 && mapIds.length === 0) return;
    useUserRecordStore.setState((state) => {
      const activeArchives = new Set(state.activeArchives);
      const activePoints = new Set(state.activePoints);
      localIds.forEach((archiveId) => {
        if (collected) activeArchives.add(archiveId);
        else activeArchives.delete(archiveId);
      });
      mapIds.forEach((pointId) => {
        if (collected) activePoints.add(pointId);
        else activePoints.delete(pointId);
      });
      return {
        activeArchives: Array.from(activeArchives),
        activePoints: Array.from(activePoints),
        updatedAt: Date.now(),
      };
    });
    publishProgressChange();
  }, []);

  const applyCollectedState = useCallback((
    selectedArchives: IntelArchive[],
    nextCollectedArchiveIds: ReadonlySet<string>,
  ) => {
    const localUpdates = new Map<string, boolean>();
    const mapUpdates = new Map<string, boolean>();
    selectedArchives.forEach((archive) => {
      const nextCollected = nextCollectedArchiveIds.has(archive.id);
      if (archive.acquisition.method !== 'map') {
        localUpdates.set(collectionId(archive), nextCollected);
      } else {
        mapUpdates.set(collectionId(archive), nextCollected);
      }
    });

    if (localUpdates.size > 0 || mapUpdates.size > 0) {
      let changed = false;
      useUserRecordStore.setState((state) => {
        const activeArchives = new Set(state.activeArchives);
        const activePoints = new Set(state.activePoints);
        localUpdates.forEach((isCollected, archiveId) => {
          if (activeArchives.has(archiveId) === isCollected) return;
          changed = true;
          if (isCollected) activeArchives.add(archiveId);
          else activeArchives.delete(archiveId);
        });
        mapUpdates.forEach((isCollected, pointId) => {
          if (activePoints.has(pointId) === isCollected) return;
          changed = true;
          if (isCollected) activePoints.add(pointId);
          else activePoints.delete(pointId);
        });
        return changed ? {
          activeArchives: Array.from(activeArchives),
          activePoints: Array.from(activePoints),
          updatedAt: Date.now(),
        } : state;
      });
      if (changed) publishProgressChange();
    }
  }, []);

  return { collectedIds, toggle, setCollected, applyCollectedState, isReady };
};
