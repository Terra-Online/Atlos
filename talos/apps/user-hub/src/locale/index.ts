import { readInitialLocale, persistLocale, deepGet, createRequestGuard } from '@main/lib/i18n/runtime';
import { create } from 'zustand';
import {
    getFontRegionForLocale,
    getLocaleContentCandidates,
    normalizeLang,
    toBCP47,
    type Lang,
} from '@main/lib/i18n/lang';
import { switchFontRegion } from '@main/locale/fontLoader';

type Catalog = Record<string, unknown>;
type JsonModule = { default: Catalog };
type Bundle = { ui: Catalog; fallback: Catalog };
type State = Bundle & { locale: Lang };

const modules = import.meta.glob<JsonModule>('./data/ui/*.json');
const loaders = new Map(
    Object.entries(modules).map(([file, loader]) => [
        file
            .split('/')
            .pop()
            ?.replace(/\.json$/i, '')
            .toLowerCase(),
        loader,
    ]),
);
const resolveLoader = (locale: Lang) => {
    for (const candidate of getLocaleContentCandidates(locale)) {
        const loader = loaders.get(candidate.toLowerCase());
        if (loader) return loader;
    }
    return undefined;
};

const useI18nStore = create<State>(() => ({
    locale: readInitialLocale(),
    ui: {},
    fallback: {},
}));
const promises = new Map<Lang, Promise<Bundle>>();

const loadLocale = (locale: Lang): Promise<Bundle> => {
    const cached = promises.get(locale);
    if (cached) return cached;
    const promise = Promise.all([
        resolveLoader(locale)?.() ?? Promise.resolve({ default: {} }),
        loaders.get('en-us')?.() ?? Promise.resolve({ default: {} }),
    ])
        .then(([ui, fallback]) => ({
            ui: ui.default,
            fallback: fallback.default,
        }))
        .catch((error: unknown) => {
            promises.delete(locale);
            throw error;
        });
    promises.set(locale, promise);
    return promise;
};

const beginRequest = createRequestGuard();
const loadAndSet = async (locale: Lang) => {
    const isCurrent = beginRequest();
    const [data] = await Promise.all([
        loadLocale(locale),
        switchFontRegion(getFontRegionForLocale(locale)).catch(() => undefined),
    ]);
    if (!isCurrent()) return false;
    useI18nStore.setState({ locale, ...data });
    document.documentElement.lang = toBCP47(locale);
    return true;
};

const translate = (
    { ui, fallback }: Bundle,
    key: string,
    missing = '',
): string => {
    // Keep English fallback inside the app, including nested keys missing from a locale.
    const value = deepGet(ui, key) ?? deepGet(fallback, key);
    return typeof value === 'string' ? value : missing;
};

export const useLocale = () => useI18nStore((state) => state.locale);
export const getCurrentLocale = () => useI18nStore.getState().locale;
export const useTranslateUI = () => {
    const data = useI18nStore((state) => state);
    return (key: string): string => translate(data, key);
};
export const translateUI = (key: string, fallback = ''): string =>
    translate(useI18nStore.getState(), key, fallback);

export const setLocale = async (locale: string) => {
    const normalized = normalizeLang(locale);
    if (await loadAndSet(normalized)) persistLocale(normalized);
};

export const i18nInitPromise = loadAndSet(getCurrentLocale());
