import type { LabelId } from './types';
import { useTranslate } from '@/locale';

export type PlaceKind = 'sub' | 'site';

export interface PlaceItem {
    id: LabelId;
    kind: PlaceKind;
    region: string; // locale region code, e.g. VL
    sub: string; // locale sub short, e.g. HB
    site?: string; // locale site key, e.g. originium_passage
    label: string; // localized display name
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

// Build a localized index of all places for the current language.
// The tool UI uses this for the right-side list.
export const usePlaceIndex = (regionCode: string): PlaceItem[] => {
    const t = useTranslate();

    // region bundle is under game.region
    const regionBundle = t<unknown>('game.region');
    if (!isObject(regionBundle)) return [];
    const regionNode = regionBundle[regionCode];
    if (!isObject(regionNode)) return [];

    const subNode = regionNode.sub;
    if (!isObject(subNode)) return [];

    const items: PlaceItem[] = [];

    for (const subKey of Object.keys(subNode)) {
        const sub = subNode[subKey];
        if (!isObject(sub)) continue;
        const short = sub.short;
        const name = sub.name;
        if (typeof short !== 'string' || typeof name !== 'string') continue;

        items.push({
            id: `${regionCode}/${short}`,
            kind: 'sub',
            region: regionCode,
            sub: short,
            label: name,
        });

        const site = sub.site;
        if (!isObject(site)) continue;
        for (const siteKey of Object.keys(site)) {
            const siteName = site[siteKey];
            if (typeof siteName !== 'string') continue;
            items.push({
                id: `${regionCode}/${short}/${siteKey}`,
                kind: 'site',
                region: regionCode,
                sub: short,
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

// Helper: map Map's currentRegionKey (e.g. Valley_4) -> locale region code (e.g. VL)
export const mapRegionKeyToLocaleCode = (mapRegionKey: string | null | undefined): string | null => {
    if (!mapRegionKey) return null;
    // Current known regions:
    // - Valley_4 -> VL
    // - Wuling   -> WL
    // - Dijiang  -> DJ
    if (mapRegionKey === 'Valley_4') return 'VL';
    if (mapRegionKey === 'Wuling') return 'WL';
    if (mapRegionKey === 'Dijiang') return 'DJ';
    return null;
};
