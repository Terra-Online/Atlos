import { create } from 'zustand';
import type { UseBoundStore, StoreApi } from 'zustand';
import LOGGER from '@/lib/logging/logger';
import { switchFontRegion } from '@/locale/fontLoader';
import {
    SUPPORTED_LANGS,
    getFontRegionForLocale,
    getLocaleContentCandidates,
    hasFullSupport,
    normalizeLang,
    toBCP47,
    type Lang,
} from '@/lib/i18n/lang';
export {
    FULL_LANGS,
    UI_ONLY_LANGS,
    SUPPORTED_LANGS,
    canonicalizeLocaleAlias,
    getFontRegionForLocale,
    getLangDisplayCode,
    getLangFromUrlCode,
    getLangUrlCode,
    getLocaleContentCandidates,
    getProjectLangNameKey,
    getTargetLang,
    hasFullSupport,
    isUIOnly,
    LANG_NATIVE_LABELS,
    normalizeLang,
    normalizeProjectLangKey,
    pickSupportedLang,
    resolveFileContentLocale,
    toBCP47,
    type FontRegion,
    type Lang,
} from '@/lib/i18n/lang';

export interface II18nBundle {
    game: Record<string, unknown>; // Game stuff(point, category, etc)
    ui: Record<string, unknown>; // UI components text
}

const STORAGE_KEY = 'talos:locale';

const getNavigatorLanguage = (): string | undefined => {
    if (typeof navigator === 'undefined') return undefined;
    return navigator.language;
};

const getStoredLocale = (): Lang | null => {
    try {
        if (typeof window === 'undefined' || !('localStorage' in window)) return null;
        const saved = window.localStorage.getItem(STORAGE_KEY);
        return saved ? normalizeLang(saved || getNavigatorLanguage()) : null;
    } catch {
        return null;
    }
};

const getLanguage = () => getStoredLocale() || normalizeLang(getNavigatorLanguage());

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
    const canonLower = toBCP47(locale).toLowerCase();
    
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
    const resolveLoaderWithFallbacks = (pathPattern: RegExp, locale: string) => {
        for (const candidate of getLocaleContentCandidates(locale)) {
            const loader = resolveLoader(pathPattern, candidate);
            if (loader) return loader;
        }
        return undefined;
    };

    const gameLoader = resolveLoaderWithFallbacks(gamePattern, gameLocale);

    // Region bundle follows the same fallback rule as game content
    const regionLoader = resolveLoaderWithFallbacks(regionPattern, gameLocale);

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

const localeLoadPromises = new Map<Lang, Promise<II18nBundle>>();

function loadLocaleCached(locale: Lang): Promise<II18nBundle> {
    const existing = localeLoadPromises.get(locale);
    if (existing) return existing;

    const promise = loadLocaleOnMain(locale).catch((err: unknown) => {
        localeLoadPromises.delete(locale);
        throw err;
    });
    localeLoadPromises.set(locale, promise);
    return promise;
}

const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

const PRELOAD_BATCH_SIZE = 3;

async function preloadLocales(locales: readonly Lang[]) {
    for (let i = 0; i < locales.length; i += PRELOAD_BATCH_SIZE) {
        const batch = locales.slice(i, i + PRELOAD_BATCH_SIZE);
        await Promise.allSettled(batch.map(lang => loadLocaleCached(lang)));
        await wait(200);
    }
}

let allPreloadingStarted = false;

export async function preloadAllLanguages(current: Lang = getCurrentLocale()) {
    if (allPreloadingStarted) return;
    allPreloadingStarted = true;
    await preloadLocales(SUPPORTED_LANGS.filter(lang => lang !== current));
}

async function loadAndSet(locale: Lang) {
    const fontRegion = getFontRegionForLocale(locale);
    void switchFontRegion(fontRegion).catch((err: unknown) => {
        LOGGER.warn('Font switch failed:', err);
    });
    const data = await loadLocaleCached(locale);

    useI18nStore.setState({ locale, data });
    
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

export const translateUI = (key: string, fallback = ''): string => {
    const value = deepGet(useI18nStore.getState().data.ui, key);
    return typeof value === 'string' ? value : fallback;
};

export const useLocale = () => useI18nStore((s) => s.locale);

export const getCurrentLocale = (): Lang => useI18nStore.getState().locale;

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
