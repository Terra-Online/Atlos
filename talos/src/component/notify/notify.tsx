import React, {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
} from 'react';
import Modal, { type ModalTabItem } from '@/component/modal/modal';
import { useAuthStore } from '@/store/auth';
import { useLocale, useTranslateGame, useTranslateUI } from '@/locale';
import {
    findMarkerById,
    MARKER_TYPE_DICT,
    type IMarkerData,
} from '@/data/marker';
import { SUBREGION_DICT } from '@/data/map';
import { formatRelativeTime, parseTimestamp } from '@/utils/timeFormat';
import { navigateToMarkerId } from '@/utils/navigation';
import { useDevice } from '@/utils/device';
import { openOemAuthModal } from '@/component/login/authEvents';
import { AccessButton } from '@/component/login/access';
import {
    getNotificationUnreadCounts,
    listNotifications,
    markAllNotificationsRead,
    markNotificationsRead,
    NOTIFICATION_CATEGORIES,
    notificationCategoryForType,
    type NotificationCategory,
    type NotificationItem,
    type NotificationLiveUpdate,
    type NotificationUnreadCounts,
} from '@/utils/notifyClient';
import NotificationIcon from '@/assets/logos/group.svg?react';
import CheckAllIcon from '@/assets/logos/collectall.svg?react';
import CommunityIcon from '@/assets/logos/reply.svg?react';
import SystemIcon from '@/assets/logos/announce.svg?react';
import GitHubLogo from '@/assets/images/UI/media/github.svg?react';
import DiscordLogo from '@/assets/images/UI/media/discord.svg?react';
import SklandLogo from '@/assets/images/UI/media/skland.svg?react';
import SkportLogo from '@/assets/images/UI/media/skport.svg?react';
import { LinearBlur } from 'progressive-blur';
import {
    formatNotificationMessage,
    type NotificationSubjectKind,
    type NotificationTemplateName,
} from './notificationMessage';
import {
    createNotificationReadBatcher,
    createNotificationVisibilityObserver,
    type NotificationReadBatcher,
} from './notificationRead';
import styles from './notify.module.scss';

interface NotifyProps {
    open: boolean;
    onClose: () => void;
    onChange?: (open: boolean) => void;
    onUnreadChange?: (unread: NotificationUnreadCounts) => void;
    liveUpdate?: NotificationLiveUpdate | null;
    syncVersion?: number;
}

interface CategoryFeed {
    items: NotificationItem[];
    nextCursor: string | null;
    loading: boolean;
    loadingMore: boolean;
    error: boolean;
}

interface SocialLink {
    icon: React.FC<React.SVGProps<SVGSVGElement>>;
    url: string;
    name: string;
    platform: 'discord' | 'github' | 'skland' | 'skport';
}

const EMPTY_UNREAD: NotificationUnreadCounts = {
    system: 0,
    community: 0,
    total: 0,
};

const emptyFeed = (): CategoryFeed => ({
    items: [],
    nextCursor: null,
    loading: false,
    loadingMore: false,
    error: false,
});

const SOCIAL_LINKS: SocialLink[] = [
    {
        icon: DiscordLogo,
        url: 'https://discord.gg/BFMAKZSUG7',
        name: 'Discord',
        platform: 'discord',
    },
    {
        icon: GitHubLogo,
        url: 'https://github.com/Terra-Online/Atlos',
        name: 'GitHub',
        platform: 'github',
    },
    {
        icon: SklandLogo,
        url: 'https://www.skland.com/profile?id=2730585909766',
        name: 'Skland',
        platform: 'skland',
    },
    {
        icon: SkportLogo,
        url: 'https://www.skport.com/profile?id=3182563593139&cate=2',
        name: 'Skport',
        platform: 'skport',
    },
];

const NotificationEmptyState = ({
    children,
}: {
    children: React.ReactNode;
}) => (
    <div className={styles.emptyState}>
        <div className={styles.emptyDivider} aria-hidden='true' />
        <p className={styles.emptyRule}>{children}</p>
    </div>
);

