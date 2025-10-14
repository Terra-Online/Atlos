import { create } from 'zustand';
import type { UseBoundStore, StoreApi } from 'zustand';
import LOGGER from '@/utils/log';
import ALP from 'accept-language-parser';
import { preloadFonts, getFontUrlsForRegion } from '@/utils/fontCache';

// Build CDN URL for fonts (same logic as fontLoader)
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

export interface II18nBundle {
    game: Record<string, unknown>; // Game stuff(point, category, etc)
    ui: Record<string, unknown>; // UI components text
}

export const SUPPORTED_LANGS = ['en-US', 'ja-JP', 'ko-KR', 'zh-CN', 'zh-TW'] as const;
type Lang = (typeof SUPPORTED_LANGS)[number];

const STORAGE_KEY = 'talos:locale';

// Map locale to font region
const localeToFontRegion = (locale: Lang): 'CN' | 'HK' | 'JP' => {
    if (locale === 'zh-CN') return 'CN';
    if (locale === 'zh-TW') return 'HK';
    if (locale === 'ja-JP') return 'JP';
    return 'HK'; // Default to HK for other locales
};

// Convert our internal locale to a proper BCP-47 tag for <html lang>
const toBCP47 = (locale: Lang): string => {
    const [lang, region] = locale.split('-');
    return region ? `${lang}-${region.toUpperCase()}` : lang;
};

const normalizeLang = (lang?: string): Lang => {
    const language = lang || navigator.language || 'en-US';
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

// Build-safe loaders using Vite import.meta.glob (no worker)
type JsonModule = { default: Record<string, unknown> };
const uiModules: Record<string, () => Promise<JsonModule>> = import.meta.glob<JsonModule>('./data/ui/*.json');
const gameModules: Record<string, () => Promise<JsonModule>> = import.meta.glob<JsonModule>('./data/game/*.json');

function resolveLoader(map: Record<string, () => Promise<JsonModule>>, locale: string): (() => Promise<JsonModule>) | undefined {
    const localeLower = locale.toLowerCase();
    const canonLower = toBCP47(locale as Lang).toLowerCase();
    for (const [path, loader] of Object.entries(map)) {
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
    const uiLoader = resolveLoader(uiModules, locale);
    const gameLoader = resolveLoader(gameModules, locale);
    const [uiMod, gameMod] = await Promise.all([
        uiLoader ? uiLoader() : Promise.resolve({ default: {} as Record<string, unknown> }),
        gameLoader ? gameLoader() : Promise.resolve({ default: {} as Record<string, unknown> }),
    ]);
    return {
        ui: uiMod.default,
        game: gameMod.default,
    };
}

async function loadAndSet(locale: Lang) {
    let ui: Record<string, unknown> = {};
    let game: Record<string, unknown> = {};

    // Preload fonts for this locale in parallel (with CDN URLs)
    const fontRegion = localeToFontRegion(locale);
    const fontUrls = getFontUrlsForRegion(fontRegion).map(toCdnUrl);
    const fontPreloadPromise = preloadFonts(fontUrls).catch(err => 
        LOGGER.warn('Font preload failed:', err)
    );

    // Load on main thread using build-safe module graph
    const data = await loadLocaleOnMain(locale);
    ui = data.ui;
    game = data.game;

    useI18nStore.setState({ locale, data: { game, ui } });
    
    // Wait for font preloading to complete before updating UI
    await fontPreloadPromise;
    
    // Sync document language tag for :lang() or [lang] based styles/fonts switching
    try {
        if (typeof document !== 'undefined') {
            const htmlLang = toBCP47(locale);
            document.documentElement.setAttribute('lang', htmlLang);
        }
    } catch {
        // ignore envs without document
    }
}

async function init() {
    const locale = getLanguage();
    await loadAndSet(locale);
}
void init();

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
