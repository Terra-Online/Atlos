import type { IMarkerType } from '@/data/marker';
import type { BinderGroup } from '@/data/marker/binder';

export type Count = { total: number; collected: number };
export type Translate = (key: string) => string | number | null | undefined;
export interface SelectorItem {
    typeInfo: IMarkerType;
    name: string;
    count: Count;
    visible: boolean;
}
export interface BinderItem {
    group: BinderGroup;
    name: string;
    count: Count;
    visible: boolean;
    children: SelectorItem[];
    collapseChildren: boolean;
}

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, '');

export function selectorItem(typeInfo: IMarkerType, count: Count, search: string, translate: Translate): SelectorItem {
    const name = String(translate(`markerType.key.${typeInfo.key}`) ?? '');
    const query = search.toLowerCase();
    const source = typeInfo as IMarkerType & { ctgr?: string; rsch?: string; drop?: string };
    const tokens = [typeInfo.key, name];
    for (const [field, prefix] of [['ctgr', 'FileCtgr'], ['rsch', 'researchId'], ['drop', 'drop']] as const) {
        const raw = source[field]?.trim() ?? '', key = normalize(raw);
        if (raw) tokens.push(raw, key, String(translate(`markerType.${prefix}.${key}`) ?? ''));
    }
    return { typeInfo, name, count, visible: count.total > 0 && (!query || tokens.some(token => token.toLowerCase().includes(query))) };
}

export function binderItem(group: BinderGroup, items: ReadonlyMap<string, SelectorItem>, search: string, translate: Translate, mobile: boolean): BinderItem {
    const title = translate(`${group.titleKeyPrefix ?? 'markerType.drop'}.${group.dropKey}`);
    const name = typeof title === 'string' && title.trim() ? title : group.dropName;
    const rendered = group.types.map(type => items.get(type.key)).filter((item): item is SelectorItem => !!item?.visible);
    const count = rendered.reduce((sum, item) => ({ total: sum.total + item.count.total, collected: sum.collected + item.count.collected }), { total: 0, collected: 0 });
    const complete = (item: SelectorItem) => item.count.total > 0 && item.count.collected >= item.count.total;
    const children = [...rendered].sort((a, b) => Number(complete(b)) - Number(complete(a)));
    return { group, name, count, children, visible: children.length > 0,
        collapseChildren: !mobile && search === '' && rendered.length <= 1 };
}