const interpolateSimpleNodes = (
    template: string,
    replacements: Record<string, React.ReactNode>,
): React.ReactNode[] =>
    template
        .split(/(\{[A-Za-z]+\})/g)
        .filter(Boolean)
        .map((part, index) => {
            const key =
                part.startsWith('{') && part.endsWith('}')
                    ? part.slice(1, -1)
                    : '';
            return (
                <React.Fragment key={`${part}:${index}`}>
                    {key && key in replacements ? replacements[key] : part}
                </React.Fragment>
            );
        });

const updateItemReadState = (
    items: NotificationItem[],
    id: string,
): NotificationItem[] => {
    const readAt = new Date().toISOString();
    return items.map((item) => {
        if (item.id === id) {
            return {
                ...item,
                readAt: item.readAt ?? readAt,
                messages: item.messages.map((message) => ({
                    ...message,
                    readAt: message.readAt ?? readAt,
                })),
            };
        }
        return {
            ...item,
            messages:
                item.messages.length > 0
                    ? updateItemReadState(item.messages, id)
                    : item.messages,
        };
    });
};

const mergeItems = (
    current: NotificationItem[],
    incoming: NotificationItem[],
): NotificationItem[] => {
    const ids = new Set(current.map((item) => item.id));
    return [...current, ...incoming.filter((item) => !ids.has(item.id))];
};

const notificationCreatedAtMs = (item: NotificationItem): number =>
    parseTimestamp(item.createdAt)?.getTime() ?? 0;

const upsertItem = (
    items: NotificationItem[],
    incoming: NotificationItem,
): NotificationItem[] =>
    [incoming, ...items.filter((item) => item.id !== incoming.id)].sort(
        (left, right) =>
            notificationCreatedAtMs(right) - notificationCreatedAtMs(left),
    );

const markerPromiseCache = new Map<string, Promise<IMarkerData | null>>();

const getNotificationMarker = (
    markerId: string,
): Promise<IMarkerData | null> => {
    const cached = markerPromiseCache.get(markerId);
    if (cached) return cached;
    const pending = findMarkerById(markerId);
    markerPromiseCache.set(markerId, pending);
    return pending;
};

const formatPointName = (
    name: string,
    area: string,
    locale: string,
): string => {
    const usesCjkPunctuation = /^(zh|ja|ko)(-|$)/i.test(locale);
    if (usesCjkPunctuation) return `「${area ? `${name}・${area}` : name}」`;
    const separator = /^ar(-|$)/i.test(locale) ? '، ' : ', ';
    return `(${area ? `${name}${separator}${area}` : name})`;
};

interface NotificationMessageProps {
    item: NotificationItem;
    onNavigate: (item: NotificationItem) => void;
}

