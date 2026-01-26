import React, { useCallback, useId } from 'react';
import Modal from '@/component/modal/modal';
import { Trigger } from '@/component/trigger/trigger';
import SettingsIcon from '../../assets/logos/settings.svg?react';
import DarkModeIcon from '../../assets/logos/darkmode.svg?react';
import styles from './settings.module.scss';
import { useTranslateUI } from '@/locale';
import parse from 'html-react-parser';
import {
    useUiPrefsStore,
    useTheme,
    useSetTheme,
    usePerformanceMode,
    useSetPerformanceMode,
} from '@/store/uiPrefs';
import { applyTheme, startSystemFollow } from '@/utils/theme';

export interface SettingsProps {
    open: boolean;
    onClose: () => void;
    onChange?: (open: boolean) => void;
}

type ThemeMode = 'light' | 'dark' | 'auto';

const SettingsModal: React.FC<SettingsProps> = ({ open, onClose, onChange }) => {
    const t = useTranslateUI();
    const groupId = useId();

    // UI Preferences
    const prefsSidebar = useUiPrefsStore((s) => s.prefsSidebarEnabled);
    const setPrefsSidebar = useUiPrefsStore((s) => s.setPrefsSidebarEnabled);
    const prefsFilterOrder = useUiPrefsStore((s) => s.prefsFilterOrderEnabled);
    const setPrefsFilterOrder = useUiPrefsStore((s) => s.setPrefsFilterOrderEnabled);
    const prefsTriggers = useUiPrefsStore((s) => s.prefsTriggersEnabled);
    const setPrefsTriggers = useUiPrefsStore((s) => s.setPrefsTriggersEnabled);
    const prefsPerformanceMode = usePerformanceMode();
    const setPrefsPerformanceMode = useSetPerformanceMode();

    // Map Preferences
    const prefsViewState = useUiPrefsStore((s) => s.prefsViewStateEnabled);
    const setPrefsViewState = useUiPrefsStore((s) => s.setPrefsViewStateEnabled);
    const prefsMarkerProgress = useUiPrefsStore((s) => s.prefsMarkerProgressEnabled);
    const setPrefsMarkerProgress = useUiPrefsStore((s) => s.setPrefsMarkerProgressEnabled);
    const prefsAutoCluster = useUiPrefsStore((s) => s.prefsAutoClusterEnabled);
    const setPrefsAutoCluster = useUiPrefsStore((s) => s.setPrefsAutoClusterEnabled);

    // Theme
    const themePreference = useTheme();
    const setThemePreference = useSetTheme();

    const handleThemeChange = useCallback((mode: ThemeMode) => {
        setThemePreference(mode);
        if (mode === 'auto') {
            startSystemFollow(true);
        } else {
            applyTheme(mode, true);
        }
    }, [setThemePreference]);

    return (
        <Modal
            open={open}
            size="l"
            onClose={onClose}
            onChange={onChange}
            title={t('settings.title')}
            icon={<SettingsIcon aria-hidden="true" />}
            iconScale={0.8}
        >
            <div className={styles.settingsList} id={groupId}>
                {/* UI Preferences Section */}
                <div className={styles.settingsSection}>
                    <div className={styles.sectionHeader}>
                        <span className={styles.sectionTitle}>{t('settings.uiPrefs.title')}</span>
                        <span className={styles.sectionHint}>{parse(t('settings.uiPrefs.hint') || '')}</span>
                    </div>
                    <div className={styles.triggerGrid}>
                        <div className={styles.triggerRow}>
                            <Trigger
                                isActive={prefsSidebar}
                                onToggle={setPrefsSidebar}
                                label={t('settings.uiPrefs.sidebar')}
                                className={styles.settingsTrigger}
                            />
                        </div>
                        <div className={styles.triggerRow}>
                            <Trigger
                                isActive={prefsFilterOrder}
                                onToggle={setPrefsFilterOrder}
                                label={t('settings.uiPrefs.filterOrder')}
                                className={styles.settingsTrigger}
                            />
                        </div>
                        <div className={styles.triggerRow}>
                            <Trigger
                                isActive={prefsTriggers}
                                onToggle={setPrefsTriggers}
                                label={t('settings.uiPrefs.triggers')}
                                className={styles.settingsTrigger}
                            />
                        </div>
                        <div className={styles.triggerRow}>
                            <Trigger
                                isActive={prefsPerformanceMode}
                                onToggle={setPrefsPerformanceMode}
                                label={t('settings.uiPrefs.performanceMode')}
                                className={styles.settingsTrigger}
                            />
                        </div>
                    </div>
                </div>

                {/* Map Preferences Section */}
                <div className={styles.settingsSection}>
                    <div className={styles.sectionHeader}>
                        <span className={styles.sectionTitle}>{t('settings.mapPrefs.title')}</span>
                        <span className={styles.sectionHint}>{parse(t('settings.mapPrefs.hint') || '')}</span>
                    </div>
                    <div className={styles.triggerGrid}>
                        <div className={styles.triggerRow}>
                            <Trigger
                                isActive={prefsViewState}
                                onToggle={setPrefsViewState}
                                label={t('settings.mapPrefs.viewState')}
                                className={styles.settingsTrigger}
                            />
                        </div>
                        <div className={styles.triggerRow}>
                            <Trigger
                                isActive={prefsMarkerProgress}
                                onToggle={setPrefsMarkerProgress}
                                label={t('settings.mapPrefs.markerProgress')}
                                className={styles.settingsTrigger}
                            />
                        </div>
                        <div className={styles.triggerRow}>
                            <Trigger
                                isActive={prefsAutoCluster}
                                onToggle={setPrefsAutoCluster}
                                label={t('settings.mapPrefs.autoCluster')}
                                className={styles.settingsTrigger}
                            />
                        </div>
                    </div>
                </div>

                {/* Theme Section */}
                <div className={styles.settingsSection}>
                    <div className={styles.sectionHeader}>
                        <span className={styles.sectionTitle}>{t('settings.theme.title')}</span>
                        <span className={styles.sectionHint}>{parse(t('settings.theme.hint') || '')}</span>
                    </div>
                    <div className={styles.themeItems}>
                        <button
                            type="button"
                            className={`${styles.themeItem} ${themePreference === 'light' ? styles.active : ''}`}
                            onClick={() => handleThemeChange('light')}
                            aria-pressed={themePreference === 'light'}
                            data-pref="light"
                        >
                            <span className={styles.themeName}>{t('settings.theme.light')}</span>
                            <span className={styles.themeIndicator}>{t('language.current')}</span>
                            <DarkModeIcon className={styles.themeIcon} />
                        </button>
                        <button
                            type="button"
                            className={`${styles.themeItem} ${themePreference === 'dark' ? styles.active : ''}`}
                            onClick={() => handleThemeChange('dark')}
                            aria-pressed={themePreference === 'dark'}
                            data-pref="dark"
                        >
                            <span className={styles.themeName}>{t('settings.theme.dark')}</span>
                            <span className={styles.themeIndicator}>{t('language.current')}</span>
                            <DarkModeIcon className={styles.themeIcon} />
                        </button>
                        <button
                            type="button"
                            className={`${styles.themeItem} ${themePreference === 'auto' ? styles.active : ''}`}
                            onClick={() => handleThemeChange('auto')}
                            aria-pressed={themePreference === 'auto'}
                            data-pref="auto"
                        >
                            <span className={styles.themeName}>{t('settings.theme.auto')}</span>
                            <span className={styles.themeIndicator}>{t('language.current')}</span>
                            <DarkModeIcon className={styles.themeIcon} />
                        </button>
                    </div>
                </div>
            </div>
        </Modal>
    );
};

export default React.memo(SettingsModal);
