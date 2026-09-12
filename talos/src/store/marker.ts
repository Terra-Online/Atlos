import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useUserRecord } from './userRecord';
import useRegion from './region';
import { useEffect, useMemo } from 'react';
import { CollectedCountCache } from './collectedCountCache';
import {
    getLoadedRegionMarkers,
    getLoadedSubregionMarkers,
    getLoadedWorldMarkers,
    IMarkerData,
    loadAllMarkers,
    REGION_TYPE_COUNT_MAP,
    SUBREGION_TYPE_COUNT_MAP,
    WORLD_TYPE_COUNT_MAP,
} from '@/data/marker';

export type ImageOpenRequest = {
    markerId: string;
    imageId: string;
    generation: number;
};

interface IMarkerStore {
    currentActivePoint: IMarkerData | null;
    setCurrentActivePoint: (point: IMarkerData) => void;
    imageOpenRequest: ImageOpenRequest | null;
    openMarkerImage: (markerId: string, imageId: string) => void;
    clearImageOpenRequest: () => void;
    filter: string[];
    points: string[];
    switchFilter: (typeKey: string) => void;
    batchToggleFilter: (typeKeys: string[]) => void;
    setFilterKeys: (typeKeys: string[], active: boolean) => void;
    setFilter: (filter: string[]) => void;

    searchString: string;
    setSearchString: (string) => void;

    // Persisted selected points (for UI selected state)
    selectedPoints: string[];
    // Non-persisted selected points mounted by transient flows such as locator reminders
    temporarySelectedPoints: string[];
    toggleSelected: (id: string) => void;
    setSelected: (id: string, value: boolean) => void;
    setSelectedBatch: (ids: Iterable<string>, value: boolean) => void;
    setTemporarySelected: (id: string, value: boolean) => void;
    setTemporarySelectedBatch: (ids: Iterable<string>) => void;
    clearTemporarySelected: (ids?: Iterable<string>) => void;

    markerDataVersion: number;
    bumpMarkerDataVersion: () => void;
}

export const useMarkerStore = create<IMarkerStore>()(
    persist(
        (set, get) => ({
            currentActivePoint: null,
            imageOpenRequest: null,
            setCurrentActivePoint: (point) => {
                const prev = get().currentActivePoint;
                // If user clicks the same point again, still emit an update so UI can re-open.
                if (prev?.id === point.id) {
                    set({ currentActivePoint: { ...point }, imageOpenRequest: null });
                    return;
                }
                set({ currentActivePoint: point, imageOpenRequest: null });
            },
            openMarkerImage: (markerId, imageId) => {
                const nextImageId = imageId.trim();
                if (!nextImageId) return;
                set((state) => ({
                    imageOpenRequest: {
                        markerId: String(markerId),
                        imageId: nextImageId,
                        generation: (state.imageOpenRequest?.generation ?? 0) + 1,
                    },
                }));
            },
            clearImageOpenRequest: () => {
                if (get().imageOpenRequest) {
                    set({ imageOpenRequest: null });
                }
            },
            filter: [],
            points: [],
            switchFilter: (typeKey) => {
                set((state) => {
                    const newFilter = state.filter.includes(typeKey)
                        ? state.filter.filter((key) => key !== typeKey)
                        : [...state.filter, typeKey];

                    return { filter: newFilter };
                });
            },
            batchToggleFilter: (typeKeys: string[]) => {
                set((state) => {
                    let newFilter = [...state.filter];
                    typeKeys.forEach(key => {
                        if (newFilter.includes(key)) {
                            newFilter = newFilter.filter(k => k !== key);
                        } else {
                            newFilter.push(key);
                        }
                    });
                    return { filter: newFilter };
                });
            },
            setFilterKeys: (typeKeys: string[], active: boolean) => {
                set((state) => {
                    if (active) {
                        const extra = typeKeys.filter((k) => !state.filter.includes(k));
                        return extra.length ? { filter: [...state.filter, ...extra] } : {};
                    } else {
                        const next = state.filter.filter((k) => !typeKeys.includes(k));
                        return next.length !== state.filter.length ? { filter: next } : {};
                    }
                });
            },
            setFilter: (newFilter: string[]) => {
                set({ filter: newFilter });
            },
            searchString: '',
            setSearchString: (value: string) => {
                set({ searchString: value });
            },
            selectedPoints: [],
            temporarySelectedPoints: [],
            toggleSelected: (id: string) => {
                const exists = get().selectedPoints.includes(id);
                get().setSelected(id, !exists);
            },
            setSelected: (id: string, value: boolean) => {
                set((state) => {
                    const exists = state.selectedPoints.includes(id);
                    if (value) {
                        return {
                            selectedPoints: exists
                                ? state.selectedPoints
                                : [...state.selectedPoints, id],
                        };
                    } else {
                        return {
                            selectedPoints: exists
                                ? state.selectedPoints.filter((x) => x !== id)
                                : state.selectedPoints,
                        };
                    }
                });
            },
            setSelectedBatch: (ids: Iterable<string>, value: boolean) => {
                const next = new Set(get().selectedPoints);
                let changed = false;
                for (const id of ids) {
                    if (value) { if (!next.has(id)) { next.add(id); changed = true; } }
                    else if (next.delete(id)) changed = true;
                }
                // Persist and notify once for the gesture, rather than once per selected point.
                if (changed) set({ selectedPoints: [...next] });
            },
            setTemporarySelected: (id: string, value: boolean) => {
                const current = get().temporarySelectedPoints;
                if (current.includes(id) === value) return;
                set({ temporarySelectedPoints: value ? [...current, id] : current.filter((x) => x !== id) });
            },
            setTemporarySelectedBatch: (ids: Iterable<string>) => {
                const current = get().temporarySelectedPoints;
                const next = new Set(current);
                for (const id of ids) next.add(id);
                if (next.size !== current.length) set({ temporarySelectedPoints: [...next] });
            },
            clearTemporarySelected: (ids?: Iterable<string>) => {
                const current = get().temporarySelectedPoints;
                if (!current.length) return;
                const remove = ids ? new Set(ids) : null;
                const next = remove ? current.filter((id) => !remove.has(id)) : [];
                if (next.length !== current.length) set({ temporarySelectedPoints: next });
            },
            markerDataVersion: 0,
            bumpMarkerDataVersion: () => {
                set((state) => ({ markerDataVersion: state.markerDataVersion + 1 }));
            },
        }),
        {
            name: 'marker-filter',
            partialize: (state) => ({ filter: state.filter, selectedPoints: state.selectedPoints }),
        },
    ),
);

