import { create } from 'zustand';
import type { UseBoundStore, StoreApi } from 'zustand';
import LOGGER from '@/utils/log';
import ALP from 'accept-language-parser';
import { preloadFonts, getFontUrlsForRegion } from '@/locale/fontCache';
import { runStorageMigration } from '@/utils/fallback';

// Build CDN URL for fonts (same logic as fontLoader)
const toCdnUrl = (p: string): string => {
    const str = String(p);
    if (str.indexOf('://') !== -1 || str.startsWith('//')) return str;

    // eslint-disable-next-line no-undef
    const base = (typeof __ASSETS_HOST !== 'undefined' && __ASSETS_HOST) ? String(__ASSETS_HOST) : '';
    
    if (base && str.startsWith(base)) return str;

    // Dev: keep /src/ prefix; Prod: normalize to /assets/ and prepend CDN
    if (!base) return p; // Dev mode: return original path as-is
    const normalized = p.replace(/^\/src\/assets/i, '/assets');
    const baseEnds = base.endsWith('/');
    const pathStarts = normalized.startsWith('/');
    if (baseEnds && pathStarts) return base + normalized.slice(1);
    if (!baseEnds && !pathStarts) return `${base}/${normalized}`;
    return base + normalized;
};

export interface II18nBundle {
    game: Record<string, unknown>; // Game stuff(point, category, etc)
    ui: Record<string, unknown>; // UI components text
}

export const SUPPORTED_LANGS = [
    'en-US',
    'zh-CN',
    'zh-HK',
    'ja-JP',
    'ko-KR',
    'ru-RU',
    'es-ES',

    'fr-FR',
    'de-DE',
    'it-IT',
    'id-ID',
    'pt-BR',
    'ar-AE',
    'ms-MY',
    'pl-PL',
    'sv-SE',
    'th-TH',
    'vi-VN'
] as const;
type Lang = (typeof SUPPORTED_LANGS)[number];

// Languages that have both game and UI translations (full support)
export const FULL_LANGS: readonly Lang[] = ['en-US', 'zh-CN', 'zh-HK', 'ja-JP', 'ko-KR', 'ru-RU', 'es-ES', 'fr-FR', 'de-DE', 'it-IT', 'id-ID', 'pt-BR', 'th-TH', 'vi-VN'] as const;
// Languages that only have UI translations
export const UI_ONLY_LANGS: readonly Lang[] = [ 'ar-AE', 'ms-MY', 'pl-PL', 'sv-SE' ] as const;

// Check if a language has full support (game + UI)
export const hasFullSupport = (lang: Lang): boolean => {
    return (FULL_LANGS as readonly string[]).includes(lang);
};

// Check if a language has UI-only support
export const isUIOnly = (lang: Lang): boolean => {
    return (UI_ONLY_LANGS as readonly string[]).includes(lang);
};

const STORAGE_KEY = 'talos:locale';

// Map locale to font region
const localeToFontRegion = (locale: Lang): 'CN' | 'HK' | 'JP' => {
    if (locale === 'zh-CN') return 'CN';
    if (locale === 'zh-HK') return 'HK';
    if (locale === 'ja-JP') return 'JP';
    return 'HK'; // Default to HK for other locales
};

// Convert our internal locale to a proper BCP-47 tag for <html lang>
const toBCP47 = (locale: Lang): string => {
    const [lang, region] = locale.split('-');
    return region ? `${lang}-${region.toUpperCase()}` : lang;
};

const normalizeLang = (lang?: string): Lang => {
    let language = lang || navigator.language || 'en-US';
    // Backward compatibility: map legacy zh-TW to zh-HK
    if (language.toLowerCase().startsWith('zh-tw')) language = 'zh-HK';
    // try to pick a supported lang
    const picked = ALP.pick([...SUPPORTED_LANGS], language);
    return (picked as Lang) || 'en-US';
};

