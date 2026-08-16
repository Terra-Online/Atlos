// dynamic font loader - Automatically switch between Simplified and Traditional Chinese font files based on document language

import { getFontAssetUrl } from './fontAssets';
import { getFontRegionForLocale, type FontRegion } from '@/lib/i18n/lang';


// Build CDN URL with base and normalize dev paths to production paths
const toCdnUrl = (p: string): string => {
    const str = String(p);
    if (str.indexOf('://') !== -1 || str.startsWith('//')) return str;

    // eslint-disable-next-line no-undef
    const base = (typeof __ASSETS_HOST !== 'undefined' && __ASSETS_HOST) ? String(__ASSETS_HOST) : '';
    
    if (base && str.startsWith(base)) return str;

    // Dev: keep /src/ prefix; Prod: normalize to /assets/ and prepend CDN
    // Dev: keep /src/ prefix; Prod: normalize to /assets/ and prepend CDN
    if (!base) return p; // Dev mode: return original path as-is
    const normalized = p.replace(/^\/src\/assets/i, '/assets');
    const baseEnds = base.endsWith('/');
    const pathStarts = normalized.startsWith('/');
    if (baseEnds && pathStarts) return base + normalized.slice(1);
    if (!baseEnds && !pathStarts) return `${base}/${normalized}`;
    return base + normalized;
};

type FontWeight = 'Bold' | 'DemiBold' | 'Medium' | 'Regular';

interface FontDefinition {
    family: string;
    weight: FontWeight;
    cnFiles?: {
        woff2?: string;
        woff?: string;
        otf?: string;
        ttf?: string;
    };
    hkFiles?: {
        woff2?: string;
        woff?: string;
        otf?: string;
        ttf?: string;
    };
    jpFiles?: {
        woff2?: string;
        woff?: string;
        otf?: string;
        ttf?: string;
    };
}
// font path configs
const fontDefinitions: FontDefinition[] = [
    {
        family: 'UD_ShinGo Bold',
        weight: 'Bold',
        cnFiles: {
            woff2: getFontAssetUrl('UD_ShinGo/UDShinGo_CN_B.woff2'),
            woff: getFontAssetUrl('UD_ShinGo/UDShinGo_CN_B.woff'),
            otf: getFontAssetUrl('UD_ShinGo/UDShinGo_CN_B.otf'),
        },
        hkFiles: {
            woff2: getFontAssetUrl('UD_ShinGo/UDShinGo_HK_B.woff2'),
            woff: getFontAssetUrl('UD_ShinGo/UDShinGo_HK_B.woff'),
            ttf: getFontAssetUrl('UD_ShinGo/UDShinGo_HK_B.ttf'),
        },
        jpFiles: {
            woff2: getFontAssetUrl('UD_ShinGo/UDShinGo_JP_B.woff2'),
            woff: getFontAssetUrl('UD_ShinGo/UDShinGo_JP_B.woff'),
            otf: getFontAssetUrl('UD_ShinGo/UDShinGo_JP_B.otf'),
        }
    },
    {
        family: 'UD_ShinGo DemiBold',
        weight: 'DemiBold',
        cnFiles: {
            woff2: getFontAssetUrl('UD_ShinGo/UDShinGo_CN_DB.woff2'),
            woff: getFontAssetUrl('UD_ShinGo/UDShinGo_CN_DB.woff'),
            otf: getFontAssetUrl('UD_ShinGo/UDShinGo_CN_DB.otf'),
        },
        hkFiles: {
            woff2: getFontAssetUrl('UD_ShinGo/UDShinGo_HK_DB.woff2'),
            woff: getFontAssetUrl('UD_ShinGo/UDShinGo_HK_DB.woff'),
            ttf: getFontAssetUrl('UD_ShinGo/UDShinGo_HK_DB.ttf'),
        },
        jpFiles: {
            woff2: getFontAssetUrl('UD_ShinGo/UDShinGo_JP_DB.woff2'),
            woff: getFontAssetUrl('UD_ShinGo/UDShinGo_JP_DB.woff'),
            otf: getFontAssetUrl('UD_ShinGo/UDShinGo_JP_DB.otf'),
        }
    },
    {
        family: 'UD_ShinGo Medium',
        weight: 'Medium',
        cnFiles: {
            woff2: getFontAssetUrl('UD_ShinGo/UDShinGo_CN_M.woff2'),
            woff: getFontAssetUrl('UD_ShinGo/UDShinGo_CN_M.woff'),
            otf: getFontAssetUrl('UD_ShinGo/UDShinGo_CN_M.otf'),
        },
        hkFiles: {
            woff2: getFontAssetUrl('UD_ShinGo/UDShinGo_HK_M.woff2'),
            woff: getFontAssetUrl('UD_ShinGo/UDShinGo_HK_M.woff'),
            ttf: getFontAssetUrl('UD_ShinGo/UDShinGo_HK_M.ttf'),
        },
        jpFiles: {
            woff2: getFontAssetUrl('UD_ShinGo/UDShinGo_JP_M.woff2'),
            woff: getFontAssetUrl('UD_ShinGo/UDShinGo_JP_M.woff'),
            otf: getFontAssetUrl('UD_ShinGo/UDShinGo_JP_M.otf'),
        }
    },
    {
        family: 'UD_ShinGo Regular',
        weight: 'Regular',
        cnFiles: {
            woff2: getFontAssetUrl('UD_ShinGo/UDShinGo_CN_R.woff2'),
            woff: getFontAssetUrl('UD_ShinGo/UDShinGo_CN_R.woff'),
            otf: getFontAssetUrl('UD_ShinGo/UDShinGo_CN_R.otf'),
        },
        hkFiles: {
            woff2: getFontAssetUrl('UD_ShinGo/UDShinGo_HK_R.woff2'),
            woff: getFontAssetUrl('UD_ShinGo/UDShinGo_HK_R.woff'),
            ttf: getFontAssetUrl('UD_ShinGo/UDShinGo_HK_R.ttf'),
        },
        jpFiles: {
            woff2: getFontAssetUrl('UD_ShinGo/UDShinGo_JP_R.woff2'),
            woff: getFontAssetUrl('UD_ShinGo/UDShinGo_JP_R.woff'),
            otf: getFontAssetUrl('UD_ShinGo/UDShinGo_JP_R.otf'),
        }
    },
    {
        family: 'HMSans',
        weight: 'Regular',
        cnFiles: {
            woff2: getFontAssetUrl('Harmony/HMSans_SC.woff2'),
            woff: getFontAssetUrl('Harmony/HMSans_SC.woff'),
        },
        hkFiles: {
            woff2: getFontAssetUrl('Harmony/HMSans_TC.woff2'),
            woff: getFontAssetUrl('Harmony/HMSans_TC.woff'),
        }
    },
];

