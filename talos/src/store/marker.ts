import { create } from "zustand"
import { useUserRecord } from "./userRecord";
import useRegion from "./region";
import { useMemo } from "react";
import { IMarkerData, SUBREGION_MARKS_MAP, WORLD_MARKS } from "@/data/marker";
import { REGION_DICT } from "@/data/map";

interface IMarkerStore {
    currentActivePoint: IMarkerData | null;
    setCurrentActivePoint: (point: IMarkerData) => void;
    filter: string[];
    points: string[];
    switchFilter: (typeKey: string) => void;

    searchString: string;
    setSearchString: (string) => void;
}

const INIT_MARKER_FILTER = []

export const useMarkerStore = create<IMarkerStore>((set) => ({
    currentActivePoint: null,
    setCurrentActivePoint: (point) => {
        set({ currentActivePoint: point })
    },
    filter: INIT_MARKER_FILTER,
    points: [],
    switchFilter: (typeKey) => {
        set(state => {
            if (state.filter.includes(typeKey)) {
                return { filter: state.filter.filter(key => key !== typeKey) }
            }
            return { filter: [...state.filter, typeKey] }
        })
    },
    searchString: '',
    setSearchString: (string) => {
        set({ searchString: string })
    },
}))

export const usePoints = () => useMarkerStore(state => state.points)
export const useFilter = () => useMarkerStore(state => state.filter)
export const useSwitchFilter = () => useMarkerStore(state => state.switchFilter)

export const useSearchString = () => useMarkerStore(state => state.searchString)

export const useWorldMarkerCount = (type) => {
    const pointsRecord = useUserRecord()
    return useMemo(() => {
        const ret = { total: 0, collected: 0 }
        if (!type) return ret
        const worldTotal = WORLD_MARKS.filter(m => m.type === type)
        ret.total = worldTotal.length
        ret.collected = worldTotal.filter(m => pointsRecord.includes(m.id)).length
        return ret
    }, [pointsRecord, type])
}

export const useRegionMarkerCount = (type) => {
    const pointsRecord = useUserRecord()
    const currentRegion = useRegion(state => state.currentRegionKey)
    const subRegions = REGION_DICT[currentRegion].subregions
    return useMemo(() => {
        const ret = { total: 0, collected: 0 }
        if (!type) return ret
        const regionTotal = subRegions
            .map((sr) => SUBREGION_MARKS_MAP[sr])
            .flat()
            .filter(m => m.type === type)
        ret.total = regionTotal.length
        ret.collected = regionTotal.filter(m => pointsRecord.includes(m.id)).length
        return ret
    }, [pointsRecord, subRegions, type, currentRegion])
}