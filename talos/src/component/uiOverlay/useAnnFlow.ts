import { type Dispatch, type SetStateAction, useEffect, useState } from 'react';
import {
<<<<<<< feat/locator-sync
    type AnnouncementApiItem,
    fetchAnnouncementLatestMeta,
    fetchAnnouncements,
    getAnnouncementDebugMode,
    getAnnouncementLastRead,
    getAnnouncementLocaleCache,
    setAnnouncementLocaleCache,
} from '@/utils/announcement';

const getHasUnreadAnnouncement = (latestId: string | null, latestDate?: string): boolean => {
    const lastRead = getAnnouncementLastRead();
    const lastReadId = lastRead.id;
=======
    ANNOUNCEMENT_LAST_READ_DATE_KEY,
    ANNOUNCEMENT_LAST_READ_ID_KEY,
    type AnnouncementApiItem,
    fetchAnnouncementLatestMeta,
    fetchAnnouncements,
    getAnnouncementBodyCacheStorageKey,
    getAnnouncementDebugMode,
    getAnnouncementLatestIdStorageKey,
    getAnnouncementVersionStorageKey,
} from '@/utils/announcement';

const isAnnouncementApiItem = (value: unknown): value is AnnouncementApiItem => {
    if (typeof value !== 'object' || value === null) return false;
    const item = value as Partial<AnnouncementApiItem>;
    return (
        typeof item.id === 'string'
        && typeof item.title === 'string'
        && typeof item.description === 'string'
        && typeof item.content === 'string'
    );
};

const parseCachedAnnouncements = (raw: string | null): AnnouncementApiItem[] => {
    if (!raw) return [];
    try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter(isAnnouncementApiItem);
    } catch {
        return [];
    }
};

const getHasUnreadAnnouncement = (latestId: string | null, latestDate?: string): boolean => {
    const lastReadId = localStorage.getItem(ANNOUNCEMENT_LAST_READ_ID_KEY);
>>>>>>> main
    if (latestId) {
        if (lastReadId) {
            return lastReadId !== latestId;
        }
<<<<<<< feat/locator-sync
        const lastReadDate = lastRead.date;
=======
        const lastReadDate = localStorage.getItem(ANNOUNCEMENT_LAST_READ_DATE_KEY);
>>>>>>> main
        if (lastReadDate && latestDate) {
            return new Date(latestDate) > new Date(lastReadDate);
        }
        return true;
    }

<<<<<<< feat/locator-sync
    const lastReadDate = lastRead.date;
=======
    const lastReadDate = localStorage.getItem(ANNOUNCEMENT_LAST_READ_DATE_KEY);
>>>>>>> main
    if (!lastReadDate || !latestDate) {
        return false;
    }
    return new Date(latestDate) > new Date(lastReadDate);
};

interface UseAnnouncementFlowResult {
    announcements: AnnouncementApiItem[];
    hasUnreadAnnouncement: boolean;
    setHasUnreadAnnouncement: Dispatch<SetStateAction<boolean>>;
    announcementChecked: boolean;
}

export const useAnnouncementFlow = (locale?: string): UseAnnouncementFlowResult => {
    const [announcements, setAnnouncements] = useState<AnnouncementApiItem[]>([]);
    const [hasUnreadAnnouncement, setHasUnreadAnnouncement] = useState(false);
    const [announcementChecked, setAnnouncementChecked] = useState(false);

    useEffect(() => {
        let cancelled = false;
        setAnnouncementChecked(false);

        const checkUnread = async () => {
            const debugMode = getAnnouncementDebugMode();
<<<<<<< feat/locator-sync
            const cache = getAnnouncementLocaleCache(locale);
            const cachedAnnouncements = cache.body ?? [];
=======
            const latestIdStorageKey = getAnnouncementLatestIdStorageKey(locale);
            const bodyCacheStorageKey = getAnnouncementBodyCacheStorageKey(locale);
            const versionStorageKey = getAnnouncementVersionStorageKey(locale);
            const cachedAnnouncements = parseCachedAnnouncements(localStorage.getItem(bodyCacheStorageKey));
>>>>>>> main

            try {
                const latestMeta = await fetchAnnouncementLatestMeta(locale);
                const remoteLatestId = latestMeta?.latestId ?? null;
                const remoteVersion = latestMeta?.version ?? '';
<<<<<<< feat/locator-sync
                const localLatestId = cache.latestId ?? null;
                const localVersion = cache.version ?? '';
=======
                const localLatestId = localStorage.getItem(latestIdStorageKey);
                const localVersion = localStorage.getItem(versionStorageKey);
>>>>>>> main
                const canUseCachedBody = !!remoteLatestId
                    && remoteLatestId === localLatestId
                    && !!remoteVersion
                    && remoteVersion === localVersion
                    && cachedAnnouncements.length > 0;

                let data = cachedAnnouncements;
                if (!canUseCachedBody) {
                    data = await fetchAnnouncements(locale);
<<<<<<< feat/locator-sync

                    const fetchedLatestId = data[0]?.id ?? remoteLatestId;
                    setAnnouncementLocaleCache(locale, {
                        body: data,
                        latestId: fetchedLatestId ?? null,
                        version: remoteVersion,
                    });
                } else {
                    setAnnouncementLocaleCache(locale, {
                        latestId: remoteLatestId,
                        version: remoteVersion,
                    });
=======
                    localStorage.setItem(bodyCacheStorageKey, JSON.stringify(data));

                    const fetchedLatestId = data[0]?.id ?? remoteLatestId;
                    if (fetchedLatestId) {
                        localStorage.setItem(latestIdStorageKey, fetchedLatestId);
                    } else {
                        localStorage.removeItem(latestIdStorageKey);
                    }

                    if (remoteVersion) {
                        localStorage.setItem(versionStorageKey, remoteVersion);
                    } else {
                        localStorage.removeItem(versionStorageKey);
                    }
                } else {
                    if (remoteLatestId) {
                        localStorage.setItem(latestIdStorageKey, remoteLatestId);
                    }
                    if (remoteVersion) {
                        localStorage.setItem(versionStorageKey, remoteVersion);
                    }
>>>>>>> main
                }

                if (!cancelled) {
                    setAnnouncements(data);
                    const effectiveLatestId = remoteLatestId ?? data[0]?.id ?? null;
                    const hasUnread = getHasUnreadAnnouncement(effectiveLatestId, data[0]?.date);
                    setHasUnreadAnnouncement(debugMode === 'force-unread' || hasUnread);
                }
            } catch (error) {
                if (!cancelled) {
                    setAnnouncements(cachedAnnouncements);
<<<<<<< feat/locator-sync
                    const cachedLatestId = cachedAnnouncements[0]?.id ?? cache.latestId ?? null;
=======
                    const cachedLatestId = cachedAnnouncements[0]?.id ?? localStorage.getItem(latestIdStorageKey);
>>>>>>> main
                    const hasUnread = getHasUnreadAnnouncement(cachedLatestId, cachedAnnouncements[0]?.date);
                    setHasUnreadAnnouncement(debugMode === 'force-unread' || hasUnread);
                }
                console.error('Failed to check announcements:', error);
            } finally {
                if (!cancelled) {
                    setAnnouncementChecked(true);
                }
            }
        };

        void checkUnread();

        return () => {
            cancelled = true;
        };
    }, [locale]);

    return {
        announcements,
        hasUnreadAnnouncement,
        setHasUnreadAnnouncement,
        announcementChecked,
    };
};
