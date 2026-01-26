// dynamic font loader - Automatically switch between Simplified and Traditional Chinese font files based on document language

import { getCachedFontBuffer } from './fontCache';

import { getFontAssetUrl } from './fontAssets';


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
type Region = 'CN' | 'HK' | 'JP';

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

// detect document language
function detectDocumentLanguage(): Region {
    const htmlLang = (document.documentElement.lang || document.documentElement.getAttribute('lang') || '').toLowerCase();
    const navigatorLang = String(navigator.language || '').toLowerCase();
    
    // check HTML lang attribute first
    if (htmlLang) {
        if (htmlLang.includes('zh-cn') || htmlLang.includes('zh-hans')) {
            return 'CN';
        }
        if (htmlLang.includes('zh-tw') || htmlLang.includes('zh-hk') || htmlLang.includes('zh-hant')) {
            return 'HK';
        }
        if (htmlLang.includes('ja') || htmlLang.includes('jp')) {
            return 'JP';
        }
    }
    
    // then check browser language
    if (navigatorLang) {
        if (navigatorLang.includes('zh-cn') || navigatorLang.includes('zh-hans')) {
            return 'CN';
        }
        if (navigatorLang.includes('zh-tw') || navigatorLang.includes('zh-hk') || navigatorLang.includes('zh-hant')) {
            return 'HK';
        }
        if (navigatorLang.includes('ja') || navigatorLang.includes('jp')) {
            return 'JP';
        }
    }
    
    // default to HK
    return 'HK';
}

// Keep track of loaded fonts to remove them when switching
const loadedFonts = new Set<FontFace>();

async function loadFonts(region: Region): Promise<void> {
    // Clean up previously loaded fonts
    loadedFonts.forEach(font => {
        document.fonts.delete(font);
    });
    loadedFonts.clear();

    const loadPromises = fontDefinitions.map(async (definition) => {
        const files = region === 'CN' ? definition.cnFiles : 
                      region === 'HK' ? definition.hkFiles : 
                      definition.jpFiles;
        
        if (!files) return;

        // Priority: woff2 > woff > ttf > otf
        const fileRaw = files.woff2 || files.woff || files.ttf || files.otf;
        if (!fileRaw) return;

        const url = toCdnUrl(fileRaw);
        
        // Try to get buffer from Cache Storage first
        const buffer = await getCachedFontBuffer(url);
        
        // Use buffer if available (Cache Storage), otherwise fallback to URL (HTTP Cache)
        const source = buffer ?? `url('${url}')`;
        
        // Special handling for HMSans
        const isHMSans = definition.family.startsWith('HMSans');
        const descriptors: FontFaceDescriptors = {
            weight: isHMSans ? '100 900' : undefined, // Variable font
            style: 'normal',
            display: 'swap'
        };

        try {
            const font = new FontFace(definition.family, source, descriptors);
            // Add to document first allowing browser to match
            document.fonts.add(font);
            loadedFonts.add(font);
            
            // Trigger load to ensure it's valid
            await font.load();
        } catch (err) {
            console.warn(`Failed to load font ${definition.family}:`, err);
        }
    });

    await Promise.all(loadPromises);
}

// language change observer
function setupLanguageObserver(): void {
    // listen for changes to the HTML lang attribute
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.type === 'attributes' && mutation.attributeName === 'lang') {
                const newRegion = detectDocumentLanguage();
                void loadFonts(newRegion);
            }
        });
    });
    
    observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ['lang']
    });
}

// main initialization function
export function fontLoader(): void {
    // detect current language and inject corresponding fonts
    const region = detectDocumentLanguage();
    void loadFonts(region);
    
    // set up observer for future changes
    setupLanguageObserver();
    
    //console.log(`Font loader initialized for region: ${region}`);
}

/* EXTERNAL API */

// for manual region switch (external call)
export function switchFontRegion(region: Region): void {
    void loadFonts(region);
    console.log(`Font switched to region: ${region}`);
}

// get current region (external call)
export function getCurrentRegion(): Region {
    return detectDocumentLanguage();
}