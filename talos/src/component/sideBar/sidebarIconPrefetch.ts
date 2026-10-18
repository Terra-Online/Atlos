import { MARKER_TYPE_TREE } from '@/data/marker';
import { BINDER_GROUPS_BY_SUB } from '@/data/marker/binder';
import { getItemIconUrl } from '@/services/assets/resource';

const requested = new Set<string>();

const getIconUrls = (): string[] => {
    const keys = new Set<string>();
    for (const typeInfo of Object.values(MARKER_TYPE_TREE).flat()) {
        const key = typeInfo.icon ?? typeInfo.key;
        if (key) keys.add(key);
    }
    for (const binderData of Object.values(BINDER_GROUPS_BY_SUB)) {
        for (const group of binderData.groups) {
            const key = group.sharedKey === 'rsch' ? 'investigate' : group.dropKey;
            if (key) keys.add(key);
        }
    }
    return [...keys].map((key) => String(getItemIconUrl(key, 'webp')));
};

/** Start marker icon requests as soon as the sidebar becomes usable. */
export const preloadSidebarIcons = (): void => {
    if (typeof Image === 'undefined') return;
    for (const url of getIconUrls()) {
        if (requested.has(url)) continue;
        requested.add(url);
        const image = new Image();
        image.decoding = 'async';
        image.src = url;
    }
};
