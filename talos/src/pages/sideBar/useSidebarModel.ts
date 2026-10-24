import { useMemo } from 'react';
import { MARKER_TYPE_TREE } from '@/data/marker';
import { BINDER_GROUPS_BY_SUB } from '@/data/marker/binder';
import { VERSION_NEW_FILTER_GROUPS, useVersionNewMarkerCounts } from '@/data/marker/versionNew';
import { useTranslateGame } from '@/locale';
import { useMultiRegionMarkerCount, useSearchString } from '@/store/marker';
import { binderItem, selectorItem } from './model';

const types = [...new Map([...Object.values(MARKER_TYPE_TREE).flat(), ...VERSION_NEW_FILTER_GROUPS.flatMap(group => group.types)].map(type => [type.key, type])).values()];
const keys = types.map(type => type.key);

export function useSidebarModel(mobile: boolean) {
    const counts = useMultiRegionMarkerCount(keys);
    const versionCounts = useVersionNewMarkerCounts();
    const search = useSearchString();
    const translate = useTranslateGame();
    return useMemo(() => {
        const selectors = new Map(types.map((type, index) => [type.key, selectorItem(type, counts[index], search, translate)]));
        const binders = new Map(Object.values(BINDER_GROUPS_BY_SUB).flatMap(data => data.groups).map(group => [group.id, binderItem(group, selectors, search, translate, mobile)]));
        const version = new Map(VERSION_NEW_FILTER_GROUPS.map(group => [group.key, group.types.map(type => selectorItem(type, versionCounts[type.key] ?? { total: 0, collected: 0 }, search, translate)).filter(item => item.visible)]));
        return { selectors, binders, version };
    }, [counts, versionCounts, search, translate, mobile]);
}
