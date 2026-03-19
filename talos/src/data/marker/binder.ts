import { MARKER_TYPE_TREE, type IMarkerType } from './index';

export interface BinderGroup {
    dropKey: string;
    dropName: string;
    types: IMarkerType[];
}

export interface BinderData {
    sharedKey: string;
    groups: BinderGroup[];
    remaining: IMarkerType[];
}

const BINDER_KEY_CONFIG: Record<string, string> = {
    mob: 'drop',
};

function nameToKey(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, '');
}

function computeBinderData(_subCategory: string, types: IMarkerType[], sharedKey: string): BinderData {
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

    const groups: BinderGroup[] = Array.from(grouped.entries()).map(([dropKey, { dropName, types }]) => ({
        dropKey,
        dropName,
        types,
    }));

    return { sharedKey, groups, remaining };
}

export const BINDER_GROUPS_BY_SUB: Record<string, BinderData> = Object.entries(BINDER_KEY_CONFIG).reduce(
    (acc, [sub, key]) => {
        const types = MARKER_TYPE_TREE[sub];
        if (types) {
            acc[sub] = computeBinderData(sub, types, key);
        }
        return acc;
    },
    {} as Record<string, BinderData>,
);