const NotificationMessage = ({
    item,
    onNavigate,
}: NotificationMessageProps) => {
    const t = useTranslateUI();
    const tGame = useTranslateGame();
    const locale = useLocale();
    const markerId = item.target.markerId;
    const [marker, setMarker] = useState<IMarkerData | null>(null);
    const kind = item.payload.kind;
    const subjectKey: NotificationSubjectKind =
        kind === 'image'
            ? 'image'
            : kind === 'comment' ||
                notificationCategoryForType(item.type) === 'community'
              ? 'comment'
              : 'submission';
    let templateName: NotificationTemplateName = 'needsReview';
    if (item.type === 'system.submission.approved') templateName = 'approved';
    if (item.type === 'system.remove_request.resolved')
        templateName = 'removeResolved';
    if (item.type === 'community.comment.reply') templateName = 'reply';
    if (item.type === 'community.comment.vote') {
        templateName = 'vote';
    } else if (item.isMultiMsg) {
        templateName = 'multiple';
    }
    const template = t(`notification.types.${templateName}`);
    const translatedSubject = t(`notification.subject.${subjectKey}`);
    const poiType = item.target.poiType ?? marker?.type ?? '';
    const translatedPointName = poiType
        ? tGame(`markerType.key.${poiType}`)
        : '';
    const pointName =
        translatedPointName &&
        translatedPointName !== `markerType.key.${poiType}`
            ? translatedPointName
            : poiType;
    const isArchive = MARKER_TYPE_DICT[poiType]?.category.main === 'files';
    const subregion =
        !isArchive && marker ? SUBREGION_DICT[marker.subregId] : undefined;
    const regionCode = marker?.subregId.split('_')[0] ?? '';
    const subregionKey =
        subregion && regionCode
            ? `region.${regionCode}.sub.${subregion.name}.name`
            : '';
    const translatedSubregionName = subregionKey ? tGame(subregionKey) : '';
    const subregionName =
        translatedSubregionName && translatedSubregionName !== subregionKey
            ? translatedSubregionName
            : '';
    const pointLabel = pointName
        ? formatPointName(pointName, subregionName, locale)
        : '';
    const countValue = Number(item.payload.messageCount);
    const count =
        Number.isFinite(countValue) && countValue > 0
            ? Math.trunc(countValue)
            : Math.max(1, item.messages.length);

    useEffect(() => {
        let active = true;
        setMarker(null);
        if (!markerId)
            return () => {
                active = false;
            };
        void getNotificationMarker(markerId).then((nextMarker) => {
            if (active) setMarker(nextMarker);
        });
        return () => {
            active = false;
        };
    }, [markerId]);

    const canNavigate = Boolean(markerId) && !item.isMultiMsg;
    const renderSubject = (parts: React.ReactNode[]) =>
        canNavigate ? (
            <button
                type='button'
                className={styles.keyword}
                onClick={(event) => {
                    event.stopPropagation();
                    onNavigate(item);
                }}
            >
                {parts}
            </button>
        ) : (
            <span className={styles.keyword}>{parts}</span>
        );
    const renderPoint = (parts: React.ReactNode[]) =>
        pointLabel ? <span className={styles.pointName}>{parts}</span> : null;

    return (
        <span className={styles.messageText}>
            {React.Children.toArray(
                formatNotificationMessage({
                    template,
                    locale,
                    kind: subjectKey,
                    subject: translatedSubject,
                    point: pointLabel,
                    count,
                    renderSubject,
                    renderPoint,
                }),
            )}
        </span>
    );
};

interface NotificationCardProps {
    item: NotificationItem;
    expanded: boolean;
    onToggle: (item: NotificationItem) => void;
    onRead: (item: NotificationItem) => void;
    onNavigate: (item: NotificationItem, readItem?: NotificationItem) => void;
}

