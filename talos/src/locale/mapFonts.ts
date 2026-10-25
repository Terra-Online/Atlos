import { MARKER_TYPE_DICT, REGION_TYPE_COUNT_MAP } from '@/data/marker';
import { BINDER_GROUPS_BY_SUB } from '@/data/marker/binder';
import { REGION_DICT, SUBREGION_DICT } from '@/data/map';
import type { AnyLabel } from '@/data/map/label/types';
import { mapRegionKeyToLocaleCode } from '@/data/map/label/placeIndex';
import { useLabelStore, selectLabelMapForRegion } from '@/store/label';
import type { TextRun } from './fontShards';

type Translate = <T = string>(key: string) => T;
export type RegionStructure = { kind: 'nested' | 'flat' };
const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null;

export function detectRegionStructure(
    t: Translate,
    code: string,
): RegionStructure {
    const sub = t<unknown>(`game.region.${code}.sub`);
    return {
        kind:
            isObject(sub) && isObject(sub.site) && typeof sub.name === 'string'
                ? 'flat'
                : 'nested',
    };
}

export function resolveLabelText(
    t: Translate,
    code: string,
    structure: RegionStructure,
    label: AnyLabel,
): string {
    if (structure.kind === 'flat') {
        return label.type === 'sub'
            ? t<string>(`game.region.${code}.sub.name`) || code
            : t<string>(`game.region.${code}.sub.site.${label.site}`) ||
                  label.site;
    }
    return label.type === 'sub'
        ? t<string>(`game.region.${code}.sub.${label.sub}.name`) || label.sub
        : t<string>(
              `game.region.${code}.sub.${label.sub}.site.${label.site}`,
          ) || label.site;
}

/** Both zoom label sets are small and remain ready throughout a gesture. */
export function labelFontRuns(
    labels: AnyLabel[],
    t: Translate,
    code: string,
    structure: RegionStructure,
): TextRun[] {
    return [
        {
            faces: ['db'],
            text: labels
                .filter((label) => label.type === 'sub')
                .map((label) => resolveLabelText(t, code, structure, label))
                .join(''),
            localized: 'game',
        },
        {
            faces: ['h', 'r'],
            text: labels
                .filter((label) => label.type === 'site')
                .map((label) => resolveLabelText(t, code, structure, label))
                .join(''),
            localized: 'game',
        },
    ];
}

/** Region intent needs its selector names and labels, never the world catalog. */
export function mapFontRuns(regionKey: string, t: Translate): TextRun[] {
    // Navigation can open before a destination is selected. Its short labels
    // and tooltips are a small shell demand, unlike the destination's catalog.
    const navigation = Object.entries(REGION_DICT).flatMap(([key, region]) => {
        const code = mapRegionKeyToLocaleCode(key);
        if (!code) return [];
        return [t<string>(`game.region.${code}.main`), ...region.subregions.flatMap(subregion => {
            const sub = SUBREGION_DICT[subregion]?.name;
            return region.subregions.length > 1 && sub ? [
                t<string>(`game.region.${code}.sub.${sub}.short`),
                t<string>(`game.region.${code}.sub.${sub}.name`),
            ] : [];
        })].filter(value => typeof value === 'string').join('');
    }).join('');
    const counts = REGION_TYPE_COUNT_MAP[regionKey] || {};
    const names = Object.keys(counts)
        .filter((key) => counts[key] > 0)
        .map((key) => t<string>(`game.markerType.key.${key}`) || '');
    const binders = Object.values(BINDER_GROUPS_BY_SUB)
        .flatMap((data) => data.groups)
        .filter((group) => group.types.some((type) => counts[type.key] > 0))
        .map(
            (group) =>
                t<string>(
                    `game.${group.titleKeyPrefix ?? 'markerType.drop'}.${group.dropKey}`,
                ) || group.dropName,
        );
    const categories = [
        ...new Set(
            Object.keys(counts)
                .map((key) => MARKER_TYPE_DICT[key]?.category.sub)
                .filter(Boolean),
        ),
    ].map(
        (category) => t<string>(`game.markerType.category.${category}`) || '',
    );
    const code = mapRegionKeyToLocaleCode(regionKey);
    const labels = code
        ? Object.values(
              selectLabelMapForRegion(code)(useLabelStore.getState()) || {},
          )
        : [];
    return [
        { faces: ['db', 'r'], text: navigation, localized: 'game' },
        {
            faces: ['db', 'm'],
            text: [...names, ...binders].join(''),
            localized: 'game',
        },
        { faces: ['m'], text: categories.join(''), localized: 'game' },
        ...(code
            ? labelFontRuns(labels, t, code, detectRegionStructure(t, code))
            : []),
    ];
}
