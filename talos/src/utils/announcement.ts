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

const REMOTE_BASE = 'https://blog.opendfieldmap.org';
const LOCAL_BASE = 'http://localhost:3000';
const BLOG_ASSET_BASE = ((import.meta.env.VITE_ANNOUNCEMENT_ASSET_BASE as string | undefined)?.trim() || REMOTE_BASE).replace(/\/$/, '');

type ApiLocale = 'en' | 'zh-cn' | 'zh-hk' | 'ja' | 'ko';

export type AnnouncementDebugMode = 'force-unread' | null;

const isRecord = (value: unknown): value is Record<string, unknown> => {
    return typeof value === 'object' && value !== null;
};

const toApiLocale = (locale?: string): ApiLocale => {
    const normalized = (locale || '').toLowerCase();
    if (normalized.startsWith('zh-cn')) return 'zh-cn';
    if (normalized.startsWith('zh-hk') || normalized.startsWith('zh-tw')) return 'zh-hk';
    if (normalized.startsWith('ja')) return 'ja';
    if (normalized.startsWith('ko')) return 'ko';
    return 'en';
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

const toApiUrl = (base: string, locale: ApiLocale): string => {
    const url = `${base.replace(/\/$/, '')}/api/${locale}/announcements`;
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}_=${Date.now()}`;
};

const isAnnouncementArray = (value: unknown): value is AnnouncementApiItem[] => {
    return Array.isArray(value);
};

export const fetchAnnouncements = async (locale?: string): Promise<AnnouncementApiItem[]> => {
    const currentLocale = toApiLocale(locale);
    const localeCandidates: ApiLocale[] = currentLocale === 'en' ? ['en'] : [currentLocale, 'en'];
    const bases = getAnnouncementApiBases();
    let firstEmpty: AnnouncementApiItem[] | null = null;

    for (const base of bases) {
        for (const targetLocale of localeCandidates) {
            try {
                const response = await fetch(toApiUrl(base, targetLocale), {
                    method: 'GET',
                    headers: { Accept: 'application/json' },
                    cache: 'no-store',
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
