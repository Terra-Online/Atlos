import markerTypeDict from './type.json';
import markerStats from './stats.json';
import { REGION_DICT } from '@/data/map';

export interface IMarkerData {
    id: string;
    z: number;
    x: number;
    y: number;
    pos: [number, number];
    subregId: string;
    type: string;
    // meta?: Record<string, any>
}

// Raw marker data from JSON (id may be number or string)
type IRawMarkerTuple = [
    id: string | number,
    z: number,
    x: number,
    y: number,
    type: string | null,
];

interface IRawMarkerObject {
    id: string | number;
    z?: number;
    x?: number;
    y?: number;
    pos?: [number, number] | [number, number, number];
    subregId?: string;
    type: string | null;
}

type IRawMarkerData = IRawMarkerTuple | IRawMarkerObject;

export interface IMarkerType {
    key: string;
    noFrame?: boolean;
    subIcon?: string;
    icon?: string;
    ctgr?: string;
    rsch?: string;
    category: {
        main: string;
        sub: string;
    };
}

/**
 * Convert raw marker data to normalized format with string IDs
 * This ensures numeric IDs are converted to strings to avoid precision issues
 */
const normalizeMarker = (raw: IRawMarkerData, subregId: string): IMarkerData => {
    const rawObject = Array.isArray(raw)
        ? { id: raw[0], z: raw[1], x: raw[2], y: raw[3], type: raw[4] }
        : raw;
    const z = rawObject.z ?? rawObject.pos?.[0] ?? 0;
    const x = rawObject.x ?? rawObject.pos?.[1] ?? 0;
    const y = rawObject.y ?? rawObject.pos?.[2] ?? 0;

    return {
        id: String(rawObject.id),
        z,
        x,
        y,
        pos: [z, x],
        subregId: rawObject.subregId ?? subregId,
        type: rawObject.type ?? '',
    };
};

const modules = import.meta.glob('./data/*.json') as Record<
    string,
    () => Promise<{ default: IRawMarkerData[] }>
>;

const loadedSubregionMarksMap: Record<string, IMarkerData[]> = {};
const loadPromiseMap: Record<string, Promise<IMarkerData[]>> = {};

/**
 * 子区域到 markerData 列表的数据映射。
 * Only contains subregions that have already been loaded via loadSubregionMarkers/loadRegionMarkers.
 */
export const SUBREGION_MARKS_MAP = loadedSubregionMarksMap;

export const MARKER_TYPE_DICT = markerTypeDict as Record<string, IMarkerType>;

/**
 * 预计算每个子区域中各类型的数量。
 * 格式: { subregId: { type: count } }
 */
export const SUBREGION_TYPE_COUNT_MAP = markerStats.subregion as Record<string, Record<string, number>>;

/**
 * 预计算每个大区域中各类型的数量。
 * 格式: { regionKey: { type: count } }
 */
export const REGION_TYPE_COUNT_MAP = markerStats.region as Record<string, Record<string, number>>;

export const WORLD_TYPE_COUNT_MAP = markerStats.world as Record<string, number>;

export const loadSubregionMarkers = async (subregionId: string): Promise<IMarkerData[]> => {
    if (loadedSubregionMarksMap[subregionId]) {
        return loadedSubregionMarksMap[subregionId];
    }

    const modulePath = `./data/${subregionId}.json`;
    const loader = modules[modulePath];
    if (!loader) {
        loadedSubregionMarksMap[subregionId] = [];
        return loadedSubregionMarksMap[subregionId];
    }

    if (!Object.prototype.hasOwnProperty.call(loadPromiseMap, subregionId)) {
        loadPromiseMap[subregionId] = loader().then((mod) => {
            const rawMarkers = mod.default || [];
            const markers = rawMarkers.map((marker) => normalizeMarker(marker, subregionId));
            loadedSubregionMarksMap[subregionId] = markers;
            return markers;
        });
    }

    return loadPromiseMap[subregionId];
};

export const loadRegionMarkers = async (regionKey: string): Promise<IMarkerData[]> => {
    const subregions = REGION_DICT[regionKey]?.subregions ?? [];
    const markerGroups = await Promise.all(subregions.map((subregionId) => loadSubregionMarkers(subregionId)));
    return markerGroups.flat();
};

export const loadAllMarkers = async (): Promise<IMarkerData[]> => {
    const subregionIds = Object.keys(modules).map((key) =>
        key.replace('./data/', '').replace('.json', ''),
    );
    const markerGroups = await Promise.all(subregionIds.map((subregionId) => loadSubregionMarkers(subregionId)));
    return markerGroups.flat();
};

export const getLoadedRegionMarkers = (regionKey: string): IMarkerData[] => {
    const subregions = REGION_DICT[regionKey]?.subregions ?? [];
    return subregions.flatMap((subregionId) => loadedSubregionMarksMap[subregionId] ?? []);
};

export const getLoadedSubregionMarkers = (subregionId: string): IMarkerData[] =>
    loadedSubregionMarksMap[subregionId] ?? [];

export const getLoadedWorldMarkers = (): IMarkerData[] =>
    Object.values(loadedSubregionMarksMap).flat();

export const findMarkerById = async (pointId: string): Promise<IMarkerData | null> => {
    const markers = await loadAllMarkers();
    return markers.find((marker) => marker.id === String(pointId)) ?? null;
};

export const findUniqueArchiveMarkerByType = async (typeKey: string): Promise<IMarkerData | null> => {
    let match: IMarkerData | null = null;
    const markers = await loadAllMarkers();
    for (const marker of markers) {
        if (marker.type !== typeKey) continue;
        const markerType = MARKER_TYPE_DICT[marker.type];
        if (markerType?.category?.main !== 'files') continue;
        if (!match) {
            match = marker;
            continue;
        }
        if (match.id !== marker.id) return null;
    }
    return match;
};

export const DEFAULT_SUBCATEGORY_ORDER = [
    'collection',
    'archives',
    'exploration',
    'natural',
    'valuable',
    'combat',
    'npc',
    'facility',
    'mob',
    'boss',
] as const;

export const MARKER_TYPE_TREE: Record<string, IMarkerType[]> = Object.values(MARKER_TYPE_DICT).reduce(
    (acc: Record<string, IMarkerType[]>, type) => {
        const subCategory = type.category.sub;
        acc[subCategory] = acc[subCategory] || [];
        acc[subCategory].push(type);
        return acc;
    },
    {},
);
