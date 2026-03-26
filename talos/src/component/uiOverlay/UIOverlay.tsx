import React, { useEffect, useState } from 'react';
import L from 'leaflet';
import styles from './UIOverlay.module.scss';

import LanguageModal from '@/component/language/language';
import GroupsModal from '@/component/group/group';
import ToSModal from '@/component/tos/tos';
import SettingsModal from '@/component/settings/settings';
import AnnouncementModal from '@/component/announcement/announcement';
import Scale from '@/component/scale/scale';
import { HeadBar, HeadItem } from '@/component/headBar/headBar';
import { RegionContainer } from '@/component/regSwitch/regSwitch';
import { LayerSwitch } from '@/component/layerSwitch/layerSwitch';
import { Detail } from '@/component/detail/detail';
import FilterList from '@/component/filterList/filterList';
import {
    useSetIsUserGuideOpen,
    useMobileDrawerSnapIndex,
    useIsUserGuideOpen,
    useUiPrefsStore,
} from '@/store/uiPrefs';

import { useLocale, useTranslateUI } from '@/locale';
import { useDevice } from '@/utils/device';
import { initTheme, cleanupTheme, toggleTheme } from '@/utils/theme';

import ToS from '../../assets/logos/tos.svg?react';
import hideUI from '../../assets/logos/hideUI.svg?react';
import Group from '../../assets/logos/group.svg?react';
import Darkmode from '../../assets/logos/darkmode.svg?react';
import i18n from '../../assets/logos/i18n.svg?react';
import Guide from '../../assets/logos/guide.svg?react';
import SettingsIcon from '../../assets/logos/settings.svg?react';
import AnnouncementIcon from '../../assets/logos/announce.svg?react';
import { fetchAnnouncements, getAnnouncementDebugMode } from '@/utils/announcement';

interface UIOverlayProps {
    map?: L.Map;
    isSidebarOpen: boolean;
    visible?: boolean;
    onHideUI?: () => void;
}

