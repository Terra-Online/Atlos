// dynamic font loader - Automatically switch between Simplified and Traditional Chinese font files based on document language

import { preloadFonts, getFontUrlsForRegion } from './fontCache';

// Normalize a font path and prefix with CDN base defined by __ASSETS_HOST
const toCdnUrl = (p: string): string => {
    // 1) normalize repo-time paths to built assets paths
    const normalized = p
        .replace(/^\/src\/assets\/fonts/i, '/assets/fonts')
        .replace(/^\/src\/asset\/fonts/i, '/assets/fonts');
    // 2) prefix with ASSETS_HOST when present (vite define)
    // eslint-disable-next-line no-undef
    const base = (__ASSETS_HOST as unknown as string) || '';
    if (!base) return normalized;
    const be = base.endsWith('/');
    const ps = normalized.startsWith('/');
    if (be && ps) return base + normalized.slice(1);
    if (!be && !ps) return `${base}/${normalized}`;
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
            woff2: '/src/assets/fonts/UD_ShinGo/UDShinGo_CN_B.woff2',
            woff: '/src/assets/fonts/UD_ShinGo/UDShinGo_CN_B.woff',
            otf: '/src/assets/fonts/UD_ShinGo/UDShinGo_CN_B.otf',
        },
        hkFiles: {
            woff2: '/src/assets/fonts/UD_ShinGo/UDShinGo_HK_B.woff2',
            woff: '/src/assets/fonts/UD_ShinGo/UDShinGo_HK_B.woff',
            ttf: '/src/assets/fonts/UD_ShinGo/UDShinGo_HK_B.ttf',
        },
        jpFiles: {
            woff2: '/src/assets/fonts/UD_ShinGo/UDShinGo_JP_B.woff2',
            woff: '/src/assets/fonts/UD_ShinGo/UDShinGo_JP_B.woff',
            otf: '/src/assets/fonts/UD_ShinGo/UDShinGo_JP_B.otf',
        }
    },
    {
        family: 'UD_ShinGo DemiBold',
        weight: 'DemiBold',
        cnFiles: {
            woff2: '/src/assets/fonts/UD_ShinGo/UDShinGo_CN_DB.woff2',
            woff: '/src/assets/fonts/UD_ShinGo/UDShinGo_CN_DB.woff',
            otf: '/src/assets/fonts/UD_ShinGo/UDShinGo_CN_DB.otf',
        },
        hkFiles: {
            woff2: '/src/assets/fonts/UD_ShinGo/UDShinGo_HK_DB.woff2',
            woff: '/src/assets/fonts/UD_ShinGo/UDShinGo_HK_DB.woff',
            ttf: '/src/assets/fonts/UD_ShinGo/UDShinGo_HK_DB.ttf',
        },
        jpFiles: {
            woff2: '/src/assets/fonts/UD_ShinGo/UDShinGo_JP_DB.woff2',
            woff: '/src/assets/fonts/UD_ShinGo/UDShinGo_JP_DB.woff',
            otf: '/src/assets/fonts/UD_ShinGo/UDShinGo_JP_DB.otf',
        }
    },
    {
        family: 'UD_ShinGo Medium',
        weight: 'Medium',
        cnFiles: {
            woff2: '/src/assets/fonts/UD_ShinGo/UDShinGo_CN_M.woff2',
            woff: '/src/assets/fonts/UD_ShinGo/UDShinGo_CN_M.woff',
            otf: '/src/assets/fonts/UD_ShinGo/UDShinGo_CN_M.otf',
        },
        hkFiles: {
            woff2: '/src/assets/fonts/UD_ShinGo/UDShinGo_HK_M.woff2',
            woff: '/src/assets/fonts/UD_ShinGo/UDShinGo_HK_M.woff',
            ttf: '/src/assets/fonts/UD_ShinGo/UDShinGo_HK_M.ttf',
        },
        jpFiles: {
            woff2: '/src/assets/fonts/UD_ShinGo/UDShinGo_JP_M.woff2',
            woff: '/src/assets/fonts/UD_ShinGo/UDShinGo_JP_M.woff',
            otf: '/src/assets/fonts/UD_ShinGo/UDShinGo_JP_M.otf',
        }
    },
    {
        family: 'UD_ShinGo Regular',
        weight: 'Regular',
        cnFiles: {
            woff2: '/src/assets/fonts/UD_ShinGo/UDShinGo_CN_R.woff2',
            woff: '/src/assets/fonts/UD_ShinGo/UDShinGo_CN_R.woff',
            otf: '/src/assets/fonts/UD_ShinGo/UDShinGo_CN_R.otf',
        },
        hkFiles: {
            woff2: '/src/assets/fonts/UD_ShinGo/UDShinGo_HK_R.woff2',
            woff: '/src/assets/fonts/UD_ShinGo/UDShinGo_HK_R.woff',
            ttf: '/src/assets/fonts/UD_ShinGo/UDShinGo_HK_R.ttf',
        },
        jpFiles: {
            woff2: '/src/assets/fonts/UD_ShinGo/UDShinGo_JP_R.woff2',
            woff: '/src/assets/fonts/UD_ShinGo/UDShinGo_JP_R.woff',
            otf: '/src/assets/fonts/UD_ShinGo/UDShinGo_JP_R.otf',
        }
    },
    {
        family: 'HMSans_SC', // 简体中文版本
        weight: 'Regular',
        cnFiles: {
            woff2: '/src/assets/fonts/Harmony/HMSans_SC.woff2',
            woff: '/src/assets/fonts/Harmony/HMSans_SC.woff',
        },
        hkFiles: {
            woff2: '/src/assets/fonts/Harmony/HMSans_TC.woff2',
            woff: '/src/assets/fonts/Harmony/HMSans_TC.woff',
        }
    },
    {
        family: 'HMSans_TC', // 繁体中文版本
        weight: 'Regular',
        cnFiles: {
            woff2: '/src/assets/fonts/Harmony/HMSans_SC.woff2',
            woff: '/src/assets/fonts/Harmony/HMSans_SC.woff',
        },
        hkFiles: {
            woff2: '/src/assets/fonts/Harmony/HMSans_TC.woff2',
            woff: '/src/assets/fonts/Harmony/HMSans_TC.woff',
        }
    }
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

