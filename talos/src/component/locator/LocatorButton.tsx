import React, { useCallback, useEffect, useMemo, useState } from 'react';
import classNames from 'classnames';
import Modal from '@/component/modal/modal';
import { openOemAuthModal } from '@/component/login/authEvents';
import { AccessButton } from '@/component/login/access';
import { TabView, type TabViewItem } from '@/component/tabView';
import { useAuthStore } from '@/store/auth';
import { useUiPrefsStore } from '@/store/uiPrefs';
import { useLocale, useTranslateUI } from '@/locale';
import {
    EndfieldBrowserClient,
    type EndfieldRoleOption,
} from '@/utils/endfield/client';
import { readEndfieldSession, saveEndfieldSession } from '@/utils/endfield/storage';
import { type EndfieldSession } from '@/utils/endfield/types';
import {
    readEndfieldTrackerConfig,
    saveEndfieldTrackerConfig,
    type EndfieldTrackerConfig,
} from '@/utils/endfield/config';
import regSwitchStyles from '@/component/regSwitch/regSwitch.module.scss';
import profileStyles from '@/component/login/profile/profile.module.scss';
import styles from './Locator.module.scss';
import LocateCloseIcon from '@/assets/images/UI/locateclose.svg?react';
import LocateOpenIcon from '@/assets/images/UI/locateopen.svg?react';
import LocateCurrentIcon from '@/assets/images/UI/locatecurrent.svg?react';
import {
    inferLocatorAccountModeFromBaseUrl,
    resolveEndfieldApiHosts,
    type LocatorAccountMode,
} from './endfieldHosts';
import {
    requestLocatorReturnCurrent,
    useLocatorStore,
    type LocatorViewMode,
} from './state';

type LocatorButtonVariant = 'desktop' | 'mobile';
const BIND_COUNTDOWN_SECONDS = 5;

const TOKEN_API_BY_MODE: Record<LocatorAccountMode, string> = {
    skland: 'https://web-api.hypergryph.com/account/info/hg',
    skport: 'https://web-api.skport.com/cookie_store/account_token',
};

const extractToken = (raw: string): string => {
    const trimmed = raw.trim();
    if (!trimmed) return '';

    try {
        const parsed = JSON.parse(trimmed) as {
            data?: {
                content?: unknown;
                accountToken?: unknown;
                token?: unknown;
            };
            content?: unknown;
            accountToken?: unknown;
            token?: unknown;
        };
        const content = parsed.data?.content
            ?? parsed.data?.accountToken
            ?? parsed.data?.token
            ?? parsed.content
            ?? parsed.accountToken
            ?? parsed.token;
        if (typeof content === 'string') return content.trim();
    } catch {
        const matched = trimmed.match(/"(?:content|accountToken|token)"\s*:\s*"([^"]+)"/);
        if (matched?.[1]) return matched[1].trim();
    }

    return trimmed;
};

const sanitizeToken = (raw: string): string => {
    const trimmed = raw.trim();
    if (!trimmed) return raw;

    try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        if ('msg' in parsed) {
            const { msg: _msg, ...rest } = parsed;
            return JSON.stringify(rest);
        }
    } catch {
        return raw.replace(/,?\s*"msg"\s*:\s*"[^"]*"\s*/g, (match) => (match.trimStart().startsWith(',') ? '' : ''));
    }

    return raw;
};

const buildDocsUrl = (locale: string): string => {
    const lang = locale.trim();
    return lang
        ? `https://blog.opendfieldmap.org/${encodeURIComponent(lang)}/docs/data-collection`
        : 'https://blog.opendfieldmap.org/docs/data-collection';
};

const applyRoleConfig = (
    accountMode: LocatorAccountMode,
    role: EndfieldRoleOption,
): void => {
    const hosts = resolveEndfieldApiHosts(accountMode);
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
    useUiPrefsStore.getState().setPrefsLocatorSyncEnabled(true);
    useLocatorStore.getState().setViewMode('tracking');
};

