import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useUserRecord } from './userRecord';
import useRegion from './region';
import { DATASET_VERSION } from '@/data/migration/version';
import { useEffect, useMemo } from 'react';
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

interface IMarkerStore {
    currentActivePoint: IMarkerData | null;
    setCurrentActivePoint: (point: IMarkerData) => void;
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
    setTemporarySelected: (id: string, value: boolean) => void;
    clearTemporarySelected: (ids?: Iterable<string>) => void;

    /** Version of the dataset when selectedPoints was last modified */
    datasetVersion: number;
    markerDataVersion: number;
    bumpMarkerDataVersion: () => void;
}

export const useMarkerStore = create<IMarkerStore>()(
    persist(
        (set, get) => ({
            currentActivePoint: null,
            setCurrentActivePoint: (point) => {
                const prev = get().currentActivePoint;
                // If user clicks the same point again, still emit an update so UI can re-open.
                if (prev?.id === point.id) {
                    set({ currentActivePoint: { ...point } });
                    return;
                }
                set({ currentActivePoint: point });
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
            datasetVersion: DATASET_VERSION,
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
                            datasetVersion: DATASET_VERSION,
                        };
                    } else {
                        return {
                            selectedPoints: exists
                                ? state.selectedPoints.filter((x) => x !== id)
                                : state.selectedPoints,
                            datasetVersion: DATASET_VERSION,
                        };
                    }
                });
            },
            setTemporarySelected: (id: string, value: boolean) => {
                set((state) => {
                    const exists = state.temporarySelectedPoints.includes(id);
                    if (value) {
                        return exists
                            ? {}
                            : { temporarySelectedPoints: [...state.temporarySelectedPoints, id] };
                    }
                    return exists
                        ? { temporarySelectedPoints: state.temporarySelectedPoints.filter((x) => x !== id) }
                        : {};
                });
            },
            clearTemporarySelected: (ids?: Iterable<string>) => {
                set((state) => {
                    if (!ids) {
                        return state.temporarySelectedPoints.length > 0
                            ? { temporarySelectedPoints: [] }
                            : {};
                    }
                    const idSet = new Set(ids);
                    if (idSet.size === 0) return {};
                    const next = state.temporarySelectedPoints.filter((id) => !idSet.has(id));
                    return next.length !== state.temporarySelectedPoints.length
                        ? { temporarySelectedPoints: next }
                        : {};
                });
            },
            markerDataVersion: 0,
            bumpMarkerDataVersion: () => {
                set((state) => ({ markerDataVersion: state.markerDataVersion + 1 }));
            },
        }),
        {
            name: 'marker-filter',
            partialize: (state) => ({ filter: state.filter, selectedPoints: state.selectedPoints, datasetVersion: state.datasetVersion }),
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

export const useWorldMarkerCount = (type: string | undefined) => {
    const pointsRecord = useUserRecord();
    const markerDataVersion = useMarkerStore((state) => state.markerDataVersion);

    useEffect(() => {
        if (!type) return;
        void loadAllMarkers().then(() => {
            useMarkerStore.getState().bumpMarkerDataVersion();
        });
    }, [type]);

    return useMemo(() => {
        void markerDataVersion;
        const ret = { total: 0, collected: 0 };
        if (!type) return ret;
        ret.total = WORLD_TYPE_COUNT_MAP[type] ?? 0;
        const worldMarkers = getLoadedWorldMarkers().filter((m) => m.type === type);
        ret.collected = worldMarkers.filter((m) =>
            pointsRecord.includes(m.id),
        ).length;
        return ret;
    }, [markerDataVersion, pointsRecord, type]);
};

export const useRegionMarkerCount = (type: string | undefined) => {
    const pointsRecord = useUserRecord();
    const currentRegion = useRegion((state) => state.currentRegionKey);
    const markerDataVersion = useMarkerStore((state) => state.markerDataVersion);
    return useMemo(() => {
        void markerDataVersion;
        const ret = { total: 0, collected: 0 };
        if (!type || !currentRegion) return ret;
        // 使用预计算的区域类型统计
        const regionTypeCounts = REGION_TYPE_COUNT_MAP[currentRegion];
        ret.total = regionTypeCounts?.[type] ?? 0;
        // 计算已收集数量
        const regionMarkers = getLoadedRegionMarkers(currentRegion).filter((m) => m.type === type);
        ret.collected = regionMarkers.filter((m) =>
            pointsRecord.includes(m.id),
        ).length;
        return ret;
    }, [markerDataVersion, pointsRecord, currentRegion, type]);
};

export const useMultiRegionMarkerCount = (types: string[]) => {
    const pointsRecord = useUserRecord();
    const currentRegion = useRegion((state) => state.currentRegionKey);
    const markerDataVersion = useMarkerStore((state) => state.markerDataVersion);
    return useMemo(() => {
        void markerDataVersion;
        if (!currentRegion) return types.map(() => ({ total: 0, collected: 0 }));
        const regionTypeCounts = REGION_TYPE_COUNT_MAP[currentRegion];
        const allMarkers = getLoadedRegionMarkers(currentRegion);
        return types.map((type) => {
            const total = regionTypeCounts?.[type] ?? 0;
            const collected = allMarkers.filter(
                (m) => m.type === type && pointsRecord.includes(m.id),
            ).length;
            return { total, collected };
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [markerDataVersion, pointsRecord, currentRegion, types.join(',')]);
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
        const subregionMarkers = getLoadedSubregionMarkers(subregionId).filter((m) => m.type === type);
        ret.collected = subregionMarkers.filter((m) =>
            pointsRecord.includes(m.id),
        ).length;
        return ret;
    }, [markerDataVersion, pointsRecord, subregionId, type]);
};
