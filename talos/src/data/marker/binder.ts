import { MARKER_TYPE_TREE, type IMarkerType } from './index';

export interface BinderGroup {
    id: string;
    dropKey: string;
    dropName: string;
    types: IMarkerType[];
    sharedKey: string;
    titleKeyPrefix?: string;
}

export interface BinderData {
    sharedKey: string;
    groups: BinderGroup[];
    remaining: IMarkerType[];
}

interface BinderKeyConfig {
    sharedKey: string;
    titleKeyPrefix?: string;
}

const BINDER_KEY_CONFIG: Record<string, BinderKeyConfig[]> = {
    mob: [{ sharedKey: 'drop' }],
    archives: [
        { sharedKey: 'rsch', titleKeyPrefix: 'markerType.researchId' },
        { sharedKey: 'ctgr', titleKeyPrefix: 'markerType.FileCtgr' },
    ],
};

function nameToKey(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, '');
}

function computeBinderGroups(types: IMarkerType[], sharedKey: string, titleKeyPrefix?: string): BinderGroup[] {
    const grouped = new Map<string, { dropName: string; types: IMarkerType[] }>();

    for (const t of types) {
        const val = (t as unknown as Record<string, unknown>)[sharedKey];
        if (typeof val === 'string' && val) {
            const key = nameToKey(val);
            if (!grouped.has(key)) {
                grouped.set(key, { dropName: val, types: [] });
            }
            const group = grouped.get(key);
            if (group) {
                group.types.push(t);
            }
        }
    }

    return Array.from(grouped.entries())
        .map(([dropKey, { dropName, types }]) => ({
            id: `${sharedKey}:${dropKey}`,
            dropKey,
            dropName,
            types,
            sharedKey,
            titleKeyPrefix,
        }))
        // Non-1:1 (multi-type) groups first so masonry tall cards lead; 1:1 groups fill trailing space
        .sort((a, b) => {
            const aMulti = a.types.length > 1 ? 0 : 1;
            const bMulti = b.types.length > 1 ? 0 : 1;
            return aMulti - bMulti;
        });
}

function computeBinderData(_subCategory: string, types: IMarkerType[], configs: BinderKeyConfig[]): BinderData {
    const groups = configs.flatMap((config) =>
        computeBinderGroups(types, config.sharedKey, config.titleKeyPrefix),
    );

    const coveredTypeKeys = new Set(
        groups.flatMap((group) => group.types.map((typeInfo) => typeInfo.key)),
    );
    const remaining = types.filter((typeInfo) => !coveredTypeKeys.has(typeInfo.key));

    const sharedKey = configs.map((config) => config.sharedKey).join('|');
    return { sharedKey, groups, remaining };
}

export const BINDER_GROUPS_BY_SUB: Record<string, BinderData> = Object.entries(BINDER_KEY_CONFIG).reduce(
    (acc, [sub, configs]) => {
        const types = MARKER_TYPE_TREE[sub];
        if (types) {
            acc[sub] = computeBinderData(sub, types, configs);
        }
        return acc;
    },
    {} as Record<string, BinderData>,
);
