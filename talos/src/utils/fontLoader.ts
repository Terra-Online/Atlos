// dynamic font loader - Automatically switch between Simplified and Traditional Chinese font files based on document language

import { cacheFontFile, getCachedFontBlob } from './fontCache';

// Import font assets so Vite can hash and emit them
import UDShinGo_CN_B_woff2 from '@/assets/fonts/UD_ShinGo/UDShinGo_CN_B.woff2';
import UDShinGo_CN_B_woff from '@/assets/fonts/UD_ShinGo/UDShinGo_CN_B.woff';
import UDShinGo_CN_B_otf from '@/assets/fonts/UD_ShinGo/UDShinGo_CN_B.otf';

import UDShinGo_HK_B_woff2 from '@/assets/fonts/UD_ShinGo/UDShinGo_HK_B.woff2';
import UDShinGo_HK_B_woff from '@/assets/fonts/UD_ShinGo/UDShinGo_HK_B.woff';
import UDShinGo_HK_B_ttf from '@/assets/fonts/UD_ShinGo/UDShinGo_HK_B.ttf';

import UDShinGo_JP_B_woff2 from '@/assets/fonts/UD_ShinGo/UDShinGo_JP_B.woff2';
import UDShinGo_JP_B_woff from '@/assets/fonts/UD_ShinGo/UDShinGo_JP_B.woff';
import UDShinGo_JP_B_otf from '@/assets/fonts/UD_ShinGo/UDShinGo_JP_B.otf';

import UDShinGo_CN_DB_woff2 from '@/assets/fonts/UD_ShinGo/UDShinGo_CN_DB.woff2';
import UDShinGo_CN_DB_woff from '@/assets/fonts/UD_ShinGo/UDShinGo_CN_DB.woff';
import UDShinGo_CN_DB_otf from '@/assets/fonts/UD_ShinGo/UDShinGo_CN_DB.otf';

import UDShinGo_HK_DB_woff2 from '@/assets/fonts/UD_ShinGo/UDShinGo_HK_DB.woff2';
import UDShinGo_HK_DB_woff from '@/assets/fonts/UD_ShinGo/UDShinGo_HK_DB.woff';
import UDShinGo_HK_DB_ttf from '@/assets/fonts/UD_ShinGo/UDShinGo_HK_DB.ttf';

import UDShinGo_JP_DB_woff2 from '@/assets/fonts/UD_ShinGo/UDShinGo_JP_DB.woff2';
import UDShinGo_JP_DB_woff from '@/assets/fonts/UD_ShinGo/UDShinGo_JP_DB.woff';
import UDShinGo_JP_DB_otf from '@/assets/fonts/UD_ShinGo/UDShinGo_JP_DB.otf';

import UDShinGo_CN_M_woff2 from '@/assets/fonts/UD_ShinGo/UDShinGo_CN_M.woff2';
import UDShinGo_CN_M_woff from '@/assets/fonts/UD_ShinGo/UDShinGo_CN_M.woff';
import UDShinGo_CN_M_otf from '@/assets/fonts/UD_ShinGo/UDShinGo_CN_M.otf';

import UDShinGo_HK_M_woff2 from '@/assets/fonts/UD_ShinGo/UDShinGo_HK_M.woff2';
import UDShinGo_HK_M_woff from '@/assets/fonts/UD_ShinGo/UDShinGo_HK_M.woff';
import UDShinGo_HK_M_ttf from '@/assets/fonts/UD_ShinGo/UDShinGo_HK_M.ttf';

import UDShinGo_JP_M_woff2 from '@/assets/fonts/UD_ShinGo/UDShinGo_JP_M.woff2';
import UDShinGo_JP_M_woff from '@/assets/fonts/UD_ShinGo/UDShinGo_JP_M.woff';
import UDShinGo_JP_M_otf from '@/assets/fonts/UD_ShinGo/UDShinGo_JP_M.otf';

import UDShinGo_CN_R_woff2 from '@/assets/fonts/UD_ShinGo/UDShinGo_CN_R.woff2';
import UDShinGo_CN_R_woff from '@/assets/fonts/UD_ShinGo/UDShinGo_CN_R.woff';
import UDShinGo_CN_R_otf from '@/assets/fonts/UD_ShinGo/UDShinGo_CN_R.otf';

import UDShinGo_HK_R_woff2 from '@/assets/fonts/UD_ShinGo/UDShinGo_HK_R.woff2';
import UDShinGo_HK_R_woff from '@/assets/fonts/UD_ShinGo/UDShinGo_HK_R.woff';
import UDShinGo_HK_R_ttf from '@/assets/fonts/UD_ShinGo/UDShinGo_HK_R.ttf';

import UDShinGo_JP_R_woff2 from '@/assets/fonts/UD_ShinGo/UDShinGo_JP_R.woff2';
import UDShinGo_JP_R_woff from '@/assets/fonts/UD_ShinGo/UDShinGo_JP_R.woff';
import UDShinGo_JP_R_otf from '@/assets/fonts/UD_ShinGo/UDShinGo_JP_R.otf';

