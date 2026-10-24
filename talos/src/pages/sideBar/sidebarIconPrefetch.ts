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
export const preloadSidebarIcons = (): (() => void) | undefined => {
    if (typeof Image === 'undefined') return;
    const urls = getIconUrls().filter(url => !requested.has(url));
    let index = 0;
    let timer = 0;
    const batch = () => {
        for (const end = Math.min(index + 8, urls.length); index < end; index++) {
            const url = urls[index];
            if (requested.has(url)) continue;
            requested.add(url);
            const image = new Image();
            image.decoding = 'async';
            image.src = url;
        }
        if (index < urls.length) timer = window.setTimeout(batch, 32);
    };
    timer = window.setTimeout(batch, 0);
    return () => window.clearTimeout(timer);
};
