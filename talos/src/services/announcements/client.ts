import { DOCS_LOCALES, docsLocale, type DocsLocale } from '@/lib/i18n/docsLink';

export const getAnnouncementApiBase = (): string => {
    const envBase = (import.meta.env.VITE_ANNOUNCEMENT_API_BASE as string | undefined)?.trim();
    if (envBase) return envBase.replace(/\/$/, '');

    if (typeof window !== 'undefined') {
        const host = window.location.hostname;
        if (host === 'localhost') {
            return 'http://localhost:3000';
        }
    }

    return 'https://blog.opendfieldmap.org';
};

export interface AnnouncementApiItem {
    id: string;
    title: string;
    description: string;
    content: string;
    date?: string;
    url?: string;
    locale?: string;
}

export interface AnnouncementLatestMeta {
    latestId: string | null;
    version: string;
    locale?: string;
}

const REMOTE_BASE = 'https://blog.opendfieldmap.org';
const LOCAL_BASE = 'http://localhost:3000';
const BLOG_ASSET_BASE = ((import.meta.env.VITE_ANNOUNCEMENT_ASSET_BASE as string | undefined)?.trim() || REMOTE_BASE).replace(/\/$/, '');
const ANNOUNCEMENT_STORAGE_KEY = 'announcementState';
const OLD_ANNOUNCEMENT_LATEST_ID_KEY_PREFIX = 'announcement_latest_id';
const OLD_ANNOUNCEMENT_BODY_CACHE_KEY_PREFIX = 'announcement_cache_body';
const OLD_ANNOUNCEMENT_VERSION_KEY_PREFIX = 'announcement_version';
const OLD_ANNOUNCEMENT_LAST_READ_DATE_KEY = 'announcement_last_read';
const OLD_ANNOUNCEMENT_LAST_READ_ID_KEY = 'announcement_last_read_id';

type ApiLocale = DocsLocale;
const API_LOCALES: ApiLocale[] = [...DOCS_LOCALES];

type AnnouncementLocaleCache = {
    latestId?: string | null;
    version?: string;
    body?: AnnouncementApiItem[];
};

type AnnouncementStorageState = {
    lastRead?: {
        id?: string | null;
        date?: string | null;
    };
    locales?: Partial<Record<ApiLocale, AnnouncementLocaleCache>>;
};

export type AnnouncementDebugMode = 'force-unread' | null;

const isRecord = (value: unknown): value is Record<string, unknown> => {
    return typeof value === 'object' && value !== null;
};

const parseAnnouncementBodyCache = (raw: string | null): AnnouncementApiItem[] | undefined => {
    if (!raw) return undefined;
    try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return undefined;
        return parsed.filter((item): item is AnnouncementApiItem => {
            if (!isRecord(item)) return false;
            return (
                typeof item.id === 'string'
                && typeof item.title === 'string'
                && typeof item.description === 'string'
                && typeof item.content === 'string'
            );
        });
    } catch {
        return undefined;
    }
};

const normalizeStorageState = (raw: unknown): AnnouncementStorageState => {
    if (!isRecord(raw)) return {};

    const state: AnnouncementStorageState = {};
    if (isRecord(raw.lastRead)) {
        state.lastRead = {
            id: typeof raw.lastRead.id === 'string' ? raw.lastRead.id : null,
            date: typeof raw.lastRead.date === 'string' ? raw.lastRead.date : null,
        };
    }

    if (isRecord(raw.locales)) {
        state.locales = {};
        for (const locale of API_LOCALES) {
            const localeValue = raw.locales[locale];
            if (!isRecord(localeValue)) continue;
            state.locales[locale] = {
                latestId: typeof localeValue.latestId === 'string' ? localeValue.latestId : null,
                version: typeof localeValue.version === 'string' ? localeValue.version : '',
                body: Array.isArray(localeValue.body)
                    ? localeValue.body.filter((item): item is AnnouncementApiItem => {
                        if (!isRecord(item)) return false;
                        return (
                            typeof item.id === 'string'
                            && typeof item.title === 'string'
                            && typeof item.description === 'string'
                            && typeof item.content === 'string'
                        );
                    })
                    : [],
            };
        }
    }

    return state;
};