const detectDocumentLanguage = (): FontRegion => {
    const htmlLang = document.documentElement.lang || document.documentElement.getAttribute('lang') || '';
    if (htmlLang) return getFontRegionForLocale(htmlLang);
    return getFontRegionForLocale(navigator.language || '');
};

const loadedFonts = new Set<FontFace>();
const regionFontPromises = new Map<Exclude<FontRegion, null>, Promise<FontFace[]>>();
let activeRegion: FontRegion | undefined;
let loadGeneration = 0;
let languageObserver: MutationObserver | null = null;

async function loadFonts(region: FontRegion): Promise<void> {
    if (activeRegion === region) return;
    const generation = ++loadGeneration;

    if (region === null) {
        loadedFonts.forEach((font) => document.fonts.delete(font));
        loadedFonts.clear();
        activeRegion = null;
        return;
    }

    let regionPromise = regionFontPromises.get(region);
    if (!regionPromise) {
        regionPromise = Promise.all(fontDefinitions.map(async (definition) => {
            const files = region === 'CN'
                ? definition.cnFiles
                : region === 'HK'
                    ? definition.hkFiles
                    : definition.jpFiles;
            const fileRaw = files?.woff2 || files?.woff || files?.ttf || files?.otf;
            if (!fileRaw) return null;

            const isHMSans = definition.family === 'HMSans';
            const font = new FontFace(
                definition.family,
                `url('${toCdnUrl(fileRaw)}')`,
                {
                    weight: isHMSans ? '100 900' : undefined,
                    style: 'normal',
                    display: 'swap',
                },
            );
            await font.load();
            return font;
        })).then((fonts) => fonts.filter((font): font is FontFace => font !== null));
        regionFontPromises.set(region, regionPromise);
        regionPromise.catch(() => regionFontPromises.delete(region));
    }

    const nextFonts = await regionPromise;
    if (generation !== loadGeneration) return;

    loadedFonts.forEach((font) => document.fonts.delete(font));
    loadedFonts.clear();
    nextFonts.forEach((font) => {
        document.fonts.add(font);
        loadedFonts.add(font);
    });
    activeRegion = region;
}

function setupLanguageObserver(): void {
    if (languageObserver) return;
    languageObserver = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.type === 'attributes' && mutation.attributeName === 'lang') {
                const newRegion = detectDocumentLanguage();
                void loadFonts(newRegion);
            }
        });
    });
    languageObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['lang'],
    });
}

export async function fontLoader(): Promise<void> {
    setupLanguageObserver();
    await loadFonts(detectDocumentLanguage());
}

export const switchFontRegion = (region: FontRegion): Promise<void> => loadFonts(region);

export function getCurrentRegion(): FontRegion {
    return detectDocumentLanguage();
}