const enableExistingLocatorSession = (): boolean => {
    const current = readEndfieldTrackerConfig();
    const session = readEndfieldSession();
    if (!current || !session?.cred || !session.token) return false;

    saveEndfieldTrackerConfig({
        ...current,
        enabled: true,
        locatorSync: true,
    });
    useUiPrefsStore.getState().setPrefsLocatorSyncEnabled(true);
    useLocatorStore.getState().setViewMode('tracking');
    return true;
};

const disableLocator = (): void => {
    const current = readEndfieldTrackerConfig();
    if (current) {
        saveEndfieldTrackerConfig({
            ...current,
            enabled: false,
            locatorSync: false,
        });
    }
    useUiPrefsStore.getState().setPrefsLocatorSyncEnabled(false);
    useLocatorStore.getState().setViewMode('off');
};

const resolveIcon = (viewMode: LocatorViewMode): React.FC =>
    viewMode === 'tracking'
        ? LocateOpenIcon
        : viewMode === 'detached'
            ? LocateCurrentIcon
            : LocateCloseIcon;

interface LocatorButtonProps {
    variant?: LocatorButtonVariant;
}

const LocatorButton: React.FC<LocatorButtonProps> = ({ variant = 'desktop' }) => {
    const t = useTranslateUI();
    const sessionUser = useAuthStore((state) => state.sessionUser);
    const viewMode = useLocatorStore((state) => state.viewMode);
    const [bindingOpen, setBindingOpen] = useState(false);
    const [pendingAfterLogin, setPendingAfterLogin] = useState(false);

    useEffect(() => {
        if (!pendingAfterLogin || !sessionUser) return;
        setPendingAfterLogin(false);
        if (!enableExistingLocatorSession()) {
            setBindingOpen(true);
        }
    }, [pendingAfterLogin, sessionUser]);

    const handleClick = useCallback(() => {
        if (viewMode === 'detached') {
            requestLocatorReturnCurrent();
            useLocatorStore.getState().setViewMode('tracking');
            return;
        }

        if (viewMode === 'tracking') {
            disableLocator();
            return;
        }

        if (!sessionUser) {
            setPendingAfterLogin(true);
            openOemAuthModal('login');
            return;
        }

        if (!enableExistingLocatorSession()) {
            setBindingOpen(true);
        }
    }, [sessionUser, viewMode]);

    const Icon = resolveIcon(viewMode);
    const label = viewMode === 'off'
        ? (t('locator.enable') || 'Enable locator sync')
        : viewMode === 'detached'
            ? (t('locator.returnCurrent') || 'Return to current locator position')
            : (t('locator.disable') || 'Disable locator sync');

    if (variant === 'mobile') {
        return (
            <>
                <div className={styles.mobileLocatorShell}>
                    <button
                        type="button"
                        className={styles.mobileLocatorButton}
                        data-active={viewMode !== 'off'}
                        onClick={handleClick}
                        aria-label={label}
                    >
                        <Icon />
                    </button>
                </div>
                <LocatorBindingModal open={bindingOpen} onClose={() => setBindingOpen(false)} />
            </>
        );
    }

    return (
        <>
            <div className={classNames(regSwitchStyles.regswitch, styles.locatorSwitch)}>
                <button
                    type="button"
                    className={classNames(
                        regSwitchStyles.regItem,
                        styles.locatorButton,
                        viewMode !== 'off' && regSwitchStyles.selected,
                    )}
                    onClick={handleClick}
                    aria-label={label}
                >
                    <div className={regSwitchStyles.icon}>
                        <Icon />
                    </div>
                </button>
            </div>
            <LocatorBindingModal open={bindingOpen} onClose={() => setBindingOpen(false)} />
        </>
    );
};

interface LocatorBindingModalProps {
    open: boolean;
    onClose: () => void;
}