const readAnnouncementStorageState = (): AnnouncementStorageState => {
    if (typeof window === 'undefined') return {};

    let state: AnnouncementStorageState = {};
    try {
        const raw = localStorage.getItem(ANNOUNCEMENT_STORAGE_KEY);
        state = raw ? normalizeStorageState(JSON.parse(raw)) : {};
    } catch {
        state = {};
    }

    let migrated = false;
    if (!state.lastRead) {
        const id = localStorage.getItem(OLD_ANNOUNCEMENT_LAST_READ_ID_KEY);
        const date = localStorage.getItem(OLD_ANNOUNCEMENT_LAST_READ_DATE_KEY);
        if (id || date) {
            state.lastRead = { id, date };
            migrated = true;
        }
    }

    const locales = state.locales ?? {};
    for (const locale of API_LOCALES) {
        const latestId = localStorage.getItem(`${OLD_ANNOUNCEMENT_LATEST_ID_KEY_PREFIX}:${locale}`);
        const version = localStorage.getItem(`${OLD_ANNOUNCEMENT_VERSION_KEY_PREFIX}:${locale}`);
        const body = parseAnnouncementBodyCache(localStorage.getItem(`${OLD_ANNOUNCEMENT_BODY_CACHE_KEY_PREFIX}:${locale}`));
        if (!latestId && !version && !body) continue;

        locales[locale] = {
            latestId: locales[locale]?.latestId ?? latestId,
            version: locales[locale]?.version ?? version ?? '',
            body: locales[locale]?.body ?? body ?? [],
        };
        migrated = true;
    }
    state.locales = locales;

    if (migrated) {
        writeAnnouncementStorageState(state);
        localStorage.removeItem(OLD_ANNOUNCEMENT_LAST_READ_ID_KEY);
        localStorage.removeItem(OLD_ANNOUNCEMENT_LAST_READ_DATE_KEY);
        for (const locale of API_LOCALES) {
            localStorage.removeItem(`${OLD_ANNOUNCEMENT_LATEST_ID_KEY_PREFIX}:${locale}`);
            localStorage.removeItem(`${OLD_ANNOUNCEMENT_BODY_CACHE_KEY_PREFIX}:${locale}`);
            localStorage.removeItem(`${OLD_ANNOUNCEMENT_VERSION_KEY_PREFIX}:${locale}`);
        }
    }

    return state;
};

const writeAnnouncementStorageState = (state: AnnouncementStorageState): void => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(ANNOUNCEMENT_STORAGE_KEY, JSON.stringify(state));
};

export const getAnnouncementLocaleCache = (locale?: string): AnnouncementLocaleCache => {
    const key = docsLocale(locale);
    return readAnnouncementStorageState().locales?.[key] ?? {};
};

export const setAnnouncementLocaleCache = (
    locale: string | undefined,
    patch: AnnouncementLocaleCache,
): void => {
    const key = docsLocale(locale);
    const state = readAnnouncementStorageState();
    const locales = state.locales ?? {};
    locales[key] = {
        ...(locales[key] ?? {}),
        ...patch,
    };
    state.locales = locales;
    writeAnnouncementStorageState(state);
};

export const getAnnouncementLastRead = (): { id: string | null; date: string | null } => {
    const lastRead = readAnnouncementStorageState().lastRead;
    return {
        id: lastRead?.id ?? null,
        date: lastRead?.date ?? null,
    };
};

export const setAnnouncementLastRead = (lastRead: { id?: string | null; date?: string | null }): void => {
    const state = readAnnouncementStorageState();
    state.lastRead = {
        id: lastRead.id ?? state.lastRead?.id ?? null,
        date: lastRead.date ?? state.lastRead?.date ?? null,
    };
    writeAnnouncementStorageState(state);
};

export const getAnnouncementDebugMode = (): AnnouncementDebugMode => {
    if (typeof window === 'undefined') return null;

    const raw = new URLSearchParams(window.location.search).get('annUnread');
    if (!raw) return null;

    const normalized = raw.trim().toLowerCase();
    if (normalized === '1' || normalized === 'true' || normalized === 'force' || normalized === 'unread') {
        return 'force-unread';
    }

    return null;
};

const toAbsoluteBlogAssetUrl = (path: string): string => {
    if (!path) return path;
    if (/^https?:\/\//i.test(path) || path.startsWith('//')) return path;
    if (!path.startsWith('/')) return path;
    return `${BLOG_ASSET_BASE}${path}`;
};

const normalizeAnnouncementContent = (content: string): string => {
    if (!content) return '';

    // Markdown image syntax: ![alt](/blogs/...)
    const normalizedMd = content.replace(/!\[([^\]]*)\]\((\/blogs\/[^)\s]+)\)/g, (_m, alt: string, src: string) => {
        return `![${alt}](${toAbsoluteBlogAssetUrl(src)})`;
    });

    // HTML image tags: <img src="/blogs/...">
    return normalizedMd.replace(/src=(['"])(\/blogs\/[^'"]+)\1/g, (_m, quote: string, src: string) => {
        return `src=${quote}${toAbsoluteBlogAssetUrl(src)}${quote}`;
    });
};

