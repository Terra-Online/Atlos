import { normalizeLang, type Lang } from './lang';

type Catalog = Record<string, unknown>;

export const readInitialLocale = (): Lang => {
    try {
        return normalizeLang(
            window.localStorage.getItem('talos:locale') || navigator.language,
        );
    } catch {
        return normalizeLang(
            typeof navigator === 'undefined' ? 'en-US' : navigator.language,
        );
    }
};

export const persistLocale = (locale: Lang) => {
    try {
        window.localStorage.setItem('talos:locale', locale);
    } catch {
        // Language switching also works when storage is unavailable.
    }
};

export const deepGet = (value: unknown, path: string): unknown =>
    path
        .split('.')
        .reduce<unknown>(
            (current, key) =>
                current && typeof current === 'object' && key in current
                    ? (current as Catalog)[key]
                    : undefined,
            value,
        );

const isObject = (value: unknown): value is Catalog =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

export const mergeCatalogs = (base: Catalog, override: Catalog): Catalog => {
    const result = { ...base };
    for (const [key, value] of Object.entries(override)) {
        const previous = result[key];
        result[key] =
            isObject(previous) && isObject(value)
                ? mergeCatalogs(previous, value)
                : value;
    }
    return result;
};

// Each catalog owner gets its own guard; sharing helpers must not share app state.
export const createRequestGuard = () => {
    let revision = 0;
    return () => {
        const current = ++revision;
        return () => current === revision;
    };
};