const NotificationCard = ({
    item,
    expanded,
    onToggle,
    onRead,
    onNavigate,
}: NotificationCardProps) => {
    const t = useTranslateUI();
    const locale = useLocale();
    const [collapsing, setCollapsing] = useState(false);
    const previousExpandedRef = useRef(expanded);
    const collapseTimerRef = useRef<number | undefined>(undefined);
    const createdAt = parseTimestamp(item.createdAt);
    const timeLabel = createdAt
        ? formatRelativeTime(createdAt, { locale })
        : '';

    useLayoutEffect(() => {
        const wasExpanded = previousExpandedRef.current;
        previousExpandedRef.current = expanded;

        if (collapseTimerRef.current !== undefined) {
            window.clearTimeout(collapseTimerRef.current);
            collapseTimerRef.current = undefined;
        }
        if (expanded) {
            setCollapsing(false);
            return undefined;
        }
        if (!wasExpanded) return undefined;

        setCollapsing(true);
        collapseTimerRef.current = window.setTimeout(() => {
            setCollapsing(false);
            collapseTimerRef.current = undefined;
        }, 320);
        return () => {
            if (collapseTimerRef.current !== undefined) {
                window.clearTimeout(collapseTimerRef.current);
                collapseTimerRef.current = undefined;
            }
        };
    }, [expanded]);

    return (
        <article
            className={styles.notificationCard}
            data-notification-id={item.id}
            data-type={item.type}
            data-expandable={item.isMultiMsg ? 'true' : 'false'}
            data-expanded={expanded ? 'true' : 'false'}
            data-collapsing={collapsing ? 'true' : 'false'}
            data-unread={item.readAt ? 'false' : 'true'}
            role={item.isMultiMsg ? 'button' : undefined}
            tabIndex={item.isMultiMsg ? 0 : undefined}
            aria-expanded={item.isMultiMsg ? expanded : undefined}
            onClick={() => (item.isMultiMsg ? onToggle(item) : onRead(item))}
            onKeyDown={(event) => {
                if (!item.isMultiMsg || event.target !== event.currentTarget)
                    return;
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                onToggle(item);
            }}
        >
            <div className={styles.cardBody}>
                <div className={styles.cardMessage}>
                    <NotificationMessage item={item} onNavigate={onNavigate} />
                </div>
            </div>
            {item.isMultiMsg && (
                <div
                    className={styles.clusterReveal}
                    aria-hidden={expanded ? undefined : true}
                >
                    <ul className={styles.clusterMessages}>
                        {item.messages.length > 0 ? (
                            item.messages.map((message) => (
                                <li
                                    className={styles.clusterMessage}
                                    key={message.id}
                                >
                                    <NotificationMessage
                                        item={message}
                                        onNavigate={(targetItem) =>
                                            onNavigate(targetItem, item)
                                        }
                                    />
                                </li>
                            ))
                        ) : (
                            <li className={styles.noClusterDetails}>
                                {t('notification.noDetails')}
                            </li>
                        )}
                    </ul>
                </div>
            )}
            <time className={styles.cardTime} dateTime={item.createdAt}>
                {timeLabel}
            </time>
        </article>
    );
};

