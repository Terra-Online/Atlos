import { MARKER_TYPE_TREE, type IMarkerType } from './index';

export interface BinderGroup {
    dropKey: string;
    dropName: string;
    types: IMarkerType[];
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

const BINDER_KEY_CONFIG: Record<string, BinderKeyConfig> = {
    mob: { sharedKey: 'drop' },
    archives: { sharedKey: 'ctgr', titleKeyPrefix: 'markerType.fileCtgr' },
};

function nameToKey(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, '');
}

function computeBinderData(_subCategory: string, types: IMarkerType[], sharedKey: string, titleKeyPrefix?: string): BinderData {
    const grouped = new Map<string, { dropName: string; types: IMarkerType[] }>();
    const remaining: IMarkerType[] = [];

    for (const t of types) {
        const val = (t as unknown as Record<string, unknown>)[sharedKey];
        if (typeof val === 'string' && val) {
            const key = nameToKey(val);
            if (!grouped.has(key)) {
                grouped.set(key, { dropName: val, types: [] });
            }
            grouped.get(key)!.types.push(t);
        } else {
            remaining.push(t);
        }
    }

    const groups: BinderGroup[] = Array.from(grouped.entries())
        .map(([dropKey, { dropName, types }]) => ({ dropKey, dropName, types, titleKeyPrefix }))
        // Non-1:1 (multi-type) groups first so masonry tall cards lead; 1:1 groups fill trailing space
        .sort((a, b) => {
            const aMulti = a.types.length > 1 ? 0 : 1;
            const bMulti = b.types.length > 1 ? 0 : 1;
            return aMulti - bMulti;
        });

    return { sharedKey, groups, remaining };
}

export const BINDER_GROUPS_BY_SUB: Record<string, BinderData> = Object.entries(BINDER_KEY_CONFIG).reduce(
    (acc, [sub, config]) => {
        const types = MARKER_TYPE_TREE[sub];
        if (types) {
            acc[sub] = computeBinderData(sub, types, config.sharedKey, config.titleKeyPrefix);
        }
        return acc;
    },
    {} as Record<string, BinderData>,
);
