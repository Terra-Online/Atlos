import { useTranslate } from '@/locale';

export type PlaceKind = 'sub' | 'site';

export interface PlaceItem {
    // LabelId is just a stable string (e.g. "VL/HB" or "VL/OL/originium_passage").
    // Keep this devtool decoupled from the data-layer schema.
    id: string;
    kind: PlaceKind;
    region: string; // locale region code, e.g. VL
    sub: string; // stable sub key, e.g. HB / PL / WL / JY
    site?: string; // locale site key, e.g. originium_passage
    label: string; // localized display name
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

// Build a localized index of all places for the current language.
// The label tool UI uses this for the right-side list.
export const usePlaceIndex = (regionCode: string): PlaceItem[] => {
    const t = useTranslate();

    // region bundle is under game.region
    const regionBundle = t<unknown>('game.region');
    if (!isObject(regionBundle)) return [];
    const regionNode = regionBundle[regionCode];
    if (!isObject(regionNode)) return [];

    const subNode = regionNode.sub;
    if (!isObject(subNode)) return [];

    // Flat region (e.g. DJ): sub = { name: string, site: { ... } }
    if (typeof subNode.name === 'string' && isObject(subNode.site)) {
        const items: PlaceItem[] = [];
        for (const siteKey of Object.keys(subNode.site)) {
            const siteName = subNode.site[siteKey];
            if (typeof siteName !== 'string') continue;
            items.push({
                id: `${regionCode}/__root__/${siteKey}`,
                kind: 'site',
                region: regionCode,
                sub: '__root__',
                site: siteKey,
                label: siteName,
            });
        }
        items.sort((a, b) => a.label.localeCompare(b.label));
        return items;
    }

    const items: PlaceItem[] = [];

    for (const subKey of Object.keys(subNode)) {
        const sub = subNode[subKey];
        if (!isObject(sub)) continue;
        const name = sub.name;
        if (typeof name !== 'string') continue;

        items.push({
            id: `${regionCode}/${subKey}`,
            kind: 'sub',
            region: regionCode,
            sub: subKey,
            label: name,
        });

        const site = sub.site;
        if (!isObject(site)) continue;
        for (const siteKey of Object.keys(site)) {
            const siteName = site[siteKey];
            if (typeof siteName !== 'string') continue;
            items.push({
                id: `${regionCode}/${subKey}/${siteKey}`,
                kind: 'site',
                region: regionCode,
                sub: subKey,
                site: siteKey,
                label: siteName,
            });
        }
    }

    // Keep stable ordering: sub first, then sites; then by label.
    items.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'sub' ? -1 : 1;
        return a.label.localeCompare(b.label);
    });

    return items;
};