const normalizeAnnouncementItem = (raw: unknown): AnnouncementApiItem | null => {
    if (!isRecord(raw)) return null;

    const id = typeof raw.id === 'string' ? raw.id : '';
    const title = typeof raw.title === 'string' ? raw.title : '';
    const description = typeof raw.description === 'string' ? raw.description : '';
    const contentRaw = typeof raw.content === 'string' ? raw.content : '';
    const content = normalizeAnnouncementContent(contentRaw);

    if (!id || !title) return null;

    return {
        id,
        title,
        description,
        content,
        date: typeof raw.date === 'string' ? raw.date : undefined,
        url: typeof raw.url === 'string' ? raw.url : undefined,
        locale: typeof raw.locale === 'string' ? raw.locale : undefined,
    };
};

const getAnnouncementApiBases = (): string[] => {
    const preferred = getAnnouncementApiBase();
    const bases = [preferred];

    if (preferred === LOCAL_BASE) {
        bases.push(REMOTE_BASE);
    } else if (preferred === REMOTE_BASE) {
        bases.push(LOCAL_BASE);
    } else {
        bases.push(REMOTE_BASE);
    }

    return Array.from(new Set(bases));
};

const toApiUrl = (base: string, locale: ApiLocale, version?: string): string => {
    const url = `${base.replace(/\/$/, '')}/api/${locale}/announcements`;
    if (!version) return url;

    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}v=${encodeURIComponent(version)}`;
};

const toLatestApiUrl = (base: string, locale: ApiLocale): string => {
    return `${base.replace(/\/$/, '')}/api/${locale}/announcements/latest`;
};

const isAnnouncementArray = (value: unknown): value is AnnouncementApiItem[] => {
    return Array.isArray(value);
};

const normalizeAnnouncementLatestMeta = (raw: unknown): AnnouncementLatestMeta | null => {
    if (!isRecord(raw)) return null;

    const latestIdRaw = raw.latestId;
    const latestId = typeof latestIdRaw === 'string' ? latestIdRaw : latestIdRaw === null ? null : null;
    const version = typeof raw.version === 'string' ? raw.version : '';
    if (!version) return null;

    return {
        latestId,
        version,
        locale: typeof raw.locale === 'string' ? raw.locale : undefined,
    };
};

export const fetchAnnouncementLatestMeta = async (locale?: string): Promise<AnnouncementLatestMeta | null> => {
    const currentLocale = docsLocale(locale);
    const localeCandidates: ApiLocale[] = currentLocale === 'en' ? ['en'] : [currentLocale, 'en'];
    const bases = getAnnouncementApiBases();

    for (const base of bases) {
        for (const targetLocale of localeCandidates) {
            try {
                const response = await fetch(toLatestApiUrl(base, targetLocale), {
                    method: 'GET',
                    headers: { Accept: 'application/json' },
                });
                if (!response.ok) continue;

                const json: unknown = await response.json();
                const meta = normalizeAnnouncementLatestMeta(json);
                if (!meta) continue;

                return meta;
            } catch {
                // Try next candidate.
            }
        }
    }

    return null;
};

export const fetchAnnouncements = async (locale?: string, version?: string): Promise<AnnouncementApiItem[]> => {
    const currentLocale = docsLocale(locale);
    const localeCandidates: ApiLocale[] = currentLocale === 'en' ? ['en'] : [currentLocale, 'en'];
    const bases = getAnnouncementApiBases();
    let firstEmpty: AnnouncementApiItem[] | null = null;

    for (const base of bases) {
        for (const targetLocale of localeCandidates) {
            try {
                const response = await fetch(toApiUrl(base, targetLocale, version), {
                    method: 'GET',
                    headers: { Accept: 'application/json' },
                });
                if (!response.ok) continue;

                const json: unknown = await response.json();
                const rawItems = isAnnouncementArray(json) ? json : [];
                const items = rawItems
                    .map((item) => normalizeAnnouncementItem(item))
                    .filter((item): item is AnnouncementApiItem => item !== null);

                if (items.length > 0) {
                    return items;
                }
                if (firstEmpty === null) {
                    firstEmpty = items;
                }
            } catch {
                // Try next candidate.
            }
        }
    }

    return firstEmpty ?? [];
};
