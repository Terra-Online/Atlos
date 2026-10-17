import { create } from 'zustand';
import type { UseBoundStore, StoreApi } from 'zustand';
import { unstable_batchedUpdates } from 'react-dom';
import { readInitialLocale, persistLocale, deepGet, mergeCatalogs, createRequestGuard } from '@/lib/i18n/runtime';
import LOGGER from '@/lib/logging/logger';
import { switchFontRegion } from '@/locale/fontLoader';
import {
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
    locale: readInitialLocale(),
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
        ? mergeCatalogs(fallbackUiMod.default, uiMod.default)
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

const beginRequest = createRequestGuard();

async function loadAndSet(
    locale: Lang,
    valid = () => true,
    beforeCommit?: () =>
        | (() => void)
        | void
        | Promise<(() => void) | void>,
) {
    const current = beginRequest();
    const isCurrent = () => current() && valid();
    const fontRegion = getFontRegionForLocale(locale);
    // Start catalog and font work together. The UI commit still waits for
    // both, but a cold locale chunk must not delay the font manifest/request.
    const dataPromise = loadLocaleCached(locale);
    const fontsPromise = switchFontRegion(fontRegion, isCurrent);
    const [dataResult, fontsResult] = await Promise.allSettled([
        dataPromise,
        fontsPromise,
    ]);
    if (dataResult.status === 'rejected') throw dataResult.reason;
    const data = dataResult.value;
    if (!isCurrent()) return false;
    if (fontsResult.status === 'rejected') {
        const error = fontsResult.reason;
        LOGGER.warn('Font switch failed:', error);
        if (Object.keys(useI18nStore.getState().data.ui).length) return false;
    }
    if (!isCurrent()) return false;
    const commitBeforeMain = await beforeCommit?.();
    if (!isCurrent()) return false;
    unstable_batchedUpdates(() => {
        commitBeforeMain?.();
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
    });
    return true;
}

async function init() {
    const locale = readInitialLocale();
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

export async function setLocale(
    lang: string,
    isCurrent?: () => boolean,
    beforeCommit?: () =>
        | (() => void)
        | void
        | Promise<(() => void) | void>,
) {
    const normalized = normalizeLang(lang);
    if (await loadAndSet(normalized, isCurrent, beforeCommit))
        persistLocale(normalized);
}

/** Warm one user-selected catalog without committing locale or fonts. */
export function preloadLocale(lang: string): void {
    void loadLocaleCached(normalizeLang(lang)).catch(() => undefined);
}

export const i18nInitPromise = init();