const UIOverlay: React.FC<UIOverlayProps> = ({ map, isSidebarOpen, visible = true, onHideUI }) => {
    const t = useTranslateUI();
    const locale = useLocale();
    const [langOpen, setLangOpen] = useState(false);
    const [groupOpen, setGroupOpen] = useState(false);
    const [storageOpen, setStorageOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [announcementOpen, setAnnouncementOpen] = useState(false);
    const [hasUnreadAnnouncement, setHasUnreadAnnouncement] = useState(false);
    const [announcements, setAnnouncements] = useState<any[]>([]);
    const { isMobile } = useDevice();
    const setIsUserGuideOpen = useSetIsUserGuideOpen();
    const isUserGuideOpen = useIsUserGuideOpen();
    const setIsAnnouncementOpen = useUiPrefsStore((s) => s.setIsAnnouncementOpen);
    const setAnnouncementFlowReady = useUiPrefsStore((s) => s.setAnnouncementFlowReady);
    const mobileDrawerSnapIndex = useMobileDrawerSnapIndex();
    const [announcementChecked, setAnnouncementChecked] = useState(false);
    const [autoOpenedOnce, setAutoOpenedOnce] = useState(false);

    // Check for unread announcements on mount
    useEffect(() => {
        setAnnouncementFlowReady(false);
        const checkUnread = async () => {
            const debugMode = getAnnouncementDebugMode();
            if (debugMode === 'force-unread') {
                setHasUnreadAnnouncement(true);
                setAnnouncementChecked(true);
                return;
            }

            try {
                const data = await fetchAnnouncements(locale);
                setAnnouncements(data);
                const lastRead = localStorage.getItem('announcement_last_read');
                const latestDate = data[0]?.date;
                const hasUnread = !lastRead || !!(latestDate && new Date(latestDate) > new Date(lastRead));
                setHasUnreadAnnouncement(hasUnread);
            } catch (error) {
                console.error('Failed to check announcements:', error);
            } finally {
                setAnnouncementChecked(true);
            }
        };
        void checkUnread();
    }, [locale, setAnnouncementFlowReady]);

    useEffect(() => {
        if (!announcementChecked) return;
        if (isUserGuideOpen) return;

        if (hasUnreadAnnouncement && !autoOpenedOnce) {
            setAnnouncementOpen(true);
            setIsAnnouncementOpen(true);
            setAutoOpenedOnce(true);
            return;
        }

        setAnnouncementFlowReady(true);
    }, [announcementChecked, isUserGuideOpen, hasUnreadAnnouncement, autoOpenedOnce, setAnnouncementFlowReady, setIsAnnouncementOpen]);

    const handleReset = () => {
        setStorageOpen(true);
    };

    const handleHideUI = () => {
        if (onHideUI) {onHideUI();}
    };
    const handleGroup = () => setGroupOpen(true);

    useEffect(() => {
        initTheme();
        return () => cleanupTheme();
    }, []);

    const handleDarkMode = () => toggleTheme();
    const handleLanguage = () => setLangOpen(true);
    const handleHelp = () => setIsUserGuideOpen(true);
    const handleSettings = () => setSettingsOpen(true);
    const handleAnnouncement = () => setAnnouncementOpen(true);

    useEffect(() => {
        setIsAnnouncementOpen(announcementOpen);
        if (!announcementOpen && announcementChecked) {
            setAnnouncementFlowReady(true);
        }
    }, [announcementOpen, announcementChecked, setIsAnnouncementOpen, setAnnouncementFlowReady]);

    return (
        <div
            className={`${styles.uiOverlay} ${isSidebarOpen ? styles.sidebarOpen : ''} ${!visible ? styles.hidden : ''}`}
        >
            {/* Scale Component */}
            {map && <Scale map={map} />}

            {/* Headbar */}
            <HeadBar>
                <HeadItem 
                    icon={ToS}
                    onClick={handleReset}
                    tooltip={t('headbar.tos')}
                    guideKey='headbar-tos'
                />
                <HeadItem
                    icon={hideUI}
                    onClick={handleHideUI}
                    tooltip={t('headbar.hideUI')}
                    guideKey='headbar-hide-ui'
                />
                <HeadItem
                    icon={Group}
                    onClick={handleGroup}
                    tooltip={t('headbar.group')}
                    guideKey='headbar-group'
                />
                <HeadItem
                    icon={Darkmode}
                    onClick={handleDarkMode}
                    tooltip={t('headbar.darkmode')}
                    guideKey='headbar-dark-mode'
                />
                <HeadItem
                    icon={i18n}
                    onClick={handleLanguage}
                    tooltip={t('headbar.language')}
                    guideKey='headbar-language'
                />
                <HeadItem
                    icon={Guide}
                    onClick={handleHelp}
                    tooltip={t('headbar.help')}
                    guideKey='headbar-help'
                />
                <HeadItem
                    icon={AnnouncementIcon}
                    onClick={handleAnnouncement}
                    tooltip={t('headbar.announcement')}
                    badge={hasUnreadAnnouncement}
                    guideKey='headbar-announcement'
                />
                <HeadItem
                    icon={SettingsIcon}
                    onClick={handleSettings}
                    tooltip={t('headbar.settings')}
                    guideKey='headbar-settings'
                />
            </HeadBar>

            {/* Switch Area: wrap both Region and Layer switches */}
            {!isMobile && (
                <div className={styles.switchArea}>
                    <RegionContainer isSidebarOpen={isSidebarOpen} />
                    <LayerSwitch isSidebarOpen={isSidebarOpen} />
                </div>
            )}
            {isMobile && (
                <div className={styles.switchArea} data-snap={mobileDrawerSnapIndex ?? 0}>
                    <RegionContainer isSidebarOpen={false} />
                    <LayerSwitch isSidebarOpen={false} />
                </div>
            )}

            {/* Detail Panel: hide on mobile (rendered inside SideBarMobile) */}
            {!isMobile && <Detail />}

            {/* Filter List: hide on mobile (rendered inside SideBarMobile) */}
            {!isMobile && <FilterList isSidebarOpen={isSidebarOpen} />}

            {/* Language Modal */}
            <LanguageModal
                open={langOpen}
                onClose={() => setLangOpen(false)}
                onChange={(o) => setLangOpen(o)}
                onSelected={(lang) => {
                    console.log('Language switched to:', lang);
                }}
            />

            {/* Groups Modal */}
            <GroupsModal
                open={groupOpen}
                onClose={() => setGroupOpen(false)}
                onChange={(o) => setGroupOpen(o)}
                onSelected={(platform) => {
                    console.log('Opened social platform:', platform);
                }}
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
            <AnnouncementModal
                open={announcementOpen}
                onClose={() => setAnnouncementOpen(false)}
                onChange={(o) => setAnnouncementOpen(o)}
                onHasUnread={setHasUnreadAnnouncement}
                announcements={announcements}
            />
        </div>
    );
};

export default UIOverlay;