const getStoredLocale = (): Lang | null => {
    try {
        if (typeof window === 'undefined' || !('localStorage' in window)) return null;
        const saved = window.localStorage.getItem(STORAGE_KEY);
        return saved ? normalizeLang(saved) : null;
    } catch {
        return null;
    }
};

const getLanguage = () => getStoredLocale() || normalizeLang();

const deepGet = (obj: unknown, path: string): unknown =>
    path.split('.').reduce<unknown>((acc, k) => {
        if (acc && typeof acc === 'object' && k in (acc as Record<string, unknown>)) {
            return (acc as Record<string, unknown>)[k];
        }
        return undefined;
    }, obj);

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
    typeof v === 'object' && v !== null && !Array.isArray(v);

const deepMergeObjects = (base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = { ...base };
    for (const [key, value] of Object.entries(override)) {
        const baseValue = base[key];
        if (isPlainObject(baseValue) && isPlainObject(value)) {
            out[key] = deepMergeObjects(baseValue, value);
        } else {
            out[key] = value;
        }
    }
    return out;
};

// Build-safe loaders using Vite import.meta.glob (no worker)
type JsonModule = { default: Record<string, unknown> };
// Combine all locale files into one glob mapping to simplify logic and potential bundling
const allLocales: Record<string, () => Promise<JsonModule>> = import.meta.glob<JsonModule>('./data/**/*.json');

function resolveLoader(pathPattern: RegExp, locale: string): (() => Promise<JsonModule>) | undefined {
    const localeLower = locale.toLowerCase();
    const canonLower = toBCP47(locale as Lang).toLowerCase();
    
    for (const [path, loader] of Object.entries(allLocales)) {
        // Match path pattern (e.g. /ui/, /game/)
        if (!pathPattern.test(path)) continue;

        const base = (path.split('/').pop() || '').replace(/\.json$/i, '');
        const baseLower = base.toLowerCase();
        if (baseLower === localeLower || baseLower === canonLower) return loader;
    }
    return undefined;
}

type I18nState = {
    locale: Lang;
    data: II18nBundle;
    t: <T = string>(key: string) => T;
};

const useI18nStore: UseBoundStore<StoreApi<I18nState>> = create<I18nState>(() => ({
    locale: getLanguage(),
    data: { game: {}, ui: {} },
    t: <T = string>(key: string) => {
        const { data } = useI18nStore.getState();
        // Forcedly require explicit namespace: ui.xxx / game.xxx
        if (key.startsWith('ui.') || key.startsWith('game.')) {
            return deepGet(data, key) as T;
        }
        // No namespace, warn in log and return empty string
        LOGGER.warnOnce(
            `i18n:no-namespace:${key}`,
            'i18n key without namespace, please use ui.* or game.* explicitly:',
            key,
        );
        return '' as unknown as T;
    },
}));

// Load locale data on main thread (build-safe via glob)
async function loadLocaleOnMain(locale: Lang): Promise<II18nBundle> {
    // Regex patterns for different categories
    const uiPattern = /\/data\/ui\//;
    const gamePattern = /\/data\/game\//;
    const regionPattern = /\/data\/region\//;

    const uiLoader = resolveLoader(uiPattern, locale);
    const fallbackUiLoader = locale === 'en-US' ? undefined : resolveLoader(uiPattern, 'en-US');

    // For UI-only languages, fallback to English for game content
    const gameLocale = hasFullSupport(locale) ? locale : 'en-US';
    let gameLoader = resolveLoader(gamePattern, gameLocale);

    // Region bundle follows the same fallback rule as game content
    let regionLoader = resolveLoader(regionPattern, gameLocale);

    // Special alias: use zh-TW game content for zh-HK locale if direct match not found
    if (!gameLoader) {
        const lower = gameLocale.toLowerCase();
        if (lower === 'zh-hk') {
            gameLoader = resolveLoader(gamePattern, 'zh-TW');
        }
    }

    if (!regionLoader) {
        const lower = gameLocale.toLowerCase();
        if (lower === 'zh-hk') {
            regionLoader = resolveLoader(regionPattern, 'zh-TW');
        }
    }

    const [uiMod, fallbackUiMod, gameMod, regionMod] = await Promise.all([
        uiLoader ? uiLoader() : Promise.resolve({ default: {} as Record<string, unknown> }),
        fallbackUiLoader ? fallbackUiLoader() : Promise.resolve({ default: {} as Record<string, unknown> }),
        gameLoader ? gameLoader() : Promise.resolve({ default: {} as Record<string, unknown> }),
        regionLoader ? regionLoader() : Promise.resolve({ default: {} as Record<string, unknown> }),
    ]);

    const mergedUi = fallbackUiLoader
        ? deepMergeObjects(fallbackUiMod.default, uiMod.default)
        : uiMod.default;
    return {
        ui: mergedUi,
        game: { ...gameMod.default, region: regionMod.default },
    };
}

