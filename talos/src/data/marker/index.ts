import markerTypeDict from './type.json';

export interface IMarkerData {
    id: string;
    position: [number, number];
    subregionId: string;
    type: string;
    // meta?: Record<string, any>
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
// TODO 当前实现并不能实现懒加载内容
const modules = import.meta.glob('./data/*.json', { eager: true }) as Record<
    string,
    { default: IMarkerData[] }
>;
/**
 * 子区域到markerData列表的数据映射
 */
export const SUBREGION_MARKS_MAP = Object.keys(modules).reduce((acc, key) => {
    const subregionId = key.replace('./data/', '').replace('.json', '');
    acc[subregionId] = modules[key].default || modules[key];
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

export const MARKER_TYPE_TREE = Object.values(MARKER_TYPE_DICT).reduce(
    (acc, type) => {
        acc[type.category.main] = acc[type.category.main] || {};
        acc[type.category.main][type.category.sub] =
            acc[type.category.main][type.category.sub] || [];
        acc[type.category.main][type.category.sub].push(type);
        return acc;
    },
    {},
) as Record<string, Record<string, IMarkerType[]>>;
