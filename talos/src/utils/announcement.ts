export const getAnnouncementApiBase = (): string => {
    const envBase = (import.meta.env.VITE_ANNOUNCEMENT_API_BASE as string | undefined)?.trim();
    if (envBase) return envBase.replace(/\/$/, '');

    if (typeof window !== 'undefined') {
        const host = window.location.hostname;
        if (host === 'localhost' || host === '127.0.0.1') {
            return 'http://localhost:3000';
        }
    }

    return 'https://blog.opendfieldmap.org';
};

export const getAnnouncementApiUrl = (): string => `${getAnnouncementApiBase()}/api/announcements`;

export interface AnnouncementApiItem {
    id?: string;
    title?: string;
    description?: string;
    content?: string;
    date?: string;
}

const REMOTE_BASE = 'https://blog.opendfieldmap.org';
const LOCAL_BASE = 'http://localhost:3000';

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

const toApiUrl = (base: string): string => {
    const url = `${base.replace(/\/$/, '')}/api/announcements`;
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}_=${Date.now()}`;
};

const isAnnouncementArray = (value: unknown): value is AnnouncementApiItem[] => {
    return Array.isArray(value);
};

export const fetchAnnouncements = async (): Promise<AnnouncementApiItem[]> => {
    const bases = getAnnouncementApiBases();
    let firstEmpty: AnnouncementApiItem[] | null = null;

    for (const base of bases) {
        try {
            const response = await fetch(toApiUrl(base), {
                method: 'GET',
                headers: { Accept: 'application/json' },
                cache: 'no-store',
            });
            if (!response.ok) continue;

            const json: unknown = await response.json();
            const items = isAnnouncementArray(json) ? json : [];
            if (items.length > 0) {
                return items;
            }
            if (firstEmpty === null) {
                firstEmpty = items;
            }
        } catch {
            // Try next candidate base.
        }
    }

    return firstEmpty ?? [];
};
