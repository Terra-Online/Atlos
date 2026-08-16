import ALP from 'accept-language-parser';

export type FontRegion = 'CN' | 'HK' | 'JP' | null;

export const FULL_LANGS = [
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
    'th-TH',
    'vi-VN',
] as const;

export const UI_ONLY_LANGS = [
    'ar-SA',
    'ms-MY',
    'pl-PL',
    'sv-SE',
    'el-GR',
    'hi-IN',
    'uk-UA',
    'tr-TR',
] as const;

export const SUPPORTED_LANGS = [...FULL_LANGS, ...UI_ONLY_LANGS] as const;
export type Lang = (typeof SUPPORTED_LANGS)[number];

const FULL_LANG_SET = new Set<string>(FULL_LANGS);
const UI_ONLY_LANG_SET = new Set<string>(UI_ONLY_LANGS);

export const LANG_NATIVE_LABELS: Record<Lang, string> = {
    'en-US': 'English',
    'zh-CN': '简体中文',
    'zh-HK': '繁體中文',
    'ja-JP': '日本語',
    'ko-KR': '한국어',
    'ru-RU': 'Русский',
    'es-ES': 'Español',
    'fr-FR': 'Français',
    'de-DE': 'Deutsch',
    'it-IT': 'Italiano',
    'pt-BR': 'Português',
    'id-ID': 'Bahasa Indonesia',
    'ar-SA': 'العربية',
    'ms-MY': 'Bahasa Melayu',
    'pl-PL': 'Polski',
    'sv-SE': 'Svenska',
    'th-TH': 'ไทย',
    'vi-VN': 'Tiếng Việt',
    'el-GR': 'Ελληνικά',
    'hi-IN': 'हिंदी',
    'uk-UA': 'Українська',
    'tr-TR': 'Türkçe',
};

const LANG_URL_CODE_OVERRIDES: Partial<Record<Lang, string>> = {
    'zh-CN': 'cn',
    'zh-HK': 'hk',
    'ko-KR': 'kr',
    'pt-BR': 'br',
    'ms-MY': 'my',
    'sv-SE': 'se',
    'vi-VN': 'vn',
};

const getDefaultLangUrlCode = (lang: string): string => (
    lang.toLowerCase().split('-')[0] || lang
);

const LANG_URL_CODES: Record<Lang, string> = Object.fromEntries(
    SUPPORTED_LANGS.map((lang) => [lang, LANG_URL_CODE_OVERRIDES[lang] ?? getDefaultLangUrlCode(lang)])
) as Record<Lang, string>;

const LANG_URL_CODE_REVERSE: Record<string, Lang> = Object.fromEntries(
    Object.entries(LANG_URL_CODES).map(([lang, code]) => [code, lang])
) as Record<string, Lang>;

const GOOGLE_LANGUAGE_ALIASES: Record<string, Lang> = {
    ...Object.fromEntries(SUPPORTED_LANGS.map((lang) => [getDefaultLangUrlCode(lang), lang])),
    zh: 'zh-CN',
    'zh-tw': 'zh-HK',
    'zh-hk': 'zh-HK',
};

/* Language Tools */

export const hasFullSupport = (lang: string): boolean => (
    FULL_LANG_SET.has(lang)
);

export const isUIOnly = (lang: string): boolean => (
    UI_ONLY_LANG_SET.has(lang)
);

export const toBCP47 = (tag: string): string => {
    const normalized = tag.trim().replace('_', '-');
    if (!normalized) return '';
    const [lang, region, ...rest] = normalized.split('-');
    const parts = [
        lang.toLowerCase(),
        ...(region ? [region.length === 2 ? region.toUpperCase() : region] : []),
        ...rest,
    ];
    return parts.filter(Boolean).join('-');
};

export const canonicalizeLocaleAlias = (tag: string): string => {
    const normalized = toBCP47(tag);
    const lower = normalized.toLowerCase();
    if (lower.startsWith('zh-tw')) return 'zh-HK';
    return normalized;
};

export const pickSupportedLang = (lang?: string | null): Lang | null => {
    if (!lang) return null;
    const trimmed = lang.trim().replace('_', '-');
    if (trimmed.toLowerCase().startsWith('zh-tw')) return 'zh-HK';
    const language = trimmed.includes(',') ? trimmed : canonicalizeLocaleAlias(trimmed);
    if (!language) return null;
    const picked = ALP.pick([...SUPPORTED_LANGS], language);
    return (picked as Lang) || null;
};

export const normalizeLang = (lang?: string | null, fallback: Lang = 'en-US'): Lang => (
    pickSupportedLang(lang) || fallback
);

export const getFontRegionForLocale = (locale?: string | null): FontRegion => {
    const lower = String(locale || '').toLowerCase().replace('_', '-');
    if (lower.includes('zh-cn') || lower.includes('zh-hans')) return 'CN';
    if (lower.includes('ja') || lower.includes('jp')) return 'JP';
    if (lower.includes('zh-tw') || lower.includes('zh-hk') || lower.includes('zh-hant')) return 'HK';
    return null;
};

export const getLocaleContentCandidates = (locale: string): string[] => {
    const normalized = canonicalizeLocaleAlias(locale);
    return normalized.toLowerCase() === 'zh-hk' ? [normalized, 'zh-TW'] : [normalized];
};

export const resolveFileContentLocale = (locale: string): string => (
    getLocaleContentCandidates(locale)[1] ?? canonicalizeLocaleAlias(locale)
);

export const getLangDisplayCode = (lang: string): string => {
    const lower = lang.toLowerCase().replace('_', '-');
    if (lower.startsWith('zh-hk') || lower.startsWith('zh-tw') || lower.startsWith('zh-hant')) return 'HK';
    if (lower.startsWith('zh-cn') || lower.startsWith('zh-hans')) return 'CN';
    if (lower.startsWith('zh-sg')) return 'SG';
    const base = (lower.split('-')[0] || lower).slice(0, 2);
    return base.toUpperCase();
};

export const getLangUrlCode = (lang: string): string => {
    const supported = pickSupportedLang(lang);
    return supported ? LANG_URL_CODES[supported] : lang;
};

export const getLangFromUrlCode = (code: string): Lang | null => {
    const normalized = code.trim().toLowerCase();
    return LANG_URL_CODE_REVERSE[normalized] ?? pickSupportedLang(code);
};

export const getTargetLang = (locale: string): string => (
    toBCP47(locale).toLowerCase()
);

export const normalizeProjectLangKey = (sourceLang: string | undefined): string => {
    const normalized = sourceLang?.trim().replace('_', '-');
    if (!normalized || normalized.toLowerCase() === 'auto') return '';
    const exactMatch = pickSupportedLang(normalized);
    if (exactMatch) return exactMatch;

    const canonical = canonicalizeLocaleAlias(normalized);
    const canonicalMatch = pickSupportedLang(canonical);
    if (canonicalMatch) return canonicalMatch;

    return GOOGLE_LANGUAGE_ALIASES[normalized.toLowerCase()] ?? normalized;
};

export const getProjectLangNameKey = (sourceLang: string | undefined): string => {
    const langKey = normalizeProjectLangKey(sourceLang);
    return langKey ? `language.names.${langKey}` : '';
};
