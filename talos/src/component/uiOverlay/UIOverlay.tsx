import React, { lazy, Suspense, useEffect, useState } from 'react';
import L from 'leaflet';
import styles from './UIOverlay.module.scss';

import LanguageModal from '@/component/language/language';
import NotifyModal from '@/component/notify/notify';
import ToSModal from '@/component/tos/tos';
import SettingsModal from '@/component/settings/settings';
import Scale from '@/component/scale/scale';
import { HeadBar, HeadItem } from '@/component/headBar/headBar';
import { RegionContainer } from '@/component/regSwitch/regSwitch';
import { LayerSwitch } from '@/component/layerSwitch/layerSwitch';
import { LocatorButton } from '@/component/locator';
import { Detail } from '@/component/detail/detail';
import FilterListDesktop from '@/component/filterList/filterList.desktop';
import {
    useSetIsUserGuideOpen,
    useMobileDrawerSnapIndex,
    useIsUserGuideOpen,
    useUiPrefsStore,
} from '@/store/uiPrefs';

import { useLocale, useTranslateUI } from '@/locale';
import { useDevice } from '@/utils/device';
import { initTheme, cleanupTheme, toggleTheme } from '@/utils/theme';
import { useAppPictureInPicture } from '@/component/scale/pip';
import { Shortcut } from '@/component/shortcut';
import { modKey } from '@/component/settings/shortcuts';
import { useAuthStore } from '@/store/auth';
import {
    getNotificationUnreadCounts,
    subscribeNotificationLive,
    type NotificationLiveUpdate,
    type NotificationUnreadCounts,
} from '@/utils/notifyClient';

import ToS from '../../assets/logos/tos.svg?react';
import hideUI from '../../assets/logos/hideUI.svg?react';
import NotificationIcon from '../../assets/logos/group.svg?react';
import Darkmode from '../../assets/logos/darkmode.svg?react';
import i18n from '../../assets/logos/i18n.svg?react';
import Guide from '../../assets/logos/guide.svg?react';
import SettingsIcon from '../../assets/logos/settings.svg?react';
import AnnouncementIcon from '../../assets/logos/announce.svg?react';
import { useAnnouncementFlow } from './useAnnFlow';
import { shouldSuppressInitialAutoOverlays } from '@/utils/url/apply';

const AnnouncementModal = lazy(() => import('@/component/announcement/announcement'));

interface UIOverlayProps {
    map?: L.Map;
    isSidebarOpen: boolean;
    visible?: boolean;
    showVisibilityControl?: boolean;
    onToggleUI?: () => void;
    userGuideReady?: boolean;
}

