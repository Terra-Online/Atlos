// dynamic font loader - Automatically switch between Simplified and Traditional Chinese font files based on document language

type FontWeight = 'Bold' | 'DemiBold' | 'Medium' | 'Regular';
type Region = 'CN' | 'HK';

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
}

// font path configs
const fontDefinitions: FontDefinition[] = [
    {
        family: 'UD_ShinGo Bold',
        weight: 'Bold',
        cnFiles: {
            woff2: '/src/asset/fonts/UD_ShinGo/UDShinGo_CN_B.woff2',
            woff: '/src/asset/fonts/UD_ShinGo/UDShinGo_CN_B.woff',
            otf: '/src/asset/fonts/UD_ShinGo/UDShinGo_CN_B.otf',
        },
        hkFiles: {
            woff2: '/src/asset/fonts/UD_ShinGo/UDShinGo_HK_B.woff2',
            woff: '/src/asset/fonts/UD_ShinGo/UDShinGo_HK_B.woff',
            ttf: '/src/asset/fonts/UD_ShinGo/UDShinGo_HK_B.ttf',
        }
    },
    {
        family: 'UD_ShinGo DemiBold',
        weight: 'DemiBold',
        // 简中没有 DemiBold，用 Bold 替代
        cnFiles: {
            woff2: '/src/asset/fonts/UD_ShinGo/UDShinGo_CN_B.woff2',
            woff: '/src/asset/fonts/UD_ShinGo/UDShinGo_CN_B.woff',
            otf: '/src/asset/fonts/UD_ShinGo/UDShinGo_CN_B.otf',
        },
        hkFiles: {
            woff2: '/src/asset/fonts/UD_ShinGo/UDShinGo_HK_DB.woff2',
            woff: '/src/asset/fonts/UD_ShinGo/UDShinGo_HK_DB.woff',
            ttf: '/src/asset/fonts/UD_ShinGo/UDShinGo_HK_DB.ttf',
        }
    },
    {
        family: 'UD_ShinGo Medium',
        weight: 'Medium',
        cnFiles: {
            woff2: '/src/asset/fonts/UD_ShinGo/UDShinGo_CN_M.woff2',
            woff: '/src/asset/fonts/UD_ShinGo/UDShinGo_CN_M.woff',
            otf: '/src/asset/fonts/UD_ShinGo/UDShinGo_CN_M.otf',
        },
        hkFiles: {
            woff2: '/src/asset/fonts/UD_ShinGo/UDShinGo_HK_M.woff2',
            woff: '/src/asset/fonts/UD_ShinGo/UDShinGo_HK_M.woff',
            ttf: '/src/asset/fonts/UD_ShinGo/UDShinGo_HK_M.ttf',
        }
    },
    {
        family: 'UD_ShinGo',
        weight: 'Regular',
        cnFiles: {
            woff2: '/src/asset/fonts/UD_ShinGo/UDShinGo_CN_R.woff2',
            woff: '/src/asset/fonts/UD_ShinGo/UDShinGo_CN_R.woff',
            otf: '/src/asset/fonts/UD_ShinGo/UDShinGo_CN_R.otf',
        },
        hkFiles: {
            woff2: '/src/asset/fonts/UD_ShinGo/UDShinGo_HK_R.woff2',
            woff: '/src/asset/fonts/UD_ShinGo/UDShinGo_HK_R.woff',
            ttf: '/src/asset/fonts/UD_ShinGo/UDShinGo_HK_R.ttf',
        }
    },
    {
        family: 'HMSans_SC', // 简体中文版本
        weight: 'Regular',
        cnFiles: {
            woff2: '/src/asset/fonts/Harmony/HMSans_SC.woff2',
            woff: '/src/asset/fonts/Harmony/HMSans_SC.woff',
        },
        hkFiles: {
            woff2: '/src/asset/fonts/Harmony/HMSans_TC.woff2',
            woff: '/src/asset/fonts/Harmony/HMSans_TC.woff',
        }
    },
    {
        family: 'HMSans_TC', // 繁体中文版本
        weight: 'Regular',
        cnFiles: {
            woff2: '/src/asset/fonts/Harmony/HMSans_SC.woff2',
            woff: '/src/asset/fonts/Harmony/HMSans_SC.woff',
        },
        hkFiles: {
            woff2: '/src/asset/fonts/Harmony/HMSans_TC.woff2',
            woff: '/src/asset/fonts/Harmony/HMSans_TC.woff',
        }
    }
];

// detect document language
function detectDocumentLanguage(): Region {
    const htmlLang = (document.documentElement.lang || document.documentElement.getAttribute('lang') || '').toLowerCase();
    const navigatorLang = (navigator.language || (navigator as any).userLanguage || '').toLowerCase();
    
    // check HTML lang attribute first
    if (htmlLang) {
        if (htmlLang.includes('zh-cn') || htmlLang.includes('zh-hans')) {
            return 'CN';
        }
        if (htmlLang.includes('zh-tw') || htmlLang.includes('zh-hk') || htmlLang.includes('zh-hant')) {
            return 'HK';
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
    }
    
    // default to HK
    return 'HK';
}

// generate CSS @font-face rules
function generateFontFaceCSS(definition: FontDefinition, region: Region): string {
    const files = region === 'CN' ? definition.cnFiles : definition.hkFiles;
    
    if (!files) return '';
    
    const sources: string[] = [];
    
    if (files.woff2) {
        sources.push(`url('${files.woff2}') format('woff2')`);
    }
    if (files.woff) {
        sources.push(`url('${files.woff}') format('woff')`);
    }
    if (files.ttf) {
        sources.push(`url('${files.ttf}') format('truetype')`);
    }
    if (files.otf) {
        sources.push(`url('${files.otf}') format('opentype')`);
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
    
    console.log(`Generated CSS for region ${region}:`, cssRules);
    
    if (cssRules) {
        const styleElement = document.createElement('style');
        styleElement.id = 'dynamic-font-loader';
        styleElement.textContent = cssRules;
        document.head.appendChild(styleElement);
        console.log('Font styles injected into <head>, element ID: dynamic-font-loader');
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