const NotifyModal: React.FC<NotifyProps> = ({
    open,
    onClose,
    onChange,
    onUnreadChange,
    liveUpdate,
    syncVersion = 0,
}) => {
    const t = useTranslateUI();
    const { isMobile } = useDevice();
    const sessionUser = useAuthStore((state) => state.sessionUser);
    const sessionUid = sessionUser?.uid;
    const [activeCategory, setActiveCategory] =
        useState<NotificationCategory>('community');
    const [unread, setUnread] =
        useState<NotificationUnreadCounts>(EMPTY_UNREAD);
    const [feeds, setFeeds] = useState<
        Record<NotificationCategory, CategoryFeed>
    >({
        community: emptyFeed(),
        system: emptyFeed(),
    });
    const [expandedIds, setExpandedIds] = useState<Set<string>>(
        () => new Set(),
    );
    const [markingAll, setMarkingAll] = useState(false);
    const handledSyncVersionRef = useRef(syncVersion);
    const liveRevisionRef = useRef(0);
    const sessionRevisionRef = useRef(0);
    const readIdsRef = useRef(new Set<string>());
    const readBatcherRef =
        useRef<NotificationReadBatcher<NotificationCategory> | null>(null);
    const notificationListRef = useRef<HTMLDivElement | null>(null);
    const [isListScrolledBottom, setIsListScrolledBottom] = useState(true);

    const publishUnread = useCallback(
        (nextUnread: NotificationUnreadCounts) => {
            setUnread(nextUnread);
            onUnreadChange?.(nextUnread);
        },
        [onUnreadChange],
    );

    const loadCategory = useCallback(
        async (category: NotificationCategory, append = false) => {
            if (!sessionUid) return;
            const cursor = append ? feeds[category].nextCursor : null;
            const startLiveRevision = liveRevisionRef.current;
            const startSessionRevision = sessionRevisionRef.current;
            setFeeds((current) => ({
                ...current,
                [category]: {
                    ...current[category],
                    loading: !append,
                    loadingMore: append,
                    error: false,
                },
            }));
            try {
                const result = await listNotifications(category, {
                    cursor,
                    limit: 20,
                });
                if (sessionRevisionRef.current !== startSessionRevision) return;
                const receivedLiveUpdate =
                    liveRevisionRef.current !== startLiveRevision;
                setFeeds((current) => ({
                    ...current,
                    [category]: {
                        items:
                            append || receivedLiveUpdate
                                ? mergeItems(
                                      current[category].items,
                                      result.items,
                                  )
                                : result.items,
                        nextCursor: result.nextCursor,
                        loading: false,
                        loadingMore: false,
                        error: false,
                    },
                }));
                if (!receivedLiveUpdate) publishUnread(result.unread);
            } catch {
                if (sessionRevisionRef.current !== startSessionRevision) return;
                setFeeds((current) => ({
                    ...current,
                    [category]: {
                        ...current[category],
                        loading: false,
                        loadingMore: false,
                        error: true,
                    },
                }));
            }
        },
        [feeds, publishUnread, sessionUid],
    );

    useEffect(() => {
        sessionRevisionRef.current += 1;
        setFeeds({ community: emptyFeed(), system: emptyFeed() });
        setExpandedIds(new Set());
        readIdsRef.current.clear();
        liveRevisionRef.current = 0;
        if (!sessionUid) publishUnread(EMPTY_UNREAD);
    }, [publishUnread, sessionUid]);

    useEffect(() => {
        if (!sessionUid) return undefined;
        const sessionRevision = sessionRevisionRef.current;
        const batcher = createNotificationReadBatcher({
            send: markNotificationsRead,
            onResult: (nextUnread) => {
                if (sessionRevisionRef.current === sessionRevision)
                    publishUnread(nextUnread);
            },
        });
        readBatcherRef.current = batcher;
        return () => {
            batcher.dispose();
            if (readBatcherRef.current === batcher)
                readBatcherRef.current = null;
        };
    }, [publishUnread, sessionUid]);

    useEffect(() => {
        if (!open) return;
        if (!sessionUid) {
            setFeeds({ community: emptyFeed(), system: emptyFeed() });
            publishUnread(EMPTY_UNREAD);
            return;
        }
        void Promise.all(
            NOTIFICATION_CATEGORIES.map((category) => loadCategory(category)),
        );
        // Initial loads do not consume a cursor from the captured feed state.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, sessionUid]);

    useEffect(() => {
        if (!liveUpdate) return;
        const category = notificationCategoryForType(
            liveUpdate.notification.type,
        );
        readIdsRef.current.delete(liveUpdate.notification.id);
        liveRevisionRef.current += 1;
        publishUnread(liveUpdate.unread);
        setFeeds((current) => ({
            ...current,
            [category]: {
                ...current[category],
                items: upsertItem(
                    current[category].items,
                    liveUpdate.notification,
                ),
            },
        }));
    }, [liveUpdate, publishUnread]);

    useEffect(() => {
        if (!open) {
            readIdsRef.current.clear();
            handledSyncVersionRef.current = syncVersion;
            return;
        }
        if (syncVersion <= handledSyncVersionRef.current) return;
        handledSyncVersionRef.current = syncVersion;
        void Promise.all(
            NOTIFICATION_CATEGORIES.map((category) => loadCategory(category)),
        );
    }, [loadCategory, open, syncVersion]);

    const handleRead = useCallback(
        (item: NotificationItem) => {
            if (
                item.readAt ||
                !sessionUser ||
                markingAll ||
                readIdsRef.current.has(item.id)
            )
                return;
            readIdsRef.current.add(item.id);
            const category = notificationCategoryForType(item.type);
            setFeeds((current) => ({
                ...current,
                [category]: {
                    ...current[category],
                    items: updateItemReadState(
                        current[category].items,
                        item.id,
                    ),
                },
            }));
            const batcher = readBatcherRef.current;
            if (batcher) batcher.enqueue(category, item.id);
            else
                void markNotificationsRead(category, [item.id])
                    .then(publishUnread)
                    .catch(() => undefined);
        },
        [markingAll, publishUnread, sessionUser],
    );

    const handleToggle = useCallback(
        (item: NotificationItem) => {
            handleRead(item);
            setExpandedIds((current) => {
                const next = new Set(current);
                if (next.has(item.id)) next.delete(item.id);
                else next.add(item.id);
                return next;
            });
        },
        [handleRead],
    );

    const handleNavigate = useCallback(
        (item: NotificationItem, readItem = item) => {
            const markerId = item.target.markerId;
            if (!markerId) return;
            handleRead(readItem);
            onClose();
            onChange?.(false);
            void navigateToMarkerId(markerId);
        },
        [handleRead, onChange, onClose],
    );

    const handleOpenAuth = useCallback(() => {
        onClose();
        onChange?.(false);
        openOemAuthModal('login');
    }, [onChange, onClose]);

    const handleMarkAll = useCallback(async () => {
        if (!sessionUser || unread.total === 0 || markingAll) return;
        setMarkingAll(true);
        try {
            await readBatcherRef.current?.flush();
            await Promise.all([
                markAllNotificationsRead('community'),
                markAllNotificationsRead('system'),
            ]);
            const nextUnread = await getNotificationUnreadCounts();
            setFeeds((current) => ({
                community: {
                    ...current.community,
                    items: current.community.items.map((item) => ({
                        ...item,
                        readAt: item.readAt ?? new Date().toISOString(),
                    })),
                },
                system: {
                    ...current.system,
                    items: current.system.items.map((item) => ({
                        ...item,
                        readAt: item.readAt ?? new Date().toISOString(),
                    })),
                },
            }));
            publishUnread(nextUnread);
        } catch {
            // Keep the current unread state when either category update fails.
        } finally {
            setMarkingAll(false);
        }
    }, [markingAll, publishUnread, sessionUser, unread.total]);

    const tabs = useMemo<ModalTabItem[]>(
        () => [
            {
                key: 'community',
                icon: <CommunityIcon />,
                title:
                    unread.community > 0
                        ? `${t('notification.tabs.community')} (${unread.community})`
                        : t('notification.tabs.community'),
            },
            {
                key: 'system',
                icon: <SystemIcon />,
                title:
                    unread.system > 0
                        ? `${t('notification.tabs.system')} (${unread.system})`
                        : t('notification.tabs.system'),
            },
        ],
        [t, unread.community, unread.system],
    );
    const activeFeed = feeds[activeCategory];
    const hasMessages = activeFeed.items.length > 0;
    const updateListScrollState = useCallback(() => {
        const list = notificationListRef.current;
        if (!list) return;
        const atBottom =
            list.scrollTop + list.clientHeight >= list.scrollHeight - 1;
        setIsListScrolledBottom((current) =>
            current === atBottom ? current : atBottom,
        );
    }, []);

    useLayoutEffect(() => {
        if (!open) return undefined;
        const list = notificationListRef.current;
        if (!list) return undefined;

        const frame = window.requestAnimationFrame(updateListScrollState);
        list.addEventListener('transitionend', updateListScrollState);
        const resizeObserver = new ResizeObserver(updateListScrollState);
        resizeObserver.observe(list);
        return () => {
            window.cancelAnimationFrame(frame);
            list.removeEventListener('transitionend', updateListScrollState);
            resizeObserver.disconnect();
        };
    }, [
        activeCategory,
        activeFeed.items,
        expandedIds,
        open,
        updateListScrollState,
    ]);

    useEffect(() => {
        if (!open || !sessionUser || activeFeed.loading || markingAll)
            return undefined;
        const list = notificationListRef.current;
        if (!list || typeof IntersectionObserver === 'undefined')
            return undefined;

        const unreadItems = new Map(
            activeFeed.items
                .filter((item) => !item.readAt)
                .map((item) => [item.id, item]),
        );
        const visibilityObserver = createNotificationVisibilityObserver({
            root: list,
            onRead: (id) => {
                const item = unreadItems.get(id);
                if (item) handleRead(item);
            },
        });
        list.querySelectorAll<HTMLElement>(
            '[data-notification-id][data-unread="true"]',
        ).forEach((element) => {
            const id = element.dataset.notificationId;
            if (id && unreadItems.has(id))
                visibilityObserver.observe(element, id);
        });

        return () => visibilityObserver.disconnect();
    }, [
        activeCategory,
        activeFeed.items,
        activeFeed.loading,
        handleRead,
        markingAll,
        open,
        sessionUser,
    ]);

    return (
        <Modal
            open={open}
            size={isMobile ? 'full' : 'l'}
            onClose={onClose}
            onChange={onChange}
            title={t('notification.title')}
            icon={<NotificationIcon aria-hidden='true' />}
            iconScale={0.9}
            tabs={tabs}
            activeTabKey={activeCategory}
            onTabChange={(key) => {
                if (key === 'system' || key === 'community')
                    setActiveCategory(key);
            }}
            quickAction={{
                icon: <CheckAllIcon />,
                label: t('notification.markAllRead'),
                disabled: !sessionUser || unread.total === 0 || markingAll,
                active: markingAll,
                onClick: () => void handleMarkAll(),
            }}
            tabsAriaLabel={t('notification.title')}
            contentClassName={`${styles.notifyContent} ${hasMessages ? styles.withMessages : ''}`}
        >
            <div className={styles.notifyRoot}>
                <div className={styles.listViewport}>
                    <div
                        className={styles.notificationList}
                        role='tabpanel'
                        ref={notificationListRef}
                        onScroll={updateListScrollState}
                    >
                        {!sessionUser ? (
                            <NotificationEmptyState>
                                {interpolateSimpleNodes(
                                    t('notification.guest'),
                                    {
                                        account: (
                                            <button
                                                type='button'
                                                className={styles.emptyAction}
                                                onClick={handleOpenAuth}
                                            >
                                                {t('notification.account')}
                                            </button>
                                        ),
                                    },
                                )}
                            </NotificationEmptyState>
                        ) : activeFeed.loading ? (
                            <p className={styles.statusState}>
                                {t('common.loading')}
                            </p>
                        ) : activeFeed.error &&
                          activeFeed.items.length === 0 ? (
                            <p className={styles.statusState}>
                                {t('notification.loadError')}
                            </p>
                        ) : activeFeed.items.length === 0 ? (
                            <NotificationEmptyState>
                                {t('notification.empty')}
                            </NotificationEmptyState>
                        ) : (
                            <>
                                {activeFeed.items.map((item) => (
                                    <NotificationCard
                                        key={item.id}
                                        item={item}
                                        expanded={expandedIds.has(item.id)}
                                        onToggle={handleToggle}
                                        onRead={handleRead}
                                        onNavigate={handleNavigate}
                                    />
                                ))}
                                {activeFeed.nextCursor && (
                                    <div className={styles.loadMore}>
                                        <AccessButton
                                            label={
                                                activeFeed.loadingMore
                                                    ? t('common.loading')
                                                    : t('notification.loadMore')
                                            }
                                            disabled={activeFeed.loadingMore}
                                            onClick={() =>
                                                void loadCategory(
                                                    activeCategory,
                                                    true,
                                                )
                                            }
                                        />
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                    <LinearBlur
                        side='bottom'
                        strength={6}
                        className={`${styles.listBottomBlur} ${!isListScrolledBottom ? styles.visible : ''}`}
                    />
                </div>

                <div className={styles.supportDivider}>
                    <span>{t('notification.support')}</span>
                </div>
                <nav
                    className={styles.socialLinks}
                    aria-label={t('notification.support')}
                >
                    {SOCIAL_LINKS.map((link) => {
                        const Icon = link.icon;
                        return (
                            <a
                                key={link.name}
                                href={link.url}
                                target='_blank'
                                rel='noopener noreferrer'
                                aria-label={`${t('notification.visit')} ${link.name}`}
                                data-platform={link.platform}
                            >
                                <Icon aria-hidden='true' />
                            </a>
                        );
                    })}
                </nav>
            </div>
        </Modal>
    );
};

export default React.memo(NotifyModal);
