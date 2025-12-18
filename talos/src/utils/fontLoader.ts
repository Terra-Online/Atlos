// dynamic font loader - Automatically switch between Simplified and Traditional Chinese font files based on document language

import { cacheFontFile, getCachedFontBlob } from './fontCache';

import { getFontAssetUrl } from './fontAssets';


// Build CDN URL with base and normalize dev paths to production paths
const toCdnUrl = (p: string): string => {
    // eslint-disable-next-line no-undef
    const base = (typeof __ASSETS_HOST !== 'undefined' && __ASSETS_HOST) ? String(__ASSETS_HOST) : '';
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

// Keep track of active Blob URLs to revoke them when switching
let activeBlobUrls: string[] = [];
let lastInjectId = 0;

// generate CSS @font-face rules
async function generateFontFaceCSS(definition: FontDefinition, region: Region): Promise<string> {
    const files = region === 'CN' ? definition.cnFiles : 
                  region === 'HK' ? definition.hkFiles : 
                  definition.jpFiles;
    
    if (!files) return '';
    
    const sources: string[] = [];

    const safeGetCachedFontBlob = (url: string): Promise<Blob | null> => {
        return (getCachedFontBlob as unknown as (u: string) => Promise<Blob | null>)(url);
    };
    const safeCacheFontFile = (url: string): Promise<void> => {
        return (cacheFontFile as unknown as (u: string) => Promise<void>)(url);
    };
    
    // Helper to process a font file
    const processFile = async (filePath: string | undefined, format: string) => {
        if (!filePath) return;
        const url = toCdnUrl(filePath);
        
        // Try to get from cache first
        const blob = await safeGetCachedFontBlob(url);
        let finalUrl = url;
        
        if (blob) {
            finalUrl = URL.createObjectURL(blob);
            activeBlobUrls.push(finalUrl);
        } else {
            // Not in cache, trigger background cache
            void safeCacheFontFile(url).catch((err: unknown) => console.error('Font background cache failed:', err));
        }
        
        sources.push(`url('${finalUrl}') format('${format}')`);
    };

    // Priority: woff2 > woff > ttf > otf
    if (files.woff2) {
        await processFile(files.woff2, 'woff2');
    } else {
        await processFile(files.woff, 'woff');
        await processFile(files.ttf, 'truetype');
        await processFile(files.otf, 'opentype');
    }
    
    if (sources.length === 0) return '';
    
    // Special handling for HMSans to include variable font properties
    const isHMSans = definition.family.startsWith('HMSans');
    const fontWeightProperty = isHMSans ? '\n    font-weight: 100 900;\n    font-style: normal;' : '';
    
    return `
        @font-face {
            font-family: '${definition.family}';
            src: ${sources.join(',\n        ')};${fontWeightProperty}
            font-display: swap;
        }`;
    }

// inject or update font styles in document head
async function injectFontStyles(region: Region): Promise<void> {
    const currentId = ++lastInjectId;

    // Revoke previous Blob URLs to prevent memory leaks
    activeBlobUrls.forEach(url => URL.revokeObjectURL(url));
    activeBlobUrls = [];

    // remove current font styles if exist
    const existingStyle = document.getElementById('dynamic-font-loader');
    if (existingStyle) {
        existingStyle.remove();
    }
    
    // generate new @fontface
    const cssRulesArray = await Promise.all(
        fontDefinitions.map(definition => generateFontFaceCSS(definition, region))
    );

    // If a newer injection has started, abort this one
    if (currentId !== lastInjectId) return;
    
    const cssRules = cssRulesArray
        .filter(rule => rule.length > 0)
        .join('\n');
    
    //console.log(`Generated CSS for region ${region}:`, cssRules);
    
    if (cssRules) {
        const styleElement = document.createElement('style');
        styleElement.id = 'dynamic-font-loader';
        styleElement.textContent = cssRules;
        document.head.appendChild(styleElement);
        //console.log('Font styles injected into <head>, element ID: dynamic-font-loader');
    } else {
        console.warn('No CSS rules generated for region:', region);
    }
}

// language change observer
function setupLanguageObserver(): void {
    // listen for changes to the HTML lang attribute
    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            if (mutation.type === 'attributes' && mutation.attributeName === 'lang') {
                const newRegion = detectDocumentLanguage();
                void injectFontStyles(newRegion);
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
    void injectFontStyles(region);
    
    // set up observer for future changes
    setupLanguageObserver();
    
    console.log(`Font loader initialized for region: ${region}`);
}

/* EXTERNAL API */

// for manual region switch (external call)
export function switchFontRegion(region: Region): void {
    void injectFontStyles(region);
    console.log(`Font switched to region: ${region}`);
}

// get current region (external call)
export function getCurrentRegion(): Region {
    return detectDocumentLanguage();
}