// Preload all supported languages in background
let preloadingStarted = false;

async function preloadLanguages(current: Lang) {
    if (preloadingStarted) return;
    preloadingStarted = true;

    // Delay to let main thread settle
    await new Promise(r => setTimeout(r, 2000));

    // Exclude current language
    const toPreload = SUPPORTED_LANGS.filter(l => l !== current);
    
    // Load in small batches to avoid network congestion
    const BATCH_SIZE = 3;
    for (let i = 0; i < toPreload.length; i += BATCH_SIZE) {
        const batch = toPreload.slice(i, i + BATCH_SIZE);
        await Promise.allSettled(batch.map(lang => loadLocaleOnMain(lang)));
        // Small breathing room between batches
        await new Promise(r => setTimeout(r, 200));
    }
}

async function loadAndSet(locale: Lang) {
    let ui: Record<string, unknown> = {};
    let game: Record<string, unknown> = {};

    // Start font preloading in parallel (non-blocking)
    const fontRegion = localeToFontRegion(locale);
    const fontUrls = getFontUrlsForRegion(fontRegion).map(toCdnUrl);
    const safePreloadFonts = (urls: string[]): Promise<void> => {
        return (preloadFonts as unknown as (u: string[]) => Promise<void>)(urls);
    };
    // Fire and forget - don't block language switch
    safePreloadFonts(fontUrls).catch((err: unknown) => {
        LOGGER.warn('Font preload failed:', err);
    });

    // Load on main thread using build-safe module graph
    const data = await loadLocaleOnMain(locale);
    ui = data.ui;
    game = data.game;

    // Update state immediately without waiting for fonts
    useI18nStore.setState({ locale, data: { game, ui } });
    
    // Sync document language tag for :lang() or [lang] based styles/fonts switching
    try {
        if (typeof document !== 'undefined') {
            const htmlLang = toBCP47(locale);
            document.documentElement.setAttribute('lang', htmlLang);
        }
    } catch {
        // ignore envs without document
    }

    // Trigger preload of other languages
    void preloadLanguages(locale);
}

async function init() {
    // Run storage migration BEFORE anything else.
    // Must complete before Zustand stores hydrate to avoid race conditions.
    try {
        await runStorageMigration();
    } catch (err: unknown) {
        console.error('[Migration] Migration error:', err);
    }
    
    const locale = getLanguage();
    await loadAndSet(locale);
}

export const useTranslate = (): (<T = string>(key: string) => T) => {
    const { t } = useI18nStore();
    return t;
};

// package namespace functions
export const useTranslateUI = () => {
    const t = useTranslate();
    return (k: string) => t(`ui.${k}`);
};
export const useTranslateGame = () => {
    const t = useTranslate();
    return (k: string) => t(`game.${k}`);
};

export const useLocale = () => useI18nStore((s) => s.locale);

export async function setLocale(lang: string) {
    const normalized = normalizeLang(lang);
    await loadAndSet(normalized);
    try {
        if (typeof window !== 'undefined' && 'localStorage' in window) {
            window.localStorage.setItem(STORAGE_KEY, normalized);
        }
    } catch {
        // ignore storage errors (e.g., Safari private mode)
    }
}

export const i18nInitPromise = init();