// generate CSS @font-face rules
function generateFontFaceCSS(definition: FontDefinition, region: Region): string {
    const files = region === 'CN' ? definition.cnFiles : 
                  region === 'HK' ? definition.hkFiles : 
                  definition.jpFiles;
    
    if (!files) return '';
    
    const sources: string[] = [];
    
    if (files.woff2) {
        sources.push(`url('${toCdnUrl(files.woff2)}') format('woff2')`);
    }
    if (files.woff) {
        sources.push(`url('${toCdnUrl(files.woff)}') format('woff')`);
    }
    if (files.ttf) {
        sources.push(`url('${toCdnUrl(files.ttf)}') format('truetype')`);
    }
    if (files.otf) {
        sources.push(`url('${toCdnUrl(files.otf)}') format('opentype')`);
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
function injectFontStyles(region: Region): void {
    // Preload fonts for this region in the background
    const fontUrls = getFontUrlsForRegion(region).map(toCdnUrl);
    preloadFonts(fontUrls).catch(err => console.error('Font preload failed:', err));
    
    // remove current font styles if exist
    const existingStyle = document.getElementById('dynamic-font-loader');
    if (existingStyle) {
        existingStyle.remove();
    }
    
    // generate new @fontface
    const cssRules = fontDefinitions
        .map(definition => generateFontFaceCSS(definition, region))
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
                injectFontStyles(newRegion);
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
    injectFontStyles(region);
    
    // set up observer for future changes
    setupLanguageObserver();
    
    console.log(`Font loader initialized for region: ${region}`);
}

/* EXTERNAL API */

// for manual region switch (external call)
export function switchFontRegion(region: Region): void {
    injectFontStyles(region);
    console.log(`Font switched to region: ${region}`);
}

// get current region (external call)
export function getCurrentRegion(): Region {
    return detectDocumentLanguage();
}
