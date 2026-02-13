import linksData from './links.json';
import type { LinkDataV1, GlobalLinkConfig, MapLink, LinkBounds } from './types';

export type { LinkDataV1, MapLink, LinkTarget, LinkBounds, LinkId, GlobalLinkConfig } from './types';

const BASE_DATA = linksData as unknown as LinkDataV1;

export const getLinkData = (): LinkDataV1 => BASE_DATA;

export const getGlobalLinkConfig = (): GlobalLinkConfig => BASE_DATA.config;

export const tryParseLinkData = (text: string): LinkDataV1 | null => {
    try {
        const parsed = JSON.parse(text) as unknown;
        return normalizeLinkDataV1(parsed);
    } catch {
        return null;
    }
};

export const mergeLinkData = (base: LinkDataV1, overlay: LinkDataV1): LinkDataV1 => {
    const result: LinkDataV1 = { 
        version: 1, 
        config: overlay.config ?? base.config,
        regions: {} 
    };

    // Collect all region keys
    const allRegions = new Set([...Object.keys(base.regions), ...Object.keys(overlay.regions)]);

    for (const region of allRegions) {
        const baseLinks = base.regions[region]?.links ?? {};
        const overlayLinks = overlay.regions[region]?.links ?? {};
        result.regions[region] = {
            links: { ...baseLinks, ...overlayLinks },
        };
    }

    return result;
};

// Map region key (e.g. "Valley_4") to locale region code (e.g. "VL")
export const mapRegionKeyToLinkCode = (regionKey: string | null | undefined): string | null => {
    if (!regionKey) return null;
    const mapping: Record<string, string> = {
        Valley_4: 'VL',
        Wuling: 'WL',
        Dijiang: 'DJ',
        Weekraid_1: 'ES',
        Jinlong: 'JL',
    };
    return mapping[regionKey] ?? null;
};

// Round bounds to 3 decimal places
export const roundBounds = (bounds: [[number, number], [number, number]]): [[number, number], [number, number]] => {
    const round3 = (n: number) => Math.round(n * 1000) / 1000;
    return [
        [round3(bounds[0][0]), round3(bounds[0][1])],
        [round3(bounds[1][0]), round3(bounds[1][1])],
    ];
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function normalizeTarget(raw: unknown): GlobalLinkConfig['leftLink'] {
    if (!isRecord(raw)) return { titleKey: '', url: '' };
    const titleKeyRaw = raw.titleKey;
    const labelRaw = raw.label;
    const urlRaw = raw.url;

    return {
        titleKey:
            typeof titleKeyRaw === 'string'
                ? titleKeyRaw
                : typeof labelRaw === 'string'
                    ? labelRaw
                    : '',
        url: typeof urlRaw === 'string' ? urlRaw : '',
    };
}

function normalizeGlobalConfig(raw: unknown): GlobalLinkConfig | null {
    if (!isRecord(raw)) return null;
    if (!('leftLink' in raw) || !('rightLink' in raw)) return null;
    return {
        leftLink: normalizeTarget(raw.leftLink),
        rightLink: normalizeTarget(raw.rightLink),
    };
}

function parseBounds(raw: unknown): LinkBounds | null {
    if (!Array.isArray(raw) || raw.length !== 2) return null;
    const arr = raw as unknown[];
    const a0 = arr[0];
    const b0 = arr[1];
    if (!Array.isArray(a0) || !Array.isArray(b0) || a0.length !== 2 || b0.length !== 2) return null;
    const a = a0 as unknown[];
    const b = b0 as unknown[];
    const x1 = a[0];
    const y1 = a[1];
    const x2 = b[0];
    const y2 = b[1];
    if (typeof x1 !== 'number' || typeof y1 !== 'number' || typeof x2 !== 'number' || typeof y2 !== 'number') return null;
    return [
        [x1, y1],
        [x2, y2],
    ];
}

function normalizeLinkDataV1(raw: unknown): LinkDataV1 | null {
    if (!isRecord(raw)) return null;
    const version = raw.version;
    if (version !== 1) return null;
    const regionsRaw = raw.regions;
    if (!isRecord(regionsRaw)) return null;

    // Best-effort migration from legacy per-link left/right config.
    let config: GlobalLinkConfig | null = normalizeGlobalConfig(raw.config);

    if (!config) {
        // Search first link for legacy shape.
        for (const regionValue of Object.values(regionsRaw)) {
            if (!isRecord(regionValue)) continue;
            const linksRaw = regionValue.links;
            if (!isRecord(linksRaw)) continue;
            const firstLink = Object.values(linksRaw)[0];
            if (!isRecord(firstLink)) continue;
            if (!('leftLink' in firstLink) || !('rightLink' in firstLink)) continue;
            config = {
                leftLink: normalizeTarget(firstLink.leftLink),
                rightLink: normalizeTarget(firstLink.rightLink),
            };
            break;
        }
    }

    // If we still don't have a config, create an empty default (tool can fill it later).
    if (!config) {
        config = {
            leftLink: { titleKey: '', url: '' },
            rightLink: { titleKey: '', url: '' },
        };
    }

    // Strip legacy per-link fields if present.
    const regions: LinkDataV1['regions'] = {};
    for (const [regionKey, regionValue] of Object.entries(regionsRaw)) {
        if (!isRecord(regionValue)) {
            regions[regionKey] = { links: {} };
            continue;
        }
        const linksRaw = regionValue.links;
        if (!isRecord(linksRaw)) {
            regions[regionKey] = { links: {} };
            continue;
        }

        const links: Record<string, MapLink> = {};
        for (const [id, linkValue] of Object.entries(linksRaw)) {
            if (!isRecord(linkValue)) continue;
            const bounds = parseBounds(linkValue.bounds);
            if (!bounds) continue;
            const idValue = linkValue.id;
            const regionValue2 = linkValue.region;
            links[id] = {
                id: typeof idValue === 'string' ? idValue : id,
                region: typeof regionValue2 === 'string' ? regionValue2 : regionKey,
                bounds,
            };
        }

        regions[regionKey] = { links };
    }

    return {
        version: 1,
        config,
        regions,
    };
}