import HMSans_SC_woff2 from '@/assets/fonts/Harmony/HMSans_SC.woff2';
import HMSans_SC_woff from '@/assets/fonts/Harmony/HMSans_SC.woff';
import HMSans_TC_woff2 from '@/assets/fonts/Harmony/HMSans_TC.woff2';
import HMSans_TC_woff from '@/assets/fonts/Harmony/HMSans_TC.woff';

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

// 在某些环境下（例如 CI）可以通过环境变量短接字体加载，避免构建依赖真实字体文件
// eslint-disable-next-line no-undef
const DISABLE_DYNAMIC_FONTS = typeof process !== 'undefined' && process.env && process.env.TALOS_DISABLE_DYNAMIC_FONTS === '1';

// font path configs
const fontDefinitions: FontDefinition[] = [
    {
        family: 'UD_ShinGo Bold',
        weight: 'Bold',
        cnFiles: {
            woff2: UDShinGo_CN_B_woff2,
            woff: UDShinGo_CN_B_woff,
            otf: UDShinGo_CN_B_otf,
        },
        hkFiles: {
            woff2: UDShinGo_HK_B_woff2,
            woff: UDShinGo_HK_B_woff,
            ttf: UDShinGo_HK_B_ttf,
        },
        jpFiles: {
            woff2: UDShinGo_JP_B_woff2,
            woff: UDShinGo_JP_B_woff,
            otf: UDShinGo_JP_B_otf,
        }
    },
    {
        family: 'UD_ShinGo DemiBold',
        weight: 'DemiBold',
        cnFiles: {
            woff2: UDShinGo_CN_DB_woff2,
            woff: UDShinGo_CN_DB_woff,
            otf: UDShinGo_CN_DB_otf,
        },
        hkFiles: {
            woff2: UDShinGo_HK_DB_woff2,
            woff: UDShinGo_HK_DB_woff,
            ttf: UDShinGo_HK_DB_ttf,
        },
        jpFiles: {
            woff2: UDShinGo_JP_DB_woff2,
            woff: UDShinGo_JP_DB_woff,
            otf: UDShinGo_JP_DB_otf,
        }
    },
    {
        family: 'UD_ShinGo Medium',
        weight: 'Medium',
        cnFiles: {
            woff2: UDShinGo_CN_M_woff2,
            woff: UDShinGo_CN_M_woff,
            otf: UDShinGo_CN_M_otf,
        },
        hkFiles: {
            woff2: UDShinGo_HK_M_woff2,
            woff: UDShinGo_HK_M_woff,
            ttf: UDShinGo_HK_M_ttf,
        },
        jpFiles: {
            woff2: UDShinGo_JP_M_woff2,
            woff: UDShinGo_JP_M_woff,
            otf: UDShinGo_JP_M_otf,
        }
    },
    {
        family: 'UD_ShinGo Regular',
        weight: 'Regular',
        cnFiles: {
            woff2: UDShinGo_CN_R_woff2,
            woff: UDShinGo_CN_R_woff,
            otf: UDShinGo_CN_R_otf,
        },
        hkFiles: {
            woff2: UDShinGo_HK_R_woff2,
            woff: UDShinGo_HK_R_woff,
            ttf: UDShinGo_HK_R_ttf,
        },
        jpFiles: {
            woff2: UDShinGo_JP_R_woff2,
            woff: UDShinGo_JP_R_woff,
            otf: UDShinGo_JP_R_otf,
        }
    },
    {
        family: 'HMSans',
        weight: 'Regular',
        cnFiles: {
            woff2: HMSans_SC_woff2,
            woff: HMSans_SC_woff,
        },
        hkFiles: {
            woff2: HMSans_TC_woff2,
            woff: HMSans_TC_woff,
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
    
    // Helper to process a font file
    const processFile = async (filePath: string | undefined, format: string) => {
        if (!filePath) return;
        const url = toCdnUrl(filePath);
        
        // Try to get from cache first
        const blob = await getCachedFontBlob(url);
        let finalUrl = url;
        
        if (blob) {
            finalUrl = URL.createObjectURL(blob);
            activeBlobUrls.push(finalUrl);
        } else {
            // Not in cache, trigger background cache
            void cacheFontFile(url).catch(err => console.error('Font background cache failed:', err));
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
    if (DISABLE_DYNAMIC_FONTS) {
        // 在 CI 或禁用字体环境下直接返回，跳过动态字体注入
        return;
    }
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
    if (DISABLE_DYNAMIC_FONTS) return;
    void injectFontStyles(region);
    console.log(`Font switched to region: ${region}`);
}

// get current region (external call)
export function getCurrentRegion(): Region {
    return detectDocumentLanguage();
}