export const usePoints = () => useMarkerStore((state) => state.points);
export const useFilter = () => useMarkerStore((state) => state.filter);
export const useSwitchFilter = () =>
    useMarkerStore((state) => state.switchFilter);
export const useBatchToggleFilter = () =>
    useMarkerStore((state) => state.batchToggleFilter);
export const useSetFilter = () =>
    useMarkerStore((state) => state.setFilter);

export const useSearchString = () =>
    useMarkerStore((state) => state.searchString);

export const useSelectedPoints = () =>
    useMarkerStore((state) => state.selectedPoints);
export const useToggleSelected = () =>
    useMarkerStore((state) => state.toggleSelected);

const collectedCounts = new CollectedCountCache();
let worldCountLoad: Promise<void> | undefined;
const ensureWorldCountData = () => {
    worldCountLoad ??= loadAllMarkers().then(() => { useMarkerStore.getState().bumpMarkerDataVersion(); }, error => { worldCountLoad = undefined; throw error; });
    return worldCountLoad;
};

export const useWorldMarkerCount = (type: string | undefined) => {
    const pointsRecord = useUserRecord();
    const markerDataVersion = useMarkerStore((state) => state.markerDataVersion);

    useEffect(() => {
        if (!type) return;
        void ensureWorldCountData();
    }, [type]);

    return useMemo(() => {
        void markerDataVersion;
        const ret = { total: 0, collected: 0 };
        if (!type) return ret;
        ret.total = WORLD_TYPE_COUNT_MAP[type] ?? 0;
        ret.collected = collectedCounts.get(pointsRecord, markerDataVersion, 'world', getLoadedWorldMarkers).get(type) ?? 0;
        return ret;
    }, [markerDataVersion, pointsRecord, type]);
};

export const useRegionMarkerCount = (type: string | undefined) => {
    const pointsRecord = useUserRecord();
    const currentRegion = useRegion((state) => state.currentRegionKey);
    const collected = useMarkerStore((state) => type && currentRegion
        ? collectedCounts.get(pointsRecord, state.markerDataVersion, `region:${currentRegion}`, () => getLoadedRegionMarkers(currentRegion)).get(type) ?? 0
        : 0);
    return useMemo(() => {
        const ret = { total: 0, collected: 0 };
        if (!type || !currentRegion) return ret;
        // 使用预计算的区域类型统计
        const regionTypeCounts = REGION_TYPE_COUNT_MAP[currentRegion];
        ret.total = regionTypeCounts?.[type] ?? 0;
        // 计算已收集数量
        ret.collected = collected;
        return ret;
    }, [collected, currentRegion, type]);
};

export const useMultiRegionMarkerCount = (types: string[]) => {
    const pointsRecord = useUserRecord();
    const currentRegion = useRegion((state) => state.currentRegionKey);
    const counts = useMarkerStore((state) => currentRegion ? collectedCounts.get(pointsRecord, state.markerDataVersion, `region:${currentRegion}`, () => getLoadedRegionMarkers(currentRegion)) : undefined);
    return useMemo(() => {
        if (!currentRegion) return types.map(() => ({ total: 0, collected: 0 }));
        const regionTypeCounts = REGION_TYPE_COUNT_MAP[currentRegion];
        return types.map((type) => {
            const total = regionTypeCounts?.[type] ?? 0;
            const collected = counts?.get(type) ?? 0;
            return { total, collected };
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [counts, currentRegion, types.join(',')]);
};

// Get the marker count for a specific subregion (based on current active point)
export const useSubregionMarkerCount = (type?: string, subregionId?: string) => {
    const pointsRecord = useUserRecord();
    const markerDataVersion = useMarkerStore((state) => state.markerDataVersion);
    return useMemo(() => {
        void markerDataVersion;
        const ret = { total: 0, collected: 0 };
        if (!type || !subregionId) return ret;
        // 使用预计算的子区域类型统计
        const subregionTypeCounts = SUBREGION_TYPE_COUNT_MAP[subregionId];
        ret.total = subregionTypeCounts?.[type] ?? 0;
        // 计算已收集数量
        ret.collected = collectedCounts.get(pointsRecord, markerDataVersion, `subregion:${subregionId}`, () => getLoadedSubregionMarkers(subregionId)).get(type) ?? 0;
        return ret;
    }, [markerDataVersion, pointsRecord, subregionId, type]);
};
