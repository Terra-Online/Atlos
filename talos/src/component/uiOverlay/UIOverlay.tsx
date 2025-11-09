import React, { useEffect, useState } from 'react';
import styles from './UIOverlay.module.scss';

import Scale from '../scale/scale';
import { HeadBar, HeadItem } from '../headBar/headBar.tsx';
import { RegionContainer } from '../regSwitch/regSwitch';
import { Detail } from '../detail/detail';
import FilterList from '../filterList/filterList';
import { useDevice } from '@/utils/device';
import { initTheme, cleanupTheme, toggleTheme } from '@/utils/theme';

import ToS from '../../assets/logos/tos.svg?react';
import hideUI from '../../assets/logos/hideUI.svg?react';
import Group from '../../assets/logos/group.svg?react';
import Darkmode from '../../assets/logos/darkmode.svg?react';
import i18n from '../../assets/logos/i18n.svg?react';
import Guide from '../../assets/logos/guide.svg?react';
import L from 'leaflet';
import { useTranslateUI } from '@/locale';
import LanguageModal from '@/component/language/LanguageModal';
import GroupsModal from '@/component/group/group';

interface UIOverlayProps {
    map?: L.Map;
    isSidebarOpen: boolean; // 保留用于某些需要的组件
    visible?: boolean;
    onHideUI?: () => void;
}

const UIOverlay: React.FC<UIOverlayProps> = ({ map, isSidebarOpen, visible = true, onHideUI }) => {
    const t = useTranslateUI();
    const [langOpen, setLangOpen] = useState(false);
    const [groupOpen, setGroupOpen] = useState(false);
    const { isMobile } = useDevice();

    const handleReset = () => {
        localStorage.clear();
        sessionStorage.clear();
        
        document.cookie.split(';').forEach(cookie => {
            const name = cookie.split('=')[0].trim();
            if (name) {
                document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/`;
            }
        });
        
        window.location.reload();
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
    const handleHelp = () => console.log('Reach out for help');

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
                    tooltip={t('headbar.darkMode')}
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
            </HeadBar>

            {/* Region Switch: on mobile do not apply sidebar open offset to avoid push-out */}
            <RegionContainer isSidebarOpen={!isMobile && isSidebarOpen} />

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
                    // 可在此处记录选择结果或埋点
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
        </div>
    );
};

export default UIOverlay;
