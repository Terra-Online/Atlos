import React, { useCallback, useId, useMemo, useState } from 'react';
import Modal from '@/component/modal/modal';
import { Trigger } from '@/component/trigger/trigger';
import Button from '@/component/button/button';
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
import {
    authenticateEndfieldSession,
    EndfieldBrowserClient,
    sendSklandPhoneCode,
    type EndfieldRoleOption,
} from '@/utils/endfield/client';
import { readEndfieldSession } from '@/utils/endfield/storage';
import type { EndfieldSession } from '@/utils/endfield/types';
import {
    readEndfieldTrackerConfig,
    saveEndfieldTrackerConfig,
    type EndfieldTrackerConfig,
} from '@/utils/endfield/config';

export interface SettingsProps {
    open: boolean;
    onClose: () => void;
    onChange?: (open: boolean) => void;
}

type ThemeMode = 'light' | 'dark' | 'auto';

const THEME_MODES: ThemeMode[] = ['light', 'dark', 'auto'];
const SKPORT_BASE_URL = 'https://zonai.skport.com';
const SKPORT_AUTH_BASE_URL = 'https://as.gryphline.com';
const SKLAND_BASE_URL = 'https://zonai.skland.com';
const SKLAND_AUTH_BASE_URL = 'https://as.hypergryph.com';
const SKLAND_DEVICE_ID_KEY = 'endfield.skland.deviceId';

type AccountMode = 'skport' | 'skland';
type SklandAuthMode = 'code' | 'password';

const inferAccountModeFromBaseUrl = (baseUrl?: string): AccountMode =>
    baseUrl?.includes('skland.com') ? 'skland' : 'skport';

const resolveApiHosts = (mode: AccountMode): { baseUrl: string; authBaseUrl: string } =>
    mode === 'skland'
        ? { baseUrl: SKLAND_BASE_URL, authBaseUrl: SKLAND_AUTH_BASE_URL }
        : { baseUrl: SKPORT_BASE_URL, authBaseUrl: SKPORT_AUTH_BASE_URL };

