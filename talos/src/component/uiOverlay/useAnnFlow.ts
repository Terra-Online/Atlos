import { type Dispatch, type SetStateAction, useEffect, useState } from 'react';
import {
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
    if (latestId) {
        if (lastReadId) {
            return lastReadId !== latestId;
        }
        const lastReadDate = lastRead.date;
        if (lastReadDate && latestDate) {
            return new Date(latestDate) > new Date(lastReadDate);
        }
        return true;
    }

    const lastReadDate = lastRead.date;
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
            const cache = getAnnouncementLocaleCache(locale);
            const cachedAnnouncements = cache.body ?? [];

            try {
                const latestMeta = await fetchAnnouncementLatestMeta(locale);
                const remoteLatestId = latestMeta?.latestId ?? null;
                const remoteVersion = latestMeta?.version ?? '';
                const localLatestId = cache.latestId ?? null;
                const localVersion = cache.version ?? '';
                const canUseCachedBody = !!remoteLatestId
                    && remoteLatestId === localLatestId
                    && !!remoteVersion
                    && remoteVersion === localVersion
                    && cachedAnnouncements.length > 0;

                let data = cachedAnnouncements;
                if (!canUseCachedBody) {
                    data = await fetchAnnouncements(locale);

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
                    const cachedLatestId = cachedAnnouncements[0]?.id ?? cache.latestId ?? null;
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