const UIOverlay: React.FC<UIOverlayProps> = ({
    map,
    isSidebarOpen,
    visible = true,
    showVisibilityControl = true,
    onToggleUI,
    userGuideReady = false,
}) => {
    const t = useTranslateUI();
    const locale = useLocale();
    const [langOpen, setLangOpen] = useState(false);
    const [notifyOpen, setNotifyOpen] = useState(false);
    const [storageOpen, setStorageOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [announcementOpen, setAnnouncementOpen] = useState(false);
    const [announcementMounted, setAnnouncementMounted] = useState(false);
    const {
        announcements,
        hasUnreadAnnouncement,
        setHasUnreadAnnouncement,
        announcementChecked,
    } = useAnnouncementFlow(locale);
    const { isMobile } = useDevice();
    const sessionUser = useAuthStore((state) => state.sessionUser);
    const sessionUid = sessionUser?.uid;
    const [notificationUnread, setNotificationUnread] = useState<NotificationUnreadCounts>({
        system: 0,
        community: 0,
        total: 0,
    });
    const [notificationLiveUpdate, setNotificationLiveUpdate] = useState<NotificationLiveUpdate | null>(null);
    const [notificationSyncVersion, setNotificationSyncVersion] = useState(0);
    const pictureInPicture = useAppPictureInPicture(map);
    const setIsUserGuideOpen = useSetIsUserGuideOpen();
    const isUserGuideOpen = useIsUserGuideOpen();
    const setIsAnnouncementOpen = useUiPrefsStore((s) => s.setIsAnnouncementOpen);
    const setAnnouncementFlowReady = useUiPrefsStore((s) => s.setAnnouncementFlowReady);
    const mobileDrawerSnapIndex = useMobileDrawerSnapIndex();
    const [autoOpenedOnce, setAutoOpenedOnce] = useState(false);
    const [suppressInitialAutoOpen] = useState(shouldSuppressInitialAutoOverlays);

    useEffect(() => {
        setAnnouncementFlowReady(false);
    }, [locale, setAnnouncementFlowReady]);

    useEffect(() => {
        if (!visible) return;
        if (!announcementChecked) return;
        if (!userGuideReady) return;
        if (isUserGuideOpen) return;

        if (suppressInitialAutoOpen) {
            setAnnouncementFlowReady(true);
            return;
        }

        if (hasUnreadAnnouncement && !autoOpenedOnce) {
            setAnnouncementOpen(true);
            setIsAnnouncementOpen(true);
            setAutoOpenedOnce(true);
            return;
        }

        setAnnouncementFlowReady(true);
    }, [visible, announcementChecked, userGuideReady, isUserGuideOpen, suppressInitialAutoOpen, hasUnreadAnnouncement, autoOpenedOnce, setAnnouncementFlowReady, setIsAnnouncementOpen]);

    const handleReset = () => {
        setStorageOpen(true);
    };

    const handleHideUI = () => {
        onToggleUI?.();
    };
    const handleNotification = () => setNotifyOpen(true);

    useEffect(() => {
        if (!sessionUid) {
            setNotificationUnread({ system: 0, community: 0, total: 0 });
            setNotificationLiveUpdate(null);
            return;
        }
        let disposed = false;
        let unreadRevision = 0;
        const syncUnread = () => {
            const requestRevision = unreadRevision;
            void getNotificationUnreadCounts()
                .then((unread) => {
                    if (!disposed && unreadRevision === requestRevision)
                        setNotificationUnread(unread);
                })
                .catch(() => undefined);
        };
        syncUnread();
        const unsubscribe = subscribeNotificationLive({
            onUpdate: (update) => {
                if (disposed) return;
                unreadRevision += 1;
                setNotificationUnread(update.unread);
                setNotificationLiveUpdate(update);
            },
            onReady: (unread) => {
                if (disposed) return;
                unreadRevision += 1;
                setNotificationUnread(unread);
            },
            onOpen: () => {
                if (disposed) return;
                setNotificationSyncVersion((version) => version + 1);
            },
        });
        return () => {
            disposed = true;
            unsubscribe();
        };
    }, [sessionUid]);

    const [isDark, setIsDark] = useState(false);

    useEffect(() => {
        initTheme();
        setIsDark(document.documentElement.getAttribute('data-theme') === 'dark');
        return () => cleanupTheme();
    }, []);

    const handleDarkMode = () => {
        toggleTheme();
        setIsDark((prev) => !prev);
    };
    const handleLanguage = () => setLangOpen(true);
    const handleHelp = () => setIsUserGuideOpen(true);
    const handleSettings = () => setSettingsOpen(true);
    const handleAnnouncement = () => setAnnouncementOpen(true);
    const layoutSidebarOpen = !isMobile && isSidebarOpen;
    const fullModalActionsDisabled = pictureInPicture.active;
    const hideUIShortcutKeys = [
        { label: modKey(), variant: 'mod' as const },
        { label: 'H' },
    ];
    const hideUITooltip = (
        <span className={styles.shortcutTooltip}>
            <span>{t('headbar.hideUI')}{'\u2002'}</span>
            <Shortcut keys={hideUIShortcutKeys} scale={0.72} />
        </span>
    );

    useEffect(() => {
        if (announcementOpen) {
            setAnnouncementMounted(true);
        }
    }, [announcementOpen]);

    useEffect(() => {
        setIsAnnouncementOpen(announcementOpen);
        if (!announcementOpen && announcementChecked && userGuideReady) {
            setAnnouncementFlowReady(true);
        }
    }, [announcementOpen, announcementChecked, userGuideReady, setIsAnnouncementOpen, setAnnouncementFlowReady]);

    useEffect(() => {
        if (visible) return;
        // UserGuide pauses itself while the UI is hidden and resumes at the same step.
        setLangOpen(false);
        setNotifyOpen(false);
        setStorageOpen(false);
        setSettingsOpen(false);
        setAnnouncementOpen(false);
    }, [visible]);

    return (
        <div
            className={`${styles.uiOverlay} ${isMobile ? styles.mobile : ''} ${layoutSidebarOpen ? styles.sidebarOpen : ''}`}
        >
            {/* Headbar */}
            {(visible || showVisibilityControl) && (
                <div className={styles.headbarHost}>
                    <HeadBar compact={!visible}>
                        <HeadItem
                            icon={ToS}
                            onClick={handleReset}
                            tooltip={t('headbar.tos')}
                            disabled={fullModalActionsDisabled}
                            guideKey='tos'
                        />
                        <HeadItem
                            icon={hideUI}
                            onClick={handleHideUI}
                            tooltip={hideUITooltip}
                            ariaLabel={`${t('headbar.hideUI')} (${modKey()}+H)`}
                            guideKey='hide-ui'
                        />
                        <HeadItem
                            icon={NotificationIcon}
                            onClick={handleNotification}
                            tooltip={t('headbar.notification')}
                            badge={notificationUnread.total > 0}
                            guideKey='notify'
                        />
                        <HeadItem
                            icon={Darkmode}
                            onClick={handleDarkMode}
                            tooltip={isDark ? t('headbar.lightmode') : t('headbar.darkmode')}
                            guideKey='dark-mode'
                        />
                        <HeadItem
                            icon={i18n}
                            onClick={handleLanguage}
                            tooltip={t('headbar.language')}
                            guideKey='language'
                        />
                        <HeadItem
                            icon={Guide}
                            onClick={handleHelp}
                            tooltip={t('headbar.help')}
                            disabled={fullModalActionsDisabled}
                            guideKey='help'
                        />
                        <HeadItem
                            icon={AnnouncementIcon}
                            onClick={handleAnnouncement}
                            tooltip={t('headbar.announcement')}
                            badge={hasUnreadAnnouncement}
                            disabled={fullModalActionsDisabled}
                            guideKey='announcement'
                        />
                        <HeadItem
                            icon={SettingsIcon}
                            onClick={handleSettings}
                            tooltip={t('headbar.settings')}
                            guideKey='settings'
                        />
                    </HeadBar>
                </div>
            )}

            <div
                className={`${styles.overlayContent} ${!visible ? styles.hidden : ''}`}
                aria-hidden={!visible}
                inert={!visible}
            >
                {/* Scale Component */}
                {map && <Scale map={map} />}

                {/* Switch Area: wrap both Region and Layer switches */}
                {!isMobile && (
                    <div className={styles.switchArea}>
                        <RegionContainer isSidebarOpen={layoutSidebarOpen} />
                        <LayerSwitch isSidebarOpen={layoutSidebarOpen} />
                        <LocatorButton variant="desktop" isSidebarOpen={layoutSidebarOpen} />
                    </div>
                )}
                {isMobile && (
                    <div className={styles.switchArea} data-snap={mobileDrawerSnapIndex ?? 0}>
                        <RegionContainer isSidebarOpen={false} />
                        <LayerSwitch isSidebarOpen={false} />
                    </div>
                )}
                {isMobile && <LocatorButton variant="mobile" />}

                {/* Detail Panel: hide on mobile (rendered inside SideBarMobile) */}
                {!isMobile && <Detail />}

                {/* Filter List: hide on mobile (rendered inside SideBarMobile) */}
                {!isMobile && <FilterListDesktop isSidebarOpen={isSidebarOpen} />}
            </div>

            {/* Language Modal */}
            <LanguageModal
                open={langOpen}
                onClose={() => setLangOpen(false)}
                onChange={(o) => setLangOpen(o)}
                onSelected={(lang) => {
                    console.log('Language switched to:', lang);
                }}
            />

            {/* Notification Modal */}
            <NotifyModal
                open={notifyOpen}
                onClose={() => setNotifyOpen(false)}
                onChange={(o) => setNotifyOpen(o)}
                onUnreadChange={setNotificationUnread}
                liveUpdate={notificationLiveUpdate}
                syncVersion={notificationSyncVersion}
            />

            {/* Storage Modal */}
            <ToSModal
                open={storageOpen}
                onClose={() => setStorageOpen(false)}
                onChange={(o) => setStorageOpen(o)}
            />

            {/* Settings Modal */}
            <SettingsModal
                open={settingsOpen}
                onClose={() => setSettingsOpen(false)}
                onChange={(o) => setSettingsOpen(o)}
            />

            {/* Announcement Modal */}
            {announcementMounted && (
                <Suspense fallback={null}>
                    <AnnouncementModal
                        open={announcementOpen}
                        onClose={() => setAnnouncementOpen(false)}
                        onChange={(o) => setAnnouncementOpen(o)}
                        onHasUnread={setHasUnreadAnnouncement}
                        announcements={announcements}
                    />
                </Suspense>
            )}
        </div>
    );
};

export default UIOverlay;