const getOrCreateSklandDeviceId = (): string => {
    const existing = localStorage.getItem(SKLAND_DEVICE_ID_KEY);
    if (existing) return existing;

    const generated = typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `skland-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    localStorage.setItem(SKLAND_DEVICE_ID_KEY, generated);
    return generated;
};

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
        prefsLocatorSync, setPrefsLocatorSync,
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
        prefsLocatorSync: s.prefsLocatorSyncEnabled,
        setPrefsLocatorSync: s.setPrefsLocatorSyncEnabled,
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

    const existingTrackerConfig = useMemo(() => readEndfieldTrackerConfig(), []);
    const [accountMode, setAccountMode] = useState<AccountMode>(
        inferAccountModeFromBaseUrl(existingTrackerConfig?.baseUrl),
    );
    const [loginOpen, setLoginOpen] = useState(false);
    const [loginLoading, setLoginLoading] = useState(false);
    const [sendCodeLoading, setSendCodeLoading] = useState(false);
    const [loginError, setLoginError] = useState('');
    const [loginStep, setLoginStep] = useState<'auth' | 'role'>('auth');
    const [sklandAuthMode, setSklandAuthMode] = useState<SklandAuthMode>('code');
    const [roleOptions, setRoleOptions] = useState<EndfieldRoleOption[]>([]);
    const [selectedRoleKey, setSelectedRoleKey] = useState(
        existingTrackerConfig ? `${existingTrackerConfig.serverId}:${existingTrackerConfig.roleId}` : '',
    );
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [phone, setPhone] = useState('');
    const [verificationCode, setVerificationCode] = useState('');

    const closeLoginModal = useCallback(() => {
        setLoginOpen(false);
        setLoginLoading(false);
        setLoginError('');
        setLoginStep('auth');
        setRoleOptions([]);
        setSelectedRoleKey('');
        setSendCodeLoading(false);
        setSklandAuthMode('code');
    }, []);

    const resolveDefaultRole = useCallback((roles: EndfieldRoleOption[]): EndfieldRoleOption | null => {
        if (!roles.length) return null;
        return roles.find((role) => role.isDefault) ?? roles[0];
    }, []);

    const finalizeRoleSelection = useCallback((role: EndfieldRoleOption) => {
        const hosts = resolveApiHosts(accountMode);
        const currentConfig = readEndfieldTrackerConfig();
        const nextConfig: EndfieldTrackerConfig = {
            enabled: true,
            locatorSync: true,
            baseUrl: hosts.baseUrl,
            roleId: role.roleId,
            serverId: role.serverId,
            debug: currentConfig?.debug ?? false,
            intervalMs: currentConfig?.intervalMs,
            offsetX: currentConfig?.offsetX,
            offsetZ: currentConfig?.offsetZ,
            scaleX: currentConfig?.scaleX,
            scaleZ: currentConfig?.scaleZ,
        };
        saveEndfieldTrackerConfig(nextConfig);
        setPrefsLocatorSync(true);
        setLoginStep('auth');
        setRoleOptions([]);
        setSelectedRoleKey('');
        closeLoginModal();
    }, [accountMode, closeLoginModal, setPrefsLocatorSync]);

    const handleLocatorToggle = useCallback((nextEnabled: boolean) => {
        if (!nextEnabled) {
            setPrefsLocatorSync(false);
            const current = readEndfieldTrackerConfig();
            if (current) {
                saveEndfieldTrackerConfig({
                    ...current,
                    enabled: false,
                    locatorSync: false,
                });
            }
            return;
        }

        const current = readEndfieldTrackerConfig();
        const session = readEndfieldSession();
        if (current && session?.cred && session.token) {
            saveEndfieldTrackerConfig({
                ...current,
                enabled: true,
                locatorSync: true,
            });
            setPrefsLocatorSync(true);
            return;
        }

        setLoginError('');
        setLoginStep('auth');
        setAccountMode(inferAccountModeFromBaseUrl(current?.baseUrl));
        setLoginOpen(true);
    }, [setPrefsLocatorSync]);

    const handleSendSklandCode = useCallback(async () => {
        setLoginError('');
        if (!phone.trim()) {
            setLoginError('Please fill phone number.');
            return;
        }

        setSendCodeLoading(true);
        try {
            const hosts = resolveApiHosts('skland');
            await sendSklandPhoneCode(phone.trim(), getOrCreateSklandDeviceId(), hosts);
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Failed to send verification code.';
            setLoginError(message);
        } finally {
            setSendCodeLoading(false);
        }
    }, [phone]);

    const handleLocatorLogin = useCallback(async () => {
        setLoginError('');

        const hosts = resolveApiHosts(accountMode);

        setLoginLoading(true);
        try {
            let session: EndfieldSession;
            if (accountMode === 'skland') {
                const missingSklandFields = sklandAuthMode === 'password'
                    ? (!phone.trim() || !password.trim())
                    : (!phone.trim() || !verificationCode.trim());
                if (missingSklandFields) {
                    setLoginError(
                        sklandAuthMode === 'password'
                            ? 'Please fill phone number and password.'
                            : 'Please fill phone number and verification code.',
                    );
                    return;
                }
                session = await authenticateEndfieldSession(
                    {
                        provider: 'skland',
                        phone: phone.trim(),
                        verificationCode: sklandAuthMode === 'code' ? verificationCode.trim() : undefined,
                        password: sklandAuthMode === 'password' ? password : undefined,
                        deviceId: getOrCreateSklandDeviceId(),
                        sklandLoginType: sklandAuthMode,
                    },
                    hosts,
                );
            } else {
                if (!email.trim() || !password.trim()) {
                    setLoginError('Please fill email and password.');
                    return;
                }
                session = await authenticateEndfieldSession(
                    {
                        provider: 'skport',
                        email: email.trim(),
                        password,
                    },
                    hosts,
                );
            }

            const endfieldClient = new EndfieldBrowserClient(hosts);
            const roles = await endfieldClient.getEndfieldRoleOptions(session.cred, session.token);
            if (!roles.length) {
                setLoginError('No Endfield roles found on this account.');
                return;
            }

            if (roles.length === 1) {
                finalizeRoleSelection(roles[0]);
                return;
            }

            const defaultRole = resolveDefaultRole(roles);
            setRoleOptions(roles);
            setSelectedRoleKey(
                defaultRole
                    ? `${defaultRole.serverId}:${defaultRole.roleId}`
                    : `${roles[0].serverId}:${roles[0].roleId}`,
            );
            setLoginStep('role');
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Login failed.';
            setLoginError(message);
        } finally {
            setLoginLoading(false);
        }
    }, [
        accountMode,
        email,
        finalizeRoleSelection,
        password,
        phone,
        resolveDefaultRole,
        sklandAuthMode,
        verificationCode,
    ]);

    const handleRoleConfirm = useCallback(() => {
        const role = roleOptions.find((item) => `${item.serverId}:${item.roleId}` === selectedRoleKey);
        if (!role) {
            setLoginError('Please select a role.');
            return;
        }
        finalizeRoleSelection(role);
    }, [finalizeRoleSelection, roleOptions, selectedRoleKey]);

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
        { isActive: prefsLocatorSync,    onToggle: handleLocatorToggle,    label: t('settings.mapPrefs.locatorSync') || 'Locator Sync' },
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

            <Modal
                open={loginOpen}
                size="m"
                onClose={closeLoginModal}
                onChange={setLoginOpen}
                title={t('settings.mapPrefs.locatorSyncLoginTitle') || 'Sign In to Endfield'}
            >
                <div className={styles.locatorLoginForm}>
                    {loginStep === 'auth' ? (
                        <div className={styles.accountModeSwitch}>
                            <button
                                type="button"
                                className={`${styles.accountModeButton} ${accountMode === 'skport' ? styles.accountModeButtonActive : ''}`}
                                onClick={() => {
                                    setAccountMode('skport');
                                    setLoginError('');
                                }}
                            >
                                SKPORT
                            </button>
                            <button
                                type="button"
                                className={`${styles.accountModeButton} ${accountMode === 'skland' ? styles.accountModeButtonActive : ''}`}
                                onClick={() => {
                                    setAccountMode('skland');
                                    setSklandAuthMode('code');
                                    setLoginError('');
                                }}
                            >
                                SKLAND
                            </button>
                        </div>
                    ) : null}

                    {loginStep === 'auth' ? (
                        accountMode === 'skland' ? (
                            <>
                                <div className={styles.accountModeSwitch}>
                                    <button
                                        type="button"
                                        className={`${styles.accountModeButton} ${sklandAuthMode === 'code' ? styles.accountModeButtonActive : ''}`}
                                        onClick={() => {
                                            setSklandAuthMode('code');
                                            setLoginError('');
                                        }}
                                    >
                                        SMS CODE
                                    </button>
                                    <button
                                        type="button"
                                        className={`${styles.accountModeButton} ${sklandAuthMode === 'password' ? styles.accountModeButtonActive : ''}`}
                                        onClick={() => {
                                            setSklandAuthMode('password');
                                            setLoginError('');
                                        }}
                                    >
                                        PASSWORD
                                    </button>
                                </div>

                                <label className={styles.locatorField}>
                                    <span>{t('settings.mapPrefs.phone') || 'Phone Number'}</span>
                                    <input
                                        className={styles.locatorInput}
                                        value={phone}
                                        onChange={(e) => setPhone(e.target.value)}
                                        autoComplete="tel"
                                    />
                                </label>

                                {sklandAuthMode === 'code' ? (
                                    <div className={styles.codeInputRow}>
                                        <label className={styles.locatorField}>
                                            <span>{t('settings.mapPrefs.verificationCode') || 'Verification Code'}</span>
                                            <input
                                                className={styles.locatorInput}
                                                value={verificationCode}
                                                onChange={(e) => setVerificationCode(e.target.value)}
                                            />
                                        </label>
                                        <button
                                            type="button"
                                            className={styles.sendCodeButton}
                                            onClick={() => {
                                                void handleSendSklandCode();
                                            }}
                                            disabled={sendCodeLoading}
                                        >
                                            {sendCodeLoading
                                                ? (t('common.loading') || 'Loading...')
                                                : (t('settings.mapPrefs.sendCode') || 'Send Code')}
                                        </button>
                                    </div>
                                ) : (
                                    <label className={styles.locatorField}>
                                        <span>{t('settings.mapPrefs.password') || 'Password'}</span>
                                        <input
                                            className={styles.locatorInput}
                                            type="password"
                                            value={password}
                                            onChange={(e) => setPassword(e.target.value)}
                                            autoComplete="current-password"
                                        />
                                    </label>
                                )}
                            </>
                        ) : (
                            <>
                                <label className={styles.locatorField}>
                                    <span>{t('settings.mapPrefs.email') || 'Email'}</span>
                                    <input
                                        className={styles.locatorInput}
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        autoComplete="username"
                                    />
                                </label>

                                <label className={styles.locatorField}>
                                    <span>{t('settings.mapPrefs.password') || 'Password'}</span>
                                    <input
                                        className={styles.locatorInput}
                                        type="password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        autoComplete="current-password"
                                    />
                                </label>
                            </>
                        )
                    ) : (
                        <div className={styles.roleSelectList}>
                            {roleOptions.map((role) => {
                                const key = `${role.serverId}:${role.roleId}`;
                                const active = key === selectedRoleKey;
                                return (
                                    <button
                                        key={key}
                                        type="button"
                                        className={`${styles.roleOption} ${active ? styles.roleOptionActive : ''}`}
                                        onClick={() => setSelectedRoleKey(key)}
                                    >
                                        <div className={styles.roleOptionName}>
                                            {role.nickname || role.roleId}
                                        </div>
                                        <div className={styles.roleOptionMeta}>
                                            {role.serverName || role.serverType || `Server ${role.serverId}`} · Lv.{role.level}
                                        </div>
                                    </button>
                                );
                            })}
                        </div>
                    )}

                    {loginError ? <div className={styles.locatorError}>{loginError}</div> : null}

                    <div className={styles.locatorActions}>
                        <Button
                            text={t('common.cancel') || 'Cancel'}
                            buttonType="close"
                            buttonStyle="normal"
                            onClick={closeLoginModal}
                            disabled={loginLoading}
                        />
                        <Button
                            text={loginLoading
                                ? (t('common.loading') || 'Loading...')
                                : (loginStep === 'auth'
                                    ? (t('idcard.auth.signIn') || 'Sign in')
                                    : (t('common.confirm') || 'Confirm'))}
                            buttonType="confirm"
                            buttonStyle="normal"
                            onClick={loginStep === 'auth'
                                ? () => {
                                    void handleLocatorLogin();
                                }
                                : handleRoleConfirm}
                            disabled={loginLoading}
                        />
                    </div>
                </div>
            </Modal>
        </Modal>
    );
};

export default React.memo(SettingsModal);