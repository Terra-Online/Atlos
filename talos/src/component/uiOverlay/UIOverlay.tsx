import React, { useEffect, useState } from 'react';
import L from 'leaflet';
import styles from './UIOverlay.module.scss';

import LanguageModal from '@/component/language/language';
import GroupsModal from '@/component/group/group';
import ToSModal from '@/component/tos/tos';
import SettingsModal from '@/component/settings/settings';
import Scale from '@/component/scale/scale';
import { HeadBar, HeadItem } from '@/component/headBar/headBar';
import { RegionContainer } from '@/component/regSwitch/regSwitch';
import { LayerSwitch } from '@/component/layerSwitch/layerSwitch';
import { Detail } from '@/component/detail/detail';
import FilterList from '@/component/filterList/filterList';
import { useSetIsUserGuideOpen, useMobileDrawerSnapIndex } from '@/store/uiPrefs';

import { useTranslateUI } from '@/locale';
import { useDevice } from '@/utils/device';
import { initTheme, cleanupTheme, toggleTheme } from '@/utils/theme';

import ToS from '../../assets/logos/tos.svg?react';
import hideUI from '../../assets/logos/hideUI.svg?react';
import Group from '../../assets/logos/group.svg?react';
import Darkmode from '../../assets/logos/darkmode.svg?react';
import i18n from '../../assets/logos/i18n.svg?react';
import Guide from '../../assets/logos/guide.svg?react';
import SettingsIcon from '../../assets/logos/settings.svg?react';

interface UIOverlayProps {
    map?: L.Map;
    isSidebarOpen: boolean;
    visible?: boolean;
    onHideUI?: () => void;
}

const UIOverlay: React.FC<UIOverlayProps> = ({ map, isSidebarOpen, visible = true, onHideUI }) => {
    const t = useTranslateUI();
    const [langOpen, setLangOpen] = useState(false);
    const [groupOpen, setGroupOpen] = useState(false);
    const [storageOpen, setStorageOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const { isMobile } = useDevice();
    const setIsUserGuideOpen = useSetIsUserGuideOpen();
    const mobileDrawerSnapIndex = useMobileDrawerSnapIndex();

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
                />
                <HeadItem
                    icon={hideUI}
                    onClick={handleHideUI}
                    tooltip={t('headbar.hideUI')}
                />
                <HeadItem
                    icon={Group}
                    onClick={handleGroup}
                    tooltip={t('headbar.group')}
                />
                <HeadItem
                    icon={Darkmode}
                    onClick={handleDarkMode}
                    tooltip={t('headbar.darkmode')}
                />
                <HeadItem
                    icon={i18n}
                    onClick={handleLanguage}
                    tooltip={t('headbar.language')}
                />
                <HeadItem
                    icon={Guide}
                    onClick={handleHelp}
                    tooltip={t('headbar.help')}
                />
                <HeadItem
                    icon={SettingsIcon}
                    onClick={handleSettings}
                    tooltip={t('headbar.settings')}
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
        </div>
    );
};

export default UIOverlay;
