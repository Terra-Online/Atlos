import { create } from 'zustand';
import type { StoreApi, UseBoundStore } from 'zustand';
import {
  SUPPORTED_LANGS,
  getFontRegionForLocale,
  getLocaleContentCandidates,
  hasFullSupport,
  normalizeLang,
  toBCP47,
  type Lang,
} from '@main/lib/i18n/lang';
import { switchFontRegion } from '@main/locale/fontLoader';

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
} from '@main/lib/i18n/lang';

interface I18nBundle {
  game: Record<string, unknown>;
  ui: Record<string, unknown>;
}

type JsonModule = { default: Record<string, unknown> };
const localeModules: Record<string, () => Promise<JsonModule>> = import.meta.glob<JsonModule>('./data/**/*.json');
const STORAGE_KEY = 'talos:locale';

const deepGet = (value: unknown, path: string): unknown => path.split('.').reduce<unknown>((current, key) => (
  current && typeof current === 'object' && key in (current as Record<string, unknown>)
    ? (current as Record<string, unknown>)[key]
    : undefined
), value);

const isObject = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const deepMerge = (base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> => {
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    result[key] = isObject(result[key]) && isObject(value)
      ? deepMerge(result[key] as Record<string, unknown>, value)
      : value;
  }
  return result;
};

const resolveLoader = (namespace: 'ui' | 'game', locale: string) => {
  const candidates = getLocaleContentCandidates(locale).map((candidate) => candidate.toLowerCase());
  return Object.entries(localeModules).find(([file]) => {
    if (!file.includes(`/data/${namespace}/`)) return false;
    const name = file.split('/').pop()?.replace(/\.json$/i, '').toLowerCase();
    return Boolean(name && candidates.includes(name));
  })?.[1];
};

const readInitialLocale = (): Lang => {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return normalizeLang(stored || navigator.language);
  } catch {
    return normalizeLang(typeof navigator === 'undefined' ? 'en-US' : navigator.language);
  }
};

type I18nState = {
  locale: Lang;
  data: I18nBundle;
};

const useI18nStore: UseBoundStore<StoreApi<I18nState>> = create<I18nState>(() => ({
  locale: readInitialLocale(),
  data: { game: {}, ui: {} },
}));
const localePromises = new Map<Lang, Promise<I18nBundle>>();

const loadLocale = (locale: Lang): Promise<I18nBundle> => {
  const cached = localePromises.get(locale);
  if (cached) return cached;
  const promise = (async () => {
    const uiLoader = resolveLoader('ui', locale);
    const englishUiLoader = locale === 'en-US' ? undefined : resolveLoader('ui', 'en-US');
    const gameLocale = hasFullSupport(locale) ? locale : 'en-US';
    const gameLoader = resolveLoader('game', gameLocale);
    const [ui, englishUi, game] = await Promise.all([
      uiLoader?.() ?? Promise.resolve({ default: {} }),
      englishUiLoader?.() ?? Promise.resolve({ default: {} }),
      gameLoader?.() ?? Promise.resolve({ default: {} }),
    ]);
    return {
      ui: englishUiLoader ? deepMerge(englishUi.default, ui.default) : ui.default,
      game: game.default,
    };
  })().catch((error) => {
    localePromises.delete(locale);
    throw error;
  });
  localePromises.set(locale, promise);
  return promise;
};

const loadAndSet = async (locale: Lang) => {
  const [data] = await Promise.all([
    loadLocale(locale),
    switchFontRegion(getFontRegionForLocale(locale)).catch(() => undefined),
  ]);
  useI18nStore.setState({ locale, data });
  document.documentElement.lang = toBCP47(locale);
};

export const useLocale = () => useI18nStore((state) => state.locale);
export const getCurrentLocale = () => useI18nStore.getState().locale;

export const useTranslate = () => {
  const data = useI18nStore((state) => state.data);
  return <T = string,>(key: string): T => deepGet(data, key) as T;
};

export const useTranslateUI = () => {
  const translate = useTranslate();
  return (key: string): string => translate<string>(`ui.${key}`) ?? '';
};

export const useTranslateGame = () => {
  const translate = useTranslate();
  return (key: string): string => translate<string>(`game.${key}`) ?? '';
};

export const translateUI = (key: string, fallback = ''): string => {
  const value = deepGet(useI18nStore.getState().data.ui, key);
  return typeof value === 'string' ? value : fallback;
};

export const setLocale = async (locale: string) => {
  const normalized = normalizeLang(locale);
  await loadAndSet(normalized);
  try {
    window.localStorage.setItem(STORAGE_KEY, normalized);
  } catch {
    // Ignore unavailable storage contexts.
  }
};

export const preloadAllLanguages = async (current: Lang = getCurrentLocale()) => {
  await Promise.allSettled(SUPPORTED_LANGS.filter((locale) => locale !== current).map(loadLocale));
};

export const i18nInitPromise = loadAndSet(readInitialLocale());
