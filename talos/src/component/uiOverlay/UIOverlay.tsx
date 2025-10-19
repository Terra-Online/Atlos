import React, { useEffect, useState } from 'react';
import styles from './UIOverlay.module.scss';

import Scale from '../scale/scale';
import { Trigger, TriggerBar } from '../trigger/trigger';
import { HeadBar, HeadItem } from '../headBar/headBar.tsx';
import { RegionContainer } from '../regSwitch/regSwitch';
import { Detail } from '../detail/detail';
import FilterList from '../filterList/filterList';

import ToS from '../../assets/logos/tos.svg?react';
import hideUI from '../../assets/logos/hideUI.svg?react';
import Group from '../../assets/logos/group.svg?react';
import Darkmode from '../../assets/logos/darkmode.svg?react';
import i18n from '../../assets/logos/i18n.svg?react';
import Guide from '../../assets/logos/guide.svg?react';
import L from 'leaflet';
import { useTranslateUI } from '@/locale';
import LanguageModal from '@/component/language/LanguageModal';

interface UIOverlayProps {
    map?: L.Map;
    isSidebarOpen: boolean; // 保留用于某些需要的组件
}

interface TriggerState {
    t1: boolean;
    t2: boolean;
}

const UIOverlay: React.FC<UIOverlayProps> = ({ map, isSidebarOpen }) => {
    const t = useTranslateUI();
    const [triggers, setTrigger] = useState<TriggerState>({
        t1: false,
        t2: false,
    });
    const [langOpen, setLangOpen] = useState(false);

    const handleTrigger1 = (isActive: boolean) =>
        setTrigger({ ...triggers, t1: isActive });
    const handleTrigger2 = (isActive: boolean) =>
        setTrigger({ ...triggers, t2: isActive });

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

    const handleHideUI = () => console.log('HideUI');
    const handleGroup = () => console.log('Join related group');

    // Apply stored theme on mount (if any)
    useEffect(() => {
        const saved = localStorage.getItem('theme');
        if (saved === 'light' || saved === 'dark') {
            document.documentElement.setAttribute('data-theme', saved);
        }
    }, []);

    // Helper to apply and persist theme; mode 'system' removes override
    const applyTheme = (mode: 'light' | 'dark' | 'system') => {
        // Indicate a theme switching window to enable scoped transitions
        const root = document.documentElement;
        const DURATION = getComputedStyle(root)
            .getPropertyValue('--theme-transition-duration')
            .trim() || '250ms';
        // convert to ms number (basic parsing)
        const ms = /ms$/.test(DURATION)
            ? parseFloat(DURATION)
            : /s$/.test(DURATION)
              ? parseFloat(DURATION) * 1000
              : 250;
        root.setAttribute('data-theme-switching', '');
        if (mode === 'system') {
            root.removeAttribute('data-theme');
            localStorage.removeItem('theme');
            window.setTimeout(() => root.removeAttribute('data-theme-switching'), ms);
            return;
        }
        root.setAttribute('data-theme', mode);
        localStorage.setItem('theme', mode);
        window.setTimeout(() => root.removeAttribute('data-theme-switching'), ms);
    };

    // Dark mode logic: always invert (base = saved theme if exists, otherwise system preference)
    const handleDarkMode = () => {
        const saved = localStorage.getItem('theme');
        const base: 'light' | 'dark' =
            saved === 'light' || saved === 'dark'
                ? saved
                : (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
                    ? 'dark'
                    : 'light');
        const next: 'light' | 'dark' = base === 'dark' ? 'light' : 'dark';
        applyTheme(next); // always persist override
    };
    const handleLanguage = () => setLangOpen(true);
    const handleHelp = () => console.log('Reach out for help');

    return (
        <div
            className={`${styles.uiOverlay} ${isSidebarOpen ? styles.sidebarOpen : ''}`}
        >
            {/* Scale Component */}
            {map && <Scale map={map} />}

            {/* Headbar */}
            <HeadBar isSidebarOpen={isSidebarOpen}>
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

            {/* Region Switch */}
            <RegionContainer isSidebarOpen={false} />

            {/* TriggerBar */}
            <TriggerBar>
                <Trigger isActive={triggers.t1} onToggle={handleTrigger1} label={t('trigger.complexSelect')} />
                <Trigger
                    isActive={triggers.t2}
                    onToggle={handleTrigger2}
                    label={t('trigger.regionalPoi')}
                />
            </TriggerBar>

            {/* Detail Panel */}
            <Detail />

            {/* Filter List */}
            <FilterList isSidebarOpen={false} />

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
        </div>
    );
};

export default UIOverlay;
