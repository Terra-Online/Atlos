import markerTypeDict from './type.json';
import { REGION_DICT } from '@/data/map';

export interface IMarkerData {
    id: string;
    position: [number, number];
    subregionId: string;
    type: string;
    // meta?: Record<string, any>
}

// Raw marker data from JSON (id may be number or string)
interface IRawMarkerData {
    id: string | number;
    position: [number, number];
    subregionId: string;
    type: string;
}

export interface IMarkerType {
    key: string;
    noFrame?: boolean;
    subIcon?: string;
    category: {
        main: string;
        sub: string;
    };
}

/**
 * Convert raw marker data to normalized format with string IDs
 * This ensures numeric IDs are converted to strings to avoid precision issues
 */
const normalizeMarker = (raw: IRawMarkerData): IMarkerData => ({
    ...raw,
    id: String(raw.id),
});

// TODO 当前实现并不能实现懒加载内容
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
const modules = import.meta.glob('./data/*.json', { eager: true }) as Record<
    string,
    { default: IRawMarkerData[] }
>;
/**
 * 子区域到markerData列表的数据映射
 * All marker IDs are normalized to strings
 */
export const SUBREGION_MARKS_MAP = Object.keys(modules).reduce((acc, key) => {
    const subregionId = key.replace('./data/', '').replace('.json', '');
    const rawMarkers = modules[key].default || modules[key];
    // Normalize all markers to ensure string IDs
    acc[subregionId] = rawMarkers.map(normalizeMarker);
    return acc;
}, {}) as Record<string, IMarkerData[]>;

export const WORLD_MARKS = Object.values(SUBREGION_MARKS_MAP).reduce(
    (acc, subregion) => {
        acc.push(...subregion);
        return acc;
    },
    [],
);

export const MARKER_TYPE_DICT = markerTypeDict as Record<string, IMarkerType>;

/**
 * 预计算每个子区域中各类型的数量
 * 格式: { subregionId: { type: count } }
 */
export const SUBREGION_TYPE_COUNT_MAP: Record<string, Record<string, number>> = Object.entries(SUBREGION_MARKS_MAP).reduce(
    (acc, [subregionId, markers]) => {
        const typeCounts: Record<string, number> = {};
        markers.forEach((marker) => {
            typeCounts[marker.type] = (typeCounts[marker.type] || 0) + 1;
        });
        acc[subregionId] = typeCounts;
        return acc;
    },
    {} as Record<string, Record<string, number>>,
);

/**
 * 预计算每个大区域中各类型的数量
 * 格式: { regionKey: { type: count } }
 */
export const REGION_TYPE_COUNT_MAP: Record<string, Record<string, number>> = Object.entries(REGION_DICT).reduce(
    (acc, [regionKey, regionConfig]) => {
        const typeCounts: Record<string, number> = {};
        const subregions = regionConfig.subregions ?? [];
        subregions.forEach((subregionId) => {
            const subregionTypeCounts = SUBREGION_TYPE_COUNT_MAP[subregionId] ?? {};
            Object.entries(subregionTypeCounts).forEach(([type, count]) => {
                typeCounts[type] = (typeCounts[type] || 0) + count;
            });
        });
        acc[regionKey] = typeCounts;
        return acc;
    },
    {} as Record<string, Record<string, number>>,
);

export const DEFAULT_SUBCATEGORY_ORDER = [
    'collection',
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