const LocatorBindingModal: React.FC<LocatorBindingModalProps> = ({ open, onClose }) => {
    const t = useTranslateUI();
    const locale = useLocale();
    const existingTrackerConfig = useMemo(() => readEndfieldTrackerConfig(), []);
    const [accountMode, setAccountMode] = useState<LocatorAccountMode>(
        inferLocatorAccountModeFromBaseUrl(existingTrackerConfig?.baseUrl),
    );
    const [step, setStep] = useState<'auth' | 'role'>('auth');
    const [roleOptions, setRoleOptions] = useState<EndfieldRoleOption[]>([]);
    const [selectedRoleKey, setSelectedRoleKey] = useState('');
    const [tokenInput, setTokenInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [countdown, setCountdown] = useState(BIND_COUNTDOWN_SECONDS);
    const l = useCallback((key: string, fallback: string) => t(key) || fallback, [t]);

    const resetTransient = useCallback(() => {
        setError('');
        setStep('auth');
        setRoleOptions([]);
        setSelectedRoleKey('');
        setTokenInput('');
        setLoading(false);
        setCountdown(BIND_COUNTDOWN_SECONDS);
    }, []);

    const close = useCallback(() => {
        resetTransient();
        onClose();
    }, [onClose, resetTransient]);

    useEffect(() => {
        if (!open) return undefined;
        setCountdown(BIND_COUNTDOWN_SECONDS);
        const timer = window.setInterval(() => {
            setCountdown((value) => Math.max(0, value - 1));
        }, 1000);
        return () => window.clearInterval(timer);
    }, [open]);

    const loadRoles = useCallback(async (
        session: EndfieldSession,
        mode: LocatorAccountMode,
    ) => {
        const client = new EndfieldBrowserClient(resolveEndfieldApiHosts(mode));
        const roles = await client.getEndfieldRoleOptions(session.cred, session.token);
        if (!roles.length) {
            throw new Error(l('locator.binding.errors.noRole', 'No Endfield roles found on this account.'));
        }

        if (roles.length === 1) {
            applyRoleConfig(mode, roles[0]);
            close();
            return;
        }

        const defaultRole = roles.find((role) => role.isDefault) ?? roles[0];
        setRoleOptions(roles);
        setSelectedRoleKey(`${defaultRole.serverId}:${defaultRole.roleId}`);
        setAccountMode(mode);
        setStep('role');
    }, [close, l]);

    const bindByToken = useCallback(async () => {
        const accountToken = extractToken(tokenInput);
        if (!accountToken) {
            setError(l('locator.binding.errors.tokenRequired', 'Paste the token response JSON or the content value.'));
            return;
        }

        const hosts = resolveEndfieldApiHosts(accountMode);
        const client = new EndfieldBrowserClient(hosts);
        const grant = await client.grantOAuth2Code(accountToken);
        const generated = await client.generateCredByCode(grant.code);
        const session = {
            accountToken,
            cred: generated.cred,
            token: generated.token,
        };
        saveEndfieldSession(session);
        await loadRoles(session, accountMode);
    }, [accountMode, l, loadRoles, tokenInput]);

    const handleRoleConfirm = useCallback(() => {
        const role = roleOptions.find((item) => `${item.serverId}:${item.roleId}` === selectedRoleKey);
        if (!role) {
            setError(l('locator.binding.errors.roleRequired', 'Please select a role.'));
            return;
        }
        applyRoleConfig(accountMode, role);
        close();
    }, [accountMode, close, l, roleOptions, selectedRoleKey]);

    const handleBind = useCallback(async () => {
        if (loading || countdown > 0) return;
        setError('');
        setLoading(true);
        try {
            if (step === 'auth') await bindByToken();
            else handleRoleConfirm();
        } catch (err) {
            setError(err instanceof Error ? err.message : l('locator.binding.errors.bindingFailed', 'Binding failed.'));
        } finally {
            setLoading(false);
        }
    }, [bindByToken, countdown, handleRoleConfirm, l, loading, step]);

    const switchMode = useCallback((mode: LocatorAccountMode) => {
        setAccountMode(mode);
        setError('');
        setTokenInput('');
        setStep('auth');
        setRoleOptions([]);
        setSelectedRoleKey('');
    }, []);

    const tabItems: TabViewItem[] = useMemo(() => [
        {
            key: 'skland',
            label: t('locator.binding.chinaTab') || 'China(Hypergryph)',
            description: (
                <>
                    <div>{t('locator.binding.chinaDescription') || '1. Open the China token API link. 2. Paste the full response, read the terms, then submit.'}</div>
                    <a href={TOKEN_API_BY_MODE.skland} target="_blank" rel="noopener noreferrer">{TOKEN_API_BY_MODE.skland}</a>
                </>
            ),
        },
        {
            key: 'skport',
            label: t('locator.binding.globalTab') || 'Global(Gryphline)',
            description: (
                <>
                    <div>{t('locator.binding.globalDescription') || '1. Open the Global token API link. 2. Paste the full response, read the terms, then submit.'}</div>
                    <a href={TOKEN_API_BY_MODE.skport} target="_blank" rel="noopener noreferrer">{TOKEN_API_BY_MODE.skport}</a>
                </>
            ),
        },
    ], [t]);
    const bindLabelTemplate = t('locator.binding.bindWithCountdown');
    const bindLabel = countdown > 0
        ? bindLabelTemplate.replace('{sec}', String(countdown))
        : (t('locator.binding.bind'));

    return (
        <Modal
            open={open}
            size="l"
            onClose={close}
            title={t('locator.binding.title') || 'Binding SKLAND/SKPORT'}
        >
            <div className={styles.bindingForm}>
                <TabView
                    items={tabItems}
                    activeKey={accountMode}
                    onChange={(key) => switchMode(key as LocatorAccountMode)}
                    fill
                />

                {step === 'auth' ? (
                    <div className={styles.bindingFields}>
                        <textarea
                            className={styles.tokenTextarea}
                            value={tokenInput}
                            onChange={(event) => setTokenInput(sanitizeToken(event.target.value))}
                            placeholder={t('locator.binding.tokenTextareaPlaceholder') || '{"code":0,"data":{"content":"..."}}'}
                            spellCheck={false}
                        />
                    </div>
                ) : (
                    <div className={styles.roleSelectList}>
                        {roleOptions.map((role) => {
                            const key = `${role.serverId}:${role.roleId}`;
                            return (
                                <button
                                    key={key}
                                    type="button"
                                    className={classNames(styles.roleOption, selectedRoleKey === key && styles.roleOptionActive)}
                                    onClick={() => setSelectedRoleKey(key)}
                                >
                                    <div className={styles.roleOptionName}>{role.nickname || role.roleId}</div>
                                    <div className={styles.roleOptionMeta}>
                                        {role.serverName || role.serverType || `${t('locator.binding.serverFallback') || 'Server'} ${role.serverId}`}
                                        {' · '}
                                        {t('locator.binding.levelPrefix') || 'Lv.'}
                                        {role.level}
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                )}

                {error ? <div className={styles.error}>{error}</div> : <div className={styles.error} aria-hidden="true" />}

                <div className={styles.bindingFooter}>
                    <div className={styles.policyReminder}>
                        <span>{t('locator.binding.docsLead')}</span>
                        <span>
                            <a href="https://blog.opendfieldmap.org/docs/tos" target="_blank" rel="noopener noreferrer">
                                {t('locator.binding.tos')}
                            </a>
                            {' · '}
                            <a href="https://blog.opendfieldmap.org/docs/privacy" target="_blank" rel="noopener noreferrer">
                                {t('locator.binding.privacy')}
                            </a>
                            {' · '}
                            <a href={buildDocsUrl(locale)} target="_blank" rel="noopener noreferrer">
                                {t('locator.binding.dataCollection') || 'Data Collection'}
                            </a>
                            {' · '}
                            <a href="https://blog.opendfieldmap.org/docs/disclaimer" target="_blank" rel="noopener noreferrer">
                                {t('locator.binding.disclaimer')}
                            </a>
                        </span>
                    </div>
                    <div className={classNames(profileStyles.profileActions, styles.singleAction)}>
                        <AccessButton
                            onClick={() => {
                                void handleBind();
                            }}
                            disabled={loading || countdown > 0}
                            label={loading
                                ? (t('common.loading'))
                                : bindLabel}
                        />
                    </div>
                </div>
            </div>
        </Modal>
    );
};

export default React.memo(LocatorButton);
