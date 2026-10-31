import React, { useEffect, useState } from 'react';
import { useRetryImport } from '@/lib/dom/useRetryImport';
import ErrorBoundary from '@/component/shared/ErrorBoundary';
import Modal from '@/component/modal/modal';
import L from 'leaflet';
import styles from '@/pages/uiOverlay/UIOverlay.module.scss';

import LanguageModal from '@/component/shared/language/language';
import NotifyModal from '@/pages/notify/notify';
import SettingsModal from '@/pages/settings/settings';
import Scale from '@/pages/scale/scale';
import { HeadBar, HeadItem } from '@/component/shared/siteShell/headBar/headBar';
import { RegionContainer } from '@/pages/regSwitch/regSwitch';
import { LayerSwitch } from '@/pages/layerSwitch/layerSwitch';
import { LocatorButton } from '@/pages/locator';
import { Detail } from '@/pages/detail/detail';
import FilterListDesktop from '@/pages/filterList/filterList.desktop';
import {
    useSetIsUserGuideOpen,
    useMobileDrawerSnapIndex,
    useIsUserGuideOpen,
    useUiPrefsStore,
} from '@/store/uiPrefs';

import { useLocale, useTranslateUI } from '@/locale';
import { useDevice } from '@/platform/device';
import { initTheme, cleanupTheme, toggleTheme } from '@/platform/theme';
import { useAppPictureInPicture } from '@/platform/pictureInPicture';
import { Shortcut } from '@/component/shortcut';
import { modKey } from '@/platform/shortcuts';
import { openOemAccountModal } from '@/component/shared/account/authEvents';
import { useAuthStore } from '@/store/auth';
import {
    subscribeNotificationLive,
    type NotificationLiveUpdate,
    type NotificationUnreadCounts,
} from '@/services/notifications/client';

import LoginIcon from '@/assets/logos/login.svg?react';
import hideUI from '@/assets/logos/hideUI.svg?react';
import NotificationIcon from '@/assets/logos/group.svg?react';
import Darkmode from '@/assets/logos/darkmode.svg?react';
import i18n from '@/assets/logos/i18n.svg?react';
import Guide from '@/assets/logos/guide.svg?react';
import SettingsIcon from '@/assets/logos/settings.svg?react';
import AnnouncementIcon from '@/assets/logos/announce.svg?react';
import { useAnnouncementFlow } from '@/pages/uiOverlay/useAnnFlow';
import { shouldSuppressInitialAutoOverlays } from '@/services/routing';
import ScopeIndicator from '@/pages/scopeIndicator/ScopeIndicator';

const loadAnnouncement = () => import('@/pages/announcement/announcement');

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
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [announcementOpen, setAnnouncementOpen] = useState(false);
    const [announcementMounted, setAnnouncementMounted] = useState(false);
    const AnnouncementModal = useRetryImport(loadAnnouncement, announcementOpen)?.default;
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
        const unsubscribe = subscribeNotificationLive({
            onUpdate: (update) => {
                if (disposed) return;
                setNotificationUnread(update.unread);
                setNotificationLiveUpdate(update);
            },
            onReady: (unread) => {
                if (disposed) return;
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
        setSettingsOpen(false);
        setAnnouncementOpen(false);
    }, [visible]);

    return (
        <div
            data-font-region="shell"
            className={`${styles.uiOverlay} ${isMobile ? styles.mobile : ''} ${layoutSidebarOpen ? styles.sidebarOpen : ''}`}
        >
            {/* Headbar */}
            {(visible || showVisibilityControl) && (
                <div className={styles.headbarHost}>
                    <HeadBar compact={!visible}>
                        <HeadItem
                            icon={LoginIcon}
                            iconScale={0.85}
                            onClick={openOemAccountModal}
                            tooltip={t(sessionUser ? 'headbar.profile' : 'headbar.auth')}
                            disabled={fullModalActionsDisabled}
                            guideKey='auth'
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
                <ScopeIndicator />
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

            {/* Settings Modal */}
            <SettingsModal
                open={settingsOpen}
                onClose={() => setSettingsOpen(false)}
                onChange={(o) => setSettingsOpen(o)}
            />

            {/* Announcement Modal */}
            {announcementMounted && AnnouncementModal && (
                <ErrorBoundary resetKeys={[announcementOpen]}>
                    <AnnouncementModal
                        open={announcementOpen}
                        onClose={() => setAnnouncementOpen(false)}
                        onChange={(o) => setAnnouncementOpen(o)}
                        onHasUnread={setHasUnreadAnnouncement}
                        announcements={announcements}
                    />
                </ErrorBoundary>
            )}
            {announcementOpen && !AnnouncementModal && (
                <Modal open title={t('headbar.announcement')} onChange={setAnnouncementOpen}>
                    <p role="status">{t('common.loading')}</p>
                </Modal>
            )}
        </div>
    );
};

export default UIOverlay;
