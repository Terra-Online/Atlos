import React, { useCallback, useId } from 'react';
import Modal from '@/component/modal/modal';
import { Trigger } from '@/component/trigger/trigger';
import SettingsIcon from '../../assets/logos/settings.svg?react';
import DarkModeIcon from '../../assets/logos/darkmode.svg?react';
import styles from './settings.module.scss';
import { useTranslateUI } from '@/locale';
import parse from 'html-react-parser';
import { useShallow } from 'zustand/shallow';
import {
    useUiPrefsStore,
    useTheme,
    useSetTheme,
    usePerformanceMode,
    useSetPerformanceMode,
} from '@/store/uiPrefs';
import { applyTheme, startSystemFollow } from '@/utils/theme';
import { isMac } from '@/utils/platform';
import { getShortcutConfig, type ShortcutEntry, type KeyChip } from './shortcuts';

export interface SettingsProps {
    open: boolean;
    onClose: () => void;
    onChange?: (open: boolean) => void;
}

type ThemeMode = 'light' | 'dark' | 'auto';

const THEME_MODES: ThemeMode[] = ['light', 'dark', 'auto'];

interface SectionProps {
    titleKey: string;
    hintKey: string;
    children: React.ReactNode;
}

const SettingsSection: React.FC<SectionProps> = ({ titleKey, hintKey, children }) => {
    const t = useTranslateUI();
    return (
        <div className={styles.settingsSection}>
            <div className={styles.sectionHeader}>
                <span className={styles.sectionTitle}>{t(titleKey)}</span>
                <span className={styles.sectionHint}>{parse(t(hintKey) || '')}</span>
            </div>
            {children}
        </div>
    );
};

/** Renders a single key cap chip — resolves `variant:'mod'` to the platform-correct width */
const KeyCap: React.FC<{ chip: KeyChip }> = ({ chip }) => {
    const size = chip.variant === 'mod'
        ? (isMac() ? '1u' : '2u')
        : (chip.size ?? '1u');
    return (
        <span className={styles.keyCap} data-ch={size}>
            {chip.label}
        </span>
    );
};

/** Renders one shortcut row: label on left, key caps on right */
const ShortcutRow: React.FC<{ entry: ShortcutEntry }> = ({ entry }) => {
    const t = useTranslateUI();
    return (
        <div className={styles.shortcutRow}>
            <span className={styles.shortcutLabel}>
                {t(`settings.shortcuts.${entry.id}`)}
            </span>
            <span className={styles.shortcutKeys}>
                {entry.keys.map((chip, i) => (
                    <KeyCap key={i} chip={chip} />
                ))}
            </span>
        </div>
    );
};

const SettingsModal: React.FC<SettingsProps> = ({ open, onClose, onChange }) => {
    const t = useTranslateUI();
    const groupId = useId();

    const {
        prefsSidebar, setPrefsSidebar,
        prefsFilterOrder, setPrefsFilterOrder,
        prefsTriggers, setPrefsTriggers,
        prefsViewState, setPrefsViewState,
        prefsMarkerProgress, setPrefsMarkerProgress,
        prefsAutoCluster, setPrefsAutoCluster,
        prefsHideCompleted, setPrefsHideCompleted,
    } = useUiPrefsStore(useShallow((s) => ({
        prefsSidebar: s.prefsSidebarEnabled,
        setPrefsSidebar: s.setPrefsSidebarEnabled,
        prefsFilterOrder: s.prefsFilterOrderEnabled,
        setPrefsFilterOrder: s.setPrefsFilterOrderEnabled,
        prefsTriggers: s.prefsTriggersEnabled,
        setPrefsTriggers: s.setPrefsTriggersEnabled,
        prefsViewState: s.prefsViewStateEnabled,
        setPrefsViewState: s.setPrefsViewStateEnabled,
        prefsMarkerProgress: s.prefsMarkerProgressEnabled,
        setPrefsMarkerProgress: s.setPrefsMarkerProgressEnabled,
        prefsAutoCluster: s.prefsAutoClusterEnabled,
        setPrefsAutoCluster: s.setPrefsAutoClusterEnabled,
        prefsHideCompleted: s.prefsHideCompletedMarkers,
        setPrefsHideCompleted: s.setPrefsHideCompletedMarkers,
    })));
    const prefsPerformanceMode = usePerformanceMode();
    const setPrefsPerformanceMode = useSetPerformanceMode();

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

    const uiPrefItems = [
        { isActive: prefsSidebar,        onToggle: setPrefsSidebar,        label: t('settings.uiPrefs.sidebar') },
        { isActive: prefsFilterOrder,    onToggle: setPrefsFilterOrder,    label: t('settings.uiPrefs.filterOrder') },
        { isActive: prefsTriggers,       onToggle: setPrefsTriggers,       label: t('settings.uiPrefs.triggers') },
        { isActive: prefsPerformanceMode, onToggle: setPrefsPerformanceMode, label: t('settings.uiPrefs.performanceMode') },
    ];

    const mapPrefItems = [
        { isActive: prefsViewState,      onToggle: setPrefsViewState,      label: t('settings.mapPrefs.viewState') },
        { isActive: prefsMarkerProgress, onToggle: setPrefsMarkerProgress, label: t('settings.mapPrefs.markerProgress') },
        { isActive: prefsAutoCluster,    onToggle: setPrefsAutoCluster,    label: t('settings.mapPrefs.autoCluster') },
        { isActive: prefsHideCompleted,  onToggle: setPrefsHideCompleted,  label: t('settings.mapPrefs.hideCompleted') },
    ];

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
                <SettingsSection titleKey="settings.uiPrefs.title" hintKey="settings.uiPrefs.hint">
                    <div className={styles.triggerGrid}>
                        {uiPrefItems.map(({ isActive, onToggle, label }) => (
                            <div key={label} className={styles.triggerRow}>
                                <Trigger isActive={isActive} onToggle={onToggle} label={label} className={styles.settingsTrigger} />
                            </div>
                        ))}
                    </div>
                </SettingsSection>

                <SettingsSection titleKey="settings.mapPrefs.title" hintKey="settings.mapPrefs.hint">
                    <div className={styles.triggerGrid}>
                        {mapPrefItems.map(({ isActive, onToggle, label }) => (
                            <div key={label} className={styles.triggerRow}>
                                <Trigger isActive={isActive} onToggle={onToggle} label={label} className={styles.settingsTrigger} />
                            </div>
                        ))}
                    </div>
                </SettingsSection>

                <SettingsSection titleKey="settings.theme.title" hintKey="settings.theme.hint">
                    <div className={styles.themeItems}>
                        {THEME_MODES.map((mode) => (
                            <button
                                key={mode}
                                type="button"
                                className={`${styles.themeItem} ${themePreference === mode ? styles.active : ''}`}
                                onClick={() => handleThemeChange(mode)}
                                aria-pressed={themePreference === mode}
                                data-pref={mode}
                            >
                                <span className={styles.themeName}>{t(`settings.theme.${mode}`)}</span>
                                <span className={styles.themeIndicator}>{t('language.current')}</span>
                                <DarkModeIcon className={styles.themeIcon} />
                            </button>
                        ))}
                    </div>
                </SettingsSection>

                <SettingsSection titleKey="settings.shortcuts.title" hintKey="settings.shortcuts.hint">
                    <div className={styles.shortcutGrid}>
                        {getShortcutConfig().map((entry) => (
                            <ShortcutRow key={entry.id} entry={entry} />
                        ))}
                    </div>
                </SettingsSection>
            </div>
        </Modal>
    );
};

export default React.memo(SettingsModal);