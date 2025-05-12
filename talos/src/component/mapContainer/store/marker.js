import { Layer, LayerGroup, Map, divIcon, icon } from "leaflet";
import { MAP_CONFIGS } from "../map_config"
import { MARKER_TYPE_DICT, SUBREGION_MARKS_MAP, WORLD_MARKS } from "../../../data/marker";
import LOGGER from "../../../utils/log";
import { create } from "zustand";
import { getMarkerIconUrl } from "../../../utils/resource";
import "./marker.scss"
import { getMarkerLayer } from "./markerRenderer";
import { useMemo } from "react";
import { useUserRecord } from "./userRecord";
import useRegion from "./region";

/**
 * @type {string[]}
 */
const MAP_SUBREGION_KEY_ARRAY = Object.keys(MAP_CONFIGS).map(regionId => {
    const subregions = MAP_CONFIGS[regionId].subregions
    return subregions ? subregions.map(subregion => subregion.id) : [regionId]
}).flat();


// leaflet renderer
export class MarkerLayer {
    /**
     * @type {Map}
     */
    map
    /**
     * @type {Record<string, LayerGroup>}
     */
    layerSubregionDict = {}

    /**
     * marker唯一id到Layer映射
     * @type {Record<string, Layer>}
     */
    markerDict = {}

    /**
     * marker唯一id到markerData映射
     * @type {Record<string, import("./marker.type").IMarkerData>}
     */
    markerDataDict = {}

    /**
     * type唯一id到markerId映射
     * @type {Record<string, string[]>}
     */
    markerTypeMap = {}

    /**
     * 
     * @param {Map} map 
     */
    constructor(map) {
        this.map = map
        this.markerTypeMap = Object.values(MARKER_TYPE_DICT).reduce((acc, type) => {
            acc[type.key] = [];
            return acc;
        }, {});

        this.layerSubregionDict = MAP_SUBREGION_KEY_ARRAY.reduce((acc, key) => {
            acc[key] = new LayerGroup([], { pane: "markerPane" });
            // acc[key].addTo(this.layer);
            return acc;
        }, {})
        this.importMarker(Object.values(SUBREGION_MARKS_MAP).flat())
    }

    /**
     * 导入marker列表
     * @param {import("./marker.type").IMarkerData[]} markers 
     */
    importMarker(markers) {
        markers.forEach(marker => {

            const typeKey = marker.type;
            if (!this.markerTypeMap[typeKey]) {
                LOGGER.warn(`Missing type config for '${typeKey}'`)
                return
            }
            const layer = getMarkerLayer(marker)
            this.markerDict[marker.id] = layer;
            this.markerDataDict[marker.id] = marker;

            this.markerTypeMap[typeKey].push(marker.id);
            // layer.addTo(this.layerSubregionDict[marker.region.sub]);
        });
    }

    changeRegion(regionId) {
        Object.values(this.layerSubregionDict).forEach(layer => {
            layer.removeFrom(this.map);
        });
        const subregions = MAP_CONFIGS[regionId].subregions?.map(s => s.id) ?? [regionId]
        subregions.forEach(subregion => {
            this.layerSubregionDict[subregion].addTo(this.map)
        })
    }

    filterMarker(typeKeys) {
        const markerIds = typeKeys.flatMap(key => this.markerTypeMap[key]);
        Object.entries(this.markerDict).forEach(([id, layer]) => {
            const parent = this.layerSubregionDict[this.markerDataDict[id].subregionId]
            if (markerIds.includes(id)) {
                layer.addTo(parent);
            } else {
                layer.removeFrom(parent);
            }
        });
    }

    getCurrentPoints(regionId) {
        const subregions = MAP_CONFIGS[regionId].subregions?.map(s => s.id) ?? [regionId]
        const points = Object.values(this.markerDataDict)
        return points.filter(point => subregions.includes(point.subregionId))
    }
}

// store
const INIT_MARKER_FILTER = []

export const useMarkerStore = create((set) => ({
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

    // search
    searchString: "",
    setSearchString: (searchString) => {
        set({ searchString })
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
    const currentRegion = useRegion(state => state.currentRegion)
    const subRegions = useRegion(state => state.subregions)
    return useMemo(() => {
        const ret = { total: 0, collected: 0 }
        if (!type) return ret
        const regionTotal = (
            SUBREGION_MARKS_MAP[currentRegion] ??
            subRegions
                .map((sr) => SUBREGION_MARKS_MAP[sr.id])
                .flat()
        ).filter(m => m.type === type)
        ret.total = regionTotal.length
        ret.collected = regionTotal.filter(m => pointsRecord.includes(m.id)).length
        return ret
    }, [pointsRecord, subRegions, type, currentRegion])
}