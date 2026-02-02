import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useUserRecord } from './userRecord';
import useRegion from './region';
import { useMemo } from 'react';
import { IMarkerData, SUBREGION_MARKS_MAP, WORLD_MARKS, SUBREGION_TYPE_COUNT_MAP, REGION_TYPE_COUNT_MAP } from '@/data/marker';
import { REGION_DICT } from '@/data/map';

interface IMarkerStore {
    currentActivePoint: IMarkerData | null;
    setCurrentActivePoint: (point: IMarkerData) => void;
    filter: string[];
    points: string[];
    switchFilter: (typeKey: string) => void;
    batchToggleFilter: (typeKeys: string[]) => void;
    setFilter: (filter: string[]) => void;

    searchString: string;
    setSearchString: (string) => void;

    // Persisted selected points (for UI selected state)
    selectedPoints: string[];
    toggleSelected: (id: string) => void;
    setSelected: (id: string, value: boolean) => void;
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
            setFilter: (newFilter: string[]) => {
                set({ filter: newFilter });
            },
            searchString: '',
            setSearchString: (value: string) => {
                set({ searchString: value });
            },
            selectedPoints: [],
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

export const useWorldMarkerCount = (type: string | undefined) => {
    const pointsRecord = useUserRecord();
    return useMemo(() => {
        const ret = { total: 0, collected: 0 };
        if (!type) return ret;
        // 使用预计算的总数，只需计算已收集数量
        const worldTotal = WORLD_MARKS.filter((m) => m.type === type);
        ret.total = worldTotal.length;
        ret.collected = worldTotal.filter((m) =>
            pointsRecord.includes(m.id),
        ).length;
        return ret;
    }, [pointsRecord, type]);
};

export const useRegionMarkerCount = (type: string | undefined) => {
    const pointsRecord = useUserRecord();
    const currentRegion = useRegion((state) => state.currentRegionKey);
    return useMemo(() => {
        const ret = { total: 0, collected: 0 };
        if (!type || !currentRegion) return ret;
        // 使用预计算的区域类型统计
        const regionTypeCounts = REGION_TYPE_COUNT_MAP[currentRegion];
        ret.total = regionTypeCounts?.[type] ?? 0;
        // 计算已收集数量
        const regionConfig = REGION_DICT[currentRegion];
        const subRegions = regionConfig?.subregions ?? [];
        const regionMarkers = subRegions
            .map((sr) => SUBREGION_MARKS_MAP[sr])
            .flat()
            .filter((m) => m.type === type);
        ret.collected = regionMarkers.filter((m) =>
            pointsRecord.includes(m.id),
        ).length;
        return ret;
    }, [pointsRecord, currentRegion, type]);
};

// Get the marker count for a specific subregion (based on current active point)
export const useSubregionMarkerCount = (type?: string, subregionId?: string) => {
    const pointsRecord = useUserRecord();
    return useMemo(() => {
        const ret = { total: 0, collected: 0 };
        if (!type || !subregionId) return ret;
        // 使用预计算的子区域类型统计
        const subregionTypeCounts = SUBREGION_TYPE_COUNT_MAP[subregionId];
        ret.total = subregionTypeCounts?.[type] ?? 0;
        // 计算已收集数量
        const subregionMarks = SUBREGION_MARKS_MAP[subregionId] ?? [];
        const subregionMarkers = subregionMarks.filter((m) => m.type === type);
        ret.collected = subregionMarkers.filter((m) =>
            pointsRecord.includes(m.id),
        ).length;
        return ret;
    }, [pointsRecord, subregionId, type]);
};
